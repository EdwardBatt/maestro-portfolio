# Maestro project skills

Skill folders follow the Claude skill spec: each skill is a directory whose entry point is a
file literally named `SKILL.md` (the loader discovers skills by that filename; identity comes
from the directory name and the YAML `name:` frontmatter). Do not rename `SKILL.md`.

## Maestro-authored skills (proprietary, part of this codebase)

| Skill | Use for |
|---|---|
| `maestro-migration` | Any `supabase/migrations` SQL — tenancy, RLS-in-same-migration, naming, pgTAP pairing |
| `maestro-rls-testing` | Adversarial pgTAP suites — joint-project & portal matrices, append-only checks |
| `maestro-edge-function` | Edge Function scaffold — auth, Zod, error envelope, idempotency |
| `maestro-feature` | Frontend feature modules — Surface-vs-Engine, role-leakage checklist, i18n/RTL |
| `maestro-adr` | Authoring ADRs and syncing the OD Gate table / tracker |
| `maestro-e2e` | Browser testing: committed Playwright suites (role walkthroughs, portal probes, RTL smoke) + exploratory toolkit. *Adapted from anthropics/skills `webapp-testing` (Apache-2.0); upstream scripts, examples and license retained in the folder.* |
| `maestro-design` | Maestro's visual/interaction design language: role-scoped surfaces, exception-first calm, status-color semantics, EN/AR typography and RTL, interface copy. *Adapted from anthropics/skills `frontend-design` (Apache-2.0); upstream license retained in the folder.* |

## Vendored as-is from anthropics/skills (Apache-2.0)

| Skill | Purpose |
|---|---|
| `skill-creator` | Creating, improving, and evaluating skills — meta-tooling used to maintain the maestro-* set; deliberately kept generic |

Adapted skills note their upstream origin in frontmatter and retain the upstream Apache-2.0
license text (`LICENSE-upstream-*.txt`). Source: https://github.com/anthropics/skills.
Anthropic's document skills (docx/pdf/pptx/xlsx) are deliberately **not** vendored — their
license is all-rights-reserved source-available, which ADR-0002 excludes; they are available
inside Claude products regardless.
