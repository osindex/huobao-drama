/**
 * 平台超级管理员后台路由（用户管理、全站团队调账、充值卡密批量生成、计费单价与套餐管理、注册策略）
 */
import { Hono } from 'hono'
import { desc, eq } from 'drizzle-orm'
import { db, schema, sqlite } from '../db/index.js'
import { destroyUserSessions, getRequestActor, hashUserPassword } from '../services/auth.js'
import {
  adminAdjustTeamCredits,
  completeRechargeOrder,
  generateRedeemCodeBatch,
  getAuthBillingSettings,
  updateAuthBillingSettings,
} from '../services/billing.js'
import { requireSuperAdmin } from '../services/team-access.js'
import { badRequest, created, notFound, now, success } from '../utils/response.js'
import { toSnakeCase, toSnakeCaseArray } from '../utils/transform.js'

const app = new Hono()
app.use('*', requireSuperAdmin)

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/

// GET /admin/overview — 平台运营总览指标
app.get('/overview', (c) => {
  const userCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c
  const teamStats = sqlite.prepare(`
    SELECT
      COUNT(*) AS team_count,
      COALESCE(SUM(credit_balance), 0) AS total_balance,
      COALESCE(SUM(frozen_credits), 0) AS total_frozen,
      COALESCE(SUM(total_recharged), 0) AS total_recharged,
      COALESCE(SUM(total_consumed), 0) AS total_consumed
    FROM teams
  `).get() as Record<string, number>
  const dramaCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM dramas WHERE deleted_at IS NULL').get() as { c: number }).c
  const unusedCodes = (sqlite.prepare("SELECT COUNT(*) AS c FROM redeem_codes WHERE status = 'unused'").get() as { c: number }).c

  return success(c, {
    user_count: userCount,
    drama_count: dramaCount,
    unused_redeem_codes: unusedCodes,
    ...teamStats,
    policy: getAuthBillingSettings(),
  })
})

// GET /admin/policy & PUT /admin/policy — 注册开关、赠送点数、算力计费总开关
app.get('/policy', (c) => {
  const p = getAuthBillingSettings()
  return success(c, {
    allow_open_register: p.allowOpenRegister,
    allow_invite_register: p.allowInviteRegister,
    register_bonus_credits: p.registerBonusCredits,
    billing_enabled: p.billingEnabled,
  })
})

app.put('/policy', async (c) => {
  const body = await c.req.json().catch(() => null)
  const updated = updateAuthBillingSettings({
    allowOpenRegister: typeof body?.allow_open_register === 'boolean' ? body.allow_open_register : undefined,
    allowInviteRegister: typeof body?.allow_invite_register === 'boolean' ? body.allow_invite_register : undefined,
    registerBonusCredits: body?.register_bonus_credits !== undefined ? Number(body.register_bonus_credits) : undefined,
    billingEnabled: typeof body?.billing_enabled === 'boolean' ? body.billing_enabled : undefined,
  })
  return success(c, {
    allow_open_register: updated.allowOpenRegister,
    allow_invite_register: updated.allowInviteRegister,
    register_bonus_credits: updated.registerBonusCredits,
    billing_enabled: updated.billingEnabled,
  })
})

// GET /admin/users — 全平台用户列表
app.get('/users', (c) => {
  const rows = sqlite.prepare(`
    SELECT
      u.id,
      u.username,
      u.display_name,
      u.password_source,
      u.is_super_admin,
      u.is_active,
      u.current_team_id,
      u.created_at,
      (SELECT COUNT(*) FROM team_members tm WHERE tm.user_id = u.id) AS team_count
    FROM users u
    ORDER BY u.id ASC
  `).all()
  return success(c, rows)
})

// POST /admin/users — 超管手动创建账号并初始化个人空间
app.post('/users', async (c) => {
  const body = await c.req.json().catch(() => null)
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const displayName = (typeof body?.display_name === 'string' ? body.display_name.trim() : '') || username
  const initialCredits = Math.max(0, Math.floor(Number(body?.initial_credits ?? getAuthBillingSettings().registerBonusCredits) || 0))
  const isSuper = Boolean(body?.is_super_admin)

  if (!USERNAME_RE.test(username)) {
    return badRequest(c, '用户名需为 3~32 位字母、数字、下划线、点或中划线')
  }
  if (password.length < 6 || password.length > 128) {
    return badRequest(c, '密码长度需在 6~128 位之间')
  }
  const dup = sqlite.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username)
  if (dup) return badRequest(c, '该用户名已存在')

  const pwdHash = await hashUserPassword(password)
  const ts = now()
  let userId = 0
  let teamId = 0

  sqlite.transaction(() => {
    const uRes = sqlite.prepare(
      "INSERT INTO users (username, display_name, password_hash, password_source, is_super_admin, is_active, created_at, updated_at) VALUES (?, ?, ?, 'user', ?, 1, ?, ?)"
    ).run(username, displayName, pwdHash, isSuper ? 1 : 0, ts, ts)
    userId = Number(uRes.lastInsertRowid)

    const tRes = sqlite.prepare(
      "INSERT INTO teams (name, description, owner_id, project_visibility, credit_balance, frozen_credits, total_recharged, total_consumed, created_at, updated_at) VALUES (?, ?, ?, 'team_shared', ?, 0, ?, 0, ?, ?)"
    ).run(`${displayName} 的空间`, '个人默认创作空间', userId, initialCredits, initialCredits, ts, ts)
    teamId = Number(tRes.lastInsertRowid)

    sqlite.prepare("INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)")
      .run(teamId, userId, ts)
    sqlite.prepare('UPDATE users SET current_team_id = ? WHERE id = ?').run(teamId, userId)

    if (initialCredits > 0) {
      sqlite.prepare(
        "INSERT INTO credit_ledger (team_id, user_id, type, amount, balance_after, description, created_at) VALUES (?, ?, 'recharge', ?, ?, '管理员开户初始算力', ?)"
      ).run(teamId, userId, initialCredits, initialCredits, ts)
    }
  })()

  return created(c, { id: userId, username, display_name: displayName, team_id: teamId })
})

// PUT /admin/users/:id — 启停用账号、重置密码、设置超管权限
app.put('/users/:id', async (c) => {
  const actor = getRequestActor()
  const targetId = Number(c.req.param('id'))
  const user = db.select().from(schema.users).where(eq(schema.users.id, targetId)).get()
  if (!user) return notFound(c, '用户不存在')

  const body = await c.req.json().catch(() => null)
  const updates: Record<string, any> = { updatedAt: now() }

  if (typeof body?.display_name === 'string' && body.display_name.trim()) {
    updates.displayName = body.display_name.trim().slice(0, 50)
  }

  if (typeof body?.is_active === 'boolean') {
    if (!body.is_active && actor && actor.user.id === targetId) {
      return badRequest(c, '不能停用当前正在登录的超管账号')
    }
    updates.isActive = body.is_active
    if (!body.is_active) destroyUserSessions(targetId)
  }

  if (typeof body?.is_super_admin === 'boolean') {
    if (!body.is_super_admin && actor && actor.user.id === targetId) {
      return badRequest(c, '不能移除自己的超级管理员身份')
    }
    if (!body.is_super_admin && user.isSuperAdmin) {
      const superCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM users WHERE is_super_admin = 1 AND is_active = 1').get() as { c: number }).c
      if (superCount <= 1) return badRequest(c, '平台至少需要保留一位活跃的超级管理员')
    }
    updates.isSuperAdmin = body.is_super_admin
  }

  if (typeof body?.new_password === 'string' && body.new_password.length > 0) {
    if (body.new_password.length < 6 || body.new_password.length > 128) {
      return badRequest(c, '新密码长度需在 6~128 位之间')
    }
    updates.passwordHash = await hashUserPassword(body.new_password)
    updates.passwordSource = 'user'
  }

  db.update(schema.users).set(updates).where(eq(schema.users.id, targetId)).run()
  return success(c)
})

// GET /admin/teams — 全平台团队与算力池列表
app.get('/teams', (c) => {
  const rows = sqlite.prepare(`
    SELECT
      t.*,
      u.username AS owner_username,
      u.display_name AS owner_display_name,
      (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS member_count,
      (SELECT COUNT(*) FROM dramas d WHERE d.team_id = t.id AND d.deleted_at IS NULL) AS drama_count
    FROM teams t
    LEFT JOIN users u ON u.id = t.owner_id
    ORDER BY t.id ASC
  `).all()
  return success(c, rows)
})

// POST /admin/teams/:id/credits — 管理员手动为任意团队直充或扣减算力
app.post('/teams/:id/credits', async (c) => {
  const actor = getRequestActor()
  const teamId = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => null)
  const delta = Number(body?.delta_credits)
  const note = typeof body?.note === 'string' ? body.note.trim() : ''

  try {
    const res = adminAdjustTeamCredits(teamId, actor?.user.id || 1, delta, note)
    return success(c, res)
  } catch (err: any) {
    return badRequest(c, err.message || '算力调账失败')
  }
})

// GET /admin/redeem-codes — 充值卡密列表
app.get('/redeem-codes', (c) => {
  const status = c.req.query('status') || ''
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') || 100)))
  const sql = status
    ? `SELECT rc.*, t.name AS redeemed_team_name, u.username AS redeemed_username
       FROM redeem_codes rc
       LEFT JOIN teams t ON t.id = rc.redeemed_by_team_id
       LEFT JOIN users u ON u.id = rc.redeemed_by_user_id
       WHERE rc.status = ?
       ORDER BY rc.id DESC LIMIT ?`
    : `SELECT rc.*, t.name AS redeemed_team_name, u.username AS redeemed_username
       FROM redeem_codes rc
       LEFT JOIN teams t ON t.id = rc.redeemed_by_team_id
       LEFT JOIN users u ON u.id = rc.redeemed_by_user_id
       ORDER BY rc.id DESC LIMIT ?`
  const rows = status ? sqlite.prepare(sql).all(status, limit) : sqlite.prepare(sql).all(limit)
  return success(c, rows)
})

// POST /admin/redeem-codes — 批量生成充值卡密
app.post('/redeem-codes', async (c) => {
  const actor = getRequestActor()
  const body = await c.req.json().catch(() => null)
  try {
    const res = generateRedeemCodeBatch({
      count: Number(body?.count || 1),
      credits: Number(body?.credits || 0),
      batchNote: typeof body?.batch_note === 'string' ? body.batch_note : undefined,
      expiresDays: body?.expires_days ? Number(body.expires_days) : null,
      createdBy: actor?.user.id || 1,
    })
    return created(c, res)
  } catch (err: any) {
    return badRequest(c, err.message || '生成卡密失败')
  }
})

// DELETE /admin/redeem-codes/:id — 作废未使用的卡密
app.delete('/redeem-codes/:id', (c) => {
  const id = Number(c.req.param('id'))
  const row = db.select().from(schema.redeemCodes).where(eq(schema.redeemCodes.id, id)).get()
  if (!row) return notFound(c, '卡密不存在')
  if (row.status !== 'unused') return badRequest(c, '仅可作废尚未兑换的卡密')
  db.update(schema.redeemCodes).set({ status: 'disabled' }).where(eq(schema.redeemCodes.id, id)).run()
  return success(c)
})

// GET / POST / PUT / DELETE /admin/pricing — 算力计费规则管理
app.get('/pricing', (c) => {
  const rows = db.select().from(schema.creditPricing).orderBy(schema.creditPricing.id).all()
  return success(c, toSnakeCaseArray(rows))
})

app.post('/pricing', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!['text', 'image', 'video'].includes(body?.service_type)) {
    return badRequest(c, 'service_type 必须为 text / image / video')
  }
  if (!['per_call', 'per_image', 'per_second'].includes(body?.billing_unit)) {
    return badRequest(c, 'billing_unit 必须为 per_call / per_image / per_second')
  }
  const unitCredits = Number(body?.unit_credits)
  if (!Number.isFinite(unitCredits) || unitCredits < 0) return badRequest(c, 'unit_credits 需为非负数')

  const ts = now()
  const res = db.insert(schema.creditPricing).values({
    serviceType: body.service_type,
    provider: String(body.provider || '*').trim() || '*',
    modelPattern: String(body.model_pattern || '*').trim() || '*',
    billingUnit: body.billing_unit,
    unitCredits: Math.floor(unitCredits),
    resolutionMultiplierJson: body.resolution_multiplier_json ? String(body.resolution_multiplier_json) : null,
    description: body.description ? String(body.description).trim() : null,
    isActive: body.is_active !== false,
    updatedAt: ts,
  }).run()
  const createdRow = db.select().from(schema.creditPricing).where(eq(schema.creditPricing.id, Number(res.lastInsertRowid))).get()
  return created(c, createdRow ? toSnakeCase(createdRow) : null)
})

app.put('/pricing/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const existing = db.select().from(schema.creditPricing).where(eq(schema.creditPricing.id, id)).get()
  if (!existing) return notFound(c, '计费规则不存在')

  const body = await c.req.json().catch(() => null)
  const updates: Record<string, any> = { updatedAt: now() }
  if (body?.provider !== undefined) updates.provider = String(body.provider).trim() || '*'
  if (body?.model_pattern !== undefined) updates.modelPattern = String(body.model_pattern).trim() || '*'
  if (body?.billing_unit !== undefined) {
    if (!['per_call', 'per_image', 'per_second'].includes(body.billing_unit)) {
      return badRequest(c, 'billing_unit 无效')
    }
    updates.billingUnit = body.billing_unit
  }
  if (body?.unit_credits !== undefined) {
    const n = Number(body.unit_credits)
    if (!Number.isFinite(n) || n < 0) return badRequest(c, 'unit_credits 需为非负数')
    updates.unitCredits = Math.floor(n)
  }
  if (body?.resolution_multiplier_json !== undefined) {
    updates.resolutionMultiplierJson = body.resolution_multiplier_json || null
  }
  if (body?.description !== undefined) updates.description = body.description || null
  if (typeof body?.is_active === 'boolean') updates.isActive = body.is_active

  db.update(schema.creditPricing).set(updates).where(eq(schema.creditPricing.id, id)).run()
  return success(c)
})

app.delete('/pricing/:id', (c) => {
  const id = Number(c.req.param('id'))
  db.delete(schema.creditPricing).where(eq(schema.creditPricing.id, id)).run()
  return success(c)
})

// GET / POST / PUT / DELETE /admin/packages — 充值套餐管理
app.get('/packages', (c) => {
  const rows = db.select().from(schema.creditPackages).orderBy(schema.creditPackages.sortOrder, schema.creditPackages.id).all()
  return success(c, toSnakeCaseArray(rows))
})

app.post('/packages', async (c) => {
  const body = await c.req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const credits = Math.floor(Number(body?.credits || 0))
  const bonusCredits = Math.max(0, Math.floor(Number(body?.bonus_credits || 0)))
  const priceCents = Math.max(0, Math.floor(Number(body?.price_cents || 0)))
  if (!name || credits <= 0) return badRequest(c, '请填写有效的套餐名称与算力点数')

  const ts = now()
  const res = db.insert(schema.creditPackages).values({
    name,
    credits,
    bonusCredits,
    priceCents,
    currency: body?.currency || 'CNY',
    description: body?.description || null,
    sortOrder: Number(body?.sort_order || 0),
    isActive: body?.is_active !== false,
    createdAt: ts,
    updatedAt: ts,
  }).run()
  const row = db.select().from(schema.creditPackages).where(eq(schema.creditPackages.id, Number(res.lastInsertRowid))).get()
  return created(c, row ? toSnakeCase(row) : null)
})

app.put('/packages/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const existing = db.select().from(schema.creditPackages).where(eq(schema.creditPackages.id, id)).get()
  if (!existing) return notFound(c, '充值套餐不存在')

  const body = await c.req.json().catch(() => null)
  const updates: Record<string, any> = { updatedAt: now() }
  if (typeof body?.name === 'string' && body.name.trim()) updates.name = body.name.trim()
  if (body?.credits !== undefined) updates.credits = Math.max(1, Math.floor(Number(body.credits)))
  if (body?.bonus_credits !== undefined) updates.bonusCredits = Math.max(0, Math.floor(Number(body.bonus_credits)))
  if (body?.price_cents !== undefined) updates.priceCents = Math.max(0, Math.floor(Number(body.price_cents)))
  if (body?.description !== undefined) updates.description = body.description || null
  if (body?.sort_order !== undefined) updates.sortOrder = Number(body.sort_order)
  if (typeof body?.is_active === 'boolean') updates.isActive = body.is_active

  db.update(schema.creditPackages).set(updates).where(eq(schema.creditPackages.id, id)).run()
  return success(c)
})

app.delete('/packages/:id', (c) => {
  const id = Number(c.req.param('id'))
  db.delete(schema.creditPackages).where(eq(schema.creditPackages.id, id)).run()
  return success(c)
})

// GET /admin/orders & POST /admin/orders/:orderNo/complete — 充值订单与人工确认到账
app.get('/orders', (c) => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') || 100)))
  const rows = sqlite.prepare(`
    SELECT o.*, t.name AS team_name, u.username
    FROM recharge_orders o
    LEFT JOIN teams t ON t.id = o.team_id
    LEFT JOIN users u ON u.id = o.user_id
    ORDER BY o.id DESC
    LIMIT ?
  `).all(limit)
  return success(c, rows)
})

app.post('/orders/:orderNo/complete', async (c) => {
  const orderNo = c.req.param('orderNo')
  const body = await c.req.json().catch(() => null)
  try {
    const res = completeRechargeOrder(orderNo, body?.external_trade_no || 'ADMIN_CONFIRMED')
    return success(c, res)
  } catch (err: any) {
    return badRequest(c, err.message || '订单确认入账失败')
  }
})

export default app
