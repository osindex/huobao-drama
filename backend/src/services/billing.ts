/**
 * 多租户算力钱包与计费结算引擎。
 *
 * 核心机制：
 * - 统一采用平台「算力点」（Credits）计量，抹平本地 GB10 算力与云端商用模型的成本差异。
 * - 团队级钱包（teams.credit_balance / frozen_credits）+ 成员级可选配额上限（team_members.credit_limit）。
 * - 异步生图/生视频任务遵循「提交预扣冻结(freeze) → 成功实扣结算(settle) → 失败/取消自动退回(refund)」三阶段闭环，
 *   所有账务变更均在 SQLite 事务内原子完成并落流水表 credit_ledger。
 * - 若调用的是团队自带的 BYOK 模型配置（ai_service_configs.team_id 非空），自动免扣平台算力。
 * - 支持卡密兑换（Phase 1）、超管后台直充/调账，并预留在线支付订单表与回调幂等入账函数（Phase 2）。
 */
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, schema, sqlite } from '../db/index.js'
import { now } from '../utils/response.js'
import { authEnabled, getRequestActor } from './auth.js'
import { getConfigById, getTextConfig } from './ai.js'

export interface AuthBillingSettings {
  allowOpenRegister: boolean
  allowInviteRegister: boolean
  registerBonusCredits: number
  billingEnabled: boolean
}

function readAppSetting(key: string, fallback: string): string {
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get()
  return row?.value ?? fallback
}

function writeAppSetting(key: string, value: string) {
  const ts = now()
  db.insert(schema.appSettings)
    .values({ key, value, updatedAt: ts })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value, updatedAt: ts },
    })
    .run()
}

export function getAuthBillingSettings(): AuthBillingSettings {
  const bonus = Number(readAppSetting('auth.register_bonus_credits', '200'))
  return {
    allowOpenRegister: readAppSetting('auth.allow_open_register', 'true') === 'true',
    allowInviteRegister: readAppSetting('auth.allow_invite_register', 'true') === 'true',
    registerBonusCredits: Number.isFinite(bonus) && bonus >= 0 ? Math.floor(bonus) : 0,
    billingEnabled: readAppSetting('billing.enabled', 'true') === 'true',
  }
}

export function updateAuthBillingSettings(patch: Partial<AuthBillingSettings>): AuthBillingSettings {
  if (typeof patch.allowOpenRegister === 'boolean') {
    writeAppSetting('auth.allow_open_register', String(patch.allowOpenRegister))
  }
  if (typeof patch.allowInviteRegister === 'boolean') {
    writeAppSetting('auth.allow_invite_register', String(patch.allowInviteRegister))
  }
  if (typeof patch.registerBonusCredits === 'number' && Number.isFinite(patch.registerBonusCredits) && patch.registerBonusCredits >= 0) {
    writeAppSetting('auth.register_bonus_credits', String(Math.floor(patch.registerBonusCredits)))
  }
  if (typeof patch.billingEnabled === 'boolean') {
    writeAppSetting('billing.enabled', String(patch.billingEnabled))
  }
  return getAuthBillingSettings()
}

export function isBillingActive(): boolean {
  if (!authEnabled()) return false
  return getAuthBillingSettings().billingEnabled
}

function matchModelPattern(pattern: string, model: string): number {
  const p = (pattern || '*').trim().toLowerCase()
  const m = (model || '').trim().toLowerCase()
  if (p === '*') return 1
  if (!m) return 0
  if (p === m) return 6
  if (p.endsWith('*') && m.startsWith(p.slice(0, -1))) return 4
  if (m.includes(p)) return 3
  return 0
}

export function estimateCredits(opts: {
  serviceType: 'text' | 'image' | 'video'
  provider: string
  model?: string | null
  duration?: number | null
  resolution?: string | null
  draftMode?: boolean | null
  generateAudio?: boolean | number | null
}): number {
  const rules = db.select().from(schema.creditPricing)
    .where(eq(schema.creditPricing.serviceType, opts.serviceType))
    .all()
    .filter(r => r.isActive)

  if (!rules.length) return 0

  const providerLower = (opts.provider || '').toLowerCase()
  let bestRule: typeof rules[number] | null = null
  let bestScore = -1

  for (const r of rules) {
    const rp = (r.provider || '*').toLowerCase()
    const providerScore = rp === providerLower ? 10 : rp === '*' ? 1 : 0
    if (providerScore === 0) continue
    const modelScore = matchModelPattern(r.modelPattern, opts.model || '')
    if (modelScore === 0) continue
    const score = providerScore + modelScore
    if (score > bestScore) {
      bestScore = score
      bestRule = r
    }
  }

  if (!bestRule || bestRule.unitCredits <= 0) return 0

  if (bestRule.billingUnit === 'per_call' || bestRule.billingUnit === 'per_image') {
    const imgFactor = opts.serviceType === 'image' && opts.draftMode ? 0.8 : 1
    return Math.max(1, Math.ceil(bestRule.unitCredits * imgFactor))
  }

  if (bestRule.billingUnit === 'per_second') {
    const seconds = Math.max(1, Math.ceil(Number(opts.duration) || 5))
    let multiplier = 1
    if (bestRule.resolutionMultiplierJson && opts.resolution) {
      try {
        const map = JSON.parse(bestRule.resolutionMultiplierJson) as Record<string, number>
        const key = opts.resolution.toLowerCase()
        const exact = map[opts.resolution] ?? map[key]
        if (typeof exact === 'number' && Number.isFinite(exact) && exact > 0) {
          multiplier = exact
        }
      } catch {}
    }
    const silentDraftFactor = opts.draftMode && (opts.generateAudio === false || opts.generateAudio === 0) ? 0.75 : 1
    return Math.max(1, Math.ceil(bestRule.unitCredits * seconds * multiplier * silentDraftFactor))
  }

  return Math.max(0, Math.ceil(bestRule.unitCredits))
}

/** 提交生图/生视频任务前或创建事务中预扣冻结团队算力 */
export function freezeCreditsInTx(opts: {
  taskId: number
  teamId: number | null
  userId: number | null
  isByok?: boolean
  serviceType: 'image' | 'video'
  provider: string
  model?: string | null
  duration?: number | null
  resolution?: string | null
  draftMode?: boolean | null
  generateAudio?: boolean | number | null
  description: string
}): number {
  const ts = now()
  if (!opts.teamId || !isBillingActive()) {
    sqlite.prepare('UPDATE sys_task SET team_id = ?, user_id = ?, frozen_credits = 0, settled_credits = 0, billing_status = ? WHERE id = ?')
      .run(opts.teamId, opts.userId, 'none', opts.taskId)
    return 0
  }

  if (opts.isByok) {
    sqlite.prepare('UPDATE sys_task SET team_id = ?, user_id = ?, frozen_credits = 0, settled_credits = 0, billing_status = ? WHERE id = ?')
      .run(opts.teamId, opts.userId, 'byok', opts.taskId)
    return 0
  }

  const amount = estimateCredits({
    serviceType: opts.serviceType,
    provider: opts.provider,
    model: opts.model,
    duration: opts.duration,
    resolution: opts.resolution,
    draftMode: opts.draftMode,
    generateAudio: opts.generateAudio,
  })

  if (amount <= 0) {
    sqlite.prepare('UPDATE sys_task SET team_id = ?, user_id = ?, frozen_credits = 0, settled_credits = 0, billing_status = ? WHERE id = ?')
      .run(opts.teamId, opts.userId, 'none', opts.taskId)
    return 0
  }

  const team = sqlite.prepare('SELECT id, credit_balance, frozen_credits FROM teams WHERE id = ?').get(opts.teamId) as
    | { id: number; credit_balance: number; frozen_credits: number }
    | undefined
  if (!team) throw new Error('所属团队不存在')

  if (opts.userId) {
    const member = sqlite.prepare('SELECT credit_limit, credit_used FROM team_members WHERE team_id = ? AND user_id = ?')
      .get(opts.teamId, opts.userId) as { credit_limit: number | null; credit_used: number } | undefined
    if (member && member.credit_limit !== null && member.credit_used + amount > member.credit_limit) {
      throw new Error(`已超出您在本团队的个人算力限额（已用 ${member.credit_used} / 上限 ${member.credit_limit} 点，本次需 ${amount} 点），请联系团队管理员调整配额`)
    }
  }

  if (team.credit_balance < amount) {
    throw new Error(`团队可用算力不足（当前可用 ${team.credit_balance} 点，本次预计消耗 ${amount} 点），请前往「设置 → 算力钱包」兑换充值卡或联系管理员充值`)
  }

  const newBalance = team.credit_balance - amount
  sqlite.prepare('UPDATE teams SET credit_balance = ?, frozen_credits = frozen_credits + ?, updated_at = ? WHERE id = ?')
    .run(newBalance, amount, ts, opts.teamId)

  if (opts.userId) {
    sqlite.prepare('UPDATE team_members SET credit_used = credit_used + ? WHERE team_id = ? AND user_id = ?')
      .run(amount, opts.teamId, opts.userId)
  }

  sqlite.prepare('UPDATE sys_task SET team_id = ?, user_id = ?, frozen_credits = ?, settled_credits = 0, billing_status = ? WHERE id = ?')
    .run(opts.teamId, opts.userId, amount, 'frozen', opts.taskId)

  sqlite.prepare(
    'INSERT INTO credit_ledger (team_id, user_id, type, amount, balance_after, task_id, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(opts.teamId, opts.userId, 'freeze', -amount, newBalance, opts.taskId, opts.description, ts)

  return amount
}

/** 异步任务完成时结算冻结的算力（若实际时长短于预估，自动退还差额） */
export function settleTaskCredits(taskId: number, actualDuration?: number | null): void {
  sqlite.transaction(() => {
    const task = sqlite.prepare(
      'SELECT id, type, provider, model, params, team_id, user_id, frozen_credits, billing_status FROM sys_task WHERE id = ?'
    ).get(taskId) as {
      id: number
      type: string
      provider: string | null
      model: string | null
      params: string | null
      team_id: number | null
      user_id: number | null
      frozen_credits: number | null
      billing_status: string | null
    } | undefined

    if (!task || task.billing_status !== 'frozen' || !task.team_id) return
    const frozen = Math.max(0, Number(task.frozen_credits || 0))
    if (frozen === 0) {
      sqlite.prepare("UPDATE sys_task SET billing_status = 'settled', settled_credits = 0 WHERE id = ?").run(taskId)
      return
    }

    let settled = frozen
    if (task.type === 'video' && actualDuration && Number.isFinite(actualDuration) && actualDuration > 0) {
      let resolution: string | null = null
      let draftMode: boolean | null = null
      let generateAudio: boolean | number | null = null
      try {
        const parsed = task.params ? JSON.parse(task.params) : null
        resolution = parsed?.resolution || null
        draftMode = parsed?.draftMode ? true : null
        generateAudio = parsed?.generateAudio ?? null
      } catch {}
      const recomputed = estimateCredits({
        serviceType: 'video',
        provider: task.provider || '*',
        model: task.model,
        duration: actualDuration,
        resolution,
        draftMode,
        generateAudio,
      })
      if (recomputed > 0 && recomputed < frozen) {
        settled = recomputed
      }
    }

    const refundDiff = frozen - settled
    const ts = now()
    const team = sqlite.prepare('SELECT credit_balance, frozen_credits FROM teams WHERE id = ?')
      .get(task.team_id) as { credit_balance: number; frozen_credits: number } | undefined
    if (!team) return

    const newBalance = team.credit_balance + refundDiff
    const newFrozen = Math.max(0, team.frozen_credits - frozen)
    sqlite.prepare(
      'UPDATE teams SET credit_balance = ?, frozen_credits = ?, total_consumed = total_consumed + ?, updated_at = ? WHERE id = ?'
    ).run(newBalance, newFrozen, settled, ts, task.team_id)

    if (refundDiff > 0 && task.user_id) {
      sqlite.prepare('UPDATE team_members SET credit_used = MAX(0, credit_used - ?) WHERE team_id = ? AND user_id = ?')
        .run(refundDiff, task.team_id, task.user_id)
    }

    sqlite.prepare("UPDATE sys_task SET settled_credits = ?, billing_status = 'settled' WHERE id = ?")
      .run(settled, taskId)

    const desc = refundDiff > 0
      ? `任务 #${taskId} 完成结算（实扣 ${settled} 点，退还差额 ${refundDiff} 点）`
      : `任务 #${taskId} 完成结算（实扣 ${settled} 点）`
    sqlite.prepare(
      'INSERT INTO credit_ledger (team_id, user_id, type, amount, balance_after, task_id, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(task.team_id, task.user_id, 'settle', refundDiff, newBalance, taskId, desc, ts)
  })()
}

/** 任务失败或手动取消时自动全额退还已冻结的算力（幂等） */
export function refundTaskCredits(taskId: number, reason = '生成任务失败，自动退回预扣算力'): void {
  sqlite.transaction(() => {
    const task = sqlite.prepare(
      'SELECT id, team_id, user_id, frozen_credits, billing_status FROM sys_task WHERE id = ?'
    ).get(taskId) as {
      id: number
      team_id: number | null
      user_id: number | null
      frozen_credits: number | null
      billing_status: string | null
    } | undefined

    if (!task || task.billing_status !== 'frozen' || !task.team_id) return
    const frozen = Math.max(0, Number(task.frozen_credits || 0))
    const ts = now()

    if (frozen > 0) {
      const team = sqlite.prepare('SELECT credit_balance, frozen_credits FROM teams WHERE id = ?')
        .get(task.team_id) as { credit_balance: number; frozen_credits: number } | undefined
      if (team) {
        const newBalance = team.credit_balance + frozen
        const newFrozen = Math.max(0, team.frozen_credits - frozen)
        sqlite.prepare('UPDATE teams SET credit_balance = ?, frozen_credits = ?, updated_at = ? WHERE id = ?')
          .run(newBalance, newFrozen, ts, task.team_id)

        if (task.user_id) {
          sqlite.prepare('UPDATE team_members SET credit_used = MAX(0, credit_used - ?) WHERE team_id = ? AND user_id = ?')
            .run(frozen, task.team_id, task.user_id)
        }

        sqlite.prepare(
          'INSERT INTO credit_ledger (team_id, user_id, type, amount, balance_after, task_id, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(task.team_id, task.user_id, 'refund', frozen, newBalance, taskId, `任务 #${taskId}：${reason}`, ts)
      }
    }

    sqlite.prepare("UPDATE sys_task SET billing_status = 'refunded', settled_credits = 0 WHERE id = ?").run(taskId)
  })()
}

/** 恢复此前已退款的任务时，重新冻结原算力，避免交付失败退费后通过恢复白嫖 */
export function refreezeTaskCreditsOnRecover(taskId: number): void {
  sqlite.transaction(() => {
    const task = sqlite.prepare(
      'SELECT id, team_id, user_id, frozen_credits, billing_status FROM sys_task WHERE id = ?'
    ).get(taskId) as {
      id: number
      team_id: number | null
      user_id: number | null
      frozen_credits: number | null
      billing_status: string | null
    } | undefined

    if (!task || task.billing_status !== 'refunded' || !task.team_id) return
    const amount = Math.max(0, Number(task.frozen_credits || 0))
    if (amount <= 0 || !isBillingActive()) return

    const team = sqlite.prepare('SELECT credit_balance FROM teams WHERE id = ?')
      .get(task.team_id) as { credit_balance: number } | undefined
    if (!team) throw new Error('所属团队不存在')
    if (team.credit_balance < amount) {
      throw new Error(`恢复任务需重新冻结 ${amount} 算力点，当前团队可用算力不足（${team.credit_balance} 点）`)
    }

    const ts = now()
    const newBalance = team.credit_balance - amount
    sqlite.prepare('UPDATE teams SET credit_balance = ?, frozen_credits = frozen_credits + ?, updated_at = ? WHERE id = ?')
      .run(newBalance, amount, ts, task.team_id)

    if (task.user_id) {
      sqlite.prepare('UPDATE team_members SET credit_used = credit_used + ? WHERE team_id = ? AND user_id = ?')
        .run(amount, task.team_id, task.user_id)
    }

    sqlite.prepare("UPDATE sys_task SET billing_status = 'frozen' WHERE id = ?").run(taskId)
    sqlite.prepare(
      'INSERT INTO credit_ledger (team_id, user_id, type, amount, balance_after, task_id, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(task.team_id, task.user_id, 'freeze', -amount, newBalance, taskId, `恢复任务 #${taskId} 重新冻结算力`, ts)
  })()
}

/** 同步文本 Agent 调用即时扣费（若为 BYOK 或未开启计费则跳过） */
export function chargeTextCallCredits(opts: {
  isByok?: boolean
  provider: string
  model?: string | null
  description: string
}): number {
  const actor = getRequestActor()
  if (!actor || !isBillingActive() || opts.isByok) return 0

  const amount = estimateCredits({
    serviceType: 'text',
    provider: opts.provider,
    model: opts.model,
  })
  if (amount <= 0) return 0

  return sqlite.transaction(() => {
    const team = sqlite.prepare('SELECT credit_balance FROM teams WHERE id = ?')
      .get(actor.team.id) as { credit_balance: number } | undefined
    if (!team) throw new Error('所属团队不存在')

    const member = sqlite.prepare('SELECT credit_limit, credit_used FROM team_members WHERE team_id = ? AND user_id = ?')
      .get(actor.team.id, actor.user.id) as { credit_limit: number | null; credit_used: number } | undefined
    if (member && member.credit_limit !== null && member.credit_used + amount > member.credit_limit) {
      throw new Error(`已超出您在本团队的个人算力限额（已用 ${member.credit_used} / 上限 ${member.credit_limit} 点）`)
    }

    if (team.credit_balance < amount) {
      throw new Error(`团队可用算力不足（当前可用 ${team.credit_balance} 点，本次调用需 ${amount} 点），请先前往「算力钱包」兑换卡密或充值`)
    }

    const ts = now()
    const newBalance = team.credit_balance - amount
    sqlite.prepare('UPDATE teams SET credit_balance = ?, total_consumed = total_consumed + ?, updated_at = ? WHERE id = ?')
      .run(newBalance, amount, ts, actor.team.id)
    sqlite.prepare('UPDATE team_members SET credit_used = credit_used + ? WHERE team_id = ? AND user_id = ?')
      .run(amount, actor.team.id, actor.user.id)
    sqlite.prepare(
      'INSERT INTO credit_ledger (team_id, user_id, type, amount, balance_after, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(actor.team.id, actor.user.id, 'settle', -amount, newBalance, opts.description, ts)

    return amount
  })()
}

/** 解析当前请求使用的文本模型配置并按次扣减算力（BYOK 或未开启计费时自动免扣） */
export async function chargeTextAgentCall(opts: {
  model?: string
  configId?: number
  description: string
}): Promise<number> {
  if (!getRequestActor() || !isBillingActive()) return 0
  const textConfig = (opts.configId ? await getConfigById(opts.configId) : null) || await getTextConfig()
  return chargeTextCallCredits({
    isByok: Boolean(textConfig.teamId),
    provider: textConfig.provider,
    model: opts.model || textConfig.model,
    description: opts.description,
  })
}

function makeOrderNo(prefix = 'ORD'): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const rand = randomBytes(4).toString('hex').toUpperCase()
  return `${prefix}${stamp}${rand}`
}

/** 兑换充值卡密入账团队钱包 */
export function redeemCodeForTeam(teamId: number, userId: number, rawCode: string) {
  const normalized = String(rawCode || '').trim().toUpperCase()
  if (!normalized || normalized.length > 64) {
    throw new Error('请输入有效的充值卡密')
  }

  return sqlite.transaction(() => {
    const codeRow = sqlite.prepare('SELECT * FROM redeem_codes WHERE code = ?').get(normalized) as {
      id: number
      code: string
      credits: number
      status: string
      expires_at: string | null
    } | undefined

    if (!codeRow) throw new Error('充值卡密不存在，请核对是否输入有误')
    if (codeRow.status === 'redeemed') throw new Error('该充值卡密已被兑换使用')
    if (codeRow.status !== 'unused') throw new Error('该充值卡密已失效')
    if (codeRow.expires_at && new Date(codeRow.expires_at).getTime() <= Date.now()) {
      throw new Error('该充值卡密已过期')
    }

    const team = sqlite.prepare('SELECT id, credit_balance FROM teams WHERE id = ?').get(teamId) as
      | { id: number; credit_balance: number }
      | undefined
    if (!team) throw new Error('目标团队不存在')

    const ts = now()
    const updated = sqlite.prepare(
      "UPDATE redeem_codes SET status = 'redeemed', redeemed_by_team_id = ?, redeemed_by_user_id = ?, redeemed_at = ? WHERE id = ? AND status = 'unused'"
    ).run(teamId, userId, ts, codeRow.id)
    if (updated.changes !== 1) throw new Error('该充值卡密已被兑换使用')

    const orderNo = makeOrderNo('RDM')
    const orderRes = sqlite.prepare(
      "INSERT INTO recharge_orders (order_no, team_id, user_id, credits, amount_cents, payment_channel, status, note, paid_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'redeem_code', 'paid', ?, ?, ?, ?)"
    ).run(orderNo, teamId, userId, codeRow.credits, `卡密兑换 ${codeRow.code}`, ts, ts, ts)
    const orderId = Number(orderRes.lastInsertRowid)

    const newBalance = team.credit_balance + codeRow.credits
    sqlite.prepare(
      'UPDATE teams SET credit_balance = ?, total_recharged = total_recharged + ?, updated_at = ? WHERE id = ?'
    ).run(newBalance, codeRow.credits, ts, teamId)

    sqlite.prepare(
      "INSERT INTO credit_ledger (team_id, user_id, type, amount, balance_after, order_id, description, created_at) VALUES (?, ?, 'recharge', ?, ?, ?, ?, ?)"
    ).run(teamId, userId, codeRow.credits, newBalance, orderId, `卡密兑换成功（${codeRow.code}）`, ts)

    return {
      order_no: orderNo,
      added_credits: codeRow.credits,
      credit_balance: newBalance,
    }
  })()
}

/** 超级管理员手动直充或调减团队算力 */
export function adminAdjustTeamCredits(teamId: number, adminUserId: number, deltaCredits: number, note?: string) {
  if (!Number.isSafeInteger(deltaCredits) || deltaCredits === 0) {
    throw new Error('调整算力点数必须为非零整数')
  }

  return sqlite.transaction(() => {
    const team = sqlite.prepare('SELECT id, credit_balance FROM teams WHERE id = ?').get(teamId) as
      | { id: number; credit_balance: number }
      | undefined
    if (!team) throw new Error('团队不存在')

    const newBalance = team.credit_balance + deltaCredits
    if (newBalance < 0) {
      throw new Error(`调减后余额不能为负数（当前可用 ${team.credit_balance} 点）`)
    }

    const ts = now()
    let orderId: number | null = null
    if (deltaCredits > 0) {
      const orderNo = makeOrderNo('ADM')
      const orderRes = sqlite.prepare(
        "INSERT INTO recharge_orders (order_no, team_id, user_id, credits, amount_cents, payment_channel, status, note, paid_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'admin_manual', 'paid', ?, ?, ?, ?)"
      ).run(orderNo, teamId, adminUserId, deltaCredits, note || '管理员后台直充', ts, ts, ts)
      orderId = Number(orderRes.lastInsertRowid)
      sqlite.prepare(
        'UPDATE teams SET credit_balance = ?, total_recharged = total_recharged + ?, updated_at = ? WHERE id = ?'
      ).run(newBalance, deltaCredits, ts, teamId)
    } else {
      sqlite.prepare('UPDATE teams SET credit_balance = ?, updated_at = ? WHERE id = ?')
        .run(newBalance, ts, teamId)
    }

    const ledgerType = deltaCredits > 0 ? 'recharge' : 'adjust'
    const desc = note?.trim() || (deltaCredits > 0 ? '管理员后台直充算力' : '管理员后台扣减算力')
    sqlite.prepare(
      'INSERT INTO credit_ledger (team_id, user_id, type, amount, balance_after, order_id, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(teamId, adminUserId, ledgerType, deltaCredits, newBalance, orderId, desc, ts)

    return {
      team_id: teamId,
      delta_credits: deltaCredits,
      credit_balance: newBalance,
    }
  })()
}

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function randomRedeemCode(): string {
  const bytes = randomBytes(12)
  const chars = Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length])
  return `HB-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`
}

/** 批量生成卡密（超管发卡用） */
export function generateRedeemCodeBatch(opts: {
  count: number
  credits: number
  batchNote?: string
  expiresDays?: number | null
  createdBy: number
}): { codes: string[]; credits: number; expires_at: string | null } {
  const count = Math.floor(opts.count)
  const credits = Math.floor(opts.credits)
  if (!Number.isSafeInteger(count) || count < 1 || count > 200) {
    throw new Error('单次生成张数需在 1 ~ 200 之间')
  }
  if (!Number.isSafeInteger(credits) || credits < 1 || credits > 100_000_000) {
    throw new Error('单张算力面额需大于 0')
  }

  const ts = now()
  const expiresAt = opts.expiresDays && opts.expiresDays > 0
    ? new Date(Date.now() + opts.expiresDays * 86_400_000).toISOString()
    : null

  const codes: string[] = []
  sqlite.transaction(() => {
    const ins = sqlite.prepare(
      "INSERT INTO redeem_codes (code, credits, batch_note, status, expires_at, created_by, created_at) VALUES (?, ?, ?, 'unused', ?, ?, ?)"
    )
    const checkDup = sqlite.prepare('SELECT id FROM redeem_codes WHERE code = ?')
    for (let i = 0; i < count; i++) {
      let code = randomRedeemCode()
      while (checkDup.get(code)) code = randomRedeemCode()
      ins.run(code, credits, opts.batchNote?.trim() || null, expiresAt, opts.createdBy, ts)
      codes.push(code)
    }
  })()

  return { codes, credits, expires_at: expiresAt }
}

/** 创建待支付充值订单（供下一步接入微信/支付宝/Stripe/易支付网关直接拉起收银台） */
export function createPendingRechargeOrder(opts: {
  teamId: number
  userId: number
  packageId: number
  paymentChannel: string
}) {
  const pkg = db.select().from(schema.creditPackages).where(eq(schema.creditPackages.id, opts.packageId)).get()
  if (!pkg || !pkg.isActive) throw new Error('所选充值套餐不存在或已下架')

  const totalCredits = pkg.credits + (pkg.bonusCredits || 0)
  const orderNo = makeOrderNo('PAY')
  const ts = now()
  db.insert(schema.rechargeOrders).values({
    orderNo,
    teamId: opts.teamId,
    userId: opts.userId,
    packageId: pkg.id,
    credits: totalCredits,
    amountCents: pkg.priceCents,
    paymentChannel: opts.paymentChannel || 'online_pending',
    status: 'pending',
    note: `${pkg.name}（${pkg.credits}${pkg.bonusCredits ? `+赠${pkg.bonusCredits}` : ''} 点）`,
    createdAt: ts,
    updatedAt: ts,
  }).run()

  return {
    order_no: orderNo,
    package_name: pkg.name,
    credits: totalCredits,
    amount_cents: pkg.priceCents,
    currency: pkg.currency,
    status: 'pending',
  }
}

/** 在线支付异步回调幂等入账函数（供下一步支付网关 Webhook 直接调用） */
export function completeRechargeOrder(orderNo: string, externalTradeNo?: string) {
  return sqlite.transaction(() => {
    const order = sqlite.prepare('SELECT * FROM recharge_orders WHERE order_no = ?').get(orderNo) as {
      id: number
      order_no: string
      team_id: number
      user_id: number
      credits: number
      status: string
      note: string | null
    } | undefined
    if (!order) throw new Error('订单不存在')
    if (order.status === 'paid') return { alreadyPaid: true, order_no: orderNo }
    if (order.status !== 'pending') throw new Error(`订单状态不可入账：${order.status}`)

    const ts = now()
    const res = sqlite.prepare(
      "UPDATE recharge_orders SET status = 'paid', external_trade_no = ?, paid_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'"
    ).run(externalTradeNo || null, ts, ts, order.id)
    if (res.changes !== 1) return { alreadyPaid: true, order_no: orderNo }

    const team = sqlite.prepare('SELECT credit_balance FROM teams WHERE id = ?').get(order.team_id) as { credit_balance: number } | undefined
    if (!team) throw new Error('订单关联团队不存在')

    const newBalance = team.credit_balance + order.credits
    sqlite.prepare(
      'UPDATE teams SET credit_balance = ?, total_recharged = total_recharged + ?, updated_at = ? WHERE id = ?'
    ).run(newBalance, order.credits, ts, order.team_id)

    sqlite.prepare(
      "INSERT INTO credit_ledger (team_id, user_id, type, amount, balance_after, order_id, description, created_at) VALUES (?, ?, 'recharge', ?, ?, ?, ?, ?)"
    ).run(order.team_id, order.user_id, order.credits, newBalance, order.id, `在线充值到账：${order.note || orderNo}`, ts)

    return { alreadyPaid: false, order_no: orderNo, credit_balance: newBalance }
  })()
}
