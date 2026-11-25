/**
 * 视频关键帧抽取工具 — 支持首帧 / 尾帧 / 指定秒数高画质截图落盘
 * 用于导演画布「上一镜尾帧接力为下一镜首帧」及视频关键帧回采
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { STORAGE_ROOT } from './paths.js'
import { getAbsolutePath, generateImageThumb } from './storage.js'
import { ffmpeg, checkFfmpegSuite } from './ffmpeg.js'

export interface ExtractVideoFrameOptions {
  position?: 'first' | 'last' | 'timestamp'
  timestamp?: number
}

function runFfmpegExtract(inputAbs: string, outputAbs: string, inputOpts: string[], outputOpts: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputAbs)
    if (inputOpts.length) cmd.inputOptions(inputOpts)
    cmd
      .outputOptions(outputOpts)
      .output(outputAbs)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}

function probeVideoDuration(inputAbs: string): Promise<number | null> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputAbs, (err, metadata) => {
      if (err) return resolve(null)
      const dur = Number(metadata?.format?.duration)
      resolve(Number.isFinite(dur) && dur > 0 ? dur : null)
    })
  })
}

/**
 * 从已落盘的本地视频（static/...）抽取单帧高清 JPG 并生成缩略图。
 * 返回相对路径（如 static/images/<uuid>.jpg）。
 */
export async function extractVideoFrame(
  relativeVideoPath: string,
  opts: ExtractVideoFrameOptions = {},
): Promise<string> {
  if (!relativeVideoPath || typeof relativeVideoPath !== 'string') {
    throw new Error('缺少视频路径，无法抽取关键帧')
  }
  if (/^https?:\/\//i.test(relativeVideoPath)) {
    throw new Error('仅支持对已落盘到本地的视频抽取关键帧，请先恢复下载该视频')
  }

  const suite = await checkFfmpegSuite()
  if (!suite.ffmpeg) {
    throw new Error('当前环境 FFmpeg 不可用，无法从视频抽取关键帧')
  }

  const videoAbs = getAbsolutePath(relativeVideoPath)
  if (!fs.existsSync(videoAbs)) {
    throw new Error('源视频文件不存在或已被清理')
  }

  const outDir = path.join(STORAGE_ROOT, 'images')
  fs.mkdirSync(outDir, { recursive: true })
  const filename = `${uuid()}.jpg`
  const outAbs = path.join(outDir, filename)
  const outRel = `static/images/${filename}`

  const position = opts.position || 'last'

  if (position === 'first') {
    await runFfmpegExtract(videoAbs, outAbs, ['-ss', '0.04'], ['-frames:v', '1', '-q:v', '2', '-y'])
    if (!fs.existsSync(outAbs) || fs.statSync(outAbs).size === 0) {
      await runFfmpegExtract(videoAbs, outAbs, [], ['-frames:v', '1', '-q:v', '2', '-y'])
    }
  } else if (position === 'timestamp' && typeof opts.timestamp === 'number' && Number.isFinite(opts.timestamp) && opts.timestamp >= 0) {
    const sec = Math.max(0, opts.timestamp).toFixed(3)
    await runFfmpegExtract(videoAbs, outAbs, ['-ss', sec], ['-frames:v', '1', '-q:v', '2', '-y'])
  } else {
    // 尾帧：优先 -sseof 近尾寻址；若部分编码流近尾无帧，则用 ffprobe 时长兜底
    const tryOffsets = ['-0.08', '-0.25', '-0.6']
    for (const offset of tryOffsets) {
      try {
        await runFfmpegExtract(videoAbs, outAbs, ['-sseof', offset], ['-frames:v', '1', '-q:v', '2', '-y'])
        if (fs.existsSync(outAbs) && fs.statSync(outAbs).size > 0) break
      } catch {
        // fallback to next offset
      }
    }
    if (!fs.existsSync(outAbs) || fs.statSync(outAbs).size === 0) {
      const duration = suite.ffprobe ? await probeVideoDuration(videoAbs) : null
      const seekSec = duration && duration > 0.15 ? Math.max(0, duration - 0.1).toFixed(3) : '0'
      await runFfmpegExtract(videoAbs, outAbs, ['-ss', seekSec], ['-frames:v', '1', '-q:v', '2', '-y'])
    }
  }

  if (!fs.existsSync(outAbs) || fs.statSync(outAbs).size === 0) {
    throw new Error('未能从视频中抽取到有效画面帧')
  }

  await generateImageThumb(outRel)
  return outRel
}
