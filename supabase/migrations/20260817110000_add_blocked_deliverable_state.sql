-- ADR-0024 (Phase I): add a deliverable-level `blocked` state.
--
-- Enum extension is its own migration (AGENTS §4 naming rule) — and Postgres will not let a
-- newly-added enum value be *used* in the same transaction it is added, so the lifecycle
-- engine that references 'blocked' lives in the next migration (20260817110100).
--
-- `blocked` = work stalled internally (reachable from / back to in_progress). The attributed,
-- clock-pausing `blocked_on_client` is a separate Phase-2 / portal concept (not this).

alter type deliverable_state add value if not exists 'blocked';
