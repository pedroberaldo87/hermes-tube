// The extension's half of the pairing, run in Node against a real server: `node pair_client.mjs <port> <code>`.
// It imports the extension's own lib/pake.ts (Node strips the types) and speaks the wire format of
// extension/src/lib/client.ts. Prints one JSON line; exit code 0 only when every step held.
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pake = await import(pathToFileURL(resolve(here, '../../extension/src/lib/pake.ts')).href)

const port = Number(process.argv[2])
const code = String(process.argv[3])
const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
const base = `http://127.0.0.1:${port}`

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(method === 'POST' ? { Origin: origin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return { status: res.status, envelope: await res.json() }
}

const out = { round1: false, serverConfirmed: false, paired: false, proof: false, codeOnTheWire: false }
const sent = []
const start = await pake.clientStart(code)
const body1 = { name: 'Node interop', pake: { x: start.xHex } }
sent.push(JSON.stringify(body1))
const r1 = await call('POST', '/pair/complete', body1)
const p = r1.envelope?.data?.pake
out.round1 = r1.status === 200 && typeof p?.session === 'string'
const key = out.round1 ? await pake.clientFinish(code, start, p.y, p.confirm, port) : null
out.serverConfirmed = key !== null
if (key) {
  const body2 = { name: 'Node interop', pake: { session: p.session, confirm: await pake.confirmOf(key, 'client') } }
  sent.push(JSON.stringify(body2))
  const r2 = await call('POST', '/pair/complete', body2)
  const token = r2.envelope?.data?.token
  const deviceId = r2.envelope?.data?.device?.id
  out.paired = r2.status === 200 && typeof token === 'string' && typeof deviceId === 'string'
  if (out.paired) {
    const nonce = pake.newNonce()
    const h = await call('GET', `/health?device=${encodeURIComponent(deviceId)}&nonce=${nonce}`)
    out.proof = pake.sameHex(h.envelope?.data?.proof, await pake.serverProof(token, nonce, port))
  }
}
out.codeOnTheWire = sent.some((s) => s.includes(code))
console.log(JSON.stringify(out))
process.exit(out.round1 && out.serverConfirmed && out.paired && out.proof && !out.codeOnTheWire ? 0 : 1)
