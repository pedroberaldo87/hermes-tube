// Third-party notices: the build bundles Preact (MIT), whose license requires shipping its copyright and
// permission notice. extension/THIRD_PARTY_NOTICES.txt carries it and the build copies it to the output folder.
import { describe, expect, it } from 'vitest'

// tsconfig.ext.json does not load @types/node: Node modules come in through a dynamic import with a minimal local type.
type Fs = { existsSync(p: string): boolean; readFileSync(p: string, enc: 'utf8'): string; mkdtempSync(prefix: string): string; rmSync(p: string, o: { recursive: true; force: true }): void }
type Cp = { spawnSync(cmd: string, args: string[], o: { cwd: string; env: Record<string, string | undefined>; encoding: 'utf8' }): { status: number | null; stdout: string; stderr: string } }
type Os = { tmpdir(): string }
type Proc = { env: Record<string, string | undefined> }
const load = <T>(m: string): Promise<T> => import(m) as Promise<T>

// the test folder's parent (import.meta.dirname: vitest runs on Node)
const EXT = (import.meta as unknown as { dirname: string }).dirname.replace(/\/test$/, '')
const ROOT = EXT.replace(/\/extension$/, '')
const NOTICES = `${EXT}/THIRD_PARTY_NOTICES.txt`

describe('THIRD_PARTY_NOTICES.txt', () => {
  it('carries the Preact license, the locked version and the project URL', async () => {
    const { readFileSync } = await load<Fs>('node:fs')
    const notices = readFileSync(NOTICES, 'utf8')
    const license = readFileSync(`${ROOT}/node_modules/preact/LICENSE`, 'utf8').trim()
    const lock = JSON.parse(readFileSync(`${ROOT}/package-lock.json`, 'utf8')) as { packages: Record<string, { version: string }> }
    expect(notices).toContain(license)
    expect(notices).toContain(`preact ${lock.packages['node_modules/preact'].version}`)
    expect(notices).toContain('https://github.com/preactjs/preact')
  })

  it('the build copies it to the output folder', { timeout: 120_000 }, async () => {
    const { existsSync, readFileSync, mkdtempSync, rmSync } = await load<Fs>('node:fs')
    const { spawnSync } = await load<Cp>('node:child_process')
    const { tmpdir } = await load<Os>('node:os')
    const proc = (globalThis as unknown as { process: Proc }).process
    const out = mkdtempSync(`${tmpdir()}/tube-ext-notices-`)
    try {
      const r = spawnSync(`${ROOT}/node_modules/.bin/vite`, ['build', '-c', 'extension/vite.config.ts', '--mode', 'background'], {
        cwd: ROOT,
        env: { ...proc.env, EXT_DIST_DIR: out },
        encoding: 'utf8'
      })
      expect(r.status, r.stderr).toBe(0)
      expect(existsSync(`${out}/THIRD_PARTY_NOTICES.txt`)).toBe(true)
      expect(readFileSync(`${out}/THIRD_PARTY_NOTICES.txt`, 'utf8')).toBe(readFileSync(NOTICES, 'utf8'))
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})
