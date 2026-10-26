import { describe, expect, it } from 'vitest'
import { mergeLists, newestWins } from './merge'

describe('merging two edits of a list', () => {
  it('keeps what either side added', () => {
    expect(mergeLists(['soup'], ['soup', 'pie'], ['soup', 'stew'])).toEqual(['soup', 'stew', 'pie'])
  })

  it('drops what either side removed', () => {
    expect(mergeLists(['soup', 'pie', 'stew'], ['pie', 'stew'], ['soup', 'pie'])).toEqual(['pie'])
  })

  it('keeps everything from both sides without a base', () => {
    expect(mergeLists(null, ['pie', 'soup'], ['soup', 'stew'])).toEqual(['soup', 'stew', 'pie'])
  })
})

describe('keeping the newest edit', () => {
  it('picks the edit made last', () => {
    const conflict = { key: 'servings', base: 4, mine: 2, theirs: 6, mineChangedAt: 10, theirsChangedAt: 20 }

    expect(newestWins(conflict)).toBe(6)
    expect(newestWins({ ...conflict, mineChangedAt: 30 })).toBe(2)
  })
})
