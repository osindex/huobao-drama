import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'huobao-auth-test-'))
process.env.SQLITE_PATH = path.join(root, 'auth.sqlite3')
process.env.HUOBAO_DATA_DIR = root
process.env.STORAGE_PATH = path.join(root, 'static')
process.env.MYSQL_AUTO_IMPORT = 'false'

const { sqlite } = await import('../src/db/index.js')
const auth = (await import('../src/routes/auth.js')).default
const { requestLogger } = await import('../src/middleware/logger.js')
const { createSession, requireAuth, requirePageAuth, sessionCookie, verifyPassword } = await import('../src/services/auth.js')

function app() {
  const api = new Hono()
  api.use('/api/*', requireAuth)
  api.get('/api/v1/health', c => c.json({ status: 'ok' }))
  api.route('/api/v1/auth', auth)
  api.get('/api/v1/dramas', c => c.json({ secret: true }))
  api.get('/static/uploads/ref.png', c => c.text('image'))
  api.use('*', requirePageAuth)
  api.get('/', c => c.text('app'))
  return api
}

test('auth stays off unless a password is configured', async () => {
  delete process.env.AUTH_PASSWORD
  const api = app()
  assert.equal((await api.request('/api/v1/dramas')).status, 200)
  assert.equal((await api.request('/')).status, 200)
})

test('password protects pages and api but leaves static media public', async () => {
  process.env.AUTH_PASSWORD = 'test-password'
  process.env.AUTH_PASSWORD_SALT = 'test-salt'
  try {
    assert.equal(await verifyPassword('test-password'), true)
    assert.equal(await verifyPassword('wrong'), false)
    const api = app()

    assert.equal((await api.request('/api/v1/health')).status, 200)
    assert.equal((await api.request('/static/uploads/ref.png')).status, 200)
    assert.equal((await api.request('/api/v1/dramas')).status, 401)
    assert.equal((await api.request('/')).status, 302)
    assert.equal((await api.request('/')).headers.get('location'), '/login')

    const token = createSession()
    const cookie = sessionCookie(token)
    assert.equal(cookie.options.httpOnly, true)
    const authed = await api.request('/api/v1/dramas', { headers: { cookie: `${cookie.name}=${token}` } })
    assert.equal(authed.status, 200)
    const page = await api.request('/', { headers: { cookie: `${cookie.name}=${token}` } })
    assert.equal(page.status, 200)

    const expired = await api.request('/api/v1/dramas', { headers: { cookie: `${cookie.name}=nope` } })
    assert.equal(expired.status, 401)
  } finally {
    delete process.env.AUTH_PASSWORD
    delete process.env.AUTH_PASSWORD_SALT
  }
})

test('real login/logout, CSRF, expiry, body limits, throttling and secret-free logs', async () => {
  process.env.AUTH_PASSWORD = 'test-password'
  process.env.PUBLIC_BASE_URL = 'https://studio.example'
  process.env.AUTH_COOKIE_SECURE = 'true'
  const logs: string[] = []
  const originalLog = console.log
  const originalNow = Date.now
  console.log = (...args) => { logs.push(args.join(' ')) }
  try {
    const server = new Hono()
    server.use('*', requestLogger)
    server.route('/', app())
    const login = (password: unknown, headers: Record<string, string> = {}) => server.request('/api/v1/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ password }),
    })
    assert.equal((await login('test-password', { origin: 'https://evil.example' })).status, 403)
    assert.equal((await login('test-password', { 'sec-fetch-site': 'cross-site' })).status, 403)
    assert.equal((await login('x'.repeat(3000))).status, 413)
    assert.equal((await login(null)).status, 401)
    assert.equal((await login('wrong')).status, 401)
    const response = await login('test-password', { origin: 'https://studio.example' })
    assert.equal(response.status, 200)
    const setCookie = response.headers.get('set-cookie')!
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(setCookie.includes(flag))
    const cookie = setCookie.split(';')[0]!
    assert.equal((await server.request('/api/v1/dramas', { headers: { cookie } })).status, 200)
    assert.equal((await server.request('/api/v1/auth/logout', { method: 'POST', headers: { cookie, origin: 'https://evil.example' } })).status, 403)
    assert.equal((await server.request('/api/v1/auth/logout', { method: 'POST', headers: { cookie } })).status, 200)
    assert.equal((await server.request('/api/v1/dramas', { headers: { cookie } })).status, 401)
    assert.equal((await server.request('/login.html')).status, 302)
    const expiring = createSession()
    Date.now = () => originalNow() + 31 * 24 * 60 * 60 * 1000
    assert.equal((await server.request('/api/v1/dramas', { headers: { cookie: `huobao_session=${expiring}` } })).status, 401)
    Date.now = originalNow
    for (let i = 0; i < 7; i++) assert.equal((await login('wrong')).status, 401)
    const limited = await login('wrong', { 'x-forwarded-for': '1.2.3.4' })
    assert.equal(limited.status, 429)
    assert.ok(limited.headers.get('retry-after'))
    assert.equal(logs.some(line => line.includes('test-password')), false)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  } finally {
    console.log = originalLog
    Date.now = originalNow
    delete process.env.AUTH_PASSWORD
    delete process.env.AUTH_COOKIE_SECURE
    delete process.env.PUBLIC_BASE_URL
  }
})

test('login page treats real success responses as success and real errors as failure', async () => {
  process.env.AUTH_PASSWORD = 'test-password'
  // 上一个用例故意打满了登录限流；跳到限流窗口之后
  const originalNow = Date.now
  Date.now = () => originalNow() + 61_000
  try {
    const html = await fs.readFile(new URL('../src/login.html', import.meta.url), 'utf8')
    const source = /function apiFailed\(resp, json\) \{[\s\S]*?\n    \}/.exec(html)?.[0]
    assert.ok(source, 'login.html must define apiFailed(resp, json)')
    const apiFailed = new Function(`${source}; return apiFailed`)() as (resp: Response, json: unknown) => boolean
    // 三处提交（登录 / 注册 / 接受邀请）必须都走同一判断
    assert.equal(html.match(/if \(apiFailed\(resp, json\)\)/g)?.length, 3)

    const api = app()
    const post = (url: string, body: unknown) => api.request(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })

    const registered = await post('/api/v1/auth/register', { username: 'login_page_user', password: 'secret-pass' })
    const registeredJson = await registered.json()
    assert.equal(registered.status, 200)
    assert.equal(registeredJson.message, 'success')
    assert.equal(apiFailed(registered, registeredJson), false)
    assert.ok(registered.headers.get('set-cookie'))

    const loggedIn = await post('/api/v1/auth/login', { username: 'login_page_user', password: 'secret-pass' })
    assert.equal(apiFailed(loggedIn, await loggedIn.json()), false)

    const duplicate = await post('/api/v1/auth/register', { username: 'login_page_user', password: 'secret-pass' })
    assert.equal(apiFailed(duplicate, await duplicate.json()), true)
    const wrong = await post('/api/v1/auth/login', { username: 'login_page_user', password: 'nope' })
    assert.equal(apiFailed(wrong, await wrong.json()), true)

    assert.equal(apiFailed(new Response('', { status: 200 }), {}), false)
    assert.equal(apiFailed(new Response('', { status: 200 }), { code: 500, message: 'x' }), true)
  } finally {
    Date.now = originalNow
    delete process.env.AUTH_PASSWORD
  }
})

test.after(async () => {
  sqlite.close()
  await fs.rm(root, { recursive: true, force: true })
})
