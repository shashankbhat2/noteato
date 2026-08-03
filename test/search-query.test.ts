import { describe, expect, it } from 'vitest'
import { parseSearchQuery, slugify } from '../src/main/storage'

// Phase 4 replaces NoteStore.search() wholesale (see docs/revamp/phase-plan.md).
// These pin the query-parsing behaviour that has to survive that rewrite: the
// syntax is user-facing and documented in the README.
describe('parseSearchQuery', () => {
  it('splits tag terms from free text', () => {
    expect(parseSearchQuery('#launch deepgram costs')).toEqual({
      tags: ['launch'],
      text: 'deepgram costs'
    })
  })

  it('treats tag: and # as the same thing', () => {
    expect(parseSearchQuery('tag:launch')).toEqual(parseSearchQuery('#launch'))
  })

  it('collects every tag term in a multi-tag query', () => {
    expect(parseSearchQuery('#a #b text').tags).toEqual(['a', 'b'])
  })

  it('normalises separators so #note-taking matches the tag "note taking"', () => {
    expect(parseSearchQuery('#note-taking').tags).toEqual(['notetaking'])
  })

  it('returns nothing to filter on for an empty query', () => {
    expect(parseSearchQuery('   ')).toEqual({ tags: [], text: '' })
  })
})

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Launch Notes Q3')).toBe('launch-notes-q3')
  })

  it('collapses punctuation runs and trims stray hyphens', () => {
    expect(slugify('  Launch: the *sequel*!  ')).toBe('launch-the-sequel')
  })

  it('falls back to "untitled" when nothing survives', () => {
    expect(slugify('!!!')).toBe('untitled')
    expect(slugify('')).toBe('untitled')
  })
})
