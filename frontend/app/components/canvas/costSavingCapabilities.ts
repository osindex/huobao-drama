/**
 * 省流制片套件（Cost-Saving Production Suite）能力矩阵与计划构建器
 *
 * 1. Turbo / Draft 极速试拍：按厂商真实支持的 fast/lite/flash 模型族或 480p 静音档位生成低成本草稿，
 *    绝不静默替换用户未开启开关的模型，所有模型切换/降档均返回显式徽章与说明。
 * 2. 草稿满意 → 高清精制（HD Reconstruct）：严禁跨分辨率复用随机种子（扩散模型不同分辨率潜空间运动不同）；
 *    优先采用 V2V 参考视频重绘（reference_video_urls），不支持参考视频或未配置公网地址的模型自动回退到
 *    「抽取草稿首尾关键帧 → 高清重制」。
 * 3. FFmpeg 光流升格慢放：提供对话/口型风险检测与慢放时长预估。
 */

export interface NihapiCapRule {
  resolutions: string[]
  videos: number
  frames?: 'first' | 'pair'
  minDuration: number
  maxDuration: number
  tiered?: boolean
}

const NIHAPI_RULES: Record<string, NihapiCapRule> = {
  'MiniMax-H3-LH': { resolutions: ['480p', '768'], videos: 0, minDuration: 4, maxDuration: 15 },
  'kling-v4.0-flash': { resolutions: ['720p'], videos: 0, frames: 'first', minDuration: 5, maxDuration: 11 },
  'kling-v4.0': { resolutions: ['720p'], videos: 0, frames: 'pair', minDuration: 5, maxDuration: 6 },
  'muse-video-60s': { resolutions: ['720p'], videos: 1, minDuration: 5, maxDuration: 60 },
  'minimax-h3-30s': { resolutions: [], videos: 0, minDuration: 2, maxDuration: 30 },
  'wan3.0-线路七': { resolutions: ['480p', '720p', '1080p'], videos: 0, frames: 'pair', minDuration: 2, maxDuration: 30 },
  'Seedence-2.5-1080p': { resolutions: ['1080p'], videos: 0, minDuration: 5, maxDuration: 30 },
  'minimax-h3-base': { resolutions: ['480p', '768p'], videos: 0, frames: 'pair', minDuration: 2, maxDuration: 15, tiered: true },
  'minimax-h3-cinematic': { resolutions: ['480p', '768p'], videos: 0, frames: 'pair', minDuration: 2, maxDuration: 15, tiered: true },
  'minimax-h3-origin': { resolutions: ['480p', '768p'], videos: 0, frames: 'pair', minDuration: 2, maxDuration: 15, tiered: true },
  'muse-video-ext': { resolutions: ['720p'], videos: 0, minDuration: 2, maxDuration: 10 },
  'nd-seedance-2.0 480p': { resolutions: ['480p'], videos: 3, minDuration: 15, maxDuration: 15 },
  'nd-seedance-2.0 720p': { resolutions: ['720p'], videos: 3, minDuration: 15, maxDuration: 15 },
  '新满血-seedance2.0': { resolutions: ['480p', '720p', '1080p'], videos: 0, minDuration: 5, maxDuration: 15 },
  '新bb-seedance-2.5-720p': { resolutions: ['720p'], videos: 10, minDuration: 5, maxDuration: 30 },
  'wt-seedance-2.5-720': { resolutions: ['720p'], videos: 10, minDuration: 4, maxDuration: 30 },
  'hd-seedance-2.5-720p': { resolutions: ['720p'], videos: 10, minDuration: 5, maxDuration: 30 },
  'mi-seedance2.5-480p': { resolutions: ['480p'], videos: 0, minDuration: 5, maxDuration: 30 },
  'mi-seedance2.5-720p': { resolutions: ['720p'], videos: 0, minDuration: 5, maxDuration: 30 },
  '满血seedance_2.5_flash-480p': { resolutions: ['480p'], videos: 5, minDuration: 5, maxDuration: 30 },
  '满血seedance_2.5_flash-720p': { resolutions: ['720p'], videos: 5, minDuration: 5, maxDuration: 30 },
  '特惠sd2.5-480p': { resolutions: ['480p'], videos: 10, minDuration: 5, maxDuration: 30 },
  '特惠sd2.5-720p': { resolutions: ['720p'], videos: 10, minDuration: 5, maxDuration: 30 },
  '特惠sd2.5-1080p': { resolutions: ['1080p'], videos: 10, minDuration: 5, maxDuration: 30 },
}

const NIHAPI_FAST_SIBLINGS: Record<string, string> = {
  'nd-seedance-2.0 720p': 'nd-seedance-2.0 480p',
  'mi-seedance2.5-720p': 'mi-seedance2.5-480p',
  '满血seedance_2.5_flash-720p': '满血seedance_2.5_flash-480p',
  '特惠sd2.5-720p': '特惠sd2.5-480p',
  '特惠sd2.5-1080p': '特惠sd2.5-480p',
}

const NIHAPI_HD_SIBLINGS: Record<string, (epRes?: string | null) => string> = {
  'nd-seedance-2.0 480p': () => 'nd-seedance-2.0 720p',
  'mi-seedance2.5-480p': () => 'mi-seedance2.5-720p',
  '满血seedance_2.5_flash-480p': () => '满血seedance_2.5_flash-720p',
  '特惠sd2.5-480p': (epRes) => epRes === '1080p' ? '特惠sd2.5-1080p' : '特惠sd2.5-720p',
}

const VOICE_TOKEN_RE = /#[^\s#@，。！？；、：,.!?;:「」“”"'（）()[\]{}<>]{1,100}/gu

export function hasPromptVoiceMentions(prompt?: string | null): boolean {
  const text = String(prompt || '')
  if (!text.includes('#')) return false
  for (const m of text.matchAll(VOICE_TOKEN_RE)) {
    if (!/^#\d+$/.test(m[0])) return true
  }
  return false
}

export function hasDialogueLipSyncRisk(storyboard?: any): boolean {
  if (!storyboard) return false
  const text = `${storyboard.video_prompt || storyboard.videoPrompt || ''} ${storyboard.description || ''}`
  if (hasPromptVoiceMentions(text)) return true
  return /说[：:“"「]|道[：:“"「]|喊[：:“"「]|唱|台词|对白|开口说话|口型|嘴唇开合|「.+」|“.+”/.test(text)
}

export function parseTaskParamsSafe(task?: any): Record<string, any> {
  if (!task) return {}
  const raw = task.params
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw) || {}
  } catch {
    return {}
  }
}

export function isTaskDraftVideo(task?: any): boolean {
  return Boolean(parseTaskParamsSafe(task).draftMode)
}

export function isTaskSlowMotionVideo(task?: any): boolean {
  if (!task) return false
  if (task.provider === 'ffmpeg') return true
  return Boolean(parseTaskParamsSafe(task).slowMotion)
}

export interface ResolveTurboDraftInput {
  provider?: string | null
  model?: string | null
  episodeResolution?: string | null
  duration?: number | null
  hasVoiceReference?: boolean
  hasTailFrame?: boolean
  refImageCount?: number
}

export interface TurboDraftPlan {
  model?: string
  swappedModel: boolean
  resolution?: string
  generateAudio: boolean
  speedTier?: 'fast' | 'standard'
  summaryBadge: string
  detailHint: string
}

export function resolveTurboDraftPlan(input: ResolveTurboDraftInput): TurboDraftPlan {
  const p = (input.provider || '').toLowerCase()
  const m = (input.model || '').trim()
  const dur = Number(input.duration || 5)
  const hasVoice = Boolean(input.hasVoiceReference)
  const hasTail = Boolean(input.hasTailFrame)
  const refs = Number(input.refImageCount || 0)

  if (p === 'comfyui') {
    return {
      model: m || undefined,
      swappedModel: false,
      resolution: '480p',
      generateAudio: false,
      summaryBadge: '本地 480p · 合成10步',
      detailHint: '本地 Wan 2.2 以 480p 静音极速出片；若触发首帧自动合成，生图步数由 20 步减至 10 步加速试拍',
    }
  }

  if (p === 'grok') {
    const base = m || 'grok-imagine-video-1.5'
    const canUseLite = !hasTail && refs === 0
    const targetModel = canUseLite
      ? 'grok-imagine-video-1.5-lite'
      : (base.endsWith('-lite') ? 'grok-imagine-video-1.5' : base)
    const swappedModel = targetModel !== base
    return {
      model: targetModel,
      swappedModel,
      resolution: '480p',
      generateAudio: hasVoice,
      summaryBadge: targetModel.endsWith('-lite')
        ? `Grok Lite · 480p${hasVoice ? '' : ' · 静音'}`
        : `Grok 1.5 · 480p${hasVoice ? '' : ' · 静音'}`,
      detailHint: canUseLite
        ? '极速试拍切换至 grok-imagine-video-1.5-lite + 480p 低成本校验构图与运镜'
        : '当前镜头含尾帧或多参考图（Lite 不支持），保持 grok-imagine-video-1.5 并降为 480p 静音省流试拍',
    }
  }

  if (p === 'aliyun') {
    const base = m || 'wan3.0-video'
    const targetModel = base === 'wan3.0-video-prime' ? 'wan3.0-video' : base
    const swappedModel = targetModel !== base
    return {
      model: targetModel,
      swappedModel,
      resolution: '480p',
      generateAudio: hasVoice,
      summaryBadge: `${swappedModel ? 'wan3.0-video · ' : ''}480p${hasVoice ? '' : ' · 静音'}`,
      detailHint: swappedModel
        ? '极速试拍从 wan3.0-video-prime 切换至轻量 wan3.0-video + 480p 试拍，满意后可一键 V2V 高清精制'
        : '以 480p 低分辨率快速验证分镜动作与调度',
    }
  }

  if (p === 'minimax') {
    return {
      model: m || undefined,
      swappedModel: false,
      resolution: '480p',
      generateAudio: hasVoice,
      summaryBadge: `768P 基础档${hasVoice ? '' : ' · 静音'}`,
      detailHint: 'MiniMax H3 使用 768P 基础分辨率试拍（避免消耗 2K 高清配额），满意后可 V2V 升级至高清',
    }
  }

  if (p === 'nihapi') {
    if (m === 'kling-v4.0' && !hasTail && refs === 0 && (dur === 5 || dur === 10)) {
      return {
        model: 'kling-v4.0-flash',
        swappedModel: true,
        resolution: '720p',
        generateAudio: false,
        summaryBadge: 'kling-v4.0-flash · 静音',
        detailHint: '无尾帧/多参考图时切换至 kling-v4.0-flash 静音快速试拍；满意后抽首尾帧交由 kling-v4.0 精制',
      }
    }

    const fastSibling = NIHAPI_FAST_SIBLINGS[m]
    if (fastSibling) {
      return {
        model: fastSibling,
        swappedModel: true,
        resolution: '480p',
        generateAudio: hasVoice,
        summaryBadge: `${fastSibling}`,
        detailHint: `切换至同系列 480p 轻量通道（${fastSibling}）试拍，满意后可切回高清通道精制`,
      }
    }

    const rule = NIHAPI_RULES[m]
    if (rule?.tiered) {
      const res = dur >= 4 ? '480p' : '720p'
      return {
        model: m,
        swappedModel: false,
        resolution: res,
        generateAudio: hasVoice,
        speedTier: 'fast',
        summaryBadge: `${res} · fast极速通道`,
        detailHint: `${m} 启用 tier=fast 极速队列 + ${res} 低成本试拍；满意后以 standard 标准高质量档精制`,
      }
    }

    if (rule) {
      let res: string | undefined
      if (rule.resolutions.includes('480p') && !(m === 'MiniMax-H3-LH' && dur < 4)) {
        res = '480p'
      } else if (rule.resolutions.length) {
        res = rule.resolutions[0]
      }
      return {
        model: m || undefined,
        swappedModel: false,
        resolution: res,
        generateAudio: m.startsWith('kling-') ? false : hasVoice,
        summaryBadge: `${res || '默认分辨率'} · 极速草稿`,
        detailHint: `按 ${m} 支持的最低开销档位（${res || '标准'}）生成试拍草稿`,
      }
    }
  }

  // volcengine Seedance 2.0 及通用默认
  return {
    model: m || undefined,
    swappedModel: false,
    resolution: '480p',
    generateAudio: hasVoice,
    summaryBadge: `480p${hasVoice ? ' · 保音色' : ' · 静音省流'}`,
    detailHint: hasVoice
      ? '检测到 #角色音色 引用，保留音频并以 480p 低分辨率试拍'
      : '以 480p + 关闭音频合成快速试拍，大幅节省算力点与排队耗时',
  }
}

export type HdRefineStrategy =
  | 'v2v_reference'   // 将满意的草稿视频作为 reference_video_urls 喂给高清模型重绘（保留运镜与动作节奏）
  | 'keyframe_pair'   // 自动抽取草稿视频首帧+尾帧，按高清首尾双帧关键帧重制
  | 'keyframe_first'  // 自动抽取草稿视频首帧，按高清单首帧重制
  | 'extracted_refs'  // 自动抽取草稿首帧+尾帧置顶加入 reference_image_urls 重制

export interface ResolveHdRefineInput {
  provider?: string | null
  model?: string | null
  episodeResolution?: string | null
  duration?: number | null
  draftVideoUrl?: string | null
  publicBaseUrlConfigured?: boolean
  refImageCount?: number
}

export interface HdRefinePlan {
  strategy: HdRefineStrategy
  model?: string
  resolution: string
  speedTier?: 'fast' | 'standard'
  durationOverride?: number
  buttonLabel: string
  description: string
  notice?: string
}

export function resolveHdRefinePlan(input: ResolveHdRefineInput): HdRefinePlan {
  const p = (input.provider || '').toLowerCase()
  const rawModel = (input.model || '').trim()
  const epRes = (input.episodeResolution || '720p').trim()
  const targetBaseRes = epRes === '480p' ? '720p' : epRes
  const draftUrl = String(input.draftVideoUrl || '').trim()
  const canSendVideoUrl = /^https?:\/\//i.test(draftUrl) || Boolean(input.publicBaseUrlConfigured)

  if (p === 'comfyui') {
    const res = targetBaseRes === '1080p' ? '720p' : targetBaseRes
    return {
      strategy: 'keyframe_first',
      model: rawModel || undefined,
      resolution: res,
      buttonLabel: `💎 抽首帧 ${res} 精制`,
      description: `从当前草稿视频提取首帧定格图，由本地 Wan 2.2 按 ${res} 高清重新渲染`,
    }
  }

  if (p === 'grok') {
    const targetModel = (!rawModel || rawModel.endsWith('-lite') || rawModel === 'grok-imagine-video')
      ? 'grok-imagine-video-1.5'
      : rawModel
    // Grok 1.5 带尾帧或多参考图最高支持 720p
    const res = targetBaseRes === '1080p' ? '720p' : targetBaseRes
    return {
      strategy: 'keyframe_pair',
      model: targetModel,
      resolution: res,
      buttonLabel: `💎 锁首尾帧 ${res} 精制`,
      description: `Grok 不支持参考视频输入：将自动抽取草稿首帧与尾帧，交由 ${targetModel} (${res}) 精准重制并补齐原生音效`,
      notice: targetBaseRes === '1080p'
        ? 'Grok 首尾双帧模式最高支持 720p，已自动按 720p 锁定草稿首尾关键帧高清重制'
        : undefined,
    }
  }

  if (p === 'aliyun') {
    const targetModel = rawModel || 'wan3.0-video-prime'
    if (canSendVideoUrl) {
      return {
        strategy: 'v2v_reference',
        model: targetModel,
        resolution: targetBaseRes,
        buttonLabel: `💎 V2V ${targetBaseRes} 精制`,
        description: `将当前草稿作为 reference_video 动作参考注入百炼 ${targetModel} (${targetBaseRes}) 高清重绘`,
      }
    }
    return {
      strategy: 'keyframe_pair',
      model: targetModel,
      resolution: targetBaseRes,
      buttonLabel: `💎 锁首尾帧 ${targetBaseRes} 精制`,
      description: `未配置 PUBLIC_BASE_URL 无法直传本地草稿视频，自动抽取草稿首尾双帧交由 ${targetModel} (${targetBaseRes}) 高清重制`,
      notice: '当前未配置 PUBLIC_BASE_URL，已自动改用抽取草稿首尾双帧进行高清重制',
    }
  }

  if (p === 'minimax') {
    if (canSendVideoUrl) {
      return {
        strategy: 'v2v_reference',
        model: rawModel || undefined,
        resolution: targetBaseRes,
        buttonLabel: `💎 V2V 高清精制`,
        description: '将当前草稿视频作为动作参考注入 MiniMax H3 高清重绘，保留角色设定与运镜节奏',
      }
    }
    return {
      strategy: 'keyframe_pair',
      model: rawModel || undefined,
      resolution: targetBaseRes,
      buttonLabel: `💎 锁首尾帧高清精制`,
      description: '自动抽取草稿首帧与尾帧，交由 MiniMax H3 高清重制',
      notice: '当前未配置 PUBLIC_BASE_URL，已自动改用抽取草稿首尾双帧进行高清重制',
    }
  }

  if (p === 'nihapi') {
    const hdUpgrade = NIHAPI_HD_SIBLINGS[rawModel]
    const targetModel = hdUpgrade ? hdUpgrade(targetBaseRes) : (rawModel === 'kling-v4.0-flash' ? 'kling-v4.0' : rawModel)
    const rule = NIHAPI_RULES[targetModel]

    let res = targetBaseRes
    if (rule?.resolutions.length) {
      if (rule.resolutions.includes(targetBaseRes)) {
        res = targetBaseRes
      } else if (targetBaseRes === '720p' && rule.resolutions.some(r => r.startsWith('768'))) {
        res = '720p' // nihapi adapter maps 720p -> 768p/768
      } else {
        // Pick highest supported resolution for HD refine
        res = rule.resolutions[rule.resolutions.length - 1]
        if (res.startsWith('768')) res = '720p'
      }
    }

    if ((rule?.videos || 0) > 0 && canSendVideoUrl) {
      return {
        strategy: 'v2v_reference',
        model: targetModel || undefined,
        resolution: res,
        buttonLabel: `💎 V2V ${res} 精制`,
        description: `将草稿视频作为 reference_videos 动作参考喂给 ${targetModel} (${res}) 高清重绘`,
      }
    }

    if (rule?.frames === 'pair') {
      return {
        strategy: 'keyframe_pair',
        model: targetModel || undefined,
        resolution: res,
        speedTier: rule.tiered ? 'standard' : undefined,
        durationOverride: targetModel === 'kling-v4.0' ? 5 : undefined,
        buttonLabel: `💎 锁首尾帧 ${res} 精制`,
        description: `自动抽取草稿首尾双帧，交由 ${targetModel}${rule.tiered ? ' (standard 标准高质量档)' : ''} 精准重制`,
        notice: targetModel === 'kling-v4.0' && Number(input.duration || 5) !== 5
          ? 'Kling 4.0 首尾双帧模式固定时长为 5 秒，已按 5 秒发起精制'
          : undefined,
      }
    }

    if (rule?.frames === 'first') {
      return {
        strategy: 'keyframe_first',
        model: targetModel || undefined,
        resolution: res,
        buttonLabel: `💎 锁首帧 ${res} 精制`,
        description: `自动抽取草稿首帧交由 ${targetModel} (${res}) 重制`,
      }
    }

    return {
      strategy: 'extracted_refs',
      model: targetModel || undefined,
      resolution: res,
      buttonLabel: `💎 抽关键帧 ${res} 精制`,
      description: `抽取草稿首尾关键帧置顶注入参考图列表，交由 ${targetModel || '当前模型'} (${res}) 高清重制`,
      notice: (rule?.videos || 0) > 0 && !canSendVideoUrl
        ? '当前未配置 PUBLIC_BASE_URL，已自动抽取草稿首尾帧作为参考图进行高清重制'
        : undefined,
    }
  }

  // volcengine Seedance 2.0 及默认多模态模型
  const volcRes = targetBaseRes === '1080p' ? '720p' : targetBaseRes
  if (canSendVideoUrl) {
    return {
      strategy: 'v2v_reference',
      model: rawModel || undefined,
      resolution: volcRes,
      buttonLabel: `💎 V2V ${volcRes} 精制`,
      description: `将满意草稿作为 reference_video 动作参考注入 Seedance 2.0 (${volcRes}) 高清重绘并合成音效`,
    }
  }
  return {
    strategy: 'extracted_refs',
    model: rawModel || undefined,
    resolution: volcRes,
    buttonLabel: `💎 抽关键帧 ${volcRes} 精制`,
    description: `未配置 PUBLIC_BASE_URL，自动抽取草稿首尾帧置顶注入 Seedance 2.0 (${volcRes}) 参考图列表高清重制`,
    notice: '当前未配置 PUBLIC_BASE_URL 无法直传本地参考视频，已自动抽取草稿首尾关键帧作为视觉参考重制',
  }
}

export const SLOW_MOTION_PRESETS = [
  { speed: 0.5, label: '0.5x 升格慢放（时长翻倍 2.0×）', ratioText: '2.0×' },
  { speed: 0.65, label: '0.65x 电影微慢（时长约 1.54×）', ratioText: '1.54×' },
  { speed: 0.75, label: '0.75x 舒缓延展（时长约 1.33×）', ratioText: '1.33×' },
] as const
