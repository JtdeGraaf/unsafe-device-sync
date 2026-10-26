import type { Entry } from '../protocol'

/**
 * Where one space keeps its entries. Every call is synchronous, so a whole exchange runs without anything else in
 * between: in memory, and in a Durable Object's SQLite storage.
 */
export interface EntryTable {
  exists(): boolean
  /** Does nothing when the space already exists. */
  create(): void
  /** The highest revision in the space, or 0 when it is empty. */
  revision(): number
  find(key: string): Entry | null
  /** Adds the entry, or replaces the one with the same key. */
  put(entry: Entry): void
  /** Entries with a revision above `revision`, lowest first. */
  changedSince(revision: number): Entry[]
}

/** An entry table that lives as long as the process: for tests, and for trying the protocol out locally. */
export class MemoryEntryTable implements EntryTable {
  private entries: Map<string, Entry> | null = null

  exists(): boolean {
    return this.entries !== null
  }

  create(): void {
    this.entries ??= new Map()
  }

  revision(): number {
    return Math.max(0, ...[...this.created().values()].map((entry) => entry.revision))
  }

  find(key: string): Entry | null {
    return this.created().get(key) ?? null
  }

  put(entry: Entry): void {
    this.created().set(entry.key, entry)
  }

  changedSince(revision: number): Entry[] {
    return [...this.created().values()]
      .filter((entry) => entry.revision > revision)
      .sort((first, second) => first.revision - second.revision)
  }

  private created(): Map<string, Entry> {
    if (this.entries === null) throw new Error('The space does not exist yet.')
    return this.entries
  }
}
