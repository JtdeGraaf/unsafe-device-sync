import { z } from 'zod/mini'

/**
 * What the devices and the server say to each other. A space is the data shared by every device that knows the same
 * code; its id is a hash of that code, so the server never sees the code itself.
 */

/** Limits that keep one request cheap for the server. */
export const MAX_KEY_LENGTH = 200
export const MAX_CHANGES_PER_REQUEST = 500
/** Characters of JSON per value. */
export const MAX_VALUE_LENGTH = 64_000
/** Bytes per request body. */
export const MAX_REQUEST_SIZE = 2_000_000

/** A SHA-256 hash as 64 lowercase hex characters. */
export const spaceIdSchema = z.string().check(z.regex(/^[0-9a-f]{64}$/))

/** A JSON value, or null for a value that was removed. Never missing. */
const valueSchema = z.unknown().check(
  z.refine((value) => value !== undefined && JSON.stringify(value).length <= MAX_VALUE_LENGTH),
)

export const changeSchema = z.strictObject({
  key: z.string().check(z.minLength(1), z.maxLength(MAX_KEY_LENGTH)),
  value: valueSchema,
  /** Epoch milliseconds on the device that made the change. */
  changedAt: z.number().check(z.int(), z.nonnegative()),
})
export type Change = { key: string; value: unknown; changedAt: number }

export const createRequestSchema = z.strictObject({ space: spaceIdSchema })
export type CreateRequest = z.infer<typeof createRequestSchema>

export const exchangeRequestSchema = z.strictObject({
  space: spaceIdSchema,
  /** The last revision this device has seen; 0 for a device that has seen nothing yet. */
  since: z.number().check(z.int(), z.nonnegative()),
  changes: z.array(changeSchema).check(z.maxLength(MAX_CHANGES_PER_REQUEST)),
})
export type ExchangeRequest = { space: string; since: number; changes: Change[] }

/** A value as the server keeps it. `revision` goes up by one with every change in the space. */
export type Entry = { key: string; value: unknown; changedAt: number; revision: number }

export const entrySchema = z.strictObject({
  key: z.string(),
  value: z.unknown(),
  changedAt: z.number(),
  revision: z.number(),
})

export type ExchangeResponse = {
  /** The space's newest revision; the device sends it as `since` next time. */
  revision: number
  /** Every entry changed after `since`, including the device's own changes that were taken. */
  entries: Entry[]
  /**
   * Keys whose change was not taken, because another device changed them after `since`. The device merges its own
   * value with the one in `entries` and sends the result again.
   */
  conflicts: string[]
}

export const exchangeResponseSchema = z.strictObject({
  revision: z.number(),
  entries: z.array(entrySchema),
  conflicts: z.array(z.string()),
})

export const createResponseSchema = z.strictObject({ revision: z.number() })
export type CreateResponse = z.infer<typeof createResponseSchema>

/** Why a request failed, as a code the app turns into its own words. */
export type SyncErrorCode =
  | 'space-not-found'
  | 'bad-request'
  | 'request-too-large'
  | 'not-found'
  | 'offline'
  | 'server-error'

export const errorResponseSchema = z.strictObject({
  code: z.enum(['space-not-found', 'bad-request', 'request-too-large', 'not-found', 'server-error']),
})

export class SyncError extends Error {
  readonly code: SyncErrorCode

  constructor(code: SyncErrorCode) {
    super(code)
    this.name = 'SyncError'
    this.code = code
  }
}
