// popup: the three states (not paired, paired, problem), each pairing error with the right text,
// paste/submit on the 6th digit, sync now, disconnect, the unsubscribe queue card (Stop/Resume), and the
// token never in the DOM or the console.
// Whole world in jsdom: popup → chrome.runtime (fake) → background router → pairing → ExtClient → FakeNet.
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueItem } from '../../shared/api-types'
import { ALARMS, STORAGE_KEYS, type QueueProgress, type SyncStatus } from '../../shared/ext-messages'
import { EXT_PORTS } from '../../shared/ids'
import { createPairing, PAIR_INFO_KEY, PAIR_PORT_KEY } from '../src/background/pairing'
import { createQueueModule } from '../src/background/queue'
import { createBackground, type BackgroundModule } from '../src/lib/background'
import { ExtClient, chromeConnectionStore } from '../src/lib/client'
import { catalog, setLanguage } from '../src/lib/i18n'
import { EXT_STATE_EXAMPLE } from '../src/lib/stubs'
import { QUEUE_RELEASE_KEY, QUEUE_WAITING_KEY } from '../src/lib/queue-release'
import { App } from '../src/popup/App'
import { chromeFake, installChromeFake } from './setup-chrome'
import { FakeNet, errorBody, type FakeServer } from './setup-net'

const PORT = EXT_PORTS[1]
const CODE = '481516'
const TOKEN = 'tok_SECRET_4f9c2d7e1a_never_in_dom_or_console'
const NOW = 1_762_800_000_000
// popup sources (the extension's tsconfig has no Node types: dynamic import, as in unsubscribe.test.ts)
type Fs = { readFileSync(p: string, enc: 'utf8'): string; readdirSync(p: string): string[] }
const fs = (): Promise<Fs> => import('node:fs' as string) as Promise<Fs>
const HERE = import.meta.url
const popupDir = () => decodeURIComponent(new URL('../src/popup/', HERE).pathname)
async function popupSources(): Promise<Record<string, string>> {
  const f = await fs()
  const out: Record<string, string> = {}
  for (const name of f.readdirSync(popupDir())) if (/\.(tsx?|html)$/.test(name)) out[name] = f.readFileSync(popupDir() + name, 'utf8')
  return out
}

// ------------------------------------------------------------------ world

interface World {
  net: FakeNet
  server: FakeServer
  syncCalls: number
  root: HTMLElement
}

/** Messages the popup sent to the background (type + payload), in order. */
let sent: Array<{ type: string; payload: unknown }> = []
/** pending releases (executor gates) — rounds never leak into the next test */
const cleanups: Array<() => void> = []

let w: World
let consoleLines: string[]

function syncModule(state: { calls: number }): BackgroundModule {
  return {
    MODULE: 'background/sync',
    ROUTES: [],
    REAL_ROUTES: [],
    MESSAGES: ['sync.now'],
    register(ctx) {
      ctx.router.onEnvelope('sync.now', async () => {
        state.calls++
        const conn = await ctx.client.status()
        if (conn.state === 'unpaired') return { ok: false, error: { code: 'unauthorized', message: 'unpaired', reason: 'unpaired' } }
        const running: SyncStatus = {
          state: 'running',
          trigger: 'manual',
          started_at: Date.now(),
          finished_at: null,
          signal: null,
          reason: null,
          sent: 0,
          dropped: 0,
          report: null,
          error: null
        }
        await chrome.storage.local.set({ [STORAGE_KEYS.syncStatus]: running })
        return { ok: true, data: { started: true } }
      })
    }
  }
}

function makeWorld(opts: { servers?: boolean; modules?: BackgroundModule[]; queuePending?: number } = {}): World {
  const net = new FakeNet()
  const server = net.addServer(PORT, { pairingCode: CODE, issuedToken: TOKEN, deviceId: 'dev_1' })
  if (opts.servers === false) net.down(PORT)
  server.route('GET /ext/state', () => ({ body: { ok: true, data: { ...EXT_STATE_EXAMPLE, queue_pending: opts.queuePending ?? 0, language: 'pt-BR' } } }))
  server.route('POST /ext/unpair', () => ({ body: { ok: true, data: { revoked: true } } }))
  const client = new ExtClient({ fetch: net.fetch, store: chromeConnectionStore() })
  const counter = { calls: 0 }
  const pairing = createPairing({
    firstSyncDelayMs: 0,
    deviceName: () => 'Chrome — macOS',
    clientFor: (ports) => new ExtClient({ fetch: net.fetch, store: chromeConnectionStore(), ports })
  })
  const bg = createBackground({ client, modules: [pairing, syncModule(counter), ...(opts.modules ?? [])] })
  bg.start()
  // records everything that reaches the background (the popup is the only sender in these tests)
  chromeFake().events.message.listeners.unshift((msg: unknown) => {
    const m = msg as { type?: string; payload?: unknown }
    if (typeof m?.type === 'string') sent.push({ type: m.type, payload: m.payload })
    return undefined
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  const world = {
    net,
    server,
    root,
    get syncCalls() {
      return counter.calls
    }
  }
  return world
}

/** swaps the test world (clean fake chrome: a single background listening) */
function rebuild(opts: Parameters<typeof makeWorld>[0]): void {
  render(null, w.root)
  w.root.remove()
  installChromeFake()
  w = makeWorld(opts)
}

/** writes the way the background would (straight into the fake, outside any spy) and notifies the listeners */
async function writeAsBackground(items: Record<string, unknown>): Promise<void> {
  const changes: Record<string, chrome.storage.StorageChange> = {}
  for (const [k, v] of Object.entries(items)) {
    changes[k] = { oldValue: chromeFake().storage.get(k), newValue: v }
    chromeFake().storage.set(k, v)
  }
  await act(async () => {
    chromeFake().events.storageChanged.emit(changes, 'local')
  })
  await settle()
}

async function mount(now: () => number = () => NOW): Promise<void> {
  await act(async () => {
    render(<App now={now} />, w.root)
  })
  await settle()
}

/** `false` while a test deliberately holds a fake chrome promise (`flush` would wait for it) */
let flushChrome = true

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      if (flushChrome) await chromeFake().flush()
      await new Promise((r) => setTimeout(r, flushChrome ? 2 : 5))
    })
  }
}

async function waitFor(check: () => void, timeout = 2000): Promise<void> {
  const until = Date.now() + timeout
  for (;;) {
    try {
      check()
      return
    } catch (e) {
      if (Date.now() > until) throw e
      await settle()
    }
  }
}

const q = <T extends Element = HTMLElement>(id: string) => w.root.querySelector<T & HTMLElement>(`[data-testid="${id}"]`)
const must = <T extends Element = HTMLElement>(id: string): T & HTMLElement => {
  const el = q<T>(id)
  if (!el) throw new Error(`no [data-testid="${id}"] in: ${w.root.innerHTML.slice(0, 400)}`)
  return el
}
const text = () => w.root.textContent ?? ''

async function typeCode(value: string, inputType = 'insertText'): Promise<void> {
  const input = must<HTMLInputElement>('code-input')
  await act(async () => {
    input.value = value
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }))
  })
  await settle()
}

async function click(id: string): Promise<void> {
  await act(async () => {
    must(id).click()
  })
  await settle()
}

async function seedConnected(extra: Record<string, unknown> = {}, status: Record<string, unknown> = {}): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.connection]: {
      port: PORT,
      token: TOKEN,
      device_id: 'dev_1',
      paired_at: NOW - 3 * 86_400_000,
      status: { state: 'connected', last_ok_at: NOW - 60_000, error: null, ...status }
    },
    [PAIR_INFO_KEY]: { device_name: 'Chrome — macOS', paired_at: NOW - 3 * 86_400_000 },
    ...extra
  })
  w.server.opts.token = TOKEN
  w.server.opts.pairingCode = undefined
}

function syncStatus(over: Partial<SyncStatus> & Record<string, unknown>): SyncStatus {
  return {
    state: 'ok',
    trigger: 'alarm',
    started_at: NOW - 5 * 60_000,
    finished_at: NOW - 5 * 60_000,
    signal: 'complete',
    reason: null,
    sent: 412,
    dropped: 0,
    report: { added: 0, updated: 0, marked_ex: 0 },
    error: null,
    last_ok_at: NOW - 5 * 60_000,
    ...over
  } as SyncStatus
}

beforeEach(() => {
  setLanguage('pt-BR')
  sent = []
  consoleLines = []
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      consoleLines.push(args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' '))
    })
  }
  w = makeWorld()
})

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
  flushChrome = true
  render(null, w.root)
  w.root.remove()
  // scan for the token across the whole page and everything that went to the console, in every test
  expect(document.documentElement.outerHTML).not.toContain(TOKEN)
  expect(consoleLines.join('\n')).not.toContain(TOKEN)
  setLanguage('pt-BR')
})

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

// ------------------------------------------------------------------ not paired

describe('not paired', () => {
  it('one sentence about what it is, code field with focus, "where do I find the code?" and advanced', async () => {
    await mount()
    expect(must('conn-state').dataset.state).toBe('unpaired')
    expect(text()).toContain('Conecte este navegador ao Hermes')
    const input = must<HTMLInputElement>('code-input')
    expect(document.activeElement).toBe(input)
    expect(input.getAttribute('inputmode')).toBe('numeric')
    expect(input.getAttribute('autocomplete')).toBe('one-time-code')
    // real label for the screen reader
    const label = w.root.querySelector(`label[for="${input.id}"]`)
    expect(label?.textContent).toMatch(/Código de pareamento/)
    // explanation: Hermes Desktop → plugin page → Connect extension
    const where = must<HTMLDetailsElement>('where-code')
    expect(where.tagName).toBe('DETAILS')
    expect(where.textContent).toMatch(/Hermes Desktop/)
    expect(where.textContent).toMatch(/página do plugin/)
    expect(where.textContent).toMatch(/Conectar extensão/)
    // address only in advanced (closed)
    const adv = must<HTMLDetailsElement>('advanced')
    expect(adv.open).toBe(false)
    expect(adv.contains(must('address-input'))).toBe(true)
    // announced error region
    expect(must('pair-error').getAttribute('aria-live')).toBe('assertive')
  })

  it('5 digits do not submit; the 6th submits by itself and the popup becomes "paired"', async () => {
    await mount()
    await typeCode('48151')
    expect(w.net.requests({ path: '/pair/complete' })).toHaveLength(0)
    expect(must<HTMLButtonElement>('code-submit').disabled).toBe(true)
    await typeCode(CODE)
    await waitFor(() => expect(must('conn-state').dataset.state).toBe('connected'))
    expect(w.net.requests({ path: '/pair/complete' })).toHaveLength(2) // the two PAKE rounds
    expect(must('device-name').textContent).toBe('Chrome — macOS')
    expect(text()).toMatch(/Conectado/)
    // first sync triggered by the background right after pairing
    await waitFor(() => expect(w.syncCalls).toBe(1))
  })

  it.each([
    ['with a space', '481 516'],
    ['with a hyphen', '481-516'],
    ['with surrounding text', 'código 48-15-16']
  ])('pasting the code %s sends only the digits', async (_name, pasted) => {
    await mount()
    await typeCode(pasted, 'insertFromPaste')
    // only the 6 digits make the server confirm (the PAKE fails on any other code)
    await waitFor(() => expect(must('conn-state').dataset.state).toBe('connected'))
    expect(JSON.stringify(w.net.log)).not.toContain(CODE)
  })

  it('paste event (clipboard) works too', async () => {
    await mount()
    const input = must<HTMLInputElement>('code-input')
    await act(async () => {
      const ev = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'clipboardData', { value: { getData: () => ' 481-516 ' } })
      input.dispatchEvent(ev)
    })
    await waitFor(() => expect(must('conn-state').dataset.state).toBe('connected'))
    expect(w.net.requests({ path: '/pair/complete' })).toHaveLength(2)
  })

  it('the field shows only digits, up to 6', async () => {
    await mount()
    await typeCode('4a8-1')
    expect(must<HTMLInputElement>('code-input').value).toBe('481')
  })

  const cases: Array<[string, () => void, RegExp]> = [
    ['invalid_code (3 remaining)', () => failWith('invalid_code', { details: { remaining: 3 } }), /Código errado\. Restam 3 tentativas\./],
    ['invalid_code (1 remaining)', () => failWith('invalid_code', { details: { remaining: 1 } }), /Código errado\. Resta 1 tentativa\./],
    ['invalid_code (no count)', () => failWith('invalid_code'), /Código errado\. Confira os dígitos no Hermes\./],
    ['expired', () => failWith('expired'), /expirou/],
    ['used', () => failWith('used'), /já foi usado/],
    ['locked', () => failWith('locked'), /bloqueado/],
    ['no_active_code', () => (w.server.opts.pairingCode = undefined), /Conectar extensão/],
    ['ext_endpoint_down', () => w.net.down(PORT), /Abra o Hermes e a página do plugin/],
    ['plugin_disabled', () => failWith('plugin_disabled'), /plugin está desligado/],
    ['origin_required', () => failWith('origin_required'), /recusou este navegador/]
  ]

  function failWith(code: string, extra: Record<string, unknown> = {}): void {
    w.server.route('POST /pair/complete', () => ({ status: 400, body: errorBody(code, `server says ${code}`, extra) }))
  }

  it.each(cases)('error %s: own text, announced, and the popup stays unpaired', async (_n, arrange, expected) => {
    arrange()
    await mount()
    await typeCode(CODE)
    await waitFor(() => expect(must('pair-error').textContent).toMatch(expected))
    expect(must('conn-state').dataset.state).toBe('unpaired')
    // the server's raw message (English, technical) does not appear
    expect(text()).not.toMatch(/server says/)
    // error tied to the field
    const input = must<HTMLInputElement>('code-input')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toContain(must('pair-error').id)
  })

  it('wrong code: can be corrected and paired right after; the error goes away', async () => {
    let first = true
    w.server.route('POST /pair/complete', (req) => {
      if (first) {
        first = false
        return { status: 400, body: errorBody('invalid_code', 'x', { details: { remaining: 4 } }) }
      }
      w.server.routes.delete('POST /pair/complete')
      return w.server.handle(req)
    })
    await mount()
    await typeCode('111111')
    await waitFor(() => expect(must('pair-error').textContent).toMatch(/Restam 4/))
    await typeCode('')
    expect(must('pair-error').textContent).toBe('')
    await typeCode(CODE)
    await waitFor(() => expect(must('conn-state').dataset.state).toBe('connected'))
  })

  it('advanced: an invalid address warns and does not submit; a valid one becomes the port used', async () => {
    const custom = 47700
    w.net.down(PORT)
    const other = w.net.addServer(custom, { pairingCode: CODE, issuedToken: TOKEN, deviceId: 'dev_2' })
    other.route('GET /ext/state', () => ({ body: { ok: true, data: EXT_STATE_EXAMPLE } }))
    await mount()
    must<HTMLDetailsElement>('advanced').open = true
    const addr = must<HTMLInputElement>('address-input')
    await act(async () => {
      addr.value = 'http://example.com:1'
      addr.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await typeCode(CODE)
    await waitFor(() => expect(must('address-error').textContent).toMatch(/127\.0\.0\.1/))
    expect(w.net.requests({ path: '/pair/complete' })).toHaveLength(0)

    await act(async () => {
      addr.value = `http://127.0.0.1:${custom}`
      addr.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await click('code-submit')
    await waitFor(() => expect(must('conn-state').dataset.state).toBe('connected'))
    // the port goes as a parameter of pair.submit; the background stores the choice (the field's memory)
    expect(sent.filter((m) => m.type === 'pair.submit').map((m) => m.payload)).toEqual([{ code: CODE, port: custom }])
    expect(chromeFake().storage.get(PAIR_PORT_KEY)).toBe(custom)
    expect(w.net.requests({ path: '/pair/complete' })[0].port).toBe(custom)
  })

  it('advanced empty: pair.submit without a port (automatic discovery)', async () => {
    await mount()
    await typeCode(CODE)
    await waitFor(() => expect(must('conn-state').dataset.state).toBe('connected'))
    expect(sent.filter((m) => m.type === 'pair.submit').map((m) => m.payload)).toEqual([{ code: CODE }])
    expect(chromeFake().storage.has(PAIR_PORT_KEY)).toBe(false)
  })

  it('in English with an English browser', async () => {
    setLanguage('en')
    await mount()
    expect(text()).toContain('Connect this browser to Hermes')
    failWith('invalid_code', { details: { remaining: 2 } })
    await typeCode(CODE)
    await waitFor(() => expect(must('pair-error').textContent).toMatch(/Wrong code\. 2 attempts left\./))
  })
})

// ------------------------------------------------------------------ paired

describe('paired', () => {
  it('device name, connection state, last sync (when, how many, signal)', async () => {
    await seedConnected({ [STORAGE_KEYS.syncStatus]: syncStatus({}) })
    await mount()
    expect(must('conn-state').dataset.state).toBe('connected')
    expect(must('device-name').textContent).toBe('Chrome — macOS')
    expect(text()).toMatch(/Conectado/)
    const summary = must('sync-summary').textContent ?? ''
    expect(summary).toMatch(/há 5 minutos/)
    expect(summary).toMatch(/412 canais/)
    expect(summary).toMatch(/lista completa/)
    // the port stays only in the details (technical text out of view)
    expect(must('conn-state').textContent).toContain(String(PORT))
  })

  it('no sync yet', async () => {
    await seedConnected()
    await mount()
    expect(must('sync-summary').textContent).toMatch(/Ainda não sincronizado/)
  })

  it('partial with the reason in plain language', async () => {
    await seedConnected({ [STORAGE_KEYS.syncStatus]: syncStatus({ signal: 'partial', reason: 'missing_ids', sent: 37 }) })
    await mount()
    const s = must('sync-summary').textContent ?? ''
    expect(s).toMatch(/37 canais/)
    expect(s).toMatch(/parcial/)
    expect(s).toMatch(/não foram identificados/)
    expect(s).not.toMatch(/missing_ids/)
  })

  it('"needs a visible sync" (needs_visible)', async () => {
    await seedConnected({
      [STORAGE_KEYS.syncStatus]: syncStatus({ signal: 'partial', reason: 'scroll_stalled', sent: 40, needs_visible: true })
    })
    await mount()
    const s = must('sync-summary').textContent ?? ''
    expect(s).toMatch(/Precisa de uma sincronização visível/)
    expect(s).toMatch(/Sincronizar agora/)
  })

  it('last sync failure: reason + when it last worked', async () => {
    await seedConnected({
      [STORAGE_KEYS.syncStatus]: syncStatus({
        state: 'error',
        signal: null,
        sent: 0,
        error: { code: 'tab_timeout', message: 'x' },
        finished_at: NOW - 60_000,
        last_ok_at: NOW - 2 * 86_400_000
      })
    })
    await mount()
    const s = must('sync-summary').textContent ?? ''
    expect(s).toMatch(/O YouTube demorou demais/)
    expect(s).toMatch(/anteontem|há 2 dias/)
  })

  it('Sync now: sends sync.now and shows progress', async () => {
    await seedConnected({ [STORAGE_KEYS.syncStatus]: syncStatus({}) })
    await mount()
    expect(w.syncCalls).toBe(0)
    await click('sync-now')
    expect(w.syncCalls).toBe(1)
    await waitFor(() => expect(must('sync-progress').textContent).toMatch(/Lendo suas inscrições/))
    expect(must<HTMLButtonElement>('sync-now').disabled).toBe(true)
    expect(must('sync-progress').getAttribute('role')).toBe('status')

    // finished (the sync module writes the status): progress goes away, new summary appears
    await act(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.syncStatus]: syncStatus({ sent: 413, finished_at: NOW, last_ok_at: NOW }) })
    })
    await waitFor(() => expect(q('sync-progress')).toBeNull())
    expect(must('sync-summary').textContent).toMatch(/413 canais/)
    expect(must<HTMLButtonElement>('sync-now').disabled).toBe(false)
  })

  it('sync in progress when the popup opens', async () => {
    await seedConnected({ [STORAGE_KEYS.syncStatus]: syncStatus({ state: 'running', finished_at: null, started_at: NOW - 12_000 }) })
    await mount()
    expect(must('sync-progress').textContent).toMatch(/Lendo suas inscrições/)
  })

  it('open in Hermes: opens the Desktop link in a tab', async () => {
    await seedConnected()
    await mount()
    await click('open-hermes')
    const urls = [...chromeFake().tabs.values()].map((t) => t.url)
    expect(urls).toHaveLength(1)
    expect(urls[0]).toMatch(/^hermes:\/\/open\//)
  })

  it('Disconnect asks for confirmation; Cancel does nothing; Esc also cancels', async () => {
    await seedConnected()
    await mount()
    await click('disconnect')
    const dialog = must('disconnect-confirm')
    expect(dialog.getAttribute('role')).toBe('alertdialog')
    // focus goes to the safe button
    expect(document.activeElement).toBe(must('disconnect-cancel'))
    await click('disconnect-cancel')
    expect(q('disconnect-confirm')).toBeNull()
    expect(document.activeElement).toBe(must('disconnect'))

    await click('disconnect')
    await act(async () => {
      must('disconnect-confirm').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await settle()
    expect(q('disconnect-confirm')).toBeNull()
    expect(w.net.requests({ path: '/ext/unpair' })).toHaveLength(0)
    expect(chromeFake().storage.has(STORAGE_KEYS.connection)).toBe(true)
  })

  it('Disconnect confirmed: /ext/unpair, local storage empty, alarms erased, back to the code', async () => {
    await seedConnected({ [STORAGE_KEYS.syncStatus]: syncStatus({}), [STORAGE_KEYS.watchOutbox]: [] })
    await chrome.alarms.create(ALARMS.state, { periodInMinutes: 0.5 })
    await chrome.alarms.create(ALARMS.sync, { periodInMinutes: 360 })
    await mount()
    await click('disconnect')
    await click('disconnect-yes')
    await waitFor(() => expect(must('conn-state').dataset.state).toBe('unpaired'))
    expect(w.net.requests({ path: '/ext/unpair' })).toHaveLength(1)
    expect([...chromeFake().storage.keys()]).toEqual([])
    expect(chromeFake().alarms.size).toBe(0)
    expect(document.activeElement).toBe(must('code-input'))
  })
})

// ------------------------------------------------------------------ problem

describe('problem', () => {
  it('Hermes closed (reconnect_needed): "open Hermes" and try again', async () => {
    await seedConnected({}, { state: 'reconnect_needed' })
    w.net.down(PORT)
    await mount()
    expect(must('conn-state').dataset.state).toBe('reconnect_needed')
    const p = must('problem')
    expect(p.textContent).toMatch(/O Hermes está fechado/)
    expect(p.textContent).toMatch(/Abra o Hermes e a página do plugin/)
    expect(p.getAttribute('role')).toBe('alert')
    // back: trying again probes and changes state
    w.net.addServer(PORT, { token: TOKEN }).route('GET /ext/state', () => ({ body: { ok: true, data: { ...EXT_STATE_EXAMPLE, queue_pending: 0 } } }))
    await click('problem-retry')
    await waitFor(() => expect(must('conn-state').dataset.state).toBe('connected'))
  })

  it('Hermes closed: the device card does not say "Hermes responded just now" (contradiction)', async () => {
    await seedConnected({}, { state: 'reconnect_needed', last_ok_at: NOW - 10_000 })
    w.net.down(PORT)
    await mount()
    expect(must('conn-state').dataset.state).toBe('reconnect_needed')
    expect(text()).not.toMatch(/agora mesmo/)
    expect(text()).not.toMatch(/Hermes respondeu/)
  })

  it('Hermes closed for a while: "Hermes last responded X ago"', async () => {
    await seedConnected({}, { state: 'reconnect_needed', last_ok_at: NOW - 5 * 60_000 })
    w.net.down(PORT)
    await mount()
    expect(text()).toMatch(/Última resposta do Hermes há 5 minutos/)
    expect(text()).not.toMatch(/Hermes respondeu/)
  })

  it('connected keeps saying "Hermes responded …" (including "just now")', async () => {
    await seedConnected()
    await mount(Date.now) // the probe writes last_ok_at with the real clock
    expect(must('conn-state').dataset.state).toBe('connected')
    expect(text()).toMatch(/Hermes respondeu agora mesmo/)
  })

  it('token refused (unauthorized): "pair again" leads to the code, with no token stored', async () => {
    await seedConnected({}, { state: 'unauthorized', error: { code: 'unauthorized', message: 'invalid token' } })
    w.server.opts.token = 'outro'
    await mount()
    expect(must('conn-state').dataset.state).toBe('unauthorized')
    expect(must('problem').textContent).toMatch(/não reconhece mais este navegador/)
    await click('pair-again')
    await waitFor(() => expect(must('conn-state').dataset.state).toBe('unpaired'))
    expect(chromeFake().storage.has(STORAGE_KEYS.connection)).toBe(false)
    expect(document.activeElement).toBe(must('code-input'))
  })

  it('not logged in to YouTube: explains and offers to open YouTube and sync again', async () => {
    await seedConnected({
      [STORAGE_KEYS.syncStatus]: syncStatus({ state: 'error', signal: null, sent: 0, reason: 'logged_out', error: { code: 'nothing_to_send', message: 'logged_out' } })
    })
    await mount()
    const p = must('problem')
    expect(p.textContent).toMatch(/Entre no YouTube/)
    await click('open-youtube')
    expect([...chromeFake().tabs.values()].map((t) => t.url)).toEqual(['https://www.youtube.com/'])
    await click('sync-now')
    expect(w.syncCalls).toBe(1)
    // disconnecting is still possible
    expect(q('disconnect')).not.toBeNull()
  })

  it('logged_out error straight from the sync module is also "not logged in"', async () => {
    await seedConnected({ [STORAGE_KEYS.syncStatus]: syncStatus({ state: 'error', signal: null, sent: 0, error: { code: 'logged_out', message: 'x' } }) })
    await mount()
    expect(must('problem').textContent).toMatch(/Entre no YouTube/)
  })

  it('another connection error (plugin turned off)', async () => {
    await seedConnected({}, { state: 'error', error: { code: 'plugin_disabled', message: 'plugin disabled' } })
    w.server.route('GET /ext/state', () => ({ status: 503, body: errorBody('plugin_disabled', 'plugin disabled') }))
    await mount()
    expect(must('conn-state').dataset.state).toBe('error')
    expect(must('problem').textContent).toMatch(/plugin está desligado/)
  })
})

// ------------------------------------------------------------------ unsubscribe queue

const uc = (n: number) => `UC${String(n).padStart(22, 'p')}`

function progress(over: Partial<QueueProgress> = {}): QueueProgress {
  return {
    state: 'idle',
    action: 'unsubscribe',
    index: 0,
    total: 0,
    channel_id: null,
    channel_title: null,
    done: 0,
    failed: 0,
    last: null,
    consecutive_failures: 0,
    hold_reason: null,
    hold_until: null,
    started_at: NOW - 10 * 60_000,
    updated_at: NOW - 60_000,
    message: 'TEXTO_DO_SW',
    tab_id: null,
    origin_tab_id: null,
    current: null,
    ...over
  }
}

/** fake `queue.stop`/`queue.resume`: only record. */
function queueRecorder(calls: string[]): BackgroundModule {
  return {
    MODULE: 'background/queue',
    ROUTES: [],
    REAL_ROUTES: [],
    MESSAGES: ['queue.stop', 'queue.resume'],
    register(ctx) {
      ctx.router.on('queue.stop', () => {
        calls.push('stop')
        return null
      })
      ctx.router.on('queue.resume', () => {
        calls.push('resume')
        return null
      })
    }
  }
}

const QUEUE_KEYS: string[] = [STORAGE_KEYS.queueRun, STORAGE_KEYS.queueCtl, STORAGE_KEYS.queueLedger]

/** spies on writes to chrome.storage.local that touch the queue keys */
function spyQueueWrites(): () => string[] {
  const local = chrome.storage.local as unknown as Record<'set' | 'remove' | 'clear', (...a: unknown[]) => Promise<void>>
  const writes: string[] = []
  for (const m of ['set', 'remove', 'clear'] as const) {
    const orig = local[m]
    local[m] = (...args: unknown[]) => {
      const keys = m === 'clear' ? ['*'] : m === 'set' ? Object.keys(args[0] as object) : ([] as string[]).concat(args[0] as string | string[])
      for (const k of keys) if (k === '*' || QUEUE_KEYS.includes(k)) writes.push(`${m}:${k}`)
      return orig(...args)
    }
  }
  return () => writes
}

describe('unsubscribe queue: the card', () => {
  it('no queue (nothing stored, or an empty round) → the card does not appear', async () => {
    await seedConnected()
    await mount()
    expect(q('queue-card')).toBeNull()
    await act(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.queueRun]: progress({ state: 'idle', done: 0, failed: 0 }) })
    })
    await settle()
    expect(q('queue-card')).toBeNull()
  })

  it('in progress: "Unsubscribing 2 of 5 · <channel>" + Stop (no Resume)', async () => {
    await seedConnected({
      [STORAGE_KEYS.queueRun]: progress({ state: 'running', index: 2, total: 5, channel_id: uc(2), channel_title: 'Canal Dois' })
    })
    await mount()
    const card = must('queue-card')
    expect(card.dataset.state).toBe('running')
    expect(card.textContent).toMatch(/Cancelando 2 de 5 · Canal Dois/)
    expect(card.textContent).not.toMatch(/TEXTO_DO_SW/)
    expect(must('queue-stop').textContent).toMatch(/Parar/)
    expect(q('queue-resume')).toBeNull()
    // progress is announced without stealing focus
    expect(must('queue-line').getAttribute('aria-live')).toBe('polite')
  })

  it('resubscribing: "Resubscribing 1 of 2 · <channel>"; without a title it uses the channel id', async () => {
    await seedConnected({ [STORAGE_KEYS.queueRun]: progress({ state: 'running', action: 'resubscribe', index: 1, total: 2, channel_title: 'Canal Um' }) })
    await mount()
    expect(must('queue-card').textContent).toMatch(/Reinscrevendo 1 de 2 · Canal Um/)
    await act(async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.queueRun]: progress({ state: 'running', index: 1, total: 2, channel_id: uc(1), channel_title: null }) })
    })
    await settle()
    expect(must('queue-card').textContent).toContain(`Cancelando 1 de 2 · ${uc(1)}`)
  })

  it('stopped: "Queue stopped · 3 remaining" + Resume (server count, newer than the round)', async () => {
    rebuild({ queuePending: 3 })
    await seedConnected({
      [STORAGE_KEYS.queueRun]: progress({ state: 'stopped', index: 2, total: 5, done: 2 }),
      [STORAGE_KEYS.queueCtl]: { stopped: true, by: 'popup', at: NOW - 60_000 }
    })
    await mount()
    const card = must('queue-card')
    expect(card.dataset.state).toBe('stopped')
    expect(card.textContent).toMatch(/Fila parada · 3 restantes/)
    expect(card.textContent).toMatch(/Nada mais é alterado até você retomar/)
    expect(must('queue-resume').textContent).toMatch(/Retomar/)
    expect(q('queue-stop')).toBeNull()
  })

  it('stopped without a new server count: estimates from the round progress (5 − 4 = 1 remaining)', async () => {
    w.server.route('GET /ext/state', () => ({ status: 500, body: errorBody('internal', 'x') }))
    await seedConnected({ [STORAGE_KEYS.queueRun]: progress({ state: 'stopped', index: 4, total: 5 }) })
    await mount()
    expect(must('queue-card').textContent).toMatch(/Fila parada · 1 restante(?!s)/)
  })

  it('stopped because the queue tab was closed: says so', async () => {
    await seedConnected({
      [STORAGE_KEYS.queueRun]: progress({ state: 'stopped', index: 1, total: 3 }),
      [STORAGE_KEYS.queueCtl]: { stopped: true, by: 'tab', at: NOW - 60_000 }
    })
    await mount()
    expect(must('queue-card').textContent).toMatch(/aba da fila foi fechada/)
  })

  it.each([
    ['logged_out', /Entre na sua conta do YouTube/, /saiu da conta do YouTube|fora da conta/i],
    ['challenge', /resolva a verificação/, /verificação do YouTube/i],
    ['failures', /A confirmação do YouTube não apareceu/, /duas falhas seguidas/i]
  ] as const)('held (%s): human reason, what to do and "Try again"', async (reason, what, title) => {
    await seedConnected({
      [STORAGE_KEYS.queueRun]: progress({
        state: 'paused',
        hold_reason: reason,
        hold_until: NOW + 3600_000,
        index: 2,
        total: 4,
        failed: 2,
        consecutive_failures: 2,
        last: { queue_id: 'q_2', status: 'failed', error: reason === 'failures' ? 'confirm_not_found' : reason }
      })
    })
    await mount()
    const card = must('queue-card')
    expect(card.dataset.state).toBe('held')
    expect(card.textContent).toMatch(title)
    expect(card.textContent).toMatch(what)
    expect(card.textContent).toMatch(/Tenta sozinha em 1 hora/)
    expect(must('queue-retry').textContent).toMatch(/Tentar de novo/)
    expect(card.textContent).not.toMatch(/logged_out|challenge|confirm_not_found|TEXTO_DO_SW/)
  })

  it('held for leaving YouTube: "Open YouTube" opens the page', async () => {
    await seedConnected({ [STORAGE_KEYS.queueRun]: progress({ state: 'paused', hold_reason: 'logged_out', hold_until: NOW + 3600_000 }) })
    await mount()
    await click('queue-open-youtube')
    expect([...chromeFake().tabs.values()].map((t) => t.url)).toEqual(['https://www.youtube.com/'])
  })

  it('cap pause (20 per round): "Continue now"', async () => {
    await seedConnected({ [STORAGE_KEYS.queueRun]: progress({ state: 'paused', hold_reason: 'cap', hold_until: NOW + 5 * 60_000, done: 20, index: 20, total: 20 }) })
    await mount()
    expect(must('queue-card').textContent).toMatch(/Pausa depois de 20 canais/)
    expect(must('queue-retry').textContent).toMatch(/Continuar agora/)
  })

  it('finished: "3 unsubscribed · 1 failed" with the readable reason of each failure in this round', async () => {
    await seedConnected({
      [STORAGE_KEYS.queueRun]: progress({ state: 'idle', done: 3, failed: 2, index: 5, total: 5, last: { queue_id: 'q_5', status: 'failed', error: 'timeout' } }),
      [STORAGE_KEYS.queueLedger]: {
        q_0: { status: 'failed', error: 'challenge', reported: true, at: NOW - 3 * 86_400_000 }, // old round: excluded
        q_1: { status: 'done', error: null, reported: true, at: NOW - 9 * 60_000 },
        q_2: { status: 'failed', error: 'wrong_channel', reported: true, at: NOW - 8 * 60_000 },
        q_3: { status: 'done', error: 'not_subscribed', reported: true, at: NOW - 7 * 60_000 },
        q_4: { status: 'done', error: null, reported: true, at: NOW - 6 * 60_000 },
        q_5: { status: 'failed', error: 'timeout', reported: true, at: NOW - 5 * 60_000 },
        q_6: { status: 'skipped', error: 'conflict', reported: true, at: NOW - 5 * 60_000 }
      }
    })
    await mount()
    const card = must('queue-card')
    expect(card.dataset.state).toBe('done')
    expect(card.textContent).toMatch(/3 canceladas · 2 falharam/)
    const fails = must('queue-failures').textContent ?? ''
    expect(fails).toMatch(/A página aberta não era deste canal/)
    expect(fails).toMatch(/O YouTube demorou demais/)
    expect(fails).not.toMatch(/verificação/) // the failure from the old round does not count
    expect(fails).not.toMatch(/wrong_channel|timeout|conflict/)
    expect(q('queue-stop')).toBeNull()
    expect(q('queue-resume')).toBeNull()
  })

  it('finished with no failures, singular: "1 unsubscribed"', async () => {
    await seedConnected({ [STORAGE_KEYS.queueRun]: progress({ state: 'idle', done: 1, failed: 0, index: 1, total: 1 }) })
    await mount()
    expect(must('queue-card').textContent).toMatch(/1 cancelada(?!s)/)
    expect(q('queue-failures')).toBeNull()
  })

  it('finished more than a day ago: the card disappears', async () => {
    await seedConnected({ [STORAGE_KEYS.queueRun]: progress({ state: 'idle', done: 3, updated_at: NOW - 2 * 86_400_000 }) })
    await mount()
    expect(q('queue-card')).toBeNull()
  })

  it('live: the card follows queue_run (storage.onChanged)', async () => {
    await seedConnected({ [STORAGE_KEYS.queueRun]: progress({ state: 'running', index: 1, total: 3, channel_title: 'A' }) })
    await mount()
    expect(must('queue-card').textContent).toMatch(/Cancelando 1 de 3 · A/)
    const set = async (v: QueueProgress) => {
      await act(async () => {
        await chrome.storage.local.set({ [STORAGE_KEYS.queueRun]: v })
      })
      await settle()
    }
    await set(progress({ state: 'running', index: 2, total: 3, channel_title: 'B', done: 1 }))
    expect(must('queue-card').textContent).toMatch(/Cancelando 2 de 3 · B/)
    await set(progress({ state: 'idle', index: 3, total: 3, done: 3, updated_at: NOW }))
    expect(must('queue-card').textContent).toMatch(/3 canceladas/)
    await act(async () => {
      await chrome.storage.local.remove(STORAGE_KEYS.queueRun)
    })
    await settle()
    expect(q('queue-card')).toBeNull()
  })

  it('the card also appears with Hermes closed (Stop always at hand)', async () => {
    await seedConnected({ [STORAGE_KEYS.queueRun]: progress({ state: 'running', index: 1, total: 2, channel_title: 'A' }) }, { state: 'reconnect_needed' })
    w.net.down(PORT)
    await mount()
    expect(must('conn-state').dataset.state).toBe('reconnect_needed')
    expect(q('queue-stop')).not.toBeNull()
  })
})

describe('unsubscribe queue: Stop and Resume', () => {
  it('Stop and Resume only send queue.stop / queue.resume — the popup never writes to the queue storage', async () => {
    const calls: string[] = []
    rebuild({ modules: [queueRecorder(calls)] })
    await seedConnected({ [STORAGE_KEYS.queueRun]: progress({ state: 'running', index: 1, total: 3, channel_title: 'A' }) })
    await mount()
    const writes = spyQueueWrites()
    sent = []
    await click('queue-stop')
    expect(calls).toEqual(['stop'])
    expect(sent).toEqual([{ type: 'queue.stop', payload: {} }])
    // until the executor finishes the current item: "stopping…", no button to click again
    expect(must('queue-card').dataset.state).toBe('stopping')
    expect(must('queue-card').textContent).toMatch(/Parando depois do canal atual/)

    // (the real background writes; here the test plays its role)
    await writeAsBackground({
      [STORAGE_KEYS.queueCtl]: { stopped: true, by: 'popup', at: NOW },
      [STORAGE_KEYS.queueRun]: progress({ state: 'stopped', index: 1, total: 3, done: 1 })
    })
    expect(must('queue-card').dataset.state).toBe('stopped')
    sent = []
    await click('queue-resume')
    expect(calls).toEqual(['stop', 'resume'])
    expect(sent).toEqual([{ type: 'queue.resume', payload: {} }])
    expect(must('queue-card').dataset.state).toBe('resuming')
    expect(writes()).toEqual([])
  })

  it('"Try again" (held queue) is also just queue.resume', async () => {
    const calls: string[] = []
    rebuild({ modules: [queueRecorder(calls)] })
    await seedConnected({ [STORAGE_KEYS.queueRun]: progress({ state: 'paused', hold_reason: 'challenge', hold_until: NOW + 3600_000 }) })
    await mount()
    const writes = spyQueueWrites()
    sent = []
    await click('queue-retry')
    expect(calls).toEqual(['resume'])
    expect(sent.map((m) => m.type)).toEqual(['queue.resume'])
    expect(writes()).toEqual([])
  })

  it('the popup has no path that creates, chooses or approves a queue item', async () => {
    const src = await popupSources()
    const all = Object.values(src).join('\n')
    // messages the popup sends: only these (no queue.execute, nothing that approves)
    const types = new Set([...all.matchAll(/sendRequest\(\s*'([\w.]+)'/g)].map((m) => m[1]))
    expect([...types].sort()).toEqual(['conn.status', 'pair.submit', 'pair.unpair', 'queue.resume', 'queue.stop', 'sync.now'])
    expect(all).not.toMatch(/queue\.execute|\/ext\/queue|approve|requestQueueStop|resumeQueue|sendTabCommand|runtime\.sendMessage/)
    // no direct writes to storage (the background is the one that writes)
    expect(all).not.toMatch(/storage\.local\.(set|remove|clear)\b/)
    expect(all).not.toMatch(/from '\.\.\/background\/queue'/)
    // `needs_visible` comes from the shared type (without the local SyncView)
    expect(all).not.toMatch(/SyncView/)
  })
})

describe('unsubscribe queue: with the real executor', () => {
  /** fake queue server: one `approved` at a time, none while there is a `running` */
  function queueWorld(ids: number[], opts: { pending?: () => number } = {}) {
    const items = new Map(ids.map((n) => [`q_${n}`, { n, status: 'approved' as string }]))
    const seq: string[] = []
    const pending = () => opts.pending?.() ?? [...items.values()].filter((i) => i.status === 'approved').length
    rebuild({ modules: [createQueueModule({ sleep: async () => undefined })] })
    w.server.route('GET /ext/state', () => ({ body: { ok: true, data: { ...EXT_STATE_EXAMPLE, queue_pending: pending(), language: 'pt-BR' } } }))
    const queueItem = (id: string, n: number): QueueItem => ({
      id,
      channel_id: uc(n),
      action: 'unsubscribe',
      status: 'approved',
      approved_at: 1762700000,
      approved_via: 'desktop_rpc',
      created_at: 1762700000,
      updated_at: 1762700000,
      reason: null,
      error: null,
      device_id: null
    })
    w.server.route('GET /ext/queue', (req) => {
      if (req.query.peek === '1') {
        // the listing for "Run now": nothing is lent
        const all = [...items.entries()].filter(([, i]) => i.status === 'approved')
        const channels = Object.fromEntries(all.map(([, i]) => [uc(i.n), { id: uc(i.n), title: `Canal ${i.n}`, url: null, handle: null }]))
        return { body: { ok: true, data: { items: all.map(([id, i]) => queueItem(id, i.n)), channels } } }
      }
      const running = [...items.values()].some((i) => i.status === 'running')
      const next = running ? undefined : [...items.entries()].find(([, i]) => i.status === 'approved')
      seq.push(`get:${next ? next[0] : '-'}`)
      if (!next) return { body: { ok: true, data: { items: [], channels: {} } } }
      const [id, it] = next
      const item: QueueItem = {
        id,
        channel_id: uc(it.n),
        action: 'unsubscribe',
        status: 'approved',
        approved_at: 1762700000,
        approved_via: 'desktop_rpc',
        created_at: 1762700000,
        updated_at: 1762700000,
        reason: null,
        error: null,
        device_id: null
      }
      return { body: { ok: true, data: { items: [item], channels: { [uc(it.n)]: { id: uc(it.n), title: `Canal ${it.n}`, url: null, handle: null } } } } }
    })
    w.server.route('POST /ext/queue/{id}/result', (req, params) => {
      const it = items.get(params.id)
      if (!it) return { status: 404, body: errorBody('not_found') }
      it.status = (req.body as { status: string }).status
      seq.push(`${it.status}:${params.id}`)
      return { body: { ok: true, data: { id: params.id, status: it.status } } }
    })
    let gate: Promise<void> | null = null
    const executed: string[] = []
    chromeFake().tabResponder = async (_tab, msg) => {
      const m = msg as { type: string; payload: { queue_id: string } }
      if (m.type !== 'queue.execute') return errorBody('not_found')
      executed.push(m.payload.queue_id)
      seq.push(`exec:${m.payload.queue_id}`)
      if (gate) await gate
      return { ok: true, data: { status: 'done', error: null } }
    }
    return {
      items,
      seq,
      executed,
      hold() {
        let release!: () => void
        gate = new Promise<void>((r) => (release = r))
        const open = () => {
          gate = null
          release()
        }
        cleanups.push(open)
        return open
      }
    }
  }

  /** every executed item came from an earlier GET /ext/queue that delivered it */
  function everyExecFollowsItsGet(seq: string[]): void {
    seq.forEach((s, i) => {
      if (!s.startsWith('exec:')) return
      const id = s.slice(5)
      expect(seq.slice(0, i), `${id} executed without a GET /ext/queue before`).toContain(`get:${id}`)
    })
  }

  it('Stop in the middle of an item → finishes the item and nothing else runs → Resume → the rest finishes', async () => {
    const qw = queueWorld([1, 2, 3])
    const release = qw.hold()
    flushChrome = false // item 1 stays "on the page" until the test releases it
    await seedConnected()
    await mount()
    // approved in Hermes is not enough: the card asks first
    await waitFor(() => expect(must('queue-card').dataset.state).toBe('waiting'))
    expect(qw.executed).toEqual([])
    await click('queue-run-now')
    await waitFor(() => expect(qw.executed).toEqual(['q_1']))
    await waitFor(() => expect(must('queue-card').textContent).toMatch(/Cancelando 1 de 3 · Canal 1/))
    await click('queue-stop')
    expect((chromeFake().storage.get(STORAGE_KEYS.queueCtl) as { by: string }).by).toBe('popup')
    release()
    flushChrome = true
    await waitFor(() => expect(must('queue-card').dataset.state).toBe('stopped'))
    expect(qw.executed).toEqual(['q_1'])
    // new ExtStates (30 s alarm) do not move the queue
    for (let i = 0; i < 3; i++) await act(async () => void (await chrome.runtime.sendMessage({ type: 'state.get', payload: { refresh: true } })))
    await settle()
    expect(qw.executed).toEqual(['q_1'])
    expect(must('queue-card').textContent).toMatch(/Fila parada · 2 restantes/)

    await click('queue-resume')
    await waitFor(() => expect(qw.executed).toEqual(['q_1', 'q_2', 'q_3']))
    await waitFor(() => expect(must('queue-card').dataset.state).toBe('done'))
    expect(must('queue-card').textContent).toMatch(/2 canceladas/)
    expect(chromeFake().storage.has(STORAGE_KEYS.queueCtl)).toBe(false)
    everyExecFollowsItsGet(qw.seq)
    expect([...qw.items.values()].map((i) => i.status)).toEqual(['done', 'done', 'done'])
  })

  it('Resume with nothing approved on the server runs nothing — not even the item stored in storage', async () => {
    const qw = queueWorld([], { pending: () => 0 })
    await seedConnected({
      [STORAGE_KEYS.queueCtl]: { stopped: true, by: 'popup', at: NOW - 60_000 },
      [STORAGE_KEYS.queueRun]: progress({
        state: 'stopped',
        index: 1,
        total: 3,
        channel_id: uc(7),
        last: { queue_id: 'q_7', status: 'done', error: null },
        current: { queue_id: 'q_8', channel_id: uc(8), action: 'unsubscribe', phase: 'claimed', started_at: NOW - 60_000 }
      })
    })
    await mount()
    await click('queue-resume')
    await settle()
    await settle()
    expect(qw.executed).toEqual([])
    expect(chromeFake().tabMessages).toEqual([])
    expect(chromeFake().tabs.size).toBe(0)
    expect(chromeFake().storage.has(STORAGE_KEYS.queueCtl)).toBe(false)
  })

  it('Resume: what runs is only what GET /ext/queue delivers, in order, one at a time', async () => {
    const qw = queueWorld([4, 5])
    await seedConnected({
      [STORAGE_KEYS.queueCtl]: { stopped: true, by: 'overlay', at: NOW - 60_000 },
      [STORAGE_KEYS.queueRun]: progress({ state: 'stopped', index: 1, total: 3, last: { queue_id: 'q_3', status: 'failed', error: 'stopped' } })
    })
    await mount()
    // stopped: opening the popup (which probes the state) does not make the queue move
    expect(qw.executed).toEqual([])
    expect(qw.seq.filter((s) => s.startsWith('get:'))).toEqual([])
    // the approved items wait for the click: Run now also lifts the stop
    await waitFor(() => expect(must('queue-card').dataset.state).toBe('waiting'))
    await click('queue-run-now')
    await waitFor(() => expect(qw.executed).toEqual(['q_4', 'q_5']))
    everyExecFollowsItsGet(qw.seq)
    expect(qw.seq.filter((s) => !s.startsWith('get:-'))).toEqual(['get:q_4', 'running:q_4', 'exec:q_4', 'done:q_4', 'get:q_5', 'running:q_5', 'exec:q_5', 'done:q_5'])
  })
})

describe('unsubscribe queue: "Run now" before each round', () => {
  function waitingSeed(n: number, action: 'unsubscribe' | 'resubscribe' = 'unsubscribe') {
    return Array.from({ length: n }, (_, i) => ({ id: `q_${i + 1}`, channel_id: uc(i + 1), channel_title: `Canal ${i + 1}`, action }))
  }

  it('approved items waiting: the count, the channels, Run now and Not now (pt-BR)', async () => {
    rebuild({ modules: [queueRecorder([])], queuePending: 7 })
    await seedConnected()
    await chrome.storage.session.set({ [QUEUE_WAITING_KEY]: { items: waitingSeed(7), at: Date.now() } })
    await mount()
    const card = must('queue-card')
    expect(card.dataset.state).toBe('waiting')
    expect(must('queue-line').textContent).toBe('7 cancelamentos aprovados estão esperando')
    const list = must('queue-waiting-list').textContent ?? ''
    expect(list).toContain('Canal 1')
    expect(list).toContain('Canal 5')
    expect(list).not.toContain('Canal 6')
    expect(list).toContain('e mais 2')
    expect(must('queue-run-now').textContent).toBe('Executar agora')
    expect(must('queue-not-now').textContent).toBe('Agora não')
  })

  it('Run now writes exactly the listed ids to session storage and only asks for queue.resume', async () => {
    const calls: string[] = []
    rebuild({ modules: [queueRecorder(calls)], queuePending: 2 })
    await seedConnected()
    await chrome.storage.session.set({ [QUEUE_WAITING_KEY]: { items: waitingSeed(2), at: Date.now() } })
    const writes = spyQueueWrites()
    await mount()
    sent = []
    await click('queue-run-now')
    expect((chromeFake().session.get(QUEUE_RELEASE_KEY) as { ids: string[] }).ids).toEqual(['q_1', 'q_2'])
    expect(sent.map((m) => m.type)).toEqual(['queue.resume'])
    expect(calls).toEqual(['resume'])
    expect(writes()).toEqual([])
    await waitFor(() => expect(q('queue-run-now')).toBeNull())
  })

  it('Not now: nothing is released, the card goes away; a new approved item brings it back', async () => {
    rebuild({ modules: [queueRecorder([])], queuePending: 1 })
    await seedConnected()
    await chrome.storage.session.set({ [QUEUE_WAITING_KEY]: { items: waitingSeed(1), at: Date.now() } })
    await mount()
    await click('queue-not-now')
    expect(chromeFake().session.has(QUEUE_RELEASE_KEY)).toBe(false)
    await waitFor(() => expect(q('queue-card')).toBeNull())
    await act(async () => {
      await chrome.storage.session.set({ [QUEUE_WAITING_KEY]: { items: waitingSeed(2), at: Date.now() } })
    })
    await waitFor(() => expect(must('queue-line').textContent).toBe('1 cancelamento aprovado está esperando'))
  })

  it('a resubscribe in the list changes the heading and is labelled', async () => {
    rebuild({ modules: [queueRecorder([])], queuePending: 1 })
    await seedConnected()
    await chrome.storage.session.set({ [QUEUE_WAITING_KEY]: { items: waitingSeed(1, 'resubscribe'), at: Date.now() } })
    await mount()
    expect(must('queue-line').textContent).toBe('1 alteração aprovada está esperando')
    expect(must('queue-waiting-list').textContent).toBe('Reinscrever: Canal 1')
  })

  it('with the real executor: nothing runs until Run now, then only the listed items', async () => {
    rebuild({ modules: [createQueueModule({ sleep: async () => undefined })] })
    const executed: string[] = []
    const items = new Map([['q_1', 'approved'], ['q_2', 'approved']])
    const mk = (id: string): QueueItem => ({
      id,
      channel_id: uc(Number(id.slice(2))),
      action: 'unsubscribe',
      status: 'approved',
      approved_at: 1762700000,
      approved_via: 'desktop_rpc',
      created_at: 1762700000,
      updated_at: 1762700000,
      reason: null,
      error: null,
      device_id: null
    })
    const approved = () => [...items].filter(([, s]) => s === 'approved').map(([id]) => id)
    w.server.route('GET /ext/state', () => ({ body: { ok: true, data: { ...EXT_STATE_EXAMPLE, queue_pending: approved().length, language: 'pt-BR' } } }))
    w.server.route('GET /ext/queue', (req) => {
      const ids = req.query.peek === '1' ? approved() : approved().slice(0, 1)
      return { body: { ok: true, data: { items: ids.map(mk), channels: {} } } }
    })
    w.server.route('POST /ext/queue/{id}/result', (req, params) => {
      items.set(params.id, (req.body as { status: string }).status)
      return { body: { ok: true, data: { id: params.id } } }
    })
    chromeFake().tabResponder = async (_tab, msg) => {
      const m = msg as { type: string; payload: { queue_id: string } }
      executed.push(m.payload.queue_id)
      return { ok: true, data: { status: 'done', error: null } }
    }
    await seedConnected()
    await mount()
    for (let i = 0; i < 3; i++) await act(async () => void (await chrome.runtime.sendMessage({ type: 'state.get', payload: { refresh: true } })))
    await settle()
    expect(executed).toEqual([])
    await waitFor(() => expect(must('queue-card').dataset.state).toBe('waiting'))
    expect(chromeFake().badge.text).toBe('2')
    // approved after the list was shown: not part of this click
    items.set('q_3', 'approved')
    await click('queue-run-now')
    await waitFor(() => expect(executed).toEqual(['q_1', 'q_2']))
    await settle()
    expect(executed).toEqual(['q_1', 'q_2'])
    await waitFor(() => expect(must('queue-line').textContent).toBe('1 cancelamento aprovado está esperando'))
  })
})

describe('texts', () => {
  it('popup keys equal in EN and PT-BR; every queue failure reason has a text', () => {
    const en = catalog('en', 'popup')
    const pt = catalog('pt-BR', 'popup')
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort())
    for (const r of ['button_not_found', 'confirm_not_found', 'state_unchanged', 'wrong_channel', 'logged_out', 'challenge', 'timeout', 'stopped', 'interrupted', 'tab_closed', 'invalid_item', 'page_error', 'other']) {
      expect(en[`queue_reason_${r}`], r).toBeTruthy()
      expect(pt[`queue_reason_${r}`], r).toBeTruthy()
    }
  })

  it('queue card in English', async () => {
    setLanguage('en')
    await seedConnected({ [STORAGE_KEYS.queueRun]: progress({ state: 'running', index: 2, total: 5, channel_title: 'Two' }) })
    w.server.route('GET /ext/state', () => ({ body: { ok: true, data: { ...EXT_STATE_EXAMPLE, queue_pending: 0, language: 'en' } } }))
    await mount()
    expect(must('queue-card').textContent).toMatch(/Cancelling 2 of 5 · Two/)
    expect(must('queue-stop').textContent).toMatch(/Stop/)
  })
})

describe('token', () => {
  it('whole flow (pair, sync, problem, disconnect) with no token in the DOM or the console', async () => {
    await mount()
    await typeCode(CODE)
    await waitFor(() => expect(must('conn-state').dataset.state).toBe('connected'))
    expect(chromeFake().storage.get(STORAGE_KEYS.connection)).toMatchObject({ token: TOKEN })
    await click('sync-now')
    expect(document.documentElement.outerHTML).not.toContain(TOKEN)
    w.server.opts.token = 'revogado'
    await act(async () => {
      await chrome.runtime.sendMessage({ type: 'conn.status', payload: { probe: true } })
    })
    await waitFor(() => expect(must('conn-state').dataset.state).toBe('unauthorized'))
    expect(document.documentElement.outerHTML).not.toContain(TOKEN)
    await click('pair-again')
    await waitFor(() => expect(must('conn-state').dataset.state).toBe('unpaired'))
    // final scan in afterEach
  })
})
