#!/usr/bin/env node
// Static preview (visual language + kit + screen scenarios) outside the app.
//
//   node desktop-src/preview/build.mjs                       → $TMPDIR/preview/index.html
//   node desktop-src/preview/build.mjs --outdir <dir>
//   node desktop-src/preview/build.mjs --shots [--views home,real-feed-empty] [--widths 360,900] [--themes dark]
//        → screenshots in docs/design/shots/<view>.<theme>.<width>.jpg + audit.json (the repository's Playwright)
//   --scenarios-root <dir>[,<dir>]   where to look for **/preview.scenarios.tsx (default desktop-src)
//
// Screen scenarios: each `desktop-src/**/preview.scenarios.tsx` (outside preview/) with
// `export const scenarios: Scenario[]` becomes the page `?scenario=<id>` and, with --shots, the screenshots
// `real-<id>.<theme>.<width>.jpg` (scenario widths or 360/900/1440) — audited like the rest.
// Zero scenarios is not an error. Open index.html in the browser (file://). Thumbnails: i.ytimg.com (network).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_OUTDIR, REPO_ROOT, SHOTS_DIR, THEMES, WIDTHS, buildPreview, issuesOf, listBundledScenarios, takeShots } from './node.mjs'

function argOf(name) {
  const args = process.argv.slice(2)
  const i = args.indexOf(name)
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1]
  const eq = args.find((a) => a.startsWith(`${name}=`))
  return eq ? eq.slice(name.length + 1) : undefined
}
const list = (v, fallback) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback)

const outdir = argOf('--outdir') || DEFAULT_OUTDIR
const scenarioRoots = list(argOf('--scenarios-root'), undefined)
const { files, hasHostCss, scenarioFiles } = await buildPreview({ outdir, scenarioRoots })
console.log(
  `OK preview ${join(outdir, 'index.html')} (${files.length} files${hasHostCss ? ', with the app CSS' : ', WITHOUT the app CSS'}; ` +
    `${scenarioFiles.length} scenario file(s)${scenarioFiles.length ? `: ${scenarioFiles.join(', ')}` : ''})`
)

if (process.argv.includes('--shots')) {
  // class prefix: the same as lib/style.ts (derived from PLUGIN_ID in shared/ids.ts)
  const id = readFileSync(join(REPO_ROOT, 'shared', 'ids.ts'), 'utf8').match(/PLUGIN_ID\s*=\s*'([^']+)'/)?.[1]
  const prefix = `${id.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-`
  const viewsSrc = readFileSync(join(REPO_ROOT, 'desktop-src', 'preview', 'views.tsx'), 'utf8')
  const compositions = JSON.parse(viewsSrc.match(/VIEW_IDS = (\[[^\]]+\])/)[1].replace(/'/g, '"'))
  const bundled = await listBundledScenarios({ outdir })
  for (const p of bundled.problems) console.log(`WARN scenarios: ${p}`)
  const real = bundled.entries.map((s) => `real-${s.id}`)
  const views = list(argOf('--views'), [...compositions, ...real])
  const forced = argOf('--widths')
  const widths = list(forced, WIDTHS).map(Number)
  const byView = new Map(bundled.entries.map((s) => [`real-${s.id}`, s.widths]))
  const widthsFor = (view) => (forced ? widths : (byView.get(view) ?? widths))
  const themes = list(argOf('--themes'), THEMES)
  const report = await takeShots({ outdir, views, widths, widthsFor, themes, prefix, shotsDir: SHOTS_DIR })
  let problems = bundled.problems.length
  for (const r of report) {
    const issues = issuesOf(r)
    problems += issues.length
    console.log(
      `${issues.length ? 'WARN' : 'OK  '} ${r.file} · min contrast ${r.contrast.min}:1 (${r.contrast.checked} texts) · thumbnails ${r.thumbs.loaded}/${r.thumbs.total} · avatars ${r.avatars.loaded}/${r.avatars.total}${issues.length ? `\n     ${issues.join('\n     ')}` : ''}`
    )
  }
  console.log(`screenshots: ${report.length} in ${SHOTS_DIR} (${real.length} screen scenario(s)) · problems: ${problems}`)
  if (problems) process.exitCode = 1
}
