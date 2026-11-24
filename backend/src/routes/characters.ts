import { Hono } from 'hono'
import { registerAssetReferenceRoutes } from '../services/asset-reference.js'
import { bodyLimit } from 'hono/body-limit'
import { and, eq, isNull } from 'drizzle-orm'
import fs from 'node:fs/promises'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, badRequest, notFound, now } from '../utils/response.js'
import { AUDIO_MAX_BYTES, AudioUploadError, saveAudioUpload } from '../utils/audio-upload.js'
import { getAbsolutePath } from '../utils/storage.js'
import { toSnakeCase } from '../utils/transform.js'
import { generateImage } from '../services/generation.js'
import { getDramaStylePrompt } from '../services/style-preset.js'
import { ensureCharacterFinalPrompt } from '../services/final-prompt.js'
import { checkCharacterIdAccess, checkDramaIdAccess, checkEpisodeIdAccess, respondAccessDenied } from '../services/team-access.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()
registerAssetReferenceRoutes(app, 'character')
const CHARACTER_IMAGE_SIZE = '1920x1080'

// 用户上传的角色音色样本独立于生图和 AI 提取，跨剧集复用同一个角色绑定。
app.post('/:id/voice', bodyLimit({ maxSize: AUDIO_MAX_BYTES + 64 * 1024,
  onError: c => badRequest(c, '音频文件大小不能超过 20MB'),
}), async c => {
  const id = Number(c.req.param('id'))
  if (!Number.isSafeInteger(id) || id <= 0) return badRequest(c, '角色编号无效')
  const access = checkCharacterIdAccess(id, 'write')
  if (!access.ok) return respondAccessDenied(c, access)

  const condition = and(eq(schema.characters.id, id), isNull(schema.characters.deletedAt))
  let uploadedPath: string | undefined
  try {
    const body = await c.req.parseBody()
    const audio = await saveAudioUpload(body.file)
    uploadedPath = audio.path
    const updated = db.update(schema.characters)
      .set({ voiceAudioUrl: audio.path, voiceAudioName: audio.name, updatedAt: now() })
      .where(condition).returning({ id: schema.characters.id }).get()
    if (!updated) {
      await fs.unlink(getAbsolutePath(audio.path))
      return notFound(c, '角色不存在')
    }
    return success(c, { voice_audio_url: audio.path, voice_audio_name: audio.name })
  } catch (error) {
    if (uploadedPath) await fs.unlink(getAbsolutePath(uploadedPath)).catch(() => {})
    if (error instanceof AudioUploadError) return badRequest(c, error.message)
    throw error
  }
})

// 只移除角色绑定，不删除可能仍被引用的媒体文件。
app.delete('/:id/voice', async c => {
  const id = Number(c.req.param('id'))
  if (!Number.isSafeInteger(id) || id <= 0) return badRequest(c, '角色编号无效')
  const access = checkCharacterIdAccess(id, 'write')
  if (!access.ok) return respondAccessDenied(c, access)

  const updated = db.update(schema.characters)
    .set({ voiceAudioUrl: null, voiceAudioName: null, updatedAt: now() })
    .where(and(eq(schema.characters.id, id), isNull(schema.characters.deletedAt)))
    .returning({ id: schema.characters.id }).get()
  if (!updated) return notFound(c, '角色不存在')
  return success(c, { voice_audio_url: null, voice_audio_name: null })
})

// POST /characters — 手动新增角色（传入 episode_id 时关联到该集）
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.drama_id) return badRequest(c, 'drama_id 必填')
  if (!body.name?.trim()) return badRequest(c, '名称必填')
  const dramaAccess = checkDramaIdAccess(Number(body.drama_id), 'write')
  if (!dramaAccess.ok) return respondAccessDenied(c, dramaAccess)
  if (body.episode_id) {
    const epAccess = checkEpisodeIdAccess(Number(body.episode_id), 'write')
    if (!epAccess.ok) return respondAccessDenied(c, epAccess)
    if (epAccess.episode!.dramaId !== Number(body.drama_id)) return badRequest(c, '剧集与项目不匹配')
  }

  const ts = now()
  const res = await db.insert(schema.characters).values({
    name: body.name.trim(),
    role: body.role || '',
    description: body.description || '',
    appearance: body.appearance || '',
    styling: body.styling || '',
    dramaId: Number(body.drama_id),
    createdAt: ts,
    updatedAt: ts,
  })
  const charId = getInsertId(res)
  if (body.episode_id) {
    const existing = await db.select().from(schema.episodeCharacters)
      .where(and(eq(schema.episodeCharacters.episodeId, Number(body.episode_id)), eq(schema.episodeCharacters.characterId, charId)))
    if (!existing.length) {
      await db.insert(schema.episodeCharacters).values({ episodeId: Number(body.episode_id), characterId: charId, createdAt: ts })
    }
  }
  const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, charId))
  return created(c, toSnakeCase(row))
})

function characterImagePrompt(char: typeof schema.characters.$inferSelect, stylePrompt = '') {
  return [
    stylePrompt || '',
    char.name,
    char.appearance || char.description || '',
    '角色三视图设定图，同一画面从左到右并排展示正面全身、侧面全身、背面全身三个视角，同一人物外观服饰完全一致，纯白干净背景，无文字水印',
  ].filter(Boolean).join(', ')
}

// PUT /characters/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const access = checkCharacterIdAccess(id, 'write')
  if (!access.ok) return respondAccessDenied(c, access)

  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.name !== undefined) updates.name = body.name
  if (body.role !== undefined) updates.role = body.role
  if (body.description !== undefined) updates.description = body.description
  if (body.appearance !== undefined) updates.appearance = body.appearance
  if (body.styling !== undefined) updates.styling = body.styling
  if (body.image_url !== undefined) updates.imageUrl = body.image_url
  else if (body.imageUrl !== undefined) updates.imageUrl = body.imageUrl
  if (body.local_path !== undefined) updates.localPath = body.local_path
  else if (body.localPath !== undefined) updates.localPath = body.localPath
  // 手动编辑最终提示词时以传入值为准；未传入则保留原值（修改信息时不再自动置空）
  if (body.final_prompt !== undefined) updates.finalPrompt = body.final_prompt || null
  else if (body.finalPrompt !== undefined) updates.finalPrompt = body.finalPrompt || null
  await db.update(schema.characters).set(updates).where(eq(schema.characters.id, id))
  return success(c)
})

// DELETE /characters/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const access = checkCharacterIdAccess(id, 'write')
  if (!access.ok) return respondAccessDenied(c, access)

  await db.update(schema.characters).set({ deletedAt: now() }).where(eq(schema.characters.id, id))
  return success(c)
})

// POST /characters/:id/generate-image
app.post('/:id/generate-image', async (c) => {
  const id = Number(c.req.param('id'))
  const access = checkCharacterIdAccess(id, 'write')
  if (!access.ok) return respondAccessDenied(c, access)
  const char = access.character!

  const body = await c.req.json()
  if (!body.episode_id) return badRequest(c, 'episode_id 必填')

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep || ep.dramaId !== char.dramaId) return badRequest(c, '剧集不存在')

  try {
    const stylePrompt = await getDramaStylePrompt(char.dramaId)
    const finalPrompt = await ensureCharacterFinalPrompt(char, ep.id, false, { model: body.text_model, configId: body.text_config_id ?? undefined })
    const prompt = finalPrompt || characterImagePrompt(char, stylePrompt)
    logTaskStart('CharacterImage', 'generate', { characterId: id, episodeId: ep.id, dramaId: char.dramaId })
    const genId = await generateImage({ characterId: id, dramaId: char.dramaId, prompt, model: body.model, size: CHARACTER_IMAGE_SIZE, configId: body.config_id ?? ep.imageConfigId ?? undefined })
    logTaskSuccess('CharacterImage', 'generate', { characterId: id, generationId: genId })
    return success(c, { image_generation_id: genId })
  } catch (err: any) {
    logTaskError('CharacterImage', 'generate', { characterId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /characters/:id/generate-prompt — 独立生成/重新生成三视图最终提示词（不生图）
app.post('/:id/generate-prompt', async (c) => {
  const id = Number(c.req.param('id'))
  const access = checkCharacterIdAccess(id, 'write')
  if (!access.ok) return respondAccessDenied(c, access)
  const char = access.character!

  const body = await c.req.json()
  if (!body.episode_id) return badRequest(c, 'episode_id 必填')

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep || ep.dramaId !== char.dramaId) return badRequest(c, '剧集不存在')

  try {
    logTaskStart('FinalPrompt', 'character-generate', { characterId: id, episodeId: ep.id, force: !!body.force })
    const finalPrompt = await ensureCharacterFinalPrompt(char, ep.id, !!body.force, { model: body.text_model, configId: body.text_config_id ?? undefined })
    if (!finalPrompt) {
      logTaskError('FinalPrompt', 'character-generate', { characterId: id, error: 'agent returned empty prompt' })
      return badRequest(c, '最终提示词生成失败，请重试')
    }
    logTaskSuccess('FinalPrompt', 'character-generate', { characterId: id })
    return success(c, { final_prompt: finalPrompt })
  } catch (err: any) {
    return badRequest(c, err.message || '提示词生成失败')
  }
})

// POST /characters/batch-generate-images
app.post('/batch-generate-images', async (c) => {
  const body = await c.req.json()
  const ids: number[] = body.character_ids || []
  if (!body.episode_id) return badRequest(c, 'episode_id 必填')
  const epAccess = checkEpisodeIdAccess(Number(body.episode_id), 'write')
  if (!epAccess.ok) return respondAccessDenied(c, epAccess)
  const ep = epAccess.episode!

  const results: number[] = []
  const stylePrompt = await getDramaStylePrompt(ep.dramaId)
  for (const cid of ids) {
    const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, Number(cid)))
    if (!char || char.dramaId !== ep.dramaId || char.deletedAt) continue
    try {
      const finalPrompt = await ensureCharacterFinalPrompt(char, ep.id, false, { model: body.text_model, configId: body.text_config_id ?? undefined })
      const prompt = finalPrompt || characterImagePrompt(char, stylePrompt)
      const genId = await generateImage({ characterId: Number(cid), dramaId: char.dramaId, prompt, model: body.model, size: CHARACTER_IMAGE_SIZE, configId: body.config_id ?? ep.imageConfigId ?? undefined })
      results.push(genId)
    } catch {}
  }
  logTaskSuccess('CharacterImage', 'batch-generate', { episodeId: ep.id, requested: ids.length, started: results.length })
  return success(c, { count: results.length, ids: results })
})

export default app
