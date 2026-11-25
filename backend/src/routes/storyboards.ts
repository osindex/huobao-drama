import { Hono } from 'hono'
import { asc, eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, now, badRequest } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { getAbsolutePath } from '../utils/storage.js'
import { extractVideoFrame } from '../utils/video-frame.js'
import { checkEpisodeIdAccess, checkStoryboardIdAccess, respondAccessDenied } from '../services/team-access.js'
import { logTaskError, logTaskPayload, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

function normalizeMediaSlotValue(val: unknown): string | null {
  if (val === null || val === '') return null
  if (typeof val !== 'string') throw new Error('媒体路径格式无效')
  const trimmed = val.trim().replace(/^\/+/, '')
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  // 校验必须在 static/ 目录树内，阻断路径穿越
  getAbsolutePath(trimmed)
  return trimmed.startsWith('static/') ? trimmed : `static/${trimmed}`
}

async function syncStoryboardCharacters(storyboardId: number, characterIds: number[]) {
  await db.delete(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))

  const uniqueIds = [...new Set((characterIds || []).filter(Boolean))]
  if (!uniqueIds.length) return

  for (const characterId of uniqueIds) {
    await db.insert(schema.storyboardCharacters).values({
      storyboardId,
      characterId,
    })
  }
}

async function getStoryboardCharacterIds(storyboardId: number) {
  const links = await db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))
  return links.map(link => link.characterId)
}

async function syncStoryboardProps(storyboardId: number, propIds: number[]) {
  await db.delete(schema.storyboardProps)
    .where(eq(schema.storyboardProps.storyboardId, storyboardId))

  const uniqueIds = [...new Set((propIds || []).filter(Boolean))]
  if (!uniqueIds.length) return

  for (const propId of uniqueIds) {
    await db.insert(schema.storyboardProps).values({
      storyboardId,
      propId,
    })
  }
}

async function getStoryboardPropIds(storyboardId: number) {
  const links = await db.select().from(schema.storyboardProps)
    .where(eq(schema.storyboardProps.storyboardId, storyboardId))
  return links.map(link => link.propId)
}

async function validateStoryboardBindings(episodeId: number, sceneId: number | null | undefined, characterIds: number[] | undefined, propIds?: number[] | undefined) {
  const sceneLinks = await db.select().from(schema.episodeScenes)
    .where(eq(schema.episodeScenes.episodeId, episodeId))
  const episodeSceneIds = new Set(sceneLinks.map(link => link.sceneId))
  const characterLinks = await db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId))
  const episodeCharacterIds = new Set(characterLinks.map(link => link.characterId))
  const propLinks = await db.select().from(schema.episodeProps)
    .where(eq(schema.episodeProps.episodeId, episodeId))
  const episodePropIds = new Set(propLinks.map(link => link.propId))

  if (sceneId != null && !episodeSceneIds.has(sceneId)) {
    throw new Error('scene_id 必须来自当前集已关联场景')
  }

  const invalidCharacterIds = (characterIds || []).filter(id => !episodeCharacterIds.has(id))
  if (invalidCharacterIds.length) {
    throw new Error('character_ids 必须来自当前集已关联角色')
  }

  const invalidPropIds = (propIds || []).filter(id => !episodePropIds.has(id))
  if (invalidPropIds.length) {
    throw new Error('prop_ids 必须来自当前集已关联道具')
  }
}

// POST /storyboards
app.post('/', async (c) => {
  const body = await c.req.json()
  const epAccess = checkEpisodeIdAccess(Number(body.episode_id), 'write')
  if (!epAccess.ok) return respondAccessDenied(c, epAccess)

  const ts = now()
  logTaskStart('StoryboardAPI', 'create', {
    episodeId: body.episode_id,
    shotNumber: body.storyboard_number || 1,
    sceneId: body.scene_id,
    characterIds: body.character_ids,
  })
  logTaskPayload('StoryboardAPI', 'create body', body)
  await validateStoryboardBindings(Number(body.episode_id), body.scene_id, body.character_ids, body.prop_ids)
  const res = await db.insert(schema.storyboards).values({
    episodeId: Number(body.episode_id),
    storyboardNumber: body.storyboard_number || 1,
    title: body.title,
    description: body.description,
    shotType: body.shot_type,
    angle: body.angle,
    movement: body.movement,
    location: body.location,
    time: body.time,
    atmosphere: body.atmosphere,
    imagePrompt: body.image_prompt,
    videoPrompt: body.video_prompt,
    composedImage: body.composed_image ? normalizeMediaSlotValue(body.composed_image) : null,
    firstFrameImage: body.first_frame_image ? normalizeMediaSlotValue(body.first_frame_image) : null,
    lastFrameImage: body.last_frame_image ? normalizeMediaSlotValue(body.last_frame_image) : null,
    sceneId: body.scene_id,
    duration: body.duration || 10,
    createdAt: ts,
    updatedAt: ts,
  })
  await syncStoryboardCharacters(getInsertId(res), body.character_ids || [])
  await syncStoryboardProps(getInsertId(res), body.prop_ids || [])
  const [result] = await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.id, getInsertId(res)))
  logTaskSuccess('StoryboardAPI', 'create', {
    storyboardId: result.id,
    episodeId: result.episodeId,
    shotNumber: result.storyboardNumber,
  })
  return created(c, {
    ...toSnakeCase(result),
    character_ids: await getStoryboardCharacterIds(result.id),
    prop_ids: await getStoryboardPropIds(result.id),
  })
})

// PUT /storyboards/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const access = checkStoryboardIdAccess(id, 'write')
  if (!access.ok) return respondAccessDenied(c, access)
  const storyboard = access.storyboard!

  const body = await c.req.json()
  logTaskStart('StoryboardAPI', 'update', {
    storyboardId: id,
    episodeId: storyboard.episodeId,
    fields: Object.keys(body),
  })
  logTaskPayload('StoryboardAPI', 'update body', body)

  const fieldMap: Record<string, string> = {
    storyboard_number: 'storyboardNumber',
    title: 'title', description: 'description', shot_type: 'shotType',
    angle: 'angle', movement: 'movement', duration: 'duration',
    video_prompt: 'videoPrompt',
    image_prompt: 'imagePrompt', scene_id: 'sceneId', location: 'location',
    time: 'time', atmosphere: 'atmosphere', result: 'result',
    bgm_prompt: 'bgmPrompt', sound_effect: 'soundEffect',
    video_url: 'videoUrl',
    composed_image: 'composedImage',
    first_frame_image: 'firstFrameImage',
    last_frame_image: 'lastFrameImage',
    reference_images: 'referenceImages',
  }

  const mediaKeys = new Set(['video_url', 'composed_image', 'first_frame_image', 'last_frame_image'])

  const updates: Record<string, any> = { updatedAt: now() }
  try {
    for (const [snakeKey, camelKey] of Object.entries(fieldMap)) {
      if (snakeKey in body) {
        updates[camelKey] = mediaKeys.has(snakeKey)
          ? normalizeMediaSlotValue(body[snakeKey])
          : body[snakeKey]
      }
    }
  } catch (err: any) {
    return badRequest(c, err.message)
  }

  await validateStoryboardBindings(
    storyboard.episodeId,
    'scene_id' in body ? body.scene_id : storyboard.sceneId,
    'character_ids' in body ? body.character_ids : await getStoryboardCharacterIds(id),
    'prop_ids' in body ? body.prop_ids : await getStoryboardPropIds(id),
  )

  await db.update(schema.storyboards).set(updates).where(eq(schema.storyboards.id, id))
  if ('character_ids' in body) await syncStoryboardCharacters(id, body.character_ids || [])
  if ('prop_ids' in body) await syncStoryboardProps(id, body.prop_ids || [])
  logTaskSuccess('StoryboardAPI', 'update', {
    storyboardId: id,
    updatedFields: Object.keys(updates),
    characterIds: body.character_ids,
    propIds: body.prop_ids,
  })
  return success(c)
})

// POST /storyboards/:id/extract-frame — 从分镜视频抽取首帧/尾帧/指定秒数帧，支持一键接力写入本镜或下一镜
app.post('/:id/extract-frame', async (c) => {
  const id = Number(c.req.param('id'))
  const access = checkStoryboardIdAccess(id, 'write')
  if (!access.ok) return respondAccessDenied(c, access)
  const storyboard = access.storyboard!

  const body = await c.req.json().catch(() => ({}))
  const position = body.position === 'first' || body.position === 'timestamp' ? body.position : 'last'
  const timestamp = typeof body.timestamp === 'number' ? body.timestamp : undefined
  const applyTo = body.apply_to as 'first_frame' | 'last_frame' | 'next_first_frame' | 'none' | undefined

  try {
    const sourceVideo = body.source_video_url
      ? normalizeMediaSlotValue(body.source_video_url)
      : storyboard.videoUrl
    if (!sourceVideo) {
      return badRequest(c, '当前分镜尚未生成本地视频，无法抽取关键帧')
    }

    const framePath = await extractVideoFrame(sourceVideo, { position, timestamp })
    let updatedStoryboardId: number | null = null
    let updatedField: string | null = null

    if (applyTo === 'first_frame') {
      await db.update(schema.storyboards)
        .set({ firstFrameImage: framePath, updatedAt: now() })
        .where(eq(schema.storyboards.id, id))
      updatedStoryboardId = id
      updatedField = 'first_frame_image'
    } else if (applyTo === 'last_frame') {
      await db.update(schema.storyboards)
        .set({ lastFrameImage: framePath, updatedAt: now() })
        .where(eq(schema.storyboards.id, id))
      updatedStoryboardId = id
      updatedField = 'last_frame_image'
    } else if (applyTo === 'next_first_frame') {
      let targetSb: typeof schema.storyboards.$inferSelect | undefined
      if (body.target_storyboard_id) {
        const [candidate] = await db.select().from(schema.storyboards)
          .where(eq(schema.storyboards.id, Number(body.target_storyboard_id)))
        if (!candidate || candidate.episodeId !== storyboard.episodeId) {
          return badRequest(c, '目标分镜不存在或不属于同一集')
        }
        targetSb = candidate
      } else {
        const episodeSbs = await db.select().from(schema.storyboards)
          .where(eq(schema.storyboards.episodeId, storyboard.episodeId))
          .orderBy(asc(schema.storyboards.storyboardNumber), asc(schema.storyboards.id))
        const curIdx = episodeSbs.findIndex(s => s.id === id)
        if (curIdx === -1 || curIdx >= episodeSbs.length - 1) {
          return badRequest(c, '当前已是最后一镜，没有可接力的下一镜')
        }
        targetSb = episodeSbs[curIdx + 1]
      }
      await db.update(schema.storyboards)
        .set({ firstFrameImage: framePath, updatedAt: now() })
        .where(eq(schema.storyboards.id, targetSb.id))
      updatedStoryboardId = targetSb.id
      updatedField = 'first_frame_image'
    }

    logTaskSuccess('StoryboardAPI', 'extract-frame', {
      storyboardId: id,
      position,
      framePath,
      updatedStoryboardId,
      updatedField,
    })

    return success(c, {
      path: framePath,
      url: `/${framePath}`,
      updated_storyboard_id: updatedStoryboardId,
      updated_field: updatedField,
    })
  } catch (err: any) {
    logTaskError('StoryboardAPI', 'extract-frame', { storyboardId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// DELETE /storyboards/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const access = checkStoryboardIdAccess(id, 'write')
  if (!access.ok) return respondAccessDenied(c, access)

  logTaskStart('StoryboardAPI', 'delete', { storyboardId: id })
  await db.delete(schema.storyboardCharacters).where(eq(schema.storyboardCharacters.storyboardId, id))
  await db.delete(schema.storyboardProps).where(eq(schema.storyboardProps.storyboardId, id))
  await db.delete(schema.storyboards).where(eq(schema.storyboards.id, id))
  logTaskSuccess('StoryboardAPI', 'delete', { storyboardId: id })
  return success(c)
})

export default app
