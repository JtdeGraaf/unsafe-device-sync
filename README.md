# @graaf/unsafe-device-sync

**Unsafe** shared storage for small personal apps and proofs of concept. It keeps an app's saved data the same on
several devices, with no accounts: every device that knows the same few words ("tomaat-oven-paars-lepel") shares
one space.

It is called unsafe on purpose. Read what that means before you use it.

## What "unsafe" means

- **Anyone with the words can read and change everything.** There are no accounts, no permissions, no audit log.
  The words are a house key: hand them out like one.
- **The server can read the data.** Values are stored as plain JSON, so whoever runs the server, or can open the
  Cloudflare account, can see them.
- **Guessing a code is hard, not impossible.** Four words from the Dutch list are about 39 bits. Over the network
  that takes years, but nothing limits how fast someone tries.
- **No backups, no history.** A bad write or a deleted space is gone.
- **Small data only.** At most 64 KB of JSON per value, 500 changes per request, and one Durable Object per space.

## Good for

Shopping lists, favourites, settings, progress, a household's shared list: things you would write on a note on
the fridge. And prototypes that need data on two devices before they deserve a real backend.

## Not for

Anything private, anything about other people, money, health, passwords or tokens, or anything you can't afford
to lose. Use a real backend with accounts for those.

## How it works

- Each device keeps its data locally and remembers which keys changed. An **exchange** sends those changes and gets
  back everything that changed elsewhere since the last revision it saw.
- A change to a key that another device changed first is sent back as a **conflict**. The device merges the two
  (`newestWins` by default, `mergeLists` for lists, or your own `merge`) and sends the result again.
- The space id is a SHA-256 hash of the app name and the words, so the server never sees the words, and the same
  words in two apps open two different spaces.
- Joining a code that nobody started fails with `space-not-found` instead of making an empty space, so a typo can
  never look like lost data. Joining merges what was already on the device, so it never throws anything away.

## Parts

| Import | What it is |
|---|---|
| `@graaf/unsafe-device-sync/client` | `createSyncClient`, `httpSyncServer`, `keepInStep`, `mergeLists`, `newestWins` |
| `@graaf/unsafe-device-sync/server` | `handleSyncRequest` (web-standard Request/Response), the `Spaces` interface, `memorySpaces`, `SqliteEntryTable` |
| `@graaf/unsafe-device-sync/cloudflare` | `SyncSpace` Durable Object and `cloudflareSpaces` |
| `@graaf/unsafe-device-sync/phrase` | `newPhrase`, `readPhrase`, `spaceIdFor`, `phraseStrength` |
| `@graaf/unsafe-device-sync/words/nl` | `DUTCH_WORDS`, 900+ everyday Dutch words |

The server only depends on the `Spaces` interface. Cloudflare Durable Objects are one implementation; another host
needs its own `Spaces`, for example `SqliteEntryTable` over a SQLite file with one exchange at a time per space.

## Installing

```bash
npm install github:JtdeGraaf/unsafe-device-sync zod
```

It ships TypeScript source, not built JavaScript, so use it through a bundler that compiles TypeScript: Vite for
the app, wrangler for the Worker. While this repo is private, installing it needs GitHub access, so CI needs a
token that can read it.

## Using it on Cloudflare Workers

```ts
// worker/index.ts
import { cloudflareSpaces, SyncSpace } from '@graaf/unsafe-device-sync/cloudflare'
import { handleSyncRequest } from '@graaf/unsafe-device-sync/server'

export { SyncSpace }

export default {
  fetch: (request, env) => handleSyncRequest(request, cloudflareSpaces(env.SYNC_SPACES)),
} satisfies ExportedHandler<{ SYNC_SPACES: DurableObjectNamespace<SyncSpace> }>
```

```jsonc
// wrangler.jsonc
"main": "worker/index.ts",
"assets": { "directory": "./dist", "run_worker_first": ["/api/*"] },
"durable_objects": { "bindings": [{ "name": "SYNC_SPACES", "class_name": "SyncSpace" }] },
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["SyncSpace"] }]
```

```ts
// in the app
const sync = createSyncClient({ appName: 'my-app', server: httpSyncServer(), local, savedState, merge })
keepInStep(sync)
await sync.startNew(newPhrase(DUTCH_WORDS)) // first device
await sync.join('tomaat-oven-paars-lepel') // every other device
```

`local` is the app's own storage behind the `LocalData` interface: which keys sync, and how to read and write
them. The app calls `sync.recordChange(key)` after it saves a synced key.

## Developing

```bash
npm install
npm run typecheck   # the browser and server parts, and the Cloudflare part against workers-types
npm test            # Vitest: the exchange in memory and in SQLite (node:sqlite), the HTTP handler, two phones syncing
```

First used in [cookbook](https://github.com/JtdeGraaf/cookbook), where it shares favourites and the shopping list
between phones.
