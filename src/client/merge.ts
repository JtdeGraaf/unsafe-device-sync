/**
 * Both this device and another changed the same key since they last agreed. `base` is the value they last agreed on,
 * or null when this device never synced the key.
 */
export type Conflict = {
  key: string
  base: unknown
  mine: unknown
  theirs: unknown
  /** Epoch milliseconds on each device. Clocks can be a little off; good enough to pick the newer edit. */
  mineChangedAt: number
  theirsChangedAt: number
}

/** Returns the value both devices end up with. */
export type Merge = (conflict: Conflict) => unknown

/** Keeps whichever edit was made last. The default, and right for single settings like a number of servings. */
export const newestWins: Merge = (conflict) =>
  conflict.mineChangedAt >= conflict.theirsChangedAt ? conflict.mine : conflict.theirs

/**
 * Merges two edits of the same list, like favourites: what either side added stays, what either side removed goes.
 * Without a base every item from both sides is kept, so joining a space never throws anything away.
 */
export function mergeLists<T>(base: readonly T[] | null, mine: readonly T[], theirs: readonly T[]): T[] {
  const addedHere = mine.filter((item) => !base?.includes(item))
  const removedHere = base?.filter((item) => !mine.includes(item)) ?? []
  const kept = theirs.filter((item) => !removedHere.includes(item))
  return [...kept, ...addedHere.filter((item) => !kept.includes(item))]
}
