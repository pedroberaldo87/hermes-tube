// Shape of each route's response, read from the GENERATED CONTRACT (shared/api-types.ts, `RestRoutes[route]['data']`)
// by the TypeScript compiler, not hand-written: the validator walks the checker's type (object, list, union,
// literal, index) and compares it with the value stored in the cache. It also says which `path`/`query` names each route
// accepts — a cache key with another name is a DIFFERENTIATOR (a separate query, another shape allowed).
import ts from 'typescript'
import { REPO_ROOT } from '../repo.mjs'

const API_TYPES = `${REPO_ROOT}/shared/api-types.ts`

interface RouteShape {
  data: ts.Type
  pathNames: Set<string>
  queryNames: Set<string>
}

let cache: { checker: ts.TypeChecker; routes: Map<string, RouteShape>; anchor: ts.Node } | null = null

function load() {
  if (cache) return cache
  const program = ts.createProgram([API_TYPES], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2023.d.ts'],
    types: []
  })
  const checker = program.getTypeChecker()
  const sf = program.getSourceFile(API_TYPES)
  if (!sf) throw new Error(`could not find ${API_TYPES}`)
  const decl = sf.statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === 'RestRoutes')
  if (!decl) throw new Error('RestRoutes ausente em shared/api-types.ts')
  const routes = new Map<string, RouteShape>()
  const routesType = checker.getTypeAtLocation(decl.name)
  const names = (t: ts.Type) => new Set(checker.getPropertiesOfType(t).map((p) => p.getName()))
  for (const prop of checker.getPropertiesOfType(routesType)) {
    const entry = checker.getTypeOfSymbolAtLocation(prop, decl)
    const member = (name: string) => {
      const sym = entry.getProperty(name)
      if (!sym) throw new Error(`${prop.getName()} without ${name}`)
      return checker.getTypeOfSymbolAtLocation(sym, decl)
    }
    routes.set(prop.getName(), { data: member('data'), pathNames: names(member('path')), queryNames: names(member('query')) })
  }
  cache = { checker, routes, anchor: decl }
  return cache
}

/** Contract routes (RestRoutes keys). */
export function contractRoutes(): string[] {
  return [...load().routes.keys()]
}

/** Does the key `[id, 'rest', route, path, query]` use only names the route accepts? (otherwise: differentiator) */
export function isPlainKey(route: string, path: unknown, query: unknown): boolean {
  const shape = load().routes.get(route)
  if (!shape) return false
  const keysOf = (v: unknown) => (v && typeof v === 'object' ? Object.keys(v as object) : [])
  return keysOf(path).every((k) => shape.pathNames.has(k)) && keysOf(query).every((k) => shape.queryNames.has(k))
}

/** Problems of the value against `RestRoutes[route]['data']` (empty = it has the contract shape). */
export function shapeProblems(route: string, value: unknown): string[] {
  const { checker, routes } = load()
  const shape = routes.get(route)
  if (!shape) return [`rota fora do contrato: ${route}`]
  const out: string[] = []
  check(checker, shape.data, value, 'data', out, 0)
  return out
}

function describe(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function check(checker: ts.TypeChecker, type: ts.Type, value: unknown, at: string, out: string[], depth: number): void {
  if (depth > 40) return
  const f = type.flags
  if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return
  if (f & ts.TypeFlags.Never) {
    out.push(`${at}: nothing is allowed here, got ${describe(value)}`)
    return
  }
  if (type.isUnion()) {
    for (const member of type.types) {
      const probe: string[] = []
      check(checker, member, value, at, probe, depth + 1)
      if (!probe.length) return
    }
    out.push(`${at}: ${JSON.stringify(value)?.slice(0, 80)} is not ${checker.typeToString(type)}`)
    return
  }
  if (type.isIntersection()) {
    for (const member of type.types) check(checker, member, value, at, out, depth + 1)
    return
  }
  if (type.isStringLiteral() || type.isNumberLiteral()) {
    if (value !== type.value) out.push(`${at}: expected ${JSON.stringify(type.value)}, got ${JSON.stringify(value)}`)
    return
  }
  if (f & ts.TypeFlags.BooleanLiteral) {
    const want = checker.typeToString(type) === 'true'
    if (value !== want) out.push(`${at}: expected ${want}, got ${JSON.stringify(value)}`)
    return
  }
  if (f & ts.TypeFlags.String) return void (typeof value !== 'string' && out.push(`${at}: expected string, got ${describe(value)}`))
  if (f & ts.TypeFlags.Number) return void (typeof value !== 'number' && out.push(`${at}: expected number, got ${describe(value)}`))
  if (f & ts.TypeFlags.Boolean) return void (typeof value !== 'boolean' && out.push(`${at}: expected boolean, got ${describe(value)}`))
  if (f & ts.TypeFlags.Null) return void (value !== null && out.push(`${at}: expected null, got ${describe(value)}`))
  if (f & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return void (value !== undefined && out.push(`${at}: expected absent, got ${describe(value)}`))
  if (f & ts.TypeFlags.Object) {
    if (checker.isArrayType(type)) {
      if (!Array.isArray(value)) {
        out.push(`${at}: expected list, got ${describe(value)}`)
        return
      }
      const [element] = checker.getTypeArguments(type as ts.TypeReference)
      value.forEach((v, i) => check(checker, element, v, `${at}[${i}]`, out, depth + 1))
      return
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      out.push(`${at}: expected object ${checker.typeToString(type)}, got ${describe(value)}`)
      return
    }
    const obj = value as Record<string, unknown>
    const props = checker.getPropertiesOfType(type)
    const declared = new Set(props.map((p) => p.getName()))
    for (const p of props) {
      const name = p.getName()
      const optional = (p.flags & ts.SymbolFlags.Optional) !== 0
      if (!(name in obj) || obj[name] === undefined) {
        if (!optional) out.push(`${at}.${name}: required, missing`)
        continue
      }
      check(checker, checker.getTypeOfSymbol(p), obj[name], `${at}.${name}`, out, depth + 1)
    }
    // index (`Record<string, X>`): each undeclared key follows X; a new field outside an index is accepted
    // (additive contract: the client ignores unknown fields)
    for (const info of checker.getIndexInfosOfType(type)) {
      if (!(info.keyType.flags & ts.TypeFlags.String)) continue
      for (const [k, v] of Object.entries(obj)) if (!declared.has(k)) check(checker, info.type, v, `${at}[${JSON.stringify(k)}]`, out, depth + 1)
    }
    return
  }
  out.push(`${at}: contract type not supported by the validator (${checker.typeToString(type)})`)
}
