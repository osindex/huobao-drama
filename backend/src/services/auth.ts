/**
 * 单用户登录。仅在 AUTH_PASSWORD 配置时生效：
 * - 保护 /api/v1（health 与登录接口除外）和前端页面
 * - 不保护 /static：上游视频服务需要用 PUBLIC_BASE_URL 拉取本地参考图
 * 密码由部署环境提供，不写入数据库/代码；异步 scrypt 比较，会话仅存于内存。
 */
import { randomBytes, scrypt, timingSafeEqual } from 'crypto'
import { promisify } from 'node:util'
import type { MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

const COOKIE = 'huobao_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

interface Session {
  expiresAt: number
}

const sessions = new Map<string, Session>()
const deriveKey = promisify(scrypt)

export function authEnabled() {
  return Boolean(process.env.AUTH_PASSWORD)
}

async function passwordKey(password: string) {
  const salt = process.env.AUTH_PASSWORD_SALT || 'huobao-local-auth'
  return await deriveKey(password, salt, 32) as Buffer
}

export async function verifyPassword(password: string) {
  const expected = process.env.AUTH_PASSWORD || ''
  if (!expected || !password || Buffer.byteLength(password) > 1024) return false
  const [actual, wanted] = await Promise.all([passwordKey(password), passwordKey(expected)])
  return timingSafeEqual(actual, wanted)
}

function purgeExpired(now = Date.now()) {
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token)
  }
}

export function createSession() {
  purgeExpired()
  if (sessions.size >= 100) sessions.delete(sessions.keys().next().value!)
  const token = randomBytes(32).toString('base64url')
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS })
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

function validSession(token: string | undefined) {
  if (!token) return false
  purgeExpired()
  const session = sessions.get(token)
  return Boolean(session && session.expiresAt > Date.now())
}

export function destroySession(token: string | undefined) {
  if (token) sessions.delete(token)
}

/** 只拦 API。静态资源和前端 HTML 不受影响。 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!authEnabled()) return next()
  c.header('Cache-Control', 'no-store')
  c.header('Vary', 'Cookie', { append: true })
  if (c.req.method === 'OPTIONS') return next()
  // CORS alone does not prevent cross-origin writes. Never trust proxy headers
  // supplied by callers; PUBLIC_BASE_URL is the explicit reverse-proxy origin.
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    const origin = c.req.header('origin')
    const allowed = new Set([new URL(c.req.url).origin])
    if (process.env.PUBLIC_BASE_URL) allowed.add(new URL(process.env.PUBLIC_BASE_URL).origin)
    if (c.req.header('sec-fetch-site') === 'cross-site' || (origin && !allowed.has(origin))) {
      return c.json({ code: 403, message: '不允许跨站请求' }, 403)
    }
  }
  const path = c.req.path
  if (path === '/api/v1/health' || path === '/api/v1/auth/login' || path === '/api/v1/auth/status') return next()
  if (!validSession(getCookie(c, COOKIE))) {
    return c.json({ code: 401, message: '未登录' }, 401)
  }
  await next()
}

/** 未登录访问页面时返回登录页，而不是把整个工作台发给公网。 */
export const requirePageAuth: MiddlewareHandler = async (c, next) => {
  if (!authEnabled()) return next()
  c.header('Cache-Control', 'no-store')
  c.header('Vary', 'Cookie', { append: true })
  if (c.req.path === '/login') return next()
  if (validSession(getCookie(c, COOKIE))) return next()
  return c.redirect('/login')
}

export function clearSessionCookie(c: Parameters<typeof deleteCookie>[0]) {
  deleteCookie(c, COOKIE, { path: '/' })
}

export function writeSessionCookie(c: Parameters<typeof setCookie>[0], token: string) {
  const cookie = sessionCookie(token)
  setCookie(c, cookie.name, cookie.value, cookie.options)
}
