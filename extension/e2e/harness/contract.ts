// Contract examples for the stub server: reads contract/api.yaml with the project's Python (pyyaml) and
// returns the `example` of each `x-transport: ext` route + the HTTP status of each error code (`x-error-codes`).
// The "PLUGIN_ID" placeholder in the examples becomes the real id (shared/ids.ts). No Python/pyyaml: minimal examples.
import { spawnSync, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PLUGIN_ID } from '../../../shared/ids.ts'
import { ROOT } from './paths.ts'

export interface ContractExamples {
  /** "METHOD /path" → example envelope */
  routes: Record<string, unknown>
  /** error code → HTTP status on the extension server */
  http: Record<string, number>
  source: 'api.yaml' | 'fallback'
}

/** Project Python: TUBE_PY; else the repository .venv; in a worktree, the main checkout's .venv. */
function projectPython(): string {
  if (process.env.TUBE_PY) return process.env.TUBE_PY
  const candidates = [join(ROOT, '.venv', 'bin', 'python')]
  try {
    const common = execFileSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    if (common) candidates.push(join(dirname(common), '.venv', 'bin', 'python'))
  } catch {
    // no git: only the repository .venv
  }
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}

const PY = projectPython()

const SCRIPT = `
import json, sys, yaml
d = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
routes = {}
for path, ops in d["paths"].items():
    if ops.get("x-transport") != "ext":
        continue
    for m, op in ops.items():
        if m not in ("get", "post"):
            continue
        ex = op["responses"]["200"]["content"]["application/json"].get("example")
        routes[m.upper() + " " + path] = ex
http = {k: v.get("http", 500) for k, v in d.get("x-error-codes", {}).items()}
print(json.dumps({"routes": routes, "http": http}))
`

const FALLBACK: ContractExamples = {
  routes: {
    'GET /health': { ok: true, data: { service: PLUGIN_ID, instance: 'stub', pairing_open: false } },
    'POST /ext/unpair': { ok: true, data: { revoked: true } },
    'GET /ext/feed': { ok: true, data: { items: [], next_cursor: null, counts: { total: 0, new: 0 } } }
  },
  http: { unauthorized: 401, not_found: 404, invalid: 422, conflict: 409, internal: 500 },
  source: 'fallback'
}

function replacePluginId(v: unknown): unknown {
  if (v === 'PLUGIN_ID') return PLUGIN_ID
  if (Array.isArray(v)) return v.map(replacePluginId)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replacePluginId(x)]))
  return v
}

let cached: ContractExamples | null = null

export function loadContractExamples(): ContractExamples {
  if (cached) return cached
  const api = join(ROOT, 'contract', 'api.yaml')
  if (!existsSync(api) || !existsSync(PY)) return (cached = FALLBACK)
  const r = spawnSync(PY, ['-I', '-c', SCRIPT, api], { encoding: 'utf8', timeout: 20_000 })
  if (r.status !== 0) {
    console.warn(`[harness] api.yaml unreadable (${r.stderr?.trim().split('\n').pop()}); using minimal examples`)
    return (cached = FALLBACK)
  }
  const parsed = JSON.parse(r.stdout) as { routes: Record<string, unknown>; http: Record<string, number> }
  return (cached = { routes: replacePluginId(parsed.routes) as Record<string, unknown>, http: parsed.http, source: 'api.yaml' })
}
