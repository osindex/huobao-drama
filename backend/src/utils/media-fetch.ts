import { ProxyAgent } from 'undici'

let mediaProxy: ProxyAgent | undefined

/** Optional, host-scoped proxy for generated media; model API requests stay independent. */
export async function fetchMediaResponse(url: string, signal: AbortSignal, headers?: Record<string, string>): Promise<Response> {
  const host = new URL(url).hostname.toLowerCase()
  const hosts = (process.env.MEDIA_PROXY_HOSTS || '').split(',').map(value => value.trim().toLowerCase())
  const proxy = process.env.MEDIA_HTTPS_PROXY
  const options: RequestInit & { dispatcher?: ProxyAgent } = { signal, ...(headers ? { headers } : {}) }
  if (proxy && hosts.includes(host)) options.dispatcher = mediaProxy ??= new ProxyAgent(proxy)
  return fetch(url, options)
}

export async function fetchMedia(url: string, timeoutMs = 120_000): Promise<Response> {
  const host = new URL(url).hostname
  try {
    const response = await fetchMediaResponse(url, AbortSignal.timeout(timeoutMs))
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response
  } catch (error: any) {
    const code = error.cause?.code || error.code || error.name || 'NETWORK_ERROR'
    throw new Error(`媒体下载失败（${host}，${code}）；${error.message === 'fetch failed' ? '请检查服务器到媒体站点的网络或媒体代理配置' : error.message}`)
  }
}
