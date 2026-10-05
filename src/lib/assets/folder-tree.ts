/**
 * The asset folder tree as DATA — the shape, and the pure functions for walking it.
 *
 * WHY THIS IS SEPARATE FROM `folders.ts`. That file holds the TanStack hooks, so it imports
 * `lib/supabase`, which imports `lib/env`, which Zod-parses `import.meta.env` **at import time**
 * and throws when the `VITE_` variables are absent — as they are in CI (traps.md).
 *
 * `components/FolderPicker.tsx` is a dumb presentational component that fetches nothing, and it
 * needed exactly one function from here (`breadcrumbWithin`). Importing it from `folders.ts` pulled
 * the whole Supabase client into a UI primitive's module graph, and its test suite failed in CI on
 * an environment variable it has no business needing. Mocking the module in that test would have
 * made the symptom go away and left the cause: a shared component able to reach the database
 * client. Splitting is the fix — nothing in this file imports anything.
 *
 * `folders.ts` re-exports all of it, so existing callers are unaffected.
 */

export interface AssetFolder {
  id: string
  clientId: string
  parentId: string | null
  name: string
  kind: string
  isSystem: boolean
  /** Present on the brand subtree, so a brand's folders can be found without walking parents. */
  brandId: string | null
  /** Present on the campaign subtree, same reason. */
  campaignId: string | null
}

/**
 * Postgres reports a duplicate sibling name as `23505` against `uq_asset_folders_sibling`. It is
 * the one folder error a person routinely causes, so it is the one that has to read as a sentence
 * rather than as a constraint name.
 */
export function isDuplicateFolderName(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

/** The campaign's own folder, from the tree — the root of what the wizard lets you file into. */
export function campaignRoot(folders: readonly AssetFolder[], campaignId: string): AssetFolder | null {
  return folders.find((f) => f.kind === 'campaign' && f.campaignId === campaignId) ?? null
}

/** The brand's own folder. Same shape, different subtree. */
export function brandRoot(folders: readonly AssetFolder[], brandId: string): AssetFolder | null {
  return folders.find((f) => f.kind === 'brand' && f.brandId === brandId) ?? null
}

/**
 * What one screen position needs from the tree, and nothing more (I49.77): the folder you are in
 * with the chain above it up to the client root, and its children. The tree is never held whole —
 * a client with 2,588 folders (Northwind, locally) was coming back cut at the server's 1,000-row
 * cap, could not assemble itself, and showed an EMPTY Library.
 *
 * `chain[0]` is the client root; `chain[chain.length - 1]` is the folder itself. `folders` is the
 * two joined — the list a `FolderPicker` needs, which reads a breadcrumb and one level of children
 * and nothing else.
 */
export interface FolderView {
  root: AssetFolder
  chain: AssetFolder[]
  children: AssetFolder[]
  folders: AssetFolder[]
}

/**
 * Build a view from a list already in hand — the pure half, which the tests' mocks use so they
 * describe the same shape the reader returns. The root is the client root where the list has
 * one, else the top of the chain (a wizard fixture holds only a brand's subtree).
 */
export function viewOf(folders: readonly AssetFolder[], folderId: string | null): FolderView | null {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const clientRoot = folders.find((f) => f.kind === 'client_root') ?? null
  let cur = (folderId ? byId.get(folderId) : null) ?? clientRoot
  if (!cur) return null
  const chain: AssetFolder[] = []
  while (cur) {
    chain.unshift(cur)
    cur = cur.parentId ? byId.get(cur.parentId) ?? null : null
  }
  const root = clientRoot ?? chain[0]!
  const here = chain[chain.length - 1]!
  const children = folders.filter((f) => f.parentId === here.id).slice().sort((a, b) => a.name.localeCompare(b.name))
  return { root, chain, children, folders: [...chain, ...children] }
}

/** Walk from `folderId` up to `rootId` inclusive, nearest-root first. Empty if outside the root. */
export function breadcrumbWithin(
  folders: readonly AssetFolder[],
  rootId: string,
  folderId: string,
): AssetFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const chain: AssetFolder[] = []
  let cur = byId.get(folderId) ?? null
  while (cur) {
    chain.unshift(cur)
    if (cur.id === rootId) return chain
    cur = cur.parentId ? byId.get(cur.parentId) ?? null : null
  }
  // Ran past the root without meeting it: `folderId` is not inside `rootId`.
  return []
}
