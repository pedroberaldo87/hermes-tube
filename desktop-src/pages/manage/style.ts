// Manage stylesheet. This area does not own desktop-src/styles/, so the screen CSS lives here,
// with the SAME rules as the kit sheets: only prefixed classes (`PFX_`, swapped by `resolveCss`), only theme
// variables, container-based responsiveness, motion off with `prefers-reduced-motion`. Mounted once per document
// (ref-counted) in a <style data-<prefix>manage>, removed when the last Manage unmounts.
// Could move to `styles/manage.css` + CSS_ORDER.
import { useLayoutEffect } from 'react'
import { CLASS_PREFIX, resolveCss } from '../../lib/style'

export const MANAGE_STYLE_ATTR = `data-${CLASS_PREFIX}manage`

export const MANAGE_CSS = `
/* ------------------------------------------------ bar (filters + batch) */

.PFX_mtoolbar {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s2);
  padding-bottom: var(--PFX_s2);
}

.PFX_manchor {
  position: relative;
  display: inline-flex;
}

.PFX_mfilter {
  gap: 4px;
  cursor: pointer;
}

.PFX_mfilter[data-active='true'] {
  font-weight: 600;
}

.PFX_mfilter-caret {
  color: var(--PFX_fg3);
}

.PFX_mchip {
  gap: 4px;
  border-color: var(--ui-stroke-secondary);
  background: var(--ui-bg-quaternary);
  color: var(--ui-text-primary);
}

.PFX_mcount {
  margin-left: auto;
  color: var(--PFX_fg3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.PFX_mbatch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--PFX_s1) var(--PFX_s2);
  min-height: 36px;
  padding: 2px var(--PFX_s2);
  border: 1px solid var(--ui-stroke-tertiary);
  border-radius: var(--PFX_r-control);
  background: var(--ui-bg-quinary);
}

.PFX_mbatch-count {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.PFX_mbatch-hidden {
  color: var(--PFX_fg3);
  white-space: nowrap;
}

.PFX_mbatch-actions {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
}

.PFX_mbatch-sep {
  width: 1px;
  height: 16px;
  margin: 0 var(--PFX_s1);
  background: var(--ui-stroke-tertiary);
}

.PFX_mbatch-end {
  margin-left: auto;
}

/* ------------------------------------------------ layout: folders on the left + table */

.PFX_mlayout {
  display: flex;
  align-items: flex-start;
  gap: var(--PFX_s4);
  min-width: 0;
  container-type: inline-size;
  container-name: PFX_mlayout;
}

.PFX_mmain {
  flex: 1 1 auto;
  min-width: 0;
}

.PFX_mrail {
  position: sticky;
  top: 0;
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 1px;
  width: 208px;
  max-height: calc(100vh - 160px);
  overflow-y: auto;
  padding-top: 2px;
}

.PFX_mrail-head {
  padding: 0 var(--PFX_s2) var(--PFX_s1);
  color: var(--PFX_fg3);
  letter-spacing: 0.04em;
}

.PFX_mrail-item {
  --PFX_level: 1;
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 var(--PFX_s2) 0 calc(var(--PFX_s2) + (var(--PFX_level) - 1) * 14px);
  border-radius: var(--PFX_r-control);
  color: var(--ui-text-secondary);
  transition: background-color var(--PFX_dur) var(--PFX_ease);
}

.PFX_mrail-item:hover {
  background: var(--ui-row-hover-background);
}

.PFX_mrail-item[aria-current='true'] {
  background: var(--ui-row-active-background);
  color: var(--ui-text-primary);
}

.PFX_mrail-item[data-drop='true'] {
  background: var(--ui-bg-quaternary);
  box-shadow: inset 0 0 0 1px var(--ui-text-quaternary);
}

.PFX_mrail-select {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 100%;
  text-align: left;
  cursor: pointer;
}

.PFX_mrail-icon {
  flex: none;
  color: var(--PFX_fg3);
}

.PFX_mrail-count {
  flex: none;
  color: var(--PFX_fg3);
  font-variant-numeric: tabular-nums;
}

.PFX_mrail-rename {
  display: none;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: var(--PFX_fg3);
}

.PFX_mrail-item:hover .PFX_mrail-rename,
.PFX_mrail-item:focus-within .PFX_mrail-rename {
  display: inline-grid;
}

.PFX_mrail-rename:hover {
  background: var(--ui-control-hover-background);
  color: var(--ui-text-primary);
}

.PFX_mrail-input,
.PFX_mpicker-input {
  width: 100%;
  min-width: 0;
  height: 26px;
  padding: 0 var(--PFX_s2);
  border: 1px solid var(--ui-stroke-secondary);
  border-radius: var(--PFX_r-control);
  background: var(--ui-bg-editor);
  color: var(--ui-text-primary);
  outline: none;
}

.PFX_mrail-input:focus-visible,
.PFX_mpicker-input:focus-visible {
  outline: 2px solid var(--PFX_ring);
  outline-offset: 0;
}

.PFX_mrail-new {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 var(--PFX_s2);
  border-radius: var(--PFX_r-control);
  color: var(--PFX_fg3);
  cursor: pointer;
}

.PFX_mrail-new:hover {
  background: var(--ui-row-hover-background);
  color: var(--ui-text-primary);
}

.PFX_mrail-sep {
  height: 1px;
  margin: var(--PFX_s1) var(--PFX_s2);
  background: var(--ui-stroke-quaternary);
}

/* ------------------------------------------------ table */

.PFX_mtable {
  position: relative;
  min-width: 0;
  outline: none;
  font-size: var(--PFX_fs-body);
  line-height: var(--PFX_lh-body);
}

.PFX_mtable:focus-visible .PFX_mrow[data-active='true'] {
  outline: 2px solid var(--PFX_ring);
  outline-offset: -2px;
}

.PFX_mhead,
.PFX_mrow {
  display: grid;
  grid-template-columns: var(--PFX_cols);
  align-items: center;
  column-gap: 12px;
  padding: 0 var(--PFX_s2);
}

.PFX_mhead {
  position: sticky;
  top: 0;
  z-index: 3;
  height: 32px;
  border-bottom: 1px solid var(--ui-stroke-tertiary);
  background: var(--ui-bg-editor);
  color: var(--PFX_fg3);
}

.PFX_mrow {
  position: relative;
  height: 38px;
  border-bottom: 1px solid var(--ui-stroke-quaternary);
  color: var(--ui-text-primary);
  transition: background-color var(--PFX_dur) var(--PFX_ease);
}

.PFX_mrow:hover {
  background: var(--ui-row-hover-background);
}

.PFX_mrow[aria-selected='true'] {
  background: var(--ui-row-active-background);
}

.PFX_mrow[data-editing='true'] {
  z-index: 4;
}

.PFX_mcell {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 100%;
}

.PFX_mcell[data-num='true'] {
  justify-content: flex-end;
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.PFX_mcell[data-col='relation'] {
  color: var(--ui-text-secondary);
  white-space: nowrap;
}

.PFX_mcell[data-col='select'] {
  justify-content: center;
  cursor: pointer;
}

.PFX_mhead-cell {
  font-size: var(--PFX_fs-label);
  line-height: var(--PFX_lh-label);
  font-weight: 500;
  letter-spacing: 0.04em;
}

.PFX_msort {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
  height: 24px;
  padding: 0 4px;
  margin: 0 -4px;
  border-radius: 4px;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.PFX_msort:hover {
  background: var(--ui-control-hover-background);
  color: var(--ui-text-primary);
}

.PFX_mhead-cell[aria-sort='ascending'] .PFX_msort,
.PFX_mhead-cell[aria-sort='descending'] .PFX_msort {
  color: var(--ui-text-primary);
}

.PFX_msort-icon {
  flex: none;
  opacity: 0;
}

.PFX_mhead-cell[aria-sort='ascending'] .PFX_msort-icon,
.PFX_mhead-cell[aria-sort='descending'] .PFX_msort-icon {
  opacity: 1;
}

.PFX_mname-text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}

.PFX_mname-line {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.PFX_mname-title {
  min-width: 0;
  font-weight: 550;
}

.PFX_mname-sub {
  color: var(--PFX_fg3);
}

.PFX_mfav {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  color: var(--ui-text-quaternary);
  opacity: 0;
  cursor: pointer;
  transition: opacity var(--PFX_dur) var(--PFX_ease);
}

.PFX_mrow:hover .PFX_mfav,
.PFX_mrow[data-active='true'] .PFX_mfav,
.PFX_mfav:focus-visible,
.PFX_mfav[aria-pressed='true'] {
  opacity: 1;
}

.PFX_mfav[aria-pressed='true'] {
  color: var(--ui-text-primary);
}

.PFX_mfav:hover {
  background: var(--ui-control-hover-background);
  color: var(--ui-text-secondary);
}

.PFX_mmuted {
  flex: none;
  color: var(--PFX_fg3);
}

.PFX_mrow-error {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  color: var(--ui-text-primary);
}

.PFX_mrow-error-icon {
  flex: none;
  color: var(--ui-text-secondary);
}

.PFX_medit {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
  height: 26px;
  padding: 0 4px;
  margin: 0 -4px;
  overflow: hidden;
  border-radius: var(--PFX_r-control);
  cursor: pointer;
}

.PFX_medit:hover,
.PFX_medit[aria-expanded='true'] {
  background: var(--ui-control-hover-background);
}

.PFX_medit .PFX_chip {
  flex: 0 1 auto;
  min-width: 0;
}

.PFX_mplaceholder {
  color: var(--PFX_fg3);
  white-space: nowrap;
}

/* "Add tags" only shows on row hover/focus (otherwise nothing to read: it takes no space and counts for nothing) */
.PFX_mplaceholder[data-hover='true'] {
  display: none;
}

.PFX_mrow:hover .PFX_mplaceholder[data-hover='true'],
.PFX_mrow[data-active='true'] .PFX_mplaceholder[data-hover='true'],
.PFX_medit:focus-visible .PFX_mplaceholder[data-hover='true'] {
  display: inline;
}

.PFX_mmore {
  flex: none;
  color: var(--PFX_fg3);
  font-variant-numeric: tabular-nums;
}

.PFX_mnone {
  color: var(--ui-text-quaternary);
}

.PFX_mrow[data-skeleton] {
  pointer-events: none;
}

.PFX_mrow[data-skeleton] .PFX_mcell {
  overflow: hidden;
}

.PFX_mrow[data-skeleton] .PFX_avatar {
  width: 24px;
  height: 24px;
}

/* ------------------------------------------------ in-place picker */

.PFX_mpicker {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: max-content;
  min-width: 220px;
  max-width: 300px;
  padding: 6px;
  border: 1px solid var(--ui-stroke-secondary);
  border-radius: var(--PFX_r-card);
  background: var(--ui-bg-elevated, var(--ui-bg-editor));
  color: var(--ui-text-primary);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--ui-base) 14%, transparent);
  cursor: default;
  font-weight: 400;
  letter-spacing: normal;
  text-align: left;
  white-space: normal;
}

.PFX_mpicker[data-align='end'] {
  right: 0;
  left: auto;
}

.PFX_mpicker[data-flip='true'] {
  top: auto;
  bottom: calc(100% + 4px);
}

.PFX_mpicker-list {
  display: flex;
  flex-direction: column;
  max-height: 248px;
  overflow-y: auto;
  overscroll-behavior: contain;
  outline: none;
}

.PFX_mpicker-option {
  --PFX_level: 1;
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 var(--PFX_s2) 0 calc(4px + (var(--PFX_level) - 1) * 14px);
  border-radius: 5px;
  color: var(--ui-text-secondary);
  cursor: pointer;
}

.PFX_mpicker-option[data-active='true'] {
  background: var(--ui-row-hover-background);
  color: var(--ui-text-primary);
}

.PFX_mpicker-option[aria-selected='true'] {
  color: var(--ui-text-primary);
}

.PFX_mpicker-check {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 14px;
}

.PFX_mpicker-icon {
  flex: none;
  color: var(--PFX_fg3);
}

.PFX_mpicker-label {
  flex: 1 1 auto;
}

.PFX_mpicker-hint {
  flex: none;
  color: var(--PFX_fg3);
  font-variant-numeric: tabular-nums;
}

.PFX_mpicker-empty {
  padding: 6px var(--PFX_s2);
  color: var(--PFX_fg3);
}

.PFX_mpicker-create {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 var(--PFX_s2);
  border-top: 1px solid var(--ui-stroke-quaternary);
  color: var(--ui-text-primary);
  cursor: pointer;
}

.PFX_mpicker-create:hover {
  background: var(--ui-row-hover-background);
}

.PFX_mpicker-foot {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
  border-top: 1px solid var(--ui-stroke-quaternary);
}

/* ------------------------------------------------ narrow: the folder list leaves (the picker enters the bar) */

@container PFX_mlayout (max-width: 560px) {
  .PFX_mhead,
  .PFX_mrow {
    column-gap: 8px;
    padding: 0 4px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .PFX_mrow,
  .PFX_mrail-item,
  .PFX_mfav {
    transition: none;
  }
}
`

let users = 0
let mounted: HTMLStyleElement | null = null

/** Mounts the Manage sheet while any Manage is on screen. */
export function useManageStyles(): void {
  useLayoutEffect(() => {
    if (typeof document === 'undefined' || !document.head) return
    users++
    if (!mounted || !mounted.isConnected) {
      mounted = document.head.querySelector<HTMLStyleElement>(`style[${MANAGE_STYLE_ATTR}]`)
      if (!mounted) {
        mounted = document.createElement('style')
        mounted.setAttribute(MANAGE_STYLE_ATTR, '')
        document.head.appendChild(mounted)
      }
      mounted.textContent = resolveCss(MANAGE_CSS)
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
