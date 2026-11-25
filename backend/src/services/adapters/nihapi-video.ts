import type { AIConfig, VideoGenerationRecord, VideoProviderAdapter, VideoGenResponse, VideoPollResponse, ProviderRequest } from './types'
import { joinProviderUrl } from './url'

// Public model IDs and parameter limits from nihapi.com/docs (2026-11-21).
// These are relay aliases, not claims about the underlying official models.
type Profile = { min: number; max: number; resolutions: string[]; images: number; videos?: number; audios?: number; seconds?: boolean; frames?: 'first' | 'pair'; dataImages?: boolean; durations?: number[] }
const seedance: Profile = { min: 5, max: 30, resolutions: ['720p'], images: 30, videos: 10, audios: 10, seconds: true }
const tiered: Profile = { min: 2, max: 15, resolutions: ['480p', '768p'], images: 9, seconds: true, frames: 'pair', dataImages: true }
export const nihapiVideoProfiles: Record<string, Profile> = {
  'MiniMax-H3-LH': { min: 4, max: 15, resolutions: ['480p', '768'], images: 9 },
  'kling-v4.0-flash': { min: 5, max: 11, resolutions: ['720p'], images: 10, frames: 'first' },
  'kling-v4.0': { min: 5, max: 6, resolutions: ['720p'], images: 10, frames: 'pair' },
  'muse-video-60s': { min: 5, max: 60, durations: [5, 10, 15, 20, 30, 40, 50, 60], resolutions: ['720p'], images: 8, videos: 1, audios: 1, dataImages: true },
  'minimax-h3-30s': { min: 2, max: 30, durations: [...Array.from({ length: 14 }, (_, i) => i + 2), 20, 30], resolutions: [], images: 9 },
  'wan3.0-线路七': { min: 2, max: 30, resolutions: ['480p', '720p', '1080p'], images: 10, audios: 5, frames: 'pair' },
  'Seedence-2.5-1080p': { min: 5, max: 30, resolutions: ['1080p'], images: 9, audios: 3 },
  'minimax-h3-base': tiered,
  'minimax-h3-cinematic': tiered,
  'minimax-h3-origin': tiered,
  'muse-video-ext': { min: 2, max: 10, resolutions: ['720p'], images: 9, seconds: true, dataImages: true },
  'nd-seedance-2.0 480p': { ...seedance, min: 15, max: 15, resolutions: ['480p'], images: 9, videos: 3, audios: 3 },
  'nd-seedance-2.0 720p': { ...seedance, min: 15, max: 15, images: 9, videos: 3, audios: 3 },
  '新满血-seedance2.0': { ...seedance, max: 15, resolutions: ['480p', '720p', '1080p'], images: 9, videos: 0, audios: 3 },
  '新bb-seedance-2.5-720p': seedance,
  'wt-seedance-2.5-720': { ...seedance, min: 4 },
  'hd-seedance-2.5-720p': seedance,
  'mi-seedance2.5-480p': { ...seedance, resolutions: ['480p'], videos: 0 },
  'mi-seedance2.5-720p': { ...seedance, videos: 0 },
  '满血seedance_2.5_flash-480p': { ...seedance, resolutions: ['480p'], images: 10, videos: 5, audios: 5 },
  '满血seedance_2.5_flash-720p': { ...seedance, images: 10, videos: 5, audios: 5 },
  '特惠sd2.5-480p': { ...seedance, resolutions: ['480p'] },
  '特惠sd2.5-720p': seedance,
  '特惠sd2.5-1080p': { ...seedance, resolutions: ['1080p'] },
}

function references(raw?: string | null): string[] {
  if (!raw) return []
  const values = JSON.parse(raw)
  if (!Array.isArray(values) || values.some(v => typeof v !== 'string' || !v.trim())) throw new Error('参考素材必须为非空 URL 数组')
  return values
}

export class NihapiVideoAdapter implements VideoProviderAdapter {
  provider = 'nihapi'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const model = record.model || config.model
    const p = nihapiVideoProfiles[model]
    if (!p) throw new Error(`尚未适配 NIH API 视频模型：${model}`)
    if (!record.prompt?.trim()) throw new Error('视频提示词不能为空')
    if (record.referenceFileUrl || record.referenceLinkUrl) throw new Error('NIH API 不支持当前文件/链接参考模式')
    const images = references(record.referenceImageUrls)
    const videos = references(record.referenceVideoUrls)
    const audios = references(record.referenceAudioUrls)
    const first = record.firstFrameUrl || record.imageUrl
    const last = record.lastFrameUrl
    if (record.firstFrameUrl && record.imageUrl && record.firstFrameUrl !== record.imageUrl) throw new Error('不能同时提供两个不同的首帧')
    if (images.length > p.images || videos.length > (p.videos || 0) || audios.length > (p.audios || 0)) {
      throw new Error(`${model} 当前接入支持参考图片≤${p.images}、视频≤${p.videos || 0}、音频≤${p.audios || 0}；不会丢弃参考素材`)
    }
    if ((first || last) && !p.frames) throw new Error(`${model} 不支持指定首尾帧，请使用参考图模式`)
    if (last && (!first || p.frames !== 'pair')) throw new Error(`${model} 不支持单独尾帧或此尾帧模式`)
    if ((first || last) && (images.length || videos.length || audios.length)) throw new Error('首尾帧不能与参考素材混用')
    if (['kling-v4.0', 'wan3.0-线路七'].includes(model) && first && !last) throw new Error(`${model} 必须同时提供首帧和尾帧`)

    const isTiered = model.startsWith('minimax-h3-') && ['base', 'cinematic', 'origin'].some(s => model.endsWith(s))
    const resolution = record.resolution === '720p' && p.resolutions.some(r => r.startsWith('768'))
      ? p.resolutions.find(r => r.startsWith('768'))! : record.resolution || p.resolutions[0]
    if (p.resolutions.length && !p.resolutions.includes(resolution)) throw new Error(`${model} 分辨率仅支持 ${p.resolutions.join(' / ')}`)
    const duration = record.duration ?? (p.min === p.max ? p.min : 5)
    if (!Number.isInteger(duration) || duration < p.min || duration > p.max || (p.durations && !p.durations.includes(duration))) {
      throw new Error(`${model} 时长支持 ${p.durations?.join('、') || `${p.min}–${p.max}`} 秒`)
    }
    if (isTiered && resolution === '480p' && duration < 4) throw new Error('MiniMax H3 480p 至少需要 4 秒')
    if (model === 'kling-v4.0-flash' && (images.length ? duration !== 11 : ![5, 10].includes(duration))) throw new Error('Kling Flash 参考图模式固定 11 秒，文生/首帧模式为 5 或 10 秒')
    if (model === 'kling-v4.0' && duration !== (images.length ? 6 : 5)) throw new Error('Kling 4.0 参考图模式为 6 秒，文生/首尾帧模式为 5 秒')
    if (model === 'minimax-h3-30s') {
      if (duration <= 15 && images.length > 7) throw new Error('MiniMax H3 标准模式 15 秒以内最多 7 张参考图')
      if (duration >= 20 && !/^-------\s*$/m.test(record.prompt)) throw new Error('20/30 秒视频提示词须用单独一行 ------- 分成两段')
    }
    for (const value of [...images, ...[first, last].filter((v): v is string => !!v)]) {
      if (p.dataImages && /^data:image\//.test(value)) continue
      if (!/^https?:\/\//.test(value)) throw new Error(`${model} 参考图需要公网 URL；本地图片请配置 PUBLIC_BASE_URL，或选用支持 Data URL 的 minimax-h3-base / muse-video-ext`)
    }
    for (const value of [...videos, ...audios]) if (!/^https?:\/\//.test(value)) throw new Error('该模型参考音视频需要公网 URL')
    const body: Record<string, any> = { model, prompt: record.prompt, [p.seconds ? 'seconds' : 'duration_seconds']: duration, aspect_ratio: record.aspectRatio || '16:9' }
    if (resolution) body.resolution = resolution
    if (images.length) {
      if (isTiered) body.metadata = { reference_image_urls: images }
      else body[model === 'muse-video-ext' ? 'image_urls' : p.seconds ? 'images' : 'reference_images'] = images
    }
    if (videos.length) body.reference_videos = videos
    if (audios.length) body.reference_audios = audios
    if (first) {
      if (isTiered) {
        if (last) body.images = [first, last]
        else body.input_reference = first
      } else {
        body.first_frame_url = first
        if (last) body.last_frame_url = last
      }
    }
    if (record.speedTier && !['fast', 'standard'].includes(record.speedTier)) {
      throw new Error('NIH API speed_tier 仅支持 fast 或 standard')
    }
    if (isTiered) {
      body.tier = record.speedTier === 'standard' ? 'standard' : 'fast'
      if (record.seed != null) body.seed = record.seed
    }
    if (model.startsWith('kling-') && record.generateAudio != null) body.audio = Boolean(record.generateAudio)
    if (model === 'MiniMax-H3-LH' && record.promptExtend != null) body.prompt_enhance = Boolean(record.promptExtend)
    return { url: joinProviderUrl(config.baseUrl, '/v1', '/videos'), method: 'POST', headers: this.headers(config), body }
  }

  private headers(config: AIConfig) { return { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 HuobaoDrama' } }

  parseGenerateResponse(result: any): VideoGenResponse {
    const data = result.data || result
    if (data.error || ['failed', 'cancelled', 'canceled'].includes(data.status)) throw new Error(data.error?.message || '视频提交失败')
    if (data.id || data.task_id) return { isAsync: true, taskId: String(data.id || data.task_id) }
    const videoUrl = this.extractVideoUrl(data)
    if (videoUrl) return { isAsync: false, videoUrl }
    throw new Error('NIH API 未返回任务 ID')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return { url: joinProviderUrl(config.baseUrl, '/v1', `/videos/${encodeURIComponent(taskId)}`), method: 'GET', headers: this.headers(config), body: undefined }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const data = result.data || result
    if (['failed', 'cancelled', 'canceled', 'error'].includes(data.status)) return { status: 'failed', error: data.error?.message || data.error || '视频生成失败' }
    if (['completed', 'succeeded', 'success'].includes(data.status)) return { status: 'completed', videoUrl: this.extractVideoUrl(data) || undefined, duration: Number(data.seconds || data.duration_seconds || data.duration) || undefined }
    return { status: data.status === 'queued' ? 'pending' : 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    const data = result.data || result
    return data.video_url || data.url || data.output?.video_url || null
  }

  buildDownloadRequest(config: AIConfig, taskId: string): ProviderRequest {
    const request = this.buildPollRequest(config, taskId)
    return { ...request, url: `${request.url}/content` }
  }
}
