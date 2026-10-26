import { createHash } from 'node:crypto'
import { createError, getQuery, type H3Event } from 'h3'

export function mediaRevision(event: H3Event): string {
  const value = getQuery(event).v
  if (value === undefined) return ''
  // Includes the colon/comma separators used by grouped sequence notifications.
  if (typeof value !== 'string' || !/^[A-Za-z0-9_:,.-]{1,4096}$/.test(value)) {
    throw createError({ statusCode: 400, message: 'invalid media revision' })
  }
  return value
}

export function mediaRevisionKey(event: H3Event): string {
  const revision = mediaRevision(event)
  return revision ? createHash('sha256').update(revision).digest('hex') : 'current'
}
