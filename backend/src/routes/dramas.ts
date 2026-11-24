import { Hono } from 'hono'
import { and, eq, isNull, desc } from 'drizzle-orm'
import { db, getInsertId, schema, sqlite } from '../db/index.js'
import { getRequestActor } from '../services/auth.js'
import {
  canManageDramaSharing,
  canWriteInTeam,
  checkDramaIdAccess,
  effectiveDramaVisibility,
  filterVisibleDramas,
  respondAccessDenied,
} from '../services/team-access.js'
import { success, badRequest, notFound, created, now } from '../utils/response.js'
import { toSnakeCase, toSnakeCaseArray } from '../utils/transform.js'

const app = new Hono()

// GET /dramas - List dramas (scoped to current active team + visibility rules)
app.get('/', async (c) => {
  const page = Number(c.req.query('page') || 1)
  const pageSize = Number(c.req.query('page_size') || 20)
  const status = c.req.query('status')
  const keyword = c.req.query('keyword')
  const actor = getRequestActor()

  const allRows = await db.select().from(schema.dramas)
    .where(isNull(schema.dramas.deletedAt))
    .orderBy(desc(schema.dramas.updatedAt))
  let filtered = filterVisibleDramas(allRows, actor)

  if (status) filtered = filtered.filter(d => d.status === status)
  if (keyword) filtered = filtered.filter(d => d.title.includes(keyword))

  const total = filtered.length
  const items = filtered.slice((page - 1) * pageSize, page * pageSize)

  const creatorIds = [...new Set(items.map(d => d.createdBy).filter((v): v is number => typeof v === 'number'))]
  const creatorMap = new Map<number, string>()
  for (const uid of creatorIds) {
    const u = db.select({ displayName: schema.users.displayName }).from(schema.users).where(eq(schema.users.id, uid)).get()
    if (u) creatorMap.set(uid, u.displayName)
  }

  // Attach episode/character/scene counts
  const enriched = await Promise.all(items.map(async (drama) => {
    const eps = await db.select().from(schema.episodes)
      .where(and(eq(schema.episodes.dramaId, drama.id), isNull(schema.episodes.deletedAt)))
    const chars = await db.select().from(schema.characters)
      .where(and(eq(schema.characters.dramaId, drama.id), isNull(schema.characters.deletedAt)))
    const scns = await db.select().from(schema.scenes)
      .where(and(eq(schema.scenes.dramaId, drama.id), isNull(schema.scenes.deletedAt)))
    return {
      ...toSnakeCase(drama),
      creator_name: drama.createdBy ? (creatorMap.get(drama.createdBy) || null) : null,
      effective_visibility: actor ? effectiveDramaVisibility(drama, actor.team) : 'team_shared',
      tags: drama.tags ? JSON.parse(drama.tags) : [],
      total_episodes: eps.length,
      episodes: toSnakeCaseArray(eps),
      characters: toSnakeCaseArray(chars),
      scenes: toSnakeCaseArray(scns),
    }
  }))

  return success(c, {
    items: enriched,
    pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
  })
})

// POST /dramas - Create drama
app.post('/', async (c) => {
  const actor = getRequestActor()
  if (!canWriteInTeam(actor)) {
    return c.json({ code: 403, message: '当前团队角色为只读访客，无权创建项目' }, 403)
  }

  const body = await c.req.json()
  if (!body?.title?.trim()) return badRequest(c, '项目标题不能为空')
  const visibility = ['inherit', 'team_shared', 'creator_only'].includes(body.visibility)
    ? body.visibility
    : 'inherit'

  const ts = now()
  const res = await db.insert(schema.dramas).values({
    teamId: actor?.team.id ?? null,
    createdBy: actor?.user.id ?? null,
    visibility,
    title: body.title.trim(),
    description: body.description,
    genre: body.genre,
    style: body.style,
    aspectRatio: body.aspect_ratio || '16:9',
    tags: body.tags ? JSON.stringify(body.tags) : null,
    metadata: body.metadata,
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  })

  const [result] = await db.select().from(schema.dramas)
    .where(eq(schema.dramas.id, getInsertId(res)))

  // 不再预建集 — 用户通过「添加集」流程创建（该流程会锁定图片/视频生成配置）
  return created(c, toSnakeCase(result))
})

// GET /dramas/stats — must be before /:id
app.get('/stats', async (c) => {
  const allRows = await db.select().from(schema.dramas).where(isNull(schema.dramas.deletedAt))
  const all = filterVisibleDramas(allRows)
  const byStatus = Object.entries(
    all.reduce((acc, d) => {
      acc[d.status || 'draft'] = (acc[d.status || 'draft'] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  ).map(([status, count]) => ({ status, count }))
  return success(c, { total: all.length, by_status: byStatus })
})

// GET /dramas/:id - Get drama detail
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const access = checkDramaIdAccess(id, 'read')
  if (!access.ok) return respondAccessDenied(c, access)
  const drama = access.drama!
  const actor = getRequestActor()

  const eps = await db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, id), isNull(schema.episodes.deletedAt)))
  const chars = await db.select().from(schema.characters)
    .where(and(eq(schema.characters.dramaId, id), isNull(schema.characters.deletedAt)))
  const scns = await db.select().from(schema.scenes)
    .where(and(eq(schema.scenes.dramaId, id), isNull(schema.scenes.deletedAt)))
  const prps = await db.select().from(schema.props)
    .where(and(eq(schema.props.dramaId, id), isNull(schema.props.deletedAt)))

  return success(c, {
    ...toSnakeCase(drama),
    effective_visibility: actor ? effectiveDramaVisibility(drama, actor.team) : 'team_shared',
    can_manage_sharing: canManageDramaSharing(drama, actor),
    tags: drama.tags ? JSON.parse(drama.tags) : [],
    episodes: toSnakeCaseArray(eps),
    characters: toSnakeCaseArray(chars),
    scenes: toSnakeCaseArray(scns),
    props: toSnakeCaseArray(prps),
  })
})

// PUT /dramas/:id - Update drama
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const access = checkDramaIdAccess(id, 'write')
  if (!access.ok) return respondAccessDenied(c, access)

  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.title !== undefined) updates.title = body.title
  if (body.description !== undefined) updates.description = body.description
  if (body.genre !== undefined) updates.genre = body.genre
  if (body.style !== undefined) updates.style = body.style
  if (body.aspect_ratio !== undefined) updates.aspectRatio = body.aspect_ratio
  if (body.status !== undefined) updates.status = body.status
  if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags)
  if (body.metadata !== undefined) updates.metadata = body.metadata
  if (body.visibility !== undefined) {
    if (!canManageDramaSharing(access.drama!)) {
      return c.json({ code: 403, message: '仅项目创建者或团队管理员可修改项目可见性' }, 403)
    }
    if (!['inherit', 'team_shared', 'creator_only'].includes(body.visibility)) {
      return badRequest(c, 'visibility 仅支持 inherit / team_shared / creator_only')
    }
    updates.visibility = body.visibility
  }
  await db.update(schema.dramas).set(updates).where(eq(schema.dramas.id, id))
  return success(c)
})

// DELETE /dramas/:id - Soft delete
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const access = checkDramaIdAccess(id, 'write')
  if (!access.ok) return respondAccessDenied(c, access)
  if (!canManageDramaSharing(access.drama!)) {
    return c.json({ code: 403, message: '仅项目创建者或团队管理员可删除项目' }, 403)
  }
  await db.update(schema.dramas).set({ deletedAt: now() }).where(eq(schema.dramas.id, id))
  return success(c)
})

// GET /dramas/:id/shares — 查看单项目成员授权列表
app.get('/:id/shares', (c) => {
  const id = Number(c.req.param('id'))
  const access = checkDramaIdAccess(id, 'read')
  if (!access.ok) return respondAccessDenied(c, access)

  const rows = sqlite.prepare(`
    SELECT
      ds.id,
      ds.user_id,
      ds.permission,
      ds.created_at,
      u.username,
      u.display_name
    FROM drama_shares ds
    JOIN users u ON u.id = ds.user_id
    WHERE ds.drama_id = ?
    ORDER BY ds.id ASC
  `).all(id)
  return success(c, rows)
})

// POST /dramas/:id/shares — 将私有项目定向共享给同团队指定成员
app.post('/:id/shares', async (c) => {
  const id = Number(c.req.param('id'))
  const access = checkDramaIdAccess(id, 'read')
  if (!access.ok) return respondAccessDenied(c, access)
  if (!canManageDramaSharing(access.drama!)) {
    return c.json({ code: 403, message: '仅项目创建者或团队管理员可管理项目共享' }, 403)
  }

  const body = await c.req.json().catch(() => null)
  const targetUserId = Number(body?.user_id)
  const permission = body?.permission === 'view' ? 'view' : 'edit'
  if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
    return badRequest(c, '请选择有效的团队成员')
  }

  if (access.drama!.teamId) {
    const member = db.select().from(schema.teamMembers)
      .where(and(eq(schema.teamMembers.teamId, access.drama!.teamId), eq(schema.teamMembers.userId, targetUserId)))
      .get()
    if (!member) return badRequest(c, '只能共享给同一团队内的成员')
  }

  const ts = now()
  sqlite.prepare(`
    INSERT INTO drama_shares (drama_id, user_id, permission, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(drama_id, user_id) DO UPDATE SET permission = excluded.permission
  `).run(id, targetUserId, permission, ts)
  return success(c)
})

// DELETE /dramas/:id/shares/:userId — 取消单项目成员共享
app.delete('/:id/shares/:userId', (c) => {
  const id = Number(c.req.param('id'))
  const access = checkDramaIdAccess(id, 'read')
  if (!access.ok) return respondAccessDenied(c, access)
  if (!canManageDramaSharing(access.drama!)) {
    return c.json({ code: 403, message: '仅项目创建者或团队管理员可管理项目共享' }, 403)
  }
  const targetUserId = Number(c.req.param('userId'))
  db.delete(schema.dramaShares)
    .where(and(eq(schema.dramaShares.dramaId, id), eq(schema.dramaShares.userId, targetUserId)))
    .run()
  return success(c)
})

// PUT /dramas/:id/characters - Save characters
app.put('/:id/characters', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const access = checkDramaIdAccess(dramaId, 'write')
  if (!access.ok) return respondAccessDenied(c, access)

  const body = await c.req.json()
  const chars = body.characters || []
  const ts = now()

  for (const char of chars) {
    if (char.id) {
      await db.update(schema.characters)
        .set({ ...char, dramaId, updatedAt: ts })
        .where(and(eq(schema.characters.id, Number(char.id)), eq(schema.characters.dramaId, dramaId)))
    } else {
      await db.insert(schema.characters).values({ ...char, dramaId, createdAt: ts, updatedAt: ts })
    }
  }
  return success(c)
})

// PUT /dramas/:id/episodes - Save episodes
app.put('/:id/episodes', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const access = checkDramaIdAccess(dramaId, 'write')
  if (!access.ok) return respondAccessDenied(c, access)

  const body = await c.req.json()
  const episodes = body.episodes || []
  const ts = now()

  for (const ep of episodes) {
    if (ep.id) {
      await db.update(schema.episodes)
        .set({ ...ep, dramaId, updatedAt: ts })
        .where(and(eq(schema.episodes.id, Number(ep.id)), eq(schema.episodes.dramaId, dramaId)))
    } else {
      await db.insert(schema.episodes).values({
        ...ep,
        dramaId,
        episodeNumber: ep.episode_number || ep.episodeNumber || 1,
        title: ep.title || '未命名',
        createdAt: ts,
        updatedAt: ts,
      })
    }
  }
  return success(c)
})

export default app
