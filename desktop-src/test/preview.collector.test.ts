// @vitest-environment node
// Preview scenario collector, Node side: discovers `**/preview.scenarios.tsx` (outside preview/),
// adds them to the preview bundle, mounts each scenario as a page that can be captured and includes it in the screenshots and the
// audit. The example scenario is written by this test to a temporary folder (fixture inside the test itself).
// (The Desktop tsconfig does not load @types/node: fs/path come through the typed helpers of preview/node.mjs.)
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  REPO_ROOT,
  buildPreview,
  chromiumAvailable,
  discoverScenarioFiles,
  listDir,
  probeScenario,
  readText,
  removeTree,
  takeShots,
  tempTree
} from '../preview/node.mjs'

const abs = (rel: string) => `${REPO_ROOT}/${rel}`

const EXAMPLE_SOURCE = `
import { useEffect, useState } from 'react'
import type { Scenario } from '${abs('desktop-src/preview/scenario')}'
import { restCallLoose } from '${abs('desktop-src/lib/rest')}'
import { callRpc } from '${abs('desktop-src/lib/rpc')}'

function Probe() {
  const [lines, setLines] = useState<string[]>([])
  useEffect(() => {
    void (async () => {
      const feed = await restCallLoose('GET /feed')
      const rpc = await callRpc('theme.create', { theme: 'x' } as never)
      const gone = await restCallLoose('GET /tabs').catch(() => 'failed')
      setLines([\`feed=\${JSON.stringify(feed)}\`, \`rpc=\${rpc.kind}\`, \`tabs=\${String(gone)}\`])
    })()
  }, [])
  return <div data-probe>{lines.map((l) => <p key={l}>{l}</p>)}</div>
}

export const scenarios: Scenario[] = [
  {
    id: 'collector-example',
    title: 'Collector · example',
    widths: [360],
    rest: { 'GET /feed': { items: ['a', 'b'] } },
    rpc: { 'theme.create': () => ({ job_id: 'j1' }) },
    render: () => <Probe />
  }
]
`

let root = ''
let out = ''

beforeAll(() => {
  root = tempTree({
    'pages/demo/preview.scenarios.tsx': EXAMPLE_SOURCE,
    // decoys: inside preview/ and node_modules they do not count; a different name does not either
    'preview/preview.scenarios.tsx': 'export const scenarios = []\n',
    'node_modules/x/preview.scenarios.tsx': 'export const scenarios = []\n',
    'pages/demo/preview.scenarios.test.tsx': '',
    'empty/.keep': ''
  })
  out = `${root}/out`
})

afterAll(() => {
  if (root) removeTree(root)
})

describe('discovery', () => {
  it('finds only **/preview.scenarios.tsx outside preview/ and node_modules', () => {
    const files = discoverScenarioFiles([root])
    expect(files.map((f: string) => f.slice(root.length + 1))).toEqual(['pages/demo/preview.scenarios.tsx'])
  })

  it('in the repository: no file inside desktop-src/preview/', () => {
    for (const f of discoverScenarioFiles()) expect(f).not.toMatch(/desktop-src\/preview\//)
  })
})

describe('build', () => {
  it('zero scenarios is not an error', async () => {
    const res = await buildPreview({ outdir: `${root}/out-empty`, scenarioRoots: [`${root}/empty`] })
    expect(res.scenarioFiles).toEqual([])
    expect(listDir(`${root}/out-empty`)).toContain('preview.js')
  }, 60_000)

  it('adds the discovered scenario to the preview bundle', async () => {
    const res = await buildPreview({ outdir: out, scenarioRoots: [root] })
    expect(res.scenarioFiles).toHaveLength(1)
    const js = readText(`${out}/preview.js`)
    expect(js).toContain('collector-example')
    expect(js).toContain('Collector · example')
  }, 60_000)
})

describe('page that can be captured', () => {
  it.skipIf(!chromiumAvailable())('fake rest/rpc in the browser, a visible error for the missing route and the real-<id> screenshot', async () => {
    const probe = await probeScenario({ outdir: out, id: 'collector-example', width: 360, theme: 'light' })
    expect(probe.errors).toEqual([])
    expect(probe.text).toContain('feed={"items":["a","b"]}')
    expect(probe.text).toContain('rpc=ok')
    expect(probe.text).toContain('tabs=failed')
    expect(probe.missing).toEqual(['GET /tabs'])
    expect(probe.missingVisible).toBe(true)

    const shotsDir = `${root}/shots`
    const report = await takeShots({ outdir: out, views: ['real-collector-example'], widths: [360], themes: ['light'], shotsDir, prefix: 'x-' })
    expect(listDir(shotsDir)).toContain('real-collector-example.light.360.jpg')
    expect(report[0].missing).toEqual(['GET /tabs'])
  }, 120_000)
})
