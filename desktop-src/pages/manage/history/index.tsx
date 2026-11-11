// Stub — dialog `history`, opened by
// openDialog('history', props) from any screen; registered in main.tsx (DIALOGS).
// To fill in: history drawer with undo (GET /changes, POST /changes/{id}/undo); refusal
// `undo_refused`/`already_executed` → common.already_executed ("use Resubscribe in Cleanup →
// Former subscriptions"). i18n namespace: `history`.
// Rule: do not import screens/dialogs; only lib/ and components/.
import type { DialogProps } from '../../../../shared/ids'
import { DialogFrame, EmptyView } from '../../../components'
import type { DialogControls } from '../../../lib/dialogs'
import { useT } from '../../../lib/i18n'

export function HistoryDialog({ onClose }: DialogProps['history'] & DialogControls) {
  const t = useT()
  return (
    <DialogFrame title={t('dialogs.history')} onClose={onClose}>
      <EmptyView title={t('placeholder.title')} description={t('placeholder.description')} />
    </DialogFrame>
  )
}
