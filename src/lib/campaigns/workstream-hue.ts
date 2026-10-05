/**
 * A workstream's colour (ADR-0099), the one rule every screen draws it with.
 *
 * The data has no colour column, and a colour must not move when a list is re-ordered or
 * filtered, so it is derived from the workstream's id: the same workstream keeps the same hue
 * between renders and between screens — the campaign wizard's "Who gets what" table and the team
 * timeline (ADR-0105 d.4) read it from here. `1`–`12` maps to the categorical `--hue-*` tokens
 * (index.css), which separate kinds and never report state.
 */
export const HUE_COUNT = 12

export function workstreamHue(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return (h % HUE_COUNT) + 1
}
