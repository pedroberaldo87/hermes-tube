// lib/pake: the extension's half of the pairing proof and of the /health proof. The vectors are the same as
// tests/test_security_pairing.py (the server side, Python): both sides must agree bit for bit.
import { describe, expect, it } from 'vitest'
import {
  ELEMENT_HEX,
  P,
  Q,
  clientFinish,
  clientStart,
  confirmOf,
  groupConstants,
  jacobi,
  modPow,
  parseElement,
  passwordScalar,
  serverProof,
  serverRound,
  sessionKey,
  sha256Hex,
  toHex
} from '../src/lib/pake'

const PORT = 47616
const fp = async (v: bigint) => (await sha256Hex(toHex(v))).slice(0, 16)

describe('group and vectors shared with the server', () => {
  it('M and N are the same as the server derives', async () => {
    const { M, N } = await groupConstants()
    expect(await fp(M)).toBe('11592b14d066750d')
    expect(await fp(N)).toBe('1708fd85260dc428')
    expect(P % 8n).toBe(7n)
    for (const e of [2n, M, N]) expect(modPow(e, Q, P)).toBe(1n)
  })

  it('known-answer vector (code 482913, fixed scalars) matches the Python side', async () => {
    const w = await passwordScalar('482913')
    expect(w.toString(16).slice(0, 16)).toBe('76ea58423e78e5cb')
    const a = 0x1234567n
    const b = 0x7654321n
    const start = await clientStart('482913', a)
    expect(await fp(start.x)).toBe('ecfcb15587aa5d5d')
    const srv = await serverRound('482913', start.xHex, PORT, b)
    expect(srv).not.toBeNull()
    expect(await fp(BigInt(`0x${srv!.yHex}`))).toBe('91b5d9eb3a51733c')
    expect(srv!.confirm.slice(0, 16)).toBe('1e2ed59761ffcc92')
    expect((await confirmOf(srv!.key, 'client')).slice(0, 16)).toBe('53ee2422b94d6c44')
    const key = await clientFinish('482913', start, srv!.yHex, srv!.confirm, PORT)
    expect(key).not.toBeNull()
    expect(await sessionKey(PORT, start.x, BigInt(`0x${srv!.yHex}`), 1n)).not.toEqual(key)
  })

  it('/health proof vector matches the Python side', async () => {
    expect((await serverProof('tok_test', 'ab'.repeat(16), PORT)).slice(0, 16)).toBe('2cf5ecdbc3f73a6a')
  })
})

describe('what an impostor can and cannot do', () => {
  it('a server that does not know the code cannot produce the confirmation', async () => {
    const start = await clientStart('111111')
    const srv = await serverRound('222222', start.xHex, PORT)
    expect(await clientFinish('111111', start, srv!.yHex, srv!.confirm, PORT)).toBeNull()
  })

  it('relaying to the real server on another port does not confirm', async () => {
    const start = await clientStart('111111')
    const srv = await serverRound('111111', start.xHex, PORT + 2)
    expect(await clientFinish('111111', start, srv!.yHex, srv!.confirm, PORT)).toBeNull()
    const ok = await serverRound('111111', start.xHex, PORT)
    expect(await clientFinish('111111', start, ok!.yHex, ok!.confirm, PORT)).not.toBeNull()
  })

  it('the fast subgroup test (Legendre symbol) agrees with v^q mod p', async () => {
    const { M, N } = await groupConstants()
    for (const v of [2n, 3n, 4n, 5n, 6n, 7n, 10n, 11n, M, N, P - 2n, (M * 3n) % P, (N * N) % P]) {
      expect(jacobi(v, P) === 1, v.toString(16).slice(0, 8)).toBe(modPow(v, Q, P) === 1n)
    }
  })

  it('elements outside the subgroup are refused', () => {
    const nonres = [3n, 5n, 6n, 7n, 10n, 11n].find((v) => modPow(v, Q, P) !== 1n)!
    for (const bad of ['', '1', '0'.repeat(ELEMENT_HEX), toHex(1n), toHex(P - 1n), toHex(nonres), 'Z'.repeat(ELEMENT_HEX)]) {
      expect(parseElement(bad), bad.slice(0, 8)).toBeNull()
    }
  })

  it('a round is fast enough for a click (< 2 s)', async () => {
    const t = Date.now()
    const start = await clientStart('123456')
    const srv = await serverRound('123456', start.xHex, PORT)
    await clientFinish('123456', start, srv!.yHex, srv!.confirm, PORT)
    expect(Date.now() - t).toBeLessThan(2000)
  })
})
