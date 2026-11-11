// Skeleton. Dialog `list-import`, opened by
// openDialog('list-import', props) from any screen; registered in main.tsx (DIALOGS).
// To fill in: import a list (Extra) — useRpcJob('lists.import', props.jobId) from props.url; preview
// (Job.result); turn into a tab (callRpc('lists.to_tab')). Without RPC: <RpcUnavailableNotice/>.
// i18n namespace: `list-import`.
// Rules: does not import screens/dialogs; only lib/ and components/.
import type { DialogProps } from '../../../shared/ids'
import { DialogFrame, EmptyView } from '../../components'
import type { DialogControls } from '../../lib/dialogs'
import { useT } from '../../lib/i18n'

export function ListImportDialog({ onClose }: DialogProps['list-import'] & DialogControls) {
  const t = useT()
  return (
    <DialogFrame title={t('dialogs.list-import')} onClose={onClose}>
      <EmptyView title={t('placeholder.title')} description={t('placeholder.description')} />
    </DialogFrame>
  )
}
