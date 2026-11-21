import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { prepareGrokImageReference, fitGrokRequestBody } from '../src/services/grok-image-reference.js'

test('Grok PNG transport keeps original dimensions and JPEG input stays byte-identical', async () => {
  const png = await sharp({ create: { width: 1360, height: 768, channels: 3, background: '#abcdef' } }).png().toBuffer()
  const result = await prepareGrokImageReference(`data:image/png;base64,${png.toString('base64')}`)
  assert.ok(result?.startsWith('data:image/jpeg;base64,'))
  const meta = await sharp(Buffer.from(result!.split(',')[1], 'base64')).metadata()
  assert.equal(meta.width, 1360)
  assert.equal(meta.height, 768)
  assert.equal(await prepareGrokImageReference(result), result)
  assert.equal(await prepareGrokImageReference('https://example.com/image.png'), 'https://example.com/image.png')
  await assert.rejects(prepareGrokImageReference('static/images/nonexistent-reference.png'))
})

test('request budget preserves references, order, dimensions and the original request', async () => {
  const pixels = Buffer.alloc(256 * 256 * 3)
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37 + (i >> 8) * 53) % 256
  const jpeg = await sharp(pixels, { raw: { width: 256, height: 256, channels: 3 } }).jpeg({ quality: 95 }).toBuffer()
  const url = `data:image/jpeg;base64,${jpeg.toString('base64')}`
  const body = { prompt: '<IMAGE_0> and <IMAGE_1>', reference_images: [{ url }, { url: 'https://example.com/image.png' }, { url }] }
  const budget = Math.floor(Buffer.byteLength(JSON.stringify(body)) * 0.85)
  const fitted = await fitGrokRequestBody(body, budget)
  assert.ok(Buffer.byteLength(JSON.stringify(fitted)) <= budget)
  assert.equal(fitted.reference_images.length, 3)
  assert.equal(fitted.reference_images[1].url, body.reference_images[1].url)
  assert.equal(fitted.prompt, body.prompt)
  assert.equal(body.reference_images[0].url, url)
  const meta = await sharp(Buffer.from(fitted.reference_images[0].url.split(',')[1], 'base64')).metadata()
  assert.equal(meta.width, 256)
  assert.equal(meta.height, 256)
  await assert.rejects(fitGrokRequestBody({ prompt: 'x'.repeat(3000) }, 1024), /本地请求体预检未通过/)
})
