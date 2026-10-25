import { createError, getRequestIP, setResponseHeader, type H3Event } from 'h3'

/** Per-process LRU with byte/entry limits, deduplication and no unbounded job queue. */
export class BoundedWorkCache<T> {
  private cache = new Map<string, { value: T; expires: number; size: number }>()
  private pending = new Map<string, Promise<T>>()
  private bytes = 0
  private concurrency: number
  private entries: number
  private maxBytes: number
  constructor(concurrency: number, entries: number, maxBytes: number) {
    this.concurrency = concurrency
    this.entries = entries
    this.maxBytes = maxBytes
  }

  async get(key: string, work: () => Promise<T>, ttl: number, sizeOf: (value: T) => number): Promise<T> {
    const hit = this.cache.get(key)
    if (hit) {
      this.cache.delete(key)
      if (hit.expires > Date.now()) {
        this.cache.set(key, hit)
        return hit.value
      }
      this.bytes -= hit.size
    }
    const running = this.pending.get(key)
    if (running) return running
    if (this.pending.size >= this.concurrency) {
      throw createError({ statusCode: 503, message: 'media service busy' })
    }
    const job = Promise.resolve().then(work).then(value => {
      const size = sizeOf(value)
      if (size <= this.maxBytes) {
        while (this.cache.size >= this.entries || this.bytes + size > this.maxBytes) {
          const oldest = this.cache.keys().next().value!
          this.bytes -= this.cache.get(oldest)!.size
          this.cache.delete(oldest)
        }
        this.cache.set(key, { value, size, expires: Date.now() + ttl })
        this.bytes += size
      }
      return value
    }).finally(() => this.pending.delete(key))
    this.pending.set(key, job)
    return job
  }
}

const clients = new Map<string, { count: number; expires: number }>()
let windowStart = 0
let requests = 0

export function admitMediaRequest(event: H3Event) {
  const now = Date.now()
  if (now - windowStart >= 60_000) {
    windowStart = now
    requests = 0
    clients.clear()
  }
  // Never trust a caller-supplied X-Forwarded-For. Behind a proxy this is a
  // conservative shared budget; enforce finer client limits at the edge too.
  const ip = getRequestIP(event) || 'unknown'
  const bucket = clients.get(ip) || { count: 0, expires: now + 60_000 }
  if (++requests > 600 || ++bucket.count > 240 || (!clients.has(ip) && clients.size >= 1024)) {
    setResponseHeader(event, 'Retry-After', '60')
    throw createError({ statusCode: 429, message: 'media request limit exceeded' })
  }
  clients.set(ip, bucket)
}
