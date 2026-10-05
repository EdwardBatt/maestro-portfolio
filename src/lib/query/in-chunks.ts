/**
 * Read rows for a LIST of ids without putting the whole list in one request's address.
 *
 * `I49.75`, 15 Sep: My Work stopped loading for a person with ~230 live tasks. The page fetched
 * the reviewers on every task with one `.in('sub_task_id', <every id>)` — a GET whose query
 * string carried 230 UUIDs, ~9 KB — and Kong answered *414 URI Too Long*. The database would
 * have answered fine; it was the shape of the question. Three other reads sent the same shape
 * (extension events, pending assignment requests, task dependencies) and would have failed at the
 * same person.
 *
 * Batches of 100 ids: 100 × 37 characters is ~3.7 KB, under any gateway's limit with room for the
 * rest of the query. The batches go out together, and the rows come back in batch order — so a
 * read that relies on `.order()` still sees each id's rows in the order the server gave them,
 * because all of one id's rows are in one batch.
 *
 * Not an embed on the parent select: `sub_task_reviewers → user_profiles` is a composite key an
 * embed cannot resolve, and an unresolvable embed comes back EMPTY rather than as an error
 * (traps.md — this project has been bitten by that twice). Batching keeps the flat reads flat.
 */
export const IN_CHUNK = 100

/** The shape every PostgREST read resolves to. `data` is untyped because the reads here go
 *  through `supabaseUntyped`; the caller names the row shape, as it did before. */
export interface ReadResult {
  data: unknown
  error: unknown
}

export async function inChunks<Row>(
  ids: readonly string[],
  read: (chunk: string[]) => PromiseLike<ReadResult>,
): Promise<Row[]> {
  // Deduplicated: a list assembled from several rows may name the same id twice, and the same
  // row must not come back twice.
  const unique = [...new Set(ids)]
  if (unique.length === 0) return []
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += IN_CHUNK) chunks.push(unique.slice(i, i + IN_CHUNK))
  const results = await Promise.all(chunks.map((chunk) => read(chunk)))
  const out: Row[] = []
  for (const { data, error } of results) {
    if (error) throw error
    out.push(...((data ?? []) as Row[]))
  }
  return out
}
