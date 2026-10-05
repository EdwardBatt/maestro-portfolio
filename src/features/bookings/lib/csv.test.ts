import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'

describe('toCsv (L3.4)', () => {
  it('joins rows with CRLF and cells with commas', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d')
  })

  it('quotes cells containing commas, quotes, or newlines (RFC-4180)', () => {
    expect(toCsv([['a,b', 'c']])).toBe('"a,b",c')
    expect(toCsv([['say "hi"', 'x']])).toBe('"say ""hi""",x')
    expect(toCsv([['line1\nline2', 'x']])).toBe('"line1\nline2",x')
  })

  it('stringifies numbers and empty cells', () => {
    expect(toCsv([[1, 2.5, '']])).toBe('1,2.5,')
  })
})
