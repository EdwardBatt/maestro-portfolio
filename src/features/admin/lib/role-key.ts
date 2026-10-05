/** Stable slug from a display name: "Producer +Reports" → "producer_reports".
 * Pure module (no client imports) so it unit-tests without the env chain. */
export function keyFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
}
