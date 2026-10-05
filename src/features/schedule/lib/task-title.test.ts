import { describe, expect, it } from 'vitest'
import { stepOf, taskWithPiece } from './task-title'

describe('taskWithPiece — the pop-up title says the piece once (SC-26)', () => {
  it('keeps a title that already ends with the piece', () => {
    expect(taskWithPiece('Write Copy — Social Advertisement', 'Social Advertisement')).toBe('Write Copy — Social Advertisement')
  })
  it('folds the piece said twice into once', () => {
    expect(taskWithPiece('Write Copy — Social Advertisement — Social Advertisement', 'Social Advertisement')).toBe('Write Copy — Social Advertisement')
    expect(taskWithPiece('Write Copy — social advertisement', 'Social Advertisement')).toBe('Write Copy — Social Advertisement')
  })
  it('keeps the unit number of a piece of several', () => {
    expect(taskWithPiece('Write Copy — Social statics 3', 'Social statics')).toBe('Write Copy — Social statics 3')
  })
  it('adds the piece to a bare step', () => {
    expect(taskWithPiece('Create artwork', 'Post 2')).toBe('Create artwork — Post 2')
  })
  it('leaves a title that names the piece elsewhere, and a title with no piece', () => {
    expect(taskWithPiece('Social Advertisement brief check', 'Social Advertisement')).toBe('Social Advertisement brief check')
    expect(taskWithPiece('Create artwork', null)).toBe('Create artwork')
  })
})

describe('stepOf — the step alone, for the list of the piece\'s tasks', () => {
  it('drops the piece', () => {
    expect(stepOf('Write Copy — Social Advertisement', 'Social Advertisement')).toBe('Write Copy')
    expect(stepOf('Develop concept', 'Post 2')).toBe('Develop concept')
  })
  it('keeps the unit number', () => {
    expect(stepOf('Write Copy — Social statics 3', 'Social statics')).toBe('Write Copy 3')
  })
})

describe('the 4 Oct titles — campaign and type, not the deliverable (ADR-0071 addendum)', () => {
  it('the piece is added once after the campaign, and the step list keeps the campaign · type and unit', () => {
    expect(taskWithPiece('Write Copy — Northwind Summer Launch', 'Social statics')).toBe('Write Copy — Northwind Summer Launch — Social statics')
    expect(stepOf('Create Artwork — Northwind Summer Launch · Static Post 3', 'Social statics')).toBe('Create Artwork — Northwind Summer Launch · Static Post 3')
  })
})
