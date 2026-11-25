/**
 * 团队算力钱包、价格公示、卡密兑换与充值订单路由
 */
import { Hono } from 'hono'
import { desc, eq } from 'drizzle-orm'
import { db, schema, sqlite } from '../db/index.js'
import { getRequestActor } from '../services/auth.js'
import {
  createPendingRechargeOrder,
  estimateCredits,
  getAuthBillingSettings,
  redeemCodeForTeam,
} from '../services/billing.js'
import { canWriteInTeam } from '../services/team-access.js'
import { badRequest, created, success } from '../utils/response.js'
import { toSnakeCaseArray } from '../utils/transform.js'

const app = new Hono()

// GET /billing/wallet — 当前激活团队的算力钱包概览与个人配额使用情况
app.get('/wallet', (c) => {
  const actor = getRequestActor()
  const policy = getAuthBillingSettings()
  if (!actor) {
    return success(c, {
      billing_enabled: false,
      team_id: null,
      credit_balance: 0,
      frozen_credits: 0,
      total_recharged: 0,
      total_consumed: 0,
      member_credit_limit: null,
      member_credit_used: 0,
    })
  }

  const freshTeam = db.select().from(schema.teams).where(eq(schema.teams.id, actor.team.id)).get() || actor.team
  return success(c, {
    billing_enabled: policy.billingEnabled,
    team_id: freshTeam.id,
    team_name: freshTeam.name,
    role: actor.membership.role,
    credit_balance: freshTeam.creditBalance,
    frozen_credits: freshTeam.frozenCredits,
    total_recharged: freshTeam.totalRecharged,
    total_consumed: freshTeam.totalConsumed,
    member_credit_limit: actor.membership.creditLimit,
    member_credit_used: actor.membership.creditUsed,
  })
})

// GET /billing/pricing — 平台算力计费标准（供前端公开展示与预估）
app.get('/pricing', (c) => {
  const rows = db.select().from(schema.creditPricing)
    .where(eq(schema.creditPricing.isActive, true))
    .all()
  return success(c, toSnakeCaseArray(rows))
})

// GET /billing/estimate — 预估单次调用所需算力点
app.get('/estimate', (c) => {
  const serviceType = (c.req.query('service_type') || 'video') as 'text' | 'image' | 'video'
  const provider = c.req.query('provider') || '*'
  const model = c.req.query('model') || ''
  const duration = Number(c.req.query('duration') || 5)
  const resolution = c.req.query('resolution') || '720p'
  const draftRaw = c.req.query('draft_mode')
  const draftMode = draftRaw === '1' || draftRaw === 'true'
  const audioRaw = c.req.query('generate_audio')
  const generateAudio = audioRaw == null ? undefined : !(audioRaw === '0' || audioRaw === 'false')
  const credits = estimateCredits({ serviceType, provider, model, duration, resolution, draftMode, generateAudio })
  return success(c, { credits })
})

// GET /billing/packages — 可购买的算力充值套餐列表
app.get('/packages', (c) => {
  const rows = db.select().from(schema.creditPackages)
    .where(eq(schema.creditPackages.isActive, true))
    .all()
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.id - b.id)
  return success(c, toSnakeCaseArray(rows))
})

// POST /billing/redeem — 兑换充值卡密，直接充入当前激活团队的算力池
app.post('/redeem', async (c) => {
  const actor = getRequestActor()
  if (!actor) return badRequest(c, '请先登录后再兑换卡密')
  if (!canWriteInTeam(actor)) {
    return c.json({ code: 403, message: '只读访客无权操作团队钱包' }, 403)
  }

  const body = await c.req.json().catch(() => null)
  const code = typeof body?.code === 'string' ? body.code : ''
  try {
    const res = redeemCodeForTeam(actor.team.id, actor.user.id, code)
    return success(c, res)
  } catch (err: any) {
    return badRequest(c, err.message || '卡密兑换失败')
  }
})

// POST /billing/orders — 创建充值订单（预留在线支付收银台对接）
app.post('/orders', async (c) => {
  const actor = getRequestActor()
  if (!actor) return badRequest(c, '请先登录')
  if (!canWriteInTeam(actor)) {
    return c.json({ code: 403, message: '只读访客无权发起充值订单' }, 403)
  }

  const body = await c.req.json().catch(() => null)
  const packageId = Number(body?.package_id)
  const channel = typeof body?.payment_channel === 'string' ? body.payment_channel.trim() : 'online_pending'
  if (!Number.isSafeInteger(packageId) || packageId <= 0) {
    return badRequest(c, '请选择有效的算力套餐')
  }

  try {
    const order = createPendingRechargeOrder({
      teamId: actor.team.id,
      userId: actor.user.id,
      packageId,
      paymentChannel: channel,
    })
    return created(c, {
      ...order,
      payment_ready: false,
      notice: '订单已生成。在线支付网关将在下一阶段开启，当前可凭订单号联系管理员确认入账，或直接使用充值卡密秒到账。',
    })
  } catch (err: any) {
    return badRequest(c, err.message || '创建充值订单失败')
  }
})

// GET /billing/orders — 当前团队充值订单记录
app.get('/orders', (c) => {
  const actor = getRequestActor()
  if (!actor) return success(c, [])
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 30)))
  const rows = db.select().from(schema.rechargeOrders)
    .where(eq(schema.rechargeOrders.teamId, actor.team.id))
    .orderBy(desc(schema.rechargeOrders.id))
    .limit(limit)
    .all()
  return success(c, toSnakeCaseArray(rows))
})

// GET /billing/ledger — 当前团队算力收支流水明细
app.get('/ledger', (c) => {
  const actor = getRequestActor()
  if (!actor) return success(c, { items: [], total: 0 })

  const page = Math.max(1, Number(c.req.query('page') || 1))
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('page_size') || 30)))
  const typeFilter = c.req.query('type') || ''

  const whereSql = typeFilter ? 'WHERE l.team_id = ? AND l.type = ?' : 'WHERE l.team_id = ?'
  const args = typeFilter ? [actor.team.id, typeFilter] : [actor.team.id]

  const countRow = sqlite.prepare(`SELECT COUNT(*) AS cnt FROM credit_ledger l ${whereSql}`).get(...args) as { cnt: number }
  const rows = sqlite.prepare(`
    SELECT
      l.id,
      l.team_id,
      l.user_id,
      u.username,
      u.display_name,
      l.type,
      l.amount,
      l.balance_after,
      l.task_id,
      l.order_id,
      l.description,
      l.created_at
    FROM credit_ledger l
    LEFT JOIN users u ON u.id = l.user_id
    ${whereSql}
    ORDER BY l.id DESC
    LIMIT ? OFFSET ?
  `).all(...args, pageSize, (page - 1) * pageSize)

  return success(c, {
    items: rows,
    total: countRow.cnt,
    page,
    page_size: pageSize,
  })
})

export default app
