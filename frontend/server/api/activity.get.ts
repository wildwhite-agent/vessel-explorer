const BASE = 'https://api.etherscan.io/v2/api?chainid=1'
const VESSEL_ADDRESS = '0xECb92Cc7112b80A2234936315BbB493fb48d1463'
const PAYLOAD_SET_TOPIC = '0x0123c23420bdb48a8ae89c9a768c3c3a153ad19d28b6002a56f9a3ad0ef1569c'

async function resolveDelegateContract(txHash: string, apiKey: string): Promise<string> {
  try {
    const res = await fetch(
      `${BASE}&module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${apiKey}`
    )
    return ((await res.json()).result?.to as string) || ''
  } catch {
    return ''
  }
}

async function logToTx(log: any, apiKey: string) {
  const from = await resolveDelegateContract(log.transactionHash, apiKey)
  const data = log.data || '0x'
  const tokenId = data.length >= 66 ? parseInt(data.slice(2, 66), 16) : 0
  const length = data.length >= 130 ? parseInt(data.slice(66, 130), 16) : 0

  return {
    hash: log.transactionHash,
    from,
    to: VESSEL_ADDRESS,
    timeStamp: String(parseInt(log.timeStamp, 16)),
    blockNumber: String(parseInt(log.blockNumber, 16)),
    input: '0x',
    isError: '0',
    functionName: 'setPayloadHolder(uint256,bytes)',
    _action: 'write',
    _vesselId: String(tokenId),
    _detail: `wrote ${length} bytes to #${tokenId}`,
  }
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const apiKey = config.etherscanKey as string
  if (!apiKey) throw createError({ statusCode: 500, message: 'etherscan key not configured' })

  const query = getQuery(event)
  const page = Number(query.page) || 1
  const offset = Math.min(Number(query.offset) || 500, 1000)

  // Fetch external transactions
  const txUrl = `${BASE}&module=account&action=txlist&address=${VESSEL_ADDRESS}&page=${page}&offset=${offset}&sort=desc&apikey=${apiKey}`
  const txRes = await fetch(txUrl)
  const txData = await txRes.json()
  const txs: any[] = Array.isArray(txData.result) ? txData.result : []

  if (txs.length === 0) return []

  // Fetch PayloadSet logs in the same block range to catch delegated writes
  // getLogs returns ascending order, so use the txlist block range
  // On page 1, extend to latest to catch delegated writes newer than the latest direct tx
  const blocks = txs.map((tx: any) => Number(tx.blockNumber))
  const fromBlock = Math.min(...blocks)
  const toBlock = page === 1 ? 'latest' : Math.max(...blocks)

  const logUrl = `${BASE}&module=logs&action=getLogs&address=${VESSEL_ADDRESS}&topic0=${PAYLOAD_SET_TOPIC}&fromBlock=${fromBlock}&toBlock=${toBlock}&apikey=${apiKey}`
  const logRes = await fetch(logUrl)
  const logData = await logRes.json()
  const logs: any[] = Array.isArray(logData.result) ? logData.result : []

  // Find logs not already in txlist (delegated writes via intermediary contracts)
  const txHashes = new Set(txs.map((tx: any) => tx.hash.toLowerCase()))
  const missingLogs = logs.filter((l: any) => !txHashes.has(l.transactionHash.toLowerCase()))
  const synthetic = await Promise.all(missingLogs.map(l => logToTx(l, apiKey)))

  const merged = [...txs, ...synthetic]
  merged.sort((a: any, b: any) => Number(b.timeStamp) - Number(a.timeStamp))
  return merged
})
