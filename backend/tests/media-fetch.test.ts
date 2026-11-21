import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchMedia } from '../src/utils/media-fetch.js'

test('media proxy is scoped to exact hosts and errors identify delivery failures', async () => {
  const originalFetch = globalThis.fetch
  const oldProxy = process.env.MEDIA_HTTPS_PROXY
  const oldHosts = process.env.MEDIA_PROXY_HOSTS
  process.env.MEDIA_HTTPS_PROXY = 'http://127.0.0.1:7890'
  process.env.MEDIA_PROXY_HOSTS = 'imgen.x.ai'
  const requests: any[] = []
  globalThis.fetch = (async (_url, options) => {
    requests.push(options)
    return new Response('image')
  }) as typeof fetch
  try {
    await fetchMedia('https://imgen.x.ai/image.jpeg')
    await fetchMedia('http://192.168.110.201:8188/view?filename=image.png')
    await fetchMedia('https://imgen.x.ai.example/image.jpeg')
    assert.ok(requests[0].dispatcher)
    assert.equal(requests[1].dispatcher, undefined)
    assert.equal(requests[2].dispatcher, undefined)
    globalThis.fetch = async () => { throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }) }
    await assert.rejects(fetchMedia('https://imgen.x.ai/image.jpeg?secret=hidden'), error => {
      assert.match(String(error), /媒体下载失败.*imgen.x.ai.*UND_ERR_CONNECT_TIMEOUT/)
      assert.ok(!String(error).includes('hidden'))
      return true
    })
  } finally {
    globalThis.fetch = originalFetch
    if (oldProxy === undefined) delete process.env.MEDIA_HTTPS_PROXY
    else process.env.MEDIA_HTTPS_PROXY = oldProxy
    if (oldHosts === undefined) delete process.env.MEDIA_PROXY_HOSTS
    else process.env.MEDIA_PROXY_HOSTS = oldHosts
  }
})
