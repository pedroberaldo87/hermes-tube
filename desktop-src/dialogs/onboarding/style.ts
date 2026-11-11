// Welcome dialog stylesheet. This area does not own desktop-src/styles/, so the dialog's own CSS lives here, with
// the SAME rules as the kit sheets: only prefixed classes (`PFX_`, swapped by `resolveCss`), only theme variables,
// container-based responsiveness, motion off with `prefers-reduced-motion`. Mounted once per document (ref-counted)
// in a <style data-<prefix>onboarding>, removed when the last Welcome dialog unmounts.
//
// What it does: the "Connect the browser extension" step fits a 1280×720 window without scrolling —
//   - the dialog body may grow up to the app's own dialog limit (85% of the window minus header and padding),
//     so the kit's 62vh cap and its edge shadow never hide the code or "Waiting for the extension…";
//   - two columns once the dialog is wide enough (setup on the left; code, expiry and the live wait on the right),
//     one compact column otherwise;
//   - smaller code boxes (still easy to read out loud);
//   - "Or do it by hand" is a disclosure, closed unless it is the way forward.
import { useLayoutEffect } from 'react'
import { CLASS_PREFIX, resolveCss } from '../../lib/style'

export const ONBOARDING_STYLE_ATTR = `data-${CLASS_PREFIX}onboarding`

export const ONBOARDING_CSS = `
/* ------------------------------------------------ the dialog body: up to the app's own dialog limit */

.PFX_obdialog .PFX_dialog-body {
  max-height: min(calc(85vh - 5rem), 760px);
}

/* ------------------------------------------------ pairing step: one column, or two when there is room */

.PFX_obpair {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s4);
  min-width: 0;
}

.PFX_obpair-side,
.PFX_obpair-main {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s3);
  min-width: 0;
}

@container PFX_dialog (min-width: 820px) {
  .PFX_obpair[data-columns='2'] {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    align-items: start;
    column-gap: var(--PFX_s5);
  }

  .PFX_obpair[data-columns='2'] .PFX_obpair-main {
    padding-left: var(--PFX_s5);
    border-left: 1px solid var(--ui-stroke-tertiary);
  }
}

/* the code: smaller boxes, still big enough to read out loud */
.PFX_obpair .PFX_pairing {
  gap: var(--PFX_s2);
}

.PFX_obpair .PFX_code-digit {
  width: 36px;
  height: 44px;
  font-size: 22px;
  border-radius: 7px;
}

/* ------------------------------------------------ "Or do it by hand" (disclosure) */

.PFX_obmanual {
  min-width: 0;
}

.PFX_obmanual > summary {
  display: inline-flex;
  align-items: center;
  gap: var(--PFX_s1);
  color: var(--ui-text-secondary);
  cursor: pointer;
  list-style: none;
  border-radius: 4px;
}

.PFX_obmanual > summary::-webkit-details-marker {
  display: none;
}

.PFX_obmanual > summary:hover {
  color: var(--ui-text-primary);
}

.PFX_obmanual > summary:focus-visible {
  outline: 2px solid var(--PFX_ring);
  outline-offset: 2px;
}

.PFX_obmanual-caret {
  transition: transform var(--PFX_dur) var(--PFX_ease);
}

.PFX_obmanual[open] .PFX_obmanual-caret {
  transform: rotate(90deg);
}

.PFX_obmanual > ol {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s1);
  margin: var(--PFX_s2) 0 0;
  padding-left: 1.4em;
}

/* ------------------------------------------------ "Stuck? Hermes can help": one line */

.PFX_obask {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--PFX_s1) var(--PFX_s2);
  min-width: 0;
}

/* read by screen readers, not drawn (the same text is the button's tooltip) */
.PFX_obsr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .PFX_obmanual-caret {
    transition: none;
  }
}
`

let users = 0
let mounted: HTMLStyleElement | null = null

/** Mounts the Welcome dialog sheet while any Welcome dialog is on screen. */
export function useOnboardingStyles(): void {
  useLayoutEffect(() => {
    if (typeof document === 'undefined' || !document.head) return
    users++
    if (!mounted || !mounted.isConnected) {
      mounted = document.head.querySelector<HTMLStyleElement>(`style[${ONBOARDING_STYLE_ATTR}]`)
      if (!mounted) {
        mounted = document.createElement('style')
        mounted.setAttribute(ONBOARDING_STYLE_ATTR, '')
        document.head.appendChild(mounted)
      }
      mounted.textContent = resolveCss(ONBOARDING_CSS)
    }
    return () => {
      users = Math.max(0, users - 1)
      if (!users && mounted) {
        mounted.remove()
        mounted = null
      }
    }
  }, [])
}
