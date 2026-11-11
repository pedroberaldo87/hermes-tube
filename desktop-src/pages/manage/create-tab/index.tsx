// Stub — dialog `create-tab`, opened by
// openDialog('create-tab', props) from any screen; registered in main.tsx (DIALOGS).
// To fill in: "create tab from selection" (props.channelIds → POST /tabs/from-channels).
// i18n namespace: `history`.
// Rule: do not import screens/dialogs; only lib/ and components/.
import type { DialogProps } from '../../../../shared/ids'
import { DialogFrame, EmptyView } from '../../../components'
import type { DialogControls } from '../../../lib/dialogs'
import { useT } from '../../../lib/i18n'

export function CreateTabDialog({ onClose }: DialogProps['create-tab'] & DialogControls) {
  const t = useT()
  return (
    <DialogFrame title={t('dialogs.create-tab')} onClose={onClose}>
      <EmptyView title={t('placeholder.title')} description={t('placeholder.description')} />
    </DialogFrame>
  )
}
