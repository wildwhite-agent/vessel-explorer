const BASE = 'https://api.etherscan.io/v2/api?chainid=1'

export interface TokenTransfer {
  hash: string
  from: string
  to: string
  tokenID: string
  blockNumber: string
  timeStamp: string
}

export async function fetchVesselTransfers(apiKey: string, page = 1, offset = 25): Promise<TokenTransfer[]> {
  const url = `${BASE}&module=account&action=tokennfttx&contractaddress=0xECb92Cc7112b80A2234936315BbB493fb48d1463&page=${page}&offset=${offset}&sort=desc&apikey=${apiKey}`
  const res = await fetch(url)
  const data = await res.json()
  return data.result || []
}

export async function fetchVesselTransfersForToken(tokenId: string, apiKey: string): Promise<TokenTransfer[]> {
  const all = await fetchVesselTransfers(apiKey, 1, 100)
  return all.filter(tx => tx.tokenID === tokenId)
}
