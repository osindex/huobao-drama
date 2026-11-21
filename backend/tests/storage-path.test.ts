import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { getAbsolutePath } from '../src/utils/storage.js'
import { STORAGE_ROOT } from '../src/utils/paths.js'

test('media paths cannot read outside storage', () => {
  assert.equal(getAbsolutePath('static/uploads/a.png'), path.join(STORAGE_ROOT, 'uploads/a.png'))
  assert.equal(getAbsolutePath('/static/uploads/a.png'), path.join(STORAGE_ROOT, 'uploads/a.png'))
  for (const input of ['../huobao.sqlite3', 'static/../../.env', '/etc/passwd', 'static/..']) {
    assert.throws(() => getAbsolutePath(input), /资源路径/)
  }
})
