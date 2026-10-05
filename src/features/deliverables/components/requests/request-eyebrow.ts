import { createContext } from 'react'

/**
 * The eyebrow over a request dialog's title (Figma NY-* frames): the Needs-you card's own kind
 * label, coloured by how soon it bites — the card's group, so the colour is state, never decoration.
 * The Needs-you host provides it for the one dialog it opens; a dialog opened elsewhere (the task
 * page) has none.
 */
export interface RequestEyebrow {
  text: string
  tone: 'today' | 'week' | 'quiet'
}

export const RequestEyebrowContext = createContext<RequestEyebrow | null>(null)
