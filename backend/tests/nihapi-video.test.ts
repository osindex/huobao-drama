import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NihapiVideoAdapter, nihapiVideoProfiles } from '../src/services/adapters/nihapi-video.js'

const adapter = new NihapiVideoAdapter()
const config = { provider: 'nihapi', baseUrl: 'https://nihapi.com/v1', apiKey: 'test-secret', model: 'minimax-h3-base' }
const record = { id: 1, prompt: 'A sailboat crosses a quiet lake', duration: 5, resolution: '720p' }

test('all 24 relay models have profiles; H3 keeps every reference and uses the documented fields', () => {
  assert.equal(Object.keys(nihapiVideoProfiles).length, 24)
  const images = ['data:image/png;base64,AAAA', 'https://cdn.example/2.png']
  const req = adapter.buildGenerateRequest(config, { ...record, referenceImageUrls: JSON.stringify(images) })
  assert.equal(req.url, 'https://nihapi.com/v1/videos')
  assert.equal(req.body.seconds, 5)
  assert.equal(req.body.resolution, '768p')
  assert.deepEqual(req.body.metadata.reference_image_urls, images)
  const frames = adapter.buildGenerateRequest(config, { ...record, firstFrameUrl: images[0], lastFrameUrl: images[1] })
  assert.deepEqual(frames.body.images, images)
})

test('relay-specific fields, limits and unsupported references fail explicitly', () => {
  const muse = adapter.buildGenerateRequest(config, { ...record, model: 'muse-video-ext', referenceImageUrls: '["data:image/png;base64,AAAA"]' })
  assert.deepEqual(muse.body.image_urls, ['data:image/png;base64,AAAA'])
  assert.equal(muse.body.images, undefined)
  assert.throws(() => adapter.buildGenerateRequest(config, { ...record, model: 'MiniMax-H3-LH', referenceImageUrls: '["data:image/png;base64,AAAA"]' }), /公网 URL/)
  assert.throws(() => adapter.buildGenerateRequest(config, { ...record, referenceImageUrls: JSON.stringify(Array(10).fill('https://cdn.example/a.png')) }), /不会丢弃/)
  assert.throws(() => adapter.buildGenerateRequest(config, { ...record, referenceVideoUrls: '["https://cdn.example/a.mp4"]' }), /参考图片/)
  assert.throws(() => adapter.buildGenerateRequest(config, { ...record, model: 'muse-video-ext', firstFrameUrl: 'https://cdn.example/a.png' }), /首尾帧/)
  assert.throws(() => adapter.buildGenerateRequest(config, { ...record, model: 'kling-v4.0-flash', referenceImageUrls: '["https://cdn.example/a.png"]' }), /11 秒/)
  assert.throws(() => adapter.buildGenerateRequest(config, { ...record, model: 'nd-seedance-2.0 480p', resolution: '480p' }), /15–15/)
})

test('queued, completed-without-url and failed responses support authenticated content retrieval', () => {
  assert.deepEqual(adapter.parseGenerateResponse({ id: 'video_1', status: 'queued' }), { isAsync: true, taskId: 'video_1' })
  assert.equal(adapter.parsePollResponse({ status: 'in_progress' }).status, 'processing')
  assert.equal(adapter.parsePollResponse({ status: 'completed', seconds: '5' }).status, 'completed')
  const req = adapter.buildDownloadRequest(config, 'video_1')
  assert.equal(req.url, 'https://nihapi.com/v1/videos/video_1/content')
  assert.equal(req.headers.Authorization, 'Bearer test-secret')
  assert.equal(adapter.parsePollResponse({ status: 'failed', error: { message: 'upstream rejected' } }).error, 'upstream rejected')
  assert.equal(adapter.parsePollResponse({ status: 'cancelled' }).status, 'failed')
})
