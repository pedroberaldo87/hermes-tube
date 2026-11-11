// True empty state (zero channels): centered composition — `Hero` (welcome + the product line)
// and the 3 paths: connect the extension (onboarding/pairing, the recommended one), paste a channel (the
// field opens INSIDE the card itself, at full width → POST /channels/add, readable error per code) and load
// the demo (POST /demo/load). Nothing repeated: the field does not exist outside the card. The caller (HomeView)
// receives `onArriving` and starts showing progress while the videos arrive.
import { Button, Codicon, Input, host } from '@hermes/plugin-sdk'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { Channel } from '../../../shared/api-types'
import { Hero, PathCard, PathGroup, Stack, useUiLocale } from '../../components'
import { openDialog } from '../../lib/dialogs'
import { errorText, useT } from '../../lib/i18n'
import { TubeApiError, invalidateRest, restCall, toApiError } from '../../lib/rest'
import { cx } from '../../lib/style'

export interface Arriving {
  kind: 'demo' | 'channel'
  /** Channels that are arriving (demo: `DataReport.channels`; link: 1). */
  channels: number
  /** Title of the pasted channel (link). */
  title?: string
  since: number
}

/** Routes whose data changes when channels come in. */
const AFTER_CHANNELS = ['GET /channels', 'GET /tabs', 'GET /status', 'GET /feed'] as const

const LINK_ERROR_ID = 'home-link-error'

function linkErrorKey(error: unknown): { key: string; vars?: Record<string, string> } {
  const api = toApiError(error)
  switch (api.code) {
    case 'conflict': {
      const ch = (api.details?.channel ?? null) as Partial<Channel> | null
      return ch?.title ? { key: 'welcome.errors.conflict', vars: { title: ch.title } } : { key: 'welcome.errors.conflict_generic' }
    }
    case 'invalid':
      return { key: 'welcome.errors.invalid' }
    case 'youtube_error':
      return { key: 'welcome.errors.youtube_error' }
    case 'timeout':
      return { key: 'welcome.errors.timeout' }
    default:
      return { key: '' }
  }
}

/**
 * "Paste a channel": the same card as the paths (`PathCard` classes), but the body swaps to the field when the
 * person clicks — the field takes the card width (the placeholder example shows in full) and gets focus.
 * The kit's `PathCard` does not accept a custom body.
 */
function PasteCard({ onArriving }: { onArriving: (a: Arriving) => void }) {
  const t = useT('home')
  const tc = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const text = value.trim()
    if (!text) {
      setError(t('welcome.errors.empty'))
      inputRef.current?.focus()
      return
    }
    if (busy) return
    setBusy(true)
    setError(null)
    restCall('POST /channels/add', { body: { url_or_handle: text } }).then(
      (channel) => {
        setBusy(false)
        setValue('')
        host.notify({ kind: 'success', message: t('welcome.link_added', { title: channel.title }) })
        onArriving({ kind: 'channel', channels: 1, title: channel.title, since: Date.now() })
        void invalidateRest(...AFTER_CHANNELS)
      },
      (err: unknown) => {
        setBusy(false)
        const { key, vars } = linkErrorKey(err)
        setError(key ? t(key, vars) : errorText(tc, toApiError(err)))
        inputRef.current?.focus()
      }
    )
  }

  return (
    <article className={cx('path')} data-part="path-card" data-primary="false" data-open={open ? 'true' : undefined}>
      <div className={cx('path-top')}>
        <span className={cx('path-icon')} data-part="path-icon" aria-hidden="true">
          <Codicon name="link" size={20} />
        </span>
      </div>
      <h3 className={cx('path-title t-head')} data-part="path-title">
        {t('welcome.link_title')}
      </h3>
      {open ? (
        <form onSubmit={submit} noValidate data-part="link-form">
          <Stack gap={2} align="stretch">
            <Input
              ref={inputRef}
              name="channel"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={value}
              placeholder={t('welcome.link_placeholder')}
              aria-label={t('welcome.link_label')}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? LINK_ERROR_ID : undefined}
              onChange={(e: { target: { value: string } }) => {
                setValue(e.target.value)
                if (error) setError(null)
              }}
            />
            {error ? (
              <p id={LINK_ERROR_ID} className={cx('t-label')} role="alert" data-part="link-error">
                {error}
              </p>
            ) : (
              <p className={cx('path-hint t-label')} data-part="link-hint">
                {t('welcome.link_hint')}
              </p>
            )}
            <div className={cx('path-foot')} data-part="path-foot">
              <Button type="submit" variant="outline" size="sm" loading={busy}>
                <Codicon name="add" size={14} />
                {t('welcome.link_submit')}
              </Button>
            </div>
          </Stack>
        </form>
      ) : (
        <>
          <p className={cx('path-desc t-body')} data-part="path-desc">
            {t('welcome.link_desc')}
          </p>
          <div className={cx('path-foot')} data-part="path-foot">
            <Button variant="outline" size="sm" aria-expanded={false} onClick={() => setOpen(true)}>
              {t('welcome.link_action')}
            </Button>
          </div>
        </>
      )}
    </article>
  )
}

export function Welcome({ onArriving }: { onArriving: (a: Arriving) => void }) {
  const t = useT('home')
  const tc = useT()
  const [demoBusy, setDemoBusy] = useState(false)
  const uiLocale = useUiLocale()

  const loadDemo = () => {
    if (demoBusy) return
    setDemoBusy(true)
    // the demo folder names come out in the language the app is in
    restCall('POST /demo/load', { body: { ui_locale: uiLocale } }).then(
      (report) => {
        setDemoBusy(false)
        onArriving({ kind: 'demo', channels: report.channels, since: Date.now() })
        // the videos come through RSS: asks for the cycle right away (without waiting for the `kick_if_due` grace period)
        restCall('POST /refresh', { body: { force: true } }).catch(() => undefined)
        void invalidateRest(...AFTER_CHANNELS)
      },
      (error: unknown) => {
        setDemoBusy(false)
        host.notify({
          kind: 'error',
          message: t('welcome.demo_failed', { error: errorText(tc, error instanceof TubeApiError ? error.toApiError() : toApiError(error)) })
        })
      }
    )
  }

  return (
    <>
      <Hero icon="play-circle" title={tc('kit.welcome.title')} tagline={tc('kit.welcome.tagline')} description={t('welcome.lead')} />
      <PathGroup label={t('welcome.group')}>
        <PathCard
          primary
          recommended
          icon="plug"
          title={t('welcome.pair_title')}
          description={t('welcome.pair_desc')}
          actionLabel={t('welcome.pair_action')}
          onAction={() => openDialog('onboarding', { step: 'pair' })}
          hint={t('welcome.pair_hint')}
        />
        <PasteCard onArriving={onArriving} />
        <PathCard
          icon="beaker"
          title={t('welcome.demo_title')}
          description={t('welcome.demo_desc')}
          actionLabel={demoBusy ? t('welcome.demo_loading') : t('welcome.demo_action')}
          onAction={loadDemo}
          hint={t('welcome.demo_hint')}
        />
      </PathGroup>
    </>
  )
}
