import { inChunks, type ReadResult } from './in-chunks'

/**
 * Read EVERY row of a list PostgREST would otherwise cut at its `max_rows` (1000 — supabase/config.toml,
 * and the hosted default).
 *
 * 25 Sep: the chat rail (`my_conversations`) answered a department lead with 2,154 rows; PostgREST
 * returned the first 1000 (`Content-Range: 0-999/2154`) and said nothing else, so a job released that
 * minute had no thread in the rail and searching for it found "Nothing matches that". No error, just
 * a shorter list — the failure mode of every unpaged list read past a thousand rows. An RPC that
 * returns a set is cut the same way, so it is paged the same way (`.range()` on the `rpc()` call).
 *
 * Every read here must carry a STABLE `.order()` (a unique key, or a key plus a tie-break), or pages
 * overlap and skip.
 *
 * Three shapes:
 *   - `restPages` — the caller reads the first page itself with `count: 'exact'` (so it can show at
 *     once) and the later pages are asked for together;
 *   - `allRows` — page after page until one comes back short: no count, one round trip while the list
 *     is under a thousand rows, which it nearly always is;
 *   - `inChunksPaged` — `inChunks` (a long id list split into batches of 100) with each batch paged,
 *     because a hundred parents can own more than a thousand children.
 */
export const PAGE_ROWS = 1000

/** The pages after the first, asked for at once, given the total the first page's exact count gave. */
export async function restPages<Row>(total: number, read: (from: number, to: number) => PromiseLike<ReadResult>): Promise<Row[]> {
  const froms: number[] = []
  for (let from = PAGE_ROWS; from < total; from += PAGE_ROWS) froms.push(from)
  const pages = await Promise.all(froms.map((from) => read(from, from + PAGE_ROWS - 1)))
  const out: Row[] = []
  for (const { data, error } of pages) {
    if (error) throw error
    out.push(...((data ?? []) as Row[]))
  }
  return out
}

/** Every row of `read`, a page of PAGE_ROWS at a time, stopping at the first short page. */
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

/** `inChunks` with every batch read to its last row (`allRows`). */
export function inChunksPaged<Row>(
  ids: readonly string[],
  read: (chunk: string[], from: number, to: number) => PromiseLike<ReadResult>,
): Promise<Row[]> {
  return inChunks<Row>(ids, (chunk) => allRows<Row>((from, to) => read(chunk, from, to)).then((data) => ({ data, error: null })))
}
