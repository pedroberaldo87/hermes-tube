// Pure parts of the sidebar (content/sidebar/model.ts): normalized state, folder tree with recursive counts,
// numbers, video age and safe links.
import { describe, expect, it } from 'vitest'
import type { ExtState, FolderCount } from '../../shared/api-types'
import {
  buildFolderTree,
  durationLabel,
  formatCount,
  isVideoId,
  normalizeState,
  relativeAge,
  thumbUrl,
  visibleKeys,
  watchUrl
} from '../src/content/sidebar/model'

const folder = (folder_id: string, count: number, parent_id: string | null = null, name = folder_id): FolderCount => ({
  folder_id,
  name,
  count,
  parent_id
})

describe('normalizeState', () => {
  it('tolerates missing or wrongly typed fields (untrusted data)', () => {
    const s = normalizeState({
      new_total: -3,
      tabs: [{ tab_id: 't1', name: 'Tudo', count: 4, icon: null }, { tab_id: 5, name: 'x' }, null],
      folders: 'nope',
      refresh_running: 'yes',
      language: 'pt-BR'
    } as unknown as ExtState)
    expect(s.total).toBe(0)
    expect(s.tabs).toEqual([{ id: 't1', name: 'Tudo', count: 4, icon: null }])
    expect(s.folders).toEqual([])
    expect(s.refreshing).toBe(false)
  })

  it('non-numeric counts become 0; an empty name is kept as text', () => {
    const s = normalizeState({ new_total: 2.7, tabs: [], folders: [{ folder_id: 'a', name: '', count: 'x', parent_id: null }] } as unknown as ExtState)
    expect(s.total).toBe(2)
    expect(s.folders).toEqual([{ folder_id: 'a', name: '', count: 0, parent_id: null }])
  })
})

describe('buildFolderTree', () => {
  it('3 levels: children under the parent, recursive server count', () => {
    const tree = buildFolderTree([folder('tech', 9), folder('rust', 5, 'tech'), folder('async', 2, 'rust'), folder('music', 0)])
    expect(tree.map((n) => n.id)).toEqual(['tech', 'music'])
    const tech = tree[0]
    expect(tech.count).toBe(9)
    expect(tech.level).toBe(1)
    expect(tech.children[0].id).toBe('rust')
    expect(tech.children[0].level).toBe(2)
    expect(tech.children[0].children[0]).toMatchObject({ id: 'async', level: 3, count: 2 })
  })

  it('a parent never shows less than the sum of its children (inconsistent count)', () => {
    const tree = buildFolderTree([folder('a', 1), folder('b', 3, 'a'), folder('c', 4, 'a')])
    expect(tree[0].count).toBe(7)
  })

  it('a missing parent becomes a root; a cycle does not hang; a repeated id enters once', () => {
    const tree = buildFolderTree([folder('x', 1, 'ghost'), folder('p', 1, 'q'), folder('q', 1, 'p'), folder('x', 9)])
    const ids = (ns: ReturnType<typeof buildFolderTree>): string[] => ns.flatMap((n) => [n.id, ...ids(n.children)])
    expect(ids(tree).sort()).toEqual(['p', 'q', 'x'])
  })
})

describe('visibleKeys', () => {
  it('lists visible tabs and folders in order, descending only into open ones', () => {
    const tree = buildFolderTree([folder('tech', 9), folder('rust', 5, 'tech'), folder('async', 2, 'rust')])
    const tabs = [{ id: 'all', name: 'Tudo', count: 1, icon: null }]
    expect(visibleKeys(tabs, tree, new Set())).toEqual(['t:all', 'f:tech'])
    expect(visibleKeys(tabs, tree, new Set(['tech']))).toEqual(['t:all', 'f:tech', 'f:rust'])
    expect(visibleKeys(tabs, tree, new Set(['tech', 'rust']))).toEqual(['t:all', 'f:tech', 'f:rust', 'f:async'])
  })
})

describe('numbers and texts', () => {
  it('formatCount: zero disappears, compact thousands in the language', () => {
    expect(formatCount(0, 'en')).toBe('')
    expect(formatCount(7, 'en')).toBe('7')
    expect(formatCount(1500, 'en')).toBe('1.5K')
    expect(formatCount(1500, 'pt-BR')).toMatch(/^1,5\s?mil$/)
  })

  it('relativeAge: server seconds → text in the language', () => {
    const now = Date.UTC(2026, 10, 10, 12, 0, 0)
    expect(relativeAge(now / 1000 - 3 * 3600, now, 'en')).toBe('3 hours ago')
    expect(relativeAge(now / 1000 - 2 * 86400, now, 'pt-BR')).toBe('há 2 dias')
    expect(relativeAge(null, now, 'en')).toBe('')
  })

  it('durationLabel', () => {
    expect(durationLabel(65)).toBe('1:05')
    expect(durationLabel(3725)).toBe('1:02:05')
    expect(durationLabel(null)).toBe('')
    expect(durationLabel(0)).toBe('')
  })
})

describe('safe links', () => {
  it('only valid video ids become a link to https://www.youtube.com/watch', () => {
    expect(isVideoId('dQw4w9WgXcQ')).toBe(true)
    expect(isVideoId('javascript:alert(1)')).toBe(false)
    expect(isVideoId('abc')).toBe(false)
    expect(isVideoId('dQw4w9WgXcQ"><')).toBe(false)
    expect(watchUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(thumbUrl('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
  })
})
