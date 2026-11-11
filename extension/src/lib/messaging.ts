// Typed message sending. Never throws: a transport failure becomes an `internal` envelope.
//
//   popup/content → background:  const res = await sendRequest('state.get', {})
//   background → tab:            const res = await sendTabCommand(tabId, 'search.extract', { job_id })
import type { Envelope } from '../../../shared/api-types'
import type { ExtReply, ExtRequestType, ExtRequests, ExtTabCommandType, ExtTabCommands, ExtTabReply } from '../../../shared/ext-messages'
import { errorMessage, fail, isEnvelope } from './envelope'

function normalize<T>(res: unknown, what: string): Envelope<T> {
  if (isEnvelope(res)) return res as Envelope<T>
  return fail('internal', `no answer from ${what}`)
}

export async function sendRequest<K extends ExtRequestType>(type: K, payload: ExtRequests[K]['req']): Promise<ExtReply<K>> {
  try {
    const res = await chrome.runtime.sendMessage({ type, payload })
    return normalize(res, 'background')
  } catch (e) {
    return fail('internal', errorMessage(e))
  }
}

export async function sendTabCommand<K extends ExtTabCommandType>(
  tabId: number,
  type: K,
  payload: ExtTabCommands[K]['req']
): Promise<ExtTabReply<K>> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type, payload })
    return normalize(res, `tab ${tabId}`)
  } catch (e) {
    // tab without a content script yet (loading) or closed: "Receiving end does not exist"
    return fail('internal', errorMessage(e))
  }
}
