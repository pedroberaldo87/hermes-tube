# Plugin events

Payload source: `contract/rpc.yaml` → `events` (schemas) · TS types: `TubeEvents` in `shared/api-types.ts` ·
names: `EVENT_NAMES` in `plugin/core/types.py` · name on the wire: `eventType(name)` in `shared/ids.ts`
(`plugin.<PLUGIN_ID>.<name>`).

## Golden rule: an event speeds things up, a query guarantees them

- **No flow depends on an event to finish.** Every screen that listens to an event also polls:
  `GET /jobs/{id}` every 2 s (`JOB_POLL_MS`) while the job is `queued`/`running`, and `GET /status` every ≤ 5 s
  (`STATUS_POLL_MS`) while the window is visible. On receiving an event, the consumer only **brings forward** the next
  query (invalidates it); it never takes the payload as the final truth.
- Events **may not arrive, arrive late or arrive twice** — the consumer is idempotent.
- **REST routes never emit events** (in the plugin host `broadcast_plugin_event` is dropped).
- Emitting from Python: `EventSink.broadcast(name, payload)` (`plugin/adapters/hermes_llm.py:build_events`) →
  global `broadcast_plugin_event`; `EventSink.emit_to_session(session_id, name, payload)` **only** when the RPC method
  received a `session_id` (it comes from the JSON-RPC frame as a handler kwarg; `params` never carries a session). RPC
  without a session is accepted and uses the global one. `EventSink` never raises.
- In the Desktop: `ctx.onEvent(eventType('theme.ready'), ev => …)`; `ev.payload` has the type
  `TubeEvents['theme.ready']`. The listener is dropped on its own when the plugin unloads.

## Where each event arrives, per topology

- **B — local Desktop, served profile (the usual topology):** `register(ctx)` (RPC, tools, `/tube`) runs **in the
  gateway**; `plugin_api.py` runs in a separate **plugin host**. Only the gateway process has a transport to the
  Desktop → an event emitted **on a gateway thread** arrives; one emitted in the plugin host is dropped.
- **G — plugin in the gateway process (launch profile):** `register` and `plugin_api` in the same gateway process;
  any emission arrives (even from a thread started by REST, but REST does not emit, by rule).
- **C — `plugins.isolation: host`:** everything in the plugin host; **no** plugin event arrives. Polling only.
- **A — `dashboard --isolated`:** no RPC (`-32601`); the AI jobs do not exist there; events are irrelevant.
- **Cron / routine scripts:** their own process, no transport → never arrives.
- **Extension server:** runs on a thread of the process that started it first — the gateway (through `pair.start`,
  `tube_status`) or the plugin host (through `GET /status`, `POST /pair/start`). An event emitted inside an `/ext/*`
  handler arrives only when the owner is the gateway.

| Event | Payload (rpc.yaml) | Who emits | B: arrives? | G | C | Who listens (query that guarantees it) |
|---|---|---|---|---|---|---|
| `refresh.done` | `RefreshReport` | `Refresher.refresh_all`, on the `kick_if_due`/`kick_channel` thread | only if the thread was born in the gateway (`tube_status`, RPC); from `GET /status`/`POST /refresh` (host) and from cron, **no** | yes | no | Home, status chip and panel (`GET /status`: `last_rss_at`, `refresh_running`) |
| `queue.changed` | `QueueChangedPayload` `{queue_ids, pending}` | `Cleanup.approve`/`resubscribe` (RPC), `Cleanup.queue_result` (handler `/ext/queue/{id}/result`), `undo_approval` | RPC: **yes**. `/ext/*`: only if the extension server belongs to the gateway. REST `POST /queue/undo`: no | yes | no | Cleanup page (`GET /queue` every 2 s with active items; `GET /status.queue_pending`) |
| `cleanup.scanned` | `CleanupScannedPayload` `{job?, status?, scan_id?}` | `cleanup.scan` (JobRunner and/or `Cleanup.scan`, RPC thread) | **yes** | yes | no | Cleanup page (`GET /jobs/{id}` → `GET /cleanup`) |
| `organize.done` | `JobEventPayload` `{job, status}` | `organize.run` (JobRunner, RPC thread) | **yes** | yes | no | Organize dialog (`GET /jobs/{id}` → `GET /suggestions`) |
| `theme.progress` | `ThemeProgressPayload` `{job, progress}` | `theme.create`/`theme.refresh` (JobRunner `progress_event`) | **yes** | yes | no | Theme dialog (`GET /jobs/{id}.progress`) |
| `theme.ready` | `JobEventPayload` `{job, status}` | `theme.create`/`theme.refresh` (JobRunner) | **yes** | yes | no | Theme dialog (`GET /jobs/{id}` → `GET /themes/{id}`) |
| `lists.ready` | `JobEventPayload` `{job, status}` | `lists.import` (JobRunner) | **yes** | yes | no | List import dialog (`GET /jobs/{id}`; preview in `Job.result`) |

## Details per event

### `refresh.done`
- Payload: `RefreshReport` (`channels`, `new_videos`, `errors`, `started_at`, `finished_at`, `partial`).
- Emitted once per cycle, at the end, even with `partial: true` (timeout). A cycle refused by the lock (`running`)
  does not emit.
- Example: `{"channels": 412, "new_videos": 37, "errors": {}, "started_at": 1762700000, "finished_at": 1762700101, "partial": false}`.

### `queue.changed`
- Payload: `{queue_ids: string[], pending: int}` — the items that changed and the `approved + running` total after it.
- Emitted on every `unsub_queue` change (approve, resubscribe, `running`/`done`/`failed` from the extension, undo).
- The extension does **not** listen to events: it sees the queue through `GET /ext/state.queue_pending` (30 s alarm)
  and `GET /ext/queue`.

### `cleanup.scanned`
- Payload with optional fields: the `JobRunner` sends `{job, status}`; the core (`Cleanup.scan`) may send `{scan_id}`.
  It may arrive twice for the same scan. The consumer reloads `GET /cleanup`.

### `organize.done`, `theme.ready`, `lists.ready`
- Payload `{job, status}` from the `JobRunner` (`status` = `done` or `error`). The result is in `GET /jobs/{id}` →
  `Job.result` (shape = the method's `job_result` in rpc.yaml) and `Job.error` (`{code, message}`).

### `theme.progress`
- Payload `{job, progress: Progress}`; `progress.stage` ∈ `expand`, `search`, `curate`, `preview`; `done`/`total`
  when countable (e.g. searches finished out of 12). Also stored in `jobs.progress` (visible through `GET /jobs/{id}`).
- **Structured numbers**: `progress.step = {name, done, total}` (`ProgressStep`, `name` = `ThemeStep`), always
  present in theme jobs, in the unit the screen shows (do not read digits out of `message`):

  | `step.name` | `done` / `total` | when |
  |---|---|---|
  | `expand` | planned searches / planned searches (`0`/`null` at the start) | start and end of the expansion |
  | `search` | videos found / videos found (`0`/`null` at the start) | start and end of the search |
  | `curate` | videos judged / videos found | start (`0`) and after each batch |
  | `preview` | videos kept in the preview / videos judged | end |
  | `seeds` | seeds read / seeds (only `theme.refresh`, before `search`) | start and end |

  `stage`, `done`, `total` and `message` keep their earlier meaning (e.g. in curation `done`/`total` = batches), for
  older clients. In the other jobs (`organize`, `cleanup_scan`, `list_import`) `step` is `null`.
- Example (`message` is in the backend language): `{"job": "job_3", "progress": {"stage": "curate", "done": 1,
  "total": 2, "message": "120 de 212 vídeos avaliados", "step": {"name": "curate", "done": 120, "total": 212}}}`.

## Hermes' own events the plugin may listen to

- `plugin.<PLUGIN_ID>.settings.changed` `{written: [keys]}` — emitted by the core when the Settings form saves. The
  Desktop may reload `GET /extras`/`GET /status`; the Python side reads the configuration on every use, so nobody
  **needs** it.
