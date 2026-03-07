import { decodeFunctionData } from 'viem'

const BASE = 'https://api.etherscan.io/v2/api?chainid=1'

export const VESSEL_ADDRESS = '0xECb92Cc7112b80A2234936315BbB493fb48d1463'

// Minimal ABI for decoding tx inputs
const VESSEL_DECODE_ABI = [
  { type: 'function', name: 'claim', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [], stateMutability: 'payable' },
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
      case 'claim':
        return { action: 'claim', vesselId: String(args[0]), detail: `claimed vessel #${args[0]}` }
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
    // fallback to etherscan's function name
    const match = etherscanFnName?.match(/^(\w+)/)
    return { action: match?.[1] || 'unknown', vesselId: null, detail: etherscanFnName || 'unknown' }
  }
}

export async function fetchVesselActivity(apiKey: string, page = 1, offset = 500): Promise<VesselTransaction[]> {
  const url = `${BASE}&module=account&action=txlist&address=${VESSEL_ADDRESS}&page=${page}&offset=${offset}&sort=desc&apikey=${apiKey}`
  const res = await fetch(url)
  const data = await res.json()
  const txs = data.result || []

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

export async function fetchVesselTransfers(apiKey: string, page = 1, offset = 25): Promise<TokenTransfer[]> {
  const url = `${BASE}&module=account&action=tokennfttx&contractaddress=${VESSEL_ADDRESS}&page=${page}&offset=${offset}&sort=desc&apikey=${apiKey}`
  const res = await fetch(url)
  const data = await res.json()
  return data.result || []
}

export async function fetchVesselTransfersForToken(tokenId: string, apiKey: string): Promise<TokenTransfer[]> {
  const all = await fetchVesselTransfers(apiKey, 1, 100)
  return all.filter(tx => tx.tokenID === tokenId)
}

export async function fetchVesselTransfersForAddress(address: string, apiKey: string): Promise<TokenTransfer[]> {
  const url = `${BASE}&module=account&action=tokennfttx&contractaddress=${VESSEL_ADDRESS}&address=${address}&page=1&offset=1000&sort=desc&apikey=${apiKey}`
  const res = await fetch(url)
  const data = await res.json()
  return data.result || []
}
