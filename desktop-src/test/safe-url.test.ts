// lib/safe-url: what the Desktop opens outside or loads as an image, whatever the database holds. Same rules as
// the backend's safe_channel_url / safe_thumb_url (plugin/core/importers.py), applied again for rows written before.
import { describe, expect, it } from 'vitest'
import { safeChannelUrl, safeImageUrl } from '../lib/safe-url'

const UC = 'UCHnyfMqiRRG1u-2MsSQLbXA'

describe('safeChannelUrl', () => {
  it('keeps https YouTube channel pages, always on www.youtube.com', () => {
    expect(safeChannelUrl('https://www.youtube.com/@veritasium', UC)).toBe('https://www.youtube.com/@veritasium')
    expect(safeChannelUrl('https://youtube.com/channel/' + UC, UC)).toBe(`https://www.youtube.com/channel/${UC}`)
    expect(safeChannelUrl('https://m.youtube.com/@veritasium/videos', UC)).toBe('https://www.youtube.com/@veritasium/videos')
  })

  it.each([
    null,
    undefined,
    '',
    'file:///Applications/Calculator.app',
    'javascript:alert(1)',
    'http://www.youtube.com/@x',
    'https://www.youtube.com.evil.example/@x',
    'https://evil.example/www.youtube.com',
    'https://user:pw' + '@www.youtube.com/@x',
    'https://www.youtube.com:444/@x',
    '@veritasium',
    'hermes://open/x'
  ])('anything else (%s) → the canonical channel page', (bad) => {
    expect(safeChannelUrl(bad, UC)).toBe(`https://www.youtube.com/channel/${UC}`)
  })
})

describe('safeImageUrl', () => {
  it('https on the YouTube image hosts only', () => {
    expect(safeImageUrl('https://yt3.ggpht.com/abc=s88-c-k')).toBe('https://yt3.ggpht.com/abc=s88-c-k')
    expect(safeImageUrl('https://i.ytimg.com/vi/abc/hqdefault.jpg')).toBe('https://i.ytimg.com/vi/abc/hqdefault.jpg')
    expect(safeImageUrl('https://yt3.googleusercontent.com/x')).toBe('https://yt3.googleusercontent.com/x')
    for (const bad of [null, '', 'http://yt3.ggpht.com/x', 'https://ggpht.com.evil.example/x', 'https://evilytimg.com/x', 'https://a' + '@i.ytimg.com/x', 'https://i.ytimg.com:8443/x', 'data:image/png;base64,AA', 'file:///x.png']) {
      expect(safeImageUrl(bad), String(bad)).toBeNull()
    }
  })
})
