// Capture helpers of the public screenshots (capture.mjs, used by scripts/docs-screenshots.mjs): the visible-text scan
// (real channel names and YouTube product names are rejected) and the network answers (sample images only, nothing
// leaves for YouTube or Google).
import { describe, expect, it } from 'vitest'
import { REPO_ROOT, readRepoFile } from '../repo.mjs'
import { REAL_CHANNEL_TITLES, avatarSvg, sampleAnswer, scanText } from './capture.mjs'

const demo = JSON.parse(readRepoFile('plugin/data/demo_channels.json')) as { channels: Array<{ title: string }> }

describe('scanText: real channels and brand words', () => {
  it('knows the 40 channel titles of the built-in demo', () => {
    expect(REAL_CHANNEL_TITLES).toEqual(demo.channels.map((c) => c.title))
    expect(REAL_CHANNEL_TITLES).toHaveLength(40)
  })

  it('rejects any real channel title on screen, whole word, case as written', () => {
    for (const title of REAL_CHANNEL_TITLES) {
      const problems = scanText(`Up next\n${title}\n12 min ago`)
      expect(problems.some((p) => p.startsWith('real channel')), title).toBe(true)
    }
    expect(scanText('Watch on @Fireship now').some((p) => p.startsWith('real channel'))).toBe(true)
    // a word that merely contains a short title is not a match
    expect(scanText('Voxel art, colors and a design note').filter((p) => p.startsWith('real channel'))).toEqual([])
  })

  it('rejects YouTube product and trademark wording; plain "YouTube" stays allowed', () => {
    for (const line of ['Try YouTube Premium', 'Open in YouTube Music', 'Google account', 'HermesTube™', 'YouTube Kids']) {
      expect(scanText(line).some((p) => p.startsWith('brand')), line).toBe(true)
    }
    expect(scanText('Open on YouTube\nNot affiliated with YouTube')).toEqual([])
  })

  it('sample data passes', () => {
    expect(scanText('Bench Lamp Electronics\nWildlife Documentaries\nFull episode on Arctic wolves', { expect: ['Wildlife Documentaries'] })).toEqual([])
  })
})

describe('sampleAnswer: images from the sample data, everything else blocked', () => {
  it('thumbnail of a sample video, any size, from the catalog thumbs', () => {
    for (const size of ['mqdefault', 'hqdefault', 'maxresdefault', 'hq2']) {
      const a = sampleAnswer(`https://i.ytimg.com/vi/smpV0004abc/${size}.jpg`)
      expect(a.blocked, size).toBeUndefined()
      expect(a.contentType).toBe('image/jpeg')
      expect(a.file).toBe(`${REPO_ROOT}/docs/sample-data/thumbs/smpV0004abc.jpg`)
      expect(a.body?.length ?? 0).toBeGreaterThan(10_000)
    }
  })

  it('avatar of a sample channel (subscribed or topic): an SVG of its monogram and colors', () => {
    const a = sampleAnswer('https://yt3.googleusercontent.com/sample-avatar/UCsampletech1xxxxxxxxxxx=s176-c-k-c0x00ffffff-no-rj')
    expect(a.contentType).toBe('image/svg+xml')
    expect(String(a.body)).toContain('>BL<')
    expect(String(a.body)).toContain('#1e293b')
    expect(String(sampleAnswer('https://yt3.googleusercontent.com/sample-avatar/UCsampletp1xxxxxxxxxxxxx=s176').body)).toContain('>SC<')
    expect(avatarSvg({ bg: '#000000', fg: '#ffffff', monogram: 'A&B' })).toContain('A&amp;B')
  })

  it('blocks real thumbnails, real avatars, YouTube pages, Google hosts and anything else, naming the URL', () => {
    const urls = [
      'https://i.ytimg.com/vi/wjZofJX0v4M/mqdefault.jpg',
      'https://yt3.googleusercontent.com/ytc/AIdro_nFzZFPLxPZRHcE3SSwzdrbuWqfoWYwLAu0_2iO6blQYAU=s176',
      'https://yt3.googleusercontent.com/sample-avatar/UCnot_in_the_catalogxxxx=s176',
      'https://www.youtube.com/embed/smpV0001abc',
      'https://fonts.googleapis.com/css2?family=Inter',
      'https://example.com/a.png'
    ]
    for (const url of urls) {
      const a = sampleAnswer(url)
      expect(a.blocked, url).toContain(url)
    }
  })
})
