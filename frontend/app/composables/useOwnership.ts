import { computeOwnership } from '~/utils/vessel'
import { type TokenTransfer } from '~/utils/etherscan'

export interface OwnerTokens {
  ownership: Map<string, string>
  ownerTokens: Map<string, string[]>
}

// Cache for the global (no-address) ownership fetch
let globalCache: Promise<OwnerTokens> | null = null

/**
 * Fetch all transfers (optionally filtered by address) and compute
 * the current ownership map via transfer replay.
 *
 * Returns:
 *  - ownership: Map<tokenId, ownerAddress>
 *  - ownerTokens: Map<ownerAddress, tokenId[]>
 */
export async function fetchOwnership(address?: string): Promise<OwnerTokens> {
  const normalizedAddress = address?.trim() || undefined
  if (!normalizedAddress && globalCache) return globalCache

  const promise = _fetchOwnership(normalizedAddress)
  if (!normalizedAddress) {
    globalCache = promise.catch((error) => {
      if (globalCache === promise) globalCache = null
      throw error
    })
  }
  return promise
}

async function _fetchOwnership(address?: string): Promise<OwnerTokens> {
  const transfers = await fetchTransfers(address)

  const ownership = computeOwnership(transfers)

  const ownerTokens = new Map<string, string[]>()
  for (const [tokenId, owner] of ownership.entries()) {
    if (!ownerTokens.has(owner)) ownerTokens.set(owner, [])
    ownerTokens.get(owner)!.push(tokenId)
  }

  for (const tokens of ownerTokens.values()) {
    tokens.sort((a, b) => Number(a) - Number(b))
  }

  return { ownership, ownerTokens }
}

async function fetchTransfers(address?: string): Promise<TokenTransfer[]> {
  const transfers: TokenTransfer[] = []
  const pageSize = 10000

  for (let page = 1; page <= 20; page++) {
    const params = new URLSearchParams({
      page: String(page),
      offset: String(pageSize),
    })
    if (address) params.set('address', address)

    const res = await fetch(`/api/transfers?${params.toString()}`)
    const pageTransfers = await res.json()
    if (!Array.isArray(pageTransfers) || pageTransfers.length === 0) break
    transfers.push(...pageTransfers)
    if (pageTransfers.length < pageSize) break
  }

  return transfers
}

/**
 * Get token IDs owned by a specific address from a full ownership map.
 */
export function tokensOwnedBy(ownership: Map<string, string>, address: string): string[] {
  const lower = address.toLowerCase()
  return [...ownership.entries()]
    .filter(([, owner]) => owner === lower)
    .map(([id]) => id)
    .sort((a, b) => Number(a) - Number(b))
}
