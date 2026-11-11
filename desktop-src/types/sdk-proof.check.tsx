// SDK type proof: this file only exists for `tsc` to exercise
// desktop-src/types/hermes-plugin-sdk.d.ts. It is not imported by anything nor does it enter the bundle.
// If the .d.ts is regenerated and something here breaks, the Desktop SDK changed shape: review.
import {
  Button,
  type HermesPlugin,
  host,
  type PluginContext,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  useQuery
} from '@hermes/plugin-sdk'

function ProofPage({ ctx }: { ctx: PluginContext }) {
  const q = useQuery({
    queryKey: ['f02-proof'],
    queryFn: () => ctx.rest<{ ok: boolean }>('/status'),
    refetchInterval: 60_000
  })
  const ok: boolean | undefined = q.data?.ok
  return (
    <Button variant="outline" onClick={() => void host.request<{ ok: boolean }>('plugin.f02.ping', {})}>
      {ok ? 'ok' : '…'}
    </Button>
  )
}

export const proofPlugin: HermesPlugin = {
  id: 'f02-proof',
  name: 'SDK proof',
  register(ctx) {
    ctx.registerMany([
      { id: 'page', area: ROUTES_AREA, data: { path: '/f02' }, render: () => <ProofPage ctx={ctx} /> },
      { id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: '/sdk-proof', label: 'SDK proof' } }
    ])
  }
}
