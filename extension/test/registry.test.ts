// Module registry: complete skeletons and exported REAL_ROUTES.
import { describe, expect, it } from 'vitest'
import { CORE_MESSAGES, CORE_ROUTES } from '../src/lib/background'
import { BACKGROUND_MODULES } from '../src/lib/registry-background'
import { CONTENT_MODULES } from '../src/lib/registry-content'
import { EXT_REQUEST_TYPES, EXT_ROUTE_KEYS, EXT_TAB_COMMAND_TYPES } from '../src/lib/routes'

const ALL = [...BACKGROUND_MODULES, ...CONTENT_MODULES]

describe('extension modules', () => {
  it('all expected modules exist, with a unique name', () => {
    expect(BACKGROUND_MODULES.map((m) => m.MODULE).sort()).toEqual(
      ['background/pairing', 'background/history', 'background/sync', 'background/queue', 'background/search'].sort()
    )
    expect(CONTENT_MODULES.map((m) => m.MODULE).sort()).toEqual(
      ['content/scraper', 'content/tracker', 'content/unsubscribe', 'content/search', 'content/sidebar', 'content/thumbs', 'content/home'].sort()
    )
    expect(new Set(ALL.map((m) => m.MODULE)).size).toBe(ALL.length)
  })

  it('REAL_ROUTES ⊆ ROUTES ⊆ contract routes (skeleton: empty REAL_ROUTES)', () => {
    for (const m of ALL) {
      expect(Array.isArray(m.REAL_ROUTES), m.MODULE).toBe(true)
      for (const r of m.ROUTES) expect(EXT_ROUTE_KEYS, `${m.MODULE} ${r}`).toContain(r)
      for (const r of m.REAL_ROUTES) expect(m.ROUTES, `${m.MODULE} ${r}`).toContain(r)
    }
  })

  it('every contract route has an extension module that uses it', () => {
    const used = new Set([...CORE_ROUTES, ...ALL.flatMap((m) => m.ROUTES)])
    expect([...EXT_ROUTE_KEYS].filter((r) => !used.has(r))).toEqual([])
  })

  it('each ExtRequests message has exactly one owner (core or module)', () => {
    const owners = [...CORE_MESSAGES, ...BACKGROUND_MODULES.flatMap((m) => m.MESSAGES)]
    expect([...owners].sort()).toEqual([...EXT_REQUEST_TYPES].sort())
  })

  it('each tab command (ExtTabCommands) has exactly one content module', () => {
    const cmds = CONTENT_MODULES.flatMap((m) => m.COMMANDS)
    expect([...cmds].sort()).toEqual([...EXT_TAB_COMMAND_TYPES].sort())
    for (const m of CONTENT_MODULES) for (const c of m.COMMANDS) expect(typeof m.commands?.[c], `${m.MODULE} ${c}`).toBe('function')
  })
})
