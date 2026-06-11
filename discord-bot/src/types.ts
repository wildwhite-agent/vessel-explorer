export interface VesselActivity {
  hash: string
  actor?: string | null
  from: string
  to: string
  timeStamp: string
  blockNumber: string
  input: string
  isError: string
  functionName: string
  action: string
  source: string
  subjectType: string | null
  subjectId: string | null
  amount: string | null
  vesselId: string | null
  craftType: string | null
  entry: number | null
  sequence?: {
    tokenId: string
    artist: string
    artistAddress: string | null
    maxSupply: string
    price: string
    minted: string
    locked: boolean
    eventNumStart: string
    eventNumEnd: string
    uri: string
    usesRenderer: boolean
    renderer: string | null
    updatedAt: string | null
    blockNumber: string | null
  } | null
  buyer?: string | null
  seller?: string | null
  salePrice?: {
    amountRaw: string | null
    decimals: number | null
    symbol: string
    token: string | null
    formatted: string
  }
  detail: string
}

export interface ActivityCursor {
  blockNumber: string
  hash: string
  action: string
  vesselId: string
}

export interface BotState {
  cursor: ActivityCursor | null
  lastSummaryWindowEnd: number | null
  lastForcedSummaryWindowEnd: number | null
  sentActivityKeys?: string[]
}

export interface ProtocolStats {
  tokens: {
    total: number
    claimed: number
    filled: number
    claimedCapacityBytes: number
    filledBytes: number
    uniqueHolders: number
  }
}
