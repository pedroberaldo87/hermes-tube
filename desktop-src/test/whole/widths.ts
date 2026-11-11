// Container-query limits, read from the plugin CSS (desktop-src/styles/*.css), and the sweep of
// widths that crosses each of them (down and up). No width number is hand-written.
import { listRepoFiles, readRepoFile } from '../repo.mjs'

export interface ContainerLimit {
  /** Container name in the source CSS (with the `PFX_` marker), e.g. `PFX_card`. */
  name: string
  kind: 'min' | 'max'
  px: number
  file: string
}

export function containerLimits(): ContainerLimit[] {
  const out: ContainerLimit[] = []
  for (const file of listRepoFiles('desktop-src/styles', ['.css'])) {
    const css = readRepoFile(file).replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of css.matchAll(/@container\s+([\w-]+)?\s*\(\s*(min|max)-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)/g)) {
      out.push({ name: m[1] ?? '', kind: m[2] as 'min' | 'max', px: Number(m[3]), file })
    }
  }
  return out
}

/** Widths that go through each limit (1 px on each side), from the largest to the smallest and back. */
export function sweep(limits: readonly number[]): number[] {
  const uniq = [...new Set(limits)].sort((a, b) => b - a)
  const down = uniq.flatMap((px) => [px + 1, px - 1])
  return [...down, ...down.slice(0, -1).reverse()]
}
