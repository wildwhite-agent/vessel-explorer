import { ref, watch, toValue, type MaybeRefOrGetter } from 'vue'
import { readContract } from '@wagmi/core'
import { useConfig } from '@wagmi/vue'
import {
  VESSEL_ADDRESS,
  VESSEL_ABI,
  MACHINE_ABI,
  hexToBytes,
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
  colorMode: ColorMode
  claimBlock: number
  locked: boolean
  lockBlock: number
  // vault
  entryCount: number
  chosenEntry: number
  isVault: boolean
  entries: Uint8Array[]
  // machine
  isMachine: boolean
  machineAddress: string | null
  machineName: string | null
  chosenMachine: string | null
  // payload
  payload: Uint8Array | null
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export function useVesselReader(tokenId: MaybeRefOrGetter<number | undefined>) {
  const vessel = ref<VesselData | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const config = useConfig()
  let requestSeq = 0

  async function read(fnName: string, args: unknown[] = []) {
    return readContract(config, {
      address: VESSEL_ADDRESS,
      abi: VESSEL_ABI,
      functionName: fnName as any,
      args: args as any,
    })
  }

  async function safeRead<T>(fnName: string, args: unknown[], fallback: T): Promise<T> {
    try { return await read(fnName, args) as T }
    catch { return fallback }
  }

  async function fetchVessel(id: number) {
    const seq = ++requestSeq
    loading.value = true
    error.value = null
    vessel.value = null

    try {
      // First: check if claimed and get type from the contract itself
      const [claimed, typeStr] = await Promise.all([
        safeRead<boolean>('craftToClaimed', [BigInt(id)], false),
        safeRead<string>('craftToType', [BigInt(id)], 'Capsule'),
      ])

      if (seq !== requestSeq) return

      const type = typeStr.toLowerCase() as VesselType

      // If not claimed, we can still show the type but not much else
      let owner: string | null = null
      if (claimed) {
        try { owner = await read('ownerOf', [BigInt(id)]) as string }
        catch { /* unclaimed or burned */ }
      }

      if (seq !== requestSeq) return

      // Fetch all metadata in parallel
      const [
        delegate,
        role,
        colorMode,
        claimBlock,
        locked,
        lockBlock,
        entryCount,
        chosenEntry,
        isVault,
        isMachine,
        machineAddress,
        chosenMachine,
        payload,
      ] = await Promise.all([
        safeRead<string>('craftToDelegate', [BigInt(id)], ZERO_ADDRESS),
        safeRead<bigint>('craftToRole', [BigInt(id)], 0n),
        safeRead<bigint>('craftToColorMode', [BigInt(id)], 0n),
        safeRead<bigint>('craftToClaimBlock', [BigInt(id)], 0n),
        safeRead<boolean>('craftToLocked', [BigInt(id)], false),
        safeRead<bigint>('craftToLockBlock', [BigInt(id)], 0n),
        safeRead<bigint>('craftToEntry', [BigInt(id)], 0n),
        safeRead<bigint>('craftToChosenEntry', [BigInt(id)], 0n),
        safeRead<boolean>('craftToVaultStatus', [BigInt(id)], false),
        safeRead<boolean>('craftToMachineStatus', [BigInt(id)], false),
        safeRead<string>('craftToMachine', [BigInt(id)], ZERO_ADDRESS),
        safeRead<string>('craftToChosenMachine', [BigInt(id)], ZERO_ADDRESS),
        safeRead<string>('craftToPayload', [BigInt(id)], '0x'),
      ])

      const entryCountNum = Number(entryCount)
      const entries: Uint8Array[] = []
      let machineName: string | null = null
      let finalPayload = hexToBytes(payload)

      // For machines: fetch machine contract data
      if (type === 'machine' && machineAddress !== ZERO_ADDRESS) {
        try {
          const [name, machinePayload] = await Promise.all([
            readContract(config, {
              address: machineAddress as `0x${string}`,
              abi: MACHINE_ABI,
              functionName: 'name',
            }) as Promise<string>,
            readContract(config, {
              address: machineAddress as `0x${string}`,
              abi: MACHINE_ABI,
              functionName: 'craftToPayload',
              args: [BigInt(id)],
            }) as Promise<string>,
          ])
          machineName = name
          finalPayload = hexToBytes(machinePayload)
        } catch {
          // machine contract might not respond, use raw payload
        }
      }

      if (seq !== requestSeq) return

      // For vaults: fetch all entries
      if (type === 'vault' && entryCountNum > 0) {
        const entryPromises = []
        for (let i = 0; i < entryCountNum; i++) {
          entryPromises.push(
            safeRead<string>('vaultToEntry', [BigInt(id), BigInt(i)], '0x'),
          )
        }
        const rawEntries = await Promise.all(entryPromises)
        for (const raw of rawEntries) {
          entries.push(hexToBytes(raw))
        }
      }

      if (seq !== requestSeq) return

      vessel.value = {
        id,
        type,
        claimed,
        owner,
        delegate: delegate !== ZERO_ADDRESS ? delegate : null,
        role: Number(role),
        colorMode: Number(colorMode) as ColorMode,
        claimBlock: Number(claimBlock),
        locked,
        lockBlock: Number(lockBlock),
        entryCount: entryCountNum,
        chosenEntry: Number(chosenEntry),
        isVault,
        isMachine,
        machineAddress: machineAddress !== ZERO_ADDRESS ? machineAddress : null,
        machineName,
        chosenMachine: chosenMachine !== ZERO_ADDRESS ? chosenMachine : null,
        entries,
        payload: finalPayload,
      }
    } catch (e: any) {
      if (seq !== requestSeq) return
      error.value = e?.shortMessage || e?.message || 'failed to fetch vessel'
    } finally {
      if (seq === requestSeq) loading.value = false
    }
  }

  watch(
    () => toValue(tokenId),
    (id) => {
      if (id != null && id > 0) fetchVessel(id)
    },
    { immediate: true },
  )

  return { vessel, loading, error }
}
