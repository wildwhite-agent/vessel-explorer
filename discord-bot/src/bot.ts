import type { StartMode } from './config.js'
import {
  activityKey,
  activityMatchesCursor,
  activityRememberKeys,
  cursorForActivity,
  isIncludedActivity,
  newActivitiesSinceCursor,
} from './indexer.js'
import type { BotState, VesselActivity } from './types.js'

export type ActivityNotification = VesselActivity[]

const MAX_SENT_ACTIVITY_KEYS = 5_000

export interface ProcessActivitiesOptions {
  excludedEventTypes: Set<string>
  startMode: StartMode
  sendLatestOnStart: boolean
  send: (activities: ActivityNotification) => Promise<void>
  save: (state: BotState) => Promise<void>
  warn?: (message: string) => void
}

export async function processActivities(
  state: BotState,
  activitiesNewestFirst: VesselActivity[],
  options: ProcessActivitiesOptions,
) {
  const activities = activitiesNewestFirst.filter((activity) =>
    isIncludedActivity(activity, options.excludedEventTypes),
  )

  if (!state.cursor && options.sendLatestOnStart && activities[0]) {
    const group = latestNotificationGroup(activities)
    await options.send(group)
    const nextState = rememberActivityKeys(
      { ...state, cursor: cursorForActivity(group.at(-1)!) },
      group.map(activityKey),
    )
    await options.save(nextState)
    return nextState
  }

  if (!state.cursor && options.startMode === 'latest') {
    const nextState = { ...state, cursor: activities[0] ? cursorForActivity(activities[0]) : null }
    await options.save(nextState)
    return nextState
  }

  if (state.cursor && activities[0] && !activities.some((activity) =>
    activityMatchesCursor(activity, state.cursor!))) {
    const nextState = rememberActivityKeys(
      { ...state, cursor: cursorForActivity(activities[0]) },
      activities.flatMap(activityRememberKeys),
    )
    const warn = options.warn ?? console.warn
    warn(
      `saved activity cursor was not found in the fetched indexer page; `
      + `checkpointing to ${activityKey(activities[0])} without posting backlog`,
    )
    await options.save(nextState)
    return nextState
  }

  const newActivities = newActivitiesSinceCursor(activities, state.cursor)
  if (options.sendLatestOnStart && activities[0] && newActivities.length === 0) {
    const group = latestNotificationGroup(activities)
    await options.send(group)
    const nextState = rememberActivityKeys(
      { ...state, cursor: cursorForActivity(group.at(-1)!) },
      group.flatMap(activityRememberKeys),
    )
    await options.save(nextState)
    return nextState
  }

  let nextState = state
  const sentActivityKeys = new Set(state.sentActivityKeys ?? [])
  for (const group of notificationGroups(newActivities)) {
    const unsentGroup = group.filter((activity) =>
      activityRememberKeys(activity).every((key) => !sentActivityKeys.has(key)),
    )
    if (unsentGroup.length) {
      await options.send(unsentGroup)
      for (const activity of unsentGroup) {
        for (const key of activityRememberKeys(activity)) sentActivityKeys.add(key)
      }
    }

    nextState = rememberActivityKeys(
      { ...nextState, cursor: cursorForActivity(group.at(-1)!) },
      group.flatMap(activityRememberKeys),
    )
    await options.save(nextState)
  }

  return nextState
}

function rememberActivityKeys(state: BotState, keys: string[]): BotState {
  const merged = [...(state.sentActivityKeys ?? []), ...keys].filter(Boolean)
  const seen = new Set<string>()
  const uniqueNewestFirst: string[] = []

  for (let index = merged.length - 1; index >= 0; index--) {
    const key = merged[index]!
    if (seen.has(key)) continue
    seen.add(key)
    uniqueNewestFirst.push(key)
  }

  return {
    ...state,
    sentActivityKeys: uniqueNewestFirst.reverse().slice(-MAX_SENT_ACTIVITY_KEYS),
  }
}

function notificationGroups(activitiesOldestFirst: VesselActivity[]): ActivityNotification[] {
  const groups: ActivityNotification[] = []
  const sequenceGroups = new Map<string, ActivityNotification>()
  const consumed = new Set<number>()

  for (let index = 0; index < activitiesOldestFirst.length; index++) {
    if (consumed.has(index)) continue
    const activity = activitiesOldestFirst[index]!
    if (activity.action.toLowerCase() !== 'sequencemint') {
      const pairIndex = activitiesOldestFirst.findIndex((candidate, candidateIndex) =>
        candidateIndex !== index
        && !consumed.has(candidateIndex)
        && isClaimMachinePair(activity, candidate),
      )
      if (pairIndex !== -1) {
        consumed.add(index)
        consumed.add(pairIndex)
        groups.push([activity, activitiesOldestFirst[pairIndex]!].sort((a, b) =>
          activityOrder(activitiesOldestFirst, a) - activityOrder(activitiesOldestFirst, b),
        ))
        continue
      }

      groups.push([activity])
      continue
    }

    const key = activity.hash.toLowerCase()
    let group = sequenceGroups.get(key)
    if (!group) {
      group = []
      sequenceGroups.set(key, group)
      groups.push(group)
    }
    group.push(activity)
  }

  return groups
}

function latestNotificationGroup(activitiesNewestFirst: VesselActivity[]): ActivityNotification {
  const latest = activitiesNewestFirst[0]!
  const claimMachineGroup = activitiesNewestFirst.filter((activity) =>
    isClaimMachinePair(latest, activity),
  )
  if (claimMachineGroup.length) {
    return [latest, ...claimMachineGroup].sort((a, b) =>
      activityOrder(activitiesNewestFirst, b) - activityOrder(activitiesNewestFirst, a),
    )
  }
  if (latest.action.toLowerCase() !== 'sequencemint') return [latest]
  return activitiesNewestFirst.filter((activity) =>
    activity.action.toLowerCase() === 'sequencemint'
    && activity.hash.toLowerCase() === latest.hash.toLowerCase(),
  )
}

function isClaimMachinePair(a: VesselActivity, b: VesselActivity) {
  const claim = [a, b].find((activity) => activity.action.toLowerCase() === 'claim')
  const machine = [a, b].find((activity) => activity.action.toLowerCase() === 'machine')
  if (!claim || !machine) return false
  if (!sameActivitySubject(claim, machine)) return false
  if (claim.logIndex != null && machine.logIndex != null) {
    return machine.logIndex + 1 === claim.logIndex
  }
  return true
}

function sameActivitySubject(a: VesselActivity, b: VesselActivity) {
  return a.hash.toLowerCase() === b.hash.toLowerCase()
    && a.blockNumber === b.blockNumber
    && (a.vesselId ?? '') === (b.vesselId ?? '')
}

function activityOrder(activities: VesselActivity[], activity: VesselActivity) {
  return activities.indexOf(activity)
}
