import type { CreateResponse, ExchangeRequest, ExchangeResponse } from '../protocol'
import type { EntryTable } from './entry-table'

export function createSpace(table: EntryTable): CreateResponse {
  table.create()
  return { revision: table.revision() }
}

/**
 * Takes a device's changes and sends back everything it has not seen. A change to a key that another device changed
 * after `since` is not taken: the device has not seen that change, so it merges first and sends again.
 */
export function exchangeChanges(table: EntryTable, request: ExchangeRequest): ExchangeResponse | 'space-not-found' {
  if (!table.exists()) return 'space-not-found'
  const conflicts: string[] = []
  let revision = table.revision()
  for (const change of request.changes) {
    const stored = table.find(change.key)
    if (stored && stored.revision > request.since) {
      conflicts.push(change.key)
      continue
    }
    revision += 1
    table.put({ ...change, revision })
  }
  return { revision, entries: table.changedSince(request.since), conflicts }
}
