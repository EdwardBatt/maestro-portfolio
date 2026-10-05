// What the browser should call a downloaded file (ADR-0022).
//
// WHY THIS FILE EXISTS. The bytes are stored under a key that is deliberately NOT the
// user's filename: `<tenant>/<client>/<folder>/<uuid>-<sanitised name>`, because a key has
// to be unique and safe and a filename is neither. Nothing tells the browser that, so a
// presigned GET makes it fall back to the last path segment — the user uploads
// `Harmony Brief v2.pdf` and gets back `a3f9c1e2-…-Harmony_Brief_v2.pdf`. The name is not
// lost anywhere; it is simply never sent.
//
// `Content-Disposition` is how it gets sent, and on a presigned S3 URL it travels as the
// `response-content-disposition` query parameter, which must be set BEFORE signing or the
// signature will not cover it and B2 rejects the request.
//
// Two callers, `asset-url` and `review-media`, so it lives here rather than in either
// (AGENTS.md §3). They differ in one respect that matters — see `nameFromObjectKey`.

/**
 * An RFC 6266 `attachment` disposition carrying `name`.
 *
 * Both forms are emitted, deliberately. `filename*` is the UTF-8 one and is what every
 * current browser reads; the plain `filename` is a pure-ASCII fallback for anything that
 * does not, and without it an Arabic filename degrades to the uuid key we are trying to
 * get away from. Quotes, backslashes and newlines are replaced rather than escaped: they
 * are header-injection vectors, and no legitimate filename needs them.
 */
export function contentDisposition(name: string, kind: 'attachment' | 'inline' = 'attachment'): string {
  const clean = (name || '').replace(/[\r\n"\\]/g, '_').trim() || 'file'
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_')
  // RFC 5987 attr-char excludes ' ( ) *, which encodeURIComponent leaves alone.
  const utf8 = encodeURIComponent(clean).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  // `inline` is the Library's Preview (ADR-0134 d.6): the browser shows what it can and still knows the name.
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`
}

const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i

/**
 * Best-effort original name recovered from an object key, for rows that never stored one.
 *
 * `assets.name` holds the real filename, so `asset-url` never needs this. `media_records`
 * has NO name column at all — the filename reaches the upload signer and is then dropped —
 * so for review media the key is the only surviving record of it, and stripping the uuid
 * yields the SANITISED name (`Harmony_Brief_v2.pdf`, underscores where the spaces were).
 * That is a recovery, not the original, and it is the best available until the column
 * exists. Do not reach for this where a stored name is available.
 */
export function nameFromObjectKey(objectKey: string): string {
  const last = decodeURIComponent(objectKey.split('/').pop() ?? '')
  return last.replace(UUID_PREFIX, '') || 'file'
}

/**
 * `Brief.pdf` at version 3 becomes `Brief v3.pdf` (I35.7, Edward 3 Sep).
 *
 * A reviewer who downloads round 1 and then round 3 otherwise gets two files with the identical
 * name, and the browser quietly calls the second one `Brief (1).pdf` — on the one surface whose
 * whole job is telling rounds apart. The version goes before the extension rather than after the
 * name, so the file still opens in the right application.
 *
 * Only for review media. Library assets are not versioned in the same sense (an `assets` row is
 * one document that may be replaced) and their downloads keep the name exactly as uploaded.
 */
export function versionedName(name: string, version: number): string {
  const clean = name.trim() || 'file'
  const dot = clean.lastIndexOf('.')
  // A leading dot is the whole name (`.gitignore`), not an extension.
  if (dot <= 0) return `${clean} v${version}`
  return `${clean.slice(0, dot)} v${version}${clean.slice(dot)}`
}
