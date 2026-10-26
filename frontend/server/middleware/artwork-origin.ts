export default defineEventHandler(event => {
  const configured = String(useRuntimeConfig(event).public.artworkOrigin || '')
  if (!configured) return
  const origin = requireArtworkOrigin(configured)
  if (getRequestURL(event).hostname !== new URL(origin).hostname) return
  // This cookieless virtual host exposes artwork only, never app UI/API content.
  if (!/^\/api\/sequence-media\/(0|[1-9]\d{0,77})\/(image|animation)$/.test(getRequestURL(event).pathname)) {
    throw createError({ statusCode: 404, message: 'not found' })
  }
  delete event.node.req.headers.cookie
  delete event.node.req.headers.authorization
})
