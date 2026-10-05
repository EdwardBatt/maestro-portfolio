// A last-resort guard around an Edge Function handler.
//
// Why it exists: an uncaught throw never reaches the handler's own error path, so the platform
// returns a bare 500 with no CORS headers. The browser then reports "No 'Access-Control-Allow-Origin'
// header is present" — which is not the fault, and sends you looking in the wrong place entirely.
// That is exactly what a `ReferenceError` in booking-transition looked like from the client: a CORS
// problem that was nothing of the sort.
//
// With this, an unexpected failure comes back as a normal { error: { code, message } } envelope
// carrying the CORS headers, so the client shows a real error and the console names the real cause.
//
// The message is deliberately generic — the detail goes to the function log, not to the browser.
// An exception string can carry table names, SQL fragments or ids, and the client cannot act on any
// of it. Read the specifics with: supabase functions logs <name>

/** Wrap a handler so nothing escapes without CORS headers and a usable envelope. */
export function guarded(
  corsHeaders: Record<string, string>,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await handler(req)
    } catch (e) {
      // Surfaces in `supabase functions logs`. Keep the stack: it is the whole point.
      console.error('unhandled error in edge function', e)
      return new Response(
        JSON.stringify({
          error: {
            code: 'internal_error',
            message: 'The server hit an unexpected error. It has been logged.',
          },
        }),
        { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders } },
      )
    }
  }
}
