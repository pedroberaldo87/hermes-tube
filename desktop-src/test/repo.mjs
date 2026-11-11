// Test helpers that need Node (fs, child_process). They live in .mjs because the project's
// tsconfig.desktop.json does not load @types/node; the types are in repo.d.mts.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(here, '..', '..')
export const DESKTOP_SRC = join(REPO_ROOT, 'desktop-src')

const toPosix = (p) => p.split(sep).join('/')

/** Reads a repository file (path relative to the root). */
export function readRepoFile(rel) {
  return readFileSync(join(REPO_ROOT, rel), 'utf8')
}

export function repoFileExists(rel) {
  return existsSync(join(REPO_ROOT, rel))
}

/** Lists files (relative to the root, with `/`) under `relDir`, recursively, filtered by extension. */
export function listRepoFiles(relDir, exts) {
  const out = []
  const walk = (abs) => {
    if (!existsSync(abs)) return
    for (const name of readdirSync(abs)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const p = join(abs, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (!exts || exts.some((e) => name.endsWith(e))) out.push(toPosix(relative(REPO_ROOT, p)))
    }
  }
  walk(join(REPO_ROOT, relDir))
  return out.sort()
}

/** import/export/import() specifiers of a TS/TSX file (not resolved). */
export function importSpecifiers(code) {
  const specs = new Set()
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\w*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  ]
  for (const re of patterns) for (const m of code.matchAll(re)) specs.add(m[1])
  return [...specs]
}

/** Resolves a relative import from `fromRel` to a root-relative path (extension not guaranteed). */
export function resolveRelative(fromRel, spec) {
  return toPosix(relative(REPO_ROOT, resolve(REPO_ROOT, dirname(fromRel), spec)))
}

/**
 * Builds the Desktop plugin with the project's esbuild config in a temporary folder and returns
 * `{ outdir, file, code, bytes, stdout }`. Throws if the build fails.
 */
export function buildDesktopBundle() {
  const outdir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'tube-desktop-bundle-'))
  const stdout = execFileSync(process.execPath, [join(DESKTOP_SRC, 'esbuild.config.mjs'), '--outdir', outdir], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const file = join(outdir, 'plugin.js')
  const code = readFileSync(file, 'utf8')
  return { outdir, file, code, bytes: statSync(file).size, stdout }
}

export const EXTERNALS = ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime']
export const MAX_BYTES = 1024 * 1024

// Markers of an embedded React/ReactDOM: whoever embeds the package brings these texts into the bundle.
const REACT_MARKERS = [
  /__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE/,
  /__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/,
  /__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE/,
  /Symbol\.for\(\s*["']react\.(transitional\.)?element["']\s*\)/,
  /\/\/ node_modules\/(react|react-dom|scheduler)\//,
  /\bfunction\s+useState\s*\(/,
  /react-dom\.production/
]

/**
 * Inspects the `plugin.js` text. Returns the list of problems (empty = ok):
 * an import outside the three externals, embedded React, an embedded node_modules package, eval,
 * size ≥ 1 MB, minified look.
 */
export function inspectBundle(code) {
  const problems = []
  const specs = new Set()
  for (const m of code.matchAll(/^\s*import\s+(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"']+)["']/gm)) specs.add(m[1])
  for (const m of code.matchAll(/^\s*export\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/gm)) specs.add(m[1])
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specs.add(m[1])
  for (const s of specs) if (!EXTERNALS.includes(s)) problems.push(`import outside the list: ${s}`)
  for (const re of REACT_MARKERS) if (re.test(code)) problems.push(`embedded React (${re.source})`)
  const bundled = code.match(/^\/\/ node_modules\/[^\n]+/m)
  if (bundled) problems.push(`embedded package: ${bundled[0]}`)
  if (/\beval\s*\(/.test(code) || /\bnew\s+Function\s*\(/.test(code)) problems.push('eval/new Function in the bundle')
  const bytes = new TextEncoder().encode(code).length
  if (bytes >= MAX_BYTES) problems.push(`size ${bytes} ≥ ${MAX_BYTES}`)
  const lines = code.split('\n')
  const longest = Math.max(...lines.map((l) => l.length))
  if (lines.length < 50 || longest > 2000) problems.push(`looks minified (${lines.length} lines, longest ${longest})`)
  return problems
}
