import type { SyncClient } from './sync-client'

/**
 * Syncs in the background of a browser page: now, whenever the page comes back into view or back online, and every
 * `everyMs` while it is in view. Returns a function that stops it.
 */
export function keepInStep(client: SyncClient, everyMs = 30_000): () => void {
  const syncIfInView = () => {
    if (document.visibilityState === 'visible') void client.syncNow()
  }
  document.addEventListener('visibilitychange', syncIfInView)
  window.addEventListener('online', syncIfInView)
  const timer = setInterval(syncIfInView, everyMs)
  syncIfInView()
  return () => {
    document.removeEventListener('visibilitychange', syncIfInView)
    window.removeEventListener('online', syncIfInView)
    clearInterval(timer)
  }
}
