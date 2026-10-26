import type { Entry } from '../protocol'
import type { EntryTable } from './entry-table'

/**
 * The little of SQLite this table needs. A Durable Object's `ctx.storage.sql` has this shape, and so does a small
 * wrapper around `node:sqlite` or better-sqlite3.
 */
export interface SqlDatabase {
  exec(query: string, ...bindings: (string | number | null)[]): { toArray(): Record<string, unknown>[] }
}

/** Entries in one SQLite database per space. Values are kept as JSON text. */
export class SqliteEntryTable implements EntryTable {
  private readonly sql: SqlDatabase

  constructor(sql: SqlDatabase) {
    this.sql = sql
  }

  exists(): boolean {
    // Only reads, so a typo in a code never leaves an empty space behind.
    return this.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entries'").toArray().length > 0
  }

  create(): void {
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, value TEXT NOT NULL, changed_at INTEGER NOT NULL, revision INTEGER NOT NULL)',
    )
    this.sql.exec('CREATE INDEX IF NOT EXISTS entries_by_revision ON entries (revision)')
  }

  revision(): number {
    const [row] = this.sql.exec('SELECT COALESCE(MAX(revision), 0) AS revision FROM entries').toArray()
    return readNumber(row?.revision)
  }

  find(key: string): Entry | null {
    const [row] = this.sql.exec('SELECT key, value, changed_at, revision FROM entries WHERE key = ?', key).toArray()
    return row ? readEntry(row) : null
  }

  put(entry: Entry): void {
    this.sql.exec(
      `INSERT INTO entries (key, value, changed_at, revision) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, changed_at = excluded.changed_at, revision = excluded.revision`,
      entry.key,
      JSON.stringify(entry.value),
      entry.changedAt,
      entry.revision,
    )
  }

  changedSince(revision: number): Entry[] {
    return this.sql
      .exec('SELECT key, value, changed_at, revision FROM entries WHERE revision > ? ORDER BY revision', revision)
      .toArray()
      .map(readEntry)
  }
}

function readEntry(row: Record<string, unknown>): Entry {
  if (typeof row.key !== 'string' || typeof row.value !== 'string') throw new Error('An entry row is broken.')
  return {
    key: row.key,
    value: JSON.parse(row.value),
    changedAt: readNumber(row.changed_at),
    revision: readNumber(row.revision),
  }
}

/** SQLite drivers hand back integers as numbers or bigints. */
function readNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  throw new Error('A number column holds something else.')
}
