// Extension environment check: exists only so `tsc -p tsconfig.ext.json` has an entry
// and exercises Preact JSX + `chrome` types. Not a vitest test and not part of the build.
import { render } from 'preact'
import { useState } from 'preact/hooks'

function Probe() {
  const [n, setN] = useState(0)
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      {n}
    </button>
  )
}

export function mountProbe(el: HTMLElement): void {
  render(<Probe />, el)
}

export function probeChrome(): string | undefined {
  return typeof chrome === 'undefined' ? undefined : chrome.runtime.id
}
