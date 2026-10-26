import { describe, expect, it } from 'vitest'
import { newPhrase, phraseStrength, readPhrase, spaceIdFor } from './phrase'
import { DUTCH_WORDS } from './words/nl'

const WORDS = ['tomaat', 'oven', 'paars', 'lepel', 'vork']

describe('the shared code', () => {
  it('is made of words from the list, joined by dashes', () => {
    const words = newPhrase(WORDS).split('-')

    expect(words).toHaveLength(4)
    expect(words.every((word) => WORDS.includes(word))).toBe(true)
  })

  it('reads a code typed with capitals, spaces and commas', () => {
    expect(readPhrase('  Tomaat, OVEN paars -lepel ', WORDS)).toEqual({ status: 'ok', phrase: 'tomaat-oven-paars-lepel' })
  })

  it('names the words that are not on the list', () => {
    expect(readPhrase('tomaat oven pars lepl', WORDS)).toEqual({ status: 'unknown-words', unknownWords: ['pars', 'lepl'] })
  })

  it('says how many words were typed when that is not the number asked for', () => {
    expect(readPhrase('tomaat oven paars', WORDS)).toEqual({ status: 'wrong-word-count', wordCount: 3 })
  })

  it('opens a different space for the same words in another app', async () => {
    const inBook = await spaceIdFor('cookbook', 'tomaat-oven-paars-lepel')
    const inOtherApp = await spaceIdFor('cocktails', 'tomaat-oven-paars-lepel')

    expect(inBook).toMatch(/^[0-9a-f]{64}$/)
    expect(inOtherApp).not.toBe(inBook)
  })
})

describe('the Dutch word list', () => {
  it('has every word once, in plain a to z', () => {
    expect(new Set(DUTCH_WORDS).size).toBe(DUTCH_WORDS.length)
    expect(DUTCH_WORDS.filter((word) => !/^[a-z]+$/.test(word))).toEqual([])
  })

  it('makes four-word codes of at least 39 bits', () => {
    expect(phraseStrength(DUTCH_WORDS)).toBeGreaterThanOrEqual(39)
  })
})
