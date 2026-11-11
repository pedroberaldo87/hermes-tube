// Types of node.mjs (the Desktop tsconfig does not load @types/node).
export declare const REPO_ROOT: string
export declare const DEFAULT_OUTDIR: string
export declare const SHOTS_DIR: string
export declare const WIDTHS: number[]
export declare const THEMES: string[]
export declare const SCENARIO_FILE: string

export interface PreviewBuild {
  outdir: string
  stdout: string
  files: string[]
  hasHostCss: boolean
  html: string
  js: string
}

export interface BuildResult {
  outdir: string
  files: string[]
  hasHostCss: boolean
  /** `preview.scenarios.tsx` files added to the bundle (relative to the root when inside the repository). */
  scenarioFiles: string[]
}

export declare function buildPreview(opts?: { outdir?: string; scenarioRoots?: string[] }): Promise<BuildResult>
export declare function runPreviewBuild(): PreviewBuild

export declare function discoverScenarioFiles(roots?: string[]): string[]
export declare function chromiumAvailable(): boolean
export declare function listBundledScenarios(opts?: { outdir?: string }): Promise<{
  entries: Array<{ id: string; title: string; widths: number[] | null; file: string }>
  problems: string[]
}>

export interface ScenarioProbe {
  text: string
  missing: string[]
  missingVisible: boolean
  errors: string[]
}
export declare function probeScenario(opts: { outdir?: string; id: string; width?: number; theme?: string; lang?: string }): Promise<ScenarioProbe>

export interface AuditEntry {
  file: string
  view: string
  theme: string
  width: number
  errors: string[]
  missing: string[]
  overflowX: number
  offscreen: string[]
  clipped: string[]
  contrast: { checked: number; min: number; low: string[] }
  skeleton: Array<{ part: string; final: number; skeleton: number }>
  skeletonGrid: Array<{ density: string; columns: number; real: number | null; items: number; complete: boolean }>
  thumbs: { total: number; loaded: number; fallback: number }
  avatars: { total: number; loaded: number; fallback: number }
  iconsFont: boolean
  unstyledButtons: number
  weights: string[]
  accent: { misuse: string[]; primaryButtons: number }
  iconAlign: string[]
}
export declare function issuesOf(entry: AuditEntry): string[]
export declare function takeShots(opts: {
  outdir?: string
  views: string[]
  widths?: number[]
  widthsFor?: (view: string) => number[] | undefined
  themes?: string[]
  shotsDir?: string
  prefix: string
  writeReport?: boolean
}): Promise<AuditEntry[]>

// file helpers (the Desktop tests have no @types/node)
export declare function tempTree(files: Record<string, string>): string
export declare function removeTree(path: string): void
export declare function readText(path: string): string
export declare function listDir(path: string): string[]
