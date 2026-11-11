// @vitest-environment node
// Desktop build: readable plugin.js, < 1 MB, only the three external imports and NO embedded React.
// The inspector is tested against planted texts to prove it fails when it should.
import { beforeAll, describe, expect, it } from 'vitest'
import { type DesktopBundle, EXTERNALS, MAX_BYTES, buildDesktopBundle, inspectBundle } from './repo.mjs'

describe('inspectBundle (negative proof)', () => {
  const readable = (body: string) =>
    [
      'import { host } from "@hermes/plugin-sdk";',
      'import { jsx } from "react/jsx-runtime";',
      ...Array.from({ length: 60 }, (_, i) => `const line${i} = ${i};`),
      body
    ].join('\n')

  it('a clean bundle passes', () => {
    expect(inspectBundle(readable('export default {};'))).toEqual([])
  })

  it('embedded React fails', () => {
    const embedded = readable(
      '// node_modules/react/cjs/react.production.js\nvar REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element");'
    )
    const problems = inspectBundle(embedded)
    expect(problems.some((p) => p.startsWith('embedded React'))).toBe(true)
  })

  it('embedded ReactDOM fails', () => {
    const p = inspectBundle(readable('var Internals = { __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: 1 };'))
    expect(p.some((x) => x.startsWith('embedded React'))).toBe(true)
  })

  it('an import outside the list fails', () => {
    expect(inspectBundle(readable('import "react-dom/client";'))).toContain('import outside the list: react-dom/client')
  })

  it('eval fails', () => {
    expect(inspectBundle(readable('eval("1")'))).toContain('eval/new Function in the bundle')
  })

  it('minified fails', () => {
    expect(inspectBundle('import{host}from"@hermes/plugin-sdk";var a=1;'.repeat(3)).some((p) => p.startsWith('looks minified'))).toBe(true)
  })
})

describe('plugin.js real', () => {
  let bundle: DesktopBundle
  beforeAll(() => {
    bundle = buildDesktopBundle()
  }, 60_000)

  it('builds and passes the inspector', () => {
    expect(bundle.stdout).toMatch(/OK build:desktop/)
    expect(inspectBundle(bundle.code)).toEqual([])
  })

  it('< 1 MB and only imports the externals', () => {
    expect(bundle.bytes).toBeLessThan(MAX_BYTES)
    const specs = [...bundle.code.matchAll(/^import\s.*?from\s+["']([^"']+)["']/gm)].map((m) => m[1])
    expect(specs.length).toBeGreaterThan(0)
    for (const s of specs) expect(EXTERNALS).toContain(s)
  })

  it('readable: names and source comments preserved', () => {
    expect(bundle.code).toMatch(/\/\/ desktop-src\/main\.tsx/)
    expect(bundle.code).toMatch(/function registerShell\(/)
    expect(bundle.code).toMatch(/function restCall\(/)
    expect(bundle.code).toMatch(/export \{[\s\S]*default/)
  })
})
