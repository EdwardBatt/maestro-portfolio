// ============================================================================================================
//  THE OFFICE SERVER ADAPTER — the one place the office archive service plugs in (ADR-0136 d.6–d.7).
// ============================================================================================================
//
// The office server's software, its sign-in and its folder layout are not known yet: Edward has access to the
// server and remembers "a service with login" whose name he could not recall (ADR-0136 Context). S3-compatible,
// WebDAV and SFTP each need a different client, so nothing is guessed here. Until an adapter is written and
// `createOfficeTransport` returns it, `library-archive` reports `{ disabled: true }` and removes nothing.
//
// Whatever the adapter is, d.6 binds it:
//   * encrypted in transit (https / sftp — never plain http or ftp);
//   * signed in with a credential held only as a Supabase secret (OFFICE_ARCHIVE_USER / OFFICE_ARCHIVE_SECRET);
//   * reached only from this job — nothing in the browser ever talks to the office server;
//   * `stat` reads the size and SHA-256 BACK FROM THE SERVER (d.3): the online copy is removed only when both
//     match what was sent. An adapter that cannot read a checksum back must compute it server-side or not ship.

export interface OfficeObject {
  size: number
  /** Lower-case hex SHA-256 of the stored bytes, as the office server reports it. */
  sha256: string
}

export interface OfficeTransport {
  /** Store `body` (exactly `size` bytes) at `ref`, creating folders as needed. Throws on failure. */
  put(ref: string, body: ReadableStream<Uint8Array>, size: number): Promise<void>
  /** What the server holds at `ref`, read back from the server — or null when nothing is there. */
  stat(ref: string): Promise<OfficeObject | null>
  /** The bytes at `ref`, for Bring back — or null when nothing is there. */
  get(ref: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>
}

export interface OfficeConfig {
  url: string | undefined
  user: string | undefined
  secret: string | undefined
  /** Which adapter: e.g. `webdav`, `s3`, `sftp`. Chosen when the service is known. */
  kind: string | undefined
}

/** Both the address and the credential exist (d.7). Without them the job is switched off. */
export function officeConfigured(c: OfficeConfig): boolean {
  return Boolean(c.url && c.user && c.secret)
}

/**
 * The adapter for the configured service — none exists yet, so this returns null for every `kind` and the
 * job stays switched off even with the secrets set. Add the adapter here, nowhere else.
 */
export function createOfficeTransport(c: OfficeConfig): OfficeTransport | null {
  if (!officeConfigured(c)) return null
  switch (c.kind) {
    default:
      return null
  }
}

/** Where a Maestro object is kept on the office server: under the tenant, mirroring its storage key. */
export function officeRef(tenantId: string, objectKey: string): string {
  return objectKey.startsWith(`${tenantId}/`) ? `maestro/${objectKey}` : `maestro/${tenantId}/${objectKey}`
}
