// Can the browser on this computer pair with the gateway the app is talking to? Before showing a code and steps that
// cannot work, the connect path checks two things:
//   - the active gateway runs on another computer (a registered remote/ssh/cloud connection): the extension only
//     talks to the Hermes on the computer where the browser is, so the notice names the connection and says to
//     switch to this computer's connection. "My browser is on <name>" brings the steps back for someone whose
//     browser really is there;
//   - the plugin does not answer in the active profile (`GET /status` never reached it): the same explanation as the
//     side panel (go back to the profile where it was installed, or turn it on in Capabilities → Plugins).
// Both are read again on every connection/profile switch (the cache is per connection, see lib/rest).
import { Button, atom, host, useValue } from '@hermes/plugin-sdk'
import { Banner, Stack } from '../../components'
import { useT } from '../../lib/i18n'
import { pluginMissing, useGatewayPlace, useStatus } from '../../lib/status'

export type PairReach =
  | { kind: 'checking' }
  | { kind: 'ok' }
  | { kind: 'remote'; name: string; local: string | null }
  | { kind: 'off'; profile: string; retry: () => void }

/** Fallback atom for an older Desktop without `host.state.profile`. */
const NO_PROFILE = atom('default')

export function usePairReach(): PairReach {
  const place = useGatewayPlace()
  const status = useStatus()
  const profile = useValue(host.state?.profile ?? NO_PROFILE) || 'default'
  if (!place.known) return { kind: 'checking' }
  if (place.remote) return { kind: 'remote', name: place.name ?? '', local: place.local }
  if (!status.data && pluginMissing(status.error, { disabled: true })) return { kind: 'off', profile, retry: () => void status.refetch() }
  return { kind: 'ok' }
}

export function RemoteNotice({ name, local, onAnyway }: { name: string; local: string | null; onAnyway: () => void }) {
  const t = useT('onboarding')
  return (
    <div data-part="pair-remote">
      <Banner tone="warning" icon="remote" title={t('reach.remote_title', { name })}>
        <Stack gap={2}>
          <span>{t('reach.remote_body', { local: local || t('reach.local_default') })}</span>
          <Stack direction="row">
            <Button variant="ghost" size="sm" data-part="pair-remote-anyway" onClick={onAnyway}>
              {t('reach.anyway', { name })}
            </Button>
          </Stack>
        </Stack>
      </Banner>
    </div>
  )
}

export function PluginOffNotice({ profile, onRetry }: { profile: string; onRetry: () => void }) {
  const t = useT('onboarding')
  const tc = useT()
  return (
    <div data-part="pair-off">
      <Banner tone="warning" icon="plug" title={t('reach.off_title', { profile })} action={{ label: tc('retry'), onClick: onRetry }}>
        {t('reach.off_body', { profile })}
      </Banner>
    </div>
  )
}
