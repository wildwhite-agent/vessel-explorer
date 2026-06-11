import type { VesselActivity } from './types.js'

export interface ActivityDisplayNames {
  actor?: string
  seller?: string
}

export interface DiscordEmbedPayload {
  embeds: Array<{
    title: string
    description?: string
    url?: string
    fields?: Array<{ name: string, value: string }>
    image?: { url: string }
  }>
}

export function buildDiscordPayload(
  activityOrActivities: VesselActivity | VesselActivity[],
  vesselBaseUrl: string,
  displayNames?: string | ActivityDisplayNames,
): DiscordEmbedPayload {
  const activities = Array.isArray(activityOrActivities) ? activityOrActivities : [activityOrActivities]
  const activity = activities[0]
  if (!activity) {
    throw new Error('cannot build Discord payload without activity')
  }
  const names = displayNames ?? shortenAddress(activity.from)

  if (activity.action.toLowerCase() === 'sequencemint') {
    const sequenceId = activity.subjectId || activity.sequence?.tokenId
    if (!sequenceId) {
      throw new Error('cannot build Sequence payload without subjectId')
    }
    const profileUrl = `${vesselBaseUrl}/address/${profileAddress(activity)}`
    return {
      embeds: [
        {
          title: actionTitle(activity),
          description: `${sequenceSentence(activities, names)}\n\n${profileUrl}`,
          url: evmNowTxUrl(activity.hash),
          image: {
            url: `${vesselBaseUrl}/api/sequence-og/${sequenceId}?v=${sequenceImageVersion(activities)}`,
          },
        },
      ],
    }
  }

  if (!activity.vesselId) {
    throw new Error('cannot build Discord payload for activity without vesselId')
  }

  const vesselUrl = `${vesselBaseUrl}/${activity.vesselId}`
  const imageUrl = `${vesselBaseUrl}/api/og/${activity.vesselId}?v=${imageVersion(activity)}`

  return {
    embeds: [
      {
        title: actionTitle(activity),
        description: `${sentenceForActivity(activity, names)}\n\n${vesselUrl}`,
        url: evmNowTxUrl(activity.hash),
        image: { url: imageUrl },
      },
    ],
  }
}

export async function sendDiscordWebhook(
  webhookUrl: string,
  payload: DiscordEmbedPayload,
) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Discord webhook failed: ${response.status} ${response.statusText} ${body}`.trim())
  }
}

export async function sendWithRetry(
  webhookUrl: string,
  payload: DiscordEmbedPayload,
  maxAttempts = 3,
) {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sendDiscordWebhook(webhookUrl, payload)
      return
    } catch (error) {
      lastError = error
      if (attempt < maxAttempts) {
        await sleep(500 * 2 ** (attempt - 1))
      }
    }
  }
  throw lastError
}

export function sentenceForActivity(
  activity: VesselActivity,
  displayNames: string | ActivityDisplayNames = shortenAddress(activity.from),
) {
  if (!activity.vesselId) {
    throw new Error('cannot format activity without vesselId')
  }

  const names = normalizeDisplayNames(displayNames)
  if (activity.action.toLowerCase() === 'sale') {
    const buyer = names.actor || shortenAddress(activity.buyer || activity.from)
    const seller = names.seller || shortenAddress(activity.seller || activity.to)
    return `**${escapeDiscordMarkdown(buyer)}** bought **${craftLabel(activity)} #${escapeDiscordMarkdown(activity.vesselId)}** from **${escapeDiscordMarkdown(seller)}** for **${escapeDiscordMarkdown(salePriceText(activity))}**`
  }

  if (activity.action.toLowerCase() === 'vwuclaim') {
    const actor = names.actor || shortenAddress(activity.from)
    return `**${escapeDiscordMarkdown(actor)}** claimed **${escapeDiscordMarkdown(amountText(activity.amount))} VWU** from **${craftLabel(activity)} #${escapeDiscordMarkdown(activity.vesselId)}**`
  }

  const action = activitySentenceFragment(activity)
  const actor = names.actor || shortenAddress(activity.from)
  return `**${escapeDiscordMarkdown(actor)}** ${action} on **${craftLabel(activity)} #${escapeDiscordMarkdown(activity.vesselId)}**`
}

function activitySentenceFragment(activity: VesselActivity) {
  switch (activity.action.toLowerCase()) {
    case 'claim':
      return 'claimed'
    case 'write':
      return writeFragment(activity)
    case 'machine':
      return 'set machine'
    case 'delegate':
      return 'set delegate'
    case 'setvaultentry':
      return entryFragment(activity.detail)
    case 'approval':
      return 'approved'
    case 'approvalforall':
      return 'set approval for all'
    case 'role':
      return roleFragment(activity.detail)
    case 'lock':
      return 'started lock clock'
    default:
      return activity.detail.replace(/\s+#?\d+\s*$/, '').trim() || activity.action
  }
}

function entryFragment(detail: string) {
  const entry = detail.match(/entry\s+(\d+)/i)?.[1]
  return entry ? `set vault entry ${entry}` : 'set vault entry'
}

function writeFragment(activity: VesselActivity) {
  const bytes = Number(activity.detail.match(/[\d,]+(?= bytes)/)?.[0]?.replace(/,/g, '') || 0).toLocaleString()
  const entry = activity.entry ?? activity.detail.match(/entry\s+(\d+)/i)?.[1] ?? null
  const entryText = entry === null ? '' : ` to entry ${entry}`
  return `wrote ${bytes} bytes${entryText}`
}

function roleFragment(detail: string) {
  const role = detail.match(/role\s+(\d+)/i)?.[1]
  return role ? `set role ${role}` : 'set role'
}

function actionTitle(activity: VesselActivity) {
  const action = activity.action.toLowerCase()
  switch (action) {
    case 'claim':
      return 'Claimed'
    case 'write':
      return `${titleCase(activity.craftType || 'Craft')} write`
    case 'machine':
      return 'Machine set'
    case 'delegate':
      return 'Delegate set'
    case 'setvaultentry':
      return 'Vault entry set'
    case 'approval':
      return 'Approved'
    case 'approvalforall':
      return 'Approval for all'
    case 'role':
      return 'Role set'
    case 'lock':
      return 'Lock clock started'
    case 'sale':
      return 'Sale'
    case 'vwuclaim':
      return 'VWU Claim'
    case 'sequencemint':
      return 'Sequence Mint'
    default:
      return titleCase(action.replace(/[_-]+/g, ' '))
  }
}

function sequenceSentence(
  activities: VesselActivity[],
  displayNames: string | ActivityDisplayNames,
) {
  const names = normalizeDisplayNames(displayNames)
  const activity = activities[0]!
  const actor = names.actor || shortenAddress(activity.from)

  if (activities.length === 1) {
    const sequenceId = activity.subjectId || activity.sequence?.tokenId || ''
    return `**${escapeDiscordMarkdown(actor)}** minted **${escapeDiscordMarkdown(amountText(activity.amount))}x Sequence #${escapeDiscordMarkdown(sequenceId)}**`
  }

  const totalAmount = activities.reduce((sum, row) => sum + amountBigInt(row.amount), 0n)
  const ids = activities
    .map((row) => row.subjectId || row.sequence?.tokenId)
    .filter(Boolean)
  const preview = ids.slice(0, 5).map((id) => `#${id}`).join(', ')
  const more = ids.length > 5 ? `, +${ids.length - 5} more` : ''
  return `**${escapeDiscordMarkdown(actor)}** minted **${escapeDiscordMarkdown(totalAmount.toLocaleString('en-US'))} Sequence editions** (${escapeDiscordMarkdown(preview + more)})`
}

function normalizeDisplayNames(value: string | ActivityDisplayNames): ActivityDisplayNames {
  return typeof value === 'string' ? { actor: value } : value
}

function salePriceText(activity: VesselActivity) {
  return activity.salePrice?.formatted || 'mixed payment'
}

function amountText(value: string | null | undefined) {
  return amountBigInt(value).toLocaleString('en-US')
}

function amountBigInt(value: string | null | undefined) {
  if (!value || !/^\d+$/.test(value)) return 0n
  try {
    return BigInt(value)
  } catch {
    return 0n
  }
}

function craftLabel(activity: VesselActivity) {
  return escapeDiscordMarkdown((activity.craftType || 'craft').toLowerCase())
}

function escapeDiscordMarkdown(value: string) {
  return value.replace(/([\\*_~`|<>])/g, '\\$1')
}

function titleCase(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function shortenAddress(address: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return address || 'unknown'
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function imageVersion(activity: VesselActivity) {
  return encodeURIComponent([
    activity.blockNumber,
    activity.action,
    activity.vesselId,
    activity.timeStamp,
  ].join('-'))
}

function sequenceImageVersion(activities: VesselActivity[]) {
  const activity = activities[0]!
  return encodeURIComponent([
    activity.sequence?.blockNumber || activity.blockNumber,
    activity.hash,
    activities.map((row) => `${row.subjectId || row.sequence?.tokenId || ''}:${row.amount || ''}`).join(','),
  ].join('-'))
}

function evmNowTxUrl(hash: string) {
  return `https://evm.now/tx/${encodeURIComponent(hash)}`
}

function profileAddress(activity: VesselActivity) {
  return [activity.to, activity.from, activity.actor]
    .find((address) => address && address !== '0x0000000000000000000000000000000000000000')
    || activity.from
}
