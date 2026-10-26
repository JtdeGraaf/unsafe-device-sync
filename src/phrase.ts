/**
 * The shared code: a few words from a list, like "tomaat-oven-paars-lepel". Anyone who has the words can read and
 * change the space, so they are a house key, not a password.
 */

export const DEFAULT_WORD_COUNT = 4

/** Picks `count` words at random, each with the same chance, joined by dashes. */
export function newPhrase(words: readonly string[], count = DEFAULT_WORD_COUNT): string {
  return Array.from({ length: count }, () => words[randomIndex(words.length)]).join('-')
}

/** How hard a code from this list is to guess, in bits. */
export function phraseStrength(words: readonly string[], count = DEFAULT_WORD_COUNT): number {
  return count * Math.log2(new Set(words).size)
}

export type ReadPhrase =
  | { status: 'ok'; phrase: string }
  | { status: 'wrong-word-count'; wordCount: number }
  | { status: 'unknown-words'; unknownWords: string[] }

/**
 * Reads a code as someone typed it: capitals, spaces, dashes, commas and stray whitespace are all fine. Checks every
 * word against the list, so a typo is caught before it can look like an empty space.
 */
export function readPhrase(text: string, words: readonly string[], count = DEFAULT_WORD_COUNT): ReadPhrase {
  const typed = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word !== '')
  if (typed.length !== count) return { status: 'wrong-word-count', wordCount: typed.length }
  const known = new Set(words)
  const unknownWords = typed.filter((word) => !known.has(word))
  if (unknownWords.length > 0) return { status: 'unknown-words', unknownWords }
  return { status: 'ok', phrase: typed.join('-') }
}

/**
 * The space id for a code, as SHA-256 hex. The app name goes in too, so the same words in two apps open two
 * different spaces.
 */
export async function spaceIdFor(appName: string, phrase: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${appName}:${phrase}`))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A whole number below `size` from the browser's secure random source, without the bias of a plain modulo. */
function randomIndex(size: number): number {
  const limit = Math.floor(2 ** 32 / size) * size
  const buffer = new Uint32Array(1)
  do crypto.getRandomValues(buffer)
  while (buffer[0] >= limit)
  return buffer[0] % size
}
