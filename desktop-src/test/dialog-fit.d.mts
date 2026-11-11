// Types of dialog-fit.mjs (the Desktop tsconfig does not load @types/node).
export interface DialogFit {
  id: string
  width: number
  height: number
  lang: string
  errors: string[]
  missing?: boolean
  bodyScroll: number
  bodyClient: number
  boxScroll: number
  boxClient: number
  boxTop: number
  boxBottom: number
  viewport: number
  columns: string | null
  cut: string[]
}

export declare function measureDialogs(opts: {
  outdir: string
  scenarios: string[]
  viewports: Array<{ width: number; height: number }>
  langs?: string[]
}): Promise<DialogFit[]>
