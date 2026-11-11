#!/usr/bin/env node
// Generates desktop-src/types/hermes-plugin-sdk.d.ts: SELF-CONTAINED declarations of the Hermes
// Desktop `@hermes/plugin-sdk` module, so the project's `tsc` does not depend on the Hermes checkout.
//
// Runs ONCE (and again only when the Desktop changes the SDK); the result is committed.
//
//   node scripts/gen-sdk-dts.mjs [--webapp <dir>] [--out <file>]
//
// How it works (nothing is written inside Hermes; the tsc emit stays in memory):
//   1. compiles `apps/desktop/src/sdk/index.ts` with the app's own tsconfig (`noCheck`,
//      `emitDeclarationOnly`) and keeps the emitted `.d.ts` files in a Map;
//   2. walks the import graph from the emitted `index.d.ts`, resolving with the same
//      options as the app (aliases `@/…`, `@hermes/shared…`, the app's node_modules);
//   3. every module reached becomes a `declare module "<synthetic name>" { … }` in the SAME file:
//        - `@hermes/plugin-sdk`                       → the SDK index itself
//        - `@hermes/plugin-sdk/~app/<path>`            → app files (`apps/…`)
//        - `@hermes/plugin-sdk/~vendor/<package>/<file>` → types of the VENDOR packages (copied)
//        - `@hermes/plugin-sdk/~ext/<package>`         → other packages: an `any` stub
//      `react`, `react-dom`, `react/jsx-runtime` and `csstype` stay real imports (the project
//      has `@types/react`/`@types/react-dom` in the same major version as the app);
//   4. removes redundant `declare`, `declare global {}` (no app globals leak into the plugin),
//      `/// <reference>` and `export as namespace`.
// With `skipLibCheck: true`, internal names that fall into a stub silently become `any`; what the
// plugin actually uses (host, components, useQuery, atom/computed, contract types) stays typed.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const WEBAPP = resolve(
  argOf(
    '--webapp',
    process.env.HERMES_WEBAPP_DIR ||
      join(process.env.HERMES_SRC || join(homedir(), '.hermes', 'hermes-agent'), '.build', 'webapp-workspace')
  )
)
const APPS = join(WEBAPP, 'apps')
const APP = join(APPS, 'desktop')
const ENTRY = join(APP, 'src', 'sdk', 'index.ts')
const OUT = resolve(argOf('--out', join(ROOT, 'desktop-src', 'types', 'hermes-plugin-sdk.d.ts')))

const SDK = '@hermes/plugin-sdk'
// imports that stay real (resolved by the project's @types)
const KEEP = new Set(['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'csstype'])
const keepSpecifier = (s) => KEEP.has(s) || s.startsWith('react-dom/')
// packages whose types are copied (small and used directly by plugins)
const VENDOR = [
  '@tanstack/react-query',
  '@tanstack/query-core',
  'nanostores',
  '@nanostores/react',
  'class-variance-authority',
  'clsx'
]

function die(msg) {
  console.error(`gen-sdk-dts: ${msg}`)
  process.exit(1)
}

if (!existsSync(ENTRY)) die(`SDK not found at ${ENTRY} (use --webapp <dir>)`)

// ---------------------------------------------------------------- 1. in-memory emit
const cfgPath = join(APP, 'tsconfig.json')
const cfg = ts.getParsedCommandLineOfConfigFile(cfgPath, {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (d) => die(ts.flattenDiagnosticMessageText(d.messageText, '\n'))
})
const OUTDIR = '/__sdk_dts_virtual_out__'
const options = {
  ...cfg.options,
  noEmit: false,
  declaration: true,
  emitDeclarationOnly: true,
  declarationMap: false,
  sourceMap: false,
  noCheck: true,
  rootDir: APPS,
  outDir: OUTDIR,
  composite: false,
  incremental: false,
  tsBuildInfoFile: undefined
}
// roots: the SDK index + the app's .d.ts files (global types such as src/global.d.ts)
const rootNames = [ENTRY, ...cfg.fileNames.filter((f) => f.endsWith('.d.ts'))]
const host = ts.createCompilerHost(options)
const emitted = new Map() // virtual output path -> text
host.writeFile = (fileName, text) => {
  // never writes to disk: protects the Hermes checkout
  emitted.set(resolve(fileName), text)
}
const program = ts.createProgram({ rootNames, options, host })
program.emit(undefined, undefined, undefined, true)

function emittedDtsFor(srcPath) {
  const rel = relative(APPS, srcPath).replace(/\.(tsx?|mts|cts)$/, '')
  const ext = srcPath.endsWith('.mts') ? '.d.mts' : srcPath.endsWith('.cts') ? '.d.cts' : '.d.ts'
  return emitted.get(resolve(OUTDIR, rel + ext))
}

// ---------------------------------------------------------------- 2. module graph
const toPosix = (p) => p.split(sep).join('/')
const stripDts = (p) => p.replace(/\.d\.(ts|mts|cts)$/, '').replace(/\.(tsx?|mts|cts)$/, '')

function packageNameOf(specifier) {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function vendorPackageOfPath(filePath) {
  const p = toPosix(filePath)
  const idx = p.lastIndexOf('/node_modules/')
  if (idx < 0) return null
  const rest = p.slice(idx + '/node_modules/'.length)
  const name = packageNameOf(rest)
  return VENDOR.includes(name) ? { name, sub: rest.slice(name.length + 1) } : null
}

const modules = new Map() // synthetic name -> { name, file, text }
const stubs = new Map() // package -> { names:Set, default:boolean }
const queue = []

function syntheticFor(filePath) {
  if (resolve(filePath) === ENTRY) return SDK
  const v = vendorPackageOfPath(filePath)
  if (v) return `${SDK}/~vendor/${v.name}/${stripDts(v.sub)}`
  const rel = toPosix(relative(APPS, filePath))
  if (rel.startsWith('..')) return null
  return `${SDK}/~app/${stripDts(rel)}`
}

function enqueue(filePath) {
  const name = syntheticFor(filePath)
  if (!name) return null
  if (!modules.has(name)) {
    let text
    if (/\.d\.(ts|mts|cts)$/.test(filePath)) text = readFileSync(filePath, 'utf8')
    else text = emittedDtsFor(filePath)
    if (text == null) die(`no declaration emitted for ${filePath}`)
    modules.set(name, { name, file: filePath, text })
    queue.push(name)
  }
  return name
}

const resolutionCache = ts.createModuleResolutionCache(APP, (s) => s, options)
function resolveSpecifier(specifier, containingFile) {
  if (keepSpecifier(specifier)) return { keep: true }
  const r = ts.resolveModuleName(specifier, containingFile, options, host, resolutionCache)
  const m = r.resolvedModule
  if (m) {
    const target = m.resolvedFileName
    const isNodeModule = toPosix(target).includes('/node_modules/')
    if (!isNodeModule || vendorPackageOfPath(target)) {
      const name = enqueue(target)
      if (name) return { name }
    }
  }
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@/')) {
    console.warn(`gen-sdk-dts: warning: '${specifier}' (from ${toPosix(relative(APPS, containingFile))}) did not resolve → stub`)
    return { stub: '__unresolved__' }
  }
  return { stub: packageNameOf(specifier) }
}

function stubName(pkg) {
  if (!stubs.has(pkg)) stubs.set(pkg, { names: new Set() })
  return `${SDK}/~ext/${pkg}`
}

// ---------------------------------------------------------------- 3. rewrite
function rewrite(mod) {
  const sf = ts.createSourceFile(mod.file, mod.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const edits = [] // { start, end, text }
  const replaceSpecifier = (lit, stubNamesUsed) => {
    const r = resolveSpecifier(lit.text, mod.file)
    if (r.keep) return
    let target
    if (r.name) target = r.name
    else {
      target = stubName(r.stub)
      for (const n of stubNamesUsed || []) stubs.get(r.stub).names.add(n)
    }
    edits.push({ start: lit.getStart(sf), end: lit.end, text: JSON.stringify(target) })
  }

  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const names = []
      const clause = ts.isImportDeclaration(node) ? node.importClause : null
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) names.push((el.propertyName || el.name).text)
      }
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) names.push((el.propertyName || el.name).text)
      }
      if (ts.isStringLiteral(node.moduleSpecifier)) replaceSpecifier(node.moduleSpecifier, names)
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument
      if (ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal)) {
        const names = []
        if (node.qualifier) {
          let q = node.qualifier
          while (ts.isQualifiedName(q)) q = q.left
          names.push(q.text)
        }
        replaceSpecifier(arg.literal, names)
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const e = node.moduleReference.expression
      if (ts.isStringLiteral(e)) replaceSpecifier(e, [])
    }
    ts.forEachChild(node, visit)
  }

  for (const st of sf.statements) {
    // `declare global { … }` and `export as namespace X` do not fit in an SDK module
    if (ts.isModuleDeclaration(st) && st.flags & ts.NodeFlags.GlobalAugmentation) {
      edits.push({ start: st.getFullStart(), end: st.end, text: '' })
      continue
    }
    // a side-effect-only import (`import './x.css'`) carries no type at all
    if (ts.isImportDeclaration(st) && !st.importClause) {
      edits.push({ start: st.getFullStart(), end: st.end, text: '' })
      continue
    }
    if (ts.isNamespaceExportDeclaration(st)) {
      edits.push({ start: st.getFullStart(), end: st.end, text: '' })
      continue
    }
    // `declare module "x" { … }` (augmenting another package) inside a file: dropped
    if (ts.isModuleDeclaration(st) && ts.isStringLiteral(st.name)) {
      edits.push({ start: st.getFullStart(), end: st.end, text: '' })
      continue
    }
    for (const m of ts.canHaveModifiers(st) ? ts.getModifiers(st) || [] : []) {
      if (m.kind === ts.SyntaxKind.DeclareKeyword) {
        let end = m.end
        while (mod.text[end] === ' ') end++
        edits.push({ start: m.getStart(sf), end, text: '' })
      }
    }
    visit(st)
  }

  edits.sort((a, b) => b.start - a.start)
  let out = mod.text
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  // reference directives (/// <reference …/>) point outside: removed
  out = out.replace(/^\/\/\/\s*<reference\b[^>]*\/>\s*$/gm, '')
  return out
}

enqueue(ENTRY)
const rendered = new Map()
while (queue.length) {
  const name = queue.shift()
  rendered.set(name, rewrite(modules.get(name)))
}

// ---------------------------------------------------------------- 4. output
const indent = (text) =>
  text
    .split('\n')
    .map((l) => (l.trim() ? `  ${l}` : ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()

let commit = 'unknown'
try {
  commit = execFileSync('git', ['-C', join(WEBAPP, '..', '..'), 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()
} catch {
  /* no git: carry on */
}
let tsVersionApp = ''
try {
  tsVersionApp = JSON.parse(readFileSync(join(APP, 'node_modules', 'typescript', 'package.json'), 'utf8')).version
} catch {
  /* optional */
}

const parts = [
  '// GENERATED by scripts/gen-sdk-dts.mjs — do not edit by hand.',
  `// Source: hermes-agent ${commit} · apps/desktop/src/sdk/index.ts${tsVersionApp ? ` · typescript ${tsVersionApp}` : ''}`,
  '// Self-contained: internal app modules become `@hermes/plugin-sdk/~app/…`, copied package types',
  '// become `~vendor/…`, the other packages are `any` stubs in `~ext/…`.',
  '// Import only `import { … } from "@hermes/plugin-sdk"`; the `~…` submodules are an internal detail.',
  '/* eslint-disable */',
  ''
]
const names = [...rendered.keys()].sort((a, b) => (a === SDK ? -1 : b === SDK ? 1 : a < b ? -1 : a > b ? 1 : 0))
for (const name of names) {
  parts.push(`declare module ${JSON.stringify(name)} {`, indent(rendered.get(name)), '}', '')
}
const generics = Array.from({ length: 8 }, (_, i) => `_T${i} = any`).join(', ')
for (const pkg of [...stubs.keys()].sort()) {
  const lines = [`declare module ${JSON.stringify(`${SDK}/~ext/${pkg}`)} {`, '  const __stub: any', '  export default __stub']
  for (const n of [...stubs.get(pkg).names].sort()) {
    if (n === 'default') continue
    lines.push(`  export type ${n}<${generics}> = any`, `  export const ${n}: any`)
  }
  lines.push('}', '')
  parts.push(...lines)
}
const out = parts.join('\n')
writeFileSync(OUT, out)
console.log(
  `gen-sdk-dts: ${toPosix(relative(ROOT, OUT))} — ${names.length} modules, ${stubs.size} stubs, ${(
    out.length / 1024
  ).toFixed(0)} KiB`
)
