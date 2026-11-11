// CSS guard found in the real app: inside a container query, `display` may only be `none`.
// Changing an element's `display` (flex → grid) when crossing the query limit leaves, in Chromium, the
// children of a nested query container without a box: on the Subscriptions featured card, title, description
// and actions disappeared when the sidebar opened. The preview does not catch it (each screenshot starts at the final width).
import { describe, expect, it } from 'vitest'

import { listRepoFiles, readRepoFile } from './repo.mjs'

interface Block {
  head: string
  body: string
}

function containerBlocks(source: string): Block[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '') // a comment may mention the word
  const out: Block[] = []
  const re = /@container[^{]*\{/g
  let m: RegExpExecArray | null

  while ((m = re.exec(css))) {
    let i = m.index + m[0].length
    let depth = 1

    while (depth && i < css.length) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }

    out.push({ head: m[0].replace(/\s+/g, ' ').trim(), body: css.slice(m.index + m[0].length, i - 1) })
  }

  return out
}

describe('container queries', () => {
  const files: string[] = listRepoFiles('desktop-src/styles').filter((f: string) => f.endsWith('.css'))

  it('there are stylesheets with queries to look at', () => {
    expect(files.length).toBeGreaterThan(3)
    expect(files.flatMap((f) => containerBlocks(readRepoFile(f))).length).toBeGreaterThan(3)
  })

  it('the parser sees the display change and ignores comments', () => {
    const blocks = containerBlocks('/* @container x { display: grid } */ @container a (min-width: 1px) { .b { display: grid; } }')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].body).toContain('display: grid')
  })

  it('inside the query, display only hides (none): never changes the box type', () => {
    const bad: string[] = []

    for (const f of files) {
      for (const block of containerBlocks(readRepoFile(f))) {
        for (const d of block.body.matchAll(/(?<![-\w])display\s*:\s*([^;}]+)/g)) {
          if (d[1].trim() !== 'none') bad.push(`${f} · ${block.head} · display: ${d[1].trim()}`)
        }
      }
    }

    expect(bad).toEqual([])
  })
})
