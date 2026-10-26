import type { CreateResponse, ExchangeRequest, ExchangeResponse } from '../protocol'
import { MemoryEntryTable } from './entry-table'
import { createSpace, exchangeChanges } from './exchange'

/**
 * Every space the server knows. This is the part a host swaps out: `memorySpaces` here, `cloudflareSpaces` for
 * Durable Objects, or anything else that runs one exchange per space at a time.
 */
export interface Spaces {
  create(space: string): Promise<CreateResponse>
  exchange(request: ExchangeRequest): Promise<ExchangeResponse | 'space-not-found'>
}

/** Spaces kept in memory, gone when the process stops: for tests and local trials. */
export function memorySpaces(): Spaces {
  const tables = new Map<string, MemoryEntryTable>()
  const tableFor = (space: string) => {
    const known = tables.get(space)
    if (known) return known
    const table = new MemoryEntryTable()
    tables.set(space, table)
    return table
  }
  return {
    create: async (space) => createSpace(tableFor(space)),
    exchange: async (request) => exchangeChanges(tableFor(request.space), request),
  }
}
