// The server proves it is this Hermes (contract/ext-protocol.md §3; server side: plugin/ext/proof.py).
//
// Pairing: SPAKE2 over the 2048-bit MODP group of RFC 3526 (prime-order subgroup, generator 2), password
// `w = SHA-256("hermestube-pair-v1|" + code) mod q`. The 6-digit code never leaves the extension: the server answers
// round 1 with `y` and a confirmation that only a server knowing the code, on the port the extension dialled, can
// produce. A program listening on one of the ports without the code learns nothing it could test offline.
//
// Later requests: before sending its token to a port the extension asks `GET /health?device=&nonce=` and checks
// `proof = HMAC-SHA256(key = hex sha256(token), "hermestube-server-v1|" + nonce + "|" + port)`.
//
// Only BigInt and WebCrypto (`crypto.subtle`, `crypto.getRandomValues`): no dependency, no eval.

const P_HEX =
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
  'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
  '15728E5A8AACAA68FFFFFFFFFFFFFFFF'

export const P = BigInt(`0x${P_HEX}`)
export const Q = (P - 1n) / 2n
export const G = 2n
export const PAKE_VERSION = 'hermestube-pair-v1'
export const SERVER_PROOF_VERSION = 'hermestube-server-v1'
/** a group element travels as 512 lowercase hex digits */
export const ELEMENT_HEX = 512

const enc = new TextEncoder()

function subtle() {
  const s = globalThis.crypto?.subtle
  if (!s) throw new Error('WebCrypto is not available')
  return s
}

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n
  let b = base % mod
  let e = exp
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod
    e >>= 1n
    if (e > 0n) b = (b * b) % mod
  }
  return result
}

const toHexBytes = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const bytesToBigInt = (bytes: Uint8Array): bigint => (bytes.length ? BigInt(`0x${toHexBytes(bytes)}`) : 0n)

export const toHex = (v: bigint): string => v.toString(16).padStart(ELEMENT_HEX, '0')

export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const buf = new Uint8Array(typeof data === 'string' ? enc.encode(data) : data)
  return new Uint8Array(await subtle().digest('SHA-256', buf))
}

export async function sha256Hex(data: string): Promise<string> {
  return toHexBytes(await sha256(data))
}

export async function hmacHex(key: Uint8Array, message: string): Promise<string> {
  const k = await subtle().importKey('raw', new Uint8Array(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHexBytes(new Uint8Array(await subtle().sign('HMAC', k, enc.encode(message))))
}

/** An element of the order-q subgroup nobody knows the discrete log of: a hash squared mod p. */
async function hashToGroup(label: string): Promise<bigint> {
  const parts: Uint8Array[] = []
  for (let i = 0; i < 9; i++) parts.push(await sha256(`${label}|${i}`))
  const all = new Uint8Array(parts.length * 32)
  parts.forEach((p, i) => all.set(p, i * 32))
  return modPow(bytesToBigInt(all) % P, 2n, P)
}

let constants: Promise<{ M: bigint; N: bigint }> | null = null
export function groupConstants(): Promise<{ M: bigint; N: bigint }> {
  constants ??= (async () => ({ M: await hashToGroup(`${PAKE_VERSION}|M`), N: await hashToGroup(`${PAKE_VERSION}|N`) }))()
  return constants
}

/** Jacobi symbol (a/n), n odd and positive. For the prime p it is the Legendre symbol: 1 = a square mod p. */
export function jacobi(a: bigint, n: bigint): number {
  let x = ((a % n) + n) % n
  let m = n
  let t = 1
  while (x !== 0n) {
    while ((x & 1n) === 0n) {
      x >>= 1n
      const r = m & 7n
      if (r === 3n || r === 5n) t = -t
    }
    ;[x, m] = [m, x]
    if ((x & 3n) === 3n && (m & 3n) === 3n) t = -t
    x %= m
  }
  return m === 1n ? t : 0
}

/**
 * A received element, only if it is in the order-q subgroup (and not 1). p is a safe prime, so the subgroup is
 * exactly the squares mod p: the Legendre symbol answers that much faster than `v^q mod p`.
 */
export function parseElement(text: unknown): bigint | null {
  if (typeof text !== 'string' || text.length !== ELEMENT_HEX || !/^[0-9a-f]+$/.test(text)) return null
  const v = BigInt(`0x${text}`)
  if (!(v > 1n && v < P - 1n) || jacobi(v, P) !== 1) return null
  return v
}

export async function passwordScalar(code: string): Promise<bigint> {
  return bytesToBigInt(await sha256(`${PAKE_VERSION}|${code}`)) % Q
}

function randomScalar(): bigint {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return (bytesToBigInt(bytes) % (Q - 1n)) + 1n
}

export async function sessionKey(port: number, x: bigint, y: bigint, k: bigint): Promise<Uint8Array> {
  return sha256(`${PAKE_VERSION}|127.0.0.1:${port}|${toHex(x)}|${toHex(y)}|${toHex(k)}`)
}

export function confirmOf(key: Uint8Array, role: 'server' | 'client'): Promise<string> {
  return hmacHex(key, `${PAKE_VERSION}|${role}`)
}

/** Constant-time-ish comparison of two hex strings of the same length. */
export function sameHex(a: unknown, b: string): boolean {
  if (typeof a !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export interface ClientStart {
  a: bigint
  x: bigint
  xHex: string
}

/** Round 1 (extension): `x = g^a · M^w`. `a` may be fixed (tests). */
export async function clientStart(code: string, a: bigint = randomScalar()): Promise<ClientStart> {
  const { M } = await groupConstants()
  const w = await passwordScalar(code)
  const x = (modPow(G, a, P) * modPow(M, w, P)) % P
  return { a, x, xHex: toHex(x) }
}

/**
 * After round 1 (extension): the session key if `y` is valid **and** the server's confirmation matches;
 * `null` otherwise (the server does not know the code, or answered for another port).
 */
export async function clientFinish(code: string, start: ClientStart, yHex: unknown, serverConfirm: unknown, port: number): Promise<Uint8Array | null> {
  const y = parseElement(yHex)
  if (y === null) return null
  const { N } = await groupConstants()
  const w = await passwordScalar(code)
  const k = modPow((y * modPow(N, Q - w, P)) % P, start.a, P)
  const key = await sessionKey(port, start.x, y, k)
  return sameHex(serverConfirm, await confirmOf(key, 'server')) ? key : null
}

/** Server side of round 1 (only for the test servers: the real one is plugin/ext/proof.py). */
export async function serverRound(code: string, xHex: unknown, port: number, b: bigint = randomScalar()): Promise<{ yHex: string; confirm: string; key: Uint8Array } | null> {
  const x = parseElement(xHex)
  if (x === null) return null
  const { M, N } = await groupConstants()
  const w = await passwordScalar(code)
  const y = (modPow(G, b, P) * modPow(N, w, P)) % P
  const k = modPow((x * modPow(M, Q - w, P)) % P, b, P)
  const key = await sessionKey(port, x, y, k)
  return { yHex: toHex(y), confirm: await confirmOf(key, 'server'), key }
}

/** `proof` of `GET /health?device=&nonce=`: HMAC keyed by the hex sha256 of the token. */
export async function serverProof(token: string, nonce: string, port: number): Promise<string> {
  const tokenHash = await sha256Hex(token)
  return hmacHex(enc.encode(tokenHash), `${SERVER_PROOF_VERSION}|${nonce}|${port}`)
}

export function newNonce(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return toHexBytes(bytes)
}
