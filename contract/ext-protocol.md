# Extension ↔ plugin protocol

Schemas of each route: `contract/api.yaml` (paths with `x-transport: ext`); TS types: `ExtRoutes` in
`shared/api-types.ts`; the extension's internal messages: `shared/ext-messages.ts`; constants: `shared/ids.ts`.
`<id>` = `PLUGIN_ID`.

## 1. Address and discovery

- **The plugin's own HTTP server** (stdlib, `ThreadingHTTPServer`) on `http://127.0.0.1:<port>`; **never**
  `0.0.0.0`. Preferred port **47615**, a range of 10 (**47615–47624**, `EXT_PORTS`). The dashboard routes
  (`/api/plugins/<id>/ext/*`) do **not** work: in the served-profile topology the gateway strips `Authorization`
  (measured 401). No `/ext/*` in `plugin_api`.
- **On demand**, never in `register()`: the first process that calls `ensure_server` starts it — `GET /status`
  (plugin host, every ≤ 5 s while the Desktop is visible), `POST /pair/start` (host), RPC `pair.start` (gateway) and
  the `tube_status` tool (gateway). A single owner through `flock` on `<data_dir>/ext-server.lock` + `meta` (`ext_port`,
  `ext_instance`, `ext_owner_pid`, `ext_owner_role`) + `GET /health` with `instance`; the other process reuses it.
  Dead owner → the next `ensure` takes over the same port.
- Before the bind: a connection probe on `127.0.0.1:P` (if something accepts, move on to P+1) and `SO_REUSEADDR` on.
- **Discovery by the extension:** the user types **only the 6-digit code**. The background does `GET /health` on the
  10 ports in parallel (~20 ms), keeps those that answer `service === PLUGIN_ID` and tries the code **only where
  `pairing_open` is `true`** (trying on the wrong server spends an attempt). It stores `{port, token, device_id}`.
  If the stored port refuses the connection, it scans again and confirms with the token (`GET /ext/state`).
- **"Open Hermes to reconnect"** (`MESSAGE_KEYS.reconnectOpenHermes`): none of the 10 ports answers (gateway just
  restarted and Desktop closed: the server only exists after something of the plugin has run). State
  `ConnectionState = 'reconnect_needed'` in the popup/sidebar; the 30 s alarm keeps trying. In the Desktop the same
  text appears when `GET /status.ext_endpoint_up` is false.

## 2. Health

`GET /health` (no auth; also without `Origin`) → `{ok: true, data: {service, instance, pairing_open}}`.
`service` = `PLUGIN_ID`; `instance` = random id of the instance (never expose the pid or the profile path).

**Server proof (additive).** `GET /health?device=<device_id>&nonce=<32–128 hex>` also answers
`proof = HMAC-SHA256(key = hex sha256(token), "hermestube-server-v1|" + nonce + "|" + port)` when `device` is a live
(not revoked) device; otherwise the field is absent. The database already holds `sha256(token)`. The extension sends
its token to a port only after that port proved it (remembered 60 s, forgotten as soon as the port stops answering),
on the stored port and on every port found by a new scan. No proof → the token is not sent; the connection becomes
`unauthorized` with `reason: server_unverified`.

## 3. Pairing and the token's life cycle

**The code never travels (additive, PAKE).** The extension must not hand the 6-digit code to whatever listens on
47615–47624. `POST /pair/complete` also accepts two rounds of SPAKE2 over the 2048-bit MODP group of RFC 3526
(prime-order subgroup, generator 2; `M`/`N` = SHA-256 expansion of `hermestube-pair-v1|M`/`|N` squared mod p; password
`w = SHA-256("hermestube-pair-v1|" + code) mod q`; transcript bound to `127.0.0.1:<port>`; implementations:
`plugin/ext/proof.py`, `extension/src/lib/pake.ts`, shared test vectors):

1. `{name, pake: {x}}` (`x` = 512 hex digits) → `{pake: {session, y, confirm, remaining}}`. The server spends one
   attempt of the code (as a wrong code does) and answers with `confirm = HMAC(key, "…|server")`.
2. The extension checks `confirm`. Mismatch = wrong code **or** a program that is not Hermes (indistinguishable):
   nothing more is sent; with `remaining` it shows "wrong code, N attempts left" (`invalid_code`,
   `reason: server_unverified`). The next open server of the scan is tried.
3. `{name, pake: {session, confirm}}` (`confirm = HMAC(key, "…|client")`) → `PairedDevice`. Wrong confirmation →
   `invalid_code` (another attempt spent); unknown/expired session (60 s, single use) → `expired`; a new code in
   between → `no_active_code`.

The mount injects the port the server listens on in `query["_port"]` (reserved, like `_origin`): a relay to the real
server on another port does not confirm. The server keeps only a salted hash of the code, so it recovers the code
from its own hash once per code (10⁶ candidates, ~0.4 s, cached in memory). `{code, name}` keeps working for older
extensions; this extension never sends it (a server that answers `invalid` to round 1 predates the PAKE →
`reason: server_outdated`). The stored connection gains `auth: 'pake1'`; connections stored before keep working
(they are checked by the `/health` proof like any other). Schemas: `PairPakeStartBody`, `PairPakeConfirmBody` and
`PairPakeChallenge` in api.yaml.

1. Desktop: RPC `pair.start` (preferred) or `POST /pair/start` (no RPC) → `{code, expires_at, port}`.
   Starts the server if needed. Code: 6 digits (`secrets.randbelow`), **300 s**, single use, **5 attempts**,
   a new code invalidates the previous one; the database keeps only `sha256(salt+code)` (`pair_codes`).
2. Popup → `pair.submit {code}` to the background → discovery (§1) → `POST /pair/complete` (the PAKE rounds above).
3. Answer `PairedDevice` `{device, token}`; the database keeps only `sha256(token)`. Token: `tok_` + 32 urlsafe bytes
   (opaque to the extension). The extension stores `{port, token, device_id, paired_at}` in `chrome.storage.local`
   (`STORAGE_KEYS.connection`); it never logs it.
4. Pairing errors (HTTP 400, envelope body): `no_active_code`, `invalid_code` (spends 1 attempt;
   `details.remaining`), `expired`, `used`, `locked`; `origin_required` (403) if the POST comes without `Origin`.
   The error is raised only **after the COMMIT** (otherwise the attempt count is lost).
5. Use: `Authorization: Bearer <token>` on every `/ext/*` route. The token survives restarts, disable/enable and a
   change of owner (it lives in SQLite). `DeviceAuth.verify` updates `devices.last_seen` (it becomes
   `devices_online`/"device online").
6. End: unpairing in the popup → `POST /ext/unpair` (revokes its own token; best effort) and wipes the local state:
   **all** of `chrome.storage.local` (`chrome.storage.local.clear()`: credential, caches, outboxes, progress and the
   queue ledger, `pair_info`, `pair_port`) and both alarms (`ALARMS.state`, `ALARMS.sync`). Nothing of one pairing
   is left for the next; the same goes for "Pair again" after `unauthorized`. Revoking from the Desktop:
   `POST /devices/{id}/revoke`. Revoked/wrong token → `401 unauthorized` + `WWW-Authenticate: Bearer`
   → `ConnectionState = 'unauthorized'` (pair again).
7. Manual address (the popup's "advanced"): `pair.submit {code, port}` uses only that port (loopback, 1024–65535);
   without `port` = discovery (§1). The background keeps the choice in `STORAGE_KEYS.pairPort` only as the field's
   memory.
8. First sync: right after pairing (~1.5 s), `sync.now {trigger: 'pair'}` — a **visible** tab, like
   "Sync now"; `SyncStatus.trigger = 'pair'`.

## 4. Transport security (answered by `_server.py`, before the handler)

| Rule | Answer |
|---|---|
| `Host` ≠ `127.0.0.1:<port>` / `localhost:<port>` (anti DNS rebinding) | `403 host_forbidden` |
| `Origin` present and not `chrome-extension://…` (a web page) — `OPTIONS` and `/health` included | `403 origin_forbidden`, **without** CORS headers |
| `Origin` absent | accepted (a service worker GET with `host_permissions` sends no `Origin`; the token is the boundary) |
| Token with an origin pinned at pairing and a different `Origin` present | `403 origin_mismatch` |
| No `Authorization`, `Basic`, wrong or revoked token (routes with `deviceToken`) | `401 unauthorized` + `WWW-Authenticate: Bearer` |
| Plugin disabled in the profile (a guard reads `plugins.enabled` every ≤ 5 s) | `503 plugin_disabled` and the server shuts down |
| Exception in the handler | `500 internal` (short message) |

`OPTIONS` preflight (only without `host_permissions`): `204`, `Access-Control-Allow-Origin: <origin>`, `Vary: Origin`,
methods `GET, POST, OPTIONS`, headers `Authorization, Content-Type`, `Max-Age: 600`; echoes
`Access-Control-Allow-Private-Network`/`-Local-Network` when asked. Answers with a valid `Origin` carry
`Access-Control-Allow-Origin: <origin>` + `Vary: Origin`.

**HTTP status** (only on this server): the one in `x-error-codes[code].http` in api.yaml; success = 200. The body is
always the envelope. The extension decides by the body (`ok`/`error.code`), not by the status alone.

## 5. Routes

All on `http://127.0.0.1:<port>`, JSON body/answer, envelope. `x-handler` = function in `x-module`;
`x-deps` = services injected by `wiring` (§9). Owners: `contract/owners.yaml`.

| Method and path | Auth | x-module (x-handler) | x-deps | `data` |
|---|---|---|---|---|
| `GET /health?device&nonce` | — | `plugin/ext/_server.py` | — | `HealthResponse` |
| `POST /pair/complete` | — (`Origin` required) | `plugin/ext/pair.py` (`pair_complete`) | devices | `PairedDevice` (PAKE round 1: `PairPakeChallenge`) |
| `POST /ext/unpair` | Bearer | `plugin/ext/pair.py` (`unpair`) | devices | `{revoked}` |
| `GET /ext/state` | Bearer | `plugin/ext/state.py` (`get_state`) | sync | `ExtState` |
| `POST /ext/sync/subscriptions` | Bearer | `plugin/ext/sync.py` (`sync_subscriptions`) | sync | `SyncReport` |
| `POST /ext/sync/watch` | Bearer | `plugin/ext/sync.py` (`sync_watch`) | sync | `{count}` |
| `GET /ext/feed?tab=\|folder=\|channel=&limit&cursor` | Bearer | `plugin/ext/feed.py` (`get_feed`) | feed | `FeedPage` |
| `POST /ext/videos/state` | Bearer | `plugin/ext/feed.py` (`post_videos_state`) | video_state | `{changed}` |
| `POST /ext/read` | Bearer | `plugin/ext/feed.py` (`post_read`) | refresher | `{changed}` |
| `GET /ext/queue?peek` | Bearer | `plugin/ext/queue.py` (`get_queue`) | cleanup, channels | `ExtQueueView` |
| `POST /ext/queue/{id}/result` | Bearer | `plugin/ext/queue.py` (`post_queue_result`) | cleanup | `QueueItem` |
| `GET /ext/search-jobs?limit` | Bearer | `plugin/ext/search.py` (`get_search_jobs`) | searcher | `{items: SearchJob[]}` |
| `POST /ext/search-jobs/{id}/result` | Bearer | `plugin/ext/search.py` (`post_search_result`) | searcher | `SearchJob` |

Token check: `plugin/ext/auth.py`, called by `_mount.py` before any handler with Bearer.

## 6. Semantics per route

### `GET /ext/state` — `ExtState`
- Read by the background **every 30 s while paired** through `chrome.alarms` (`ALARMS.state`, `EXT_STATE_ALARM_S`),
  even with no YouTube tab open (the alarm wakes the service worker). Cached in `STORAGE_KEYS.stateCache`.
- The handler calls `SyncIngest.ext_state(device_id)`, which calls `Refresher.kick_if_due()` (non-blocking) and
  answers right away (< 2 s; target < 100 ms).
- Fields: `new_total`; `tabs[]` (`TabCount`: `tab_id`, `name`, `icon`, `count` of new ones) and `folders[]`
  (`FolderCount`: `folder_id`, `name`, `parent_id`, recursive `count`) for the sidebar; `search_pending`;
  `queue_pending`; `home_on_youtube`; Extras `extras_honest_thumbnails`, `extras_hn_lens`, `extras_hn_channels`,
  `extras_import_lists`; `refresh_running`; `last_rss_at`; `language`; `device_id`; `server_time`.
- The extension's reactions: `search_pending > 0` → turns on the search poll (§6, searches); `queue_pending > 0` →
  lists the approved items and waits for "Run now" in the popup before the executor runs (below);
  `extras_honest_thumbnails` turns `content/thumbs` on/off (undoes it when off); `home_on_youtube` turns
  `content/home` on/off.

### `GET /ext/feed` — `FeedPage`
- Same engine and same tab as the Desktop (`FeedEngine.page`/`preview`). Exactly one of `tab`, `folder`, `channel`.
  Opaque `next_cursor` (`null` = end). Each item carries `video`, `channel` (or `null`), `state`, `reaction`,
  `is_new`, `why {via, label, detail}`, `badges` (e.g. `hn`).
- Thumbnail: `https://i.ytimg.com/vi/<id>/hqdefault.jpg`; with the honest-thumbnails Extra, `…/hq2.jpg`.

### `POST /ext/sync/subscriptions` — subscriptions, signal `complete|partial`
- Body: `{channels: ChannelIn[], signal}` with the **whole list** in one request (up to 5000).
- `complete` = the scraper scrolled `/feed/channels` to the end: only then do absent `subscribed` channels become
  `ex` ("cancelled outside the app"). `partial` (scrolling interrupted, timeout) **never** marks absent ones.
  Resending is idempotent.
- When: every 6 h (`ALARMS.sync`) and on demand (the popup's "sync now", `sync.now`).

### `POST /ext/sync/watch` — history batch
- The tracker counts a video as watched at > 60% of it **or** > 4 min; it sends `sync.watch` to the background, which
  collects it in `STORAGE_KEYS.watchOutbox` and sends batches of up to 500 (on the 30 s alarm or when 50 pile up).
  Idempotent by `(video_id, watched_at)`; it leaves the outbox only after the `ok`.

### Unsubscribe queue — `GET /ext/queue` and `POST /ext/queue/{id}/result`
- `GET /ext/queue` hands out **only** `approved` items with `approved_via` (human approval: RPC `cleanup.approve`
  or `/tube cleanup`), oldest first, with the channel (`url`/`handle`) to open the page.
- The executor runs **one at a time**: `POST …/result {status: running}` → opens the channel in a **visible** tab
  (Chrome does not render a background tab) — **one tab per round**, next to the tab it started from, reused across
  the items and closed at the end (focus goes back to the original tab) → `queue.execute` in the content script
  (checks the channel, clicks, confirms, verifies) → `POST …/result {status: done|failed, error}` → random pause of
  3–6 s → next. Up to 20 items per round. `done` of an `unsubscribe` → the channel becomes `ex`; of a `resubscribe` →
  `subscribed`. Repeating the same result is idempotent; an `undone` item (undone in the Desktop before it ran) →
  `409 conflict`: the extension skips it. It never runs an item that did not come from `GET /ext/queue`.
- **A human click before each round ("Run now").** Approval in Hermes is not enough for the extension to act: it
  cannot tell who wrote an approved row into the plugin's database. With `queue_pending > 0` the service worker calls
  `GET /ext/queue?peek=1` (additive query parameter: **every** approved item with a human `approved_via`, oldest
  first, at most 100, with their channels; **nothing is lent**; an older server ignores the parameter and lends one
  item, which is harmless), stores the list in `chrome.storage.session` (`queue_waiting`) and shows the count on the
  toolbar badge. The popup shows "N approved unsubscribes are waiting" (or "N approved changes are waiting" when a
  resubscribe is in the list) with the channel names, **Run now** and **Not now**. Run now writes exactly the listed
  ids to `chrome.storage.session` (`queue_release`, `{ids, at}`) and sends `queue.resume`; the executor runs a round
  only with a release, takes items from `GET /ext/queue` as before and runs **only released ids, each once** (an id
  is removed from the release as soon as it starts). An item handed out that is not in the release ends the round
  before any click; it shows up in the next prompt. Not now writes `queue_snooze` (no badge for those ids).
  `chrome.storage.session` is reachable only by extension pages and the service worker (the extension never widens
  its access level to content scripts), so no page, content script, server response or message can release a round;
  Chrome clears it when the browser closes or the extension reloads, which drops any release. A release older than
  2 h is ignored. Holds and Stop keep the remaining released ids (Resume continues with them).
- `error` (a short, stable reason, `QUEUE_REASONS` in `background/queue.ts`): `button_not_found`,
  `confirm_not_found`, `state_unchanged`, `wrong_channel` (no click), `logged_out`, `challenge`, `timeout`,
  `stopped`, `interrupted`, `tab_closed`, `invalid_item`, `page_error`; notes on `done`: `not_subscribed`,
  `already_subscribed`.
- **Stop / Resume.** "Stop" (the button of the notice on the page, `Esc`, the queue tab closed by the user, or the
  popup through the `queue.stop` message) writes `STORAGE_KEYS.queueCtl` and the queue stops after the click in
  progress; it **stays stopped until someone resumes it** (no deadline). "Resume" (popup: the `queue.resume`
  message, also the "Try again" of a held queue) only **releases** the queue and asks for a fresh `ExtState` — what
  runs is still exclusively what `GET /ext/queue` hands out. The popup does not write to storage nor create, choose
  or approve an item.
- **Held** (not running until the deadline, or until Resume): logged out of YouTube 1 h, verification/captcha 6 h,
  two failures in a row 30 min, the 20-item cap 5 min. Progress for the screens in `STORAGE_KEYS.queueRun`
  (`QueueProgress`, `shared/ext-messages.ts`).
- **Service worker restart**: the item that was in progress becomes `failed/interrupted` (or the real result, if it
  was already done), is reported once and **never repeated** (ledger `STORAGE_KEYS.queueLedger`); the orphan tab is
  closed and focus is given back.

### Delegated searches — `search_jobs`
- The brain (`Searcher.search_many`) creates one job per search with `expires_at = created_at + 15 s` (one window
  for the whole batch) and `ExtState.search_pending` goes up. If no device was seen in 60 s or the server is down, it
  does not wait (goes straight to the host).
- The background polls `GET /ext/search-jobs` **every 3 s while `search_pending > 0`** (`SEARCH_JOBS_POLL_MS`);
  with 0, it stops. Each `GET` moves the jobs handed out to `claimed` (up to `limit`, default 4).
- For each job: if `expires_at` has already passed (server clock: use `ExtState.server_time` for the skew), drop it.
  Otherwise open `https://www.youtube.com/results?search_query=…` (with `sp=EgIIBA%3D%3D`, the "uploaded this month"
  filter, when `order = date` — YouTube's sort by date stopped working) in a background tab, `search.extract` returns
  the `ytInitialData`, and `POST /ext/search-jobs/{id}/result {payload}` (or `{error}`). Expired on the server →
  `409 conflict` (the host already covered it): ignore it.

### `POST /ext/videos/state`, `POST /ext/read`
- Quick actions of the Home and the sidebar on youtube.com; same semantics as `POST /videos/state` and `POST /read`.

## 7. Internal messages (popup/content ↔ background)

Contract in `shared/ext-messages.ts` (`ExtRequests`, `ExtTabCommands`, `ConnectionStatus`, `STORAGE_KEYS`,
`ALARMS`). Only the background does `fetch` to the server (a web page and a content script get "Failed to fetch" on
loopback). Every answer is `Envelope<res>`. Router and typed client: `extension/src/lib/**`.

## 8. Manifest per module (MV3)

| Module | `permissions` | `host_permissions` / content script |
|---|---|---|
| `background/index` + client | `storage`, `alarms` | `http://127.0.0.1/*` (covers the 10 ports; no preflight) |
| `background/pairing` + `popup` | `storage` | — (`action.default_popup`) |
| `background/sync`, `background/history` + `content/scraper`, `content/tracker` | `tabs`, `scripting`, `alarms` | `https://www.youtube.com/*` |
| `background/queue` + `content/unsubscribe` | `tabs`, `scripting` | `https://www.youtube.com/*` |
| `background/search` + `content/search` | `tabs`, `scripting`, `alarms` | `https://www.youtube.com/*` |
| `content/sidebar`, `content/thumbs` | — | content script on `https://www.youtube.com/*` |
| `content/home` | — | content script on `https://www.youtube.com/*` |

Final manifest: `"permissions": ["storage", "alarms", "tabs", "scripting"]`,
`"host_permissions": ["http://127.0.0.1/*", "https://www.youtube.com/*"]`, `background.service_worker` =
`background.js` (`type: module`), `content_scripts` on `https://www.youtube.com/*` (`content.js`; `main-world.js`
with `world: MAIN` if it exists), `action.default_popup` = `popup/index.html`; optional `"key"` for a stable id. No
`cookies`, no `webRequest`, no password reading.

## 9. Signatures of the transports and of the handlers

```python
# plugin/ext/_mount.py

# {"ok": True, "data": <JSON>} | {"ok": False, "error": {"code", "message", "reason"?, "details"?}}
Envelope = dict[str, Any]

# (device, body, query) -> Envelope.
# - device: the authenticated device (None on routes without Bearer)
# - body: JSON of the body (None on GET)
# - query: query parameters + path parameters (/ext/queue/{id}/result → query["id"])
# Pure function: no process state, no os.environ, no get_hermes_home(). It may raise
# TubeError: the mount turns it into an envelope + the HTTP status from x-error-codes.
Handler = Callable[[Device | None, Mapping[str, Any] | None, Mapping[str, str]], Envelope]

# (Authorization, Origin) -> Device; raises Unauthorized / an origin error
Authenticator = Callable[[str | None, str | None], Device]


@dataclass(frozen=True)
class ExtHandlers:
    """One field per `x-handler` of api.yaml (x-transport: ext routes, except /health)."""

    authenticate: Authenticator
    pair_complete: Handler
    unpair: Handler
    get_state: Handler
    sync_subscriptions: Handler
    sync_watch: Handler
    get_feed: Handler
    post_videos_state: Handler
    post_read: Handler
    get_queue: Handler
    post_queue_result: Handler
    get_search_jobs: Handler
    post_search_result: Handler


# Binds the §5 routes to the own server (the only mounter); applies §4 first.
def mount(server, *, handlers: ExtHandlers) -> None: ...


# plugin/ext/_server.py


# Starts (or reuses) the server and returns the port; None if it could not (→ ext_endpoint_down).
# Receives the profile ALREADY resolved by the caller (a new thread in the gateway sees the launch
# profile). Builds the handlers with wiring.ext_handlers(db=, settings=).
def ensure_server(
    *,
    db: Db,  # must live as long as the server: one Db per process/profile, never per request
    settings: Settings,
    data_dir: str | Path,
    handlers: ExtHandlers | None = None,  # None → wiring.ext_handlers(db=, settings=)
    port_base: int = 47615,
    port_span: int = 10,
    pairing_open: Callable[[], bool] | None = None,  # wiring passes DeviceAuth.pairing_open
    role: str | None = None,  # "gateway" | "host" | "cron" (diagnostics in meta)
) -> int | None: ...


# pair_complete receives the request's Origin in query["_origin"] and the server's port in
# query["_port"] (the mount injects both; the same keys coming from the client are dropped) and
# passes the origin on to DeviceAuth.complete_pairing(..., origin=).


# Real health: meta.ext_port answers /health with the stored ext_instance (short timeout).
# Becomes the ext_endpoint_up of BUILDS (Refresher, Searcher) and of GET /status.
def endpoint_up(*, db: Db, data_dir: str | Path) -> bool: ...


def current_port(*, db: Db) -> int | None: ...


# on_unload (registered in register(ctx))
def stop_local(data_dir: str | Path) -> None: ...


PORT_BASE = 47615
PORT_SPAN = 10
```

Each handler (a pure function with dependencies by name = `x-deps` in api.yaml):

```python
# plugin/ext/state.py
def get_state(
    device: Device | None, body: Mapping | None, query: Mapping[str, str], *, sync: SyncIngest
) -> Envelope: ...


# plugin/ext/auth.py
def authenticate(
    authorization: str | None, origin: str | None, *, devices: DeviceAuth
) -> Device: ...
```

`wiring` builds `ExtHandlers(get_state=functools.partial(state.get_state, sync=services.sync), …)` with the
services built on the `db` received in `ensure_server`. Service names = dependency names of
`BUILDS`/`DEPENDENCY_TYPES` in `plugin/core/types.py` (`sync`, `feed`, `video_state`, `refresher`, `cleanup`,
`channels`, `searcher`, `devices`).

## 10. Life cycle and accepted risks

- Nothing starts in `register()`; `on_unload` calls `stop_local` when the gateway is the owner. With the plugin host
  as owner, the `plugins.enabled` guard shuts the server down within ≤ 5 s (`plugin_disabled`).
- Python code under the alias does not reload on disable/enable: a Python change in the development profile
  (`HERMES_TUBE_DEV_PROFILE`) needs a gateway restart.
- Several profiles with the plugin = several servers in the range; `pairing_open` avoids spending attempts on the
  wrong one.
- The MV3 alarm has a 30 s minimum; the extension depends on nothing faster, except the search poll (3 s, only with
  `search_pending > 0`, as a chained `setTimeout` while the service worker is awake).
