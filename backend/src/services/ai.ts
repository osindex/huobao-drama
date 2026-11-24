/**
 * AI 服务抽象层 — 从数据库配置中获取 provider 和 API key
 */
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { logTaskProgress, logTaskWarn } from '../utils/task-logger.js'
import { joinProviderUrl } from './adapters/url.js'
import { getRequestActor } from './auth.js'

export type ServiceType = 'text' | 'image' | 'video'

export interface AIConfig {
  id?: number
  teamId?: number | null
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  /** 采样温度，null 表示不设置（跟随服务商默认）。存于 ai_service_configs.settings JSON */
  temperature?: number | null
}

/** 从 settings JSON 解析 temperature；非法值一律视为未设置 */
export function parseConfigTemperature(settingsRaw: string | null | undefined): number | null {
  if (!settingsRaw) return null
  try {
    const t = JSON.parse(settingsRaw)?.temperature
    return typeof t === 'number' && Number.isFinite(t) ? t : null
  } catch {
    return null
  }
}

export const officialProviders: Record<ServiceType, readonly string[]> = {
  text: ['openai', 'gemini', 'volcengine'],
  image: ['openai', 'gemini', 'volcengine', 'comfyui'],
  video: ['volcengine', 'minimax', 'aliyun', 'comfyui', 'grok', 'nihapi'],
}

export function isOfficialProvider(serviceType?: string | null, provider?: string | null): boolean {
  const providers = officialProviders[serviceType as ServiceType]
  return !!providers && providers.includes((provider || '').toLowerCase())
}

export function getTextProviderBaseUrl(config: AIConfig) {
  const provider = config.provider.toLowerCase()

  if (provider === 'openai') {
    return joinProviderUrl(config.baseUrl, '/v1', '')
  }

  if (provider === 'gemini') {
    return joinProviderUrl(config.baseUrl, '/v1beta', '')
  }

  if (provider === 'volcengine') {
    return joinProviderUrl(config.baseUrl, '/api/v3', '')
  }

  return config.baseUrl
}

// Agent 多步循环会逐步重复解析同一配置，相同配置只打一次日志避免刷屏
const lastLoggedActiveConfigKey = new Map<string, string>()
const lastLoggedConfigByIdKey = new Map<number, string>()

function canActorUseConfigRow(row: typeof schema.aiServiceConfigs.$inferSelect): boolean {
  const actor = getRequestActor()
  if (!actor) return row.teamId == null
  return row.teamId == null || row.teamId === actor.team.id
}

export async function getActiveConfig(serviceType: ServiceType): Promise<AIConfig | null> {
  const actor = getRequestActor()
  const rows = (await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, serviceType))
  )
    .filter(r => r.isActive && isOfficialProvider(serviceType, r.provider) && canActorUseConfigRow(r))
    .sort((a, b) => {
      // 同优先级下优先使用当前团队自己的 BYOK 配置，否则按 priority 降序
      const pDiff = (b.priority || 0) - (a.priority || 0)
      if (pDiff !== 0) return pDiff
      if (actor) {
        const aOwn = a.teamId === actor.team.id ? 1 : 0
        const bOwn = b.teamId === actor.team.id ? 1 : 0
        if (bOwn !== aOwn) return bOwn - aOwn
      }
      return a.id - b.id
    })

  const active = rows[0]
  if (!active) {
    logTaskWarn('AIConfig', 'active-config-missing', { serviceType })
    return null
  }

  const models = active.model ? JSON.parse(active.model) : []
  const logKey = `${active.id}:${models[0] || ''}`
  if (lastLoggedActiveConfigKey.get(serviceType) !== logKey) {
    lastLoggedActiveConfigKey.set(serviceType, logKey)
    logTaskProgress('AIConfig', 'active-config-selected', {
      serviceType,
      configId: active.id,
      provider: active.provider,
      model: models[0] || '',
      priority: active.priority,
    })
  }
  return {
    id: active.id,
    teamId: active.teamId,
    provider: active.provider || '',
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: models[0] || '',
    temperature: parseConfigTemperature(active.settings),
  }
}

export async function getTextConfig(): Promise<AIConfig> {
  const config = await getActiveConfig('text')
  if (!config) throw new Error('未配置文本模型，请先到「设置」页添加并启用 AI 服务')
  return config
}

/**
 * 取某服务类型当前启用且优先级最高的官方配置 ID（创建集时自动锁定用）
 */
export async function getActiveConfigId(serviceType: ServiceType): Promise<number | null> {
  const actor = getRequestActor()
  const rows = (await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, serviceType))
  )
    .filter(r => r.isActive && isOfficialProvider(serviceType, r.provider) && canActorUseConfigRow(r))
    .sort((a, b) => {
      const pDiff = (b.priority || 0) - (a.priority || 0)
      if (pDiff !== 0) return pDiff
      if (actor) {
        const aOwn = a.teamId === actor.team.id ? 1 : 0
        const bOwn = b.teamId === actor.team.id ? 1 : 0
        if (bOwn !== aOwn) return bOwn - aOwn
      }
      return a.id - b.id
    })
  return rows[0]?.id ?? null
}

export async function getConfigById(id: number, opts?: { internalRecovery?: boolean }): Promise<AIConfig | null> {
  const [row] = await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, id))
  if (!row || !row.isActive) {
    logTaskWarn('AIConfig', 'config-by-id-missing', { configId: id })
    return null
  }
  const actor = getRequestActor()
  if (!opts?.internalRecovery && actor && row.teamId != null && row.teamId !== actor.team.id) {
    logTaskWarn('AIConfig', 'config-by-id-tenant-denied', { configId: id, rowTeamId: row.teamId, actorTeamId: actor.team.id })
    return null
  }
  if (!isOfficialProvider(row.serviceType as ServiceType, row.provider)) {
    logTaskWarn('AIConfig', 'config-by-id-unsupported-provider', {
      configId: id,
      serviceType: row.serviceType,
      provider: row.provider,
    })
    return null
  }
  const models = row.model ? JSON.parse(row.model) : []
  const logKey = `${row.provider}:${models[0] || ''}:${row.serviceType}`
  if (lastLoggedConfigByIdKey.get(id) !== logKey) {
    lastLoggedConfigByIdKey.set(id, logKey)
    logTaskProgress('AIConfig', 'config-by-id-selected', {
      configId: id,
      provider: row.provider,
      model: models[0] || '',
      serviceType: row.serviceType,
    })
  }
  return {
    id: row.id,
    teamId: row.teamId,
    provider: row.provider || '',
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: models[0] || '',
    temperature: parseConfigTemperature(row.settings),
  }
}
