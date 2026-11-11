// Type of the preview's scenario collector. Each screen may have a `preview.scenarios.tsx` next to it
// (`export const scenarios: Scenario[]`); `node desktop-src/preview/build.mjs` finds them, mounts each scenario
// as a page that can be captured and includes it in the screenshots (`docs/design/shots/real-<id>.*`) and in the audit.
// The type lives in the kit because the structure rule does not let a screen import `preview/`; `preview/scenario.ts`
// re-exports the same type. Type only: none of this goes into plugin.js.
import type { ReactNode } from 'react'

/** What a REST route function receives. */
export interface ScenarioRequest {
  method: string
  /** Requested path, without the query (`/jobs/j1`). */
  path: string
  /** Path parameters matched by the key (`'GET /jobs/{id}'` → `{ id: 'j1' }`). */
  params: Record<string, string>
  query: Record<string, string>
  body: unknown
}

/** Fixed value (becomes the envelope's `data`) — anything that is not a function. */
export type ScenarioValue = string | number | boolean | null | object

/**
 * A screen scenario for the preview.
 * - `rest`: key `'METHOD /route'` (with `{param}`) → fixed value or function `(req) => data`. Returns the envelope
 *   `{ok: true, data}`; a function that throws `{code, message}` becomes `{ok: false, error}`.
 * - `rpc`: key = plugin method (`'theme.create'`) → value or `(params) => data`, same envelope.
 *   Gateway methods (e.g. `'runtime.describe'`) can also be listed; they come back raw, without the envelope.
 * - Route/method with no entry: an error in the envelope AND a visible warning on the page (never silent).
 * - `widths`: screenshot widths (default 360, 900 and 1440).
 */
export interface Scenario {
  id: string
  title: string
  widths?: number[]
  rest?: Record<string, ScenarioValue | ((req: ScenarioRequest) => unknown)>
  rpc?: Record<string, ScenarioValue | ((params: Record<string, unknown>) => unknown)>
  render: () => ReactNode
}
