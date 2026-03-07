import { computeOwnership } from '~/utils/vessel'
import { fetchVesselTransfersForAddress, type TokenTransfer } from '~/utils/etherscan'

export interface OwnerTokens {
  ownership: Map<string, string>
  ownerTokens: Map<string, string[]>
}

/**
 * Fetch all transfers (optionally filtered by address) and compute
 * the current ownership map via transfer replay.
 *
 * Returns:
 *  - ownership: Map<tokenId, ownerAddress>
 *  - ownerTokens: Map<ownerAddress, tokenId[]>
 */
export async function fetchOwnership(address?: string): Promise<OwnerTokens> {
  let transfers: TokenTransfer[]

  if (address) {
    transfers = await fetchVesselTransfersForAddress(address)
  } else {
    const res = await fetch('/api/transfers?offset=10000')
    transfers = await res.json()
    if (!Array.isArray(transfers)) transfers = []
  }

  const ownership = computeOwnership(transfers)

  const ownerTokens = new Map<string, string[]>()
  for (const [tokenId, owner] of ownership.entries()) {
    if (!ownerTokens.has(owner)) ownerTokens.set(owner, [])
    ownerTokens.get(owner)!.push(tokenId)
  }

  return { ownership, ownerTokens }
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
