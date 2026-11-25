/**
 * 视频模型关键帧能力矩阵与请求构建器
 * 严格对齐后端各 Provider Adapter 的真实参数约束，不静默丢弃参考图，不传模型不支持的字段。
 */

export type KeyframeDriveMode =
  | 'first_only'          // 仅支持单首帧 I2V，且不能混传参考图（ComfyUI Wan 2.2 / Kling 4.0 Flash / Grok Lite）
  | 'pair_required'       // 若使用关键帧则必须首帧+尾帧成对提供，且不能混传参考图（Kling 4.0 / Nihapi Wan3.0-线路七）
  | 'first_last_exclusive'// 支持单首帧或首+尾双帧，但不能与参考图数组混传（Aliyun Wan 3.0 / Nihapi MiniMax H3 Base·Cinematic·Origin）
  | 'first_last_and_refs' // 同时支持首帧、尾帧与多张参考图（Official MiniMax H3 / Grok 1.5）
  | 'refs_only'           // 仅支持多模态参考图数组，无独立首尾帧字段（Volcengine Seedance 2.0 / Nihapi Seedance 等）

export interface VideoKeyframeCapability {
  mode: KeyframeDriveMode
  label: string
  shortHint: string
  supportsFirst: boolean
  supportsLast: boolean
  requiresBothFrames: boolean
  mixesReferenceImages: boolean
  resolutionWarning?: string
}

const NIHAPI_PAIR_REQUIRED = new Set(['kling-v4.0', 'wan3.0-线路七'])
const NIHAPI_FIRST_LAST_EXCLUSIVE = new Set(['minimax-h3-base', 'minimax-h3-cinematic', 'minimax-h3-origin'])
const NIHAPI_FIRST_ONLY = new Set(['kling-v4.0-flash'])

export function getVideoKeyframeCapability(
  provider?: string | null,
  model?: string | null,
  resolution?: string | null,
): VideoKeyframeCapability {
  const p = (provider || '').toLowerCase()
  const m = (model || '').trim()

  if (p === 'comfyui') {
    return {
      mode: 'first_only',
      label: '单首帧锁死 (本地 Wan 2.2)',
      shortHint: '设置首帧后将直接由首帧图生视频，跳过盲盒合成；不支持尾帧',
      supportsFirst: true,
      supportsLast: false,
      requiresBothFrames: false,
      mixesReferenceImages: false,
    }
  }

  if (p === 'grok') {
    const modelName = m || 'grok-imagine-video-1.5'
    const is15Full = modelName === 'grok-imagine-video-1.5' || modelName === 'grok-imagine-video-1.5-preview'
    if (!is15Full) {
      return {
        mode: 'first_only',
        label: '单首帧驱动 (Grok Lite)',
        shortHint: '支持单张首帧锁死起始画面；如需首尾双帧请切换 grok-imagine-video-1.5',
        supportsFirst: true,
        supportsLast: false,
        requiresBothFrames: false,
        mixesReferenceImages: false,
      }
    }
    return {
      mode: 'first_last_and_refs',
      label: '首尾双帧 + 参考图 (Grok 1.5)',
      shortHint: '支持首帧、尾帧与角色参考图协同控制',
      supportsFirst: true,
      supportsLast: true,
      requiresBothFrames: false,
      mixesReferenceImages: true,
      resolutionWarning: resolution === '1080p'
        ? '提示：Grok 1.5 开启尾帧或多参考图时最高支持 720p，如需尾帧控制建议将顶栏分辨率切至 720p'
        : undefined,
    }
  }

  if (p === 'minimax') {
    return {
      mode: 'first_last_and_refs',
      label: '首尾双帧 + 多参考 (MiniMax H3)',
      shortHint: '原生支持首帧、尾帧与角色/场景参考图同时传入',
      supportsFirst: true,
      supportsLast: true,
      requiresBothFrames: false,
      mixesReferenceImages: true,
    }
  }

  if (p === 'aliyun') {
    return {
      mode: 'first_last_exclusive',
      label: '首尾双帧控制 (百炼 Wan 3.0)',
      shortHint: '提供首帧或首尾双帧时走关键帧模式；尾帧需配合首帧一起使用',
      supportsFirst: true,
      supportsLast: true,
      requiresBothFrames: false,
      mixesReferenceImages: false,
    }
  }

  if (p === 'nihapi') {
    if (NIHAPI_PAIR_REQUIRED.has(m)) {
      return {
        mode: 'pair_required',
        label: `首尾成对锁死 (${m})`,
        shortHint: '该模型启用关键帧时必须同时设置首帧与尾帧（时长建议 5s）',
        supportsFirst: true,
        supportsLast: true,
        requiresBothFrames: true,
        mixesReferenceImages: false,
      }
    }
    if (NIHAPI_FIRST_LAST_EXCLUSIVE.has(m)) {
      return {
        mode: 'first_last_exclusive',
        label: `首尾帧控制 (${m})`,
        shortHint: '支持单首帧或首+尾双帧精准过渡（关键帧模式下自动不混传零散参考图）',
        supportsFirst: true,
        supportsLast: true,
        requiresBothFrames: false,
        mixesReferenceImages: false,
      }
    }
    if (NIHAPI_FIRST_ONLY.has(m)) {
      return {
        mode: 'first_only',
        label: `单首帧控制 (${m})`,
        shortHint: '支持首帧锁死（5s/10s），不支持尾帧',
        supportsFirst: true,
        supportsLast: false,
        requiresBothFrames: false,
        mixesReferenceImages: false,
      }
    }
    return {
      mode: 'refs_only',
      label: '多参考融合（关键帧自动作为参考图注入）',
      shortHint: '当前模型无独立首尾帧槽位；已生成的首/尾帧会自动置顶加入参考图列表引导构图',
      supportsFirst: false,
      supportsLast: false,
      requiresBothFrames: false,
      mixesReferenceImages: true,
    }
  }

  // volcengine Seedance 2.0 及默认多模态参考模型
  return {
    mode: 'refs_only',
    label: '多参考融合（关键帧自动作为参考图注入）',
    shortHint: 'Seedance 2.0 采用多模态参考模式；首/尾帧将自动作为置顶视觉参考引导画面',
    supportsFirst: false,
    supportsLast: false,
    requiresBothFrames: false,
    mixesReferenceImages: true,
  }
}

export interface BuildVideoKeyframePayloadInput {
  storyboard: any
  basePrompt: string
  boundReferenceImages: string[]
  refLimit: number
  provider?: string | null
  model?: string | null
  resolution?: string | null
  preferKeyframes?: boolean
}

export interface BuiltVideoKeyframePayload {
  prompt: string
  first_frame_url?: string
  last_frame_url?: string
  reference_image_urls: string[]
  usingKeyframes: boolean
  notice?: string
}

/**
 * 根据分镜当前拥有的首帧/尾帧与所选视频模型能力，组装安全合法的视频生成参数。
 */
export function buildVideoKeyframePayload(input: BuildVideoKeyframePayloadInput): BuiltVideoKeyframePayload {
  const {
    storyboard,
    basePrompt,
    boundReferenceImages,
    refLimit,
    provider,
    model,
    resolution,
    preferKeyframes = true,
  } = input

  const firstRaw = (storyboard?.first_frame_image || storyboard?.firstFrameImage || '').trim()
  const lastRaw = (storyboard?.last_frame_image || storyboard?.lastFrameImage || '').trim()

  if (!preferKeyframes || (!firstRaw && !lastRaw)) {
    return {
      prompt: basePrompt,
      reference_image_urls: boundReferenceImages.slice(0, refLimit),
      usingKeyframes: false,
    }
  }

  const cap = getVideoKeyframeCapability(provider, model, resolution)

  // 1. 单首帧独占模式 (ComfyUI Wan 2.2 / Kling Flash / Grok Lite)
  if (cap.mode === 'first_only') {
    if (firstRaw) {
      return {
        prompt: basePrompt,
        first_frame_url: firstRaw,
        reference_image_urls: [],
        usingKeyframes: true,
        notice: lastRaw ? '当前模型仅支持单首帧，已使用首帧驱动视频（忽略尾帧）' : undefined,
      }
    }
    // 仅有尾帧无首帧时回退到绑定参考图，不传非法孤立尾帧
    return {
      prompt: basePrompt,
      reference_image_urls: boundReferenceImages.slice(0, refLimit),
      usingKeyframes: false,
      notice: '当前模型不支持单独尾帧，请先生成首帧；本次回退为参考素材生成',
    }
  }

  // 2. 首尾双帧成对必传模式 (kling-v4.0 / wan3.0-线路七)
  if (cap.mode === 'pair_required') {
    if (firstRaw && lastRaw) {
      return {
        prompt: basePrompt,
        first_frame_url: firstRaw,
        last_frame_url: lastRaw,
        reference_image_urls: [],
        usingKeyframes: true,
      }
    }
    throw new Error(`当前模型 (${model}) 使用关键帧控制时必须同时具备「首帧」和「尾帧」；请补齐另一帧，或切换支持单首帧的模型`)
  }

  // 3. 首尾帧与参考图互斥模式 (Aliyun Wan 3.0 / Nihapi MiniMax H3 Base·Cinematic·Origin)
  if (cap.mode === 'first_last_exclusive') {
    if (firstRaw) {
      return {
        prompt: basePrompt,
        first_frame_url: firstRaw,
        ...(lastRaw ? { last_frame_url: lastRaw } : {}),
        reference_image_urls: [],
        usingKeyframes: true,
      }
    }
    throw new Error('已设置尾帧但缺少首帧：请先生成或接力「首帧」后再发起首尾帧视频生成')
  }

  // 4. 首尾帧 + 参考图共存模式 (Official MiniMax H3 / Grok 1.5)
  if (cap.mode === 'first_last_and_refs') {
    // Grok 1.5 在 1080p 下仅允许单首帧（不带尾帧和参考图）
    if ((provider || '').toLowerCase() === 'grok' && resolution === '1080p') {
      if (firstRaw && !lastRaw) {
        return {
          prompt: basePrompt,
          first_frame_url: firstRaw,
          reference_image_urls: [],
          usingKeyframes: true,
          notice: '1080p 下 Grok 1.5 使用单首帧高清模式',
        }
      }
      throw new Error('Grok 1.5 在 1080p 档位不支持尾帧或多参考图，请先将顶栏分辨率切换为 720p')
    }
    const maxRefs = Math.max(0, refLimit - (firstRaw ? 1 : 0) - (lastRaw ? 1 : 0))
    const dedupRefs = boundReferenceImages.filter(u => u !== firstRaw && u !== lastRaw).slice(0, maxRefs)
    return {
      prompt: basePrompt,
      ...(firstRaw ? { first_frame_url: firstRaw } : {}),
      ...(lastRaw ? { last_frame_url: lastRaw } : {}),
      reference_image_urls: dedupRefs,
      usingKeyframes: true,
    }
  }

  // 5. 多模态参考模式 (Seedance 2.0 / Nihapi Seedance 等)：将首/尾帧置顶注入参考图序列
  const merged: string[] = []
  const pushUnique = (u?: string) => {
    if (u && !merged.includes(u) && merged.length < refLimit) merged.push(u)
  }
  pushUnique(firstRaw)
  pushUnique(lastRaw)
  for (const r of boundReferenceImages) pushUnique(r)

  const prefixHints: string[] = []
  if (firstRaw && lastRaw) prefixHints.push('请严格以第1张参考图为镜头起始首帧构图，平滑过渡至第2张参考图的结尾构图')
  else if (firstRaw) prefixHints.push('请严格以第1张参考图为镜头起始首帧画面构图')
  else if (lastRaw) prefixHints.push('请朝第1张参考图所示的镜头结尾定格构图演进')

  const augmentedPrompt = prefixHints.length
    ? `${prefixHints.join('，')}。${basePrompt}`
    : basePrompt

  return {
    prompt: augmentedPrompt,
    reference_image_urls: merged,
    usingKeyframes: true,
  }
}

export function aspectRatioToImageSize(aspectRatio?: string | null): string {
  const r = (aspectRatio || '16:9').trim()
  if (r === '9:16') return '720x1280'
  if (r === '1:1') return '1024x1024'
  if (r === '4:3') return '1280x960'
  if (r === '3:4') return '960x1280'
  return '1280x720'
}

export function buildStoryboardKeyframePrompt(
  sb: any,
  slot: 'first_frame' | 'last_frame',
  scene?: any | null,
  chars?: any[],
  propsList?: any[],
): string {
  const parts: string[] = []
  if (slot === 'first_frame') {
    parts.push('电影分镜关键帧（镜头起始首帧定格画面），保持参考角色五官服饰与场景空间高度一致，单张完整电影画面，严禁多宫格或分屏拼贴')
  } else {
    parts.push('电影分镜关键帧（镜头结束尾帧定格画面），与起始首帧保持同一时空光影、机位连续性与人物外观一致，展现动作完成后的落幅状态，单张完整电影画面')
  }

  const metaBits = [
    sb?.shot_type || sb?.shotType ? `景别：${sb.shot_type || sb.shotType}` : '',
    sb?.angle ? `机位角度：${sb.angle}` : '',
    scene?.location || sb?.location ? `场景：${scene?.location || sb?.location}` : '',
    scene?.time || sb?.time ? `时间：${scene?.time || sb?.time}` : '',
    sb?.atmosphere ? `氛围：${sb.atmosphere}` : '',
  ].filter(Boolean)
  if (metaBits.length) parts.push(metaBits.join('，'))

  if (chars?.length) {
    parts.push(`出镜人物：${chars.map(c => `${c.name}${c.appearance ? `（${c.appearance.slice(0, 60)}）` : ''}`).join('、')}`)
  }
  if (propsList?.length) {
    parts.push(`关键道具：${propsList.map(p => p.name).join('、')}`)
  }

  const core = (sb?.image_prompt || sb?.imagePrompt || sb?.description || sb?.video_prompt || sb?.videoPrompt || sb?.title || '').trim()
  if (core) {
    // 去掉 @图片N 等视频专属引用标记，保留自然语言描述
    const cleaned = core.replace(/@图片\d+/g, '').replace(/@音色\d+/g, '').replace(/@/g, '')
    parts.push(`画面内容：${cleaned}`)
  }

  return parts.join('。\n')
}
