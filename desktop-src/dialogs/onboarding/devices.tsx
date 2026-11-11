// Connected browsers (GET /devices), in a discreet section: name, "active … ago" in the app language and
// "disconnect" with confirmation (ApprovalCard: focus stays on "not now"). Revoking is optimistic: the row disappears
// at once and comes back, with the error, if the request fails. Revoking has no undo (the token dies), so the
// confirmation says what happens and how to get back (generate another code).
import { Button, Codicon } from '@hermes/plugin-sdk'
import { useState } from 'react'
import type { Device } from '../../../shared/api-types'
import { ApprovalCard, Banner, Dot, Section, formatRelative, useLocale } from '../../components'
import { useT } from '../../lib/i18n'
import { invalidateRest, restCall, useRest, useRetryOnError } from '../../lib/rest'
import { cx } from '../../lib/style'
import { ONLINE_WINDOW_S } from './model'

export function DevicesSection() {
  const t = useT('onboarding')
  const tc = useT()
  const locale = useLocale()
  const query = useRest('GET /devices', {})
  // a failed list is read again by itself (growing wait), not only through "Try again"
  useRetryOnError(query)
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set())
  const [confirming, setConfirming] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  // discreet: nothing while loading; an error is an error (never a false "no devices")
  if (query.data === undefined) {
    if (!query.error) return null
    return (
      <div data-part="devices">
        <Banner tone="error" icon="plug" action={{ label: tc('retry'), onClick: () => void query.refetch() }}>
          {t('devices.error')}
        </Banner>
      </div>
    )
  }

  const items = query.data.items.filter((d) => d.revoked_at == null && !removed.has(d.id))
  if (!items.length && !failed) return null

  const nameOf = (d: Device) => d.name?.trim() || t('pair.unnamed')
  const now = Date.now()
  const target = items.find((d) => d.id === confirming) ?? null

  const revoke = (d: Device) => {
    setConfirming(null)
    setFailed(null)
    setRemoved((s) => new Set(s).add(d.id))
    restCall('POST /devices/{id}/revoke', { path: { id: d.id } }).then(
      () => void invalidateRest('GET /devices', 'GET /status'),
      () => {
        setRemoved((s) => {
          const next = new Set(s)
          next.delete(d.id)
          return next
        })
        setFailed(nameOf(d))
      }
    )
  }

  return (
    <div data-part="devices">
      <Section title={t('devices.title')} count={items.length} description={t('devices.desc')}>
        {failed ? (
          <Banner tone="error" onDismiss={() => setFailed(null)}>
            {t('devices.revoke_failed', { name: failed })}
          </Banner>
        ) : null}
        {items.length ? (
          <div className={cx('sgroup')}>
            <div role="list">
              {items.map((d) => {
                const name = nameOf(d)
                const online = d.last_seen != null && now / 1000 - d.last_seen <= ONLINE_WINDOW_S
                return (
                  <div key={d.id} role="listitem" className={cx('srow')} data-part="device-row" data-id={d.id}>
                    <span className={cx('approval-icon')} aria-hidden="true">
                      <Codicon name="browser" size={15} />
                    </span>
                    <div className={cx('srow-main')}>
                      <div className={cx('srow-line t-body')}>
                        <span className={cx('srow-subject')} title={name}>
                          {name}
                        </span>
                        {online ? <Dot tone="success" label={t('devices.online')} /> : null}
                      </div>
                      <div className={cx('srow-reason t-label num')}>
                        {d.last_seen != null
                          ? t('devices.seen', { when: formatRelative(d.last_seen, now, locale) })
                          : t('devices.never_seen')}
                      </div>
                    </div>
                    <div className={cx('srow-actions')}>
                      <Button
                        variant="ghost"
                        size="xs"
                        data-part="device-revoke"
                        aria-label={t('devices.revoke_label', { name })}
                        aria-expanded={confirming === d.id}
                        onClick={() => setConfirming(confirming === d.id ? null : d.id)}
                      >
                        {t('devices.revoke')}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}
        {target ? (
          <ApprovalCard
            autoFocus
            title={t('devices.revoke_title', { name: nameOf(target) })}
            description={t('devices.revoke_desc')}
            effects={[t('devices.revoke_effect_stop'), t('devices.revoke_effect_again')]}
            confirmLabel={t('devices.revoke_confirm', { name: nameOf(target) })}
            cancelLabel={t('devices.revoke_cancel')}
            onConfirm={() => revoke(target)}
            onCancel={() => setConfirming(null)}
          />
        ) : null}
      </Section>
    </div>
  )
}
