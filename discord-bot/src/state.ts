import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ActivityCursor, BotState } from './types.js'

export async function readState(path: string): Promise<BotState> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<BotState>
    const sentActivityKeys = normalizeSentActivityKeys(parsed.sentActivityKeys)
    const upcomingAfterCreatedAt = normalizeWatermark(parsed.upcomingAfterCreatedAt)
    return {
      cursor: normalizeCursor(parsed.cursor),
      lastSummaryWindowEnd: normalizeSummaryWindowEnd(parsed.lastSummaryWindowEnd),
      lastForcedSummaryWindowEnd: normalizeSummaryWindowEnd(parsed.lastForcedSummaryWindowEnd),
      ...(sentActivityKeys ? { sentActivityKeys } : {}),
      ...(upcomingAfterCreatedAt != null ? { upcomingAfterCreatedAt } : {}),
    }
  } catch (error) {
    if (isNotFound(error)) {
      return { cursor: null, lastSummaryWindowEnd: null, lastForcedSummaryWindowEnd: null }
    }
    throw error
  }
}

export async function writeState(path: string, state: BotState) {
  await mkdir(dirname(path), { recursive: true })
  const tmpPath = `${path}.tmp`
  await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`)
  await rename(tmpPath, path)
}

function normalizeCursor(value: unknown): ActivityCursor | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const blockNumber = stringField(row.blockNumber)
  const hash = stringField(row.hash)
  const action = stringField(row.action)
  const vesselId = stringField(row.vesselId)
  if (!blockNumber || !hash || !action || !vesselId) return null
  return { blockNumber, hash, action, vesselId }
}

function normalizeSummaryWindowEnd(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null
}

function normalizeSentActivityKeys(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const keys = value.map(stringField).filter(Boolean)
  return keys.length ? [...new Set(keys)] : undefined
}

function normalizeWatermark(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined
}

function stringField(value: unknown) {
  return value == null ? '' : String(value)
}

function isNotFound(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
