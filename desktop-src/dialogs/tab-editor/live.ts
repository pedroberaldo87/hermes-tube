// Live preview of the editor (`POST /feed/preview` with the current rule): the 1st request goes out at once; later ones wait
// `PREVIEW_DEBOUNCE_MS` without changes. Every change invalidates the in-flight request (sequence number): an old response that
// arrives later is discarded. Until the new one arrives, the previous page stays (the pane fades it).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeedPage, TabRules } from '../../../shared/api-types'
import { restCall } from '../../lib/rest'
import { PREVIEW_DEBOUNCE_MS, PREVIEW_LIMIT, rulesKey } from './model'

export type LiveStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface LivePreview {
  status: LiveStatus
  page: FeedPage | null
  /** A new request is on its way and the page shown belongs to the previous rule. */
  stale: boolean
  error: unknown
  retry: () => void
}

interface State {
  page: FeedPage | null
  error: unknown
  pending: boolean
}

/** `rules` null = do not request (no source, invalid rule). */
export function useLivePreview(rules: TabRules | null): LivePreview {
  const key = rules ? rulesKey(rules) : null
  const rulesRef = useRef(rules)
  rulesRef.current = rules
  const seq = useRef(0)
  const immediate = useRef(true)
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<State>({ page: null, error: null, pending: false })

  useEffect(() => {
    seq.current += 1 // whatever is in flight stops counting
    if (!key) {
      setState((s) => (s.pending ? { ...s, pending: false } : s))
      return
    }
    setState((s) => (s.pending ? s : { ...s, pending: true }))
    const run = () => {
      const current = rulesRef.current
      if (!current) return
      const my = ++seq.current
      restCall('POST /feed/preview', { body: { rules: current, limit: PREVIEW_LIMIT } }).then(
        (page) => {
          if (my === seq.current) setState({ page, error: null, pending: false })
        },
        (error: unknown) => {
          if (my === seq.current) setState((s) => ({ page: s.page, error, pending: false }))
        }
      )
    }
    if (immediate.current) {
      immediate.current = false
      run()
      return
    }
    const timer = setTimeout(run, PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [key, nonce])

  const retry = useCallback(() => {
    immediate.current = true
    setNonce((n) => n + 1)
  }, [])

  let status: LiveStatus
  if (!key) status = 'idle'
  else if (state.error && !state.pending) status = 'error'
  else if (state.page) status = 'ready'
  else status = 'loading'
  return { status, page: state.page, stale: !!key && state.pending && !!state.page, error: state.error, retry }
}
