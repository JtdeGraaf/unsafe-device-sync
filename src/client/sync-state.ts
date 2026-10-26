import { z } from 'zod/mini'

/** What one device remembers about its space between visits. */
export type SyncState = {
  /** The shared code, kept so this device can show it to the next one. */
  phrase: string
  space: string
  /** The last revision this device has seen. */
  revision: number
  /** Every synced value as this device and the server last agreed on it: the base for merging. */
  agreed: Record<string, unknown>
  /** Keys changed on this device that the server has not taken yet, with when they changed. */
  waiting: Record<string, number>
}

/** Where the client keeps its state: localStorage in a browser, anything in a test. */
export interface SavedSyncState {
  load(): SyncState | null
  save(state: SyncState | null): void
}

const syncStateSchema = z.strictObject({
  phrase: z.string(),
  space: z.string(),
  revision: z.number(),
  agreed: z.record(z.string(), z.unknown()),
  waiting: z.record(z.string(), z.number()),
})

/** Checks state read back from storage. A broken state is null: this device is then simply not connected. */
export function parseSyncState(value: unknown): SyncState | null {
  const result = syncStateSchema.safeParse(value)
  return result.success ? result.data : null
}

export function savedStateInMemory(): SavedSyncState {
  let state: SyncState | null = null
  return {
    load: () => (state === null ? null : structuredClone(state)),
    save: (next) => {
      state = next === null ? null : structuredClone(next)
    },
  }
}
