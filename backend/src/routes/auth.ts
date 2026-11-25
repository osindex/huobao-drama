import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie } from 'hono/cookie'
import { and, eq } from 'drizzle-orm'
import { db, schema, sqlite } from '../db/index.js'
import {
  authEnabled,
  clearSessionCookie,
  createSession,
  destroySession,
  getRequestActor,
  hashUserPassword,
  resolveActorFromSession,
  verifyUserPassword,
  writeSessionCookie,
} from '../services/auth.js'
import { getAuthBillingSettings } from '../services/billing.js'
import { badRequest, now, success } from '../utils/response.js'

const app = new Hono()

// Global login throttle: cannot be bypassed by spoofing X-Forwarded-For.
let attempts = 0
let resetAt = 0
let verifying = false

let regAttempts = 0
let regResetAt = 0

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/

export function lookupValidInvitation(rawCode: string) {
  const code = String(rawCode || '').trim().toUpperCase()
  if (!code) return { error: '邀请码不能为空' as const }
  const inv = sqlite.prepare('SELECT * FROM team_invitations WHERE UPPER(code) = ?').get(code) as {
    id: number
    team_id: number
    code: string
    role: string
    credit_limit: number | null
    max_uses: number
    used_count: number
    expires_at: string | null
    is_active: number
  } | undefined

  if (!inv || !inv.is_active) return { error: '邀请码无效或已停用' as const }
  if (inv.max_uses > 0 && inv.used_count >= inv.max_uses) return { error: '该邀请码使用次数已达上限' as const }
  if (inv.expires_at && new Date(inv.expires_at).getTime() <= Date.now()) return { error: '该邀请码已过期' as const }

  const team = db.select().from(schema.teams).where(eq(schema.teams.id, inv.team_id)).get()
  if (!team) return { error: '邀请码所属团队不存在' as const }

  return { invitation: inv, team }
}

export function applyTeamInvitationInTx(userId: number, rawCode: string): number {
  const checked = lookupValidInvitation(rawCode)
  if ('error' in checked) throw new Error(checked.error)
  const { invitation, team } = checked
  const ts = now()

  const existing = sqlite.prepare('SELECT id FROM team_members WHERE team_id = ? AND user_id = ?')
    .get(team.id, userId) as { id: number } | undefined

  if (!existing) {
    const upd = sqlite.prepare(
      'UPDATE team_invitations SET used_count = used_count + 1 WHERE id = ? AND is_active = 1 AND (max_uses <= 0 OR used_count < max_uses)'
    ).run(invitation.id)
    if (upd.changes !== 1) throw new Error('邀请码已达使用上限或已失效')

    sqlite.prepare(
      'INSERT INTO team_members (team_id, user_id, role, credit_limit, credit_used, joined_at) VALUES (?, ?, ?, ?, 0, ?)'
    ).run(team.id, userId, invitation.role || 'member', invitation.credit_limit, ts)
  }

  sqlite.prepare('UPDATE users SET current_team_id = ?, updated_at = ? WHERE id = ?')
    .run(team.id, ts, userId)

  return team.id
}

app.get('/status', (c) => {
  const enabled = authEnabled()
  const policy = getAuthBillingSettings()
  const publicBaseUrlConfigured = Boolean((process.env.PUBLIC_BASE_URL || '').trim())
  if (!enabled) {
    return success(c, {
      enabled: false,
      authenticated: false,
      allow_open_register: false,
      allow_invite_register: false,
      billing_enabled: false,
      public_base_url_configured: publicBaseUrlConfigured,
    })
  }

  const reqTeam = Number(c.req.header('x-team-id') || 0) || null
  const actor = getRequestActor() || resolveActorFromSession(getCookie(c, 'huobao_session'), reqTeam)
  if (!actor) {
    return success(c, {
      enabled: true,
      authenticated: false,
      allow_open_register: policy.allowOpenRegister,
      allow_invite_register: policy.allowInviteRegister,
      register_bonus_credits: policy.registerBonusCredits,
      billing_enabled: policy.billingEnabled,
      public_base_url_configured: publicBaseUrlConfigured,
    })
  }

  const memberships = db.select().from(schema.teamMembers)
    .where(eq(schema.teamMembers.userId, actor.user.id))
    .all()
  const teams = memberships
    .map(m => {
      const t = db.select().from(schema.teams).where(eq(schema.teams.id, m.teamId)).get()
      if (!t) return null
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        role: m.role,
        project_visibility: t.projectVisibility,
        credit_balance: t.creditBalance,
        frozen_credits: t.frozenCredits,
        credit_limit: m.creditLimit,
        credit_used: m.creditUsed,
      }
    })
    .filter((v): v is NonNullable<typeof v> => v !== null)

  return success(c, {
    enabled: true,
    authenticated: true,
    allow_open_register: policy.allowOpenRegister,
    allow_invite_register: policy.allowInviteRegister,
    billing_enabled: policy.billingEnabled,
    public_base_url_configured: publicBaseUrlConfigured,
    user: {
      id: actor.user.id,
      username: actor.user.username,
      display_name: actor.user.displayName,
      is_super_admin: actor.user.isSuperAdmin,
      current_team_id: actor.team.id,
    },
    current_team: {
      id: actor.team.id,
      name: actor.team.name,
      description: actor.team.description,
      role: actor.membership.role,
      project_visibility: actor.team.projectVisibility,
      credit_balance: actor.team.creditBalance,
      frozen_credits: actor.team.frozenCredits,
      credit_limit: actor.membership.creditLimit,
      credit_used: actor.membership.creditUsed,
    },
    teams,
  })
})

app.get('/invite-info', (c) => {
  const code = c.req.query('code') || ''
  const checked = lookupValidInvitation(code)
  if ('error' in checked) {
    return success(c, { valid: false, message: checked.error })
  }
  return success(c, {
    valid: true,
    team_name: checked.team.name,
    role: checked.invitation.role,
  })
})

app.post('/login', bodyLimit({ maxSize: 2048 }), async (c) => {
  if (!authEnabled()) return badRequest(c, '未启用登录')
  if (!/^application\/json(?:;|$)/i.test(c.req.header('content-type') || '')) return badRequest(c, '请使用 JSON 请求')
  if (Date.now() >= resetAt) { attempts = 0; resetAt = Date.now() + 60_000 }
  if (verifying || attempts >= 10) {
    c.header('Retry-After', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))))
    return c.json({ code: 429, message: '登录尝试过于频繁，请稍后再试' }, 429)
  }
  attempts++
  verifying = true
  try {
    const body = await c.req.json().catch(error => {
      if (error instanceof SyntaxError) return null
      throw error
    })
    const password = typeof body?.password === 'string' ? body.password : ''
    const rawUsername = typeof body?.username === 'string' ? body.username.trim() : ''
    const inviteCode = typeof body?.invite_code === 'string' ? body.invite_code.trim() : ''

    let targetUser: typeof schema.users.$inferSelect | undefined
    if (!rawUsername) {
      targetUser = db.select().from(schema.users).where(eq(schema.users.isSuperAdmin, true)).get()
        || db.select().from(schema.users).get()
    } else {
      targetUser = sqlite.prepare(
        'SELECT id, username, display_name AS displayName, password_hash AS passwordHash, password_source AS passwordSource, is_super_admin AS isSuperAdmin, is_active AS isActive, current_team_id AS currentTeamId, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE LOWER(username) = LOWER(?)'
      ).get(rawUsername) as typeof schema.users.$inferSelect | undefined
    }

    if (!targetUser || !targetUser.isActive) {
      return c.json({ code: 401, message: rawUsername ? '账号或密码错误' : '密码错误' }, 401)
    }

    const ok = await verifyUserPassword(password, targetUser.passwordHash, targetUser.passwordSource)
    if (!ok) {
      return c.json({ code: 401, message: rawUsername ? '账号或密码错误' : '密码错误' }, 401)
    }

    let activeTeamId = targetUser.currentTeamId
    if (inviteCode) {
      try {
        activeTeamId = sqlite.transaction(() => applyTeamInvitationInTx(targetUser!.id, inviteCode))()
      } catch (err: any) {
        return badRequest(c, err.message || '邀请码加入失败')
      }
    }

    destroySession(getCookie(c, 'huobao_session'))
    writeSessionCookie(c, createSession(targetUser.id, activeTeamId))
    return success(c, { ok: true, user_id: targetUser.id, team_id: activeTeamId })
  } finally { verifying = false }
})

app.post('/register', bodyLimit({ maxSize: 4096 }), async (c) => {
  if (!authEnabled()) return badRequest(c, '未启用账号体系')
  if (!/^application\/json(?:;|$)/i.test(c.req.header('content-type') || '')) return badRequest(c, '请使用 JSON 请求')
  if (Date.now() >= regResetAt) { regAttempts = 0; regResetAt = Date.now() + 60_000 }
  if (regAttempts >= 10) {
    c.header('Retry-After', String(Math.max(1, Math.ceil((regResetAt - Date.now()) / 1000))))
    return c.json({ code: 429, message: '注册请求过于频繁，请稍后再试' }, 429)
  }
  regAttempts++

  const body = await c.req.json().catch(() => null)
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const displayName = (typeof body?.display_name === 'string' ? body.display_name.trim() : '') || username
  const inviteCode = typeof body?.invite_code === 'string' ? body.invite_code.trim() : ''

  if (!USERNAME_RE.test(username)) {
    return badRequest(c, '用户名需为 3~32 位字母、数字、下划线、点或中划线')
  }
  if (password.length < 6 || password.length > 128) {
    return badRequest(c, '密码长度需在 6~128 位之间')
  }
  if (displayName.length > 50) {
    return badRequest(c, '显示昵称不能超过 50 个字符')
  }

  const policy = getAuthBillingSettings()
  if (inviteCode) {
    if (!policy.allowInviteRegister) {
      return c.json({ code: 403, message: '当前平台已关闭邀请注册' }, 403)
    }
    const checked = lookupValidInvitation(inviteCode)
    if ('error' in checked) return badRequest(c, checked.error)
  } else if (!policy.allowOpenRegister) {
    return c.json({ code: 403, message: '当前仅支持凭邀请码注册，请填写团队邀请码' }, 403)
  }

  const dup = sqlite.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username)
  if (dup) return badRequest(c, '该用户名已被注册，请换一个')

  const pwdHash = await hashUserPassword(password)
  const bonus = policy.registerBonusCredits
  const ts = now()

  let createdUserId = 0
  let activeTeamId = 0
  try {
    sqlite.transaction(() => {
      const userRes = sqlite.prepare(
        "INSERT INTO users (username, display_name, password_hash, password_source, is_super_admin, is_active, created_at, updated_at) VALUES (?, ?, ?, 'user', 0, 1, ?, ?)"
      ).run(username, displayName, pwdHash, ts, ts)
      createdUserId = Number(userRes.lastInsertRowid)

      const personalTeamRes = sqlite.prepare(
        "INSERT INTO teams (name, description, owner_id, project_visibility, credit_balance, frozen_credits, total_recharged, total_consumed, created_at, updated_at) VALUES (?, ?, ?, 'team_shared', ?, 0, ?, 0, ?, ?)"
      ).run(`${displayName} 的空间`, '个人默认创作空间', createdUserId, bonus, bonus, ts, ts)
      const personalTeamId = Number(personalTeamRes.lastInsertRowid)

      sqlite.prepare(
        "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)"
      ).run(personalTeamId, createdUserId, ts)

      if (bonus > 0) {
        sqlite.prepare(
          "INSERT INTO credit_ledger (team_id, user_id, type, amount, balance_after, description, created_at) VALUES (?, ?, 'recharge', ?, ?, '新用户注册赠送体验算力', ?)"
        ).run(personalTeamId, createdUserId, bonus, bonus, ts)
      }

      activeTeamId = personalTeamId
      if (inviteCode) {
        activeTeamId = applyTeamInvitationInTx(createdUserId, inviteCode)
      } else {
        sqlite.prepare('UPDATE users SET current_team_id = ? WHERE id = ?').run(personalTeamId, createdUserId)
      }
    })()
  } catch (err: any) {
    return badRequest(c, err.message || '注册失败')
  }

  destroySession(getCookie(c, 'huobao_session'))
  writeSessionCookie(c, createSession(createdUserId, activeTeamId))
  return success(c, { ok: true, user_id: createdUserId, team_id: activeTeamId })
})

app.put('/profile', async (c) => {
  const actor = getRequestActor()
  if (!actor) return badRequest(c, '未登录')
  const body = await c.req.json().catch(() => null)
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : ''
  if (!displayName || displayName.length > 50) {
    return badRequest(c, '昵称长度需在 1~50 个字符之间')
  }
  db.update(schema.users).set({ displayName, updatedAt: now() }).where(eq(schema.users.id, actor.user.id)).run()
  return success(c, { display_name: displayName })
})

app.put('/password', async (c) => {
  const actor = getRequestActor()
  if (!actor) return badRequest(c, '未登录')
  const body = await c.req.json().catch(() => null)
  const oldPassword = typeof body?.old_password === 'string' ? body.old_password : ''
  const newPassword = typeof body?.new_password === 'string' ? body.new_password : ''
  if (newPassword.length < 6 || newPassword.length > 128) {
    return badRequest(c, '新密码长度需在 6~128 位之间')
  }

  const userRow = db.select().from(schema.users).where(eq(schema.users.id, actor.user.id)).get()
  if (!userRow) return badRequest(c, '账号不存在')
  const ok = await verifyUserPassword(oldPassword, userRow.passwordHash, userRow.passwordSource)
  if (!ok) return badRequest(c, '当前密码不正确')

  const nextHash = await hashUserPassword(newPassword)
  db.update(schema.users)
    .set({ passwordHash: nextHash, passwordSource: 'user', updatedAt: now() })
    .where(eq(schema.users.id, actor.user.id))
    .run()
  return success(c, { ok: true })
})

app.post('/logout', (c) => {
  destroySession(getCookie(c, 'huobao_session'))
  clearSessionCookie(c)
  return success(c, { ok: true })
})

export default app
