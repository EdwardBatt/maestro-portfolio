import { useQuery } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { inChunks } from '../../../lib/query/in-chunks'
import type { AuditRow } from './roles-api'

/**
 * The audit log names the record, and where it sits (I51.2).
 *
 * `useAuditLookups` resolves people, roles, resources, offices, departments and teams — the admin
 * catalogue. Everything the agency actually works on (campaigns, briefs, deliverables, tasks, jobs,
 * clients, brands, streams) fell through to an 8-character id, which is how Edward came to read
 * *"Department brief · 04e20210"* and have no idea which brief it was.
 *
 * Resolved for the rows ON THE PAGE, not tenant-wide: a task lookup over every task ever made is
 * the wrong size for a screen showing 200 events. `inChunks` keeps the id lists off the URL limit.
 *
 * Every embed below is written LITERALLY — the PostgREST scanner test cannot read an interpolated
 * select (traps.md). `deliverables → jobs` is NAMED: `jobs.source_deliverable_id` is a second route
 * and an unnamed embed is refused as ambiguous (PGRST201). A `name` is the record's own name; `where` is the thing it belongs to, so the
 * row reads "Department brief · Creative — Kite Travel Summer".
 */
export interface AuditRecordName {
  name: string
  where: string | null
}

/** `${entity}:${id}` → name and place. */
export type AuditRecordNames = Map<string, AuditRecordName>

export const auditRecordKey = (entity: string, id: string) => `${entity}:${id}`

/** The entities this resolver knows. Anything else keeps the catalogue lookup or the short id. */
export const NAMED_ENTITIES = new Set([
  'campaigns', 'campaign_briefs', 'deliverables', 'sub_tasks', 'jobs', 'streams', 'clients', 'brands',
])

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const one = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null)

async function readNames(entity: string, ids: string[]): Promise<[string, AuditRecordName][]> {
  const key = (r: Row) => auditRecordKey(entity, r.id as string)
  // One literal `.from('…').select('…')` per entity: the PostgREST scanner test reads these as
  // written and checks every column and embed against the schema; a table passed as a variable
  // is a site it cannot read.
  switch (entity) {
    case 'campaigns': {
      const rows = await inChunks<Row>(ids, (chunk) => supabaseUntyped.from('campaigns').select('id, name, clients(name)').in('id', chunk))
      return rows.map((r) => [key(r), { name: str(r.name) ?? '', where: str(one(r.clients)?.name) }])
    }
    case 'campaign_briefs': {
      const rows = await inChunks<Row>(ids, (chunk) => supabaseUntyped.from('campaign_briefs').select('id, campaigns(name), departments(name)').in('id', chunk))
      return rows.map((r) => [key(r), { name: str(one(r.departments)?.name) ?? '', where: str(one(r.campaigns)?.name) }])
    }
    case 'deliverables': {
      const rows = await inChunks<Row>(ids, (chunk) => supabaseUntyped.from('deliverables').select('id, name, streams(campaigns(name)), job:jobs!deliverables_job_id_fkey(name)').in('id', chunk))
      return rows.map((r) => [key(r), {
        name: str(r.name) ?? '',
        where: str(one(one(r.streams)?.campaigns)?.name) ?? str(one(r.job)?.name),
      }])
    }
    case 'sub_tasks': {
      const rows = await inChunks<Row>(ids, (chunk) => supabaseUntyped.from('sub_tasks').select('id, title, deliverables(name, streams(campaigns(name)), job:jobs!deliverables_job_id_fkey(name))').in('id', chunk))
      return rows.map((r) => {
        const d = one(r.deliverables)
        const parent = str(one(one(d?.streams)?.campaigns)?.name) ?? str(one(d?.job)?.name)
        const dName = str(d?.name)
        return [key(r), { name: str(r.title) ?? '', where: dName && parent ? `${dName} — ${parent}` : dName ?? parent }]
      })
    }
    case 'jobs': {
      const rows = await inChunks<Row>(ids, (chunk) => supabaseUntyped.from('jobs').select('id, name, clients(name)').in('id', chunk))
      return rows.map((r) => [key(r), { name: str(r.name) ?? '', where: str(one(r.clients)?.name) }])
    }
    case 'streams': {
      const rows = await inChunks<Row>(ids, (chunk) => supabaseUntyped.from('streams').select('id, name, campaigns(name)').in('id', chunk))
      return rows.map((r) => [key(r), { name: str(r.name) ?? '', where: str(one(r.campaigns)?.name) }])
    }
    case 'clients': {
      const rows = await inChunks<Row>(ids, (chunk) => supabaseUntyped.from('clients').select('id, name').in('id', chunk))
      return rows.map((r) => [key(r), { name: str(r.name) ?? '', where: null }])
    }
    case 'brands': {
      const rows = await inChunks<Row>(ids, (chunk) => supabaseUntyped.from('brands').select('id, name, clients(name)').in('id', chunk))
      return rows.map((r) => [key(r), { name: str(r.name) ?? '', where: str(one(r.clients)?.name) }])
    }
    default:
      return []
  }
}

/** Names for the work records among these events. A deleted record resolves to nothing and the
 *  page falls back to the short id — the log outlives the row, by design. */
export function useAuditRecordNames(events: readonly AuditRow[]) {
  const wanted = new Map<string, Set<string>>()
  for (const e of events) {
    if (!e.entityId || !NAMED_ENTITIES.has(e.entity)) continue
    let set = wanted.get(e.entity)
    if (!set) wanted.set(e.entity, (set = new Set()))
    set.add(e.entityId)
  }
  // The key is the sorted id list, so a new page of events re-resolves and an unchanged one does not.
  const keyParts = [...wanted.entries()].map(([entity, ids]) => `${entity}:${[...ids].sort().join(',')}`).sort()
  return useQuery({
    queryKey: ['audit-record-names', keyParts],
    enabled: wanted.size > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<AuditRecordNames> => {
      const parts = await Promise.all([...wanted.entries()].map(([entity, ids]) => readNames(entity, [...ids])))
      return new Map(parts.flat())
    },
  })
}
