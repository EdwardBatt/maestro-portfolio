import type { TFunction } from 'i18next'

/**
 * The standard folders' names are seeded data (`Key Visuals`, `Working Files`, ADR-0022) and appear in
 * every tenant. The frames write them in sentence case ("Key visuals", "Working files") and they must
 * read in Arabic too, so a standard folder is displayed through the locale files; a folder somebody
 * made is shown exactly as they typed it.
 */
const STANDARD: Record<string, string> = {
  'logos': 'logos',
  'fonts': 'fonts',
  'guidelines': 'guidelines',
  'key visuals': 'keyVisuals',
  'working files': 'workingFiles',
  'deliverables': 'deliverables',
  'final assets': 'finalAssets',
  'references': 'references',
  'brand assets': 'brandAssets',
  'projects': 'projects',
}

export function folderName(t: TFunction, name: string, isSystem: boolean): string {
  const key = isSystem ? STANDARD[name.trim().toLowerCase()] : undefined
  return key ? t(`library.std.${key}`) : name
}

/** A standard folder's one-line description on its card (LB-06): "the brief, proof and client material". */
export function folderHint(t: TFunction, name: string): string | null {
  const key = STANDARD[name.trim().toLowerCase()]
  if (!key) return null
  const text = t(`library.stdHint.${key}`, { defaultValue: '' })
  return text || null
}

export function isDeliverablesFolder(f: { name: string; kind: string; campaignId: string | null }): boolean {
  return f.kind === 'asset_type' && Boolean(f.campaignId) && f.name.trim().toLowerCase() === 'deliverables'
}

export function isReferencesFolder(f: { name: string }): boolean {
  return f.name.trim().toLowerCase() === 'references'
}

/** The frames' order for the standard folders (LB-01, LB-03, LB-06); a made folder follows, by name. */
const ORDER = ['logos', 'fonts', 'guidelines', 'key visuals', 'references', 'working files', 'final assets', 'deliverables']
export function standardRank(name: string): number {
  const i = ORDER.indexOf(name.trim().toLowerCase())
  return i === -1 ? ORDER.length : i
}
export function byStandardOrder<T>(list: T[], nameOf: (x: T) => string): T[] {
  return [...list].sort((a, b) => standardRank(nameOf(a)) - standardRank(nameOf(b)) || nameOf(a).localeCompare(nameOf(b)))
}

/** The kinds no file can be put in loose: the roots, and for an upload a brand's or a project's top level (d.15). */
export const ROOT_KINDS = ['client_root', 'brand_root', 'projects_root']
export const NO_LOOSE_UPLOAD_KINDS = [...ROOT_KINDS, 'brand', 'campaign']
