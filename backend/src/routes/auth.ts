import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie } from 'hono/cookie'
import { authEnabled, clearSessionCookie, createSession, destroySession, verifyPassword, writeSessionCookie } from '../services/auth.js'
import { badRequest, success } from '../utils/response.js'

const app = new Hono()
// Global single-user budget: cannot be bypassed by spoofing X-Forwarded-For.
let attempts = 0
let resetAt = 0
let verifying = false

app.get('/status', (c) => success(c, { enabled: authEnabled() }))

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
    if (!await verifyPassword(password)) return c.json({ code: 401, message: '密码错误' }, 401)
    destroySession(getCookie(c, 'huobao_session'))
    writeSessionCookie(c, createSession())
    return success(c, { ok: true })
  } finally { verifying = false }
})

app.post('/logout', (c) => {
  destroySession(getCookie(c, 'huobao_session'))
  clearSessionCookie(c)
  return success(c, { ok: true })
})

export default app
