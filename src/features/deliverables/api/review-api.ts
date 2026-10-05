import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseUntyped } from '../../../lib/supabase'
import { useAuth } from '../../../app/auth-context'
import { deliverableKeys } from './deliverables-api'

/**
 * Internal review media API (ADR-0025, I3.1). The version chain on a deliverable: list versions,
 * upload a new one (presigned PUT straight to B2 via the review-media Edge Function, then write the
 * media_records row through RLS — the DB stamps `version` and audits it), and mint a short-TTL
 * view URL on demand. The function only signs; the DB is the source of truth. Bytes never pass
 * through the app.
 */

export const reviewKeys = {
  all: ['review'] as const,
  /** Every versions query on one deliverable, whichever task it is narrowed to — the invalidation prefix. */
  allVersions: (deliverableId: string) => [...reviewKeys.all, 'versions', deliverableId] as const,
  versions: (deliverableId: string, subTaskId?: string | null) =>
    [...reviewKeys.allVersions(deliverableId), subTaskId ?? 'all'] as const,
  viewUrl: (mediaRecordId: string) => [...reviewKeys.all, 'view-url', mediaRecordId] as const,
  comments: (mediaRecordId: string) => [...reviewKeys.all, 'comments', mediaRecordId] as const,
  taskComments: (subTaskId: string) => [...reviewKeys.all, 'task-comments', subTaskId] as const,
}

export interface MediaVersion {
  id: string
  version: number
  /** I11.9: the review round this version belongs to, 1-based, stamped server-side at upload. */
  round: number
  objectKey: string | null
  contentType: string | null
  sizeBytes: number | null
  storageTier: string
  retentionState: string
  externalReviewUrl: string | null
  uploadedById: string | null
  uploadedByName: string | null
  createdAt: string
}

interface FnError extends Error {
  code?: string
}

/** Invoke an Edge Function, surfacing the server's { error: { code, message } } envelope. */
async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    if (ctx) {
      const payload = await ctx.json().catch(() => null)
      throw Object.assign(new Error(payload?.error?.message ?? error.message), {
        code: payload?.error?.code as string | undefined,
      })
    }
    throw error
  }
  return data as T
}

/** Versions on a deliverable, newest first, with each uploader's display name. */
/**
 * The versions under review (ADR-0058 d.3).
 *
 * `subTaskId` narrows to one task's artefacts, which is what the container model means: the
 * deliverable holds no file of its own, so a reviewer looking at one task sees that task's work and
 * not somebody else's. Omitted, it returns everything on the deliverable — which is what the
 * Library and delivery paths still want, and what versions predating this change are.
 */
export function useDeliverableVersions(deliverableId: string | null, subTaskId?: string | null) {
  return useQuery({
    queryKey: reviewKeys.versions(deliverableId ?? 'none', subTaskId),
    enabled: !!deliverableId,
    queryFn: async (): Promise<MediaVersion[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('media_records')
        .select(
          // media_records has TWO FKs to user_profiles (uploaded_by + delivered_by, ADR-0023), so the
          // uploader embed MUST name its FK or PostgREST fails the whole query as ambiguous — which
          // both the reviewer's panel and the assignee's attach-list rendered as "No versions yet".
          'id, version, round, object_key, content_type, size_bytes, storage_tier, retention_state, ' +
            'external_review_url, uploaded_by, created_at, ' +
            'uploader:user_profiles!media_records_uploaded_by_fkey(display_name)',
        )
        .eq('deliverable_id', deliverableId!)
        // Legacy rows carry no sub_task_id and belong to the whole deliverable, so they stay
        // visible on every task rather than disappearing when this narrows.
        .or(subTaskId ? `sub_task_id.eq.${subTaskId},sub_task_id.is.null` : 'sub_task_id.not.is.null,sub_task_id.is.null')
        .order('version', { ascending: false })
      if (error) throw error
      const rows = (raw ?? []) as unknown as {
        id: string; version: number; round: number; object_key: string | null; content_type: string | null
        size_bytes: number | null; storage_tier: string; retention_state: string
        external_review_url: string | null; uploaded_by: string | null; created_at: string
        uploader: { display_name: string } | { display_name: string }[] | null
      }[]
      return rows.map((r) => ({
        id: r.id,
        version: r.version,
        round: r.round,
        objectKey: r.object_key,
        contentType: r.content_type,
        sizeBytes: r.size_bytes,
        storageTier: r.storage_tier,
        retentionState: r.retention_state,
        externalReviewUrl: r.external_review_url,
        uploadedById: r.uploaded_by,
        uploadedByName: (Array.isArray(r.uploader) ? r.uploader[0] : r.uploader)?.display_name ?? null,
        createdAt: r.created_at,
      }))
    },
  })
}

/**
 * Upload a new version: presign → PUT straight to B2 → write the media_records row (RLS
 * media:manage; the trigger stamps the next version). Fails loudly if the presigned PUT or the
 * row insert fails, so a half-uploaded object never looks like a version.
 */
/**
 * Upload a new version (ADR-0058 d.1).
 *
 * `subTaskId` is what the artefact BELONGS to. Uploading without one produces a deliverable-level
 * row — the pre-container-model shape — which the submit gate still honours for legacy work but
 * which no surface should create any more: it is the row that let six tasks pass on one file.
 */
export function useUploadVersion(deliverableId: string, subTaskId?: string | null) {
  const { session, claims } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: File): Promise<{ id: string }> => {
      const { uploadUrl, objectKey } = await invokeFn<{ uploadUrl: string; objectKey: string }>('review-media', {
        op: 'upload',
        deliverableId,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
      })
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      })
      if (!put.ok) throw new Error(`Upload failed (${put.status})`)
      const { data, error } = await supabaseUntyped
        .from('media_records')
        .insert({
          tenant_id: claims.tenantId,
          deliverable_id: deliverableId,
          sub_task_id: subTaskId ?? null,
          object_key: objectKey,
          // I35.7: the name the person uploaded, kept verbatim. It reached `review-media` as
          // `fileName` above and was then thrown away — the object key holds only a SANITISED
          // copy behind a uuid, which is what made every review download come back named after
          // the bucket. Stored here, `review-media` can name the download properly.
          file_name: file.name,
          content_type: file.type || 'application/octet-stream',
          size_bytes: file.size,
          uploaded_by: session?.user.id ?? null,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: (data as { id: string }).id }
    },
    // The prefix, not one key: the rail is narrowed to THIS task (ADR-0058 d.1) and the submit gate
    // reads the whole deliverable, and both have to see the new version. Invalidating only the
    // un-narrowed key left the rail on "No versions yet" until the modal was reopened.
    onSuccess: () => void qc.invalidateQueries({ queryKey: reviewKeys.allVersions(deliverableId) }),
  })
}

/** Mint a short-TTL signed view URL for a version (kept a little under the 15-min server TTL). */
export function useVersionViewUrl(mediaRecordId: string | null) {
  return useQuery({
    queryKey: reviewKeys.viewUrl(mediaRecordId ?? 'none'),
    enabled: !!mediaRecordId,
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    queryFn: async (): Promise<{ viewUrl: string, downloadUrl: string }> => {
      const result = await invokeFn<{ downloadUrl: string, viewUrl?: string }>('review-media', {
        op: 'view',
        mediaRecordId,
      })
      // If edge function hasn't been deployed yet, fallback to using downloadUrl for both
      return { 
        viewUrl: result.viewUrl ?? result.downloadUrl,
        downloadUrl: result.downloadUrl
      }
    },
  })
}

// ---- Anchored comments (ADR-0025 I3.2) ----

export interface ReviewComment {
  id: string
  /** ADR-0059 d.7: null on a comment about a TASK rather than a version. Exactly one of
   *  `mediaRecordId` and `subTaskId` is set — the database refuses any other shape. */
  mediaRecordId: string | null
  subTaskId: string | null
  round: number
  source: string
  body: string
  timecodeMs: number | null
  posX: number | null
  posY: number | null
  /** ADR-0057 d.6: the 1-based page a document comment is about. Null for every other anchor and
   *  for an unanchored comment, which is the ordinary case on every format. */
  page: number | null
  resolved: boolean
  authorId: string | null
  authorName: string | null
  createdAt: string
  /** ADR-0059 addendum d.14: where the work this note is about lives, when it lives somewhere the
   *  system cannot fetch (a Keynote on iCloud, a shared drive). Optional beside a task note; never
   *  a version. Null on every version-anchored comment. */
  linkUrl: string | null
  /** ADR-0112 d.2 (I59.29): the pin this row replies to; null (or absent) on a pin itself. */
  parentId?: string | null
  /** ADR-0112 d.2: when the maker marked the pin done ("fixed in the next version"), and who. */
  doneAt?: string | null
  doneById?: string | null
  doneByName?: string | null
}

/**
 * The columns every comment read selects. The author embed NAMES its foreign key: `done_by`
 * (20260926124000) is a second reference from `review_feedback` to `user_profiles`, and an unnamed
 * `user_profiles(...)` embed is then ambiguous — PostgREST fails the whole query, and the panel
 * would read "no comments" (the same trap `media_records` hit with its two uploader FKs).
 */
// Both comment reads below spell the embed out as a literal so the PostgREST checker can read them.

type Named = { display_name: string } | { display_name: string }[] | null
const nameOf = (n: Named | undefined): string | null => (Array.isArray(n) ? n[0] : n)?.display_name ?? null

interface PinColumns {
  parent_id?: string | null
  done_at?: string | null
  done_by?: string | null
  doner?: Named
}
function pinFields(r: PinColumns) {
  return {
    parentId: r.parent_id ?? null,
    doneAt: r.done_at ?? null,
    doneById: r.done_by ?? null,
    doneByName: nameOf(r.doner),
  }
}

/** Comments on a version, oldest first, with each author's display name. Tenant-wide read. */
export function useVersionComments(mediaRecordId: string | null) {
  return useQuery({
    queryKey: reviewKeys.comments(mediaRecordId ?? 'none'),
    enabled: !!mediaRecordId,
    queryFn: async (): Promise<ReviewComment[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('review_feedback')
        .select('id, media_record_id, round, source, body, timecode_ms, pos_x, pos_y, page, resolved, author_user_id, created_at, parent_id, done_at, done_by, author:user_profiles!review_feedback_author_user_id_fkey(display_name), doner:user_profiles!review_feedback_done_by_fkey(display_name)')
        .eq('media_record_id', mediaRecordId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      const rows = (raw ?? []) as unknown as ({
        id: string; media_record_id: string; round: number; source: string; body: string
        timecode_ms: number | null; pos_x: number | null; pos_y: number | null; page: number | null
        resolved: boolean
        author_user_id: string | null; created_at: string
        author: { display_name: string } | { display_name: string }[] | null
      } & PinColumns)[]
      return rows.map((r) => ({
        ...pinFields(r),
        id: r.id,
        mediaRecordId: r.media_record_id,
        subTaskId: null,
        round: r.round,
        source: r.source,
        body: r.body,
        timecodeMs: r.timecode_ms,
        posX: r.pos_x,
        posY: r.pos_y,
        page: r.page,
        resolved: r.resolved,
        authorId: r.author_user_id,
        authorName: (Array.isArray(r.author) ? r.author[0] : r.author)?.display_name ?? null,
        createdAt: r.created_at,
        linkUrl: null,
      }))
    },
  })
}

export interface AddCommentArgs {
  body: string
  timecodeMs?: number | null
  posX?: number | null
  posY?: number | null
  /** ADR-0057 d.6. 1-based; the database refuses anything below 1. */
  page?: number | null
}

/** Add a comment to a version. round + source are server-stamped (trigger); author is the caller. */
export function useAddComment(mediaRecordId: string) {
  const { session, claims } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: AddCommentArgs): Promise<{ id: string }> => {
      const { data, error } = await supabaseUntyped
        .from('review_feedback')
        .insert({
          tenant_id: claims.tenantId,
          media_record_id: mediaRecordId,
          body: args.body.trim(),
          timecode_ms: args.timecodeMs ?? null,
          pos_x: args.posX ?? null,
          pos_y: args.posY ?? null,
          page: args.page ?? null,
          author_user_id: session?.user.id ?? null,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: (data as { id: string }).id }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reviewKeys.comments(mediaRecordId) })
      // ADR-0089 d.5: an optional reviewer's Done reads "feedback left" the moment they have written
      // something, not after they reopen the modal. A version does not name its task here, so every
      // kind is re-asked; it is one cheap RPC per open modal.
      void qc.invalidateQueries({ queryKey: deliverableKeys.responseKind() })
    },
  })
}

/** Toggle a comment's resolved state (author, or reviews:moderate — enforced by RLS). */
export function useResolveComment(mediaRecordId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { id: string; resolved: boolean }) => {
      const { error } = await supabaseUntyped
        .from('review_feedback')
        .update({ resolved: args.resolved })
        .eq('id', args.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: reviewKeys.comments(mediaRecordId) }),
  })
}

// ---- Comments about a TASK rather than a version (ADR-0059 d.7) ----
//
// A manual task produces no file, so its comments hang off the task itself. Everything else about
// them is identical: the same table, the same server-stamped round and source, the same resolve
// rules, the same RLS. The two hooks are separate from the version ones only because they key and
// invalidate on a different parent — not because a task comment is a different kind of thing.

/** Comments on a task, oldest first, with each author's display name. Tenant-wide read. */
export function useTaskComments(subTaskId: string | null) {
  return useQuery({
    queryKey: reviewKeys.taskComments(subTaskId ?? 'none'),
    enabled: !!subTaskId,
    queryFn: async (): Promise<ReviewComment[]> => {
      const { data: raw, error } = await supabaseUntyped
        .from('review_feedback')
        .select('id, sub_task_id, round, source, body, link_url, resolved, author_user_id, created_at, parent_id, done_at, done_by, author:user_profiles!review_feedback_author_user_id_fkey(display_name), doner:user_profiles!review_feedback_done_by_fkey(display_name)')
        .eq('sub_task_id', subTaskId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      const rows = (raw ?? []) as unknown as ({
        id: string; sub_task_id: string; round: number; source: string; body: string
        link_url: string | null
        resolved: boolean; author_user_id: string | null; created_at: string
        author: { display_name: string } | { display_name: string }[] | null
      } & PinColumns)[]
      return rows.map((r) => ({
        ...pinFields(r),
        id: r.id,
        mediaRecordId: null,
        subTaskId: r.sub_task_id,
        round: r.round,
        source: r.source,
        body: r.body,
        // Positional anchors are meaningless without something to anchor TO. A comment about an
        // installation has no timecode, no pin and no page, and saying so explicitly is better than
        // selecting four columns that are structurally null.
        timecodeMs: null,
        posX: null,
        posY: null,
        page: null,
        resolved: r.resolved,
        authorId: r.author_user_id,
        authorName: (Array.isArray(r.author) ? r.author[0] : r.author)?.display_name ?? null,
        createdAt: r.created_at,
        linkUrl: r.link_url,
      }))
    },
  })
}

/**
 * Add a comment to a task. `round` and `source` are server-stamped; the author is the caller.
 *
 * This is both halves of the manual path: the assignee's account of what they did (which is what
 * `app.sub_task_submit` requires instead of a file) and the reviewer's reason for sending it back.
 * The database tells them apart by author, so nothing here has to.
 */
export function useAddTaskComment(subTaskId: string) {
  const { session, claims } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { body: string; linkUrl?: string | null }): Promise<{ id: string }> => {
      // An empty link is NO link — null, never '' — so the database's http(s) CHECK is the only
      // rule and a blank field does not trip it (ADR-0059 addendum d.14).
      const link = args.linkUrl?.trim() || null
      const { data, error } = await supabaseUntyped
        .from('review_feedback')
        .insert({
          tenant_id: claims.tenantId,
          sub_task_id: subTaskId,
          body: args.body.trim(),
          link_url: link,
          author_user_id: session?.user.id ?? null,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: (data as { id: string }).id }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reviewKeys.taskComments(subTaskId) })
      void qc.invalidateQueries({ queryKey: deliverableKeys.responseKind(subTaskId) }) // ADR-0089 d.5, as above
    },
  })
}

/** Toggle a task comment's resolved state (author, or reviews:moderate — enforced by RLS). */
export function useResolveTaskComment(subTaskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { id: string; resolved: boolean }) => {
      const { error } = await supabaseUntyped
        .from('review_feedback')
        .update({ resolved: args.resolved })
        .eq('id', args.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: reviewKeys.taskComments(subTaskId) }),
  })
}

// ---- The maker answers each pin (ADR-0112 d.2, I59.29) ----
//
// Mark done / undo / reply belong to the task's ASSIGNEE; re-open to the reviewer (the pin's author
// or reviews:moderate). The database decides both — RLS and `app.tg_review_feedback_done_guard` — so
// these hooks only write, and a refusal surfaces as a worded line where the control is.

/** Which list a pin lives in: a version's comments, or a task's (manual review). */
export type PinScope = { mediaRecordId: string } | { subTaskId: string }

function pinListKey(scope: PinScope) {
  return 'mediaRecordId' in scope ? reviewKeys.comments(scope.mediaRecordId) : reviewKeys.taskComments(scope.subTaskId)
}

/** Zero rows back from an UPDATE is RLS hiding the row — the refusal, said as one (traps.md). */
function refusedIfEmpty(data: unknown, what: string) {
  if (!data || (data as unknown[]).length === 0) {
    throw Object.assign(new Error(what), { code: '42501' })
  }
}

/**
 * Set or clear a pin's "done". `done: true` is the maker's Mark done (the guard stamps who and when);
 * `done: false` is the reviewer's Re-open — or the maker's Undo of their own done.
 */
export function useSetPinDone(scope: PinScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { id: string; done: boolean }) => {
      const { data, error } = await supabaseUntyped
        .from('review_feedback')
        .update({ done_at: args.done ? new Date().toISOString() : null })
        .eq('id', args.id)
        .select('id')
      if (error) throw error
      refusedIfEmpty(data, 'you cannot change this pin')
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: pinListKey(scope) }),
  })
}

/** The maker's reply to a pin. The trigger gives it the pin's task, file and round. */
export function useReplyToPin(scope: PinScope) {
  const { session, claims } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { pinId: string; body: string }): Promise<{ id: string }> => {
      const { data, error } = await supabaseUntyped
        .from('review_feedback')
        .insert({
          tenant_id: claims.tenantId,
          parent_id: args.pinId,
          // The pin's own parent, so the row has its shape before the thread trigger copies it.
          media_record_id: 'mediaRecordId' in scope ? scope.mediaRecordId : null,
          sub_task_id: 'mediaRecordId' in scope ? null : scope.subTaskId,
          body: args.body.trim(),
          author_user_id: session?.user.id ?? null,
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: (data as { id: string }).id }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: pinListKey(scope) }),
  })
}

export type { FnError }
