import { decodeFunctionData } from 'viem'

// Note: canonical VESSEL_ADDRESS lives in ~/utils/vessel.ts.
// This module uses its own decode ABI since it only needs function signatures.

// Minimal ABI for decoding tx inputs
const VESSEL_DECODE_ABI = [
  { type: 'function', name: 'claim', inputs: [{ name: '_to', type: 'address' }, { name: '_tokenIds', type: 'uint256[]' }, { name: '_bytes', type: 'bytes' }, { name: '_machine', type: 'address' }], outputs: [], stateMutability: 'payable' },
  { type: 'function', name: 'setPayloadHolder', inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'data', type: 'bytes' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'setDelegate', inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'delegate', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'setMachineHolder', inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'machine', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'transferFrom', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'tokenId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'safeTransferFrom', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'tokenId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'setRole', inputs: [{ name: 'role', type: 'uint8' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'setVaultEntryHolder', inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'entry', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'approve', inputs: [{ name: 'to', type: 'address' }, { name: 'tokenId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'setApprovalForAll', inputs: [{ name: 'operator', type: 'address' }, { name: 'approved', type: 'bool' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'refreshMetadata', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
] as const

export interface VesselTransaction {
  hash: string
  from: string
  to: string
  timeStamp: string
  blockNumber: string
  input: string
  isError: string
  functionName: string
  // decoded
  action: string
  vesselId: string | null
  detail: string
}

function decodeVesselTx(input: string, etherscanFnName: string): { action: string; vesselId: string | null; detail: string } {
  if (!input || input === '0x') return { action: 'transfer', vesselId: null, detail: 'ETH transfer' }

  try {
    const { functionName, args } = decodeFunctionData({ abi: VESSEL_DECODE_ABI, data: input as `0x${string}` })

    switch (functionName) {
      case 'claim': {
        const ids = args[1] as bigint[]
        return { action: 'claim', vesselId: ids.length > 0 ? String(ids[0]) : null, detail: `claimed ${ids.length} vessel(s)` }
      }
      case 'setPayloadHolder':
        return { action: 'write', vesselId: String(args[0]), detail: `wrote ${(args[1] as string).length / 2 - 1} bytes to #${args[0]}` }
      case 'setDelegate':
        return { action: 'delegate', vesselId: String(args[0]), detail: `delegated #${args[0]}` }
      case 'setMachineHolder':
        return { action: 'machine', vesselId: String(args[0]), detail: `set machine on #${args[0]}` }
      case 'transferFrom':
      case 'safeTransferFrom':
        return { action: 'transfer', vesselId: String(args[2]), detail: `transferred #${args[2]}` }
      case 'approve':
        return { action: 'approve', vesselId: String(args[1]), detail: `approved #${args[1]}` }
      case 'setRole':
        return { action: 'role', vesselId: null, detail: `set role ${args[0]}` }
      case 'setVaultEntryHolder':
        return { action: 'entry', vesselId: String(args[0]), detail: `set entry ${args[1]} on #${args[0]}` }
      case 'setApprovalForAll':
        return { action: 'approval', vesselId: null, detail: 'set approval for all' }
      case 'refreshMetadata':
        return { action: 'refresh', vesselId: String(args[0]), detail: `refreshed metadata for #${args[0]}` }
      default:
        return { action: functionName, vesselId: null, detail: functionName }
    }
  } catch {
    const match = etherscanFnName?.match(/^(\w+)/)
    return { action: match?.[1] || 'unknown', vesselId: null, detail: etherscanFnName || 'unknown' }
  }
}

export async function fetchVesselActivity(page = 1, offset = 50): Promise<VesselTransaction[]> {
  const res = await fetch(`/api/activity?page=${page}&offset=${offset}`)
  const txs = await res.json()
  if (!Array.isArray(txs)) return []

  return txs.map((tx: any) => {
    const decoded = decodeVesselTx(tx.input, tx.functionName)
    return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      timeStamp: tx.timeStamp,
      blockNumber: tx.blockNumber,
      input: tx.input,
      isError: tx.isError,
      functionName: tx.functionName,
      ...decoded,
    }
  })
}

export interface TokenTransfer {
  hash: string
  from: string
  to: string
  tokenID: string
  blockNumber: string
  timeStamp: string
}

export async function fetchVesselTransfersForAddress(address: string): Promise<TokenTransfer[]> {
  const res = await fetch(`/api/transfers?address=${address}`)
  const data = await res.json()
  return Array.isArray(data) ? data : []
}
