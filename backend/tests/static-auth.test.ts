import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { requirePageAuth } from '../src/services/auth.js'

test('public files stay accessible while missing and encoded paths cannot expose private files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'huobao-static-auth-'))
  process.env.AUTH_PASSWORD = 'test-only'
  try {
    await fs.mkdir(path.join(root, 'static'))
    await fs.writeFile(path.join(root, 'static', 'image.png'), 'media')
    await fs.writeFile(path.join(root, 'huobao.sqlite3'), 'private-db')
    const app = new Hono()
    app.use('/static/*', serveStatic({ root }))
    app.all('/static/*', c => c.notFound())
    app.use('*', requirePageAuth)
    app.get('*', c => c.text('private-app'))
    assert.equal(await (await app.request('/static/image.png')).text(), 'media')
    assert.equal((await app.request('/static/missing.png')).status, 404)
    for (const url of ['/static/%252e%252e/huobao.sqlite3', '/static/..%5chuobao.sqlite3', '//static/../huobao.sqlite3', '/login.html', '/index.html', '/%73tatic/../huobao.sqlite3']) {
      const response = await app.request(`http://localhost${url}`)
      assert.notEqual(response.status, 200, url)
      assert.ok(!(await response.text()).includes('private-db'))
    }
  } finally {
    delete process.env.AUTH_PASSWORD
    await fs.rm(root, { recursive: true, force: true })
  }
})
