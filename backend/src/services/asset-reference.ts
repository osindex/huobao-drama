import { and, eq, isNull } from 'drizzle-orm'
import type { Hono } from 'hono'
import { db, schema } from '../db/index.js'
import { success, badRequest, now } from '../utils/response.js'
import {
  checkCharacterIdAccess,
  checkPropIdAccess,
  checkSceneIdAccess,
  respondAccessDenied,
  type AccessMode,
} from './team-access.js'

const tables = { character: schema.characters, scene: schema.scenes, prop: schema.props }
export type AssetKind = keyof typeof tables
const labels = { character: '角色', scene: '场景', prop: '道具' }

function asset(kind: AssetKind, id: number) {
  const table = tables[kind]
  return db.select().from(table).where(and(eq(table.id, id), isNull(table.deletedAt))).get()
}

function sourceFor(kind: AssetKind, target: NonNullable<ReturnType<typeof asset>>, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0 || id === target.id) throw new Error('请选择其他有效的参考素材')
  const source = asset(kind, id)
  if (!source || source.dramaId !== target.dramaId) throw new Error('参考素材不存在、已删除或不属于当前项目')
  if (!source.imageUrl) throw new Error('参考素材尚无图片，请先生成或上传图片')
  return source
}

function checkAssetAccess(kind: AssetKind, id: number, mode: AccessMode) {
  if (kind === 'character') return checkCharacterIdAccess(id, mode)
  if (kind === 'scene') return checkSceneIdAccess(id, mode)
  return checkPropIdAccess(id, mode)
}

/** Reference settings are independent of the final-prompt editor. */
export function registerAssetReferenceRoutes(app: Hono, kind: AssetKind) {
  app.get('/:id/reference', c => {
    const id = Number(c.req.param('id'))
    const target = asset(kind, id)
    if (!target) return badRequest(c, '素材不存在')
    const access = checkAssetAccess(kind, id, 'read')
    if (!access.ok) return respondAccessDenied(c, access)
    const table = tables[kind]
    const candidates = db.select().from(table).where(and(eq(table.dramaId, target.dramaId), isNull(table.deletedAt))).all()
      .filter(row => row.id !== target.id)
      .map(row => ({ id: row.id, name: 'name' in row ? row.name : row.location, image_url: row.imageUrl }))
    return success(c, { reference_asset_id: target.referenceAssetId, reference_note: target.referenceNote || '', candidates })
  })
  app.put('/:id/reference', async c => {
    try {
      const targetId = Number(c.req.param('id'))
      const target = asset(kind, targetId)
      if (!target) return badRequest(c, '素材不存在')
      const access = checkAssetAccess(kind, targetId, 'write')
      if (!access.ok) return respondAccessDenied(c, access)
      const body = await c.req.json()
      const id = body.reference_asset_id
      if (id !== null && (!Number.isSafeInteger(id) || id <= 0)) return badRequest(c, '参考素材编号无效')
      if (typeof body.reference_note !== 'string' || body.reference_note.length > 4000) return badRequest(c, '调整说明必须为不超过 4000 字的文本')
      if (id !== null) sourceFor(kind, target, id)
      const table = tables[kind]
      db.update(table).set({ referenceAssetId: id, referenceNote: body.reference_note.trim(), updatedAt: now() })
        .where(eq(table.id, target.id)).run()
      return success(c, { reference_asset_id: id, reference_note: body.reference_note.trim() })
    } catch (error) { return badRequest(c, (error as Error).message) }
  })
}

export function resolveAssetReference(kind: AssetKind, id: number, prompt: string) {
  const target = asset(kind, id)
  if (!target) throw new Error('素材不存在或已删除')
  if (!target.referenceAssetId) return null
  const source = sourceFor(kind, target, target.referenceAssetId)
  const identity = kind === 'character' ? '保持同一人物的五官、身份和主要外貌特征'
    : kind === 'scene' ? '保持同一场景的主要空间布局和建筑特征，画面中没有人物'
      : '保持同一道具或武器的主要形制、结构与辨识特征'
  return {
    referenceImages: [source.imageUrl!],
    referenceAsset: { kind, id: source.id },
    prompt: `以提供的${labels[kind]}参考图为基础生成新的状态图。${identity}；仅根据下述要求调整，不要生成另一个无关主体。\n目标画面：${prompt}\n状态调整要求（优先于目标画面中的冲突描述）：${target.referenceNote || '依据目标画面描述调整状态，保持主体一致。'}`,
  }
}
