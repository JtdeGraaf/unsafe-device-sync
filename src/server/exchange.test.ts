import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { MemoryEntryTable, type EntryTable } from './entry-table'
import { createSpace, exchangeChanges } from './exchange'
import { SqliteEntryTable, type SqlDatabase } from './sqlite-entry-table'

const SPACE = 'a'.repeat(64)

/** node:sqlite in the shape of a Durable Object's `ctx.storage.sql`. */
function sqliteInMemory(): SqlDatabase {
  const database = new DatabaseSync(':memory:')
  return {
    // Runs at once, like the Durable Object's exec, also when nobody reads the rows.
    exec: (query, ...bindings) => {
      const rows = database.prepare(query).all(...bindings) as Record<string, unknown>[]
      return { toArray: () => rows }
    },
  }
}

const tables: [string, () => EntryTable][] = [
  ['in memory', () => new MemoryEntryTable()],
  ['in SQLite', () => new SqliteEntryTable(sqliteInMemory())],
]

describe.each(tables)('exchanging changes with a space kept %s', (_name, newTable) => {
  it('refuses a space that was never created', () => {
    const table = newTable()

    expect(exchangeChanges(table, { space: SPACE, since: 0, changes: [] })).toBe('space-not-found')
    expect(table.exists()).toBe(false)
  })

  it('takes changes and hands them to a device that has not seen them', () => {
    const table = newTable()
    createSpace(table)

    const sent = exchangeChanges(table, {
      space: SPACE,
      since: 0,
      changes: [
        { key: 'favourites', value: ['soup'], changedAt: 100 },
        { key: 'theme', value: 'dark', changedAt: 100 },
      ],
    })
    const otherDevice = exchangeChanges(table, { space: SPACE, since: 0, changes: [] })

    expect(sent).toEqual({
      revision: 2,
      entries: [
        { key: 'favourites', value: ['soup'], changedAt: 100, revision: 1 },
        { key: 'theme', value: 'dark', changedAt: 100, revision: 2 },
      ],
      conflicts: [],
    })
    expect(otherDevice).toEqual(sent)
  })

  it('only hands out what changed after the revision a device has seen', () => {
    const table = newTable()
    createSpace(table)
    exchangeChanges(table, { space: SPACE, since: 0, changes: [{ key: 'theme', value: 'dark', changedAt: 1 }] })
    exchangeChanges(table, { space: SPACE, since: 1, changes: [{ key: 'language', value: 'nl', changedAt: 2 }] })

    expect(exchangeChanges(table, { space: SPACE, since: 1, changes: [] })).toEqual({
      revision: 2,
      entries: [{ key: 'language', value: 'nl', changedAt: 2, revision: 2 }],
      conflicts: [],
    })
  })

  it('refuses a change to a key another device changed after what this device has seen', () => {
    const table = newTable()
    createSpace(table)
    exchangeChanges(table, { space: SPACE, since: 0, changes: [{ key: 'theme', value: 'dark', changedAt: 1 }] })

    const late = exchangeChanges(table, {
      space: SPACE,
      since: 0,
      changes: [{ key: 'theme', value: 'light', changedAt: 2 }],
    })

    expect(late).toEqual({
      revision: 1,
      entries: [{ key: 'theme', value: 'dark', changedAt: 1, revision: 1 }],
      conflicts: ['theme'],
    })
  })

  it('keeps a removed value as null, so other devices remove it too', () => {
    const table = newTable()
    createSpace(table)
    exchangeChanges(table, { space: SPACE, since: 0, changes: [{ key: 'theme', value: 'dark', changedAt: 1 }] })
    exchangeChanges(table, { space: SPACE, since: 1, changes: [{ key: 'theme', value: null, changedAt: 2 }] })

    expect(table.find('theme')).toEqual({ key: 'theme', value: null, changedAt: 2, revision: 2 })
  })

  it('leaves the entries alone when a space is created twice', () => {
    const table = newTable()
    createSpace(table)
    exchangeChanges(table, { space: SPACE, since: 0, changes: [{ key: 'theme', value: 'dark', changedAt: 1 }] })

    expect(createSpace(table)).toEqual({ revision: 1 })
  })
})
