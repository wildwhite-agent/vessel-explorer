import { reactive, ref, triggerRef } from 'vue'
import { hexToBytes, type ColorMode } from '~/utils/vessel'

interface GridToken {
  id: number
  type: string | null
  colorMode: number | null
  payload: string | null
}

const claimedSet = reactive(new Set<number>())
const payloadCache = reactive(new Map<number, Uint8Array>())
const typeCache = reactive(new Map<number, string>())
const colorModeCache = reactive(new Map<number, ColorMode>())
const loaded = ref(false)

export function useGridCache() {
  async function loadFromServer(): Promise<boolean> {
    if (loaded.value) return true

    try {
      const res = await fetch('/api/tokens/grid')
      if (!res.ok) return false

      const data = await res.json()
      const tokens: GridToken[] = data.tokens

      claimedSet.clear()
      for (const t of tokens) {
        claimedSet.add(t.id)
        if (t.type) typeCache.set(t.id, t.type)
        if (t.colorMode != null) colorModeCache.set(t.id, t.colorMode as ColorMode)
        if (t.payload) {
          const bytes = hexToBytes(t.payload)
          if (bytes.length > 0) payloadCache.set(t.id, bytes)
        }
      }

      loaded.value = true
      return true
    } catch {
      return false
    }
  }

  function invalidate() {
    loaded.value = false
  }

  return {
    claimedSet,
    payloadCache,
    typeCache,
    colorModeCache,
    loaded,
    loadFromServer,
    invalidate,
  }
}
