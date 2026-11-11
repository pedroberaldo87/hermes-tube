// Types of browser.mjs (the Desktop tsconfig does not load @types/node).
export interface Crossing {
  name: string
  px: number
  below: number
  above: number
}

export interface ResizeStop {
  width: number
  /** Visible on the page born at this width, invisible on the live-resized one (the defect). */
  vanished: string[]
  /** Visible only on the resized one (e.g. infinite scroll had already brought more pages at the larger width). */
  extra: string[]
  texts: number
  born: number
}

export interface ResizeReport {
  id: string
  crossings: Crossing[]
  stops: ResizeStop[]
  errors: string[]
}

export declare function liveResize(opts: {
  outdir: string
  scenarios: string[]
  limits: Array<{ name: string; px: number }>
  minWidth?: number
  maxWidth?: number
  /** Cap of stops per scenario (the negative proof uses few). */
  maxStops?: number
  /** Script injected only in the resized page (negative proof of the detector). */
  inject?: string | null
}): Promise<ResizeReport[]>
