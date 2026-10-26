import { describe, expect, it } from 'vitest'
import { handleSyncRequest } from '../server/handle-sync-request'
import { memorySpaces, type Spaces } from '../server/spaces'
import { httpSyncServer } from './http-sync-server'
import { mergeLists, newestWins, type Merge } from './merge'
import { createSyncClient, type LocalData } from './sync-client'
import { savedStateInMemory } from './sync-state'

const CODE = 'tomaat-oven-paars-lepel'

const mergeFavourites: Merge = (conflict) =>
  conflict.key === 'favourites'
    ? mergeLists(conflict.base as string[] | null, conflict.mine as string[], conflict.theirs as string[])
    : newestWins(conflict)

/** A shared clock, so "newest" means the same on every phone in a test. */
function testClock() {
  let time = 1000
  return () => (time += 1)
}

/** A phone with its own saved data, reaching the server through the real HTTP handler. */
function phone(spaces: Spaces, now: () => number) {
  let online = true
  const data = new Map<string, unknown>()
  // The theme stays on each phone; everything else is shared.
  const isSynced = (key: string) => key !== 'theme'
  const local: LocalData = {
    syncedKeys: () => [...data.keys()].filter(isSynced),
    isSynced,
    read: (key) => data.get(key) ?? null,
    write: (key, value) => (value === null ? data.delete(key) : data.set(key, value)),
  }
  const fetchFrom: typeof fetch = async (input, init) => {
    if (!online) throw new TypeError('Failed to fetch')
    return handleSyncRequest(new Request(input, init), spaces)
  }
  const client = createSyncClient({
    appName: 'test-book',
    server: httpSyncServer('https://book.test/api/sync', fetchFrom),
    local,
    savedState: savedStateInMemory(),
    merge: mergeFavourites,
    now,
    // Tests sync by hand, so a background sync never runs halfway through.
    waitAfterChangeMs: 60_000,
  })
  return {
    data,
    client,
    save(key: string, value: unknown) {
      data.set(key, value)
      client.recordChange(key)
    },
    remove(key: string) {
      data.delete(key)
      client.recordChange(key)
    },
    goOffline: () => (online = false),
    goOnline: () => (online = true),
  }
}

function twoPhones() {
  const spaces = memorySpaces()
  const now = testClock()
  return { first: phone(spaces, now), second: phone(spaces, now) }
}

describe('syncing between phones', () => {
  it('gives a phone that joins everything the first phone has', async () => {
    const { first, second } = twoPhones()
    first.data.set('favourites', ['soup'])
    first.data.set('shopping-list', { recipePaths: ['pie'] })

    await first.client.startNew(CODE)
    const result = await second.client.join(CODE)

    expect(result).toBe('connected')
    expect(Object.fromEntries(second.data)).toEqual({ favourites: ['soup'], 'shopping-list': { recipePaths: ['pie'] } })
  })

  it('keeps what was already on a phone when it joins', async () => {
    const { first, second } = twoPhones()
    first.data.set('favourites', ['soup'])
    second.data.set('favourites', ['pie'])
    second.data.set('journal:pie', { cookedOn: ['2026-10-20'] })
    await first.client.startNew(CODE)

    await second.client.join(CODE)
    await first.client.syncNow()

    expect(second.data.get('favourites')).toEqual(['soup', 'pie'])
    expect(first.data.get('favourites')).toEqual(['soup', 'pie'])
    expect(first.data.get('journal:pie')).toEqual({ cookedOn: ['2026-10-20'] })
  })

  it('does not connect with a mistyped code', async () => {
    const { first, second } = twoPhones()
    await first.client.startNew(CODE)

    const result = await second.client.join('tomaat-oven-paars-vork')

    expect(result).toBe('space-not-found')
    expect(second.client.status()).toEqual({ connected: false })
  })

  it('keeps both edits when two phones change the same list at once', async () => {
    const { first, second } = twoPhones()
    first.data.set('favourites', ['soup'])
    await first.client.startNew(CODE)
    await second.client.join(CODE)

    first.save('favourites', ['soup', 'pie'])
    second.save('favourites', [])
    await first.client.syncNow()
    await second.client.syncNow()
    await first.client.syncNow()

    expect(first.data.get('favourites')).toEqual(['pie'])
    expect(second.data.get('favourites')).toEqual(['pie'])
  })

  it('keeps the newest edit of a single value', async () => {
    const { first, second } = twoPhones()
    await first.client.startNew(CODE)
    await second.client.join(CODE)

    first.save('servings', 2)
    second.save('servings', 6)
    await first.client.syncNow()
    await second.client.syncNow()
    await first.client.syncNow()

    expect(first.data.get('servings')).toBe(6)
    expect(second.data.get('servings')).toBe(6)
  })

  it('removes a value on the other phone when it is removed on one', async () => {
    const { first, second } = twoPhones()
    first.data.set('journal:soup', { cookedOn: ['2026-10-01'] })
    await first.client.startNew(CODE)
    await second.client.join(CODE)

    first.remove('journal:soup')
    await first.client.syncNow()
    await second.client.syncNow()

    expect(second.data.has('journal:soup')).toBe(false)
  })

  it('sends changes made offline once the phone is back online', async () => {
    const { first, second } = twoPhones()
    await first.client.startNew(CODE)
    await second.client.join(CODE)

    first.goOffline()
    first.save('favourites', ['soup'])
    await first.client.syncNow()
    const whileOffline = first.client.status()
    first.goOnline()
    await first.client.syncNow()
    await second.client.syncNow()

    expect(whileOffline).toMatchObject({ connected: true, problem: 'offline', waitingChanges: 1 })
    expect(first.client.status()).toMatchObject({ connected: true, problem: null, waitingChanges: 0 })
    expect(second.data.get('favourites')).toEqual(['soup'])
  })

  it('leaves values the app does not sync on each phone', async () => {
    const { first, second } = twoPhones()
    first.data.set('theme', 'dark')
    await first.client.startNew(CODE)

    await second.client.join(CODE)

    expect(second.data.has('theme')).toBe(false)
  })

  it('keeps the data on a phone that stops syncing', async () => {
    const { first, second } = twoPhones()
    first.data.set('favourites', ['soup'])
    await first.client.startNew(CODE)
    await second.client.join(CODE)

    second.client.leave()
    first.save('favourites', ['soup', 'pie'])
    await first.client.syncNow()
    await second.client.syncNow()

    expect(second.client.status()).toEqual({ connected: false })
    expect(second.data.get('favourites')).toEqual(['soup'])
  })
})
