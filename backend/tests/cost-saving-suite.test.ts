import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'huobao-costsuite-'))
process.env.SQLITE_PATH = path.join(root, 'costsuite.sqlite3')
process.env.HUOBAO_DATA_DIR = root
process.env.STORAGE_PATH = path.join(root, 'static')
process.env.MYSQL_AUTO_IMPORT = 'false'
process.env.AUTH_PASSWORD = 'admin-boot-password'

const { db, schema } = await import('../src/db/index.js')
const { requireAuth } = await import('../src/services/auth.js')
const { estimateCredits } = await import('../src/services/billing.js')
const { ffmpeg, checkFfmpegSuite } = await import('../src/utils/ffmpeg.js')
const authRoute = (await import('../src/routes/auth.js')).default
const dramasRoute = (await import('../src/routes/dramas.js')).default
const episodesRoute = (await import('../src/routes/episodes.js')).default
const storyboardsRoute = (await import('../src/routes/storyboards.js')).default
const tasksRoute = (await import('../src/routes/tasks.js')).default
const aiConfigsRoute = (await import('../src/routes/aiConfigs.js')).default

const {
  resolveTurboDraftPlan,
  resolveHdRefinePlan,
  hasDialogueLipSyncRisk,
  hasPromptVoiceMentions,
  isTaskDraftVideo,
  isTaskSlowMotionVideo,
  parseTaskParamsSafe,
  SLOW_MOTION_PRESETS,
} = await import('../../frontend/app/components/canvas/costSavingCapabilities.ts')
const { buildVideoKeyframePayload } = await import('../../frontend/app/components/canvas/keyframeCapabilities.ts')

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

test('turbo draft plan only swaps models when it cannot drop tail frames, references or voices', () => {
  // 本地 Wan 2.2：不换模型，480p 静音
  const comfy = resolveTurboDraftPlan({ provider: 'comfyui', model: 'wan2.2-i2v', duration: 4 })
  assert.equal(comfy.swappedModel, false)
  assert.equal(comfy.resolution, '480p')
  assert.equal(comfy.generateAudio, false)

  // Grok：无尾帧无参考图才切 Lite；带参考图/尾帧必须保持 1.5，不能因降档丢素材
  const grokLite = resolveTurboDraftPlan({ provider: 'grok', model: 'grok-imagine-video-1.5' })
  assert.equal(grokLite.model, 'grok-imagine-video-1.5-lite')
  assert.equal(grokLite.swappedModel, true)
  assert.equal(grokLite.resolution, '480p')
  const grokRefs = resolveTurboDraftPlan({ provider: 'grok', model: 'grok-imagine-video-1.5', refImageCount: 2 })
  assert.equal(grokRefs.model, 'grok-imagine-video-1.5')
  assert.equal(grokRefs.swappedModel, false)
  const grokLiteWithTail = resolveTurboDraftPlan({ provider: 'grok', model: 'grok-imagine-video-1.5-lite', hasTailFrame: true })
  assert.equal(grokLiteWithTail.model, 'grok-imagine-video-1.5')
  assert.equal(grokLiteWithTail.swappedModel, true)

  // 百炼：prime → 轻量版；有音色引用必须保留音频
  const wan = resolveTurboDraftPlan({ provider: 'aliyun', model: 'wan3.0-video-prime', hasVoiceReference: true })
  assert.equal(wan.model, 'wan3.0-video')
  assert.equal(wan.swappedModel, true)
  assert.equal(wan.generateAudio, true)
  const wanLite = resolveTurboDraftPlan({ provider: 'aliyun', model: 'wan3.0-video' })
  assert.equal(wanLite.swappedModel, false)
  assert.equal(wanLite.generateAudio, false)

  // NIH API：kling-v4.0 仅在无尾帧/无参考图且 5/10 秒时切 flash
  const klingFlash = resolveTurboDraftPlan({ provider: 'nihapi', model: 'kling-v4.0', duration: 5 })
  assert.equal(klingFlash.model, 'kling-v4.0-flash')
  assert.equal(klingFlash.swappedModel, true)
  const klingTail = resolveTurboDraftPlan({ provider: 'nihapi', model: 'kling-v4.0', duration: 5, hasTailFrame: true })
  assert.equal(klingTail.model, 'kling-v4.0')
  assert.equal(klingTail.swappedModel, false)
  assert.equal(klingTail.resolution, '720p')
  const klingOddDuration = resolveTurboDraftPlan({ provider: 'nihapi', model: 'kling-v4.0', duration: 6 })
  assert.equal(klingOddDuration.model, 'kling-v4.0')

  // NIH API：同系列 480p 通道 / tier=fast
  const sd = resolveTurboDraftPlan({ provider: 'nihapi', model: '特惠sd2.5-1080p', duration: 5 })
  assert.equal(sd.model, '特惠sd2.5-480p')
  assert.equal(sd.swappedModel, true)
  const tiered = resolveTurboDraftPlan({ provider: 'nihapi', model: 'minimax-h3-base', duration: 5 })
  assert.equal(tiered.model, 'minimax-h3-base')
  assert.equal(tiered.swappedModel, false)
  assert.equal(tiered.speedTier, 'fast')
  assert.equal(tiered.resolution, '480p')

  // Seedance 2.0 默认：480p；有音色保音频
  const volcSilent = resolveTurboDraftPlan({ provider: 'volcengine', model: 'doubao-seedance-2-0-250528' })
  assert.equal(volcSilent.resolution, '480p')
  assert.equal(volcSilent.generateAudio, false)
  assert.equal(volcSilent.swappedModel, false)
  const volcVoice = resolveTurboDraftPlan({ provider: 'volcengine', model: 'doubao-seedance-2-0-250528', hasVoiceReference: true })
  assert.equal(volcVoice.generateAudio, true)

  // 每个计划都必须带可展示的徽章与说明（非静默降档）
  for (const plan of [comfy, grokLite, grokRefs, wan, klingFlash, klingTail, sd, tiered, volcSilent]) {
    assert.ok(plan.summaryBadge.length > 0)
    assert.ok(plan.detailHint.length > 0)
  }
})

test('HD refine plan never attempts V2V without a public URL or on providers lacking reference video', () => {
  const localDraft = 'static/videos/draft.mp4'

  // 本地 Wan：仅单首帧；1080p 集分辨率封顶 720p，480p 集也至少升到 720p
  const comfy = resolveHdRefinePlan({ provider: 'comfyui', model: 'wan2.2-i2v', episodeResolution: '1080p', draftVideoUrl: localDraft, publicBaseUrlConfigured: true })
  assert.equal(comfy.strategy, 'keyframe_first')
  assert.equal(comfy.resolution, '720p')
  assert.equal(resolveHdRefinePlan({ provider: 'comfyui', episodeResolution: '480p', draftVideoUrl: localDraft }).resolution, '720p')

  // Grok：适配器拒收参考视频，即使配置了公网地址也只能走首尾帧
  const grok = resolveHdRefinePlan({ provider: 'grok', model: 'grok-imagine-video-1.5-lite', episodeResolution: '1080p', draftVideoUrl: localDraft, publicBaseUrlConfigured: true })
  assert.equal(grok.strategy, 'keyframe_pair')
  assert.equal(grok.model, 'grok-imagine-video-1.5')
  assert.equal(grok.resolution, '720p')
  assert.ok(grok.notice)

  // 百炼 Wan 3.0：有公网地址 → V2V；否则回退首尾帧并给出提示
  const wanV2v = resolveHdRefinePlan({ provider: 'aliyun', model: 'wan3.0-video-prime', episodeResolution: '1080p', draftVideoUrl: localDraft, publicBaseUrlConfigured: true })
  assert.equal(wanV2v.strategy, 'v2v_reference')
  assert.equal(wanV2v.resolution, '1080p')
  const wanFallback = resolveHdRefinePlan({ provider: 'aliyun', model: 'wan3.0-video-prime', episodeResolution: '1080p', draftVideoUrl: localDraft, publicBaseUrlConfigured: false })
  assert.equal(wanFallback.strategy, 'keyframe_pair')
  assert.match(wanFallback.notice || '', /PUBLIC_BASE_URL/)
  const wanRemoteDraft = resolveHdRefinePlan({ provider: 'aliyun', model: 'wan3.0-video-prime', draftVideoUrl: 'https://cdn.example.com/draft.mp4', publicBaseUrlConfigured: false })
  assert.equal(wanRemoteDraft.strategy, 'v2v_reference')

  // NIH API：480p 草稿通道升级为同系列高清通道
  const sdV2v = resolveHdRefinePlan({ provider: 'nihapi', model: '特惠sd2.5-480p', episodeResolution: '1080p', draftVideoUrl: localDraft, publicBaseUrlConfigured: true })
  assert.equal(sdV2v.strategy, 'v2v_reference')
  assert.equal(sdV2v.model, '特惠sd2.5-1080p')
  assert.equal(sdV2v.resolution, '1080p')
  const sdNoPublic = resolveHdRefinePlan({ provider: 'nihapi', model: '特惠sd2.5-480p', episodeResolution: '720p', draftVideoUrl: localDraft, publicBaseUrlConfigured: false })
  assert.equal(sdNoPublic.strategy, 'extracted_refs')
  assert.equal(sdNoPublic.model, '特惠sd2.5-720p')
  assert.match(sdNoPublic.notice || '', /PUBLIC_BASE_URL/)

  // NIH API：不支持参考视频的模型永远不走 V2V
  const kling = resolveHdRefinePlan({ provider: 'nihapi', model: 'kling-v4.0-flash', episodeResolution: '720p', duration: 10, draftVideoUrl: localDraft, publicBaseUrlConfigured: true })
  assert.equal(kling.strategy, 'keyframe_pair')
  assert.equal(kling.model, 'kling-v4.0')
  assert.equal(kling.durationOverride, 5)
  assert.match(kling.notice || '', /5 秒/)
  const tiered = resolveHdRefinePlan({ provider: 'nihapi', model: 'minimax-h3-base', episodeResolution: '720p', draftVideoUrl: localDraft, publicBaseUrlConfigured: true })
  assert.equal(tiered.strategy, 'keyframe_pair')
  assert.equal(tiered.speedTier, 'standard')
  assert.equal(tiered.resolution, '720p')

  // Seedance 2.0：V2V 或抽帧并入参考图
  const volcV2v = resolveHdRefinePlan({ provider: 'volcengine', model: 'doubao-seedance-2-0-250528', episodeResolution: '1080p', draftVideoUrl: localDraft, publicBaseUrlConfigured: true })
  assert.equal(volcV2v.strategy, 'v2v_reference')
  assert.equal(volcV2v.resolution, '720p')
  const volcFallback = resolveHdRefinePlan({ provider: 'volcengine', model: 'doubao-seedance-2-0-250528', episodeResolution: '720p', draftVideoUrl: localDraft, publicBaseUrlConfigured: false })
  assert.equal(volcFallback.strategy, 'extracted_refs')
  assert.match(volcFallback.notice || '', /PUBLIC_BASE_URL/)

  // 精制计划必须能被关键帧载荷构建器按同一模型/分辨率接受（与工作台 hdRefineVideo 的拼装路径一致）
  const grokBuilt = buildVideoKeyframePayload({
    storyboard: { first_frame_image: 'static/images/draft-first.jpg', last_frame_image: 'static/images/draft-last.jpg' },
    basePrompt: '缓缓推镜',
    boundReferenceImages: [],
    refLimit: Infinity,
    provider: 'grok',
    model: grok.model,
    resolution: grok.resolution,
    preferKeyframes: true,
  })
  assert.equal(grokBuilt.first_frame_url, 'static/images/draft-first.jpg')
  assert.equal(grokBuilt.last_frame_url, 'static/images/draft-last.jpg')

  const klingBuilt = buildVideoKeyframePayload({
    storyboard: { first_frame_image: 'static/images/draft-first.jpg', last_frame_image: 'static/images/draft-last.jpg' },
    basePrompt: '转身挥手',
    boundReferenceImages: [],
    refLimit: Infinity,
    provider: 'nihapi',
    model: kling.model,
    resolution: kling.resolution,
    preferKeyframes: true,
  })
  assert.equal(klingBuilt.first_frame_url, 'static/images/draft-first.jpg')
  assert.equal(klingBuilt.last_frame_url, 'static/images/draft-last.jpg')

  const volcBuilt = buildVideoKeyframePayload({
    storyboard: { first_frame_image: 'static/images/draft-first.jpg', last_frame_image: 'static/images/draft-last.jpg' },
    basePrompt: '推门进入',
    boundReferenceImages: ['static/images/ch1.jpg'],
    refLimit: 9,
    provider: 'volcengine',
    model: volcFallback.model,
    resolution: volcFallback.resolution,
    preferKeyframes: true,
  })
  assert.deepEqual(volcBuilt.reference_image_urls.slice(0, 2), ['static/images/draft-first.jpg', 'static/images/draft-last.jpg'])
  assert.ok(volcBuilt.reference_image_urls.includes('static/images/ch1.jpg'))
})

test('dialogue lip-sync heuristic, task kind helpers and slow-motion presets', () => {
  assert.equal(hasPromptVoiceMentions('#沈知意 缓缓开口'), true)
  assert.equal(hasPromptVoiceMentions('镜头 #1 推近'), false)
  assert.equal(hasDialogueLipSyncRisk({ video_prompt: '沈知意说：“你终于来了”' }), true)
  assert.equal(hasDialogueLipSyncRisk({ description: '#沈知意 冷笑' }), true)
  assert.equal(hasDialogueLipSyncRisk({ video_prompt: '空镜，雨夜街道，镜头缓缓推近霓虹招牌' }), false)
  assert.equal(hasDialogueLipSyncRisk(null), false)

  assert.equal(isTaskDraftVideo({ params: '{"draftMode":true}' }), true)
  assert.equal(isTaskDraftVideo({ params: { draftMode: true } }), true)
  assert.equal(isTaskDraftVideo({ params: '{"duration":5}' }), false)
  assert.equal(isTaskSlowMotionVideo({ provider: 'ffmpeg' }), true)
  assert.equal(isTaskSlowMotionVideo({ provider: 'local', params: '{"slowMotion":true}' }), true)
  assert.equal(isTaskSlowMotionVideo({ provider: 'local', params: '{"archivedBeforeSlowMotion":true}' }), false)
  assert.deepEqual(parseTaskParamsSafe({ params: '{broken' }), {})

  // 预设倍率必须落在后端 slowMotionVideo 允许的 0.4–0.9 区间内
  for (const preset of SLOW_MOTION_PRESETS) {
    assert.ok(preset.speed >= 0.4 && preset.speed <= 0.9)
  }
})

test('draft billing multipliers: silent draft video 0.75x, draft image 0.8x', () => {
  const ts = new Date().toISOString()
  db.insert(schema.creditPricing).values({
    serviceType: 'video',
    provider: 'costsuite-test',
    modelPattern: '*',
    billingUnit: 'per_second',
    unitCredits: 10,
    resolutionMultiplierJson: JSON.stringify({ '480p': 0.5, '720p': 1 }),
    isActive: true,
    updatedAt: ts,
  }).run()
  db.insert(schema.creditPricing).values({
    serviceType: 'image',
    provider: 'costsuite-test',
    modelPattern: '*',
    billingUnit: 'per_image',
    unitCredits: 10,
    isActive: true,
    updatedAt: ts,
  }).run()

  const base = { serviceType: 'video' as const, provider: 'costsuite-test', model: 'any', duration: 5 }
  assert.equal(estimateCredits({ ...base, resolution: '720p' }), 50)
  assert.equal(estimateCredits({ ...base, resolution: '480p', draftMode: true, generateAudio: true }), 25)
  assert.equal(estimateCredits({ ...base, resolution: '480p', draftMode: true, generateAudio: false }), 19)
  // 非草稿的静音视频不享受草稿折扣
  assert.equal(estimateCredits({ ...base, resolution: '480p', generateAudio: false }), 25)

  const img = { serviceType: 'image' as const, provider: 'costsuite-test', model: 'any' }
  assert.equal(estimateCredits(img), 10)
  assert.equal(estimateCredits({ ...img, draftMode: true }), 8)
})

test('POST /storyboards/:id/slow-motion: optical-flow stretch, non-destructive history, strict validation', async () => {
  const app = buildTestApp()
  const loginRes = await jsonReq(app, 'POST', '/api/v1/auth/login', {
    body: { username: 'admin', password: 'admin-boot-password' },
  })
  assert.equal(loginRes.status, 200)
  const cookie = extractCookie(loginRes.res)

  for (const [serviceType, model, port] of [['image', 'qwen-image-edit', 59999], ['video', 'wan2.2-i2v', 59998]] as const) {
    const cfg = await jsonReq(app, 'POST', '/api/v1/ai-configs', {
      cookie,
      body: {
        service_type: serviceType,
        name: `Local Comfy ${serviceType}`,
        provider: 'comfyui',
        base_url: `http://127.0.0.1:${port}`,
        api_key: 'none',
        model: [model],
        is_active: true,
        priority: 100,
      },
    })
    assert.equal(cfg.status, 201)
  }

  const dramaRes = await jsonReq(app, 'POST', '/api/v1/dramas', { cookie, body: { title: '省流制片测试剧' } })
  assert.equal(dramaRes.status, 201)
  const epRes = await jsonReq(app, 'POST', '/api/v1/episodes', {
    cookie,
    body: { drama_id: dramaRes.json.data.id, episode_number: 1, title: '第一集' },
  })
  assert.equal(epRes.status, 200)
  const episodeId = epRes.json.data.id
  const sbRes = await jsonReq(app, 'POST', '/api/v1/storyboards', {
    cookie,
    body: { episode_id: episodeId, storyboard_number: 1, title: '空镜', duration: 2, description: '雨夜街道缓缓推镜' },
  })
  assert.equal(sbRes.status, 201)
  const sbId = sbRes.json.data.id

  const getSb = async () => {
    const d = await jsonReq(app, 'GET', `/api/v1/episodes/${episodeId}/storyboards`, { cookie })
    return (d.json.data as any[]).find(s => s.id === sbId)
  }
  const listVideoTasks = async () => {
    const d = await jsonReq(app, 'GET', `/api/v1/tasks?type=video&storyboard_id=${sbId}`, { cookie })
    assert.equal(d.status, 200)
    return d.json.data as any[]
  }

  // 尚未出片时必须明确报错
  const noVideo = await jsonReq(app, 'POST', `/api/v1/storyboards/${sbId}/slow-motion`, { cookie, body: { speed: 0.5 } })
  assert.equal(noVideo.status, 400)
  assert.match(noVideo.json.message, /尚未生成本地视频/)

  const suite = await checkFfmpegSuite()
  if (!suite.ffmpeg) return

  const videosDir = path.join(root, 'static', 'videos')
  await fs.mkdir(videosDir, { recursive: true })
  const relVid = 'static/videos/costsuite-shot1.mp4'
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input('testsrc=s=320x180:d=2:r=16')
      .inputFormat('lavfi')
      .outputOptions(['-pix_fmt', 'yuv420p'])
      .output(path.join(root, relVid))
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
  const setVid = await jsonReq(app, 'PUT', `/api/v1/storyboards/${sbId}`, { cookie, body: { video_url: relVid } })
  assert.equal(setVid.status, 200)

  // 倍率越界：明确中文报错，不静默钳制
  const badSpeed = await jsonReq(app, 'POST', `/api/v1/storyboards/${sbId}/slow-motion`, { cookie, body: { speed: 0.2 } })
  assert.equal(badSpeed.status, 400)
  assert.match(badSpeed.json.message, /0\.4 ~ 0\.9/)
  const badFps = await jsonReq(app, 'POST', `/api/v1/storyboards/${sbId}/slow-motion`, { cookie, body: { speed: 0.5, fps: 120 } })
  assert.equal(badFps.status, 400)
  assert.equal((await listVideoTasks()).length, 0)
  assert.equal((await getSb()).video_url, relVid)

  // 0.5x 光流慢放：时长约翻倍，替换主成片并同步分镜时长
  const slow = await jsonReq(app, 'POST', `/api/v1/storyboards/${sbId}/slow-motion`, {
    cookie,
    body: { speed: 0.5, fps: 24, mode: 'optical_flow', mute_audio: true, apply: true },
  })
  assert.equal(slow.status, 200, slow.json.message)
  const slowData = slow.json.data
  assert.match(slowData.path, /^static\/videos\/.+\.mp4$/)
  assert.notEqual(slowData.path, relVid)
  assert.equal(slowData.speed, 0.5)
  assert.equal(slowData.fps, 24)
  assert.equal(slowData.mode, 'optical_flow')
  assert.equal(slowData.applied, true)
  if (suite.ffprobe) {
    assert.ok(slowData.duration > 3.5 && slowData.duration < 4.6, `unexpected duration ${slowData.duration}`)
    assert.ok(slowData.source_duration > 1.8 && slowData.source_duration < 2.3)
  }
  assert.ok((await fs.stat(path.join(root, slowData.path))).size > 500)
  // 原速文件不被覆盖或删除
  assert.ok((await fs.stat(path.join(root, relVid))).size > 500)

  const sbAfterSlow = await getSb()
  assert.equal(sbAfterSlow.video_url, slowData.path)
  assert.equal(sbAfterSlow.duration, slowData.storyboard_duration)
  assert.equal(sbAfterSlow.duration, 4)

  // 历史中同时留存「原速归档」与「慢放版本」，均为 0 算力点
  const tasksAfterSlow = await listVideoTasks()
  assert.equal(tasksAfterSlow.length, 2)
  const archive = tasksAfterSlow.find(t => t.provider === 'local')
  const slowTask = tasksAfterSlow.find(t => t.provider === 'ffmpeg')
  assert.ok(archive && slowTask)
  assert.equal(archive.localPath, relVid)
  assert.equal(parseTaskParamsSafe(archive).archivedBeforeSlowMotion, true)
  assert.equal(parseTaskParamsSafe(archive).duration, 2)
  assert.equal(slowTask.localPath, slowData.path)
  assert.equal(slowTask.model, 'minterpolate-mci')
  assert.equal(slowTask.settledCredits, 0)
  assert.equal(isTaskSlowMotionVideo(slowTask), true)
  assert.equal(isTaskSlowMotionVideo(archive), false)
  assert.equal(parseTaskParamsSafe(slowTask).sourceVideo, relVid)

  // 基于原速片源重新慢放（工作台对已慢放镜头的做法）：不重复归档原速，不叠加二次补帧
  const reslow = await jsonReq(app, 'POST', `/api/v1/storyboards/${sbId}/slow-motion`, {
    cookie,
    body: { speed: 0.75, mode: 'blend', source_video_url: relVid, apply: true },
  })
  assert.equal(reslow.status, 200, reslow.json.message)
  assert.equal(reslow.json.data.mode, 'blend')
  if (suite.ffprobe) {
    assert.ok(reslow.json.data.duration > 2.3 && reslow.json.data.duration < 3.1, `unexpected duration ${reslow.json.data.duration}`)
  }
  const tasksAfterReslow = await listVideoTasks()
  assert.equal(tasksAfterReslow.length, 3)
  assert.equal(tasksAfterReslow.filter(t => t.provider === 'local').length, 1)
  assert.equal(tasksAfterReslow.find(t => t.localPath === reslow.json.data.path).model, 'minterpolate-blend')
  assert.equal((await getSb()).duration, 3)

  // apply:false 仅产出候选版本，不改主成片与分镜时长
  const preview = await jsonReq(app, 'POST', `/api/v1/storyboards/${sbId}/slow-motion`, {
    cookie,
    body: { speed: 0.5, mode: 'blend', source_video_url: relVid, apply: false },
  })
  assert.equal(preview.status, 200, preview.json.message)
  assert.equal(preview.json.data.applied, false)
  const sbAfterPreview = await getSb()
  assert.equal(sbAfterPreview.video_url, reslow.json.data.path)
  assert.equal(sbAfterPreview.duration, 3)

  // 「还原原速」：切回原速成片并恢复分镜时长
  const restore = await jsonReq(app, 'PUT', `/api/v1/storyboards/${sbId}`, {
    cookie,
    body: { video_url: parseTaskParamsSafe(slowTask).sourceVideo, duration: Math.round(parseTaskParamsSafe(slowTask).sourceDuration || 2) },
  })
  assert.equal(restore.status, 200)
  const sbRestored = await getSb()
  assert.equal(sbRestored.video_url, relVid)
  assert.equal(sbRestored.duration, 2)

  // 远程地址不允许直接慢放
  const remote = await jsonReq(app, 'POST', `/api/v1/storyboards/${sbId}/slow-motion`, {
    cookie,
    body: { speed: 0.5, source_video_url: 'https://cdn.example.com/a.mp4' },
  })
  assert.equal(remote.status, 400)
})
