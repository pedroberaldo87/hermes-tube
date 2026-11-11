// Types of repo.mjs (test helpers with Node).
export declare const REPO_ROOT: string
export declare const DESKTOP_SRC: string
export declare const EXTERNALS: readonly string[]
export declare const MAX_BYTES: number

export declare function readRepoFile(rel: string): string
export declare function repoFileExists(rel: string): boolean
export declare function listRepoFiles(relDir: string, exts?: readonly string[]): string[]
export declare function importSpecifiers(code: string): string[]
export declare function resolveRelative(fromRel: string, spec: string): string

export interface DesktopBundle {
  outdir: string
  file: string
  code: string
  bytes: number
  stdout: string
}
export declare function buildDesktopBundle(): DesktopBundle
export declare function inspectBundle(code: string): string[]
