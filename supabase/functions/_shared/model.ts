// The model call, in one place (ADR-0049).
//
// WHY THIS FILE EXISTS. ADR-0044 d.3 put the provider behind a single function, and when
// ADR-0049 swapped Anthropic for OpenAI that promise paid for itself: one file changed.
// `generate-deliverables` (ADR-0048 d.4) is the second caller, and duplicating the request
// shape into it would have quietly destroyed that property — the next switch would touch
// two files, then three. So the request lives here and the callers pass a schema and a
// prompt.
//
// SECRET. The key is passed in, never read here. It is an Edge Function secret set by
// Edward and it must never be `VITE_`-prefixed — that is the only route into the client
// bundle (AGENTS.md §1).
//
// The model gets NO TOOLS and no data access, in either caller. That is the whole
// prompt-injection answer (ADR-0044 d.4): a hostile document can put strange text in a
// field a person is about to read, and can do nothing else.

const OPENAI_URL = 'https://api.openai.com/v1/responses'

/** What the caller needs to make one structured-output call. */
export interface ModelCall {
  apiKey: string
  model: string
  systemPrompt: string
  /** The untrusted text. Callers wrap it in their own tag so the model can see the boundary. */
  userText: string
  /**
   * An untrusted IMAGE, as a `data:` URL, sent beside the text (ADR-0066 d.11).
   *
   * Additive on purpose. ADR-0049's whole value is that a provider switch touches ONE file, and
   * that survives only while every caller comes through here — so reading a screenshot extends
   * this interface rather than giving `read-brief-receipt` a request shape of its own. Callers
   * that send no image produce a byte-identical request to before.
   *
   * As untrusted as the text and treated the same way: the model still gets NO TOOLS (ADR-0044
   * d.4), so a hostile screenshot can put strange text in fields a person is about to read, and
   * can do nothing else.
   */
  userImage?: string
  /** A closed JSON Schema. `strict` requires every property required + additionalProperties:false. */
  schema: unknown
  /** Names the schema for the API. Lowercase, no spaces. */
  schemaName: string
  maxOutputTokens: number
  fetchImpl: typeof fetch
  timeoutMs: number
}

/**
 * A model-path failure, with enough detail to log it distinguishably and answer honestly.
 *
 * `model_truncated` is deliberately NOT `model_unavailable`: it means the input needed more
 * room than the budget allowed, which is a number to raise. Reporting it as an outage sends
 * whoever reads the log looking in entirely the wrong place.
 */
export class ModelCallError extends Error {
  readonly code: 'model_truncated' | 'model_declined' | 'model_unavailable'
  constructor(code: ModelCallError['code'], message: string) {
    super(message)
    this.name = 'ModelCallError'
    this.code = code
  }
}

/**
 * Pull the JSON object out of a Responses API answer.
 *
 * Truncation is `status: "incomplete"` with `incomplete_details.reason`; a refusal is a
 * `refusal` block inside `output[].content[]`. Both are 200s, so neither raises on its own.
 */
export function readModelJson(payload: unknown): unknown {
  const body = payload as
    | { status?: unknown; incomplete_details?: { reason?: unknown }; output?: unknown }
    | null
  if (!body) throw new ModelCallError('model_unavailable', 'model response was empty')

  if (body.status === 'incomplete' && body.incomplete_details?.reason === 'max_output_tokens')
    throw new ModelCallError(
      'model_truncated',
      'model hit max_output_tokens; the answer is incomplete JSON',
    )

  if (!Array.isArray(body.output))
    throw new ModelCallError('model_unavailable', 'model response has no output')

  // One pass over output[].content[]: a refusal anywhere ends it, otherwise take the first
  // output_text. Both live at the same depth.
  let text: string | null = null
  for (const item of body.output) {
    const content = (item as { content?: unknown })?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      const b = block as { type?: unknown; text?: unknown }
      if (b?.type === 'refusal')
        throw new ModelCallError('model_declined', 'model declined the request')
      if (text === null && b?.type === 'output_text' && typeof b.text === 'string') text = b.text
    }
  }
  if (text === null) throw new ModelCallError('model_unavailable', 'model response has no text')
  try {
    return JSON.parse(text)
  } catch {
    throw new ModelCallError('model_unavailable', 'model response was not valid JSON')
  }
}

/** Make the call and return the parsed JSON. Validation is the caller's job, not this file's. */
export async function callModelJson(call: ModelCall): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), call.timeoutMs)
  try {
    const response = await call.fetchImpl(OPENAI_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${call.apiKey}`,
      },
      body: JSON.stringify({
        model: call.model,
        max_output_tokens: call.maxOutputTokens,
        // No `tools` key, deliberately (ADR-0044 d.4).
        input: [
          { role: 'system', content: call.systemPrompt },
          {
            role: 'user',
            // Content parts only when there IS an image. A plain string is what every existing
            // caller has always sent, and keeping that path byte-identical is what makes this
            // extension additive rather than a rewrite of four working functions.
            content: call.userImage
              ? [
                  { type: 'input_text', text: call.userText },
                  { type: 'input_image', image_url: call.userImage },
                ]
              : call.userText,
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: call.schemaName,
            strict: true,
            schema: call.schema,
          },
        },
      }),
    })
    if (!response.ok) {
      // Carry OpenAI's OWN reason, not just the status. A 400 here is almost always the schema
      // being refused — an enum too large, a shape `strict` will not take — and on screen that is
      // indistinguishable from a network outage, because both surface as 502 → "could not be
      // reached". Without this line the difference costs a second round trip to find.
      //
      // Server-side only, and bounded: this is an Edge Function log, the brief text is never
      // logged, and OpenAI's error body describes the REQUEST SHAPE rather than its content.
      let detail = ''
      try {
        const body = (await response.json()) as { error?: { message?: unknown; code?: unknown } }
        const message = typeof body?.error?.message === 'string' ? body.error.message : ''
        const code = typeof body?.error?.code === 'string' ? ` [${body.error.code}]` : ''
        if (message) detail = `: ${message.slice(0, 400)}${code}`
      } catch {
        // A non-JSON error body tells us nothing extra; the status still travels.
      }
      throw new ModelCallError('model_unavailable', `openai responded ${response.status}${detail}`)
    }
    return readModelJson(await response.json())
  } finally {
    clearTimeout(timer)
  }
}
