// Job poll: `GET /jobs/{id}` every 2 s while queued/running; events only bring it forward.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job, JobStatus } from '../../shared/api-types'
import { JOB_POLL_MS, RPC_CAPABILITY, eventType, rpcMethod } from '../../shared/ids'
import { setPluginContext } from '../lib/ctx'
import { useJob, useRpcJob } from '../lib/jobs'
import { advance, click, flush, render } from './render'
import { createMockCtx, emitEvent, rpcError, sdkMock } from './sdk-mock'

function job(id: string, status: JobStatus, extra: Partial<Job> = {}): Job {
  return {
    id,
    kind: 'theme',
    status,
    created_at: 1762700000,
    updated_at: 1762700000,
    progress: null,
    result: null,
    error: null,
    ...extra
  }
}

/** REST backend: each GET /jobs/<id> returns the next status in the queue (the last one repeats). */
function jobsBackend(seq: Record<string, Job[]>) {
  const served: Record<string, number> = {}
  sdkMock.restHandler = (path) => {
    const m = path.match(/^\/jobs\/([^/?]+)$/)
    if (!m) return { ok: false, error: { code: 'not_found', message: path } }
    const list = seq[m[1]] ?? []
    const i = Math.min(served[m[1]] ?? 0, list.length - 1)
    served[m[1]] = (served[m[1]] ?? 0) + 1
    return list[i] ? { ok: true, data: list[i] } : { ok: false, error: { code: 'not_found', message: m[1] } }
  }
}

const jobCalls = (id: string) => sdkMock.restCalls.filter((c) => c.path === `/jobs/${id}`).length

function JobProbe({ id }: { id: string | null }) {
  const q = useJob(id)
  return <span>{q.data ? q.data.status : 'none'}</span>
}

beforeEach(() => {
  vi.useFakeTimers()
  setPluginContext(createMockCtx().ctx)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useJob', () => {
  it('polls every 2 s while active and stops when it finishes', async () => {
    jobsBackend({ job_1: [job('job_1', 'queued'), job('job_1', 'running'), job('job_1', 'done')] })
    const view = render(<JobProbe id="job_1" />)
    await flush()
    expect(view.text()).toBe('queued')
    expect(jobCalls('job_1')).toBe(1)
    await advance(JOB_POLL_MS - 1)
    expect(jobCalls('job_1')).toBe(1)
    await advance(1)
    expect(view.text()).toBe('running')
    await advance(JOB_POLL_MS)
    expect(view.text()).toBe('done')
    expect(jobCalls('job_1')).toBe(3)
    await advance(JOB_POLL_MS * 10)
    expect(jobCalls('job_1')).toBe(3)
  })

  it('without an id polls nothing', async () => {
    jobsBackend({})
    const view = render(<JobProbe id={null} />)
    await advance(JOB_POLL_MS * 3)
    expect(view.text()).toBe('none')
    expect(sdkMock.restCalls).toHaveLength(0)
  })

  it('a job that does not exist (not_found) does not keep polling', async () => {
    jobsBackend({})
    render(<JobProbe id="job_x" />)
    await flush()
    await advance(JOB_POLL_MS * 5)
    expect(jobCalls('job_x')).toBe(1)
  })

  it('an event of the same job brings the poll forward; another job\'s is ignored', async () => {
    jobsBackend({ job_1: [job('job_1', 'running'), job('job_1', 'done')] })
    const view = render(<JobProbe id="job_1" />)
    await flush()
    expect(jobCalls('job_1')).toBe(1)
    emitEvent(eventType('theme.ready'), { job: 'job_2', status: 'done' })
    await flush()
    expect(jobCalls('job_1')).toBe(1)
    emitEvent(eventType('theme.ready'), { job: 'job_1', status: 'done' })
    await flush()
    expect(jobCalls('job_1')).toBe(2)
    expect(view.text()).toBe('done')
  })

  it('finishes even without any event (no event ever arrives)', async () => {
    jobsBackend({ job_1: [job('job_1', 'running'), job('job_1', 'running'), job('job_1', 'error')] })
    const view = render(<JobProbe id="job_1" />)
    await flush()
    await advance(JOB_POLL_MS * 2)
    expect(view.text()).toBe('error')
  })
})

describe('useRpcJob', () => {
  function ThemeProbe() {
    const run = useRpcJob('theme.create')
    return (
      <div>
        <button type="button" onClick={() => void run.start({ query: 'rust' })}>
          go
        </button>
        <span data-testid="phase">{run.phase}</span>
        <span data-testid="stage">{run.progress?.stage ?? ''}</span>
        <span data-testid="result">{run.result ? JSON.stringify(run.result) : ''}</span>
        <span data-testid="error">{run.error?.code ?? ''}</span>
      </div>
    )
  }
  const q = (view: { container: HTMLElement }, id: string) =>
    view.container.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''

  it('RPC returns the job → follows through GET /jobs/{id} until done and exposes the result', async () => {
    sdkMock.requestHandler = (method) => {
      if (method === 'runtime.describe') return { capabilities: [RPC_CAPABILITY] }
      if (method === rpcMethod('theme.create')) return { ok: true, data: { job: job('job_3', 'queued') } }
      throw rpcError(-32601)
    }
    jobsBackend({
      job_3: [
        job('job_3', 'running', { progress: { stage: 'search', done: 3, total: 12, message: null } }),
        job('job_3', 'done', { result: { theme_id: 'th_1' } })
      ]
    })
    const view = render(<ThemeProbe />)
    expect(q(view, 'phase')).toBe('idle')
    click(view.container.querySelector('button'))
    await flush()
    expect(q(view, 'phase')).toBe('running')
    expect(q(view, 'stage')).toBe('search')
    await advance(JOB_POLL_MS)
    expect(q(view, 'phase')).toBe('done')
    expect(q(view, 'result')).toBe('{"theme_id":"th_1"}')
  })

  it('job with an error → phase error with the job\'s code', async () => {
    sdkMock.requestHandler = (method) =>
      method === 'runtime.describe'
        ? { capabilities: [RPC_CAPABILITY] }
        : { ok: true, data: { job: job('job_4', 'queued') } }
    jobsBackend({ job_4: [job('job_4', 'error', { error: { code: 'llm_unavailable', message: 'no model' } })] })
    const view = render(<ThemeProbe />)
    click(view.container.querySelector('button'))
    await flush()
    expect(q(view, 'phase')).toBe('error')
    expect(q(view, 'error')).toBe('llm_unavailable')
  })

  it('resumes an existing job by id (the dialog\'s props.jobId) without calling RPC', async () => {
    jobsBackend({ job_9: [job('job_9', 'running'), job('job_9', 'done', { result: { ok: 1 } })] })
    function Resume() {
      const run = useRpcJob('organize.run', 'job_9')
      return <span data-testid="phase">{run.phase}</span>
    }
    const view = render(<Resume />)
    await flush()
    expect(q(view, 'phase')).toBe('running')
    await advance(JOB_POLL_MS)
    expect(q(view, 'phase')).toBe('done')
    expect(sdkMock.requests).toEqual([])
  })

  it('no RPC → phase unavailable and no job polled', async () => {
    sdkMock.requestHandler = () => {
      throw rpcError(-32601, 'unknown method: runtime.describe')
    }
    jobsBackend({})
    const view = render(<ThemeProbe />)
    click(view.container.querySelector('button'))
    await flush()
    expect(q(view, 'phase')).toBe('unavailable')
    await advance(JOB_POLL_MS * 3)
    expect(sdkMock.restCalls).toHaveLength(0)
  })

  it('method error (envelope) → phase error without a job', async () => {
    sdkMock.requestHandler = (method) =>
      method === 'runtime.describe'
        ? { capabilities: [RPC_CAPABILITY] }
        : { ok: false, error: { code: 'busy', message: 'busy' } }
    const view = render(<ThemeProbe />)
    click(view.container.querySelector('button'))
    await flush()
    expect(q(view, 'phase')).toBe('error')
    expect(q(view, 'error')).toBe('busy')
  })
})
