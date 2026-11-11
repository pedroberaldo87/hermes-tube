// Popup pieces. No global state: each view receives what it shows and the actions as props.
// Accessibility: real labels, `aria-live` on errors and progress, focus on the code field on open,
// disconnect confirmation with focus on the safe button, and `Esc` to cancel.
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { ApiError } from '../../../shared/api-types'
import type { ConnectionState, SyncStatus } from '../../../shared/ext-messages'
import { CODE_LENGTH, normalizeCode, parseAddress } from '../background/pairing'
import type { QueueView } from './queue-view'
import { p, pairErrorText, relTime, shortDate, syncLines } from './text'

// ------------------------------------------------------------------ icons (monochrome, decorative)

const svg = (d: ComponentChildren) => (
  <svg class="icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    {d}
  </svg>
)

export const Icons = {
  mark: () =>
    svg(
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M10.5 9.5v5l4-2.5z" fill="currentColor" stroke="none" />
      </>
    ),
  plug: () =>
    svg(
      <>
        <path d="M9 7V3M15 7V3" />
        <path d="M7 7h10v4a5 5 0 0 1-10 0z" />
        <path d="M12 16v5" />
      </>
    ),
  key: () =>
    svg(
      <>
        <circle cx="8" cy="15" r="4" />
        <path d="M11 12l9-9M17 6l3 3M15 8l2 2" />
      </>
    ),
  user: () =>
    svg(
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
  alert: () =>
    svg(
      <>
        <path d="M12 3l9.5 17h-19z" />
        <path d="M12 10v4M12 17.5v.01" />
      </>
    ),
  external: () =>
    svg(
      <>
        <path d="M14 4h6v6M20 4l-9 9" />
        <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
      </>
    )
}

// ------------------------------------------------------------------ header

export type PillState = ConnectionState | 'checking' | 'loading'

export function Header({ pill }: { pill: PillState }) {
  const tone =
    pill === 'connected' ? 'ok' : pill === 'unpaired' || pill === 'loading' || pill === 'checking' ? 'idle' : pill === 'unauthorized' ? 'bad' : 'warn'
  return (
    <header class="top">
      <span class="mark">{Icons.mark()}</span>
      <h1 class="title">{p('app_name')}</h1>
      {pill !== 'loading' && (
        <span class={`pill pill-${tone}`} data-testid="conn-pill">
          <span class="dot" aria-hidden="true" />
          {p(`pill_${pill}`)}
        </span>
      )}
    </header>
  )
}

// ------------------------------------------------------------------ not paired

export interface UnpairedProps {
  initialAddress: string
  onSubmit(code: string, port: number | null): Promise<ApiError | null>
}

export function Unpaired({ initialAddress, onSubmit }: UnpairedProps) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [address, setAddress] = useState(initialAddress)
  const [addressError, setAddressError] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(initialAddress))
  const input = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    input.current?.focus()
  }, [])

  async function submit(value: string): Promise<void> {
    if (busyRef.current || value.length !== CODE_LENGTH) return
    const parsed = parseAddress(address)
    if (!parsed.ok) {
      setAddressError(true)
      setAdvancedOpen(true)
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    const err = await onSubmit(value, parsed.port)
    busyRef.current = false
    setBusy(false)
    if (!err) return // the parent swaps the view
    setError(err)
    // after an error, typing replaces the whole code
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.select()
    })
  }

  function change(raw: string): void {
    const value = normalizeCode(raw)
    if (input.current && input.current.value !== value) input.current.value = value
    setCode(value)
    if (error) setError(null)
    if (value.length === CODE_LENGTH) void submit(value)
  }

  const errorText = error ? pairErrorText(error) : ''
  return (
    <section class="pane" aria-labelledby="tagline">
      <p id="tagline" class="lead">
        {p('tagline')}
      </p>
      <form
        class="code-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(code)
        }}
      >
        <label class="label" for="code-input">
          {p('code_label')}
        </label>
        <div class="code-row">
          <input
            ref={input}
            id="code-input"
            data-testid="code-input"
            class={`code${error ? ' code-error' : ''}`}
            type="text"
            inputMode="numeric"
            autocomplete="one-time-code"
            spellcheck={false}
            placeholder="000000"
            value={code}
            disabled={busy}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby="code-hint pair-error"
            onInput={(e) => change((e.currentTarget as HTMLInputElement).value)}
            onPaste={(e) => {
              const pasted = e.clipboardData?.getData('text')
              if (pasted == null) return
              e.preventDefault()
              change(pasted)
            }}
          />
          <button type="submit" class="btn btn-primary" data-testid="code-submit" disabled={busy || code.length !== CODE_LENGTH}>
            {p('connect')}
          </button>
        </div>
        <p id="code-hint" class="hint">
          {p('code_hint')}
        </p>
        <p class="busy" role="status" aria-live="polite">
          {busy ? (
            <>
              <span class="spinner" aria-hidden="true" />
              {p('pairing')}
            </>
          ) : null}
        </p>
        <p id="pair-error" data-testid="pair-error" class="error" aria-live="assertive" aria-atomic="true">
          {errorText}
        </p>
      </form>

      <details class="disclosure" data-testid="where-code">
        <summary>{p('where_code')}</summary>
        <ol class="steps">
          <li>{p('where_step1')}</li>
          <li>{p('where_step2')}</li>
          <li>{p('where_step3')}</li>
        </ol>
      </details>

      <details
        class="disclosure"
        data-testid="advanced"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>{p('advanced')}</summary>
        <div class="field">
          <label class="label" for="address-input">
            {p('address_label')}
          </label>
          <input
            id="address-input"
            data-testid="address-input"
            class="text"
            type="text"
            inputMode="url"
            spellcheck={false}
            placeholder={p('address_placeholder')}
            value={address}
            aria-invalid={addressError ? 'true' : undefined}
            aria-describedby="address-hint address-error"
            onInput={(e) => {
              setAddress((e.currentTarget as HTMLInputElement).value)
              setAddressError(false)
            }}
          />
          <p id="address-hint" class="hint">
            {p('address_hint')}
          </p>
          <p id="address-error" data-testid="address-error" class="error" aria-live="assertive">
            {addressError ? p('address_invalid') : ''}
          </p>
        </div>
      </details>
    </section>
  )
}

// ------------------------------------------------------------------ device

export interface DeviceProps {
  name: string
  pairedAt: number | null
  lastOkAt: number | null
  /** connection is good now; otherwise the line becomes "last response X ago" (or disappears, if it was moments ago) */
  connected: boolean
  port: number | null
  deviceId: string | null
  now: number
}

/** With a connection problem, "last response just now" next to "Hermes closed" is confusing: only from this point on. */
export const LAST_SEEN_MIN_MS = 60_000

function seenLine(connected: boolean, lastOkAt: number | null, now: number): string | null {
  if (!lastOkAt) return null
  if (connected) return p('seen', { when: relTime(lastOkAt, now) })
  return now - lastOkAt >= LAST_SEEN_MIN_MS ? p('seen_last', { when: relTime(lastOkAt, now) }) : null
}

export function Device({ name, pairedAt, lastOkAt, connected, port, deviceId, now }: DeviceProps) {
  const meta = [pairedAt ? p('paired_on', { date: shortDate(pairedAt) }) : null, seenLine(connected, lastOkAt, now)].filter(Boolean)
  return (
    <section class="card device" aria-labelledby="device-label">
      <p id="device-label" class="label">
        {p('this_browser')}
      </p>
      <p class="head" data-testid="device-name">
        {name}
      </p>
      {meta.length > 0 && <p class="meta">{meta.join(' · ')}</p>}
      <details class="disclosure disclosure-quiet">
        <summary>{p('details')}</summary>
        <p class="meta mono">
          {port ? p('details_address', { address: `127.0.0.1:${port}` }) : null}
          {port && deviceId ? <br /> : null}
          {deviceId ? p('details_device', { id: deviceId }) : null}
        </p>
      </details>
    </section>
  )
}

// ------------------------------------------------------------------ sync

export interface SyncProps {
  sync: SyncStatus | null
  running: boolean
  startedAt: number | null
  error: string | null
  now: number
  onSyncNow(): void
}

export function SyncCard({ sync, running, startedAt, error, now, onSyncNow }: SyncProps) {
  const lines = syncLines(sync, now)
  return (
    <section class="card" aria-labelledby="sync-title">
      <h2 id="sync-title" class="label">
        {p('last_sync')}
      </h2>
      <div data-testid="sync-summary" class="sync-summary">
        <p class="body">{lines.main}</p>
        {lines.notes.map((n) => (
          <p class="meta" key={n}>
            {n}
          </p>
        ))}
      </div>
      {running && (
        <div class="progress" data-testid="sync-progress" role="status" aria-live="polite">
          <div class="bar" aria-hidden="true">
            <span />
          </div>
          <p class="body">{p('syncing')}</p>
          <p class="meta">
            {startedAt ? `${p('syncing_since', { when: relTime(startedAt, now) })} ` : ''}
            {p('syncing_note')}
          </p>
        </div>
      )}
      <p class="error" aria-live="assertive" data-testid="sync-error">
        {error ?? ''}
      </p>
      <SyncButton running={running} onClick={onSyncNow} />
    </section>
  )
}

export function SyncButton({ running, onClick, quiet }: { running: boolean; onClick(): void; quiet?: boolean }) {
  return (
    <button type="button" class={`btn ${quiet ? 'btn-secondary' : 'btn-primary'} btn-block`} data-testid="sync-now" disabled={running} aria-busy={running ? 'true' : undefined} onClick={onClick}>
      {running && <span class="spinner" aria-hidden="true" />}
      {p('sync_now')}
    </button>
  )
}

// ------------------------------------------------------------------ unsubscribe queue

export interface QueueCardProps {
  view: QueueView
  /** a request (stop/resume) in flight */
  busy: boolean
  error: string | null
  onStop(): void
  onResume(): void
  onOpenYouTube(): void
  /** "Run now": releases exactly the listed items (state `waiting`) */
  onRunNow?(): void
  /** "Not now": leaves them waiting, without the badge */
  onNotNow?(): void
}

/**
 * Queue card: shows, stops, resumes and — for items already queued in Hermes — asks for the click that lets a
 * round run ("Run now"). No choosing or approving items here.
 */
export function QueueCard({ view, busy, error, onStop, onResume, onOpenYouTube, onRunNow, onNotNow }: QueueCardProps) {
  const moving = view.state === 'running' || view.state === 'stopping' || view.state === 'resuming'
  const askYouTube = view.state === 'held' && (view.holdReason === 'logged_out' || view.holdReason === 'challenge')
  return (
    <section class={`card queue queue-${view.state}`} data-testid="queue-card" data-state={view.state} aria-labelledby="queue-title">
      <h2 id="queue-title" class="label">
        {p('queue_label')}
      </h2>
      {view.heading && <p class="head">{view.heading}</p>}
      <p class="body" data-testid="queue-line" aria-live="polite" aria-atomic="true">
        {view.line}
      </p>
      {moving && (
        <div class="bar" aria-hidden="true">
          <span />
        </div>
      )}
      {view.channels && view.channels.length > 0 && (
        <ul class="waiting" data-testid="queue-waiting-list">
          {view.channels.map((c, i) => (
            <li key={`${i}:${c}`}>{c}</li>
          ))}
        </ul>
      )}
      {view.failures.length > 0 && (
        <ul class="fails" data-testid="queue-failures">
          {view.failures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {view.notes.map((n) => (
        <p class="meta" key={n}>
          {n}
        </p>
      ))}
      <p class="error" aria-live="assertive" data-testid="queue-error">
        {error ?? ''}
      </p>
      {view.state === 'waiting' && (
        <div class="actions">
          <button type="button" class="btn btn-primary" data-testid="queue-run-now" disabled={busy} onClick={onRunNow}>
            {p('queue_run_now')}
          </button>
          <button type="button" class="btn btn-secondary" data-testid="queue-not-now" disabled={busy} onClick={onNotNow}>
            {p('queue_not_now')}
          </button>
        </div>
      )}
      {view.state === 'running' && (
        <div class="actions">
          <button type="button" class="btn btn-secondary" data-testid="queue-stop" disabled={busy} onClick={onStop}>
            {p('queue_stop')}
          </button>
        </div>
      )}
      {view.state === 'stopped' && (
        <div class="actions">
          <button type="button" class="btn btn-primary" data-testid="queue-resume" disabled={busy} onClick={onResume}>
            {p('queue_resume')}
          </button>
        </div>
      )}
      {view.state === 'held' && (
        <div class="actions">
          <button type="button" class="btn btn-primary" data-testid="queue-retry" disabled={busy} onClick={onResume}>
            {p(view.holdReason === 'cap' ? 'queue_continue_now' : 'queue_retry')}
          </button>
          {askYouTube && (
            <button type="button" class="btn btn-secondary" data-testid="queue-open-youtube" onClick={onOpenYouTube}>
              {p('open_youtube')}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

// ------------------------------------------------------------------ problem

export interface ProblemProps {
  kind: 'closed' | 'unauthorized' | 'logged_out' | 'error'
  body?: string
  children?: ComponentChildren
}

export function Problem({ kind, body, children }: ProblemProps) {
  const icon = kind === 'closed' ? Icons.plug() : kind === 'unauthorized' ? Icons.key() : kind === 'logged_out' ? Icons.user() : Icons.alert()
  return (
    <section class="card problem" data-testid="problem" role="alert" aria-labelledby="problem-title">
      <div class="problem-head">
        <span class={`problem-icon problem-${kind}`}>{icon}</span>
        <h2 id="problem-title" class="head">
          {p(`problem_${kind}_title`)}
        </h2>
      </div>
      <p class="body">{body ?? p(`problem_${kind}_body`)}</p>
      <div class="actions">{children}</div>
    </section>
  )
}

// ------------------------------------------------------------------ footer + disconnect

export interface FooterProps {
  onOpenHermes(): void
  onDisconnect(): Promise<void>
}

export function Footer({ onOpenHermes, onDisconnect }: FooterProps) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const safe = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)

  useEffect(() => {
    if (confirming) safe.current?.focus()
    else if (wasConfirming.current) opener.current?.focus()
    wasConfirming.current = confirming
  }, [confirming])

  return (
    <>
      <footer class="foot">
        <button type="button" class="link" data-testid="open-hermes" onClick={onOpenHermes}>
          {p('open_hermes')}
          {Icons.external()}
        </button>
        <button
          ref={opener}
          type="button"
          class="link link-quiet"
          data-testid="disconnect"
          aria-expanded={confirming ? 'true' : 'false'}
          aria-controls="disconnect-confirm"
          onClick={() => setConfirming(true)}
        >
          {p('disconnect')}
        </button>
      </footer>
      {confirming && (
        <div
          id="disconnect-confirm"
          class="card confirm"
          data-testid="disconnect-confirm"
          role="alertdialog"
          aria-labelledby="dc-title"
          aria-describedby="dc-body"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !busy) {
              e.preventDefault()
              setConfirming(false)
            }
          }}
        >
          <p id="dc-title" class="head">
            {p('disconnect_title')}
          </p>
          <p id="dc-body" class="body">
            {p('disconnect_body')}
          </p>
          <div class="actions">
            <button ref={safe} type="button" class="btn btn-secondary" data-testid="disconnect-cancel" disabled={busy} onClick={() => setConfirming(false)}>
              {p('cancel')}
            </button>
            <button
              type="button"
              class="btn btn-danger"
              data-testid="disconnect-yes"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await onDisconnect()
              }}
            >
              {busy ? p('disconnecting') : p('disconnect_yes')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
