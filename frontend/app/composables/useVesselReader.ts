import { ref, watch, toValue, type MaybeRefOrGetter } from 'vue'
import { readContract } from '@wagmi/core'
import { useConfig } from '@wagmi/vue'
import {
  VESSEL_ADDRESS,
  VESSEL_ABI,
  MACHINE_ABI,
  type VesselType,
} from '~/utils/vessel'

export interface VesselData {
  id: number
  type: VesselType
  owner: string
  delegate: string | null
  machineHolder: string | null
  machineName: string | null
  entryCount: number
  payload: Uint8Array | null
  entries: Uint8Array[]
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export function useVesselReader(tokenId: MaybeRefOrGetter<number | undefined>) {
  const vessel = ref<VesselData | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const config = useConfig()

  async function read(fnName: string, args: unknown[] = []) {
    return readContract(config, {
      address: VESSEL_ADDRESS,
      abi: VESSEL_ABI,
      functionName: fnName as any,
      args: args as any,
    })
  }

  async function fetchVessel(id: number) {
    loading.value = true
    error.value = null
    vessel.value = null

    try {
      // getDelegate and getMachineHolder may revert if not set
      const safeRead = async (fnName: string, args: unknown[]) => {
        try { return await read(fnName, args) }
        catch { return ZERO_ADDRESS }
      }

      const [owner, delegate, machineHolder, entryCount, payload] =
        await Promise.all([
          read('ownerOf', [BigInt(id)]) as Promise<string>,
          safeRead('getDelegate', [BigInt(id)]) as Promise<string>,
          safeRead('getMachineHolder', [BigInt(id)]) as Promise<string>,
          read('craftToEntry', [BigInt(id)]).catch(() => 0n) as Promise<bigint>,
          read('craftToPayload', [BigInt(id)]).catch(() => '0x') as Promise<string>,
        ])

      const hasMachine = machineHolder !== ZERO_ADDRESS
      const entryCountNum = Number(entryCount)

      let type: VesselType = 'capsule'
      let machineName: string | null = null
      let finalPayload: Uint8Array | null = null
      const entries: Uint8Array[] = []

      if (hasMachine) {
        type = 'machine'
        // Fetch machine name and payload from machine contract
        const [name, machinePayload] = await Promise.all([
          readContract(config, {
            address: machineHolder as `0x${string}`,
            abi: MACHINE_ABI,
            functionName: 'name',
          }) as Promise<string>,
          readContract(config, {
            address: machineHolder as `0x${string}`,
            abi: MACHINE_ABI,
            functionName: 'craftToPayload',
            args: [BigInt(id)],
          }) as Promise<string>,
        ])
        machineName = name
        finalPayload = hexToBytes(machinePayload)
      } else if (entryCountNum > 1) {
        type = 'vault'
        // Fetch all vault entries
        const entryPromises = []
        for (let i = 0; i < entryCountNum; i++) {
          entryPromises.push(
            read('vaultToEntry', [BigInt(id), BigInt(i)]) as Promise<string>,
          )
        }
        const rawEntries = await Promise.all(entryPromises)
        for (const raw of rawEntries) {
          entries.push(hexToBytes(raw))
        }
        // Main payload is the latest entry
        finalPayload = hexToBytes(payload)
      } else {
        type = 'capsule'
        finalPayload = hexToBytes(payload)
      }

      vessel.value = {
        id,
        type,
        owner,
        delegate: delegate !== ZERO_ADDRESS ? delegate : null,
        machineHolder: hasMachine ? machineHolder : null,
        machineName,
        entryCount: entryCountNum,
        payload: finalPayload,
        entries,
      }
    } catch (e: any) {
      error.value = e?.shortMessage || e?.message || 'Failed to fetch vessel'
    } finally {
      loading.value = false
    }
  }

  watch(
    () => toValue(tokenId),
    (id) => {
      if (id != null && id >= 0) fetchVessel(id)
    },
    { immediate: true },
  )

  return { vessel, loading, error }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (!clean.length) return new Uint8Array(0)
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}
