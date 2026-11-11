// Message router (extension/src/lib/router.ts): popup/content → background and background → tab.
import { describe, expect, it } from 'vitest'
import type { ExtRequests, ExtTabCommands } from '../../shared/ext-messages'
import { createRouter } from '../src/lib/router'
import { sendRequest } from '../src/lib/messaging'
import { FAKE_EXTENSION_ID, chromeFake } from './setup-chrome'

describe('createRouter', () => {
  it('dispatches by type and wraps the return in an ok envelope', async () => {
    const r = createRouter<ExtRequests>()
    r.on('sync.watch', async (payload) => ({ queued: payload.video_id.length }))
    const res = await r.dispatch({ type: 'sync.watch', payload: { video_id: 'abcdefghijk', watched_at: 1 } })
    expect(res).toEqual({ ok: true, data: { queued: 11 } })
  })

  it('a handler may return a ready envelope (server error passes through)', async () => {
    const r = createRouter<ExtRequests>()
    r.onEnvelope('state.get', async () => ({ ok: false, error: { code: 'unauthorized', message: 'x' } }))
    expect(await r.dispatch({ type: 'state.get', payload: {} })).toEqual({ ok: false, error: { code: 'unauthorized', message: 'x' } })
  })

  it('unknown type → not_found; message without type → invalid', async () => {
    const r = createRouter<ExtRequests>()
    const a = await r.dispatch({ type: 'no.such', payload: {} })
    const b = await r.dispatch({ foo: 1 })
    expect(a.ok === false && a.error.code).toBe('not_found')
    expect(b.ok === false && b.error.code).toBe('invalid')
  })

  it('exception in the handler → internal with a short message', async () => {
    const r = createRouter<ExtRequests>()
    r.on('sync.now', async () => {
      throw new Error('boom')
    })
    const res = await r.dispatch({ type: 'sync.now', payload: {} })
    expect(res).toEqual({ ok: false, error: { code: 'internal', message: 'boom' } })
  })

  it('duplicate registration is a programming error', () => {
    const r = createRouter<ExtRequests>()
    r.on('sync.now', async () => ({ started: false }))
    expect(() => r.on('sync.now', async () => ({ started: true }))).toThrow(/duplicate handler for "sync\.now"/)
  })

  it('lists the registered types', () => {
    const r = createRouter<ExtTabCommands>()
    r.on('search.extract', async () => ({ payload: null }))
    expect(r.types()).toEqual(['search.extract'])
  })

  it('listen() answers chrome.runtime.sendMessage asynchronously', async () => {
    const r = createRouter<ExtRequests>()
    r.on('sync.now', async () => ({ started: true }))
    r.listen()
    const res = await sendRequest('sync.now', {})
    expect(res).toEqual({ ok: true, data: { started: true } })
  })

  it('listen() ignores messages from another extension', async () => {
    const r = createRouter<ExtRequests>()
    r.on('sync.now', async () => ({ started: true }))
    r.listen()
    const fake = chromeFake()
    const res = await (fake.chrome.runtime.sendMessage as unknown as (m: unknown, s: object) => Promise<unknown>)(
      { type: 'sync.now', payload: {} },
      { id: 'outra-extensao' }
    )
    expect(res).toBeUndefined()
    expect(FAKE_EXTENSION_ID).not.toBe('outra-extensao')
  })

  it('listen() returns a function that detaches the listener', () => {
    const r = createRouter<ExtRequests>()
    const off = r.listen()
    expect(chromeFake().events.message.listeners).toHaveLength(1)
    off()
    expect(chromeFake().events.message.listeners).toHaveLength(0)
  })
})

describe('sendRequest', () => {
  it('with no background answering → internal envelope (does not throw)', async () => {
    const res = await sendRequest('conn.status', {})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('internal')
  })
})
