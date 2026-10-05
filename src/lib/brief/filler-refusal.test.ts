import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { fillerRefusalMessage, readFillerRefusal } from './filler-refusal'

const refusal = (detail: unknown) => ({
  code: '22023',
  hint: 'brief_filler',
  details: typeof detail === 'string' ? detail : JSON.stringify(detail),
  message: 'The task still says ...',
})

describe('the filler refusal, said as a sentence (ADR-0111 d.2)', () => {
  it('reads the field, its label and its text from DETAIL', () => {
    expect(readFillerRefusal(refusal({ field: 'task', label: 'The task', text: 'XYZ 123' }))).toEqual({
      field: 'task', label: 'The task', text: 'XYZ 123',
    })
  })

  it('is null for anything that is not this refusal', () => {
    expect(readFillerRefusal({ code: '22023', hint: 'something_else' })).toBeNull()
    expect(readFillerRefusal({ code: '42501', hint: 'brief_filler' })).toBeNull()
    expect(readFillerRefusal(new Error('x'))).toBeNull()
    expect(readFillerRefusal(null)).toBeNull()
  })

  it('survives a DETAIL that is not JSON', () => {
    expect(readFillerRefusal(refusal('not json'))).toEqual({ field: '', label: '', text: '' })
  })

  it('"<Field> still says \'<text>\' — write the real <field>."', async () => {
    await i18n.changeLanguage('en')
    const t = i18n.t.bind(i18n)
    expect(fillerRefusalMessage(t, refusal({ field: 'task', label: 'The task', text: 'XYZ 123' }))).toBe(
      "The task still says 'XYZ 123' — write the real task.",
    )
    expect(fillerRefusalMessage(t, refusal({ field: 'proposition', label: 'The proposition', text: 'TBD' }), () => 'Proposition')).toBe(
      "Proposition still says 'TBD' — write the real proposition.",
    )
    expect(fillerRefusalMessage(t, { code: '23505' })).toBeNull()
  })

  it('in Arabic, names the field in the reader\'s language where the screen knows it', async () => {
    await i18n.changeLanguage('ar')
    const t = i18n.t.bind(i18n)
    const text = fillerRefusalMessage(t, refusal({ field: 'task', label: 'The task', text: 'TBD' }), () => 'المهمة')
    expect(text).toContain('المهمة')
    expect(text).toContain('TBD')
    await i18n.changeLanguage('en')
  })
})
