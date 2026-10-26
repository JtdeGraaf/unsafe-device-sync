import { spaceIdFor } from '../phrase'
import { SyncError, type Entry, type SyncErrorCode } from '../protocol'
import type { SyncServer } from './http-sync-server'
import { newestWins, type Merge } from './merge'
import type { SavedSyncState, SyncState } from './sync-state'

/** The app's own saved data, as the client sees it. */
export interface LocalData {
  /** Keys of every synced value this device has now. */
  syncedKeys(): string[]
  isSynced(key: string): boolean
  /** The value, or null when there is none. */
  read(key: string): unknown
  /** Saves a value from another device, null removing it, and tells the app's screens. */
  write(key: string, value: unknown): void
}

export type SyncProblem = 'offline' | 'space-not-found' | 'server-error'

export type SyncStatus =
  | { connected: false }
  | {
      connected: true
      phrase: string
      busy: boolean
      /** Epoch milliseconds, or null before the first sync since the page opened. */
      lastSyncedAt: number | null
      problem: SyncProblem | null
      waitingChanges: number
    }

export type ConnectResult = 'connected' | SyncErrorCode

export type SyncClientOptions = {
  /** Goes into the space id, so the same words in two apps open two different spaces. */
  appName: string
  server: SyncServer
  local: LocalData
  savedState: SavedSyncState
  /** How to settle a key changed here and on another device. Keeps the newest edit unless told otherwise. */
  merge?: Merge
  now?: () => number
  /** Changes made close together go to the server as one. */
  waitAfterChangeMs?: number
}

export type SyncClient = {
  status(): SyncStatus
  subscribe(listener: () => void): () => void
  /** Makes a new space for `phrase` and puts everything on this device in it. */
  startNew(phrase: string): Promise<ConnectResult>
  /** Joins the space of `phrase`, merging this device's data in. Says `space-not-found` for a mistyped code. */
  join(phrase: string): Promise<ConnectResult>
  /** Stops syncing this device. Its data stays here, and the space stays for the other devices. */
  leave(): void
  /** Call after the app saved a value; it goes to the server shortly. */
  recordChange(key: string): void
  syncNow(): Promise<void>
  /** Call when another tab may have changed the saved state, so this tab's status catches up. */
  stateChangedElsewhere(): void
}

/** A conflict merged into a third value goes back to the server; a few rounds settle any normal back and forth. */
const MAX_ROUNDS = 3

/**
 * Keeps the synced values on this device and the server the same. Works offline: changes wait until the server can
 * be reached. Each exchange sends what changed here and takes in what changed elsewhere.
 */
export function createSyncClient(options: SyncClientOptions): SyncClient {
  const { appName, server, local, savedState } = options
  const merge = options.merge ?? newestWins
  const now = options.now ?? Date.now
  const waitAfterChangeMs = options.waitAfterChangeMs ?? 1000
  const listeners = new Set<() => void>()
  let busy = false
  let lastSyncedAt: number | null = null
  let problem: SyncProblem | null = null
  let status = readStatus()
  let running: Promise<void> | null = null
  let runAgain = false
  let soon: ReturnType<typeof setTimeout> | null = null

  function readStatus(): SyncStatus {
    const state = savedState.load()
    if (!state) return { connected: false }
    const waitingChanges = Object.keys(state.waiting).length
    return { connected: true, phrase: state.phrase, busy, lastSyncedAt, problem, waitingChanges }
  }

  function tellListeners() {
    status = readStatus()
    listeners.forEach((listener) => listener())
  }

  async function connect(phrase: string, check: (space: string) => Promise<unknown>): Promise<ConnectResult> {
    const space = await spaceIdFor(appName, phrase)
    try {
      await check(space)
    } catch (error) {
      return codeOf(error)
    }
    const changedAt = now()
    const waiting = Object.fromEntries(local.syncedKeys().map((key) => [key, changedAt]))
    savedState.save({ phrase, space, revision: 0, agreed: {}, waiting })
    problem = null
    lastSyncedAt = null
    tellListeners()
    await syncNow()
    return 'connected'
  }

  function syncNow(): Promise<void> {
    if (running) {
      runAgain = true
      return running
    }
    running = withLock(`${appName}-sync`, syncRounds).finally(() => {
      running = null
      if (!runAgain) return
      runAgain = false
      void syncNow()
    })
    return running
  }

  async function syncRounds() {
    if (!savedState.load()) return
    busy = true
    tellListeners()
    try {
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const moreToSend = await syncOnce()
        if (!moreToSend) break
      }
    } finally {
      busy = false
      tellListeners()
    }
  }

  /** One exchange with the server. True when changes are still waiting afterwards. */
  async function syncOnce(): Promise<boolean> {
    const before = savedState.load()
    if (!before) return false
    const sent = Object.entries(before.waiting).map(([key, changedAt]) => ({ key, value: local.read(key), changedAt }))
    let response
    try {
      response = await server.exchange({ space: before.space, since: before.revision, changes: sent })
    } catch (error) {
      problem = asProblem(codeOf(error))
      return false
    }
    // Read again: the app may have saved something while the request was on its way, or this device left the space.
    const state = savedState.load()
    if (!state || state.space !== before.space) return false
    const taken = new Map(
      sent.filter((change) => !response.conflicts.includes(change.key)).map((change) => [change.key, change.changedAt]),
    )
    for (const entry of response.entries) takeIn(state, entry, taken.get(entry.key))
    state.revision = response.revision
    savedState.save(state)
    problem = null
    lastSyncedAt = now()
    return Object.keys(state.waiting).length > 0
  }

  /** `sentChangedAt` is set when the server took this device's own change to the key. */
  function takeIn(state: SyncState, entry: Entry, sentChangedAt: number | undefined) {
    const base = state.agreed[entry.key] ?? null
    const waitingSince = state.waiting[entry.key]
    state.agreed[entry.key] = entry.value
    if (sentChangedAt !== undefined) {
      // An edit made while the request was out is newer still, and goes in the next round.
      if (waitingSince === sentChangedAt) delete state.waiting[entry.key]
      return
    }
    if (waitingSince === undefined) {
      writeIfChanged(entry.key, entry.value)
      return
    }
    const merged = merge({
      key: entry.key,
      base,
      mine: local.read(entry.key),
      theirs: entry.value,
      mineChangedAt: waitingSince,
      theirsChangedAt: entry.changedAt,
    })
    writeIfChanged(entry.key, merged)
    if (sameValue(merged, entry.value)) delete state.waiting[entry.key]
    else state.waiting[entry.key] = now()
  }

  function writeIfChanged(key: string, value: unknown) {
    if (!sameValue(local.read(key), value)) local.write(key, value)
  }

  return {
    status: () => status,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    startNew: (phrase) => connect(phrase, (space) => server.create(space)),
    join: (phrase) => connect(phrase, (space) => server.exchange({ space, since: 0, changes: [] })),
    leave() {
      if (soon) clearTimeout(soon)
      savedState.save(null)
      problem = null
      lastSyncedAt = null
      tellListeners()
    },
    recordChange(key) {
      const state = savedState.load()
      if (!state || !local.isSynced(key)) return
      state.waiting[key] = now()
      savedState.save(state)
      tellListeners()
      if (soon) clearTimeout(soon)
      soon = setTimeout(() => void syncNow(), waitAfterChangeMs)
    },
    syncNow,
    stateChangedElsewhere: tellListeners,
  }
}

function sameValue(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}

function codeOf(error: unknown): SyncErrorCode {
  if (error instanceof SyncError) return error.code
  throw error
}

function asProblem(code: SyncErrorCode): SyncProblem {
  if (code === 'offline' || code === 'space-not-found') return code
  return 'server-error'
}

/** Tabs of the same app share one saved state, so only one of them syncs at a time. */
function withLock(name: string, work: () => Promise<void>): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.locks) return work()
  return navigator.locks.request(name, work)
}
