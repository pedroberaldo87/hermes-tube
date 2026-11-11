// content/sidebar — CSS of the three hosts (guide section, mini-guide entry, pane). All inside a closed
// Shadow DOM: nothing leaks to the page and the page cannot reach in. `:host { all: initial !important }` cuts
// inheritance (own variables still apply). Geometry and font come from the `--g-*` variables measured in the guide (guide.ts);
// colors follow YouTube's theme (`data-theme` = `html[dark]`) with the values measured in the guide (text #0f0f0f /
// #f1f1f1, new-content dot #065fd4 / #3ea6ff, hover/active .05 / .1). The section line is copied from the neighboring section.
// Short motion (140–180 ms) and turned off with `prefers-reduced-motion`.

const PALETTE = `
:host {
  --g-row-h: 40px; --g-row-end: 12px; --g-radius: 10px; --g-pad-x: 12px; --g-icon: 24px; --g-icon-gap: 24px;
  --g-font: Roboto, Arial, sans-serif; --g-fs: 14px; --g-lh: 20px; --g-sec-pad: 12px;
  --g-head-fs: 16px; --g-head-lh: 22px;
  --text: #0f0f0f;
  --text2: #606060;
  --accent: #065fd4;
  --hover: rgba(0, 0, 0, 0.05);
  --active: rgba(0, 0, 0, 0.05);
  --line: rgba(0, 0, 0, 0.1);
  --g-sep: 1px solid rgba(0, 0, 0, 0.2);
  --panel-bg: #ffffff;
  --chip: rgba(0, 0, 0, 0.05);
  --chip-hover: rgba(0, 0, 0, 0.1);
  --skeleton: rgba(0, 0, 0, 0.06);
  --snack-bg: #0f0f0f;
  --snack-fg: #ffffff;
  --snack-action: #3ea6ff;
  --badge-fg: #ffffff;
  --shadow: 0 4px 32px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.06);
  color-scheme: light;
}
:host([data-theme='dark']) {
  --text: #f1f1f1;
  --text2: #aaaaaa;
  --accent: #3ea6ff;
  --hover: rgba(255, 255, 255, 0.1);
  --active: rgba(255, 255, 255, 0.1);
  --line: rgba(255, 255, 255, 0.1);
  --g-sep: 1px solid rgba(255, 255, 255, 0.2);
  --panel-bg: #212121;
  --chip: rgba(255, 255, 255, 0.1);
  --chip-hover: rgba(255, 255, 255, 0.2);
  --skeleton: rgba(255, 255, 255, 0.08);
  --snack-bg: #f1f1f1;
  --snack-fg: #0f0f0f;
  --snack-action: #065fd4;
  --badge-fg: #0f0f0f;
  --shadow: 0 4px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08);
  color-scheme: dark;
}
* { box-sizing: border-box; }
.mount { font-family: var(--g-font); color: var(--text); -webkit-font-smoothing: antialiased; }
button { font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0; cursor: pointer; }
svg { display: block; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`

export const SECTION_CSS = `${PALETTE}
:host { all: initial !important; display: block !important; }
.section { padding: var(--g-sec-pad); border-bottom: var(--m-sep, var(--g-sep)); }
.head {
  display: flex; align-items: center; gap: 8px; margin: 0 var(--g-row-end) 0 0; padding: 6px 12px 4px;
  font-size: var(--g-head-fs); line-height: var(--g-head-lh); font-weight: 500; color: var(--text);
}
.head-mark { flex: none; display: inline-flex; }
.head-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.total { margin-left: auto; font-size: 12px; font-weight: 500; color: var(--accent); font-variant-numeric: tabular-nums; }
.spin {
  flex: none; width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid var(--line); border-top-color: var(--text2); animation: tube-spin 900ms linear infinite;
}
@keyframes tube-spin { to { transform: rotate(360deg); } }
.note {
  display: flex; align-items: flex-start; gap: 8px; margin: 0 var(--g-row-end) 4px 0; padding: 4px 12px;
  font-size: 12px; line-height: 16px; color: var(--text2);
}
.note svg { flex: none; width: 16px; height: 16px; }
.tree { margin: 0; padding: 0; }
.tree:focus { outline: none; }
.tree[data-off] { opacity: 0.55; filter: saturate(0); }
[role='treeitem'] { display: block; outline: none; }
[role='group'] { display: block; }
.row {
  display: flex; align-items: center; height: var(--g-row-h); margin-right: var(--g-row-end);
  padding: 0 var(--g-pad-x); padding-left: calc(var(--g-pad-x) + var(--indent, 0px));
  border-radius: var(--g-radius); cursor: pointer; color: var(--text); user-select: none;
  transition: background-color 140ms ease-out;
}
/* subfolders: no icon, the name aligns under the parent folder's name (+12 px per level) */
.row.sub { padding-left: calc(var(--g-pad-x) + var(--g-icon) + var(--g-icon-gap) + var(--indent, 0px)); }
.row:hover { background: var(--hover); }
[role='treeitem']:focus-visible > .row { outline: 2px solid var(--text); outline-offset: -2px; }
[aria-selected='true'] > .row { background: var(--active); }
[aria-selected='true'] > .row .label { font-weight: 500; }
.icon {
  flex: none; width: var(--g-icon); height: var(--g-icon); margin-right: var(--g-icon-gap);
  display: flex; align-items: center; justify-content: center; color: var(--text);
}
.icon svg { width: var(--g-icon); height: var(--g-icon); }
.glyph { font-size: 18px; line-height: var(--g-icon); }
.label {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: var(--g-fs); line-height: var(--g-lh); font-weight: 400;
}
.count {
  flex: none; margin-left: 8px; font-size: 12px; line-height: var(--g-lh); font-weight: 500;
  color: var(--accent); font-variant-numeric: tabular-nums;
}
.tree[data-off] .count { color: var(--text2); }
.toggle {
  flex: none; width: 24px; height: 24px; margin: 0 -6px 0 4px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; color: var(--text2);
}
.toggle:hover { background: var(--hover); color: var(--text); }
.toggle svg { width: 16px; height: 16px; transition: transform 160ms ease-out; }
[aria-expanded='true'] > .row .toggle svg { transform: rotate(90deg); }
`

export const MINI_CSS = `${PALETTE}
:host { all: initial !important; display: block !important; }
.mini {
  position: relative; display: flex; flex-direction: column; align-items: center; width: 64px;
  padding: 16px 0 14px; border-radius: 10px; color: var(--text); transition: background-color 140ms ease-out;
}
.mini:hover { background: var(--hover); }
.mini:focus-visible { outline: 2px solid var(--text); outline-offset: -2px; }
.mini[aria-expanded='true'] { background: var(--active); }
.mini-icon { position: relative; width: 24px; height: 24px; margin-bottom: 6px; }
.mini-icon svg { width: 24px; height: 24px; }
.badge {
  position: absolute; top: -6px; left: 14px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
  background: var(--accent); color: var(--badge-fg); font-size: 10px; line-height: 16px; font-weight: 500;
  text-align: center; font-variant-numeric: tabular-nums;
}
.mini-title { max-width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; line-height: 16px; }
`

export const PANEL_CSS = `${PALETTE}
:host { all: initial !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; z-index: 2190 !important; display: block !important; }
.panel {
  position: fixed; top: var(--top, 64px); left: var(--left, 248px); bottom: 12px;
  width: min(400px, calc(100vw - var(--left, 248px) - 16px)); min-width: 280px;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--panel-bg); color: var(--text); border-radius: 12px; box-shadow: var(--shadow);
  font-family: var(--g-font); animation: tube-in 160ms ease-out both;
}
.panel[hidden] { display: none; }
@keyframes tube-in { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
.p-head { flex: none; display: flex; align-items: center; gap: 4px; padding: 10px 8px 10px 16px; border-bottom: 1px solid var(--line); }
.p-head.with-back { padding-left: 4px; }
.p-titles { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.p-title { margin: 0; font-size: 16px; line-height: 22px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; outline: none; }
.p-sub { font-size: 12px; line-height: 16px; color: var(--text2); font-variant-numeric: tabular-nums; }
.pill {
  flex: none; display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px; border-radius: 18px;
  background: var(--chip); font-size: 14px; line-height: 36px; font-weight: 500; white-space: nowrap;
  transition: background-color 140ms ease-out;
}
.pill svg { width: 20px; height: 20px; margin-left: -4px; }
.pill:hover { background: var(--chip-hover); }
.round { flex: none; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: background-color 140ms ease-out; }
.round:hover { background: var(--hover); }
.round svg { width: 24px; height: 24px; }
button:focus-visible, a:focus-visible { outline: 2px solid var(--text); outline-offset: -2px; }
.undo {
  flex: none; position: relative; overflow: hidden; display: flex; align-items: center; gap: 8px; margin: 8px 12px 0;
  padding: 0 4px 0 16px; min-height: 40px; border-radius: 8px; background: var(--snack-bg); color: var(--snack-fg);
  font-size: 14px; line-height: 20px;
}
.undo-text { flex: 1; min-width: 0; }
.undo button { height: 32px; padding: 0 12px; border-radius: 16px; color: var(--snack-action); font-weight: 500; }
.undo button:hover { background: color-mix(in srgb, var(--snack-fg) 12%, transparent); }
.undo-progress { position: absolute; left: 0; bottom: 0; height: 2px; width: 100%; background: var(--snack-action); transform-origin: left; animation: tube-shrink var(--undo-ms, 5000ms) linear both; }
@keyframes tube-shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.msg { flex: none; margin: 8px 16px 0; font-size: 12px; line-height: 16px; color: var(--text2); }
.p-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 8px 8px 12px; scrollbar-width: thin; }
.video {
  display: flex; gap: 12px; padding: 6px 8px; border-radius: 10px; color: inherit; text-decoration: none;
  transition: background-color 140ms ease-out;
}
.video:hover { background: var(--hover); }
.thumb { position: relative; flex: none; width: 160px; height: 90px; border-radius: 8px; overflow: hidden; background: var(--skeleton); }
.thumb img { display: block; width: 100%; height: 100%; object-fit: cover; transition: opacity 180ms ease-out, transform 160ms ease-out; }
.video:hover .thumb img { transform: scale(1.03); }
.dur {
  position: absolute; right: 4px; bottom: 4px; padding: 0 4px; border-radius: 4px; background: rgba(0, 0, 0, 0.6);
  color: #fff; font-size: 12px; line-height: 18px; font-weight: 500; font-variant-numeric: tabular-nums;
}
.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.why { display: flex; align-items: center; gap: 4px; font-size: 12px; line-height: 18px; color: var(--text2); min-width: 0; }
.why svg { flex: none; width: 14px; height: 14px; }
.why span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.title {
  margin: 0 0 2px; font-size: 14px; line-height: 20px; font-weight: 500; color: var(--text);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word;
}
.line { font-size: 12px; line-height: 18px; color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.new-dot { display: inline-block; width: 6px; height: 6px; margin: 0 6px 1px 0; border-radius: 50%; background: var(--accent); vertical-align: middle; }
.seen .thumb img { opacity: 0.78; }
.seen .title { color: var(--text2); }
.sk { background: var(--skeleton); border-radius: 4px; position: relative; overflow: hidden; }
.sk::after {
  content: ''; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--panel-bg) 55%, transparent), transparent);
  animation: tube-shine 1.6s ease-in-out infinite;
}
@keyframes tube-shine { to { transform: translateX(100%); } }
.sk-line { height: 14px; margin: 3px 0 6px; }
.state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 24px; text-align: center; }
.state-title { font-size: 14px; line-height: 20px; font-weight: 500; }
.state-hint { font-size: 12px; line-height: 16px; color: var(--text2); max-width: 260px; }
.state .pill { margin-top: 8px; }
.more { display: flex; justify-content: center; padding: 8px 0 4px; }
.pick {
  display: flex; align-items: center; width: 100%; height: 40px; padding: 0 12px; padding-left: calc(12px + var(--indent, 0px));
  border-radius: 10px; text-align: left; transition: background-color 140ms ease-out;
}
.pick:hover { background: var(--hover); }
.pick .icon { flex: none; width: 24px; height: 24px; margin-right: 24px; display: flex; align-items: center; justify-content: center; }
.pick .icon svg { width: 24px; height: 24px; }
.pick .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; }
.pick .count { flex: none; margin-left: 8px; font-size: 12px; font-weight: 500; color: var(--accent); font-variant-numeric: tabular-nums; }
`
