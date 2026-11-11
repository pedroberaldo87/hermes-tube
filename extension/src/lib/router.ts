// Extension message router (contract: shared/ext-messages.ts, ext-protocol.md).
// Generic over the message map: `createRouter<ExtRequests>()` in the background (popup/content → background) and
// `createRouter<ExtTabCommands>()` in the content script (background → tab). Always answers `Envelope<res>`:
// a handler that returns `res` becomes `{ok: true, data}`; `onEnvelope` lets the handler return a ready envelope
// (e.g. a server error passes through); an exception becomes `internal`; an unknown type becomes `not_found`.
import type { Envelope } from '../../../shared/api-types'
import { errorMessage, fail, isEnvelope, ok } from './envelope'

/** Map `type → {req, res}` (interfaces such as `ExtRequests` have no index signature: homomorphic constraint). */
export type MessageMap<M = unknown> = { [K in keyof M]: { req: unknown; res: unknown } }

export type Handler<M extends MessageMap<M>, K extends keyof M> = (
  payload: M[K]['req'],
  sender: chrome.runtime.MessageSender | null
) => Promise<M[K]['res']> | M[K]['res']

export type EnvelopeHandler<M extends MessageMap<M>, K extends keyof M> = (
  payload: M[K]['req'],
  sender: chrome.runtime.MessageSender | null
) => Promise<Envelope<M[K]['res']>>

export interface Router<M extends MessageMap<M>> {
  /** the handler returns `res`; the router wraps it in `{ok: true, data}` */
  on<K extends keyof M & string>(type: K, handler: Handler<M, K>): void
  /** the handler returns the whole envelope (to pass a server error through) */
  onEnvelope<K extends keyof M & string>(type: K, handler: EnvelopeHandler<M, K>): void
  dispatch(message: unknown, sender?: chrome.runtime.MessageSender | null): Promise<Envelope<unknown>>
  /** hooks into `chrome.runtime.onMessage` (synchronous: call at the top of the service worker); returns the unhook */
  listen(): () => void
  types(): string[]
}

type Entry = { wrap: boolean; fn: (payload: unknown, sender: chrome.runtime.MessageSender | null) => unknown }

export function createRouter<M extends MessageMap<M>>(): Router<M> {
  const handlers = new Map<string, Entry>()

  function add(type: string, entry: Entry): void {
    if (handlers.has(type)) throw new Error(`router: duplicate handler for "${type}"`)
    handlers.set(type, entry)
  }

  async function dispatch(message: unknown, sender: chrome.runtime.MessageSender | null = null): Promise<Envelope<unknown>> {
    if (!message || typeof message !== 'object' || typeof (message as { type?: unknown }).type !== 'string') {
      return fail('invalid', 'message without type')
    }
    const { type, payload } = message as { type: string; payload?: unknown }
    const entry = handlers.get(type)
    if (!entry) return fail('not_found', `unknown message type: ${type}`)
    try {
      const out = await entry.fn(payload ?? {}, sender)
      if (!entry.wrap) return isEnvelope(out) ? out : fail('internal', `handler for ${type} returned no envelope`)
      return ok(out)
    } catch (e) {
      return fail('internal', errorMessage(e))
    }
  }

  return {
    on(type, handler) {
      add(type, { wrap: true, fn: handler as Entry['fn'] })
    },
    onEnvelope(type, handler) {
      add(type, { wrap: false, fn: handler as Entry['fn'] })
    },
    dispatch,
    listen() {
      const listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => {
        // only messages from the extension itself (popup, content scripts, background)
        if (sender?.id && sender.id !== chrome.runtime.id) return false
        const type = (message as { type?: unknown } | null)?.type
        if (typeof type !== 'string' || !handlers.has(type)) return false // let another listener answer
        dispatch(message, sender).then(sendResponse, (e) => sendResponse(fail('internal', errorMessage(e))))
        return true // asynchronous response
      }
      chrome.runtime.onMessage.addListener(listener)
      return () => chrome.runtime.onMessage.removeListener(listener)
    },
    types() {
      return [...handlers.keys()]
    }
  }
}
