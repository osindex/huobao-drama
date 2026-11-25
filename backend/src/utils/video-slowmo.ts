/**
 * FFmpeg 光流升格慢放与无损扩时长工具
 *
 * 将已生成的分镜视频按指定倍率（0.4x ~ 0.9x）放慢，并通过运动补偿光流补帧（minterpolate mci）
 * 补齐至目标帧率（默认 24fps），避免本地 16fps 或云端视频直接慢放导致的掉帧卡顿。
 * 适用于空镜推拉摇移、情绪特写、转身蓄力等无口型对白镜头的低成本扩时长。
 */
import fs from 'node:fs'
import path from 'node:path'
import { v4 as uuid } from 'uuid'
import { STORAGE_ROOT } from './paths.js'
import { getAbsolutePath } from './storage.js'
import { extractVideoPoster } from './video-poster.js'
import { ffmpeg, checkFfmpegSuite } from './ffmpeg.js'

export type SlowMotionMode = 'optical_flow' | 'blend'

export interface SlowMotionOptions {
  /** 播放速度倍率，支持 0.4 ~ 0.9（例如 0.5 表示时长翻倍） */
  speed?: number
  /** 输出补帧目标帧率，默认 24fps（支持 16 ~ 60） */
  fps?: number
  /** 插帧算法：optical_flow（运动补偿光流，默认）| blend（帧混合极速） */
  mode?: SlowMotionMode
  /** 是否静音输出音频（默认 true，避免慢放后对白/音效变调失真） */
  muteAudio?: boolean
}

export interface SlowMotionResult {
  path: string
  duration: number
  sourceDuration: number | null
  speed: number
  fps: number
  mode: SlowMotionMode
}

interface ProbedMediaInfo {
  duration: number | null
  hasAudio: boolean
}

function probeMediaInfo(inputAbs: string): Promise<ProbedMediaInfo> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputAbs, (err, metadata) => {
      if (err || !metadata) {
        resolve({ duration: null, hasAudio: false })
        return
      }
      const dur = Number(metadata.format?.duration)
      const hasAudio = Array.isArray(metadata.streams)
        && metadata.streams.some((s: any) => s?.codec_type === 'audio')
      resolve({
        duration: Number.isFinite(dur) && dur > 0 ? dur : null,
        hasAudio,
      })
    })
  })
}

function buildAtempoChain(speed: number): string {
  // FFmpeg atempo 单级支持 [0.5, 100.0]；0.4 <= speed < 0.5 时拆成两级串联
  if (speed >= 0.5) {
    return `atempo=${speed.toFixed(4)}`
  }
  const second = speed / 0.5
  return `atempo=0.5,atempo=${second.toFixed(4)}`
}

export async function slowMotionVideo(
  relativeVideoPath: string,
  opts: SlowMotionOptions = {},
): Promise<SlowMotionResult> {
  if (!relativeVideoPath || typeof relativeVideoPath !== 'string') {
    throw new Error('缺少源视频路径，无法执行光流慢放')
  }
  if (/^https?:\/\//i.test(relativeVideoPath)) {
    throw new Error('仅支持对已落盘到本地的视频执行光流慢放，请先恢复下载该视频')
  }

  const speed = opts.speed ?? 0.5
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.4 || speed > 0.9) {
    throw new Error('慢放倍率 speed 必须在 0.4 ~ 0.9 之间（如 0.5x、0.65x、0.75x）')
  }

  const fps = Math.round(opts.fps ?? 24)
  if (!Number.isFinite(fps) || fps < 16 || fps > 60) {
    throw new Error('目标帧率 fps 必须在 16 ~ 60 之间')
  }

  const mode: SlowMotionMode = opts.mode === 'blend' ? 'blend' : 'optical_flow'
  const muteAudio = opts.muteAudio !== false

  const suite = await checkFfmpegSuite()
  if (!suite.ffmpeg) {
    throw new Error('当前环境 FFmpeg 不可用，无法执行光流慢放')
  }

  const inputAbs = getAbsolutePath(relativeVideoPath)
  if (!fs.existsSync(inputAbs)) {
    throw new Error('源视频文件不存在或已被清理')
  }

  const probed = suite.ffprobe ? await probeMediaInfo(inputAbs) : { duration: null, hasAudio: false }

  const outDir = path.join(STORAGE_ROOT, 'videos')
  fs.mkdirSync(outDir, { recursive: true })
  const filename = `${uuid()}.mp4`
  const outAbs = path.join(outDir, filename)
  const outRel = `static/videos/${filename}`

  const ptsMultiplier = (1 / speed).toFixed(6)
  const vf = mode === 'blend'
    ? `setpts=${ptsMultiplier}*PTS,minterpolate=fps=${fps}:mi_mode=blend`
    : `setpts=${ptsMultiplier}*PTS,minterpolate=fps=${fps}:mi_mode=mci:mc_mode=obmc`

  const outputOpts: string[] = [
    '-vf', vf,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
  ]

  if (!probed.hasAudio) {
    outputOpts.push('-an')
  } else {
    // 保留原视频音轨流结构以便后续全集 concat 拼接；静音时将拉伸后的音频流音量置零
    const af = muteAudio
      ? `${buildAtempoChain(speed)},volume=0`
      : buildAtempoChain(speed)
    outputOpts.push('-af', af, '-c:a', 'aac', '-ar', '48000', '-b:a', '128k')
  }

  outputOpts.push('-movflags', '+faststart', '-y')

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputAbs)
      .outputOptions(outputOpts)
      .output(outAbs)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })

  if (!fs.existsSync(outAbs) || fs.statSync(outAbs).size === 0) {
    throw new Error('FFmpeg 光流慢放未生成有效视频文件')
  }

  await extractVideoPoster(outRel)

  const outProbed = suite.ffprobe ? await probeMediaInfo(outAbs) : { duration: null, hasAudio: false }
  const fallbackDuration = probed.duration ? probed.duration / speed : 5 / speed
  const finalDuration = Number((outProbed.duration || fallbackDuration).toFixed(2))

  return {
    path: outRel,
    duration: finalDuration,
    sourceDuration: probed.duration,
    speed,
    fps,
    mode,
  }
}
