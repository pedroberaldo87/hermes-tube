// Plugin identifiers for the Desktop pages and the extension (written by hand).
// The only TypeScript file with the id literal; it changes together with plugin/_id.py.
// `scripts/gen_types.py --check` confirms the value equals the one in plugin/_id.py and that
// DESKTOP_ROUTES/DIALOG_IDS match contract/owners.yaml.

import type { RpcMethodName, TabRulesInput, TubeEventName } from './api-types';

export const PLUGIN_ID = 'hermes-tube' as const;

/** Prefix of the plugin API (ctx.rest already applies it; useful in tests and logs). */
export const API_PREFIX = `/api/plugins/${PLUGIN_ID}` as const;

/** Wire name of an RPC method: `host.request(rpcMethod('theme.create'), params)`. */
export function rpcMethod(name: RpcMethodName): string {
  return `plugin.${PLUGIN_ID}.${name}`;
}

/** Gateway event type: `ctx.onEvent(eventType('theme.ready'), ev => …)` (ev.payload = TubeEvents[name]). */
export function eventType(name: TubeEventName): string {
  return `plugin.${PLUGIN_ID}.${name}`;
}

/** Capability the RPC client looks for in `runtime.describe` before calling an RPC. */
export const RPC_CAPABILITY = 'plugin-rpc-v1' as const;
/** JSON-RPC code of an unknown method: no RPC on this backend → the method's `fallback` (rpc.yaml). */
export const RPC_UNAVAILABLE_CODE = -32601;

// ------------------------------------------------------------------ Desktop: routes (ROUTES_AREA)

/** Owner of each page in contract/owners.yaml (desktop_routes). */
export const DESKTOP_ROUTES = {
  home: `/${PLUGIN_ID}`,
  manage: `/${PLUGIN_ID}/manage`,
  cleanup: `/${PLUGIN_ID}/cleanup`,
  extras: `/${PLUGIN_ID}/extras`,
} as const;

export type DesktopRouteKey = keyof typeof DESKTOP_ROUTES;

// ------------------------------------------------------------------ Desktop: dialogs

/** Short dialog ids (the Desktop host adds the plugin namespace). Owners in owners.yaml (dialogs). */
export const DIALOG_IDS = {
  onboarding: 'onboarding',
  tabEditor: 'tab-editor',
  organize: 'organize',
  theme: 'theme',
  listImport: 'list-import',
  history: 'history',
  createTab: 'create-tab',
} as const;

export type DialogId = (typeof DIALOG_IDS)[keyof typeof DIALOG_IDS];

/** Props any screen opens each dialog with (typed registry). */
export interface DialogProps {
  /** Welcome: pairing, paste a link/@handle, demo. `step` opens straight on a tab. */
  onboarding: { step?: 'pair' | 'link' | 'demo' };
  /** Tab editor: `tabId` edits; without it, creates (optional `preset`, e.g. a folder from the pane). */
  'tab-editor': { tabId?: string; preset?: { name?: string; kind?: 'category' | 'channels' | 'mixed'; rules?: TabRulesInput } };
  /** Organize with Hermes: `channelIds` = the Manage selection; empty = channels without a folder. `jobId` resumes. */
  organize: { channelIds?: string[]; jobId?: string };
  /** New topic tab: `query` prefilled; `jobId` resumes an active job; `themeId` opens the saved preview. */
  theme: { query?: string; jobId?: string; themeId?: string };
  /** Import a list (Extra): `url` prefilled; `jobId` resumes. */
  'list-import': { url?: string; jobId?: string };
  /** History drawer with undo. */
  history: Record<string, never>;
  /** Create a tab from the Manage selection. */
  'create-tab': { channelIds: string[] };
}

// ------------------------------------------------------------------ Desktop: other contributions

/** Subscriptions pane (`panes`, placement left). */
export const PANE_ID = 'subscriptions' as const;
/** "▶ N new" chip (statusBar.right). */
export const STATUS_CHIP_ID = 'new-count' as const;
/** ⌘K commands (PALETTE_AREA). */
export const PALETTE_COMMANDS = {
  openHome: 'open-home',
  organize: 'organize',
  cleanup: 'cleanup',
  newThemeTab: 'new-theme-tab',
  refreshNow: 'refresh-now',
  openExtras: 'open-extras',
} as const;
/** Chat directive `::tube-video{id="…"}` (on its own line, only with an 11-character `id`). */
export const CHAT_DIRECTIVE = 'tube-video' as const;

/** Common message keys (i18n namespace `common`). */
export const MESSAGE_KEYS = {
  /** No RPC on this backend (`-32601`/no `plugin-rpc-v1`): `{message}` fallback of the rpc.yaml methods. */
  openDesktopBackend: 'open_desktop_backend',
  /** `ext_endpoint_up` false / the extension cannot find the server: "open Hermes to reconnect". */
  reconnectOpenHermes: 'reconnect_open_hermes',
  /** Undo refused with reason `already_executed`. */
  alreadyExecuted: 'already_executed',
  /** `llm_unavailable`: set a model for the `curator` task (Settings → Models). */
  noModel: 'no_model',
} as const;

// ------------------------------------------------------------------ cadences

/** `GET /status` while the window is visible (chip, pane, mascot). */
export const STATUS_POLL_MS = 5_000;
/** `GET /jobs/{id}` while `queued`/`running` (events only speed it up). */
export const JOB_POLL_MS = 2_000;
/** Client-side cut of the Desktop RPC client (the server does not cut). */
export const RPC_TIMEOUT_MS = 30_000;
/** Extension: alarm that reads `GET /ext/state` while paired (MV3 minimum = 30 s). */
export const EXT_STATE_ALARM_S = 30;
/** Extension: poll of `GET /ext/search-jobs` only while `search_pending > 0`. */
export const SEARCH_JOBS_POLL_MS = 3_000;

// ------------------------------------------------------------------ extension server

export const EXT_HOST = '127.0.0.1' as const;
export const EXT_PORT_BASE = 47615;
export const EXT_PORT_SPAN = 10;
/** The 10 ports the extension scans with `GET /health` (keeps `service === PLUGIN_ID`). */
export const EXT_PORTS: readonly number[] = Array.from({ length: EXT_PORT_SPAN }, (_, i) => EXT_PORT_BASE + i);

export function extBaseUrl(port: number): string {
  return `http://${EXT_HOST}:${port}`;
}
