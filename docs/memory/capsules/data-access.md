---
type: capsule
abstract: How the frontend talks to Postgres, and the two things about it that regularly waste an hour.
status: current
origin: ai-derived
verified: 2026-09-20
sources: [src/lib/supabase.ts, src/lib/env.ts, src/features/*/api/, AGENTS.md]
---

# Capsule — Data access

## One client, one key

`src/lib/supabase.ts` exports the **single** Supabase client for the whole frontend. Import it. Never
construct another, never touch a service-role or storage key — those live only in Edge Function
secrets. The browser client carries the publishable key plus the signed-in user's JWT; access control
is RLS, server-side. `src/lib/env.ts` Zod-validates every `VITE_`-prefixed variable at boot.

`supabaseUntyped` is the **same client, untyped**. It exists only because `src/types/database.ts` is
generated and lags one migration behind until `supabase gen types` re-runs. Use it for tables and
columns newer than the types, declare the row shape at the call site, and migrate back to the typed
client once the types catch up. **28 files currently use it** — that is debt, not a pattern.

## Queries live in the feature

Each feature owns `api/` — TanStack Query hooks wrapping Supabase calls. A feature never imports
another feature's `api/`; shared code moves to `src/lib/` or `src/components/`. (21 edges currently
break this — see [STATE.md](../STATE.md).)

Query keys are namespaced per feature (`reviewKeys`, `permissionKeys`, `scheduleKeys`). Global
defaults are set once in `src/main.tsx`: `retry: 1`, `staleTime: 30_000`,
`refetchOnWindowFocus: false`. That default means a list is re-read only on navigation or when a
mutation on the SAME page invalidates it — a list that other people change while it is open (the
campaign page's deliverables, the task lists, My Work) opts in with `refetchOnWindowFocus: true` +
`refetchInterval: 20_000` on its hook (since 17 Sep; the "not updating" report in
[traps.md](../traps.md)).

## The two traps

**Ambiguous embeds return empty, not an error.** `sub_tasks` → `user_profiles` has six foreign keys.
PostgREST will not guess, and the row comes back with the embed missing rather than a 400 — so it
reads as "no data". Always name the constraint:

```ts
'assignee:user_profiles!sub_tasks_assignee_id_fkey(display_name)'
```

The same trap has a second shape on **composite** foreign keys, which `sub_task_resources` and
`sub_task_reviewers` both use as their tenant fence: name the constraint
(`user_profiles!fk_sub_task_reviewers_user(display_name)`), and prefer a flat second query to a
nested embed — a nested one PostgREST cannot resolve also comes back empty.

**`rpc()` is a POST.** So is every Edge Function call. Anything reasoning about HTTP verbs — a proxy,
a guard, an interceptor — must classify by what is being called, not by the method. This shipped a
bug; see [traps.md](../traps.md).

## Calling an Edge Function

`supabase.functions.invoke(name, { body })`. The body is serialised to JSON before it reaches fetch.
Errors arrive as `{ error }` with the real payload on `error.context` — see the `invokeFn` helper in
`src/features/deliverables/api/review-api.ts` for the unwrapping pattern.

## Constraints

- The frontend never derives a number that matters (money, deadlines, capacity, access). It may
  display one computed server-side (`AGENTS.md` §2).
- Never hand-edit `src/types/database.ts`.
- Never decide authorization by querying a grant table — see [authorization](authorization.md).

## Where to look

`src/lib/supabase.ts` · `src/lib/env.ts` · `src/features/*/api/` · `src/types/database.ts`
(generated) · `src/main.tsx` for the query defaults.

## Related

[authorization](authorization.md) · [database-change](database-change.md) for regenerating types.
