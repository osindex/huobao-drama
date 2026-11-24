/**
 * 多租户团队隔离、项目可见性与角色权限校验服务。
 *
 * 设计原则：
 * - 当未启用认证（桌面版或无 AUTH_PASSWORD 的单测）时，getRequestActor() 返回 null，所有校验无感放行。
 * - 当启用认证后，严格按当前会话/API Key 激活的 team_id 隔离所有项目与任务数据：
 *   - 跨团队资源一律返回 404（避免探测其他团队的项目 ID）。
 *   - 团队内可见性支持团队管理员配置：
 *     - 'team_shared'：本团队所有成员可见，owner/admin/member 可编辑，viewer 只读。
 *     - 'creator_only'：仅项目创建者、团队 owner/admin、以及 drama_shares 显式授权的成员可见/可编辑。
 *   - 单个项目亦可通过 dramas.visibility 覆盖团队默认可见性。
 */
import type { Context, MiddlewareHandler } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { authEnabled, getRequestActor, type ActorContext } from './auth.js'

export type AccessMode = 'read' | 'write'

export interface AccessCheckResult {
  ok: boolean
  status?: 403 | 404
  message?: string
}

export function isTeamAdmin(actor: ActorContext | null = getRequestActor()): boolean {
  if (!actor) return !authEnabled()
  return actor.membership.role === 'owner' || actor.membership.role === 'admin'
}

export function isSuperAdmin(actor: ActorContext | null = getRequestActor()): boolean {
  if (!actor) return !authEnabled()
  return actor.user.isSuperAdmin
}

export function canWriteInTeam(actor: ActorContext | null = getRequestActor()): boolean {
  if (!actor) return !authEnabled()
  return actor.membership.role !== 'viewer'
}

export const requireSuperAdmin: MiddlewareHandler = async (c, next) => {
  if (!authEnabled()) return next()
  const actor = getRequestActor()
  if (!actor || !actor.user.isSuperAdmin) {
    return c.json({ code: 403, message: '需要平台超级管理员权限' }, 403)
  }
  return next()
}

export function effectiveDramaVisibility(
  drama: Pick<typeof schema.dramas.$inferSelect, 'visibility'>,
  team: Pick<typeof schema.teams.$inferSelect, 'projectVisibility'>,
): 'team_shared' | 'creator_only' {
  if (drama.visibility === 'team_shared' || drama.visibility === 'creator_only') {
    return drama.visibility
  }
  return team.projectVisibility === 'creator_only' ? 'creator_only' : 'team_shared'
}

export function checkDramaRecordAccess(
  drama: typeof schema.dramas.$inferSelect | undefined | null,
  mode: AccessMode = 'read',
  actor: ActorContext | null = getRequestActor(),
): AccessCheckResult {
  if (!drama || drama.deletedAt) {
    return { ok: false, status: 404, message: '剧本不存在' }
  }
  if (!actor) {
    return { ok: true }
  }
  if (drama.teamId !== actor.team.id) {
    return { ok: false, status: 404, message: '剧本不存在' }
  }
  if (mode === 'write' && !canWriteInTeam(actor)) {
    return { ok: false, status: 403, message: '当前团队角色为只读访客，无权修改项目内容' }
  }

  const vis = effectiveDramaVisibility(drama, actor.team)
  if (vis === 'team_shared') {
    return { ok: true }
  }

  // creator_only 模式：团队 owner/admin 或创建者本人直接放行
  if (isTeamAdmin(actor) || drama.createdBy === actor.user.id) {
    return { ok: true }
  }

  // 检查单项目共享表 drama_shares
  const share = db.select().from(schema.dramaShares)
    .where(and(eq(schema.dramaShares.dramaId, drama.id), eq(schema.dramaShares.userId, actor.user.id)))
    .get()
  if (!share) {
    return { ok: false, status: 404, message: '剧本不存在或未向您共享' }
  }
  if (mode === 'write' && share.permission !== 'edit') {
    return { ok: false, status: 403, message: '您对该项目仅有查看权限，无权编辑' }
  }
  return { ok: true }
}

export function canManageDramaSharing(
  drama: typeof schema.dramas.$inferSelect,
  actor: ActorContext | null = getRequestActor(),
): boolean {
  if (!actor) return true
  if (drama.teamId !== actor.team.id) return false
  return isTeamAdmin(actor) || drama.createdBy === actor.user.id
}

export function filterVisibleDramas<T extends typeof schema.dramas.$inferSelect>(
  rows: T[],
  actor: ActorContext | null = getRequestActor(),
): T[] {
  if (!actor) return rows
  const teamRows = rows.filter(d => d.teamId === actor.team.id)
  if (isTeamAdmin(actor)) return teamRows

  const shares = db.select().from(schema.dramaShares)
    .where(eq(schema.dramaShares.userId, actor.user.id))
    .all()
  const sharedIds = new Set(shares.map(s => s.dramaId))

  return teamRows.filter(d => {
    const vis = effectiveDramaVisibility(d, actor.team)
    if (vis === 'team_shared') return true
    return d.createdBy === actor.user.id || sharedIds.has(d.id)
  })
}

export function checkDramaIdAccess(dramaId: number | null | undefined, mode: AccessMode = 'read'): AccessCheckResult & { drama?: typeof schema.dramas.$inferSelect } {
  if (!dramaId || !Number.isSafeInteger(Number(dramaId))) {
    return { ok: false, status: 404, message: '剧本不存在' }
  }
  const drama = db.select().from(schema.dramas).where(eq(schema.dramas.id, Number(dramaId))).get()
  const res = checkDramaRecordAccess(drama, mode)
  return res.ok ? { ...res, drama: drama! } : res
}

function checkParentDramaAccess(dramaId: number | null | undefined, mode: AccessMode): AccessCheckResult & { drama?: typeof schema.dramas.$inferSelect } {
  const actor = getRequestActor()
  if (!dramaId || !Number.isSafeInteger(Number(dramaId))) {
    return actor ? { ok: false, status: 404, message: '剧本不存在' } : { ok: true }
  }
  const drama = db.select().from(schema.dramas).where(eq(schema.dramas.id, Number(dramaId))).get()
  if (!drama) {
    return actor ? { ok: false, status: 404, message: '剧本不存在' } : { ok: true }
  }
  const res = checkDramaRecordAccess(drama, mode, actor)
  return res.ok ? { ...res, drama } : res
}

export function checkEpisodeIdAccess(episodeId: number | null | undefined, mode: AccessMode = 'read'): AccessCheckResult & {
  episode?: typeof schema.episodes.$inferSelect
  drama?: typeof schema.dramas.$inferSelect
} {
  if (!episodeId || !Number.isSafeInteger(Number(episodeId))) {
    return { ok: false, status: 404, message: '剧集不存在' }
  }
  const episode = db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.id, Number(episodeId)), isNull(schema.episodes.deletedAt)))
    .get()
  if (!episode) return { ok: false, status: 404, message: '剧集不存在' }
  const dramaRes = checkParentDramaAccess(episode.dramaId, mode)
  if (!dramaRes.ok) return dramaRes
  return { ok: true, episode, drama: dramaRes.drama }
}

export function checkStoryboardIdAccess(storyboardId: number | null | undefined, mode: AccessMode = 'read'): AccessCheckResult & {
  storyboard?: typeof schema.storyboards.$inferSelect
  episode?: typeof schema.episodes.$inferSelect
  drama?: typeof schema.dramas.$inferSelect
} {
  if (!storyboardId || !Number.isSafeInteger(Number(storyboardId))) {
    return { ok: false, status: 404, message: '镜头不存在' }
  }
  const storyboard = db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.id, Number(storyboardId)))
    .get()
  if (!storyboard) return { ok: false, status: 404, message: '镜头不存在' }
  const actor = getRequestActor()
  const episode = db.select().from(schema.episodes)
    .where(eq(schema.episodes.id, storyboard.episodeId))
    .get()
  if (!episode) {
    return actor ? { ok: false, status: 404, message: '剧集不存在' } : { ok: true, storyboard }
  }
  if (episode.deletedAt) return { ok: false, status: 404, message: '剧集不存在' }
  const dramaRes = checkParentDramaAccess(episode.dramaId, mode)
  if (!dramaRes.ok) return dramaRes
  return { ok: true, storyboard, episode, drama: dramaRes.drama }
}

export function checkCharacterIdAccess(characterId: number | null | undefined, mode: AccessMode = 'read'): AccessCheckResult & {
  character?: typeof schema.characters.$inferSelect
} {
  if (!characterId || !Number.isSafeInteger(Number(characterId))) {
    return { ok: false, status: 404, message: '角色不存在' }
  }
  const character = db.select().from(schema.characters)
    .where(and(eq(schema.characters.id, Number(characterId)), isNull(schema.characters.deletedAt)))
    .get()
  if (!character) return { ok: false, status: 404, message: '角色不存在' }
  const dramaRes = checkParentDramaAccess(character.dramaId, mode)
  if (!dramaRes.ok) return dramaRes
  return { ok: true, character }
}

export function checkSceneIdAccess(sceneId: number | null | undefined, mode: AccessMode = 'read'): AccessCheckResult & {
  scene?: typeof schema.scenes.$inferSelect
} {
  if (!sceneId || !Number.isSafeInteger(Number(sceneId))) {
    return { ok: false, status: 404, message: '场景不存在' }
  }
  const scene = db.select().from(schema.scenes)
    .where(and(eq(schema.scenes.id, Number(sceneId)), isNull(schema.scenes.deletedAt)))
    .get()
  if (!scene) return { ok: false, status: 404, message: '场景不存在' }
  const dramaRes = checkParentDramaAccess(scene.dramaId, mode)
  if (!dramaRes.ok) return dramaRes
  return { ok: true, scene }
}

export function checkPropIdAccess(propId: number | null | undefined, mode: AccessMode = 'read'): AccessCheckResult & {
  prop?: typeof schema.props.$inferSelect
} {
  if (!propId || !Number.isSafeInteger(Number(propId))) {
    return { ok: false, status: 404, message: '道具不存在' }
  }
  const prop = db.select().from(schema.props)
    .where(and(eq(schema.props.id, Number(propId)), isNull(schema.props.deletedAt)))
    .get()
  if (!prop) return { ok: false, status: 404, message: '道具不存在' }
  const dramaRes = checkParentDramaAccess(prop.dramaId, mode)
  if (!dramaRes.ok) return dramaRes
  return { ok: true, prop }
}

export function checkTaskRecordAccess(
  task: typeof schema.sysTask.$inferSelect | undefined | null,
  mode: AccessMode = 'read',
  actor: ActorContext | null = getRequestActor(),
): AccessCheckResult {
  if (!task) return { ok: false, status: 404, message: '任务不存在' }
  if (!actor) return { ok: true }
  if (task.teamId && task.teamId !== actor.team.id) {
    return { ok: false, status: 404, message: '任务不存在' }
  }
  if (mode === 'write' && !canWriteInTeam(actor)) {
    return { ok: false, status: 403, message: '当前团队角色为只读访客，无权操作任务' }
  }
  if (task.dramaId) {
    return checkDramaIdAccess(task.dramaId, mode)
  }
  return { ok: true }
}

export function respondAccessDenied(c: Context, res: AccessCheckResult) {
  const code = res.status || 403
  return c.json({ code, message: res.message || (code === 404 ? '资源不存在' : '无权访问') }, code)
}

/** 校验非超管用户提交的 BYOK Base URL，防止利用服务端请求探测宿主机/内网地址（SSRF） */
export function validateSafeExternalBaseUrl(rawUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return 'Base URL 格式无效，请填写完整的 https:// 地址'
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'Base URL 仅支持 http/https 协议'
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    host === 'localhost'
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host === '::1'
    || host === '0.0.0.0'
    || host.startsWith('127.')
    || host.startsWith('10.')
    || host.startsWith('192.168.')
    || host.startsWith('169.254.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    || /^fc00:|^fd00:|^fe80:/i.test(host)
  ) {
    return '团队自定义模型端点不允许指向本地或局域网私有地址'
  }
  return null
}
