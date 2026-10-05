import { describe, expect, it } from 'vitest'
import { keyFromName } from './role-key'

describe('keyFromName (L1.11 role slugs)', () => {
  it('lowercases and underscores', () => {
    expect(keyFromName('Producer')).toBe('producer')
    expect(keyFromName('Team Member +Reports')).toBe('team_member_reports')
  })

  it('collapses runs and trims edge separators', () => {
    expect(keyFromName('  --Senior   Editor--  ')).toBe('senior_editor')
  })

  it('caps at 50 characters', () => {
    expect(keyFromName('x'.repeat(80)).length).toBe(50)
  })

  it('strips diacritics via NFKD', () => {
    expect(keyFromName('Producción Café')).toBe('produccio_n_cafe')
  })
})
