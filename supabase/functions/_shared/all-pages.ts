/**
 * Read EVERY row of a list PostgREST would otherwise cut at its `max_rows` (1000 — supabase/config.toml,
 * and the hosted default). The Edge Functions' copy of `src/lib/query/all-pages.ts` + `in-chunks.ts`
 * (I59.39): a function cannot import from `src/`, so the behaviour is repeated here, with its own tests.
 * Keep the two in step — same page size, same stop rule, same batch size.
 *
 * Past a thousand rows PostgREST says nothing — no error, just a shorter list (`Content-Range:
 * 0-999/2154`). In a function that is a capacity check that never sees the bookings after the first
 * thousand, and so passes a slot that is already full.
 *
 * Every read here must carry a STABLE `.order()` (a unique key, or a key plus an `id` tie-break), or
 * pages overlap and skip.
 *
 *   - `allRows`       — page after page until one comes back short; one round trip while the list is
 *                       under a thousand rows, which it nearly always is;
 *   - `inChunks`      — a long id list split into batches of 100, so the URL stays under the gateway's
 *                       limit (I49.75: 230 ids gave *414 URI Too Long*);
 *   - `inChunksPaged` — `inChunks` with each batch paged, because a hundred parents can own more than a
 *                       thousand children.
 */
export const PAGE_ROWS = 1000
export const IN_CHUNK = 100

/** The shape every PostgREST read resolves to. */
export interface ReadResult {
  data: unknown
  error: unknown
}

/** Every row of `read`, a page of PAGE_ROWS at a time, stopping at the first short page. Throws the
 *  first error rather than returning part of the list. */
export async function allRows<Row>(read: (from: number, to: number) => PromiseLike<ReadResult>): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await read(from, from + PAGE_ROWS - 1)
    if (error) throw error
    const page = (data ?? []) as Row[]
    out.push(...page)
    if (page.length < PAGE_ROWS) return out
  }
}

/** Rows for a list of ids, asked for in batches of IN_CHUNK (deduplicated), in batch order. */
export async function inChunks<Row>(
  ids: readonly string[],
  read: (chunk: string[]) => PromiseLike<ReadResult>,
): Promise<Row[]> {
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

/** `inChunks` with every batch read to its last row (`allRows`). */
export function inChunksPaged<Row>(
  ids: readonly string[],
  read: (chunk: string[], from: number, to: number) => PromiseLike<ReadResult>,
): Promise<Row[]> {
  return inChunks<Row>(ids, (chunk) => allRows<Row>((from, to) => read(chunk, from, to)).then((data) => ({ data, error: null })))
}

/** `allRows` for a read whose caller treats a failure as "no rows" (the function's previous
 *  behaviour, `data ?? []`): the error is returned in the envelope instead of thrown, so a caller's
 *  error handling stays exactly what it was. */
export async function allRowsResult<Row>(
  read: (from: number, to: number) => PromiseLike<ReadResult>,
): Promise<{ data: Row[] | null; error: unknown }> {
  try {
    return { data: await allRows<Row>(read), error: null }
  } catch (error) {
    return { data: null, error }
  }
}
