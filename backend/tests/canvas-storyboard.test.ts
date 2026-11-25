import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Hono } from 'hono'

const execFileAsync = promisify(execFile)

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'huobao-canvas-'))
process.env.SQLITE_PATH = path.join(root, 'canvas.sqlite3')
process.env.HUOBAO_DATA_DIR = root
process.env.STORAGE_PATH = path.join(root, 'static')
process.env.MYSQL_AUTO_IMPORT = 'false'
process.env.AUTH_PASSWORD = 'admin-boot-password'

await import('../src/db/index.js')
const { requireAuth } = await import('../src/services/auth.js')
const { ffmpeg, checkFfmpegSuite } = await import('../src/utils/ffmpeg.js')
const authRoute = (await import('../src/routes/auth.js')).default
const dramasRoute = (await import('../src/routes/dramas.js')).default
const episodesRoute = (await import('../src/routes/episodes.js')).default
const storyboardsRoute = (await import('../src/routes/storyboards.js')).default
const tasksRoute = (await import('../src/routes/tasks.js')).default
const aiConfigsRoute = (await import('../src/routes/aiConfigs.js')).default

const {
  getVideoKeyframeCapability,
  buildVideoKeyframePayload,
  aspectRatioToImageSize,
  buildStoryboardKeyframePrompt,
} = await import('../../frontend/app/components/canvas/keyframeCapabilities.ts')

function buildTestApp() {
  const app = new Hono()
  app.use('/api/*', requireAuth)
  const api = new Hono()
  api.route('/auth', authRoute)
  api.route('/dramas', dramasRoute)
  api.route('/episodes', episodesRoute)
  api.route('/storyboards', storyboardsRoute)
  api.route('/tasks', tasksRoute)
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
  opts: { cookie?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {}
  if (opts.cookie) headers.Cookie = opts.cookie
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await app.request(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json, res }
}

test('canvas state CRUD, storyboard keyframe slot guards, FFmpeg tail-frame relay, and comfyui 3-ref cap', async () => {
  const app = buildTestApp()

  const loginRes = await jsonReq(app, 'POST', '/api/v1/auth/login', {
    body: { username: 'admin', password: 'admin-boot-password' },
  })
  assert.equal(loginRes.status, 200)
  const cookie = extractCookie(loginRes.res)
  assert.ok(cookie.includes('huobao_session='))

  // Seed active image + video AI configs in test DB first (required by POST /episodes)
  const imgCfgRes = await jsonReq(app, 'POST', '/api/v1/ai-configs', {
    cookie,
    body: {
      service_type: 'image',
      name: 'Local Comfy Image',
      provider: 'comfyui',
      base_url: 'http://127.0.0.1:59999',
      api_key: 'none',
      model: ['qwen-image-edit'],
      is_active: true,
      priority: 100,
    },
  })
  assert.equal(imgCfgRes.status, 201)
  const comfyImgCfgId = imgCfgRes.json.data.id

  const vidCfgRes = await jsonReq(app, 'POST', '/api/v1/ai-configs', {
    cookie,
    body: {
      service_type: 'video',
      name: 'Local Comfy Video',
      provider: 'comfyui',
      base_url: 'http://127.0.0.1:59998',
      api_key: 'none',
      model: ['wan2.2-i2v'],
      is_active: true,
      priority: 100,
    },
  })
  assert.equal(vidCfgRes.status, 201)

  // Create drama + episode
  const dramaRes = await jsonReq(app, 'POST', '/api/v1/dramas', {
    cookie,
    body: { title: '画布分镜测试剧' },
  })
  assert.equal(dramaRes.status, 201)
  const dramaId = dramaRes.json.data.id

  const epCreateRes = await jsonReq(app, 'POST', '/api/v1/episodes', {
    cookie,
    body: { drama_id: dramaId, episode_number: 1, title: '第一集' },
  })
  assert.equal(epCreateRes.status, 200)
  const episodeId = epCreateRes.json.data.id

  // 1. Default canvas state is empty
  const emptyCanvas = await jsonReq(app, 'GET', `/api/v1/episodes/${episodeId}/canvas`, { cookie })
  assert.equal(emptyCanvas.status, 200)
  assert.deepEqual(emptyCanvas.json.data.nodes, {})
  assert.deepEqual(emptyCanvas.json.data.connections, [])

  // 2. Save canvas viewport + nodes + connections and read back
  const savedCanvas = await jsonReq(app, 'PUT', `/api/v1/episodes/${episodeId}/canvas`, {
    cookie,
    body: {
      viewport: { x: 240, y: 90, zoom: 0.9 },
      nodes: {
        'sb:1': { x: 0, y: 40 },
        'sticky-1': { id: 'sticky-1', kind: 'sticky', x: 100, y: -120, text: '注意冷色调逆光', color: '#fef08a' },
      },
      connections: [{ id: 'relay-1-2', fromSbId: 1, toSbId: 2, kind: 'tail_to_first' }],
    },
  })
  assert.equal(savedCanvas.status, 200)
  const readBackCanvas = await jsonReq(app, 'GET', `/api/v1/episodes/${episodeId}/canvas`, { cookie })
  assert.equal(readBackCanvas.status, 200)
  assert.equal(readBackCanvas.json.data.viewport.zoom, 0.9)
  assert.equal(readBackCanvas.json.data.connections.length, 1)
  assert.equal(readBackCanvas.json.data.nodes['sticky-1'].text, '注意冷色调逆光')

  // Reject oversized canvas state (>512KB)
  const hugeCanvas = await jsonReq(app, 'PUT', `/api/v1/episodes/${episodeId}/canvas`, {
    cookie,
    body: { nodes: { huge: 'x'.repeat(600 * 1024) } },
  })
  assert.equal(hugeCanvas.status, 400)

  // 3. Create two storyboards and test keyframe slot updates + path traversal protection
  const sb1Res = await jsonReq(app, 'POST', '/api/v1/storyboards', {
    cookie,
    body: { episode_id: episodeId, storyboard_number: 1, title: '镜头一', duration: 4, description: '女主推门进入书房' },
  })
  const sb2Res = await jsonReq(app, 'POST', '/api/v1/storyboards', {
    cookie,
    body: { episode_id: episodeId, storyboard_number: 2, title: '镜头二', duration: 4, description: '女主转身看向书桌' },
  })
  assert.equal(sb1Res.status, 201)
  assert.equal(sb2Res.status, 201)
  const sb1Id = sb1Res.json.data.id
  const sb2Id = sb2Res.json.data.id

  const getEpisodeSbs = async () => {
    const d = await jsonReq(app, 'GET', `/api/v1/episodes/${episodeId}/storyboards`, { cookie })
    return d.json.data as any[]
  }

  // Reject path traversal
  const badSlot = await jsonReq(app, 'PUT', `/api/v1/storyboards/${sb1Id}`, {
    cookie,
    body: { first_frame_image: '../../etc/passwd' },
  })
  assert.equal(badSlot.status, 400)

  // Normalize leading slash on static/... and clear with null
  const okSlot = await jsonReq(app, 'PUT', `/api/v1/storyboards/${sb1Id}`, {
    cookie,
    body: {
      first_frame_image: '/static/images/sample-first.jpg',
      composed_image: 'static/images/sample-collage.jpg',
    },
  })
  assert.equal(okSlot.status, 200)
  const afterOkSbs = await getEpisodeSbs()
  const sb1AfterOk = afterOkSbs.find(s => s.id === sb1Id)
  assert.equal(sb1AfterOk.first_frame_image, 'static/images/sample-first.jpg')
  assert.equal(sb1AfterOk.composed_image, 'static/images/sample-collage.jpg')

  // Pipeline status now recognizes first_frame_image as image progress
  const pipeRes = await jsonReq(app, 'GET', `/api/v1/episodes/${episodeId}/pipeline-status`, { cookie })
  assert.equal(pipeRes.status, 200)

  // Clear first_frame_image
  const clearedSlot = await jsonReq(app, 'PUT', `/api/v1/storyboards/${sb1Id}`, {
    cookie,
    body: { first_frame_image: null },
  })
  assert.equal(clearedSlot.status, 200)
  const afterClearSbs = await getEpisodeSbs()
  assert.equal(afterClearSbs.find(s => s.id === sb1Id).first_frame_image, null)

  // 4. Generate a real 1s test MP4 and test POST /:id/extract-frame -> next_first_frame & last_frame
  const videosDir = path.join(root, 'static', 'videos')
  await fs.mkdir(videosDir, { recursive: true })
  const relVid = 'static/videos/test-shot1.mp4'
  const absVid = path.join(root, relVid)
  const suite = await checkFfmpegSuite()
  if (suite.ffmpeg) {
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input('color=c=navy:s=320x180:d=1.2:r=16')
        .inputFormat('lavfi')
        .outputOptions(['-pix_fmt', 'yuv420p'])
        .output(absVid)
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })

    await jsonReq(app, 'PUT', `/api/v1/storyboards/${sb1Id}`, {
      cookie,
      body: { video_url: relVid },
    })

    const relayRes = await jsonReq(app, 'POST', `/api/v1/storyboards/${sb1Id}/extract-frame`, {
      cookie,
      body: { position: 'last', apply_to: 'next_first_frame' },
    })
    assert.equal(relayRes.status, 200)
    assert.match(relayRes.json.data.path, /^static\/images\/.+\.jpg$/)
    assert.equal(relayRes.json.data.updated_storyboard_id, sb2Id)

    // Verify extracted JPEG exists on disk and sb2.first_frame_image was updated
    const extractedStat = await fs.stat(path.join(root, relayRes.json.data.path))
    assert.ok(extractedStat.size > 100)
    const afterRelaySbs = await getEpisodeSbs()
    const sb2Row = afterRelaySbs.find((s: any) => s.id === sb2Id)
    assert.equal(sb2Row.first_frame_image, relayRes.json.data.path)

    // Also test apply_to: 'last_frame' on sb1
    const selfTailRes = await jsonReq(app, 'POST', `/api/v1/storyboards/${sb1Id}/extract-frame`, {
      cookie,
      body: { position: 'last', apply_to: 'last_frame' },
    })
    assert.equal(selfTailRes.status, 200)
    assert.equal(selfTailRes.json.data.updated_storyboard_id, sb1Id)
  }

  // 5. Verify ComfyUI image 3-reference-image cap rejects 4 refs cleanly without silent truncation
  const overCapImgTask = await jsonReq(app, 'POST', '/api/v1/tasks', {
    cookie,
    body: {
      type: 'image',
      storyboard_id: sb1Id,
      config_id: comfyImgCfgId,
      frame_type: 'first_frame',
      prompt: '书房全景',
      reference_images: [
        'static/images/r1.jpg',
        'static/images/r2.jpg',
        'static/images/r3.jpg',
        'static/images/r4.jpg',
      ],
    },
  })
  assert.equal(overCapImgTask.status, 400)
  assert.match(overCapImgTask.json.message, /最多支持 3 张参考图/)
})

test('keyframeCapabilities matrix strictly enforces per-provider/model rules without silent drops', () => {
  // 1. ComfyUI Wan 2.2: first_only, clears reference_image_urls when first_frame_image is locked
  const comfyCap = getVideoKeyframeCapability('comfyui', 'wan2.2-i2v', '720p')
  assert.equal(comfyCap.mode, 'first_only')
  const comfyBuilt = buildVideoKeyframePayload({
    storyboard: { first_frame_image: 'static/images/f1.jpg', last_frame_image: 'static/images/l1.jpg' },
    basePrompt: '缓缓推镜',
    boundReferenceImages: ['static/images/sc.jpg', 'static/images/ch1.jpg'],
    refLimit: 9,
    provider: 'comfyui',
    model: 'wan2.2-i2v',
    resolution: '720p',
  })
  assert.equal(comfyBuilt.first_frame_url, 'static/images/f1.jpg')
  assert.equal(comfyBuilt.last_frame_url, undefined)
  assert.deepEqual(comfyBuilt.reference_image_urls, [])
  assert.ok(comfyBuilt.notice?.includes('忽略尾帧'))

  // 2. Nihapi pair_required (kling-v4.0): throws clear Chinese error if only first_frame is set
  assert.throws(
    () => buildVideoKeyframePayload({
      storyboard: { first_frame_image: 'static/images/f1.jpg' },
      basePrompt: '转身挥手',
      boundReferenceImages: [],
      refLimit: Infinity,
      provider: 'nihapi',
      model: 'kling-v4.0',
      resolution: '720p',
    }),
    /必须同时具备「首帧」和「尾帧」/,
  )
  const klingPair = buildVideoKeyframePayload({
    storyboard: { first_frame_image: 'static/images/f1.jpg', last_frame_image: 'static/images/l1.jpg' },
    basePrompt: '转身挥手',
    boundReferenceImages: ['static/images/ch1.jpg'],
    refLimit: Infinity,
    provider: 'nihapi',
    model: 'kling-v4.0',
    resolution: '720p',
  })
  assert.equal(klingPair.first_frame_url, 'static/images/f1.jpg')
  assert.equal(klingPair.last_frame_url, 'static/images/l1.jpg')
  assert.deepEqual(klingPair.reference_image_urls, [])

  // 3. Grok 1.5 at 1080p: rejects tail frame with clear Chinese resolution message; succeeds at 720p with refs
  assert.throws(
    () => buildVideoKeyframePayload({
      storyboard: { first_frame_image: 'static/images/f1.jpg', last_frame_image: 'static/images/l1.jpg' },
      basePrompt: '奔跑',
      boundReferenceImages: ['static/images/ch1.jpg'],
      refLimit: Infinity,
      provider: 'grok',
      model: 'grok-imagine-video-1.5',
      resolution: '1080p',
    }),
    /720p/,
  )
  const grok720 = buildVideoKeyframePayload({
    storyboard: { first_frame_image: 'static/images/f1.jpg', last_frame_image: 'static/images/l1.jpg' },
    basePrompt: '奔跑',
    boundReferenceImages: ['static/images/ch1.jpg'],
    refLimit: Infinity,
    provider: 'grok',
    model: 'grok-imagine-video-1.5',
    resolution: '720p',
  })
  assert.equal(grok720.first_frame_url, 'static/images/f1.jpg')
  assert.equal(grok720.last_frame_url, 'static/images/l1.jpg')
  assert.deepEqual(grok720.reference_image_urls, ['static/images/ch1.jpg'])

  // 4. Volcengine Seedance 2.0 (refs_only): injects first & last frame at top of reference_image_urls
  const seedance = buildVideoKeyframePayload({
    storyboard: { first_frame_image: 'static/images/f1.jpg', last_frame_image: 'static/images/l1.jpg' },
    basePrompt: '推门进入',
    boundReferenceImages: ['static/images/sc.jpg', 'static/images/ch1.jpg'],
    refLimit: 9,
    provider: 'volcengine',
    model: 'doubao-seedance-2-0-250528',
    resolution: '720p',
  })
  assert.equal(seedance.first_frame_url, undefined)
  assert.equal(seedance.last_frame_url, undefined)
  assert.deepEqual(seedance.reference_image_urls, [
    'static/images/f1.jpg',
    'static/images/l1.jpg',
    'static/images/sc.jpg',
    'static/images/ch1.jpg',
  ])
  assert.match(seedance.prompt, /第1张参考图为镜头起始首帧构图.*第2张参考图的结尾构图/)

  // 5. Helpers
  assert.equal(aspectRatioToImageSize('9:16'), '720x1280')
  assert.equal(aspectRatioToImageSize('16:9'), '1280x720')
  const kfPrompt = buildStoryboardKeyframePrompt(
    { shot_type: '中近景', description: '@沈知意 站在落地窗前' },
    'first_frame',
    { location: '总裁办公室', time: '深夜' },
    [{ name: '沈知意', appearance: '黑色职业西装' }],
  )
  assert.match(kfPrompt, /起始首帧定格画面/)
  assert.match(kfPrompt, /总裁办公室/)
  assert.doesNotMatch(kfPrompt, /@/)
})
