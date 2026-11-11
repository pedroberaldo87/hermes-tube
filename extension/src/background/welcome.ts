// background/welcome — the first load of the extension opens its pairing screen.
//
// When Chrome installs the extension (the person dragged the folder onto the Extensions page or chose
// "Load unpacked"), the popup is not visible: the toolbar icon starts hidden in the puzzle menu. So, on a
// fresh install and only while there is no pairing, the service worker opens the popup page in a tab
// (`popup/index.html?welcome=1`) and the person only types the 6-digit code Hermes shows. Never on a reload
// or an update (`reason: 'update'`), never when a token is already stored. The tab is a normal extension
// page: it reads nothing from any website and pairing still requires the code.
import { STORAGE_KEYS } from '../../../shared/ext-messages'

/** The popup page in tab mode (relative to the extension root). */
export const WELCOME_PAGE = 'popup/index.html?welcome=1'

/** `true` when the popup page was opened as the first-load tab (by its query string). */
export function isWelcomeSurface(search: string): boolean {
  return new URLSearchParams(search).get('welcome') === '1'
}

/** Opens the pairing tab unless a pairing already exists. Never throws; `true` = a tab was opened. */
export async function openWelcomeTab(): Promise<boolean> {
  try {
    const got = await chrome.storage.local.get(STORAGE_KEYS.connection)
    const paired = Boolean((got[STORAGE_KEYS.connection] as { token?: string } | undefined)?.token)
    if (paired) return false
    await chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_PAGE), active: true })
    return true
  } catch (e) {
    console.warn('[tube] could not open the pairing tab', e)
    return false
  }
}

/** `chrome.runtime.onInstalled` handler: only a fresh install opens the tab. */
export function onInstalledWelcome(details: Pick<chrome.runtime.InstalledDetails, 'reason'> | undefined): void {
  if (details?.reason === 'install') void openWelcomeTab()
}
