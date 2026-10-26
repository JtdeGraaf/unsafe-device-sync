import type { z } from 'zod/mini'
import {
  createResponseSchema,
  errorResponseSchema,
  exchangeResponseSchema,
  SyncError,
  type CreateResponse,
  type ExchangeRequest,
  type ExchangeResponse,
} from '../protocol'

/** How the client reaches the server. `httpSyncServer` is the usual one; tests can call a handler directly. */
export interface SyncServer {
  create(space: string): Promise<CreateResponse>
  /** Throws a SyncError: `offline`, `space-not-found` or `server-error`. */
  exchange(request: ExchangeRequest): Promise<ExchangeResponse>
}

const WAIT_FOR_SERVER_MS = 15_000

/** Talks to `handleSyncRequest` over HTTP, on the same site unless `basePath` is a full URL. */
export function httpSyncServer(basePath = '/api/sync', fetchFrom: typeof fetch = fetch): SyncServer {
  async function post<T>(action: string, body: unknown, schema: z.ZodMiniType<T>): Promise<T> {
    let response: Response
    try {
      response = await fetchFrom(`${basePath}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(WAIT_FOR_SERVER_MS),
      })
    } catch {
      throw new SyncError('offline')
    }
    const answer: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const failure = errorResponseSchema.safeParse(answer)
      throw new SyncError(failure.success ? failure.data.code : 'server-error')
    }
    const parsed = schema.safeParse(answer)
    if (!parsed.success) throw new SyncError('server-error')
    return parsed.data
  }

  return {
    create: (space) => post('create', { space }, createResponseSchema),
    exchange: (request) => post('exchange', request, exchangeResponseSchema),
  }
}
