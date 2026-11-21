import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import sharp from 'sharp'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'huobao-reference-'))
process.env.SQLITE_PATH = path.join(root, 'test.sqlite3')
process.env.HUOBAO_DATA_DIR = root
process.env.STORAGE_PATH = path.join(root, 'static')
process.env.MYSQL_AUTO_IMPORT = 'false'
const { db, schema } = await import('../src/db/index.ts')
const { registerAssetReferenceRoutes } = await import('../src/services/asset-reference.ts')
const { generateImage } = await import('../src/services/generation.ts')
const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).png().toBuffer()
await fs.mkdir(path.join(root, 'static/images'), { recursive: true })
await fs.writeFile(path.join(root, 'static/images/source.png'), png)
const received: { url: string; body: string }[] = []
const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  received.push({ url: req.url!, body: Buffer.concat(chunks).toString() })
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }))
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const ts = new Date().toISOString()
const config = db.insert(schema.aiServiceConfigs).values({ name: 'mock', serviceType: 'image', provider: 'openai', model: '["gpt-image-2"]', apiKey: 'test', baseUrl: `http://127.0.0.1:${(server.address() as any).port}`, createdAt: ts, updatedAt: ts }).returning().get()

for (const kind of ['character', 'scene', 'prop'] as const) {
  test(`${kind}: persist reference, send actual image, write only target, reject invalid references`, async () => {
    const table = kind === 'character' ? schema.characters : kind === 'scene' ? schema.scenes : schema.props
    const common = { dramaId: 1, name: 'source', location: 'courtyard', time: 'day', prompt: 'empty', createdAt: ts, updatedAt: ts }
    const source = db.insert(table).values({ ...common, imageUrl: 'static/images/source.png' }).returning().get()
    const target = db.insert(table).values(common).returning().get()
    const foreign = db.insert(table).values({ ...common, dramaId: 2, imageUrl: source.imageUrl }).returning().get()
    const empty = db.insert(table).values(common).returning().get()
    const app = new Hono()
    registerAssetReferenceRoutes(app, kind)
    const save = (id: number | null) => app.request(`/${target.id}/reference`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference_asset_id: id, reference_note: 'rainy battle-worn state' }) })
    for (const id of [target.id, foreign.id, empty.id, 999999]) assert.equal((await save(id)).status, 400)
    assert.equal((await save(source.id)).status, 200)
    const settings = await (await app.request(`/${target.id}/reference`)).json()
    assert.equal(settings.data.reference_asset_id, source.id)
    assert.ok(settings.data.candidates.some((c: any) => c.id === source.id))
    assert.ok(!settings.data.candidates.some((c: any) => c.id === foreign.id))
    const targetField = kind === 'character' ? 'characterId' : kind === 'scene' ? 'sceneId' : 'propId'
    const before = received.length
    const taskId = await generateImage({ [targetField]: target.id, dramaId: 1, prompt: 'target image', configId: config.id })
    const deadline = Date.now() + 10000
    let task
    do {
      task = db.select().from(schema.sysTask).where(eq(schema.sysTask.id, taskId)).get()!
      if (task.status !== 'processing') break
      await new Promise(r => setTimeout(r, 20))
    } while (Date.now() < deadline)
    assert.equal(task.status, 'completed', task.errorMsg || '')
    assert.equal(received.length, before + 1)
    assert.equal(received[before].url, '/v1/images/edits')
    assert.match(received[before].body, /name="image\[\]"/)
    assert.match(received[before].body, /rainy battle-worn state/)
    assert.deepEqual(JSON.parse(task.params!).referenceAsset, { kind, id: source.id })
    assert.equal(db.select().from(table).where(eq(table.id, source.id)).get()!.imageUrl, source.imageUrl)
    assert.equal(db.select().from(table).where(eq(table.id, target.id)).get()!.imageUrl, task.localPath)
    db.update(table).set({ deletedAt: ts }).where(eq(table.id, source.id)).run()
    await assert.rejects(generateImage({ [targetField]: target.id, prompt: 'target', configId: config.id }), /已删除/)
    assert.equal((await save(null)).status, 200)
    assert.equal(db.select().from(table).where(eq(table.id, target.id)).get()!.referenceAssetId, null)
  })
}

test.after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  db.$client.close()
  await fs.rm(root, { recursive: true, force: true })
})
