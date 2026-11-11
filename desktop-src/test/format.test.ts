// Locale formatting: compact numbers, counts and relative time come from Intl in the app
// language — no "661.3k visualizações" in a Portuguese interface.
import { describe, expect, it } from 'vitest'
import { formatCompact, formatCount, formatDuration, formatRelativeTime } from '../lib/format'

// Intl separates number and unit with a thin/non-breaking space; the test compares the visible text
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0)
const sec = (ms: number) => Math.floor(ms / 1000)

describe('pt-BR', () => {
  it('compact: 661 mil, 14,6 mi, 1,9 mi, 950', () => {
    expect(plain(formatCompact(661_306, 'pt-BR'))).toBe('661 mil')
    expect(plain(formatCompact(14_564_759, 'pt-BR'))).toBe('14,6 mi')
    expect(plain(formatCompact(1_905_521, 'pt-BR'))).toBe('1,9 mi')
    expect(formatCompact(950, 'pt-BR')).toBe('950')
    expect(formatCompact(null, 'pt-BR')).toBe('')
  })

  it('the app locale comes in lowercase (pt-br) and works the same', () => {
    expect(plain(formatCompact(661_306, 'pt-br'))).toBe('661 mil')
  })

  it('count with a thousands separator and relative time', () => {
    expect(formatCount(1204, 'pt-BR')).toBe('1.204')
    expect(formatRelativeTime(sec(NOW - 3 * 86400_000), NOW, 'pt-BR')).toMatch(/há 3 dias/)
  })
})

describe('en', () => {
  it('compact: 661K, 14.6M, 1.9M, 950', () => {
    expect(formatCompact(661_306, 'en')).toBe('661K')
    expect(formatCompact(14_564_759, 'en')).toBe('14.6M')
    expect(formatCompact(1_905_521, 'en')).toBe('1.9M')
    expect(formatCompact(950, 'en')).toBe('950')
  })

  it('count and relative time', () => {
    expect(formatCount(1204, 'en')).toBe('1,204')
    expect(formatRelativeTime(sec(NOW - 2 * 3600_000), NOW, 'en')).toMatch(/2 hr/)
  })
})

describe('robustness', () => {
  it('an invalid locale falls back to English without throwing', () => {
    expect(formatCompact(661_306, 'xx-INVALID-@@')).toMatch(/661/)
    expect(formatCount(5, '')).toBe('5')
  })

  it('duration does not depend on the language', () => {
    expect(formatDuration(3955)).toBe('1:05:55')
  })
})
