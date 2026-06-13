import type { H3Event } from 'h3'
import { createPublicClient, getAddress, http, isAddress } from 'viem'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'

let clientRpcUrl = ''
let client: ReturnType<typeof createPublicClient> | null = null

function rpcUrl(event: H3Event) {
  const config = useRuntimeConfig(event)
  const publicConfig = config.public as {
    machineRpcUrl?: unknown
    evm?: { chains?: { mainnet?: { rpcs?: unknown } } }
  }
  return String(
    publicConfig.machineRpcUrl
    || publicConfig.evm?.chains?.mainnet?.rpcs
    || 'https://ethereum-rpc.publicnode.com',
  )
}

function getClient(event: H3Event) {
  const url = rpcUrl(event)
  if (!client || clientRpcUrl !== url) {
    clientRpcUrl = url
    client = createPublicClient({
      chain: mainnet,
      transport: http(url),
    })
  }
  return client
}

export default defineEventHandler(async (event) => {
  const rawName = String(getRouterParam(event, 'name') || '').trim()

  if (!rawName) {
    throw createError({ statusCode: 400, message: 'missing ens name' })
  }

  if (isAddress(rawName)) {
    return {
      name: null,
      address: getAddress(rawName),
    }
  }

  if (!rawName.includes('.') || /[\s/]/.test(rawName)) {
    throw createError({ statusCode: 400, message: 'invalid ens name' })
  }

  let name: string
  try {
    name = normalize(rawName)
  } catch {
    throw createError({ statusCode: 400, message: 'invalid ens name' })
  }

  const address = await getClient(event).getEnsAddress({ name })
  if (!address) {
    throw createError({ statusCode: 404, message: 'ens name not found' })
  }

  return {
    name,
    address: getAddress(address),
  }
})
