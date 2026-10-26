import { DurableObject } from 'cloudflare:workers'
import type { CreateResponse, ExchangeRequest, ExchangeResponse } from '../protocol'
import { createSpace, exchangeChanges } from '../server/exchange'
import type { Spaces } from '../server/spaces'
import { SqliteEntryTable } from '../server/sqlite-entry-table'

/**
 * One space as a SQLite-backed Durable Object. A Durable Object handles one call at a time, so two devices
 * exchanging at once never lose each other's changes. Export it from the Worker and declare it in wrangler.jsonc:
 *
 *   "durable_objects": { "bindings": [{ "name": "SYNC_SPACES", "class_name": "SyncSpace" }] },
 *   "migrations": [{ "tag": "v1", "new_sqlite_classes": ["SyncSpace"] }]
 */
export class SyncSpace extends DurableObject {
  private readonly table = new SqliteEntryTable(this.ctx.storage.sql)

  create(): CreateResponse {
    return createSpace(this.table)
  }

  /** Sent as JSON text: values are any JSON, which the typed RPC stub can't describe. */
  exchange(request: ExchangeRequest): string {
    return JSON.stringify(exchangeChanges(this.table, request))
  }
}

/** The spaces kept in the Durable Object namespace bound to the Worker. */
export function cloudflareSpaces(namespace: DurableObjectNamespace<SyncSpace>): Spaces {
  const spaceFor = (space: string) => namespace.get(namespace.idFromName(space))
  return {
    create: async (space) => await spaceFor(space).create(),
    exchange: async (request) =>
      JSON.parse(await spaceFor(request.space).exchange(request)) as ExchangeResponse | 'space-not-found',
  }
}
