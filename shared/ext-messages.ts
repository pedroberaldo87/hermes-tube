// The extension's internal messages (chrome.runtime / chrome.tabs.sendMessage) — written by hand.
// Only the service worker (background) talks to the plugin's server (Chrome blocks a web page and a content script
// on loopback). The popup and the content scripts ask the background through these messages; the router
// (extension/src/lib) dispatches by `type` and always answers `Envelope<res>`.
// Prose and rules: contract/ext-protocol.md §7.

import type {
  ApiError,
  ChangedResult,
  ChannelIn,
  Envelope,
  ExtState,
  FeedPage,
  QueueAction,
  ReadScope,
  SyncReport,
  SyncSignal,
  VideoStateChange,
  WatchEvent,
} from './api-types';

/** Connection state with Hermes, as the popup and the sidebar show it. */
export type ConnectionState =
  /** no stored token */
  | 'unpaired'
  /** the last authenticated request succeeded */
  | 'connected'
  /** none of the 10 ports answers (gateway restarted, Desktop closed): "open Hermes to reconnect" */
  | 'reconnect_needed'
  /** token refused (401) or revoked: pair again */
  | 'unauthorized'
  /** another error (see `error`) */
  | 'error';

export interface ConnectionStatus {
  state: ConnectionState;
  port: number | null;
  device_id: string | null;
  /** epoch ms of the last successful request */
  last_ok_at: number | null;
  error: ApiError | null;
}

/** popup/content → background. `req` = payload; `res` = `data` of the answer envelope. */
export interface ExtRequests {
  /**
   * Scans the ports (only `pairing_open`), `POST /pair/complete`, stores `{port, token, device_id}`.
   * `port`: the "advanced" address (only that port; the background keeps the choice in `STORAGE_KEYS.pairPort`);
   * absent = automatic discovery.
   */
  'pair.submit': { req: { code: string; name?: string; port?: number }; res: ConnectionStatus };
  /** `POST /ext/unpair` (best effort) and deletes the local token. */
  'pair.unpair': { req: Record<string, never>; res: ConnectionStatus };
  /** Connection state (no network, unless `probe`). */
  'conn.status': { req: { probe?: boolean }; res: ConnectionStatus };
  /** Last `ExtState` (cache of the 30 s alarm); `refresh` forces `GET /ext/state`. */
  'state.get': { req: { refresh?: boolean }; res: ExtState | null };
  /** `GET /ext/feed` (exactly one of tab/folder/channel). */
  'feed.get': {
    req: { tab?: string; folder?: string; channel?: string; limit?: number; cursor?: string | null };
    res: FeedPage;
  };
  /** `POST /ext/videos/state`. */
  'videos.state': { req: VideoStateChange; res: ChangedResult };
  /** `POST /ext/read`. */
  'read.mark': { req: ReadScope; res: ChangedResult };
  /** The scraper finished scrolling /feed/channels: the whole list + signal. */
  'sync.subscriptions': { req: { channels: ChannelIn[]; signal: SyncSignal }; res: SyncReport };
  /** The tracker recorded a watched video; the background batches them (≤ 500) for `POST /ext/sync/watch`. */
  'sync.watch': { req: WatchEvent; res: { queued: number } };
  /**
   * Sync now: opens /feed/channels in a **visible** tab and runs the scraper. `trigger` goes to
   * the `SyncStatus`: `manual` (default, the popup button) or `pair` (1st sync right after pairing; also
   * visible).
   */
  'sync.now': { req: { trigger?: 'manual' | 'pair' }; res: { started: boolean } };
  /**
   * The popup's "Stop": the queue stops after the click in progress and stays stopped until `queue.resume`.
   * Returns the current progress (`STORAGE_KEYS.queueRun`).
   */
  'queue.stop': { req: Record<string, never>; res: QueueProgress | null };
  /**
   * The popup's "Resume"/"Try again": only **releases** the queue (stopped or held) and asks for a fresh `ExtState`;
   * what runs is still exclusively what `GET /ext/queue` hands out. Never runs an item on its own.
   */
  'queue.resume': { req: Record<string, never>; res: QueueProgress | null };
}

/** Queue item in progress (service worker restart): `claimed` came from the GET; `running` the server knows; `executing`
 *  in the tab; `finished` with the result ready. */
export interface QueueCurrentItem {
  queue_id: string;
  channel_id: string;
  action: QueueAction;
  phase: 'claimed' | 'running' | 'executing' | 'finished';
  result?: { status: 'done' | 'failed'; error: string | null };
  started_at: number;
}

/** Why the queue is held: logged out 1 h, challenge 6 h, 2 failures in a row 30 min, round cap 5 min. */
export type QueueHoldReason = 'logged_out' | 'challenge' | 'failures' | 'cap';

/** Progress of the unsubscribe queue (the executor writes it in `STORAGE_KEYS.queueRun`, the popup shows it). */
export interface QueueProgress {
  /** idle: nothing running; running: a round; paused: held until `hold_until`; stopped: "Stop" until resumed */
  state: 'idle' | 'running' | 'paused' | 'stopped';
  action: QueueAction | null;
  /** current item in the round (1, 2, …) and estimated total (`queue_pending` at the start, ≤ cap) */
  index: number;
  total: number;
  channel_id: string | null;
  channel_title: string | null;
  done: number;
  failed: number;
  last: { queue_id: string; status: 'done' | 'failed'; error: string | null } | null;
  consecutive_failures: number;
  hold_reason: QueueHoldReason | null;
  /** epoch ms */
  hold_until: number | null;
  started_at: number | null;
  updated_at: number;
  /** ready text (service worker language at write time) */
  message: string;
  tab_id: number | null;
  origin_tab_id: number | null;
  current: QueueCurrentItem | null;
}

/** background → content script of a tab the background itself opened. */
export interface ExtTabCommands {
  /** On the channel page: click unsubscribe/subscribe; one at a time, 3–6 s pause between items. */
  'queue.execute': {
    req: {
      queue_id: string;
      action: 'unsubscribe' | 'resubscribe';
      channel_url: string;
      /** the item's channel id: the page must be this channel's, otherwise `wrong_channel` and no click. */
      channel_id?: string;
      /** only for the notice on the page ("unsubscribing 2 of 5 · <channel>"). */
      channel_title?: string | null;
      index?: number;
      total?: number;
    };
    /** `error`: short, stable reason (`QUEUE_REASONS` in `background/queue.ts`), or a note when `done`. */
    res: { status: 'done' | 'failed'; error: string | null };
  };
  /** On the search tab: return the `ytInitialData` (object) for `POST /ext/search-jobs/{id}/result`. */
  'search.extract': { req: { job_id: string }; res: { payload: unknown } };
  /** On /feed/channels: scroll to the end and return the list + signal complete|partial. */
  'scrape.subscriptions': {
    req: { visible?: boolean };
    res: { channels: ChannelIn[]; signal: SyncSignal; reason?: string; stats?: object };
  };
}

export type ExtRequestType = keyof ExtRequests;
export type ExtTabCommandType = keyof ExtTabCommands;

/** Shape of the message on the wire (`chrome.runtime.sendMessage(msg)`). */
export interface ExtMessage<K extends ExtRequestType = ExtRequestType> {
  type: K;
  payload: ExtRequests[K]['req'];
}

export interface ExtTabMessage<K extends ExtTabCommandType = ExtTabCommandType> {
  type: K;
  payload: ExtTabCommands[K]['req'];
}

export type ExtReply<K extends ExtRequestType> = Envelope<ExtRequests[K]['res']>;
export type ExtTabReply<K extends ExtTabCommandType> = Envelope<ExtTabCommands[K]['res']>;

/** Keys in chrome.storage.local (Hermes is the source of truth; here only cache and credential). */
export const STORAGE_KEYS = {
  /** `{ port, token, device_id, paired_at }` — never log the token. */
  connection: 'conn',
  /** last `ExtState` + `fetched_at` (ms). */
  stateCache: 'state_cache',
  /** local queue of `WatchEvent`s not sent yet. */
  watchOutbox: 'watch_outbox',
  /** `SyncStatus` of the last subscriptions sync (the popup reads it; the service worker dies). */
  syncStatus: 'sync_status',
  /** scraped batch not sent yet (resend; after 15 min it goes as `partial`). */
  syncPending: 'sync_pending',
  /** sync in progress (tab, start) — to close an orphan tab when the service worker restarts. */
  syncRun: 'sync_run',
  /** history events refused by the server (`invalid`): diagnostics, never resent. */
  watchRejected: 'watch_rejected',
  /** `{ device_name, paired_at }` of the current pairing (pairing writes it, the popup shows it). */
  pairInfo: 'pair_info',
  /** port chosen in the popup's "advanced" (absent = automatic discovery). */
  pairPort: 'pair_port',
  /** `QueueProgress` of the unsubscribe queue (the executor writes it, the popup shows it) + item in progress. */
  queueRun: 'queue_run',
  /** `{ stopped, by, at }` — "Stop" (popup/notice on the page). It only stops; never tells anything to run. */
  queueCtl: 'queue_ctl',
  /** items already started: never run again. */
  queueLedger: 'queue_ledger',
  /** folders open in the youtube.com sidebar (`{expanded: string[]}`). */
  sidebarTree: 'sidebar_tree',
} as const;

/** State of the last subscriptions sync (the sync writes it, the popup shows it). */
export interface SyncStatus {
  state: 'running' | 'ok' | 'error';
  trigger: 'manual' | 'alarm' | 'pair' | string;
  started_at: number;
  finished_at: number | null;
  signal: SyncSignal | null;
  /** why the signal ended up like this (e.g. `logged_out`, `scroll_stalled`, `timeout`). */
  reason: string | null;
  sent: number;
  dropped: number;
  report: { added: number; updated: number; marked_ex: number } | null;
  /** `code`: from the server (`invalid`, `unauthorized`, …) or local (`cancelled`, `tab_closed`, `logged_out`, …). */
  error: { code: string; message: string } | null;
  /** ready text for the popup. */
  message?: string | null;
  last_ok_at?: number | null;
  /** the background sync (alarm) got stuck: the popup highlights "Sync now" (visible tab). */
  needs_visible?: boolean;
}

/** Names of the chrome.alarms alarms. */
export const ALARMS = {
  /** every 30 s while paired: `GET /ext/state` (+ `kick_if_due` on the server). */
  state: 'tube-state',
  /** every 6 h: sync subscriptions. */
  sync: 'tube-sync',
} as const;
