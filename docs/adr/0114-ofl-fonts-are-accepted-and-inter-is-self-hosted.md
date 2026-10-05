# ADR-0114: OFL fonts are accepted, and Inter is self-hosted

- **Status:** accepted (Edward, 26 Sep: *"write the ADR for option A and add the font"*)
- **Date:** 2026-09-26
- **Open Decision:** — (extends the ADR-0002 §1 allowlist, in the shape ADR-0003 and ADR-0047 set)
- **Task(s):** `I54.29`; closes the font half of `M2.4` (*"system font stack pending a font-pairing ADR
  (OFL fonts need an allowlist decision)"*); relates to `L1.3a`

## Context

The Figma frames set **Inter** everywhere: the body, the headings, the buttons, and the sidebar
wordmark. `src/index.css` has named Inter since 5 Sep (`L1.3a`), but **nothing ever loaded it**. Its own
header comment says so: *"named here with a system fallback (self-hosted web-font loading is tracked at
M2.4)"*. On 26 Sep the running app was checked in Chromium on Windows. Every element was drawn in
**Segoe UI**, the system fallback: the page title, the intro, the navigation and the wordmark. Anyone
without Inter installed on their own machine has never seen the design's typeface.

Edward, 26 Sep: *"Font should be inter."* When asked, he also confirmed Inter costs nothing: it is free,
commercial use included.

**What stood in the way was the licence gate, not the money.** Inter is published under the **SIL Open
Font License 1.1 (OFL-1.1)**. `scripts/check-licenses.mjs` accepts a fixed set of SPDX ids, and OFL-1.1
is not one of them. `M2.4` recorded that as an open allowlist decision.

**What OFL-1.1 permits and forbids:**

- It permits use, embedding and bundling in any software, commercial included, and redistribution
  together with that software. It charges nothing and requires no attribution in the product.
- It forbids selling the font files **on their own**.
- It forbids releasing a **modified** font under the original name (the Reserved Font Name clause).
- Its copyleft reaches only the fonts themselves. A derivative font must stay OFL, but the licence
  never extends to the software, documents or pages that *use* the font. That is the difference from
  the copyleft ADR-0002 excludes.

Maestro ships the font files unmodified, inside the app, and never sells them separately. Neither
restriction is touched.

**Options weighed (put to Edward in plain words, 26 Sep):**

- **A. Carry Inter inside the app.** Add OFL-1.1 to the allowlist and bundle the font from npm
  (`@fontsource-variable/inter`, 5.3.0, OFL-1.1, no dependencies of its own).
  - Everyone sees Inter.
  - Nothing loads from a third party.
  - Cost: about 100–350 KB of font files in the build. The browser fetches only the character
    ranges a page uses, and caches them.
- **B. Load it from Google Fonts.**
  - Nothing new is bundled.
  - But every page load calls Google's servers, which tells Google who uses the app, from where
    and when.
  - The app would stop rendering its typeface whenever that service is blocked or down.
  - The licence question is the same either way: the font is still OFL.
- **C. Leave the system fallback.** This costs nothing and contradicts every frame.

**Edward chose A.**

## Decision

1. **`OFL-1.1` is added to the licence allowlist, for font packages only.** The entry is allowed in
   `scripts/check-licenses.mjs`, and its comment names this ADR. A non-font package declaring OFL
   still needs its own review. The script cannot tell a font from code, so this rule is kept by the
   same review that adds any dependency.
2. **Inter is self-hosted from `@fontsource-variable/inter`**, imported once at the app's entry. It is
   the variable build: one family covering every weight the frames use (400, 500, 600, 700). It is
   named first in both `--font-sans` and `--font-display`, as `'Inter Variable'`, followed by `'Inter'`.
3. **The display family is Inter too.** Sora was named in `--font-display` since `L1.3a`, but the
   frames set no Sora, and it was never loaded either. It is removed from the stack.
4. **Nothing loads from a third-party font service.** A future typeface arrives the same way: an npm
   package, bundled.
5. Arabic is unchanged. `IBM Plex Sans Arabic` stays named after Inter, and is still not loaded. That
   is the next font decision, not part of this one.

## Consequences

- **Easier:** every user sees the typeface the frames were drawn in. Screenshots, guides and review
  reports stop depending on which fonts the capturing machine has. Measurements taken against the
  frames (line lengths, wrap points, button widths) now hold.
- **Harder:** the build carries font files. First paint may briefly show the fallback until Inter
  arrives. Fontsource sets `font-display: swap`, so text is never invisible, only re-flowed once.
- **Locked in:** OFL-1.1 is permitted for fonts. Removing it later means removing every font that
  arrived under it.
- **Not yet done:** Arabic still draws in the system's Arabic face. Loading `IBM Plex Sans Arabic`
  (also OFL) is covered by this ADR's d.1, but Edward has not asked for it; it is noted on `M2.4`.
