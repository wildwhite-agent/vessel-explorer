import { loadBalance } from '@ponder/utils'
import { createConfig } from 'ponder'
import {
  createTransport,
  fallback,
  http,
  type Transport,
  type TransportConfig,
} from 'viem'

import { ShipyardWorkUnitAbi } from './abis/ShipyardWorkUnitAbi'
import { VesselAbi } from './abis/VesselAbi'

export const VESSEL_ADDRESS = '0xECb92Cc7112b80A2234936315BbB493fb48d1463' as const
export const VESSEL_START_BLOCK = 24_524_524
export const WORK_UNIT_ADDRESS = '0x476072a4e9648c1a115f47f268353586b0012c97' as const
export const WORK_UNIT_START_BLOCK = 24_918_488

function splitUrls(value: string | undefined) {
  return (value ?? '').split(/\s+/).filter(Boolean)
}

const primaryRpcUrls = splitUrls(process.env.PONDER_RPC_URLS_1)
const fallbackRpcUrls = splitUrls(process.env.PONDER_RPC_FALLBACK_URLS_1)
const wsUrl = process.env.PONDER_WS_URL_1 || undefined
const rpcRequestsPerSecond = positiveNumberFromEnv('PONDER_RPC_REQUESTS_PER_SECOND_1', 3)
const ethGetLogsBlockRange = Math.floor(
  positiveNumberFromEnv('PONDER_ETH_GET_LOGS_BLOCK_RANGE_1', 1_000),
)
const startBlock = Math.floor(
  positiveNumberFromEnv('VESSEL_INDEXER_START_BLOCK', VESSEL_START_BLOCK),
)
const endBlock = optionalEndBlockFromEnv('VESSEL_INDEXER_END_BLOCK')
const workUnitStartBlock = Math.floor(
  positiveNumberFromEnv('WORK_UNIT_INDEXER_START_BLOCK', WORK_UNIT_START_BLOCK),
)
const workUnitEndBlock = optionalEndBlockFromEnv('WORK_UNIT_INDEXER_END_BLOCK')

export const INDEXER_START_BLOCK = startBlock

function positiveNumberFromEnv(name: string, fallbackValue: number) {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue
}

function optionalEndBlockFromEnv(name: string) {
  const value = process.env[name]
  if (!value) return undefined
  if (value === 'latest') return 'latest' as const
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

function sharedRateLimit(transport: Transport, requestsPerSecond: number): Transport {
  const intervalMs = Math.ceil(1_000 / requestsPerSecond)
  let nextAt = 0
  let queue = Promise.resolve()

  function enqueue<T>(task: () => Promise<T>) {
    const run = queue
      .catch(() => undefined)
      .then(async () => {
        const wait = nextAt - Date.now()
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
        nextAt = Date.now() + intervalMs
        return task()
      })

    queue = run.then(() => undefined, () => undefined)
    return run
  }

  return ({ chain, retryCount, timeout }) => {
    const inner = transport(
      chain === undefined
        ? { retryCount: 0, timeout }
        : { chain, retryCount: 0, timeout },
    )

    return createTransport({
      key: 'sharedRateLimit',
      name: 'Shared Rate Limit',
      request: (body: Parameters<typeof inner.request>[0]) => enqueue(() => inner.request(body)),
      retryCount,
      type: 'custom',
    } as TransportConfig)
  }
}

function rpcHttp(url: string) {
  return sharedRateLimit(http(url, { timeout: 60_000 }), rpcRequestsPerSecond)
}

const primaryTransport = loadBalance(
  (primaryRpcUrls.length ? primaryRpcUrls : ['https://ethereum-rpc.publicnode.com']).map(rpcHttp),
)

const rpcTransport = fallbackRpcUrls.length
  ? fallback([
      primaryTransport,
      ...fallbackRpcUrls.map(rpcHttp),
    ])
  : primaryTransport

export default createConfig({
  chains: {
    mainnet: {
      id: 1,
      rpc: rpcTransport,
      ws: wsUrl,
      ethGetLogsBlockRange,
    },
  },
  contracts: {
    Vessel: {
      chain: 'mainnet',
      abi: VesselAbi,
      address: VESSEL_ADDRESS,
      startBlock,
      ...(endBlock === undefined ? {} : { endBlock }),
    },
    ShipyardWorkUnit: {
      chain: 'mainnet',
      abi: ShipyardWorkUnitAbi,
      address: WORK_UNIT_ADDRESS,
      startBlock: workUnitStartBlock,
      ...(workUnitEndBlock === undefined ? {} : { endBlock: workUnitEndBlock }),
    },
  },
})
