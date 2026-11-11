// MV3 extension build. One Vite build per target, picked by `--mode`:
//
//   vite build -c extension/vite.config.ts --mode background   → background.js (ESM, service worker)
//   vite build -c extension/vite.config.ts --mode content      → content.js    (IIFE, content script)
//   vite build -c extension/vite.config.ts --mode main-world   → main-world.js (IIFE, MAIN world; optional)
//   vite build -c extension/vite.config.ts --mode popup        → popup/index.html + assets/
//
// `npm run build:ext` runs the targets in sequence (background first: it empties the folder and copies
// manifest.json, THIRD_PARTY_NOTICES.txt and extension/public/). Content scripts cannot be ESM in MV3, hence
// IIFE with everything bundled.
//
// Output: env EXT_DIST_DIR (scripts/check exports a temporary folder); default <tmp>/tube-ext-dist.
// Never writes to extension/dist by default. Not minified (the bundle must stay readable).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import preact from '@preact/preset-vite'
import { defineConfig, type Plugin, type UserConfig } from 'vite'

const EXT = dirname(fileURLToPath(import.meta.url))
const SRC = join(EXT, 'src')
const ROOT = resolve(EXT, '..')

export const ENTRIES = {
  background: join(SRC, 'background', 'index.ts'),
  content: join(SRC, 'content', 'bootstrap.ts'),
  'main-world': join(SRC, 'content', 'main-world.ts'),
  popup: join(SRC, 'popup', 'index.html')
} as const
type Target = keyof typeof ENTRIES

export const outDir = resolve(process.env.EXT_DIST_DIR || join(tmpdir(), 'tube-ext-dist'))

/** files copied as-is to the root of the output (the bundle embeds Preact, MIT: its notice ships with it) */
export const COPIED_FILES = ['manifest.json', 'THIRD_PARTY_NOTICES.txt'] as const

// copies COPIED_FILES to the root of the output; extension/public/ is copied by Vite itself
function copyRootFiles(): Plugin {
  return {
    name: 'tube-copy-root-files',
    apply: 'build',
    closeBundle() {
      mkdirSync(outDir, { recursive: true })
      for (const name of COPIED_FILES) {
        const src = join(EXT, name)
        if (existsSync(src)) copyFileSync(src, join(outDir, name))
      }
    }
  }
}

export default defineConfig(({ mode }): UserConfig => {
  if (!(mode in ENTRIES)) {
    throw new Error(`extension/vite.config.ts: --mode must be one of ${Object.keys(ENTRIES).join(', ')} (got "${mode}")`)
  }
  const target = mode as Target
  const entry = ENTRIES[target]
  if (!existsSync(entry)) {
    throw new Error(`extension/vite.config.ts: missing entry for "${target}": ${entry}`)
  }

  const common: UserConfig = {
    root: SRC,
    envDir: false,
    publicDir: target === 'background' ? join(EXT, 'public') : false,
    logLevel: 'warn',
    clearScreen: false,
    plugins: [preact()],
    resolve: { alias: { '@shared': join(ROOT, 'shared') } },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') }
  }
  const build: UserConfig['build'] = {
    outDir,
    emptyOutDir: target === 'background',
    minify: false,
    sourcemap: false,
    target: 'chrome120',
    modulePreload: false,
    reportCompressedSize: false,
    copyPublicDir: target === 'background'
  }

  if (target === 'popup') {
    return {
      ...common,
      base: './',
      build: {
        ...build,
        rolldownOptions: {
          input: { popup: entry },
          output: {
            entryFileNames: 'assets/[name].js',
            chunkFileNames: 'assets/[name]-[hash].js',
            assetFileNames: 'assets/[name]-[hash][extname]'
          }
        }
      }
    }
  }

  const iife = target !== 'background'
  return {
    ...common,
    plugins: target === 'background' ? [...(common.plugins ?? []), copyRootFiles()] : common.plugins,
    build: {
      ...build,
      lib: {
        entry,
        formats: [iife ? 'iife' : 'es'],
        name: iife ? `tube_${target.replace('-', '_')}` : undefined,
        fileName: () => `${target}.js`
      },
      rolldownOptions: { output: { codeSplitting: false } }
    }
  }
})
