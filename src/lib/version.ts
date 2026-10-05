/**
 * Single source for the app version shown in the shell badge and attached to
 * feedback submissions. Keep in sync with package.json `version`.
 */
export const APP_VERSION = '0.7.0'

declare const __BUILD_ID__: string | undefined

/**
 * Which BUILD this tab is running — compiled in by `vite.config.ts`, and a different thing from
 * `APP_VERSION` above. That one is the release people say out loud and changes when Edward decides;
 * this one changes on every deploy and exists only to answer "is the tab I am looking at the
 * current one?".
 *
 * `'dev'` under the dev server, and under vitest, where `__BUILD_ID__` is not defined at all.
 */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'

/**
 * Should the reader be told to reload?
 *
 * Kept as a pure function because every wrong answer here is user-visible in a way that is hard to
 * catch by hand: nagging somebody who is already current, or staying silent through a deploy.
 *
 * **Only ever true on a definite mismatch.** A missing, empty or unreadable server value means the
 * check failed — offline, a proxy serving something odd, a deploy mid-flight — and a failed check
 * is not evidence of a new version. It says nothing and asks again later.
 *
 * **`dev` never prompts.** The dev server rebuilds constantly and hot-reloads anyway; a bar
 * appearing on every save would train everyone to ignore the one that matters in production.
 */
export function shouldPromptReload(current: string, fromServer: unknown): boolean {
  if (current === 'dev') return false
  if (typeof fromServer !== 'string') return false
  const server = fromServer.trim()
  if (!server || server === 'dev') return false
  return server !== current
}
