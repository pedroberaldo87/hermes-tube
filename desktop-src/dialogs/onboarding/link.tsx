// Path 2 — paste a link or @handle: validates on the client (nothing goes to the server if it does not look like a channel), calls
// POST /channels/add and shows the row at once (optimistic: "looking it up on YouTube…"), which turns into the real channel with
// "undo" (through history: GET /changes → POST /changes/{id}/undo). Readable error by code: duplicate,
// not found, YouTube rate-limiting/down, slow (the channel shows up later), timed out.
import { Button, Codicon, Input } from '@hermes/plugin-sdk'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import type { Channel } from '../../../shared/api-types'
import { ChannelAvatar, ChannelAvatarSkeleton, Stack } from '../../components'
import { useT } from '../../lib/i18n'
import { invalidateRest, restCall, toApiError } from '../../lib/rest'
import { cx } from '../../lib/style'
import { AFTER_CHANNELS, type LinkRowState, addErrorOutcome, parseChannelInput } from './model'

export interface LinkItem {
  key: string
  /** What the user pasted. */
  input: string
  state: LinkRowState
  channel?: Channel | null
  /** `exists`: the channel that was already in the list. */
  existing?: Partial<Channel> | null
  /** Key of the error/state text (namespace `onboarding`). */
  errorKey?: string
  retryable?: boolean
  undoFailed?: boolean
}

export interface LinkPanelProps {
  seed?: { items?: LinkItem[]; draft?: string; fieldError?: 'empty' | 'format' | null }
  onFinish: () => void
  onDirty: () => void
  /** Focus the field on mount. */
  autoFocus?: boolean
}

let keySeq = 0
const nextKey = () => `l${++keySeq}`

export function LinkPanel({ seed, onFinish, onDirty, autoFocus = true }: LinkPanelProps) {
  const t = useT('onboarding')
  const errorId = useId()
  const hintId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(seed?.draft ?? '')
  const [fieldError, setFieldError] = useState<'empty' | 'format' | null>(seed?.fieldError ?? null)
  const [items, setItems] = useState<LinkItem[]>(seed?.items ?? [])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const update = (key: string, patch: Partial<LinkItem>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  const add = (text: string, key = nextKey()) => {
    setItems((list) => {
      const fresh: LinkItem = { key, input: text, state: 'pending' }
      return list.some((i) => i.key === key) ? list.map((i) => (i.key === key ? fresh : i)) : [fresh, ...list]
    })
    restCall('POST /channels/add', { body: { url_or_handle: text } }).then(
      (channel) => {
        onDirty()
        update(key, { state: 'added', channel, errorKey: undefined, undoFailed: false })
        void invalidateRest(...AFTER_CHANNELS)
      },
      (error: unknown) => {
        const out = addErrorOutcome(toApiError(error))
        if (out.state === 'late') onDirty()
        update(key, { state: out.state, errorKey: out.key, retryable: out.retryable, existing: out.existing ?? null })
      }
    )
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const text = draft.trim()
    if (!text) {
      setFieldError('empty')
      inputRef.current?.focus()
      return
    }
    if (!parseChannelInput(text)) {
      setFieldError('format')
      inputRef.current?.focus()
      return
    }
    setFieldError(null)
    setDraft('')
    add(text)
    inputRef.current?.focus()
  }

  const undo = async (item: LinkItem) => {
    const id = item.channel?.id
    if (!id) return
    update(item.key, { state: 'undoing', undoFailed: false })
    try {
      const { items: changes } = await restCall('GET /changes', { query: { limit: 50 } })
      const entry = changes.find((c) => c.action === 'channel_add' && c.payload?.channel_id === id && c.undone_at == null)
      if (!entry) throw new Error('change not found')
      await restCall('POST /changes/{id}/undo', { path: { id: entry.id } })
      update(item.key, { state: 'undone' })
      onDirty()
      void invalidateRest(...AFTER_CHANNELS, 'GET /changes')
    } catch {
      update(item.key, { state: 'added', undoFailed: true })
    }
  }

  const dismiss = (key: string) => setItems((list) => list.filter((i) => i.key !== key))
  const anyKept = items.some((i) => i.state === 'added' || i.state === 'late' || i.state === 'exists')

  return (
    <div data-part="link">
      <Stack gap={5}>
        <form onSubmit={submit} noValidate data-part="link-form">
          <Stack gap={2}>
            <Stack direction="row" gap={2} align="center">
              <Input
                ref={inputRef}
                data-part="link-input"
                name="channel"
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={draft}
                placeholder={t('link.placeholder')}
                aria-label={t('link.label')}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? errorId : hintId}
                onChange={(e: { target: { value: string } }) => {
                  setDraft(e.target.value)
                  if (fieldError) setFieldError(null)
                }}
              />
              <Button type="submit" size="sm" data-part="link-submit">
                <Codicon name="add" size={14} />
                {t('link.submit')}
              </Button>
            </Stack>
            {fieldError ? (
              <p id={errorId} className={cx('t-label')} role="alert" data-part="link-error">
                {t(`link.errors.${fieldError}`)}
              </p>
            ) : (
              <p id={hintId} className={cx('section-desc t-label')}>
                {t('link.examples')}
              </p>
            )}
          </Stack>
        </form>

        {items.length ? (
          <section className={cx('sgroup')} data-part="link-list" aria-label={t('link.list_title')}>
            <header className={cx('sgroup-head')}>
              <h3 className={cx('sgroup-title t-head')}>
                <span className={cx('truncate')}>{t('link.list_title')}</span>
              </h3>
            </header>
            <div role="list">
              {items.map((item) => (
                <LinkRow
                  key={item.key}
                  item={item}
                  onUndo={() => void undo(item)}
                  onRetry={() => add(item.input, item.key)}
                  onAddAgain={() => add(item.channel?.url ?? item.input, item.key)}
                  onDismiss={() => dismiss(item.key)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {anyKept ? (
          <Stack direction="row" justify="end">
            <Button variant="outline" size="sm" data-part="link-done" onClick={onFinish}>
              {t('link.done')}
            </Button>
          </Stack>
        ) : null}
      </Stack>
    </div>
  )
}

function LinkRow({
  item,
  onUndo,
  onRetry,
  onAddAgain,
  onDismiss
}: {
  item: LinkItem
  onUndo: () => void
  onRetry: () => void
  onAddAgain: () => void
  onDismiss: () => void
}) {
  const t = useT('onboarding')
  const ch = item.channel ?? null
  const shown = ch ?? item.existing ?? null
  const title = shown?.title || item.input
  const busy = item.state === 'pending' || item.state === 'undoing'

  let reason: string
  switch (item.state) {
    case 'pending':
      reason = t('link.status.pending')
      break
    case 'added':
      reason = item.undoFailed
        ? t('link.errors.undo_failed')
        : ch?.handle
          ? t('link.status.added', { handle: ch.handle })
          : t('link.status.added_plain')
      break
    case 'undoing':
      reason = t('link.status.undoing')
      break
    case 'undone':
      reason = t('link.status.undone')
      break
    default:
      reason = item.errorKey ? t(item.errorKey) : t('link.errors.generic')
  }

  const avatar =
    shown?.title && (item.state !== 'pending' || ch) ? (
      <ChannelAvatar title={shown.title} thumb={shown.thumb ?? null} size={28} />
    ) : item.state === 'error' || item.state === 'late' ? (
      <span className={cx('approval-icon')} aria-hidden="true">
        <Codicon name={item.state === 'late' ? 'clock' : 'warning'} size={14} />
      </span>
    ) : (
      <ChannelAvatarSkeleton size={28} />
    )

  return (
    <div
      role="listitem"
      className={cx('srow')}
      data-part="link-row"
      data-state={item.state}
      data-status={item.state === 'undone' ? 'rejected' : 'pending'}
      aria-busy={busy ? true : undefined}
    >
      {avatar}
      <div className={cx('srow-main')}>
        <div className={cx('srow-line t-body')}>
          <span className={cx('srow-subject')} title={title}>
            {title}
          </span>
        </div>
        {item.state === 'error' || item.undoFailed ? (
          <p className={cx('t-label')} role="alert">
            {reason}
          </p>
        ) : (
          <div className={cx('srow-reason t-label')} title={reason}>
            {reason}
          </div>
        )}
      </div>
      <div className={cx('srow-actions')}>
        {busy ? <Codicon name="loading" size={14} spinning /> : null}
        {item.state === 'added' ? (
          <Button variant="ghost" size="xs" data-part="link-undo" onClick={onUndo}>
            <Codicon name="discard" size={12} />
            {t('link.undo')}
          </Button>
        ) : null}
        {item.state === 'undone' ? (
          <Button variant="ghost" size="xs" data-part="link-add-again" onClick={onAddAgain}>
            {t('link.add_again')}
          </Button>
        ) : null}
        {item.state === 'error' && item.retryable ? (
          <Button variant="ghost" size="xs" data-part="link-retry" onClick={onRetry}>
            {t('link.retry')}
          </Button>
        ) : null}
        {item.state === 'error' || item.state === 'exists' || item.state === 'late' ? (
          <Button variant="ghost" size="icon-xs" data-part="link-dismiss" aria-label={t('link.dismiss')} onClick={onDismiss}>
            <Codicon name="close" size={14} />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
