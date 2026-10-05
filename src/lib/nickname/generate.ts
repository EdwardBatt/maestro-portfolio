// Fun, MENA-flavoured resource nicknames (ADR-0011). A nickname is a short,
// unique-per-tenant handle — the unambiguous identifier when two staff share a
// display name. It is auto-generated at invite and fully editable (🎲 reroll in
// the UI), and it is internal-only (clients never see it).
//
// The canonical, signed-off word pools live in docs/nickname-wordlists.md.
// KEEP THIS FILE IN SYNC WITH THAT DOCUMENT. The bulk of the team is Egyptian /
// Iraqi, so the nouns lean into shared, affectionate food & nature references
// plus creative-agency terms; adjectives are English and gender-neutral.

export const NICKNAME_ADJECTIVES = [
  'Turbo', 'Cosmic', 'Zen', 'Golden', 'Mighty', 'Sizzling', 'Dapper', 'Sunny',
  'Legendary', 'Radiant', 'Nimble', 'Bold', 'Cheeky', 'Mellow', 'Electric',
  'Swift', 'Stellar', 'Jolly', 'Snazzy', 'Breezy', 'Plucky', 'Dazzling',
  'Peppy', 'Gallant', 'Vivid', 'Lively', 'Groovy', 'Nifty', 'Epic', 'Smooth',
  'Blazing', 'Cool', 'Brave', 'Cosy',
] as const

export const NICKNAME_NOUNS = [
  // Egyptian food
  'Koshari', 'Molokhia', 'Basbousa', 'Karkade', 'Feteer', 'Mahshi', 'Guava', 'Mango',
  // Iraqi food
  'Masgouf', 'Dolma', 'Kleicha', 'Kubba', 'Tashreeb', 'Geymar', 'Tamr',
  // Shared / other
  'Kunafa', 'Baklava', 'Falafel', 'Shawarma', 'Sahlab', 'Qahwa', 'Chai', 'Sugarcane',
  // Nature & symbols
  'Falcon', 'Lion', 'Gazelle', 'Palm', 'Nile', 'Cedar', 'Jasmine', 'Phoenix',
  'Comet', 'Oasis', 'Sun', 'Moon', 'Star',
  // Creative / agency
  'Keyframe', 'Reel', 'Lens', 'Render', 'Storyboard', 'Pixel', 'Palette',
  'Canvas', 'Frame', 'Draft', 'Print',
] as const

/**
 * A random `<Adjective> <Noun>` handle, e.g. "Turbo Koshari", "Golden Gazelle".
 * `rng` is injectable so tests can be deterministic; defaults to Math.random.
 * ~34 × 47 ≈ 1,600 combinations before any de-dup suffix is needed.
 */
export function randomNickname(rng: () => number = Math.random): string {
  const adj = NICKNAME_ADJECTIVES[Math.floor(rng() * NICKNAME_ADJECTIVES.length)]
  const noun = NICKNAME_NOUNS[Math.floor(rng() * NICKNAME_NOUNS.length)]
  return `${adj} ${noun}`
}
