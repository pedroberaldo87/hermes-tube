// "Set up the extension" — the first part of the pairing path. No Chromium browser lets a program install an extension
// from outside its store without the person's gestures; Hermes does everything up to that point:
//   - GET /extension/setup tells what the button offers (set up · update · already there · a folder that is not
//     ours · no bundled extension → the manual instructions, as before) and which Chromium browsers are installed
//     on the computer where Hermes runs (Chrome, Edge, Brave, Chromium, Vivaldi, Opera, Arc). One → it is used; several
//     → the person picks one here;
//   - only a click sends POST /extension/setup (with at most the chosen browser's key): the plugin backend copies the
//     extension shipped inside the plugin to a fixed folder in the home folder and opens that browser's own Extensions
//     page and the file manager — on the computer where Hermes runs;
//   - then the screen lists the gestures the browser still needs, numbered, with their state and that browser's own
//     button names: Developer mode, drag the folder (or "Load unpacked" + the path, with a copy button), type the code.
// The manual way (the written steps, the Extensions page address and the folder path, each with a copy button) is
// always there, not only when something fails: a disclosure, closed by default (open when the button failed), that
// does not repeat the folder path when it is already shown above it. A Flatpak or snap browser that cannot see the folder is told how to
// fix it. When the browser could not be opened, it says so and explains the case of Hermes on another computer.
// Hermes inside WSL on Windows: the backend reports `platform: windows` with the Windows path and a `wsl` field; the
// screen then says how the browser reaches Hermes, and what to do with interop off or the folder on the WSL disk.
// Last resort: "Ask Hermes to help" opens a new chat with a fixed request (in English) as a draft that the person reads
// and sends; on a Desktop without that API, the same request can be copied. The parent hides this part once the browser
// pairs (`connected`). Nothing here reads the app's markup or embeds a page.
//
// The button never depends on the GET: when the read fails (anything but an older backend without the route), the
// button is still offered (the POST picks the browser by itself) and the read is retried on its own with a growing
// wait. Once the folder exists, two plain buttons: "Open the Extensions page" (the same POST, which is idempotent and
// opens the page again) and "Show the folder" (the app's file manager on this computer; without it, the POST again).
import { Button, Codicon, CopyButton, host } from '@hermes/plugin-sdk'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { ExtensionBrowser, ExtensionSetupResult, ExtensionSetupStatus } from '../../../shared/api-types'
import { Banner, type Step, Stack, StepProgress, formatNumber, useLocale } from '../../components'
import { maybePluginContext } from '../../lib/ctx'
import { useT } from '../../lib/i18n'
import { invalidateRest, restCall, toApiError, useRest, useRetryOnError } from '../../lib/rest'
import { useGatewayPlace } from '../../lib/status'
import { cx } from '../../lib/style'
import { isSafeExternalUrl } from './model'
import { DEFAULT_EXTENSIONS_URL, askHermes, buildHermesRequest, canAskHermes, flatpakAccessCommand } from './setup-request'

/** Chrome's Extensions page (the default when no browser was found). */
export const EXTENSIONS_URL = DEFAULT_EXTENSIONS_URL

export type SetupPhase = 'loading' | 'manual' | 'offer' | 'update' | 'ready' | 'not_ours' | 'busy' | 'done' | 'error'

type SetupError = 'not_ours' | 'generic'
type AskState = 'idle' | 'busy' | 'sent' | 'failed'

export interface ExtensionSetupProps {
  /** The browser already paired: this part has nothing left to ask. */
  connected: boolean
  /** Preview/tests only: starts as if the POST had already answered with this. */
  seedResult?: ExtensionSetupResult
}

const BROWSER_TEXT_KEYS = new Set(['chrome', 'chromium', 'edge', 'brave', 'vivaldi', 'opera', 'arc'])

/** The read failed because this backend predates the route (contract `not_found`): the manual instructions. */
function isOlderBackend(error: unknown): boolean {
  const api = toApiError(error)
  return api.code === 'not_found' && !(error as { transport?: boolean } | null)?.transport
}

export function ExtensionSetup({ connected, seedResult }: ExtensionSetupProps) {
  const t = useT('onboarding')
  const tc = useT()
  const locale = useLocale()
  const status = useRest('GET /extension/setup', {})
  const olderBackend = status.isError && isOlderBackend(status.error)
  const readFailed = status.isError && !olderBackend
  useRetryOnError(status, readFailed && !connected)
  // name of the computer Hermes runs on when the app talks to a remote Hermes; `null` when local
  const place = useGatewayPlace()
  const remote = place.remote ? place.name : null
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ExtensionSetupResult | null>(seedResult ?? null)
  const [error, setError] = useState<SetupError | null>(null)
  const [choice, setChoice] = useState<string | null>(null)
  const [ask, setAsk] = useState<AskState>('idle')
  // "Or do it by hand": `null` until the person opens/closes it (then their choice sticks)
  const [manualToggled, setManualToggled] = useState<boolean | null>(null)
  const busyRef = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  if (connected) return null

  const data: ExtensionSetupStatus | undefined = status.data
  // an older backend does not list browsers: treat it as "none known" (Chrome's address, generic names)
  const browsers: ExtensionBrowser[] = Array.isArray(data?.browsers) ? data.browsers : []
  const selected = browsers.find((b) => b.key === choice) ?? browsers[0] ?? null
  const browser = result ? (result.browser ?? selected) : selected
  const browserName = browser?.name ?? t('pair.setup.browser_generic')
  const textKey = browser && BROWSER_TEXT_KEYS.has(browser.key) ? browser.key : 'generic'
  const dev = t(`pair.setup.browsers.${textKey}.dev`)
  const load = t(`pair.setup.browsers.${textKey}.load`)
  const where = t(`pair.setup.browsers.${textKey}.where`)
  const url = browser?.extensions_url ?? EXTENSIONS_URL

  const run = () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    const call = selected ? restCall('POST /extension/setup', { body: { browser: selected.key } }) : restCall('POST /extension/setup')
    call.then(
      (out) => {
        busyRef.current = false
        if (!mounted.current) return
        setBusy(false)
        setResult(out)
        void invalidateRest('GET /extension/setup')
      },
      (err: unknown) => {
        busyRef.current = false
        if (!mounted.current) return
        const api = toApiError(err)
        setBusy(false)
        setResult(null)
        setError(api.code === 'conflict' && api.reason === 'not_ours' ? 'not_ours' : 'generic')
        void invalidateRest('GET /extension/setup')
      }
    )
  }

  const recheck = () => {
    setError(null)
    void status.refetch()
  }

  /** "Show the folder": the app's file manager on this computer; on another computer (or without it), the POST. */
  const showFolder = (folder: string) => {
    const os = remote ? undefined : maybePluginContext()?.os
    if (!folder || !os || typeof os.revealPath !== 'function') {
      run()
      return
    }
    os.revealPath(folder).then(
      (ok) => {
        if (!ok && mounted.current) run()
      },
      () => {
        if (mounted.current) run()
      }
    )
  }

  const phase: SetupPhase = busy
    ? 'busy'
    : result
      ? 'done'
      : error === 'generic'
        ? 'error'
        : error === 'not_ours' || data?.state === 'not_ours'
          ? 'not_ours'
          : olderBackend
            ? 'manual'
            : readFailed && !data
              ? 'offer'
              : !data
              ? 'loading'
              : data.state === 'unavailable'
                ? 'manual'
                : data.state === 'update_available'
                  ? 'update'
                  : data.state === 'installed'
                    ? 'ready'
                    : 'offer'

  const n = (i: number) => `${formatNumber(i, locale)}.`
  const path = result?.path ?? data?.path ?? ''
  const platform = result?.platform ?? data?.platform ?? null
  const folderReady = Boolean(result) || data?.state === 'installed' || data?.state === 'update_available'
  const wsl = (result ? result.wsl : data?.wsl) ?? null

  const pathRow = (part = 'ext-setup-path') =>
    path ? (
      <span className={cx('t-label')} data-part={`${part}-row`}>
        <Stack direction="row" gap={2} align="center" wrap>
          <code className={cx('num')} data-part={part}>
            {path}
          </code>
          <span data-part={`${part}-copy`}>
            <CopyButton text={path} label={t('pair.setup.copy_path')} />
          </span>
        </Stack>
      </span>
    ) : null

  const urlRow = (
    <span className={cx('t-label')} data-part="ext-setup-url-row">
      <Stack direction="row" gap={2} align="center" wrap>
        <span>{t('pair.setup.open_yourself')}</span>
        <code className={cx('num')}>{url}</code>
        <CopyButton text={url} label={t('pair.setup.copy_url')} />
      </Stack>
    </span>
  )

  const remoteNotice = remote ? (
    <div data-part="ext-setup-remote">
      <Banner tone="info" icon="remote" title={t('pair.setup.remote_title', { name: remote })}>
        {t('pair.setup.remote_body')}
      </Banner>
    </div>
  ) : null

  // ------------------------------------------------------------------ the browser
  const showPicker = browsers.length > 1 && (phase === 'offer' || phase === 'update' || phase === 'ready' || phase === 'not_ours' || phase === 'error')
  const picker = showPicker ? (
    <Stack direction="row" gap={2} align="center" wrap>
      <span className={cx('t-label')} id="ext-setup-browser-label">
        {t('pair.setup.choose_browser')}
      </span>
      <div role="radiogroup" aria-labelledby="ext-setup-browser-label" data-part="ext-setup-browsers">
        <Stack direction="row" gap={1} wrap>
          {browsers.map((b) => {
            const on = b.key === selected?.key
            return (
              <Button
                key={b.key}
                role="radio"
                aria-checked={on ? 'true' : 'false'}
                data-part="ext-setup-browser"
                data-key={b.key}
                variant={on ? 'default' : 'outline'}
                size="sm"
                onClick={() => setChoice(b.key)}
              >
                {b.name}
              </Button>
            )
          })}
        </Stack>
      </div>
    </Stack>
  ) : null

  const noBrowser =
    Array.isArray(data?.browsers) && browsers.length === 0 && (phase === 'offer' || phase === 'update' || phase === 'ready') ? (
      <p className={cx('t-label')} data-part="ext-setup-no-browser">
        {t('pair.setup.no_browser_found')}
      </p>
    ) : null

  const flatpakCommand = browser && !browser.folder_visible ? flatpakAccessCommand(browser, path) : null
  const sandboxNotice =
    browser && browser.sandbox && !browser.folder_visible ? (
      <div data-part="ext-setup-sandbox">
        <Banner
          tone="warning"
          icon="lock"
          title={t(browser.sandbox === 'flatpak' ? 'pair.setup.sandbox.flatpak_title' : 'pair.setup.sandbox.snap_title', { browser: browser.name })}
        >
          <Stack gap={2}>
            <span>{t(browser.sandbox === 'flatpak' ? 'pair.setup.sandbox.flatpak_body' : 'pair.setup.sandbox.snap_body')}</span>
            {flatpakCommand ? (
              <span className={cx('t-label')}>
                <Stack direction="row" gap={2} align="center" wrap>
                  <code className={cx('num')}>{flatpakCommand}</code>
                  <CopyButton text={flatpakCommand} label={t('pair.setup.sandbox.copy_command')} />
                </Stack>
              </span>
            ) : null}
          </Stack>
        </Banner>
      </div>
    ) : null

  const wslNotice = wsl ? (
    <div data-part="ext-setup-wsl">
      <Banner tone="info" icon="remote" title={t('pair.setup.wsl.title')}>
        <Stack gap={2}>
          {wsl.interop ? null : <span data-part="ext-setup-wsl-interop">{t('pair.setup.wsl.no_interop')}</span>}
          {wsl.windows_folder ? null : <span data-part="ext-setup-wsl-disk">{t('pair.setup.wsl.wsl_disk')}</span>}
          <span>{t('pair.setup.wsl.localhost', { ask: t('pair.setup.ask.action') })}</span>
        </Stack>
      </Banner>
    </div>
  ) : null

  // ------------------------------------------------------------------ the manual way (always there, folded)
  // A disclosure, closed by default (open when the button failed: then it is the way forward). The folder path is
  // not repeated when it is already on screen above it.
  const pathAbove = Boolean(path) && (phase === 'ready' || phase === 'not_ours')
  const manualOpen = manualToggled ?? phase === 'error'
  const manual = (
    <details
      data-part="ext-setup-manual"
      className={cx('t-body obmanual')}
      open={manualOpen}
      onToggle={(e) => {
        const open = (e.currentTarget as HTMLDetailsElement).open
        if (open !== manualOpen) setManualToggled(open)
      }}
    >
      <summary data-part="ext-setup-manual-toggle" className={cx('t-label')}>
        <Codicon name="chevron-right" size={12} className={cx('obmanual-caret')} />
        <span>{t('pair.setup.manual_title')}</span>
      </summary>
      <ol>
        <li>
          <Stack direction="row" gap={2} align="center" wrap>
            <span>{t('pair.setup.manual_open', { browser: browserName })}</span>
            <code className={cx('num')}>{url}</code>
            <CopyButton text={url} label={t('pair.setup.copy_url')} />
          </Stack>
        </li>
        <li>
          {t('pair.setup.manual_dev', { dev })} <span className={cx('t-label')}>{where}</span>
        </li>
        <li>
          {pathAbove ? (
            <span data-part="ext-setup-manual-load">{t('pair.setup.manual_load_above', { load })}</span>
          ) : (
            <Stack gap={1}>
              <span data-part="ext-setup-manual-load">{t('pair.setup.manual_load', { load })}</span>
              {pathRow('ext-setup-manual-path')}
              {folderReady ? null : <span className={cx('t-label')}>{t('pair.setup.manual_folder_later')}</span>}
            </Stack>
          )}
        </li>
        <li>{t('pair.setup.manual_code')}</li>
      </ol>
    </details>
  )

  // ------------------------------------------------------------------ last resort: Hermes helps
  const requestText = buildHermesRequest({ platform, path, browser, folderReady, remote: Boolean(remote), ...(wsl ? { wsl } : {}) })
  const canAsk = canAskHermes(host)
  const startAsk = () => {
    if (ask === 'busy') return
    setAsk('busy')
    void askHermes(host, requestText).then((ok) => {
      if (mounted.current) setAsk(ok ? 'sent' : 'failed')
    })
  }
  // one line: a short title and the button on the same row; what the request promises (nothing sent before Send,
  // the browser profile untouched…) is the button's tooltip and the row's accessible description
  const askDesc = canAsk ? t('pair.setup.ask.desc') : t('pair.setup.ask.copy_desc')
  const askBox = (
    <div data-part="ext-setup-ask" className={cx('t-body obask')} title={askDesc}>
      <span className={cx('t-label')}>
        <Codicon name="comment-discussion" size={12} /> {canAsk ? t('pair.setup.ask.title') : t('pair.setup.ask.copy_title')}
      </span>
      {!canAsk ? (
        <CopyButton text={requestText} label={t('pair.setup.ask.copy_label')} title={askDesc} />
      ) : ask === 'sent' ? (
        <span className={cx('t-label')} role="status">
          <Codicon name="pass" size={12} /> {t('pair.setup.ask.sent')}
        </span>
      ) : ask === 'failed' ? (
        <>
          <span className={cx('t-label')}>{t('pair.setup.ask.failed')}</span>
          <CopyButton text={requestText} label={t('pair.setup.ask.copy_label')} />
        </>
      ) : (
        <Button
          variant="outline"
          size="xs"
          data-part="ext-setup-ask-action"
          title={askDesc}
          aria-describedby="ext-setup-ask-desc"
          loading={ask === 'busy'}
          disabled={ask === 'busy'}
          onClick={startAsk}
        >
          {ask === 'busy' ? t('pair.setup.ask.busy') : t('pair.setup.ask.action')}
        </Button>
      )}
      <span id="ext-setup-ask-desc" className={cx('obsr')} data-part="ext-setup-ask-desc">
        {askDesc}
      </span>
    </div>
  )

  let body: ReactNode = null
  if (phase === 'loading') {
    body = null
  } else if (phase === 'manual') {
    const storeUrl = t('pair.install.store_url')
    body = (
      <Banner
        tone="info"
        icon="extensions"
        title={t('pair.install.title')}
        action={
          isSafeExternalUrl(storeUrl)
            ? { label: t('pair.install.store_link'), onClick: () => void maybePluginContext()?.os.openExternal(storeUrl) }
            : undefined
        }
      >
        {t('pair.install.body')}
      </Banner>
    )
  } else if (phase === 'not_ours') {
    body = (
      <Banner tone="warning" icon="folder" title={t('pair.setup.not_ours_title')} action={{ label: t('pair.setup.check_again'), onClick: recheck }}>
        <Stack gap={2}>
          <span>{t('pair.setup.not_ours_body')}</span>
          {pathRow()}
        </Stack>
      </Banner>
    )
  } else if (phase === 'error') {
    body = (
      <Banner tone="error" title={t('pair.setup.error_title')} action={{ label: tc('retry'), onClick: run }}>
        {t('pair.setup.error_body')}
      </Banner>
    )
  } else if (phase === 'offer' || phase === 'update' || phase === 'busy') {
    const update = phase === 'update' || (phase === 'busy' && data?.state === 'update_available')
    body = (
      <Stack gap={3}>
        {remoteNotice}
        <div className={cx('t-body')}>
          <strong className={cx('t-head')}>{update ? t('pair.setup.update_title') : t('pair.setup.title')}</strong>
          <p className={cx('t-label')}>
            {update ? t('pair.setup.update_desc', { version: data?.bundled_version ?? '' }) : t('pair.setup.desc', { browser: browserName })}
          </p>
        </div>
        {picker}
        {noBrowser}
        <Stack direction="row" gap={2} align="center" wrap>
          <Button data-part="ext-setup-action" loading={busy} disabled={busy} onClick={run}>
            <Codicon name={update ? 'sync' : 'extensions'} size={14} />
            {busy ? t('pair.setup.busy') : update ? t('pair.setup.update_action') : t('pair.setup.action')}
          </Button>
        </Stack>
        {readFailed && !data ? (
          <p className={cx('t-label')} role="status" data-part="ext-setup-read-failed">
            {t('pair.setup.read_failed')}
          </p>
        ) : null}
      </Stack>
    )
  } else if (phase === 'ready') {
    body = (
      <Stack gap={2}>
        {remoteNotice}
        <Stack direction="row" gap={3} justify="between" align="center" wrap>
          <Stack gap={1}>
            <span className={cx('t-body')}>
              <Codicon name="pass" size={14} /> {t('pair.setup.ready_title')}
            </span>
            {pathRow()}
          </Stack>
          <Stack direction="row" gap={2} align="center" wrap>
            <Button variant="outline" size="sm" data-part="ext-setup-action" onClick={run}>
              <Codicon name="extensions" size={14} />
              {t('pair.setup.reopen')}
            </Button>
            <Button variant="outline" size="sm" data-part="ext-setup-show-folder" onClick={() => showFolder(path)}>
              <Codicon name="folder-opened" size={14} />
              {t('pair.setup.show_folder')}
            </Button>
          </Stack>
        </Stack>
        {picker}
        {noBrowser}
      </Stack>
    )
  } else if (phase === 'done' && result) {
    const updated = result.action === 'updated'
    const steps: Step[] = updated
      ? [
          { id: 'folder', label: `${n(1)} ${t('pair.setup.step_updated', { version: result.version })}`, status: 'done', detail: pathRow() },
          {
            id: 'reload',
            label: `${n(2)} ${t('pair.setup.step_reload', { browser: browserName })}`,
            status: 'running',
            detail: t('pair.setup.step_reload_detail')
          }
        ]
      : [
          { id: 'folder', label: `${n(1)} ${t('pair.setup.step_folder')}`, status: 'done', detail: pathRow() },
          { id: 'dev', label: `${n(2)} ${t('pair.setup.step_dev', { dev })}`, status: 'running', detail: where },
          { id: 'drag', label: `${n(3)} ${t('pair.setup.step_drag')}`, status: 'waiting', detail: t('pair.setup.step_drag_detail', { load }) },
          { id: 'code', label: `${n(4)} ${t('pair.setup.step_code')}`, status: 'waiting', detail: t('pair.setup.step_code_detail') }
        ]
    const problem = result.open_problem && result.open_problem !== 'disabled' ? result.open_problem : 'failed'
    body = (
      <Stack gap={3}>
        {result.opened.extensions_page ? (
          <Stack gap={1}>
            <p className={cx('t-label')} role="status" data-part="ext-setup-opened">
              {result.opened.folder ? t('pair.setup.opened', { browser: browserName }) : t('pair.setup.opened_page_only', { browser: browserName })}
            </p>
            {urlRow}
          </Stack>
        ) : (
          <div data-part="ext-setup-not-opened">
            <Banner tone="warning" icon="browser" title={t('pair.setup.not_opened_title', { browser: browserName })}>
              <Stack gap={2}>
                <span>
                  {wsl && !wsl.interop && problem === 'unsupported' ? t('pair.setup.wsl.no_interop') : t(`pair.setup.problem.${problem}`, { browser: browserName })}
                </span>
                {urlRow}
                <span>{t('pair.setup.other_computer')}</span>
              </Stack>
            </Banner>
          </div>
        )}
        <Stack direction="row" gap={2} align="center" wrap>
          <Button variant="outline" size="sm" data-part="ext-setup-open-page" onClick={run}>
            <Codicon name="extensions" size={14} />
            {t('pair.setup.reopen')}
          </Button>
          <Button variant="outline" size="sm" data-part="ext-setup-show-folder" onClick={() => showFolder(result.path)}>
            <Codicon name="folder-opened" size={14} />
            {t('pair.setup.show_folder')}
          </Button>
        </Stack>
        <StepProgress steps={steps} label={t('pair.setup.steps_label')} />
      </Stack>
    )
  }

  const withExtras = phase !== 'loading' && phase !== 'manual'
  const showManual = withExtras && phase !== 'done'

  return (
    <div data-part="ext-setup" data-phase={phase} aria-busy={phase === 'loading' || phase === 'busy' ? true : undefined}>
      {withExtras ? (
        <Stack gap={3}>
          {body}
          {wslNotice}
          {sandboxNotice}
          {showManual ? manual : null}
          {askBox}
        </Stack>
      ) : (
        body
      )}
    </div>
  )
}
