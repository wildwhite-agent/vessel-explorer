import { createError } from 'h3'

export function requireArtworkOrigin(value: string) {
  let url: URL
  try { url = new URL(value) } catch { throw createError({ statusCode: 503, message: 'invalid artwork origin configuration' }) }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw createError({ statusCode: 503, message: 'invalid artwork origin configuration' })
  }
  return url.origin
}
