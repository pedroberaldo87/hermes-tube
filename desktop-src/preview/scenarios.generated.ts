// Discovered screen scenarios. This file is the "no scenarios" default (tsc, vitest): in the preview
// build, preview/node.mjs swaps its content for imports of each `**/preview.scenarios.tsx` found
// outside preview/ (esbuild plugin). Do not hand-edit to register a scenario: create the file next to the screen.
import type { Scenario } from './scenario'

export interface ScenarioSource {
  /** File path, relative to the repository root. */
  file: string
  scenarios: readonly Scenario[]
}

export const SCENARIO_SOURCES: readonly ScenarioSource[] = []
