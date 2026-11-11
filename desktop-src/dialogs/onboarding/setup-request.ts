// The fixed request the "Ask Hermes to help" button puts in a new chat (or copies, on a Desktop without the composer
// API). Written by us, always in English, filled only with what the setup already knows: the operating system, the
// folder path, the chosen browser and its Extensions page (and, with Hermes inside WSL, what to check on the Windows
// side). It never runs anything by itself: the person reads it and
// presses Send. The rules at the end keep the agent away from the browser's profile and from the gestures the browser
// requires, and make it ask before installing anything.
import type { ExtensionBrowser, ExtensionSetupPlatform, ExtensionSetupWsl } from '../../../shared/api-types'

export const DEFAULT_EXTENSIONS_URL = 'chrome://extensions/'

const OS_NAME: Record<ExtensionSetupPlatform, string> = {
  macos: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
  other: 'an operating system Hermes cannot open apps on'
}

/** Hermes inside WSL: the `wsl` field of the status and the result. `windows_folder`: the folder is in the Windows
 * user folder (else on the WSL disk). */
export type WslInfo = ExtensionSetupWsl

export interface HermesRequestInput {
  platform: ExtensionSetupPlatform | null
  /** The extension folder on the computer where Hermes runs (as that system writes it). */
  path: string
  browser: ExtensionBrowser | null
  /** `true` when the folder already exists (the setup button was pressed). */
  folderReady: boolean
  /** The app talks to a Hermes on another computer. */
  remote: boolean
  /** Hermes runs inside WSL on this Windows computer. */
  wsl?: WslInfo | null
}

/** Shell-safe single-quoted argument (POSIX). */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

const SAFE_APP_ID = /^[A-Za-z0-9._-]{1,200}$/

/** `flatpak override` line that gives a Flatpak browser read access to the folder; `null` when not applicable. */
export function flatpakAccessCommand(browser: ExtensionBrowser | null, path: string): string | null {
  if (!browser || browser.sandbox !== 'flatpak' || !browser.app_id || !SAFE_APP_ID.test(browser.app_id) || !path) return null
  return `flatpak override --user --filesystem=${shellQuote(`${path}:ro`)} ${browser.app_id}`
}

export function buildHermesRequest({ platform, path, browser, folderReady, remote, wsl }: HermesRequestInput): string {
  const name = browser?.name ?? 'a Chromium browser (Chrome, Edge, Brave, Chromium, Vivaldi or Opera)'
  const url = browser?.extensions_url ?? DEFAULT_EXTENSIONS_URL
  const system = platform ? OS_NAME[platform] : 'unknown'
  const lines: string[] = [
    'Please help me finish installing the HermesTube browser extension. Guide me step by step; I will do the clicks in the browser myself.',
    '',
    `- Computer where Hermes runs: ${wsl ? `Windows, with Hermes inside WSL${wsl.distro ? ` (${wsl.distro})` : ''}` : system}`,
    `- Extension folder: ${path || '(not known yet)'}${folderReady ? ' (already prepared by the HermesTube plugin)' : ' (the HermesTube plugin creates it when I press "Set up the extension")'}`,
    `- Browser: ${name} (Extensions page: ${url})`
  ]
  if (browser?.sandbox) {
    lines.push(
      `- The browser is installed as a ${browser.sandbox === 'flatpak' ? 'Flatpak' : 'snap'}${browser.app_id ? ` (${browser.app_id})` : ''}; ${browser.folder_visible ? 'it should be able to read the folder.' : 'it may not be able to read the folder.'}`
    )
  }
  if (remote) {
    lines.push('- I use the Hermes app from another computer. The extension only talks to a Hermes on the same computer as the browser.')
  }
  if (wsl) {
    lines.push(
      '- The browser runs on Windows; Hermes runs inside WSL. The extension reaches Hermes at 127.0.0.1 through WSL\'s localhost forwarding. If pairing never connects, I can turn on mirrored networking (networkingMode=mirrored under [wsl2] in %USERPROFILE%\\.wslconfig, then wsl --shutdown and start Hermes again).'
    )
    if (!wsl.interop) {
      lines.push('- WSL interop is off, so Hermes could not start Windows programs: I open the browser and the folder myself.')
    }
    if (!wsl.windows_folder) {
      lines.push(
        "- Hermes did not find my Windows user folder, so the extension folder is on WSL's disk. If the browser does not accept that path, I can copy the folder to my Windows user folder and load the copy."
      )
    }
  }
  lines.push(
    '',
    'What the browser needs from me:',
    `1. Open ${url} in ${browser?.name ?? 'the browser'}.`,
    '2. Turn on "Developer mode".',
    '3. Click "Load unpacked" and choose the folder above (or drag the folder onto the page).',
    '4. The extension opens a tab that asks for a 6-digit code; HermesTube shows the code in its "Connect the browser extension" dialog.',
    '',
    'You may check that the folder exists, list its files and look at what is installed, and explain what you find. Rules:',
    "- Do not read, change or delete anything in the browser's profile or settings (Preferences, Secure Preferences, extension databases, cookies, history).",
    '- Do not try to get around the steps the browser requires: no command-line flags such as --load-extension, no browser policies, no automated clicks or keystrokes on my screen. I turn on Developer mode and load the folder myself.',
    '- Do not install, download, update or remove anything without first telling me what and why, and waiting for my OK.',
    '- Do not change or delete the extension folder. If it is missing or broken, tell me to press "Set up the extension" in HermesTube again.'
  )
  return lines.join('\n')
}

type ComposerHost = {
  newChat?: (profile?: null | string) => void
  composer?: { setDraft?: (sessionId: null | string, text: string) => Promise<boolean> }
}

/** The Desktop exposes the public composer API (`host.newChat` + `host.composer.setDraft`). */
export function canAskHermes(host: unknown): boolean {
  const h = host as ComposerHost | null | undefined
  return typeof h?.newChat === 'function' && typeof h?.composer?.setDraft === 'function'
}

export const ASK_ATTEMPTS = 8
export const ASK_RETRY_MS = 250

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Opens a new chat and puts *text* in its composer as a draft — never sends it (no `submit`). The new chat's composer
 * mounts a moment after `newChat()`, so the draft is retried a few times. `true` = the draft is there.
 */
export async function askHermes(host: unknown, text: string): Promise<boolean> {
  if (!canAskHermes(host)) return false
  const h = host as Required<ComposerHost> & { composer: { setDraft: (s: null | string, t: string) => Promise<boolean> } }
  try {
    h.newChat()
  } catch {
    return false
  }
  for (let i = 0; i < ASK_ATTEMPTS; i += 1) {
    await wait(ASK_RETRY_MS)
    try {
      if (await h.composer.setDraft('new', text)) return true
    } catch {
      // the composer is not there yet: try again
    }
  }
  return false
}
