import {
  createRequestSchema,
  exchangeRequestSchema,
  MAX_REQUEST_SIZE,
  type SyncErrorCode,
} from '../protocol'
import type { Spaces } from './spaces'

/**
 * Answers the two sync requests, POST `{basePath}/create` and POST `{basePath}/exchange`. Uses only web-standard
 * Request and Response, so it runs on Cloudflare Workers, Deno, Bun and Node alike.
 */
export async function handleSyncRequest(request: Request, spaces: Spaces, basePath = '/api/sync'): Promise<Response> {
  const action = new URL(request.url).pathname.slice(basePath.length)
  if (action !== '/create' && action !== '/exchange') return failure('not-found', 404)
  if (request.method !== 'POST') return failure('not-found', 405)

  const body = await readBody(request)
  if (body === 'too-large') return failure('request-too-large', 413)
  if (body === 'not-json') return failure('bad-request', 400)

  try {
    if (action === '/create') {
      const parsed = createRequestSchema.safeParse(body)
      if (!parsed.success) return failure('bad-request', 400)
      return Response.json(await spaces.create(parsed.data.space))
    }
    const parsed = exchangeRequestSchema.safeParse(body)
    if (!parsed.success) return failure('bad-request', 400)
    const result = await spaces.exchange(parsed.data)
    if (result === 'space-not-found') return failure('space-not-found', 404)
    return Response.json(result)
  } catch (error) {
    console.error('Sync request failed', error)
    return failure('server-error', 500)
  }
}

async function readBody(request: Request): Promise<unknown> {
  const declaredSize = Number(request.headers.get('content-length') ?? 0)
  if (declaredSize > MAX_REQUEST_SIZE) return 'too-large'
  const text = await request.text()
  if (text.length > MAX_REQUEST_SIZE) return 'too-large'
  try {
    return JSON.parse(text)
  } catch {
    return 'not-json'
  }
}

function failure(code: SyncErrorCode, status: number): Response {
  return Response.json({ code }, { status })
}
