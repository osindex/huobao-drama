/**
 * 存储位置信息路由 — 设置页「存储位置」卡片数据源
 */
import { Hono } from 'hono'
import { DATA_ROOT, STORAGE_ROOT } from '../utils/paths.js'
import { dbPath } from '../db/index.js'
import { dirUsage, volumeFreeBytes } from '../utils/dirsize.js'
import { isSuperAdmin } from '../services/team-access.js'
import { success } from '../utils/response.js'

const app = new Hono()

const USAGE_TTL_MS = 60_000

interface UsageCache {
  usage: Awaited<ReturnType<typeof dirUsage>> | null
  computedAt: string | null
  computing: boolean
}
const cache: UsageCache = { usage: null, computedAt: null, computing: false }

async function computeUsage() {
  if (cache.computing) return
  cache.computing = true
  try {
    const usage = await dirUsage(DATA_ROOT, dbPath)
    cache.usage = usage
    cache.computedAt = new Date().toISOString()
  } finally {
    cache.computing = false
  }
}

// 启动 10s 后后台预热一次，用户进设置页时大概率已命中缓存
const warmup = setTimeout(() => { void computeUsage() }, 10_000)
warmup.unref?.()

app.get('/', async (c) => {
  const mode = process.env.HUOBAO_DESKTOP === '1' ? 'desktop' : 'server'
  if (!isSuperAdmin()) {
    return success(c, {
      mode,
      restricted: true,
      dataDir: '',
      storageRoot: '',
      sqlitePath: '',
      usage: null,
      usageStale: false,
      computedAt: null,
      freeBytes: null,
    })
  }

  const fresh = cache.computedAt && (Date.now() - new Date(cache.computedAt).getTime()) < USAGE_TTL_MS
  let usageStale = false
  if (!fresh) {
    if (cache.usage) {
      usageStale = true
      void computeUsage()
    } else {
      await computeUsage()
    }
  }

  return success(c, {
    mode,
    dataDir: DATA_ROOT,
    storageRoot: STORAGE_ROOT,
    sqlitePath: dbPath,
    usage: cache.usage,
    usageStale: usageStale || cache.computing,
    computedAt: cache.computedAt,
    freeBytes: await volumeFreeBytes(DATA_ROOT),
  })
})

export default app
