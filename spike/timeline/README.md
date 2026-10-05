# Timeline library spike (task 0.1.6 → ADR-0004)

Standalone Vite pages comparing dnd-timeline vs vis-timeline on Maestro's acceptance
criteria: 150 resources, ~300 bookings with a forced 3-way overlap, blackout ranges,
drag create/move/resize, EN/AR + RTL. `eval.mjs` runs the headless Playwright
measurement (screenshots in `shots/`). Not part of the app build — reference code
for M5. To run: drop these files into a fresh `npm create vite@latest -- --template
react-ts` app, `npm i dnd-timeline vis-timeline vis-data`, `npm i -D playwright`.
Results and the decision: see `docs/adr/0004-resource-timeline-dnd-timeline.md`.
