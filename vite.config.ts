import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The BUILD stamp — what tells a tab that has been open all week that it is out of date.
 *
 * Edward, 6 Sep: *"users are not logging out of the site in some cases and as we are continuously
 * updating the site, they are not always using the latest version."* Maestro is one bundle with no
 * code splitting, so an open tab never fetches anything again and never discovers a new release
 * exists. Nothing expires and nothing breaks — it simply keeps running last week's code against a
 * database that has moved.
 *
 * Two halves, both from here so they cannot disagree: `__BUILD_ID__` is compiled INTO the bundle,
 * and `version.json` is written NEXT TO it. The running tab compares the one it was built with
 * against the one the server is serving now (`src/app/useAppVersion.ts`).
 *
 * The id is the commit where CI provides one — Vercel and GitHub Actions both do — because that
 * makes "which build is she on?" answerable from the value itself. The timestamp fallback is for a
 * local `npm run build`, where the question is only ever "is this the same one?".
 */
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  `local-${Date.now().toString(36)}`

export default defineConfig(({ command }) => {
  // `serve` is the dev server, where the module graph is live and a stale-build prompt would be
  // noise on every hot reload. The check no-ops on this value (see useAppVersion).
  //
  // `E2E_BUILD_ID` is the one exception: the local browser suite has to press the update bar
  // (I49.84), and under `dev` it can never appear. `playwright.local.config.ts` starts the dev
  // server with that variable set; nobody else does, and a build ignores it.
  const id = command === 'serve' ? (process.env.E2E_BUILD_ID || 'dev') : buildId
  const manifest = JSON.stringify({ buildId: id })

  return {
    plugins: [
      react(),
      {
        name: 'maestro-version-manifest',
        // Emitted as an ASSET rather than written to `public/`, so it lands in `dist/` on every
        // build without a pre-build script anyone can forget to run. Unhashed on purpose: this is
        // the one file the running app asks for by name.
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'version.json', source: manifest })
        },
        // The dev server answers the same question with the same id, so the running tab and a
        // test can read what it was started with. Under `dev` nothing asks (useAppVersion).
        configureServer(server) {
          server.middlewares.use('/version.json', (_req, res) => {
            res.setHeader('content-type', 'application/json')
            res.setHeader('cache-control', 'no-store')
            res.end(manifest)
          })
        },
      },
    ],
    define: {
      __BUILD_ID__: JSON.stringify(id),
    },
  }
})
