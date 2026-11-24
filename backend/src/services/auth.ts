/**
 * 多用户 / 多团队身份认证与请求上下文服务。
 * 在配置 AUTH_PASSWORD 或 AUTH_ENABLED=true 时生效：
 * - 保护 /api/v1（health、login、register、status、invite-info 除外）和前端页面
 * - 不保护 /static：上游视频服务需要用 PUBLIC_BASE_URL 拉取本地参考图
 * - 同时支持浏览器 Cookie 会话（持久化于 user_sessions 表）与团队级 API Key（Authorization: Bearer hb-live-...）
 * - 未配置 AUTH_PASSWORD 且未开启 AUTH_ENABLED=true 时完全无感放行（兼容桌面版与单测）。
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { and, eq, lt } from 'drizzle-orm'
import { db, schema, sqlite } from '../db/index.js'
import { now } from '../utils/response.js'

const COOKIE = 'huobao_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const deriveKey = promisify(scrypt)

export interface ActorUser {
  id: number
  username: string
  displayName: string
  isSuperAdmin: boolean
  currentTeamId: number | null
}

export interface ActorContext {
  user: ActorUser
  team: typeof schema.teams.$inferSelect
  membership: typeof schema.teamMembers.$inferSelect
  authMethod: 'session' | 'api_key'
  sessionTokenHash?: string
}

const actorStorage = new AsyncLocalStorage<ActorContext>()

export function getRequestActor(): ActorContext | null {
  return actorStorage.getStore() ?? null
}

export function runWithActor<T>(actor: ActorContext, fn: () => T): T {
  return actorStorage.run(actor, fn)
}

export function authEnabled() {
  return Boolean(process.env.AUTH_PASSWORD || process.env.AUTH_ENABLED === 'true')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

async function envPasswordKey(password: string) {
  const salt = process.env.AUTH_PASSWORD_SALT || 'huobao-local-auth'
  return await deriveKey(password, salt, 32) as Buffer
}

/** 验证环境变量级密码（兼容单密码登录及 env 托管的默认超管密码） */
export async function verifyPassword(password: string) {
  const expected = process.env.AUTH_PASSWORD || ''
  if (!expected || !password || Buffer.byteLength(password) > 1024) return false
  const [actual, wanted] = await Promise.all([envPasswordKey(password), envPasswordKey(expected)])
  return timingSafeEqual(actual, wanted)
}

/** 生成独立用户密码哈希：scrypt$<saltHex>$<keyHex> */
export async function hashUserPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await deriveKey(password, salt, 32) as Buffer
  return `scrypt$${salt}$${derived.toString('hex')}`
}

/** 验证用户密码（支持 env 托管模式与独立 scrypt 哈希模式） */
export async function verifyUserPassword(password: string, storedHash: string, passwordSource = 'user'): Promise<boolean> {
  if (!password || Buffer.byteLength(password) > 1024) return false
  if (passwordSource === 'env') {
    return verifyPassword(password)
  }
  const parts = (storedHash || '').split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, salt, hex] = parts
  const expected = Buffer.from(hex, 'hex')
  if (expected.length !== 32) return false
  const actual = await deriveKey(password, salt, 32) as Buffer
  return timingSafeEqual(actual, expected)
}

/** 生成团队开放 API Key（仅创建时返回一次明文，库内只存 SHA-256） */
export function generateTeamApiKey() {
  const raw = `hb-live-${randomBytes(24).toString('base64url')}`
  const hash = hashToken(raw)
  const prefix = `${raw.slice(0, 12)}...${raw.slice(-4)}`
  return { raw, hash, prefix }
}

function purgeExpiredSessions(nowMs = Date.now()) {
  db.delete(schema.userSessions).where(lt(schema.userSessions.expiresAt, nowMs)).run()
}

function resolveDefaultAdmin(): { userId: number; teamId: number | null } {
  const admin = db.select().from(schema.users).where(eq(schema.users.isSuperAdmin, true)).get()
    || db.select().from(schema.users).get()
  if (!admin) throw new Error('系统尚未初始化管理员账号')
  return { userId: admin.id, teamId: admin.currentTeamId }
}

export function createSession(userId?: number, activeTeamId?: number | null) {
  const nowMs = Date.now()
  purgeExpiredSessions(nowMs)

  // 限制总会话上限防止异常堆积（淘汰最早过期的会话）
  const totalRow = sqlite.prepare('SELECT COUNT(*) AS c FROM user_sessions').get() as { c: number }
  if (totalRow.c >= 500) {
    sqlite.prepare('DELETE FROM user_sessions WHERE token_hash IN (SELECT token_hash FROM user_sessions ORDER BY expires_at ASC LIMIT 50)').run()
  }

  const target = userId ? { userId, teamId: activeTeamId ?? null } : resolveDefaultAdmin()
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  db.insert(schema.userSessions).values({
    tokenHash,
    userId: target.userId,
    activeTeamId: target.teamId,
    expiresAt: nowMs + SESSION_TTL_MS,
    createdAt: now(),
  }).run()
  return token
}

export function sessionCookie(token: string) {
  return {
    name: COOKIE,
    value: token,
    options: {
      httpOnly: true,
      sameSite: 'Lax' as const,
      secure: process.env.AUTH_COOKIE_SECURE !== 'false' && (process.env.AUTH_COOKIE_SECURE === 'true' || process.env.PUBLIC_BASE_URL?.startsWith('https://') === true),
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    },
  }
}

export function destroySession(token: string | undefined) {
  if (!token) return
  db.delete(schema.userSessions).where(eq(schema.userSessions.tokenHash, hashToken(token))).run()
}

export function destroyUserSessions(userId: number) {
  db.delete(schema.userSessions).where(eq(schema.userSessions.userId, userId)).run()
}

export function switchSessionTeam(token: string | undefined, userId: number, teamId: number) {
  const member = db.select().from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)))
    .get()
  if (!member) throw new Error('您不是该团队的成员')
  db.update(schema.users).set({ currentTeamId: teamId, updatedAt: now() }).where(eq(schema.users.id, userId)).run()
  if (token) {
    db.update(schema.userSessions)
      .set({ activeTeamId: teamId })
      .where(eq(schema.userSessions.tokenHash, hashToken(token)))
      .run()
  }
}

function resolveActorForUser(
  userRow: typeof schema.users.$inferSelect,
  preferredTeamId: number | null | undefined,
  authMethod: 'session' | 'api_key',
  sessionTokenHash?: string,
): ActorContext | null {
  if (!userRow.isActive) return null

  const memberships = db.select().from(schema.teamMembers)
    .where(eq(schema.teamMembers.userId, userRow.id))
    .all()
  if (!memberships.length) return null

  const targetIds = [preferredTeamId, userRow.currentTeamId, memberships[0].teamId].filter((v): v is number => Number.isInteger(v) && Number(v) > 0)
  let chosenMembership = memberships[0]
  let chosenTeam: typeof schema.teams.$inferSelect | undefined

  for (const tid of targetIds) {
    const m = memberships.find(item => item.teamId === tid)
    if (!m) continue
    const t = db.select().from(schema.teams).where(eq(schema.teams.id, tid)).get()
    if (t) {
      chosenMembership = m
      chosenTeam = t
      break
    }
  }

  if (!chosenTeam) {
    for (const m of memberships) {
      const t = db.select().from(schema.teams).where(eq(schema.teams.id, m.teamId)).get()
      if (t) {
        chosenMembership = m
        chosenTeam = t
        break
      }
    }
  }
  if (!chosenTeam) return null

  return {
    user: {
      id: userRow.id,
      username: userRow.username,
      displayName: userRow.displayName,
      isSuperAdmin: Boolean(userRow.isSuperAdmin),
      currentTeamId: chosenTeam.id,
    },
    team: chosenTeam,
    membership: chosenMembership,
    authMethod,
    sessionTokenHash,
  }
}

export function resolveActorFromSession(token: string | undefined, requestedTeamId?: number | null): ActorContext | null {
  if (!token) return null
  const nowMs = Date.now()
  purgeExpiredSessions(nowMs)
  const tokenHash = hashToken(token)
  const session = db.select().from(schema.userSessions).where(eq(schema.userSessions.tokenHash, tokenHash)).get()
  if (!session || session.expiresAt <= nowMs) return null

  const userRow = db.select().from(schema.users).where(eq(schema.users.id, session.userId)).get()
  if (!userRow) return null

  const preferredTeam = requestedTeamId && Number.isSafeInteger(requestedTeamId) && requestedTeamId > 0
    ? requestedTeamId
    : session.activeTeamId
  return resolveActorForUser(userRow, preferredTeam, 'session', tokenHash)
}

export function resolveActorFromApiKey(authHeader: string | undefined): ActorContext | null {
  if (!authHeader) return null
  const match = /^Bearer\s+(hb-live-[A-Za-z0-9_-]{16,128})$/.exec(authHeader.trim())
  if (!match) return null
  const keyHash = hashToken(match[1])
  const team = db.select().from(schema.teams).where(eq(schema.teams.apiKeyHash, keyHash)).get()
  if (!team) return null
  const owner = db.select().from(schema.users).where(eq(schema.users.id, team.ownerId)).get()
  if (!owner || !owner.isActive) return null
  const membership = db.select().from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, team.id), eq(schema.teamMembers.userId, owner.id)))
    .get()
  if (!membership) return null
  return {
    user: {
      id: owner.id,
      username: owner.username,
      displayName: owner.displayName,
      isSuperAdmin: Boolean(owner.isSuperAdmin),
      currentTeamId: team.id,
    },
    team,
    membership,
    authMethod: 'api_key',
  }
}

function parseRequestedTeamHeader(c: Context): number | null {
  const raw = c.req.header('x-team-id')
  if (!raw) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

const PUBLIC_API_PATHS = new Set([
  '/api/v1/health',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/status',
  '/api/v1/auth/invite-info',
])

/** 只拦 API。静态资源和前端 HTML 不受影响。 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!authEnabled()) return next()
  c.header('Cache-Control', 'no-store')
  c.header('Vary', 'Cookie', { append: true })
  if (c.req.method === 'OPTIONS') return next()

  const authHeader = c.req.header('authorization')
  const apiKeyActor = resolveActorFromApiKey(authHeader)
  if (apiKeyActor) {
    return runWithActor(apiKeyActor, () => next())
  }

  // CORS alone does not prevent cross-origin writes when authenticating with cookies.
  // Never trust proxy headers supplied by callers; PUBLIC_BASE_URL is the explicit reverse-proxy origin.
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    const origin = c.req.header('origin')
    const allowed = new Set([new URL(c.req.url).origin])
    if (process.env.PUBLIC_BASE_URL) allowed.add(new URL(process.env.PUBLIC_BASE_URL).origin)
    if (c.req.header('sec-fetch-site') === 'cross-site' || (origin && !allowed.has(origin))) {
      return c.json({ code: 403, message: '不允许跨站请求' }, 403)
    }
  }

  const path = c.req.path
  if (PUBLIC_API_PATHS.has(path)) return next()

  const actor = resolveActorFromSession(getCookie(c, COOKIE), parseRequestedTeamHeader(c))
  if (!actor) {
    return c.json({ code: 401, message: '未登录或会话已失效' }, 401)
  }
  return runWithActor(actor, () => next())
}

/** 未登录访问页面时返回登录页，而不是把整个工作台发给公网。 */
export const requirePageAuth: MiddlewareHandler = async (c, next) => {
  if (!authEnabled()) return next()
  c.header('Cache-Control', 'no-store')
  c.header('Vary', 'Cookie', { append: true })
  if (c.req.path === '/login') return next()
  if (resolveActorFromSession(getCookie(c, COOKIE))) return next()
  return c.redirect('/login')
}

export function clearSessionCookie(c: Parameters<typeof deleteCookie>[0]) {
  deleteCookie(c, COOKIE, { path: '/' })
}

export function writeSessionCookie(c: Parameters<typeof setCookie>[0], token: string) {
  const cookie = sessionCookie(token)
  setCookie(c, cookie.name, cookie.value, cookie.options)
}
