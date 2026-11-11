import { describe, expect, it } from 'vitest'
import { searchWords } from '@/lib/utils/list'

describe('searchWords', () => {
  const fields = ['fullName', 'email']

  it('returns nothing for an empty search', () => {
    expect(searchWords(undefined, fields)).toEqual([])
    expect(searchWords('   ', fields)).toEqual([])
  })

  it('makes every word match at least one field (so "heena gmail" works across fields)', () => {
    const clauses = searchWords('heena  gmail', fields)
    expect(clauses).toHaveLength(2)
    expect(clauses[0]).toEqual({ OR: [{ fullName: { contains: 'heena', mode: 'insensitive' } }, { email: { contains: 'heena', mode: 'insensitive' } }] })
    expect(clauses[1]).toEqual({ OR: [{ fullName: { contains: 'gmail', mode: 'insensitive' } }, { email: { contains: 'gmail', mode: 'insensitive' } }] })
  })

  it('caps the number of words so a huge search string cannot build a huge query', () => {
    expect(searchWords('a b c d e f g h i j', fields)).toHaveLength(6)
  })
})
