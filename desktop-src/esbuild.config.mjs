#!/usr/bin/env node
// Desktop build: desktop-src/main.tsx → <out>/plugin.js, a single readable ESM whose
// only imports are the three specifiers the Hermes Desktop resolves at runtime.
//
//   node desktop-src/esbuild.config.mjs [--outdir <dir>]
//
// Output: --outdir > env DESKTOP_OUT > <tmp>/tube-desktop-build. Never writes to plugin/desktop/
// by default (the artifact only lands there through an explicit --outdir).
// Without desktop-src/main.tsx → SKIP warning and exit code 0. Fails if plugin.js exceeds 1 MB or if
// an import outside the allowed list is left over (e.g. bundled React or an unresolved package).
import { build } from 'esbuild'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rawCssPlugin } from './styles/esbuild-raw-css.mjs'

export const EXTERNALS = ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime']
export const MAX_BYTES = 1024 * 1024

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const entry = join(here, 'main.tsx')

function argOf(name) {
  const args = process.argv.slice(2)
  const i = args.indexOf(name)
  if (i >= 0 && args[i + 1]) return args[i + 1]
  const eq = args.find((a) => a.startsWith(`${name}=`))
  return eq ? eq.slice(name.length + 1) : undefined
}

if (!existsSync(entry)) {
  console.log('SKIP build:desktop (desktop-src/main.tsx missing)')
  process.exit(0)
}

const outdir = resolve(argOf('--outdir') || process.env.DESKTOP_OUT || join(tmpdir(), 'tube-desktop-build'))
const outfile = join(outdir, 'plugin.js')
mkdirSync(outdir, { recursive: true })

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const result = await build({
  absWorkingDir: root,
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'react',
  minify: false,
  sourcemap: false,
  legalComments: 'inline',
  charset: 'utf8',
  external: EXTERNALS,
  alias: { '@shared': join(root, 'shared') },
  loader: { '.json': 'json', '.svg': 'text', '.css': 'text' },
  // plugin stylesheets (`*.css?raw`) are inlined as readable text, line by line
  plugins: [rawCssPlugin()],
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: `// HermesTube v${version}. Built from desktop-src/ by desktop-src/esbuild.config.mjs. Do not edit by hand.` },
  metafile: true,
  logLevel: 'warning'
})

// imports left in the bundle: only the three externals are accepted
const leftovers = new Set()
for (const out of Object.values(result.metafile.outputs)) {
  for (const imp of out.imports || []) {
    if (imp.external && !EXTERNALS.includes(imp.path)) leftovers.add(imp.path)
  }
}
// bundled React/ReactDOM breaks the app (two copies of React): only through the external import
const embedded = Object.keys(result.metafile.inputs).filter((p) =>
  /(^|\/)node_modules\/(react|react-dom|scheduler)\//.test(p)
)
if (embedded.length) {
  console.error(`FAIL build:desktop: embedded React in the bundle: ${embedded.slice(0, 5).join(', ')}`)
  process.exit(1)
}
if (leftovers.size) {
  console.error(`FAIL build:desktop: imports outside the list ${JSON.stringify(EXTERNALS)}: ${[...leftovers].join(', ')}`)
  process.exit(1)
}

const size = statSync(outfile).size
if (size > MAX_BYTES) {
  console.error(`FAIL build:desktop: ${outfile} has ${size} bytes (> ${MAX_BYTES})`)
  process.exit(1)
}
console.log(`OK build:desktop ${outfile} (${(size / 1024).toFixed(1)} KiB)`)
