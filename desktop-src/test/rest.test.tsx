// REST client: `ctx.rest` + envelope (always HTTP 200 + {ok, data|error}) + useQuery.
import { beforeEach, describe, expect, it } from 'vitest'
import { setPluginContext } from '../lib/ctx'
import { TubeApiError, buildRestRequest, invalidateRest, restCall, restQueryKey, useRest } from '../lib/rest'
import { flush, render } from './render'
import { createMockCtx, sdkMock } from './sdk-mock'

beforeEach(() => {
  setPluginContext(createMockCtx().ctx)
})

describe('buildRestRequest', () => {
  it('replaces path parameters with encoding and builds the query without empty values', () => {
    expect(buildRestRequest('GET /jobs/{id}', { path: { id: 'a b/c' } })).toEqual({
      method: 'GET',
      path: '/jobs/a%20b%2Fc'
    })
    expect(
      buildRestRequest('GET /feed', { query: { tab: 't1', limit: 20, cursor: undefined, folder: '' } })
    ).toEqual({ method: 'GET', path: '/feed?tab=t1&limit=20' })
  })

  it('a missing path parameter is an `invalid` error (never calls the backend)', () => {
    expect(() => buildRestRequest('GET /jobs/{id}', { path: { id: '' } })).toThrow(TubeApiError)
  })
})

describe('restCall', () => {
  it('GET without a body; returns the envelope\'s `data`', async () => {
    sdkMock.restHandler = () => ({ ok: true, data: { id: 'job_1', status: 'running' } })
    const data = await restCall('GET /jobs/{id}', { path: { id: 'job_1' } })
    expect(data).toEqual({ id: 'job_1', status: 'running' })
    expect(sdkMock.restCalls[0]).toEqual({ path: '/jobs/job_1', opts: { method: 'GET' } })
  })

  it('POST carries the body', async () => {
    sdkMock.restHandler = () => ({ ok: true, data: { changed: 1 } })
    await restCall('POST /videos/state', { body: { video_ids: ['dQw4w9WgXcQ'], state: 'seen' } })
    expect(sdkMock.restCalls[0]).toEqual({
      path: '/videos/state',
      opts: { method: 'POST', body: { video_ids: ['dQw4w9WgXcQ'], state: 'seen' } }
    })
  })

  it('an error envelope becomes TubeApiError with code/reason/details', async () => {
    sdkMock.restHandler = () => ({
      ok: false,
      error: { code: 'undo_refused', message: 'already done', reason: 'already_executed', details: { id: 7 } }
    })
    const err = await restCall('POST /changes/{id}/undo', { path: { id: 7 } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TubeApiError)
    expect(err).toMatchObject({ code: 'undo_refused', reason: 'already_executed', details: { id: 7 }, transport: false })
  })

  it('a transport failure (ctx.rest rejects) becomes TubeApiError internal with transport=true', async () => {
    sdkMock.restHandler = () => Promise.reject(new Error('502 Bad Gateway'))
    const err = await restCall('GET /status').catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'internal', transport: true })
  })

  it('a response outside the envelope is an internal error', async () => {
    sdkMock.restHandler = () => ({ items: [] })
    const err = await restCall('GET /tabs').catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'internal', transport: false })
  })
})

describe('useRest', () => {
  it('fetches through ctx.rest and invalidateRest refetches the query', async () => {
    let n = 0
    sdkMock.restHandler = () => ({ ok: true, data: { count: ++n } })
    function Probe() {
      const q = useRest('GET /folders', {})
      return <span>{q.data ? String((q.data as unknown as { count: number }).count) : 'loading'}</span>
    }
    const view = render(<Probe />)
    await flush()
    expect(view.text()).toBe('1')
    await invalidateRest('GET /folders')
    await flush()
    expect(view.text()).toBe('2')
  })

  it('the query key is namespaced by PLUGIN_ID and by the route', () => {
    const key = restQueryKey('GET /feed', { query: { tab: 'a' } })
    expect(key[1]).toBe('rest')
    expect(key[2]).toBe('GET /feed')
  })
})
