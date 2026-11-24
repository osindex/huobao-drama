import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'huobao-multitenant-'))
process.env.SQLITE_PATH = path.join(root, 'multitenant.sqlite3')
process.env.HUOBAO_DATA_DIR = root
process.env.STORAGE_PATH = path.join(root, 'static')
process.env.MYSQL_AUTO_IMPORT = 'false'
process.env.AUTH_PASSWORD = 'admin-boot-password'

const { db, schema, sqlite } = await import('../src/db/index.js')
const { requireAuth } = await import('../src/services/auth.js')
const {
  freezeCreditsInTx,
  refundTaskCredits,
  settleTaskCredits,
  completeRechargeOrder,
} = await import('../src/services/billing.js')
const authRoute = (await import('../src/routes/auth.js')).default
const teamsRoute = (await import('../src/routes/teams.js')).default
const billingRoute = (await import('../src/routes/billing.js')).default
const adminRoute = (await import('../src/routes/admin.js')).default
const dramasRoute = (await import('../src/routes/dramas.js')).default
const aiConfigsRoute = (await import('../src/routes/aiConfigs.js')).default

function buildTestApp() {
  const app = new Hono()
  app.use('/api/*', requireAuth)
  const api = new Hono()
  api.route('/auth', authRoute)
  api.route('/teams', teamsRoute)
  api.route('/billing', billingRoute)
  api.route('/admin', adminRoute)
  api.route('/dramas', dramasRoute)
  api.route('/ai-configs', aiConfigsRoute)
  app.route('/api/v1', api)
  return app
}

function extractCookie(res: Response): string {
  const raw = res.headers.get('set-cookie') || ''
  return raw.split(';')[0] || ''
}

async function jsonReq(
  app: Hono,
  method: string,
  url: string,
  opts: { cookie?: string; token?: string; teamId?: number; body?: unknown } = {},
) {
  const headers: Record<string, string> = {}
  if (opts.cookie) headers.Cookie = opts.cookie
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  if (opts.teamId) headers['X-Team-Id'] = String(opts.teamId)
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await app.request(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json, res }
}

test('multi-tenant registration, multi-team switching, visibility modes, drama sharing, BYOK SSRF guard, and credit billing', async () => {
  const app = buildTestApp()

  // 1. Super-admin bootstrap login with env password
  const adminLogin = await jsonReq(app, 'POST', '/api/v1/auth/login', {
    body: { password: 'admin-boot-password' },
  })
  assert.equal(adminLogin.status, 200)
  const adminCookie = extractCookie(adminLogin.res)
  assert.match(adminCookie, /^huobao_session=/)

  // 2. Open self-registration creates user + personal workspace + bonus credits
  const aliceReg = await jsonReq(app, 'POST', '/api/v1/auth/register', {
    body: { username: 'alice', display_name: 'Alice', password: 'alice-password' },
  })
  assert.equal(aliceReg.status, 200)
  const aliceCookie = extractCookie(aliceReg.res)
  const alicePersonalTeamId = aliceReg.json.data.team_id as number

  const aliceStatus = await jsonReq(app, 'GET', '/api/v1/auth/status', { cookie: aliceCookie })
  assert.equal(aliceStatus.status, 200)
  assert.equal(aliceStatus.json.data.user.username, 'alice')
  assert.equal(aliceStatus.json.data.current_team.credit_balance, 200)

  // 3. Alice creates a studio team with creator_only visibility and invites Bob + Viewer
  const createStudio = await jsonReq(app, 'POST', '/api/v1/teams', {
    cookie: aliceCookie,
    body: { name: 'Alice Studio', description: '短剧制作组', project_visibility: 'creator_only' },
  })
  assert.equal(createStudio.status, 201)
  const studioTeamId = createStudio.json.data.id as number
  assert.notEqual(studioTeamId, alicePersonalTeamId)

  const inviteBob = await jsonReq(app, 'POST', '/api/v1/teams/current/invitations', {
    cookie: aliceCookie,
    body: { role: 'member', max_uses: 1, credit_limit: 50 },
  })
  assert.equal(inviteBob.status, 201)
  const bobInviteCode = inviteBob.json.data.code as string

  const inviteInfo = await jsonReq(app, 'GET', `/api/v1/auth/invite-info?code=${bobInviteCode}`)
  assert.equal(inviteInfo.json.data.valid, true)
  assert.equal(inviteInfo.json.data.team_name, 'Alice Studio')

  // Bob registers via invite code — belongs to BOTH his personal space and Alice Studio (many-to-many)
  const bobReg = await jsonReq(app, 'POST', '/api/v1/auth/register', {
    body: { username: 'bob', display_name: 'Bob', password: 'bob-password', invite_code: bobInviteCode },
  })
  assert.equal(bobReg.status, 200)
  assert.equal(bobReg.json.data.team_id, studioTeamId)
  const bobCookie = extractCookie(bobReg.res)

  const bobTeams = await jsonReq(app, 'GET', '/api/v1/teams', { cookie: bobCookie })
  assert.equal(bobTeams.json.data.length, 2)

  // Exhausted invite code cannot be used again
  const reuseCheck = await jsonReq(app, 'GET', `/api/v1/auth/invite-info?code=${bobInviteCode}`)
  assert.equal(reuseCheck.json.data.valid, false)

  // Add viewer Carol
  const carolReg = await jsonReq(app, 'POST', '/api/v1/auth/register', {
    body: { username: 'carol', display_name: 'Carol', password: 'carol-password' },
  })
  const carolCookie = extractCookie(carolReg.res)

  const addCarol = await jsonReq(app, 'POST', '/api/v1/teams/current/members', {
    cookie: aliceCookie,
    body: { username: 'carol', role: 'viewer' },
  })
  assert.equal(addCarol.status, 201)
  await jsonReq(app, 'POST', '/api/v1/teams/switch', { cookie: carolCookie, body: { team_id: studioTeamId } })

  // 4. Visibility isolation inside creator_only team + explicit per-drama share + cross-team 404
  const aliceDrama = await jsonReq(app, 'POST', '/api/v1/dramas', {
    cookie: aliceCookie,
    body: { title: 'Alice 机密项目' },
  })
  assert.equal(aliceDrama.status, 201)
  const aliceDramaId = aliceDrama.json.data.id as number

  // Bob is a member in creator_only team -> cannot see Alice's unshared drama
  const bobListBefore = await jsonReq(app, 'GET', '/api/v1/dramas', { cookie: bobCookie })
  assert.equal(bobListBefore.json.data.items.length, 0)
  const bobDirectRead = await jsonReq(app, 'GET', `/api/v1/dramas/${aliceDramaId}`, { cookie: bobCookie })
  assert.equal(bobDirectRead.status, 404)

  // Alice shares the drama with Bob as view-only first
  const shareToBob = await jsonReq(app, 'POST', `/api/v1/dramas/${aliceDramaId}/shares`, {
    cookie: aliceCookie,
    body: { user_id: bobReg.json.data.user_id, permission: 'view' },
  })
  assert.equal(shareToBob.status, 200)
  assert.equal((await jsonReq(app, 'GET', `/api/v1/dramas/${aliceDramaId}`, { cookie: bobCookie })).status, 200)
  assert.equal(
    (await jsonReq(app, 'PUT', `/api/v1/dramas/${aliceDramaId}`, { cookie: bobCookie, body: { title: '篡改' } })).status,
    403,
  )

  // Team admin switches team visibility to team_shared -> Carol (viewer) can read, but cannot write
  await jsonReq(app, 'PUT', '/api/v1/teams/current', {
    cookie: aliceCookie,
    body: { project_visibility: 'team_shared' },
  })
  assert.equal((await jsonReq(app, 'GET', `/api/v1/dramas/${aliceDramaId}`, { cookie: carolCookie })).status, 200)
  assert.equal(
    (await jsonReq(app, 'POST', '/api/v1/dramas', { cookie: carolCookie, body: { title: 'Carol 越权创建' } })).status,
    403,
  )

  // Cross-team isolation: Super-admin in default team #1 gets 404 on studioTeam's drama unless switched
  assert.equal((await jsonReq(app, 'GET', `/api/v1/dramas/${aliceDramaId}`, { cookie: adminCookie })).status, 404)

  // 5. Redeem code batch -> team redeem -> online order pending + completion -> programmatic Team API Key
  const genCodes = await jsonReq(app, 'POST', '/api/v1/admin/redeem-codes', {
    cookie: adminCookie,
    body: { count: 2, credits: 500, batch_note: '测试卡密' },
  })
  assert.equal(genCodes.status, 201)
  const code1 = genCodes.json.data.codes[0] as string

  const redeem1 = await jsonReq(app, 'POST', '/api/v1/billing/redeem', {
    cookie: aliceCookie,
    body: { code: code1 },
  })
  assert.equal(redeem1.status, 200)
  assert.equal(redeem1.json.data.credit_balance, 500)

  // Duplicate redemption must fail
  const redeemDup = await jsonReq(app, 'POST', '/api/v1/billing/redeem', {
    cookie: aliceCookie,
    body: { code: code1 },
  })
  assert.equal(redeemDup.status, 400)

  // Pending online order + idempotent webhook/manual completion
  const pkgs = await jsonReq(app, 'GET', '/api/v1/billing/packages', { cookie: aliceCookie })
  assert.ok(pkgs.json.data.length > 0)
  const orderRes = await jsonReq(app, 'POST', '/api/v1/billing/orders', {
    cookie: aliceCookie,
    body: { package_id: pkgs.json.data[0].id, payment_channel: 'alipay_pending' },
  })
  assert.equal(orderRes.status, 201)
  const orderNo = orderRes.json.data.order_no as string
  const paid1 = completeRechargeOrder(orderNo, 'TRADE_001')
  const paid2 = completeRechargeOrder(orderNo, 'TRADE_001')
  assert.equal(paid1.alreadyPaid, false)
  assert.equal(paid2.alreadyPaid, true)

  const walletAfterOrder = await jsonReq(app, 'GET', '/api/v1/billing/wallet', { cookie: aliceCookie })
  const expectedBalance = 500 + pkgs.json.data[0].credits + pkgs.json.data[0].bonus_credits
  assert.equal(walletAfterOrder.json.data.credit_balance, expectedBalance)

  // 6. Async task freeze -> member credit_limit check -> settle & refund
  const ts = new Date().toISOString()
  const bobUserId = bobReg.json.data.user_id as number

  // Default video rule is 10 credits/s => 6s = 60 credits, exceeding Bob's credit_limit of 50
  assert.throws(() => {
    sqlite.transaction(() => {
      const taskRes = db.insert(schema.sysTask).values({
        teamId: studioTeamId,
        userId: bobUserId,
        type: 'video',
        status: 'processing',
        createdAt: ts,
        updatedAt: ts,
      }).run()
      freezeCreditsInTx({
        taskId: Number(taskRes.lastInsertRowid),
        teamId: studioTeamId,
        userId: bobUserId,
        serviceType: 'video',
        provider: 'grok',
        duration: 6,
        description: '超限测试',
      })
    })()
  }, /个人算力限额/)

  let task1Id = 0
  let task2Id = 0
  let frozen1 = 0
  sqlite.transaction(() => {
    const r1 = db.insert(schema.sysTask).values({
      teamId: studioTeamId,
      userId: bobUserId,
      type: 'video',
      status: 'processing',
      createdAt: ts,
      updatedAt: ts,
    }).run()
    task1Id = Number(r1.lastInsertRowid)
    frozen1 = freezeCreditsInTx({
      taskId: task1Id,
      teamId: studioTeamId,
      userId: bobUserId,
      serviceType: 'video',
      provider: 'comfyui',
      duration: 5,
      description: '任务1',
    })

    const r2 = db.insert(schema.sysTask).values({
      teamId: studioTeamId,
      userId: bobUserId,
      type: 'image',
      status: 'processing',
      createdAt: ts,
      updatedAt: ts,
    }).run()
    task2Id = Number(r2.lastInsertRowid)
    freezeCreditsInTx({
      taskId: task2Id,
      teamId: studioTeamId,
      userId: bobUserId,
      serviceType: 'image',
      provider: 'openai',
      description: '任务2',
    })
  })()

  assert.ok(frozen1 > 0)
  settleTaskCredits(task1Id)
  refundTaskCredits(task2Id, '生成失败自动退回')

  const walletFinal = await jsonReq(app, 'GET', '/api/v1/billing/wallet', { cookie: bobCookie })
  assert.equal(walletFinal.json.data.credit_balance, expectedBalance - frozen1)
  assert.equal(walletFinal.json.data.frozen_credits, 0)
  assert.equal(walletFinal.json.data.member_credit_used, frozen1)

  // 7. Team API Key programmatic access & BYOK SSRF guard
  const genKey = await jsonReq(app, 'POST', '/api/v1/teams/current/api-key', { cookie: aliceCookie })
  assert.equal(genKey.status, 200)
  const rawApiKey = genKey.json.data.api_key as string
  assert.match(rawApiKey, /^hb-live-/)

  const apiKeyDramas = await jsonReq(app, 'GET', '/api/v1/dramas', { token: rawApiKey })
  assert.equal(apiKeyDramas.status, 200)
  assert.equal(apiKeyDramas.json.data.items.length, 1)

  const ssrfAttempt = await jsonReq(app, 'POST', '/api/v1/ai-configs', {
    cookie: aliceCookie,
    body: {
      service_type: 'text',
      provider: 'openai',
      name: 'SSRF',
      base_url: 'http://192.168.110.201:8188',
      api_key: 'sk-x',
      model: ['gpt-4o'],
    },
  })
  assert.equal(ssrfAttempt.status, 400)

  const comfyAttempt = await jsonReq(app, 'POST', '/api/v1/ai-configs', {
    cookie: aliceCookie,
    body: {
      service_type: 'image',
      provider: 'comfyui',
      name: 'LocalNode',
      base_url: 'https://example.com',
      model: ['qwen-image-2512'],
    },
  })
  assert.equal(comfyAttempt.status, 400)

  const validByok = await jsonReq(app, 'POST', '/api/v1/ai-configs', {
    cookie: aliceCookie,
    body: {
      service_type: 'text',
      provider: 'openai',
      name: 'Team Own Relay',
      base_url: 'https://api.openai.com',
      api_key: 'sk-team-secret',
      model: ['gpt-4o-mini'],
    },
  })
  assert.equal(validByok.status, 201)
  assert.equal(validByok.json.data.scope, 'team')
  assert.equal(validByok.json.data.is_byok, true)

  const adminCfgList = await jsonReq(app, 'GET', '/api/v1/ai-configs', { cookie: adminCookie })
  assert.ok(!adminCfgList.json.data.some((c: any) => c.id === validByok.json.data.id))
})

test.after(async () => {
  sqlite.close()
  await fs.rm(root, { recursive: true, force: true })
})
