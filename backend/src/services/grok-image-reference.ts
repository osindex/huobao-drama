import fs from 'node:fs/promises'
import sharp from 'sharp'
import { getAbsolutePath } from '../utils/storage.js'

/** Keep every reference and its pixel dimensions; encode bulky PNGs efficiently. */
export async function prepareGrokImageReference(value?: string | null): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  let bytes: Buffer
  if (raw.startsWith('static/') || raw.startsWith('/static/')) {
    bytes = await fs.readFile(getAbsolutePath(raw.replace(/^\//, '')))
  } else if (raw.startsWith('data:image/')) {
    const match = raw.match(/^data:image\/[^;]+;base64,(.+)$/s)
    if (!match) throw new Error('Grok 参考图片编码无效')
    bytes = Buffer.from(match[1], 'base64')
  } else return raw
  const metadata = await sharp(bytes).metadata()
  if (metadata.format === 'jpeg') return `data:image/jpeg;base64,${bytes.toString('base64')}`
  const jpeg = await sharp(bytes).rotate().flatten({ background: '#ffffff' })
    .jpeg({ quality: 90, mozjpeg: true }).toBuffer()
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`
}

/** Fit inline images to a relay's JSON budget without removing references or resizing pixels. */
export async function fitGrokRequestBody(body: Record<string, any>, maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) throw new Error('Grok 请求体大小配置无效')
  const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
  if (size(body) <= maxBytes) return body
  const result = structuredClone(body)
  const images = [result.image, result.last_frame, ...(result.reference_images || [])]
    .filter(item => typeof item?.url === 'string' && item.url.startsWith('data:image/'))
  // Every pass starts from the same source, rather than repeatedly recompressing.
  const originals = images.map(item => Buffer.from(item.url.slice(item.url.indexOf(',') + 1), 'base64'))
  for (const quality of [85, 80, 75]) {
    for (let i = 0; i < images.length; i++) {
      const jpeg = await sharp(originals[i]).rotate().flatten({ background: '#ffffff' })
        .jpeg({ quality, mozjpeg: true }).toBuffer()
      const url = `data:image/jpeg;base64,${jpeg.toString('base64')}`
      if (url.length < images[i].url.length) images[i].url = url
    }
    if (size(result) <= maxBytes) return result
  }
  throw new Error(`本地请求体预检未通过：保留全部参考图及原尺寸后仍超过 ${maxBytes} 字节；请提高已确认的中转请求体上限或使用公网图片地址`)
}
