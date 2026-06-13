import { ref, watch, toValue, type MaybeRefOrGetter } from 'vue'
import {
  bytesFromHex,
  fetchToken,
  fetchTokenEntries,
} from '~/utils/indexer'
import { fetchLiveMachineState } from '~/utils/machine'
import {
  type VesselType,
  type ColorMode,
} from '~/utils/vessel'

export interface VesselData {
  id: number
  type: VesselType
  claimed: boolean
  owner: string | null
  delegate: string | null
  role: number
  roleLabel: string | null
  axiom: boolean
  relic: boolean
  relicKind: string | null
  colorMode: ColorMode
  claimBlock: number
  locked: boolean
  lockBlock: number
  entryCount: number
  chosenEntry: number
  isVault: boolean
  entries: VesselEntryData[]
  isMachine: boolean
  machineAddress: string | null
  machineName: string | null
  chosenMachine: string | null
  payload: Uint8Array | null
}

export interface VesselEntryData {
  entryIndex: number
  payload: Uint8Array
}

interface FetchVesselOptions {
  silent?: boolean
}

function vesselType(value: string | null | undefined): VesselType {
  if (value === 'machine' || value === 'vault') return value
  return 'capsule'
}

export function useVesselReader(tokenId: MaybeRefOrGetter<number | undefined>) {
  const vessel = ref<VesselData | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let requestSeq = 0

  async function fetchVessel(id: number, options: FetchVesselOptions = {}) {
    const seq = ++requestSeq
    const silent = options.silent === true
    if (!silent) {
      loading.value = true
      error.value = null
      vessel.value = null
    }

    try {
      const token = await fetchToken(id)
      const entries = token.isVault
        ? await fetchTokenEntries(id)
        : []
      const liveMachine = token.isMachine && token.machineAddress
        ? await fetchLiveMachineState(token.machineAddress as `0x${string}`, id)
        : null
      const payloadHex = liveMachine?.payloadHex ?? token.payloadHex

      if (seq !== requestSeq) return

      vessel.value = {
        id: token.id,
        type: vesselType(token.type),
        claimed: token.claimed,
        owner: token.owner,
        delegate: token.delegate,
        role: Number(token.role || 0),
        roleLabel: token.roleLabel,
        axiom: Boolean(token.axiom),
        relic: Boolean(token.relic),
        relicKind: token.relicKind,
        colorMode: Number(token.colorMode || 0) as ColorMode,
        claimBlock: Number(token.claimBlock || 0),
        locked: Boolean(token.locked),
        lockBlock: Number(token.lockBlock || 0),
        entryCount: Number(token.entryCount || entries.length || 0),
        chosenEntry: Number(token.chosenEntry || 0),
        isVault: Boolean(token.isVault),
        entries: entries.map((entry) => ({
          entryIndex: Number(entry.entryIndex),
          payload: bytesFromHex(entry.payloadHex),
        })),
        isMachine: Boolean(token.isMachine),
        machineAddress: token.machineAddress,
        machineName: liveMachine?.name ?? token.machineName ?? null,
        chosenMachine: token.chosenMachine,
        payload: bytesFromHex(payloadHex),
      }
    } catch (e: any) {
      if (seq !== requestSeq) return
      if (!silent) {
        error.value = e?.data?.message || e?.message || 'failed to fetch vessel'
      }
    } finally {
      if (seq === requestSeq && !silent) loading.value = false
    }
  }

  async function refresh() {
    const id = toValue(tokenId)
    if (id != null && id > 0) await fetchVessel(id, { silent: true })
  }

  watch(
    () => toValue(tokenId),
    (id) => {
      if (id != null && id > 0) void fetchVessel(id)
    },
    { immediate: true },
  )

  return { vessel, loading, error, refresh }
}
