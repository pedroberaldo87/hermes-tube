// Tab editor stylesheet. Lives here as text because CSS files are only accepted in styles/, with the `PFX_` marker
// and the same rules (only prefixed classes, only theme variables, no network, container-based responsiveness on the dialog body; the
// kit's global `prefers-reduced-motion` does not cover the transitions here, so there is a block of its own at the end).
// Could move to `styles/tab-editor.css`.
// Mounted once per document when the dialog opens; the plugin's unload (ctx.onDispose)
// removes it — owned by a token.
import { maybePluginContext } from '../../lib/ctx'
import { onShellReset } from '../../lib/lifecycle'
import { CLASS_PREFIX, resolveCss } from '../../lib/style'

export const TAB_EDITOR_CSS = `
/* two panes: choices on the left, live preview on the right (the preview sticks to the top while scrolling) */
.PFX_te {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--PFX_s5);
  align-items: start;
  min-width: 0;
}

@container PFX_dialog (min-width: 720px) {
  .PFX_te {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.08fr);
  }

  .PFX_te-side {
    position: sticky;
    top: 0;
  }
}

.PFX_te-main,
.PFX_te-side {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s5);
  min-width: 0;
}

/* --------------------------------------------------------------- fields */

.PFX_te-field {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s1);
  min-width: 0;
}

.PFX_te-label {
  color: var(--ui-text-secondary);
}

.PFX_te-name-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 72px;
  gap: var(--PFX_s3);
  align-items: start;
}

.PFX_te-hint {
  min-height: var(--PFX_lh-label);
  color: var(--PFX_fg3);
}

.PFX_te-hint[data-tone='error'] {
  color: var(--ui-text-primary);
}

.PFX_te-hint-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--PFX_s1) var(--PFX_s2);
}

.PFX_te-icon-input {
  text-align: center;
}

/* --------------------------------------------------------------- sections and groups */

.PFX_te-section {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s2);
  min-width: 0;
}

.PFX_te-section-title {
  color: var(--ui-text-primary);
}

.PFX_te-group {
  border: 1px solid var(--ui-stroke-tertiary);
  border-radius: var(--PFX_r-card);
  min-width: 0;
}

.PFX_te-group + .PFX_te-group {
  margin-top: calc(-1 * var(--PFX_s1));
}

.PFX_te-group-toggle {
  display: flex;
  align-items: center;
  gap: var(--PFX_s2);
  width: 100%;
  min-height: 36px;
  padding: 0 var(--PFX_s3);
  border-radius: var(--PFX_r-card);
  color: var(--ui-text-primary);
  text-align: left;
}

.PFX_te-group-toggle:hover {
  background: var(--ui-row-hover-background);
}

.PFX_te-group-toggle:focus-visible {
  outline: 2px solid var(--PFX_ring);
  outline-offset: -2px;
}

.PFX_te-caret {
  flex: none;
  color: var(--PFX_fg3);
  transition: transform var(--PFX_dur) var(--PFX_ease);
}

.PFX_te-group-toggle[aria-expanded='true'] .PFX_te-caret {
  transform: rotate(90deg);
}

.PFX_te-group-title {
  flex: 1 1 auto;
  min-width: 0;
}

.PFX_te-group-sum {
  flex: none;
  color: var(--PFX_fg3);
  font-variant-numeric: tabular-nums;
}

.PFX_te-group-body {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s2);
  padding: 0 var(--PFX_s3) var(--PFX_s3);
  min-width: 0;
}

.PFX_te-note {
  color: var(--PFX_fg3);
}

/* folder tree with checkboxes (the box is drawing; the tree item does the checking) */
.PFX_te-tree {
  max-height: 248px;
  overflow: auto;
  margin: 0 calc(-1 * var(--PFX_s1));
}

.PFX_te-check {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 14px;
  height: 14px;
  margin-right: var(--PFX_s2);
  border: 1px solid var(--ui-stroke-secondary);
  border-radius: 3px;
  background: var(--ui-bg-editor);
  color: var(--ui-bg-editor);
  vertical-align: -2px;
}

.PFX_te-check[data-state='checked'] {
  border-color: var(--ui-text-primary);
  background: var(--ui-text-primary);
}

.PFX_te-check[data-state='covered'] {
  border-color: color-mix(in srgb, var(--ui-text-primary) 40%, transparent);
  background: color-mix(in srgb, var(--ui-text-primary) 40%, transparent);
}

.PFX_te-folder {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.PFX_te-folder-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.PFX_te-folder[data-state='covered'] .PFX_te-folder-name {
  color: var(--ui-text-secondary);
}

/* tags: kit chips that toggle */
.PFX_te-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--PFX_s2);
}

.PFX_te-tag:focus-visible {
  outline: 2px solid var(--PFX_ring);
  outline-offset: 1px;
}

/* --------------------------------------------------------------- channel search */

.PFX_te-picker {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s2);
  min-width: 0;
}

.PFX_te-search {
  position: relative;
  min-width: 0;
}

.PFX_te-search-icon {
  position: absolute;
  top: 50%;
  left: 9px;
  transform: translateY(-50%);
  color: var(--PFX_fg3);
  pointer-events: none;
}

.PFX_te-search-input {
  padding-left: 28px;
}

.PFX_te-list-label {
  color: var(--PFX_fg3);
}

.PFX_te-options,
.PFX_te-chosen {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.PFX_te-option,
.PFX_te-chosen-row {
  display: flex;
  align-items: center;
  gap: var(--PFX_s2);
  width: 100%;
  min-height: 32px;
  padding: 2px var(--PFX_s2);
  border-radius: var(--PFX_r-control);
  color: var(--ui-text-primary);
  text-align: left;
}

.PFX_te-option:hover,
.PFX_te-option:focus-visible {
  background: var(--ui-row-hover-background);
}

.PFX_te-option:focus-visible,
.PFX_te-remove:focus-visible {
  outline: 2px solid var(--PFX_ring);
  outline-offset: -2px;
}

/* a single row: name and @handle side by side (the action icon sits in the middle of the row) */
.PFX_te-option-text {
  display: flex;
  flex: 1 1 auto;
  align-items: baseline;
  gap: var(--PFX_s2);
  min-width: 0;
}

.PFX_te-option-title {
  flex: 0 1 auto;
}

.PFX_te-option-sub {
  flex: 1 1 0;
}

.PFX_te-option-title,
.PFX_te-option-sub {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.PFX_te-option-sub {
  color: var(--PFX_fg3);
}

.PFX_te-option-add {
  flex: none;
  color: var(--PFX_fg3);
}

.PFX_te-chosen-row {
  border: 1px solid var(--ui-stroke-quaternary);
}

.PFX_te-chosen-row + .PFX_te-chosen-row {
  margin-top: var(--PFX_s1);
}

.PFX_te-remove {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  color: var(--PFX_fg3);
}

.PFX_te-remove:hover {
  background: var(--ui-control-hover-background);
  color: var(--ui-text-primary);
}

/* --------------------------------------------------------------- filters */

.PFX_te-rows {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ui-stroke-tertiary);
  border-radius: var(--PFX_r-card);
  min-width: 0;
}

.PFX_te-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--PFX_s2) var(--PFX_s3);
  min-height: 40px;
  padding: var(--PFX_s2) var(--PFX_s3);
  min-width: 0;
}

.PFX_te-row + .PFX_te-row {
  border-top: 1px solid var(--ui-stroke-quaternary);
}

.PFX_te-row-text {
  display: flex;
  flex: 1 1 160px;
  flex-direction: column;
  min-width: 0;
}

.PFX_te-row-desc {
  color: var(--PFX_fg3);
}

.PFX_te-num {
  width: 72px;
  font-variant-numeric: tabular-nums;
}

.PFX_te-duration {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--PFX_s2);
}

.PFX_te-dash {
  color: var(--ui-text-quaternary);
}

.PFX_te-modes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--PFX_s2);
  width: 100%;
}

.PFX_te-mode {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--PFX_s2) var(--PFX_s3);
  border: 1px solid var(--ui-stroke-tertiary);
  border-radius: var(--PFX_r-control);
  color: var(--ui-text-secondary);
  text-align: left;
  transition:
    border-color var(--PFX_dur) var(--PFX_ease),
    background-color var(--PFX_dur) var(--PFX_ease);
}

.PFX_te-mode:hover {
  border-color: var(--ui-stroke-secondary);
  background: var(--ui-bg-quinary);
}

.PFX_te-mode[aria-pressed='true'] {
  border-color: var(--ui-text-quaternary);
  background: var(--ui-bg-quaternary);
  color: var(--ui-text-primary);
}

.PFX_te-mode:focus-visible {
  outline: 2px solid var(--PFX_ring);
  outline-offset: 1px;
}

.PFX_te-mode-desc {
  color: var(--PFX_fg3);
}

/* --------------------------------------------------------------- preview */

.PFX_te-preview {
  display: flex;
  flex-direction: column;
  gap: var(--PFX_s3);
  min-width: 0;
  padding: var(--PFX_s3);
  border: 1px solid var(--ui-stroke-tertiary);
  border-radius: var(--PFX_r-card);
  background: color-mix(in srgb, var(--ui-bg-quinary) 60%, transparent);
}

.PFX_te-preview-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--PFX_s1) var(--PFX_s3);
}

.PFX_te-counts {
  color: var(--ui-text-secondary);
  font-variant-numeric: tabular-nums;
}

.PFX_te-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--PFX_s1) var(--PFX_s2);
}

.PFX_te-chips .PFX_chip {
  max-width: 16rem;
}

.PFX_te-grid {
  min-width: 0;
  transition: opacity var(--PFX_dur-slow) var(--PFX_ease);
}

.PFX_te-preview[data-stale='true'] .PFX_te-grid {
  opacity: 0.45;
}

/* --------------------------------------------------------------- footer */

.PFX_te-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--PFX_s2);
  width: 100%;
}

.PFX_te-foot-status {
  flex: 1 1 180px;
  min-width: 0;
  color: var(--PFX_fg3);
}

.PFX_te-foot-status[data-tone='warn'] {
  color: var(--ui-text-secondary);
}

.PFX_te-error {
  display: flex;
  align-items: flex-start;
  gap: var(--PFX_s2);
  color: var(--ui-text-primary);
}

.PFX_te-error-icon {
  flex: none;
  margin-top: 1px;
  color: var(--ui-red);
}

.PFX_te-foot-end {
  display: flex;
  flex-wrap: wrap;
  gap: var(--PFX_s2);
  margin-left: auto;
}

.PFX_te-confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--PFX_s2) var(--PFX_s3);
  width: 100%;
}

.PFX_te-confirm-text {
  display: flex;
  flex: 1 1 220px;
  flex-direction: column;
  min-width: 0;
}

.PFX_te-confirm-desc {
  color: var(--PFX_fg3);
}

@media (prefers-reduced-motion: reduce) {
  .PFX_te-caret,
  .PFX_te-mode,
  .PFX_te-grid {
    transition: none;
  }
}
`

/** Attribute of the editor <style> (one per document). */
export const TAB_EDITOR_STYLE_ATTR = `data-${CLASS_PREFIX}tab-editor-styles`

let ownerCtx: unknown = null
let tokenSeq = 0

onShellReset(() => {
  ownerCtx = null
})

/** Ensures the editor stylesheet in the document (idempotent). The plugin's dispose removes it. */
export function ensureTabEditorStyles(doc: Document | undefined = globalThis.document): void {
  if (!doc?.head) return
  const found = [...doc.head.querySelectorAll<HTMLStyleElement>(`style[${TAB_EDITOR_STYLE_ATTR}]`)]
  for (const extra of found.slice(1)) extra.remove()
  let el = found[0]
  if (!el) {
    el = doc.createElement('style')
    el.setAttribute(TAB_EDITOR_STYLE_ATTR, '')
    doc.head.appendChild(el)
  }
  const css = resolveCss(TAB_EDITOR_CSS)
  if (el.textContent !== css) el.textContent = css
  const ctx = maybePluginContext()
  if (ctx && (ownerCtx !== ctx || el.getAttribute(TAB_EDITOR_STYLE_ATTR) === '')) {
    ownerCtx = ctx
    const token = `${Date.now().toString(36)}-${++tokenSeq}`
    el.setAttribute(TAB_EDITOR_STYLE_ATTR, token)
    const style = el
    ctx.onDispose(() => {
      if (style.isConnected && style.getAttribute(TAB_EDITOR_STYLE_ATTR) === token) style.remove()
    })
  }
}
