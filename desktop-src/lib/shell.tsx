// ShellHost: the shell's permanent "engine". main.tsx mounts one at each permanent point (status
// bar chip, pane, pages); only the leader acts:
//  - `GET /status` poll every 5 s while the window is visible → `$status` (chip, pane, mascot);
//  - `refresh.done`/`queue.changed` events only bring the next `/status` forward;
//  - `GET /extras` → `extras` atom (and `settings.changed` brings it forward);
//  - mascot: new `/status` → lines (function from chat/mascot) → `ctx.pet` or the chip fallback;
//  - connection or profile switch → every plugin read again (`invalidateRest()`);
//  - `DialogHost` (dialogs opened through `openDialog`).
import { useEffect, useRef } from 'react'
import type { StatusResponse } from '../../shared/api-types'
import { DialogHost } from './dialogs'
import { onRawEvent, pluginEventType, useTubeEvents } from './events'
import { EXTRAS_REFRESH_MS, setExtras } from './extras'
import { useLeader } from './leader'
import { onShellReset } from './lifecycle'
import { type MascotLinesFn, sayToPet } from './pet'
import { invalidateRest, useRest, useRestScope } from './rest'
import { $status, useStatus } from './status'

interface ShellConfig {
  mascotLines: MascotLinesFn
}

const DEFAULT_CONFIG: ShellConfig = { mascotLines: () => [] }
let config: ShellConfig = DEFAULT_CONFIG

onShellReset(() => {
  config = DEFAULT_CONFIG
})

/** Wires the pieces of each area into the shell (main.tsx). */
export function configureShell(next: Partial<ShellConfig>): void {
  config = { ...config, ...next }
}

const STATUS_EVENTS = ['refresh.done', 'queue.changed'] as const

function useStatusPoller(): void {
  const q = useStatus({ poll: true })
  const data = q.data as StatusResponse | undefined
  const prev = useRef<StatusResponse | null>(null)
  useEffect(() => {
    if (!data) return
    $status.set(data)
    let lines: ReturnType<MascotLinesFn> = []
    try {
      lines = config.mascotLines(prev.current, data)
    } catch {
      lines = []
    }
    for (const line of lines) sayToPet(line)
    prev.current = data
  }, [data])
  useTubeEvents(STATUS_EVENTS, () => {
    void invalidateRest('GET /status')
  })
}

function useExtrasSync(): void {
  const q = useRest('GET /extras', {}, { refetchInterval: EXTRAS_REFRESH_MS })
  useEffect(() => {
    if (q.data) setExtras(q.data)
  }, [q.data])
  useEffect(
    () =>
      onRawEvent(pluginEventType('settings.changed'), () => {
        void invalidateRest('GET /extras')
      }),
    []
  )
}

/**
 * Connection or profile switch: every plugin read is done again. Keys built with `useRest` already carry the scope;
 * this also covers queries whose key was built once, outside a re-render (`restQueryKey`).
 */
function useScopeRefresh(): void {
  const scope = useRestScope()
  const last = useRef(scope)
  useEffect(() => {
    if (last.current === scope) return
    last.current = scope
    $status.set(null)
    void invalidateRest()
  }, [scope])
}

function ShellLeader() {
  useStatusPoller()
  useExtrasSync()
  useScopeRefresh()
  return <DialogHost />
}

/** Mount on every permanent surface; only the leader instance works. */
export function ShellHost() {
  const leader = useLeader('shell-host')
  return leader ? <ShellLeader /> : null
}
