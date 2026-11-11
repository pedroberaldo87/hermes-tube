// First load: when Chrome installs the extension (the person dragged the folder in or chose "Load
// unpacked"), the extension opens its own pairing screen in a tab, so the next step is typing the code
// Hermes shows. Only on a fresh install and only while not paired; never on a reload or an update.
import { describe, expect, it } from 'vitest'
import { STORAGE_KEYS } from '../../shared/ext-messages'
import { EXT_PORTS } from '../../shared/ids'
import { WELCOME_PAGE, isWelcomeSurface, openWelcomeTab } from '../src/background/welcome'
import { createBackground } from '../src/lib/background'
import { ExtClient, chromeConnectionStore } from '../src/lib/client'
import { BACKGROUND_MODULES } from '../src/lib/registry-background'
import { chromeFake } from './setup-chrome'
import { FakeNet } from './setup-net'

const CONN = { port: EXT_PORTS[0], token: 'tok-A', device_id: 'dev-A', paired_at: 1 }

function started() {
  const net = new FakeNet()
  const client = new ExtClient({ fetch: net.fetch, store: chromeConnectionStore(), now: () => 1 })
  const bg = createBackground({ client, modules: BACKGROUND_MODULES, now: () => 1 })
  bg.start()
  return bg
}

const openTabs = () => [...chromeFake().tabs.values()].map((t) => t.url)
const welcomeUrl = () => chrome.runtime.getURL(WELCOME_PAGE)

describe('first load opens the pairing screen', () => {
  it('fresh install, not paired: one tab with the popup page in tab mode', async () => {
    started()
    chromeFake().events.installed.emit({ reason: 'install' } as chrome.runtime.InstalledDetails)
    await chromeFake().flush()
    expect(openTabs()).toEqual([welcomeUrl()])
    expect(welcomeUrl()).toMatch(/^chrome-extension:\/\/[a-p]{32}\/popup\/index\.html\?welcome=1$/)
  })

  it('reload / update of the extension: no tab', async () => {
    started()
    chromeFake().events.installed.emit({ reason: 'update', previousVersion: '0.1.0' } as chrome.runtime.InstalledDetails)
    await chromeFake().flush()
    expect(openTabs()).toEqual([])
  })

  it('already paired (token kept): no tab', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.connection]: CONN })
    started()
    chromeFake().events.installed.emit({ reason: 'install' } as chrome.runtime.InstalledDetails)
    await chromeFake().flush()
    expect(openTabs()).toEqual([])
  })

  it('a failing tabs API does not break the service worker', async () => {
    const original = chrome.tabs.create
    ;(chrome.tabs as { create: unknown }).create = () => Promise.reject(new Error('no window'))
    try {
      await expect(openWelcomeTab()).resolves.toBe(false)
    } finally {
      ;(chrome.tabs as { create: unknown }).create = original
    }
  })

  it('the popup knows when it is shown in a tab', () => {
    expect(isWelcomeSurface('?welcome=1')).toBe(true)
    expect(isWelcomeSurface('')).toBe(false)
    expect(isWelcomeSurface('?other=1')).toBe(false)
  })
})
