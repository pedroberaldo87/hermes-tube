// Skeleton.
// To fill in: Extras on/off (GET/POST /extras → setExtras() of the atom in lib/extras), credit to
// HackerTube (ODC-By), HN channels (GET /extras/hn/channels), import list
// (openDialog('list-import')). i18n namespace: `extras`.
// Rules: does not import another screen/dialog — use lib/ (openDialog, useRest, callRpc,
// useRpcJob, host.navigate) and components/. Colors only through theme variables.
import { EmptyView, PageFrame, SectionFrame } from '../../components'
import { useT } from '../../lib/i18n'

export function ExtrasPage() {
  const t = useT()
  return (
    <SectionFrame current="extras">
      <PageFrame title={t('routes.extras')}>
        <EmptyView title={t('placeholder.title')} description={t('placeholder.description')} />
      </PageFrame>
    </SectionFrame>
  )
}
