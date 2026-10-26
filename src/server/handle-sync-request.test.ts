import { describe, expect, it } from 'vitest'
import { handleSyncRequest } from './handle-sync-request'
import { memorySpaces } from './spaces'

const SPACE = 'b'.repeat(64)

function post(path: string, body: unknown): Request {
  return new Request(`https://book.test${path}`, { method: 'POST', body: JSON.stringify(body) })
}

describe('handling sync requests', () => {
  it('creates a space and exchanges changes with it', async () => {
    const spaces = memorySpaces()

    const created = await handleSyncRequest(post('/api/sync/create', { space: SPACE }), spaces)
    const exchanged = await handleSyncRequest(
      post('/api/sync/exchange', { space: SPACE, since: 0, changes: [{ key: 'theme', value: 'dark', changedAt: 5 }] }),
      spaces,
    )

    expect(created.status).toBe(200)
    expect(await created.json()).toEqual({ revision: 0 })
    expect(await exchanged.json()).toEqual({
      revision: 1,
      entries: [{ key: 'theme', value: 'dark', changedAt: 5, revision: 1 }],
      conflicts: [],
    })
  })

  it('says space-not-found for a code nobody started', async () => {
    const response = await handleSyncRequest(
      post('/api/sync/exchange', { space: SPACE, since: 0, changes: [] }),
      memorySpaces(),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ code: 'space-not-found' })
  })

  it('refuses a space id that is not a hash', async () => {
    const response = await handleSyncRequest(post('/api/sync/create', { space: 'tomaat-oven' }), memorySpaces())

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'bad-request' })
  })

  it('refuses a change without a value', async () => {
    const response = await handleSyncRequest(
      post('/api/sync/exchange', { space: SPACE, since: 0, changes: [{ key: 'theme', changedAt: 5 }] }),
      memorySpaces(),
    )

    expect(response.status).toBe(400)
  })

  it('refuses a body that is not JSON', async () => {
    const request = new Request('https://book.test/api/sync/create', { method: 'POST', body: 'hello' })

    const response = await handleSyncRequest(request, memorySpaces())

    expect(response.status).toBe(400)
  })

  it('refuses other paths and methods', async () => {
    const otherPath = await handleSyncRequest(post('/api/sync/delete', { space: SPACE }), memorySpaces())
    const otherMethod = await handleSyncRequest(new Request('https://book.test/api/sync/create'), memorySpaces())

    expect(otherPath.status).toBe(404)
    expect(otherMethod.status).toBe(405)
  })
})
