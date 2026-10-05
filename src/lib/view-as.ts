/**
 * ADR-0120: "view as a person" (holders of dev_view:view, read-only — ADR-0120 addendum). While set, every database request
 * carries `x-maestro-view-as`, and the database itself (`public.view_as_pre_request`) runs that
 * request read-only as the named person, after checking the real caller is a Power Admin. This
 * module only carries the id to the fetch wrapper in `supabase.ts`; the auth context sets it.
 */
export const VIEW_AS_HEADER = 'x-maestro-view-as'

export const viewAsStore: { userId: string | null } = { userId: null }

/** The request's headers with the view-as header added, for a database request while viewing. */
export function withViewAs(url: string, init: RequestInit | undefined): RequestInit | undefined {
  if (!viewAsStore.userId || !url.includes('/rest/v1/')) return init
  const headers = new Headers(init?.headers)
  headers.set(VIEW_AS_HEADER, viewAsStore.userId)
  return { ...init, headers }
}
