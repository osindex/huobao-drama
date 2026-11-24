/**
 * 团队与成员协作管理路由（支持多团队归属、团队切换、项目可见性配置、邀请码与团队 API Key）
 */
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { and, desc, eq } from 'drizzle-orm'
import { db, schema, sqlite } from '../db/index.js'
import { generateTeamApiKey, getRequestActor, switchSessionTeam } from '../services/auth.js'
import { isTeamAdmin } from '../services/team-access.js'
import { applyTeamInvitationInTx } from './auth.js'
import { badRequest, created, notFound, now, success } from '../utils/response.js'

const app = new Hono()

const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
function makeInviteCode() {
  const bytes = randomBytes(8)
  return Array.from(bytes, b => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join('')
}

// GET /teams — 当前用户所属的全部团队列表
app.get('/', (c) => {
  const actor = getRequestActor()
  if (!actor) return success(c, [])

  const rows = sqlite.prepare(`
    SELECT
      t.id,
      t.name,
      t.description,
      t.owner_id,
      t.project_visibility,
      t.credit_balance,
      t.frozen_credits,
      t.total_recharged,
      t.total_consumed,
      tm.role,
      tm.credit_limit,
      tm.credit_used,
      tm.joined_at,
      (SELECT COUNT(*) FROM team_members m2 WHERE m2.team_id = t.id) AS member_count,
      (SELECT COUNT(*) FROM dramas d WHERE d.team_id = t.id AND d.deleted_at IS NULL) AS drama_count
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = ?
    ORDER BY t.id ASC
  `).all(actor.user.id)

  return success(c, rows)
})

// POST /teams — 创建新团队并自动切换过去
app.post('/', async (c) => {
  const actor = getRequestActor()
  if (!actor) return badRequest(c, '未登录')

  const body = await c.req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  const visibility = body?.project_visibility === 'creator_only' ? 'creator_only' : 'team_shared'

  if (!name || name.length > 60) {
    return badRequest(c, '团队名称长度需在 1~60 个字符之间')
  }

  const ts = now()
  let newTeamId = 0
  sqlite.transaction(() => {
    const res = sqlite.prepare(
      'INSERT INTO teams (name, description, owner_id, project_visibility, credit_balance, frozen_credits, total_recharged, total_consumed, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?)'
    ).run(name, description || null, actor.user.id, visibility, ts, ts)
    newTeamId = Number(res.lastInsertRowid)
    sqlite.prepare(
      "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)"
    ).run(newTeamId, actor.user.id, ts)
  })()

  switchSessionTeam(getCookie(c, 'huobao_session'), actor.user.id, newTeamId)
  const team = db.select().from(schema.teams).where(eq(schema.teams.id, newTeamId)).get()
  return created(c, {
    id: team!.id,
    name: team!.name,
    description: team!.description,
    project_visibility: team!.projectVisibility,
    credit_balance: team!.creditBalance,
    role: 'owner',
  })
})

// POST /teams/switch — 切换当前激活团队
app.post('/switch', async (c) => {
  const actor = getRequestActor()
  if (!actor) return badRequest(c, '未登录')

  const body = await c.req.json().catch(() => null)
  const teamId = Number(body?.team_id)
  if (!Number.isSafeInteger(teamId) || teamId <= 0) {
    return badRequest(c, 'team_id 无效')
  }
  try {
    switchSessionTeam(getCookie(c, 'huobao_session'), actor.user.id, teamId)
    return success(c, { team_id: teamId })
  } catch (err: any) {
    return badRequest(c, err.message || '切换团队失败')
  }
})

// POST /teams/join — 已登录用户凭团队邀请码加入新团队
app.post('/join', async (c) => {
  const actor = getRequestActor()
  if (!actor) return badRequest(c, '未登录')

  const body = await c.req.json().catch(() => null)
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!code) return badRequest(c, '请输入团队邀请码')

  try {
    const joinedTeamId = sqlite.transaction(() => applyTeamInvitationInTx(actor.user.id, code))()
    switchSessionTeam(getCookie(c, 'huobao_session'), actor.user.id, joinedTeamId)
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, joinedTeamId)).get()
    return success(c, { team_id: joinedTeamId, team_name: team?.name })
  } catch (err: any) {
    return badRequest(c, err.message || '加入团队失败')
  }
})

// GET /teams/current — 当前激活团队详情、成员列表、邀请码与 API Key 状态
app.get('/current', (c) => {
  const actor = getRequestActor()
  if (!actor) return success(c, null)

  const members = sqlite.prepare(`
    SELECT
      tm.id,
      tm.user_id,
      u.username,
      u.display_name,
      u.is_active,
      tm.role,
      tm.credit_limit,
      tm.credit_used,
      tm.joined_at
    FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ?
    ORDER BY CASE tm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, tm.id ASC
  `).all(actor.team.id)

  const admin = isTeamAdmin(actor)
  const invitations = admin
    ? db.select().from(schema.teamInvitations)
      .where(eq(schema.teamInvitations.teamId, actor.team.id))
      .orderBy(desc(schema.teamInvitations.id))
      .all()
      .map(inv => ({
        id: inv.id,
        code: inv.code,
        role: inv.role,
        credit_limit: inv.creditLimit,
        max_uses: inv.maxUses,
        used_count: inv.usedCount,
        expires_at: inv.expiresAt,
        is_active: inv.isActive,
        created_at: inv.createdAt,
      }))
    : []

  return success(c, {
    team: {
      id: actor.team.id,
      name: actor.team.name,
      description: actor.team.description,
      owner_id: actor.team.ownerId,
      project_visibility: actor.team.projectVisibility,
      credit_balance: actor.team.creditBalance,
      frozen_credits: actor.team.frozenCredits,
      total_recharged: actor.team.totalRecharged,
      total_consumed: actor.team.totalConsumed,
      api_key_prefix: admin ? actor.team.apiKeyPrefix : null,
      has_api_key: Boolean(actor.team.apiKeyHash),
      created_at: actor.team.createdAt,
    },
    my_membership: {
      role: actor.membership.role,
      credit_limit: actor.membership.creditLimit,
      credit_used: actor.membership.creditUsed,
    },
    members,
    invitations,
  })
})

// PUT /teams/current — 更新当前团队名称、简介与数据可见性模式（仅团队 owner/admin）
app.put('/current', async (c) => {
  const actor = getRequestActor()
  if (!actor) return badRequest(c, '未登录')
  if (!isTeamAdmin(actor)) return c.json({ code: 403, message: '仅团队管理员可修改团队设置' }, 403)

  const body = await c.req.json().catch(() => null)
  const updates: Record<string, any> = { updatedAt: now() }

  if (typeof body?.name === 'string') {
    const name = body.name.trim()
    if (!name || name.length > 60) return badRequest(c, '团队名称需为 1~60 个字符')
    updates.name = name
  }
  if (body?.description !== undefined) {
    updates.description = body.description ? String(body.description).trim().slice(0, 300) : null
  }
  if (body?.project_visibility !== undefined) {
    if (!['team_shared', 'creator_only'].includes(body.project_visibility)) {
      return badRequest(c, 'project_visibility 仅支持 team_shared（团队共享）或 creator_only（仅创建者可见）')
    }
    updates.projectVisibility = body.project_visibility
  }

  db.update(schema.teams).set(updates).where(eq(schema.teams.id, actor.team.id)).run()
  return success(c)
})

// POST /teams/current/members — 按用户名直接拉入已注册用户（仅团队 owner/admin）
app.post('/current/members', async (c) => {
  const actor = getRequestActor()
  if (!actor) return badRequest(c, '未登录')
  if (!isTeamAdmin(actor)) return c.json({ code: 403, message: '仅团队管理员可添加成员' }, 403)

  const body = await c.req.json().catch(() => null)
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const role = ['admin', 'member', 'viewer'].includes(body?.role) ? body.role : 'member'
  if (role === 'admin' && actor.membership.role !== 'owner') {
    return c.json({ code: 403, message: '仅团队创建者（Owner）可任命管理员' }, 403)
  }

  let creditLimit: number | null = null
  if (body?.credit_limit !== undefined && body?.credit_limit !== null && body?.credit_limit !== '') {
    const n = Number(body.credit_limit)
    if (!Number.isSafeInteger(n) || n < 0) return badRequest(c, '成员算力配额必须为非负整数')
    creditLimit = n
  }

  const target = sqlite.prepare('SELECT id, username, display_name FROM users WHERE LOWER(username) = LOWER(?)').get(username) as
    | { id: number; username: string; display_name: string }
    | undefined
  if (!target) return notFound(c, `未找到用户名为「${username}」的账号，也可生成邀请码发给对方注册加入`)

  const existing = db.select().from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, actor.team.id), eq(schema.teamMembers.userId, target.id)))
    .get()
  if (existing) return badRequest(c, '该用户已是本团队成员')

  db.insert(schema.teamMembers).values({
    teamId: actor.team.id,
    userId: target.id,
    role,
    creditLimit,
    creditUsed: 0,
    joinedAt: now(),
  }).run()

  return created(c, { user_id: target.id, username: target.username, display_name: target.display_name, role })
})

// PUT /teams/current/members/:userId — 调整成员角色或个人算力限额
app.put('/current/members/:userId', async (c) => {
  const actor = getRequestActor()
  if (!actor) return badRequest(c, '未登录')
  if (!isTeamAdmin(actor)) return c.json({ code: 403, message: '仅团队管理员可管理成员' }, 403)

  const targetUserId = Number(c.req.param('userId'))
  const member = db.select().from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, actor.team.id), eq(schema.teamMembers.userId, targetUserId)))
    .get()
  if (!member) return notFound(c, '该成员不在当前团队中')
  if (member.role === 'owner' && bodyRoleChanged(await c.req.raw.clone().json().catch(() => null))) {
    return badRequest(c, '不能修改团队创建者（Owner）的角色')
  }

  const body = await c.req.json().catch(() => null)
  const updates: Record<string, any> = {}

  if (body?.role !== undefined && member.role !== 'owner') {
    if (!['admin', 'member', 'viewer'].includes(body.role)) {
      return badRequest(c, '角色只支持 admin / member / viewer')
    }
    if ((body.role === 'admin' || member.role === 'admin') && actor.membership.role !== 'owner') {
      return c.json({ code: 403, message: '仅团队创建者（Owner）可调整管理员角色' }, 403)
    }
    updates.role = body.role
  }

  if ('credit_limit' in (body || {})) {
    if (body.credit_limit === null || body.credit_limit === '') {
      updates.creditLimit = null
    } else {
      const n = Number(body.credit_limit)
      if (!Number.isSafeInteger(n) || n < 0) return badRequest(c, '配额上限必须为非负整数或留空不限')
      updates.creditLimit = n
    }
  }

  if (body?.reset_used === true) {
    updates.creditUsed = 0
  }

  if (Object.keys(updates).length === 0) return badRequest(c, '没有需要更新的字段')

  db.update(schema.teamMembers)
    .set(updates)
    .where(and(eq(schema.teamMembers.teamId, actor.team.id), eq(schema.teamMembers.userId, targetUserId)))
    .run()
  return success(c)
})

function bodyRoleChanged(body: any): boolean {
  return body && body.role !== undefined && body.role !== 'owner'
}

// DELETE /teams/current/members/:userId — 移除成员或成员主动退出团队
app.delete('/current/members/:userId', (c) => {
  const actor = getRequestActor()
  if (!actor) return badRequest(c, '未登录')

  const targetUserId = Number(c.req.param('userId'))
  const member = db.select().from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, actor.team.id), eq(schema.teamMembers.userId, targetUserId)))
    .get()
  if (!member) return notFound(c, '成员不存在')
  if (member.role === 'owner') return badRequest(c, '团队创建者（Owner）不可退出或被移除')

  const isSelf = targetUserId === actor.user.id
  if (!isSelf && !isTeamAdmin(actor)) {
    return c.json({ code: 403, message: '无权移除其他团队成员' }, 403)
  }
  if (!isSelf && member.role === 'admin' && actor.membership.role !== 'owner') {
    return c.json({ code: 403, message: '仅团队创建者（Owner）可移除管理员' }, 403)
  }

  const remainingTeams = db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, targetUserId)).all()
  if (remainingTeams.length <= 1) {
    return badRequest(c, '每位用户至少需保留一个所属工作空间，无法移除最后一个空间')
  }

  db.delete(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, actor.team.id), eq(schema.teamMembers.userId, targetUserId)))
    .run()

  // 同步清理该用户在本团队单项目下的显式共享记录
  sqlite.prepare(
    'DELETE FROM drama_shares WHERE user_id = ? AND drama_id IN (SELECT id FROM dramas WHERE team_id = ?)'
  ).run(targetUserId, actor.team.id)

  const fallbackTeamId = remainingTeams.find(m => m.teamId !== actor.team.id)?.teamId || null
  sqlite.prepare('UPDATE users SET current_team_id = ? WHERE id = ? AND current_team_id = ?')
    .run(fallbackTeamId, targetUserId, actor.team.id)
  sqlite.prepare('UPDATE user_sessions SET active_team_id = ? WHERE user_id = ? AND active_team_id = ?')
    .run(fallbackTeamId, targetUserId, actor.team.id)

  return success(c)
})

// POST /teams/current/invitations — 创建团队邀请码
app.post('/current/invitations', async (c) => {
  const actor = getRequestActor()
  if (!actor) return badRequest(c, '未登录')
  if (!isTeamAdmin(actor)) return c.json({ code: 403, message: '仅团队管理员可创建邀请码' }, 403)

  const body = await c.req.json().catch(() => null)
  const role = ['admin', 'member', 'viewer'].includes(body?.role) ? body.role : 'member'
  if (role === 'admin' && actor.membership.role !== 'owner') {
    return c.json({ code: 403, message: '仅团队创建者（Owner）可签发管理员角色邀请码' }, 403)
  }
  const maxUses = Math.min(1000, Math.max(1, Math.floor(Number(body?.max_uses) || 10)))
  const expiresDays = body?.expires_days ? Math.max(1, Math.floor(Number(body.expires_days))) : null
  const expiresAt = expiresDays ? new Date(Date.now() + expiresDays * 86_400_000).toISOString() : null

  let creditLimit: number | null = null
  if (body?.credit_limit !== undefined && body?.credit_limit !== null && body?.credit_limit !== '') {
    const n = Number(body.credit_limit)
    if (!Number.isSafeInteger(n) || n < 0) return badRequest(c, '配额上限须为非负整数')
    creditLimit = n
  }

  let code = makeInviteCode()
  while (sqlite.prepare('SELECT id FROM team_invitations WHERE code = ?').get(code)) {
    code = makeInviteCode()
  }

  const ts = now()
  const res = db.insert(schema.teamInvitations).values({
    teamId: actor.team.id,
    code,
    role,
    creditLimit,
    maxUses,
    usedCount: 0,
    expiresAt,
    isActive: true,
    createdBy: actor.user.id,
    createdAt: ts,
  }).run()

  return created(c, {
    id: Number(res.lastInsertRowid),
    code,
    role,
    credit_limit: creditLimit,
    max_uses: maxUses,
    expires_at: expiresAt,
  })
})

// DELETE /teams/current/invitations/:id — 停用团队邀请码
app.delete('/current/invitations/:id', (c) => {
  const actor = getRequestActor()
  if (!actor) return badRequest(c, '未登录')
  if (!isTeamAdmin(actor)) return c.json({ code: 403, message: '仅团队管理员可停用邀请码' }, 403)

  const id = Number(c.req.param('id'))
  db.update(schema.teamInvitations)
    .set({ isActive: false })
    .where(and(eq(schema.teamInvitations.id, id), eq(schema.teamInvitations.teamId, actor.team.id)))
    .run()
  return success(c)
})

// POST /teams/current/api-key — 生成或轮换团队开放 API Key（仅显示一次明文）
app.post('/current/api-key', (c) => {
  const actor = getRequestActor()
  if (!actor) return badRequest(c, '未登录')
  if (!isTeamAdmin(actor)) return c.json({ code: 403, message: '仅团队管理员可管理团队 API Key' }, 403)

  const { raw, hash, prefix } = generateTeamApiKey()
  db.update(schema.teams)
    .set({ apiKeyHash: hash, apiKeyPrefix: prefix, updatedAt: now() })
    .where(eq(schema.teams.id, actor.team.id))
    .run()

  return success(c, { api_key: raw, api_key_prefix: prefix })
})

// DELETE /teams/current/api-key — 吊销团队开放 API Key
app.delete('/current/api-key', (c) => {
  const actor = getRequestActor()
  if (!actor) return badRequest(c, '未登录')
  if (!isTeamAdmin(actor)) return c.json({ code: 403, message: '仅团队管理员可管理团队 API Key' }, 403)

  db.update(schema.teams)
    .set({ apiKeyHash: null, apiKeyPrefix: null, updatedAt: now() })
    .where(eq(schema.teams.id, actor.team.id))
    .run()

  return success(c)
})

export default app
