// shared/ext-messages.ts
/** Keys in chrome.storage.local (Hermes is the source of truth; here only cache and credential). */
var STORAGE_KEYS = {
	/** `{ port, token, device_id, paired_at }` — never log the token. */
	connection: "conn",
	/** last `ExtState` + `fetched_at` (ms). */
	stateCache: "state_cache",
	/** local queue of `WatchEvent`s not sent yet. */
	watchOutbox: "watch_outbox",
	/** `SyncStatus` of the last subscriptions sync (the popup reads it; the service worker dies). */
	syncStatus: "sync_status",
	/** scraped batch not sent yet (resend; after 15 min it goes as `partial`). */
	syncPending: "sync_pending",
	/** sync in progress (tab, start) — to close an orphan tab when the service worker restarts. */
	syncRun: "sync_run",
	/** history events refused by the server (`invalid`): diagnostics, never resent. */
	watchRejected: "watch_rejected",
	/** `{ device_name, paired_at }` of the current pairing (pairing writes it, the popup shows it). */
	pairInfo: "pair_info",
	/** port chosen in the popup's "advanced" (absent = automatic discovery). */
	pairPort: "pair_port",
	/** `QueueProgress` of the unsubscribe queue (the executor writes it, the popup shows it) + item in progress. */
	queueRun: "queue_run",
	/** `{ stopped, by, at }` — "Stop" (popup/notice on the page). It only stops; never tells anything to run. */
	queueCtl: "queue_ctl",
	/** items already started: never run again. */
	queueLedger: "queue_ledger",
	/** folders open in the youtube.com sidebar (`{expanded: string[]}`). */
	sidebarTree: "sidebar_tree"
};
/** Names of the chrome.alarms alarms. */
var ALARMS = {
	/** every 30 s while paired: `GET /ext/state` (+ `kick_if_due` on the server). */
	state: "tube-state",
	/** every 6 h: sync subscriptions. */
	sync: "tube-sync"
};
// shared/ids.ts
var PLUGIN_ID = "hermes-tube";
/** Common message keys (i18n namespace `common`). */
var MESSAGE_KEYS = {
	/** No RPC on this backend (`-32601`/no `plugin-rpc-v1`): `{message}` fallback of the rpc.yaml methods. */
	openDesktopBackend: "open_desktop_backend",
	/** `ext_endpoint_up` false / the extension cannot find the server: "open Hermes to reconnect". */
	reconnectOpenHermes: "reconnect_open_hermes",
	/** Undo refused with reason `already_executed`. */
	alreadyExecuted: "already_executed",
	/** `llm_unavailable`: set a model for the `curator` task (Settings → Models). */
	noModel: "no_model"
};
var EXT_HOST = "127.0.0.1";
var EXT_PORT_BASE = 47615;
/** The 10 ports the extension scans with `GET /health` (keeps `service === PLUGIN_ID`). */
var EXT_PORTS = Array.from({ length: 10 }, (_, i) => EXT_PORT_BASE + i);
function extBaseUrl(port) {
	return `http://${EXT_HOST}:${port}`;
}
// extension/src/background/welcome.ts
/** The popup page in tab mode (relative to the extension root). */
var WELCOME_PAGE = "popup/index.html?welcome=1";
/** Opens the pairing tab unless a pairing already exists. Never throws; `true` = a tab was opened. */
async function openWelcomeTab() {
	try {
		const got = await chrome.storage.local.get(STORAGE_KEYS.connection);
		if (Boolean(got[STORAGE_KEYS.connection]?.token)) return false;
		await chrome.tabs.create({
			url: chrome.runtime.getURL(WELCOME_PAGE),
			active: true
		});
		return true;
	} catch (e) {
		console.warn("[tube] could not open the pairing tab", e);
		return false;
	}
}
/** `chrome.runtime.onInstalled` handler: only a fresh install opens the tab. */
function onInstalledWelcome(details) {
	if (details?.reason === "install") openWelcomeTab();
}
// shared/api-types.ts
/** Every error code, in x-error-codes order. */
var ERROR_CODES = [
	"not_found",
	"conflict",
	"invalid",
	"unauthorized",
	"undo_refused",
	"approval_refused",
	"timeout",
	"busy",
	"llm_unavailable",
	"llm_invalid",
	"youtube_error",
	"http_error",
	"origin_forbidden",
	"origin_required",
	"origin_mismatch",
	"host_forbidden",
	"plugin_disabled",
	"no_active_code",
	"invalid_code",
	"expired",
	"used",
	"locked",
	"ext_endpoint_down",
	"internal"
];
// extension/src/lib/envelope.ts
var ok = (data) => ({
	ok: true,
	data
});
function fail(code, message, extra = {}) {
	const error = {
		code,
		message
	};
	if (extra.reason !== void 0) error.reason = extra.reason;
	if (extra.details !== void 0) error.details = extra.details;
	return {
		ok: false,
		error
	};
}
var CODES = new Set(ERROR_CODES);
/** Does the value have the shape of a contract envelope? (decided by the body, not the HTTP status) */
function isEnvelope(v) {
	if (!v || typeof v !== "object") return false;
	const e = v;
	if (e.ok === true) return "data" in e;
	if (e.ok !== false || !e.error || typeof e.error !== "object") return false;
	const err = e.error;
	return typeof err.code === "string" && CODES.has(err.code) && typeof err.message === "string";
}
/** Short message for any exception (no stack). */
function errorMessage(e) {
	if (e instanceof Error) return e.message || e.name;
	return String(e);
}
// extension/src/lib/i18n.ts
var CATALOGS = {
	en: {
		common: {
			reconnect_open_hermes: "Open Hermes to reconnect",
			unpaired: "Not connected to Hermes yet",
			unauthorized: "Hermes did not accept this browser. Pair again.",
			connected: "Connected to Hermes",
			connected_port: "Connected to Hermes (port {port})",
			timeout: "Hermes took too long to answer",
			error: "Something went wrong talking to Hermes",
			invalid_response: "Unexpected answer from Hermes",
			server_unverified: "The program answering on this port could not prove it is your Hermes, so the extension did not send anything. Open Hermes, or pair again.",
			server_outdated: "Hermes needs a newer version of the HermesTube plugin to pair with this extension.",
			code_mismatch: "The code did not match the one Hermes is showing."
		},
		popup: {
			app_name: "Hermes · Subscriptions",
			loading: "Loading…",
			pill_connected: "Connected",
			pill_checking: "Checking…",
			pill_unpaired: "Not connected",
			pill_reconnect_needed: "Hermes closed",
			pill_unauthorized: "Pairing refused",
			pill_error: "Needs attention",
			tagline: "Connect this browser to Hermes to organize your YouTube subscriptions.",
			code_label: "Pairing code",
			code_hint: "6 digits, shown in Hermes. Pasting works.",
			connect: "Connect",
			pairing: "Looking for Hermes…",
			where_code: "Where do I find the code?",
			where_step1: "Open the Hermes desktop app.",
			where_step2: "Go to the plugin page (YouTube subscriptions).",
			where_step3: "Click “Connect extension”. A 6-digit code appears; it is valid for 5 minutes.",
			advanced: "Advanced",
			address_label: "Hermes address",
			address_placeholder: "automatic",
			address_hint: "Leave empty: the extension finds Hermes on this computer by itself.",
			address_invalid: "Use an address on this computer, like http://127.0.0.1:47615",
			err_invalid_code_one: "Wrong code. {count} attempt left.",
			err_invalid_code_other: "Wrong code. {count} attempts left.",
			err_invalid_code: "Wrong code. Check the digits in Hermes.",
			err_expired: "This code has expired (each code lasts 5 minutes). Get a new one in Hermes.",
			err_used: "This code was already used. Get a new one in Hermes.",
			err_locked: "Too many wrong tries, so the code was blocked. Get a new one in Hermes.",
			err_no_active_code: "Hermes is open but has no active code. Click “Connect extension” on the plugin page.",
			err_ext_endpoint_down: "Can't find Hermes on this computer. Open Hermes and the plugin page, then try again.",
			err_invalid: "The code has 6 digits.",
			err_timeout: "Hermes took too long to answer. Try again.",
			err_plugin_disabled: "The plugin is turned off in Hermes. Turn it on and try again.",
			err_refused: "Hermes refused this browser. Get a new code and try again.",
			err_other: "Couldn't connect. Try again.",
			err_server_unverified: "Something on this computer answered instead of Hermes, so the code was not used. Open Hermes Desktop on the pairing screen and try again.",
			err_server_outdated: "Update the HermesTube plugin in Hermes, then pair again.",
			this_browser: "This browser",
			paired_on: "Paired {date}",
			seen: "Hermes answered {when}",
			details: "Details",
			details_address: "Address: {address}",
			details_device: "Device: {id}",
			just_now: "just now",
			last_sync: "Last sync",
			sync_never: "Not synced yet.",
			sync_channels_one: "{count} channel",
			sync_channels_other: "{count} channels",
			sync_complete: "full list",
			sync_partial: "partial",
			sync_partial_note: "Partial list: nothing was marked as unsubscribed.",
			sync_last_ok: "Last successful sync: {when}.",
			sync_never_ok: "No successful sync yet.",
			needs_visible: "Needs a visible sync: in the background, YouTube didn't load the whole list. Click “Sync now”.",
			reason_scroll_stalled: "YouTube stopped loading the list before the end.",
			reason_timeout: "Reading the list took too long.",
			reason_logged_out: "It looks like you're not signed in to YouTube.",
			reason_missing_ids: "Some channels could not be identified and were left out.",
			reason_too_many: "More than 5000 channels: only the first ones were sent.",
			reason_stale: "The list was sent late, so it counts as partial.",
			reason_cancelled: "Reading was cancelled.",
			reason_aborted: "Reading was interrupted.",
			reason_empty: "The subscriptions page was empty.",
			reason_server_partial: "Many channels were missing from the list at once, so Hermes did not mark them as unsubscribed. Nothing changed on YouTube.",
			reason_other: "YouTube's page looked different than expected.",
			sync_err_tab_closed: "The YouTube tab was closed before the end.",
			sync_err_tab_timeout: "YouTube took too long to load your subscriptions.",
			sync_err_scrape_failed: "Couldn't read your subscriptions on YouTube.",
			sync_err_nothing_to_send: "No subscriptions found on the page.",
			sync_err_logged_out: "Sign in to YouTube in this browser to sync.",
			sync_err_ext_endpoint_down: "Hermes was closed; the list goes out when it's back.",
			sync_err_timeout: "Hermes took too long to answer; the list will be sent again.",
			sync_err_invalid: "Hermes rejected the list (extension bug).",
			sync_err_cancelled: "Sync cancelled; nothing was sent.",
			sync_err_unauthorized: "Hermes did not accept this browser.",
			sync_err_not_started: "The sync didn't start. Try again.",
			sync_err_other: "The sync failed.",
			sync_now: "Sync now",
			syncing: "Reading your subscriptions on YouTube…",
			syncing_since: "Started {when}.",
			syncing_note: "A YouTube tab stays open meanwhile. Nothing changes in your account.",
			open_hermes: "Open in Hermes",
			disconnect: "Disconnect",
			disconnect_title: "Disconnect this browser?",
			disconnect_body: "Hermes stops getting your subscriptions from here, and what the extension saved in this browser is erased. Nothing changes on YouTube.",
			cancel: "Cancel",
			disconnect_yes: "Disconnect",
			disconnecting: "Disconnecting…",
			problem_closed_title: "Hermes is closed",
			problem_closed_body: "Open Hermes and the plugin page. The extension reconnects by itself.",
			problem_unauthorized_title: "Hermes no longer recognizes this browser",
			problem_unauthorized_body: "The pairing was removed in Hermes. Pair again with a new code.",
			problem_logged_out_title: "Sign in to YouTube",
			problem_logged_out_body: "To read your subscriptions, sign in to your YouTube account in this browser. Then sync again.",
			problem_error_title: "Something is off with Hermes",
			problem_error_body: "Hermes answered with an error. Try again in a moment.",
			retry: "Try again",
			checking: "Checking…",
			pair_again: "Pair again",
			open_youtube: "Open YouTube",
			seen_last: "Hermes last answered {when}",
			queue_label: "Unsubscribe queue",
			queue_waiting_one: "{count} approved unsubscribe is waiting",
			queue_waiting_other: "{count} approved unsubscribes are waiting",
			queue_waiting_changes_one: "{count} approved change is waiting",
			queue_waiting_changes_other: "{count} approved changes are waiting",
			queue_waiting_note: "Nothing changes on YouTube until you click Run now. A YouTube tab then opens and stays in view.",
			queue_waiting_more: "and {count} more",
			queue_waiting_resubscribe_item: "Resubscribe: {channel}",
			queue_run_now: "Run now",
			queue_not_now: "Not now",
			queue_starting: "Starting the approved queue…",
			queue_running_unsubscribe: "Cancelling {index} of {total} · {channel}",
			queue_running_resubscribe: "Resubscribing {index} of {total} · {channel}",
			queue_running_note: "Only what you approved in Hermes. A YouTube tab stays in view and closes by itself.",
			queue_stop: "Stop",
			queue_stopping: "Stopping after the current channel…",
			queue_stopped: "Queue stopped",
			queue_stopped_one: "Queue stopped · {count} left",
			queue_stopped_other: "Queue stopped · {count} left",
			queue_stopped_note: "Nothing else changes until you resume.",
			queue_stopped_tab: "The queue tab was closed, so the queue stopped. Nothing else changes until you resume.",
			queue_resume: "Resume",
			queue_resuming: "Resuming the queue…",
			queue_resuming_note: "It continues only with what you approved in Hermes.",
			queue_held_logged_out_title: "Queue on hold: you're signed out of YouTube",
			queue_held_logged_out_body: "Sign in to your YouTube account in this browser, then click Try again.",
			queue_held_challenge_title: "Queue on hold: YouTube verification",
			queue_held_challenge_body: "YouTube asked to confirm it's you. Open YouTube, complete the check, then click Try again.",
			queue_held_failures_title: "Queue on hold: two failures in a row",
			queue_held_failures_body: "The queue stopped so it doesn't keep failing. Check the channel on YouTube, then click Try again.",
			queue_held_cap_title: "Paused after {count} channels",
			queue_held_cap_body: "A short break between batches, so YouTube isn't rushed.",
			queue_held_until: "It tries again by itself {when}.",
			queue_held_cap_until: "It continues by itself {when}.",
			queue_retry: "Try again",
			queue_continue_now: "Continue now",
			queue_done_unsubscribe_one: "{count} unsubscribed",
			queue_done_unsubscribe_other: "{count} unsubscribed",
			queue_done_resubscribe_one: "{count} resubscribed",
			queue_done_resubscribe_other: "{count} resubscribed",
			queue_failed_one: "{count} failed",
			queue_failed_other: "{count} failed",
			queue_finished: "Finished {when}.",
			queue_err: "The extension didn't respond. Try again.",
			queue_reason_button_not_found: "The subscribe button didn't show up on the channel page.",
			queue_reason_confirm_not_found: "YouTube's confirmation didn't show up.",
			queue_reason_state_unchanged: "The button didn't change after the click; the next sync will check.",
			queue_reason_wrong_channel: "The page that opened wasn't this channel; nothing was clicked.",
			queue_reason_logged_out: "Signed out of YouTube.",
			queue_reason_challenge: "YouTube asked for a verification.",
			queue_reason_timeout: "YouTube took too long to respond.",
			queue_reason_stopped: "Stopped by you before the click.",
			queue_reason_interrupted: "The extension was interrupted midway; nothing is retried on its own.",
			queue_reason_tab_closed: "The tab was closed before the end.",
			queue_reason_invalid_item: "Invalid item; nothing was done.",
			queue_reason_page_error: "The YouTube page looked different than expected.",
			queue_reason_other: "Something unexpected happened on the page."
		},
		sync: {
			running: "Syncing subscriptions…",
			done_complete: "Subscriptions synced ({count} channels)",
			done_partial: "Partly synced ({count} channels); nothing was marked as unsubscribed",
			error_invalid: "Hermes rejected the list (extension bug); it will not be resent",
			error_unauthorized: "Hermes did not accept this browser. Pair again.",
			error_ext_endpoint_down: "Open Hermes to sync; the list will be sent when it is back",
			error_timeout: "Hermes took too long; the list will be sent again",
			error_tab_closed: "The subscriptions tab was closed before the end",
			error_tab_timeout: "YouTube took too long to load your subscriptions",
			error_scrape_failed: "Could not read your subscriptions on YouTube",
			error_nothing_to_send: "No subscriptions found. Are you signed in to YouTube?",
			error_logged_out: "Sign in to YouTube in this browser to sync your subscriptions",
			error_other: "Sync failed",
			done_partial_needs_visible: "Partly synced ({count} channels): YouTube did not load the whole list in the background. Use \"Sync now\" to read it all",
			error_cancelled: "Sync cancelled; nothing was sent",
			overlay_title: "Hermes is reading your subscriptions",
			overlay_count: "Channels read: {count}",
			overlay_safe: "Read-only: nothing is changed in your YouTube account.",
			overlay_keep: "Keep this tab in view; it closes by itself when done.",
			overlay_cancel: "Cancel"
		},
		queue: {
			overlay_title_unsubscribe: "Hermes is cancelling subscriptions you approved",
			overlay_title_resubscribe: "Hermes is resubscribing to channels you approved",
			progress_unsubscribe: "Cancelling {index} of {total} · {channel}",
			progress_resubscribe: "Resubscribing {index} of {total} · {channel}",
			overlay_note: "Only items you approved in Hermes. Keep this tab in view; it closes by itself.",
			overlay_stop: "Stop",
			overlay_stopped: "Stopping. Nothing else will be changed.",
			overlay_result_done: "Done · {channel}",
			overlay_result_failed: "Skipped · {channel} ({reason})",
			status_starting: "Starting the approved queue…",
			status_idle: "Queue: {done} done, {failed} failed",
			status_stopped: "Queue stopped by you. Resume it in the extension popup.",
			status_paused_logged_out: "Sign in to YouTube in this browser to continue the queue",
			status_paused_challenge: "YouTube asked for a verification; the queue is paused for a few hours",
			status_paused_failures: "Paused after 2 failures in a row; it will try again later",
			status_paused_cap: "Paused after {count} items; it continues in a few minutes",
			reason_none: "",
			reason_not_subscribed: "already not subscribed",
			reason_already_subscribed: "already subscribed",
			reason_button_not_found: "subscribe button not found",
			reason_confirm_not_found: "confirmation did not appear",
			reason_state_unchanged: "the button did not change",
			reason_wrong_channel: "the page is not this channel",
			reason_logged_out: "signed out of YouTube",
			reason_challenge: "YouTube asked for a verification",
			reason_timeout: "took too long",
			reason_stopped: "stopped",
			reason_interrupted: "interrupted",
			reason_tab_closed: "tab closed",
			reason_invalid_item: "invalid item",
			reason_page_error: "unexpected page"
		},
		search: {},
		sidebar: {
			title: "HermesTube",
			tree_label: "HermesTube tabs and folders",
			refreshing: "Checking for new videos…",
			new_count_one: "{count} new",
			new_count_other: "{count} new",
			none_new: "Nothing new",
			empty_hint: "Organize your channels into folders in Hermes",
			disconnected: "Open Hermes to reconnect",
			unauthorized: "Hermes no longer accepts this browser. Pair again from the extension icon.",
			conn_error: "Hermes is not answering right now",
			expand: "Expand",
			collapse: "Collapse",
			back: "Back",
			close: "Close",
			mark_read: "Mark as read",
			marked_read: "Marked as read",
			undo: "Undo",
			mark_failed: "Couldn't mark as read. Try again in a moment.",
			load_more: "Load more",
			more_error: "Couldn't load more",
			feed_empty: "Nothing new here",
			feed_empty_hint: "New videos from these channels will show up here.",
			feed_error: "Couldn't load the videos",
			feed_error_hint: "Check that Hermes is open.",
			retry: "Try again"
		},
		home: {}
	},
	"pt-BR": {
		common: {
			reconnect_open_hermes: "Abra o Hermes para reconectar",
			unpaired: "Ainda não conectado ao Hermes",
			unauthorized: "O Hermes não aceitou este navegador. Pareie de novo.",
			connected: "Conectado ao Hermes",
			connected_port: "Conectado ao Hermes (porta {port})",
			timeout: "O Hermes demorou demais para responder",
			error: "Algo deu errado na conversa com o Hermes",
			invalid_response: "Resposta inesperada do Hermes",
			server_unverified: "O programa que respondeu nesta porta não provou que é o seu Hermes, então a extensão não enviou nada. Abra o Hermes ou pareie de novo.",
			server_outdated: "O Hermes precisa de uma versão mais nova do plugin HermesTube para parear com esta extensão.",
			code_mismatch: "O código não bateu com o que o Hermes está mostrando."
		},
		popup: {
			app_name: "Hermes · Inscrições",
			loading: "Carregando…",
			pill_connected: "Conectado",
			pill_checking: "Verificando…",
			pill_unpaired: "Não conectado",
			pill_reconnect_needed: "Hermes fechado",
			pill_unauthorized: "Pareamento recusado",
			pill_error: "Com problema",
			tagline: "Conecte este navegador ao Hermes para organizar suas inscrições do YouTube.",
			code_label: "Código de pareamento",
			code_hint: "6 dígitos, mostrados no Hermes. Dá para colar.",
			connect: "Conectar",
			pairing: "Procurando o Hermes…",
			where_code: "Onde acho o código?",
			where_step1: "Abra o Hermes Desktop.",
			where_step2: "Entre na página do plugin (inscrições do YouTube).",
			where_step3: "Clique em “Conectar extensão”. Aparece um código de 6 dígitos, que vale por 5 minutos.",
			advanced: "Avançado",
			address_label: "Endereço do Hermes",
			address_placeholder: "automático",
			address_hint: "Deixe vazio: a extensão acha o Hermes sozinha neste computador.",
			address_invalid: "Use um endereço deste computador, como http://127.0.0.1:47615",
			err_invalid_code_one: "Código errado. Resta {count} tentativa.",
			err_invalid_code_other: "Código errado. Restam {count} tentativas.",
			err_invalid_code: "Código errado. Confira os dígitos no Hermes.",
			err_expired: "Esse código expirou (cada código vale 5 minutos). Gere um novo no Hermes.",
			err_used: "Esse código já foi usado. Gere um novo no Hermes.",
			err_locked: "Muitas tentativas erradas: o código foi bloqueado. Gere um novo no Hermes.",
			err_no_active_code: "O Hermes está aberto, mas sem código ativo. Clique em “Conectar extensão” na página do plugin.",
			err_ext_endpoint_down: "Não achei o Hermes neste computador. Abra o Hermes e a página do plugin, e tente de novo.",
			err_invalid: "O código tem 6 dígitos.",
			err_timeout: "O Hermes demorou para responder. Tente de novo.",
			err_plugin_disabled: "O plugin está desligado no Hermes. Ligue-o e tente de novo.",
			err_refused: "O Hermes recusou este navegador. Gere um código novo e tente de novo.",
			err_other: "Não deu para conectar. Tente de novo.",
			err_server_unverified: "Outro programa neste computador respondeu no lugar do Hermes, então o código não foi usado. Abra o Hermes Desktop na tela de pareamento e tente de novo.",
			err_server_outdated: "Atualize o plugin HermesTube no Hermes e pareie de novo.",
			this_browser: "Este navegador",
			paired_on: "Pareado em {date}",
			seen: "Hermes respondeu {when}",
			details: "Detalhes",
			details_address: "Endereço: {address}",
			details_device: "Aparelho: {id}",
			just_now: "agora mesmo",
			last_sync: "Última sincronização",
			sync_never: "Ainda não sincronizado.",
			sync_channels_one: "{count} canal",
			sync_channels_other: "{count} canais",
			sync_complete: "lista completa",
			sync_partial: "parcial",
			sync_partial_note: "Lista parcial: nenhuma inscrição foi marcada como cancelada.",
			sync_last_ok: "Última vez que deu certo: {when}.",
			sync_never_ok: "Ainda não deu certo nenhuma vez.",
			needs_visible: "Precisa de uma sincronização visível: em segundo plano o YouTube não carregou a lista inteira. Clique em “Sincronizar agora”.",
			reason_scroll_stalled: "O YouTube parou de carregar a lista antes do fim.",
			reason_timeout: "Ler a lista demorou demais.",
			reason_logged_out: "Parece que você não está logado no YouTube.",
			reason_missing_ids: "Alguns canais não foram identificados e ficaram de fora.",
			reason_too_many: "Mais de 5000 canais: só os primeiros foram enviados.",
			reason_stale: "A lista foi enviada com atraso, então vale como parcial.",
			reason_cancelled: "A leitura foi cancelada.",
			reason_aborted: "A leitura foi interrompida.",
			reason_empty: "A página de inscrições veio vazia.",
			reason_server_partial: "Muitos canais sumiram da lista de uma vez, então o Hermes não os marcou como cancelados. Nada mudou no YouTube.",
			reason_other: "A página do YouTube veio diferente do esperado.",
			sync_err_tab_closed: "A aba do YouTube foi fechada antes do fim.",
			sync_err_tab_timeout: "O YouTube demorou demais para carregar suas inscrições.",
			sync_err_scrape_failed: "Não deu para ler suas inscrições no YouTube.",
			sync_err_nothing_to_send: "Nenhuma inscrição encontrada na página.",
			sync_err_logged_out: "Entre no YouTube neste navegador para sincronizar.",
			sync_err_ext_endpoint_down: "O Hermes estava fechado; a lista vai quando ele voltar.",
			sync_err_timeout: "O Hermes demorou para responder; a lista será reenviada.",
			sync_err_invalid: "O Hermes recusou a lista (erro da extensão).",
			sync_err_cancelled: "Sincronização cancelada; nada foi enviado.",
			sync_err_unauthorized: "O Hermes não aceitou este navegador.",
			sync_err_not_started: "A sincronização não começou. Tente de novo.",
			sync_err_other: "A sincronização falhou.",
			sync_now: "Sincronizar agora",
			syncing: "Lendo suas inscrições no YouTube…",
			syncing_since: "Começou {when}.",
			syncing_note: "Uma aba do YouTube fica aberta enquanto isso. Nada muda na sua conta.",
			open_hermes: "Abrir no Hermes",
			disconnect: "Desconectar",
			disconnect_title: "Desconectar este navegador?",
			disconnect_body: "O Hermes para de receber suas inscrições daqui, e o que a extensão guardou neste navegador é apagado. Nada muda no YouTube.",
			cancel: "Cancelar",
			disconnect_yes: "Desconectar",
			disconnecting: "Desconectando…",
			problem_closed_title: "O Hermes está fechado",
			problem_closed_body: "Abra o Hermes e a página do plugin. A extensão reconecta sozinha.",
			problem_unauthorized_title: "O Hermes não reconhece mais este navegador",
			problem_unauthorized_body: "O pareamento foi desfeito no Hermes. Pareie de novo com um código novo.",
			problem_logged_out_title: "Entre no YouTube",
			problem_logged_out_body: "Para ler suas inscrições, entre na sua conta do YouTube neste navegador. Depois, sincronize de novo.",
			problem_error_title: "Algo não vai bem com o Hermes",
			problem_error_body: "O Hermes respondeu com um erro. Tente de novo daqui a pouco.",
			retry: "Tentar de novo",
			checking: "Verificando…",
			pair_again: "Parear de novo",
			open_youtube: "Abrir o YouTube",
			seen_last: "Última resposta do Hermes {when}",
			queue_label: "Fila de cancelamento",
			queue_waiting_one: "{count} cancelamento aprovado está esperando",
			queue_waiting_other: "{count} cancelamentos aprovados estão esperando",
			queue_waiting_changes_one: "{count} alteração aprovada está esperando",
			queue_waiting_changes_other: "{count} alterações aprovadas estão esperando",
			queue_waiting_note: "Nada muda no YouTube até você clicar em Executar agora. Aí uma aba do YouTube abre e fica à vista.",
			queue_waiting_more: "e mais {count}",
			queue_waiting_resubscribe_item: "Reinscrever: {channel}",
			queue_run_now: "Executar agora",
			queue_not_now: "Agora não",
			queue_starting: "Começando a fila aprovada…",
			queue_running_unsubscribe: "Cancelando {index} de {total} · {channel}",
			queue_running_resubscribe: "Reinscrevendo {index} de {total} · {channel}",
			queue_running_note: "Só o que você aprovou no Hermes. Uma aba do YouTube fica à vista e fecha sozinha.",
			queue_stop: "Parar",
			queue_stopping: "Parando depois do canal atual…",
			queue_stopped: "Fila parada",
			queue_stopped_one: "Fila parada · {count} restante",
			queue_stopped_other: "Fila parada · {count} restantes",
			queue_stopped_note: "Nada mais é alterado até você retomar.",
			queue_stopped_tab: "A aba da fila foi fechada, então a fila parou. Nada mais é alterado até você retomar.",
			queue_resume: "Retomar",
			queue_resuming: "Retomando a fila…",
			queue_resuming_note: "Continua só com o que você aprovou no Hermes.",
			queue_held_logged_out_title: "Fila em espera: você saiu da conta do YouTube",
			queue_held_logged_out_body: "Entre na sua conta do YouTube neste navegador e clique em Tentar de novo.",
			queue_held_challenge_title: "Fila em espera: verificação do YouTube",
			queue_held_challenge_body: "O YouTube pediu para confirmar que é você. Abra o YouTube, resolva a verificação e clique em Tentar de novo.",
			queue_held_failures_title: "Fila em espera: duas falhas seguidas",
			queue_held_failures_body: "A fila parou para não insistir no erro. Confira o canal no YouTube e clique em Tentar de novo.",
			queue_held_cap_title: "Pausa depois de {count} canais",
			queue_held_cap_body: "Um intervalo curto entre lotes, para não apressar o YouTube.",
			queue_held_until: "Tenta sozinha {when}.",
			queue_held_cap_until: "Continua sozinha {when}.",
			queue_retry: "Tentar de novo",
			queue_continue_now: "Continuar agora",
			queue_done_unsubscribe_one: "{count} cancelada",
			queue_done_unsubscribe_other: "{count} canceladas",
			queue_done_resubscribe_one: "{count} reinscrição",
			queue_done_resubscribe_other: "{count} reinscrições",
			queue_failed_one: "{count} falhou",
			queue_failed_other: "{count} falharam",
			queue_finished: "Terminou {when}.",
			queue_err: "A extensão não respondeu. Tente de novo.",
			queue_reason_button_not_found: "O botão de inscrição não apareceu na página do canal.",
			queue_reason_confirm_not_found: "A confirmação do YouTube não apareceu.",
			queue_reason_state_unchanged: "O botão não mudou depois do clique; a próxima sincronização confere.",
			queue_reason_wrong_channel: "A página aberta não era deste canal; nada foi clicado.",
			queue_reason_logged_out: "Fora da conta do YouTube.",
			queue_reason_challenge: "O YouTube pediu uma verificação.",
			queue_reason_timeout: "O YouTube demorou demais para responder.",
			queue_reason_stopped: "Parado por você antes do clique.",
			queue_reason_interrupted: "A extensão foi interrompida no meio; nada é repetido sozinho.",
			queue_reason_tab_closed: "A aba foi fechada antes do fim.",
			queue_reason_invalid_item: "Item inválido; nada foi feito.",
			queue_reason_page_error: "A página do YouTube estava diferente do esperado.",
			queue_reason_other: "Algo inesperado aconteceu na página."
		},
		sync: {
			running: "Sincronizando inscrições…",
			done_complete: "Inscrições sincronizadas ({count} canais)",
			done_partial: "Sincronização parcial ({count} canais); nenhuma inscrição foi marcada como cancelada",
			error_invalid: "O Hermes recusou a lista (bug da extensão); ela não será reenviada",
			error_unauthorized: "O Hermes não aceitou este navegador. Pareie de novo.",
			error_ext_endpoint_down: "Abra o Hermes para sincronizar; a lista vai quando ele voltar",
			error_timeout: "O Hermes demorou demais; a lista será reenviada",
			error_tab_closed: "A aba de inscrições foi fechada antes do fim",
			error_tab_timeout: "O YouTube demorou demais para carregar suas inscrições",
			error_scrape_failed: "Não deu para ler suas inscrições no YouTube",
			error_nothing_to_send: "Nenhuma inscrição encontrada. Você está logado no YouTube?",
			error_logged_out: "Entre no YouTube neste navegador para sincronizar suas inscrições",
			error_other: "A sincronização falhou",
			done_partial_needs_visible: "Sincronização parcial ({count} canais): em segundo plano o YouTube não carregou a lista inteira. Use \"Sincronizar agora\" para ler tudo",
			error_cancelled: "Sincronização cancelada; nada foi enviado",
			overlay_title: "Hermes está lendo suas inscrições",
			overlay_count: "Canais lidos: {count}",
			overlay_safe: "Só leitura: nada é alterado na sua conta do YouTube.",
			overlay_keep: "Deixe esta aba à vista; ela fecha sozinha ao terminar.",
			overlay_cancel: "Cancelar"
		},
		queue: {
			overlay_title_unsubscribe: "Hermes está cancelando inscrições que você aprovou",
			overlay_title_resubscribe: "Hermes está reinscrevendo em canais que você aprovou",
			progress_unsubscribe: "cancelando {index} de {total} · {channel}",
			progress_resubscribe: "reinscrevendo {index} de {total} · {channel}",
			overlay_note: "Só itens que você aprovou no Hermes. Deixe esta aba à vista; ela fecha sozinha.",
			overlay_stop: "Parar",
			overlay_stopped: "Parando. Nada mais será alterado.",
			overlay_result_done: "Feito · {channel}",
			overlay_result_failed: "Pulado · {channel} ({reason})",
			status_starting: "Começando a fila aprovada…",
			status_idle: "Fila: {done} feitos, {failed} com falha",
			status_stopped: "Fila parada por você. Retome pelo popup da extensão.",
			status_paused_logged_out: "Entre no YouTube neste navegador para continuar a fila",
			status_paused_challenge: "O YouTube pediu uma verificação; a fila fica pausada por algumas horas",
			status_paused_failures: "Pausada depois de 2 falhas seguidas; tenta de novo mais tarde",
			status_paused_cap: "Pausada depois de {count} itens; continua em alguns minutos",
			reason_none: "",
			reason_not_subscribed: "já não estava inscrito",
			reason_already_subscribed: "já estava inscrito",
			reason_button_not_found: "botão de inscrição não encontrado",
			reason_confirm_not_found: "a confirmação não apareceu",
			reason_state_unchanged: "o botão não mudou",
			reason_wrong_channel: "a página não é deste canal",
			reason_logged_out: "fora da conta do YouTube",
			reason_challenge: "o YouTube pediu uma verificação",
			reason_timeout: "demorou demais",
			reason_stopped: "parado",
			reason_interrupted: "interrompido",
			reason_tab_closed: "aba fechada",
			reason_invalid_item: "item inválido",
			reason_page_error: "página inesperada"
		},
		search: {},
		sidebar: {
			title: "HermesTube",
			tree_label: "Abas e pastas do HermesTube",
			refreshing: "Procurando vídeos novos…",
			new_count_one: "{count} novo",
			new_count_other: "{count} novos",
			none_new: "Nada novo",
			empty_hint: "Organize seus canais em pastas no Hermes",
			disconnected: "Abra o Hermes para reconectar",
			unauthorized: "O Hermes não aceita mais este navegador. Pareie de novo pelo ícone da extensão.",
			conn_error: "O Hermes não está respondendo agora",
			expand: "Abrir",
			collapse: "Fechar",
			back: "Voltar",
			close: "Fechar",
			mark_read: "Marcar como lido",
			marked_read: "Marcado como lido",
			undo: "Desfazer",
			mark_failed: "Não deu para marcar como lido. Tente de novo daqui a pouco.",
			load_more: "Carregar mais",
			more_error: "Não deu para carregar mais",
			feed_empty: "Nada novo aqui",
			feed_empty_hint: "Os vídeos novos destes canais aparecem aqui.",
			feed_error: "Não deu para carregar os vídeos",
			feed_error_hint: "Confira se o Hermes está aberto.",
			retry: "Tentar de novo"
		},
		home: {}
	}
};
function pickLanguage(tag) {
	return tag && /^pt(-|_|$)/i.test(tag) ? "pt-BR" : "en";
}
var browserLanguage = () => typeof navigator === "undefined" ? void 0 : navigator.language;
var current = pickLanguage(browserLanguage());
/** `ExtState.language` is `auto` when the user has not chosen: then the browser language applies. */
function setLanguage(tag) {
	current = pickLanguage(!tag || tag === "auto" ? browserLanguage() : tag);
	return current;
}
/** Text for the key in the current language; falls back to en and then to the key itself. `{name}` is interpolated. */
function t(ns, key, vars) {
	const raw = CATALOGS[current][ns][key] ?? CATALOGS.en[ns][key] ?? key;
	if (!vars) return raw;
	return raw.replace(/\{(\w+)\}/g, (m, name) => name in vars ? String(vars[name]) : m);
}
var P = BigInt(`0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF`);
var Q = (P - 1n) / 2n;
var G = 2n;
var PAKE_VERSION = "hermestube-pair-v1";
var SERVER_PROOF_VERSION = "hermestube-server-v1";
var enc = new TextEncoder();
function subtle() {
	const s = globalThis.crypto?.subtle;
	if (!s) throw new Error("WebCrypto is not available");
	return s;
}
function modPow(base, exp, mod) {
	let result = 1n;
	let b = base % mod;
	let e = exp;
	while (e > 0n) {
		if (e & 1n) result = result * b % mod;
		e >>= 1n;
		if (e > 0n) b = b * b % mod;
	}
	return result;
}
var toHexBytes = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
var bytesToBigInt = (bytes) => bytes.length ? BigInt(`0x${toHexBytes(bytes)}`) : 0n;
var toHex = (v) => v.toString(16).padStart(512, "0");
async function sha256(data) {
	const buf = new Uint8Array(typeof data === "string" ? enc.encode(data) : data);
	return new Uint8Array(await subtle().digest("SHA-256", buf));
}
async function sha256Hex(data) {
	return toHexBytes(await sha256(data));
}
async function hmacHex(key, message) {
	const k = await subtle().importKey("raw", new Uint8Array(key), {
		name: "HMAC",
		hash: "SHA-256"
	}, false, ["sign"]);
	return toHexBytes(new Uint8Array(await subtle().sign("HMAC", k, enc.encode(message))));
}
/** An element of the order-q subgroup nobody knows the discrete log of: a hash squared mod p. */
async function hashToGroup(label) {
	const parts = [];
	for (let i = 0; i < 9; i++) parts.push(await sha256(`${label}|${i}`));
	const all = new Uint8Array(parts.length * 32);
	parts.forEach((p, i) => all.set(p, i * 32));
	return modPow(bytesToBigInt(all) % P, 2n, P);
}
var constants = null;
function groupConstants() {
	constants ??= (async () => ({
		M: await hashToGroup(`${PAKE_VERSION}|M`),
		N: await hashToGroup(`${PAKE_VERSION}|N`)
	}))();
	return constants;
}
/** Jacobi symbol (a/n), n odd and positive. For the prime p it is the Legendre symbol: 1 = a square mod p. */
function jacobi(a, n) {
	let x = (a % n + n) % n;
	let m = n;
	let t = 1;
	while (x !== 0n) {
		while ((x & 1n) === 0n) {
			x >>= 1n;
			const r = m & 7n;
			if (r === 3n || r === 5n) t = -t;
		}
		[x, m] = [m, x];
		if ((x & 3n) === 3n && (m & 3n) === 3n) t = -t;
		x %= m;
	}
	return m === 1n ? t : 0;
}
/**
* A received element, only if it is in the order-q subgroup (and not 1). p is a safe prime, so the subgroup is
* exactly the squares mod p: the Legendre symbol answers that much faster than `v^q mod p`.
*/
function parseElement(text) {
	if (typeof text !== "string" || text.length !== 512 || !/^[0-9a-f]+$/.test(text)) return null;
	const v = BigInt(`0x${text}`);
	if (!(v > 1n && v < P - 1n) || jacobi(v, P) !== 1) return null;
	return v;
}
async function passwordScalar(code) {
	return bytesToBigInt(await sha256(`${PAKE_VERSION}|${code}`)) % Q;
}
function randomScalar() {
	const bytes = /* @__PURE__ */ new Uint8Array(32);
	globalThis.crypto.getRandomValues(bytes);
	return bytesToBigInt(bytes) % (Q - 1n) + 1n;
}
async function sessionKey(port, x, y, k) {
	return sha256(`${PAKE_VERSION}|127.0.0.1:${port}|${toHex(x)}|${toHex(y)}|${toHex(k)}`);
}
function confirmOf(key, role) {
	return hmacHex(key, `${PAKE_VERSION}|${role}`);
}
/** Constant-time-ish comparison of two hex strings of the same length. */
function sameHex(a, b) {
	if (typeof a !== "string" || a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
/** Round 1 (extension): `x = g^a · M^w`. `a` may be fixed (tests). */
async function clientStart(code, a = randomScalar()) {
	const { M } = await groupConstants();
	const w = await passwordScalar(code);
	const x = modPow(G, a, P) * modPow(M, w, P) % P;
	return {
		a,
		x,
		xHex: toHex(x)
	};
}
/**
* After round 1 (extension): the session key if `y` is valid **and** the server's confirmation matches;
* `null` otherwise (the server does not know the code, or answered for another port).
*/
async function clientFinish(code, start, yHex, serverConfirm, port) {
	const y = parseElement(yHex);
	if (y === null) return null;
	const { N } = await groupConstants();
	const k = modPow(y * modPow(N, Q - await passwordScalar(code), P) % P, start.a, P);
	const key = await sessionKey(port, start.x, y, k);
	return sameHex(serverConfirm, await confirmOf(key, "server")) ? key : null;
}
/** `proof` of `GET /health?device=&nonce=`: HMAC keyed by the hex sha256 of the token. */
async function serverProof(token, nonce, port) {
	const tokenHash = await sha256Hex(token);
	return hmacHex(enc.encode(tokenHash), `${SERVER_PROOF_VERSION}|${nonce}|${port}`);
}
function newNonce() {
	const bytes = /* @__PURE__ */ new Uint8Array(16);
	globalThis.crypto.getRandomValues(bytes);
	return toHexBytes(bytes);
}
// extension/src/lib/client.ts
/** How long a port's proof is trusted before it is asked again. */
var VERIFY_TTL_MS = 6e4;
function chromeConnectionStore() {
	return {
		async load() {
			const c = (await chrome.storage.local.get(STORAGE_KEYS.connection))[STORAGE_KEYS.connection];
			return c && typeof c.token === "string" && typeof c.port === "number" ? c : null;
		},
		async save(conn) {
			await chrome.storage.local.set({ [STORAGE_KEYS.connection]: conn });
		},
		async clear() {
			await chrome.storage.local.remove([STORAGE_KEYS.connection, STORAGE_KEYS.stateCache]);
		}
	};
}
/** Errors answered by the transport before the handler: the token was not checked. */
var TRANSPORT_ERRORS = /* @__PURE__ */ new Set([
	"origin_forbidden",
	"origin_required",
	"origin_mismatch",
	"host_forbidden",
	"plugin_disabled",
	"internal"
]);
/** Writes `last_ok_at` to storage at most once a minute (the rest of the status only when it changes). */
var PERSIST_OK_EVERY_MS = 6e4;
var is401 = (a) => a.kind === "response" && (a.envelope ? !a.envelope.ok && a.envelope.error.code === "unauthorized" : a.status === 401);
var ExtClient = class {
	fetchImpl;
	store;
	ports;
	healthTimeoutMs;
	requestTimeoutMs;
	now;
	lastEmitted = null;
	/** port → until when its proof is trusted (memory of this service-worker lifetime only) */
	verified = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Set();
	constructor(opts = {}) {
		this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
		this.store = opts.store ?? chromeConnectionStore();
		this.ports = opts.ports ?? EXT_PORTS;
		this.healthTimeoutMs = opts.healthTimeoutMs ?? 800;
		this.requestTimeoutMs = opts.requestTimeoutMs ?? 1e4;
		this.now = opts.now ?? (() => Date.now());
	}
	/** `GET /health` on one port (no auth); `null` if it does not answer or is not a valid envelope. */
	async health(port) {
		const a = await this.send(port, "GET", "/health", {}, this.healthTimeoutMs);
		if (a.kind !== "response" || !a.envelope?.ok) return null;
		const d = a.envelope.data;
		if (!d || typeof d.service !== "string") return null;
		return {
			service: d.service,
			instance: String(d.instance ?? ""),
			pairing_open: d.pairing_open === true
		};
	}
	/** Scans the ports in parallel and returns those of our service, in port order. */
	async discover() {
		return (await Promise.all(this.ports.map(async (port) => ({
			port,
			health: await this.health(port)
		})))).filter((s) => s.health?.service === PLUGIN_ID);
	}
	/** 6-digit code → token. Tries only the servers with `pairing_open`. */
	async pair(code, name = "Chrome") {
		const clean = code.trim();
		if (!/^\d{6}$/.test(clean)) return fail("invalid", "pairing code must have 6 digits", { details: { field: "code" } });
		const servers = await this.discover();
		if (servers.length === 0) return this.reconnectError();
		const open = servers.filter((s) => s.health.pairing_open);
		if (open.length === 0) return fail("no_active_code", "no active pairing code in Hermes");
		let last = fail("no_active_code", "no active pairing code in Hermes");
		for (const s of open) {
			const res = await this.pakePair(s.port, clean, name);
			if (res.ok) {
				const paired = res.data;
				const conn = {
					port: s.port,
					token: paired.token,
					device_id: paired.device.id,
					paired_at: this.now(),
					auth: "pake1",
					status: {
						state: "connected",
						last_ok_at: this.now(),
						error: null
					}
				};
				await this.store.save(conn);
				this.verified.set(s.port, this.now() + VERIFY_TTL_MS);
				const st = this.toStatus(conn);
				this.emit(st);
				return ok(st);
			}
			last = res;
		}
		return last;
	}
	/** Both PAKE rounds on one port. The code itself never leaves; round 2 only after the server confirmed. */
	async pakePair(port, code, name) {
		const json = { "Content-Type": "application/json" };
		const start = await clientStart(code);
		const a1 = await this.send(port, "POST", "/pair/complete", json, this.requestTimeoutMs, {
			name,
			pake: { x: start.xHex }
		});
		if (a1.kind !== "response" || !a1.envelope?.ok) {
			if (a1.kind === "response" && a1.envelope && !a1.envelope.ok && a1.envelope.error.code === "invalid") return fail("invalid", t("common", "server_outdated"), { reason: "server_outdated" });
			return this.attemptError(a1);
		}
		const pake = a1.envelope.data?.pake;
		const key = pake && typeof pake.session === "string" ? await clientFinish(code, start, pake.y, pake.confirm, port) : null;
		if (!key || !pake) {
			const remaining = pake?.remaining;
			if (typeof remaining === "number" && Number.isInteger(remaining) && remaining >= 0 && remaining < 5) return fail("invalid_code", t("common", "code_mismatch"), {
				reason: "server_unverified",
				details: { remaining }
			});
			return fail("unauthorized", t("common", "server_unverified"), { reason: "server_unverified" });
		}
		const a2 = await this.send(port, "POST", "/pair/complete", json, this.requestTimeoutMs, {
			name,
			pake: {
				session: pake.session,
				confirm: await confirmOf(key, "client")
			}
		});
		if (a2.kind === "response" && a2.envelope?.ok) {
			const paired = a2.envelope.data;
			if (paired && typeof paired.token === "string" && typeof paired.device?.id === "string") return ok(paired);
			return fail("internal", t("common", "invalid_response"));
		}
		return this.attemptError(a2);
	}
	/** Does `port` prove it knows this pairing's token? (`GET /health?device=&nonce=`; no token is sent.) */
	async proves(conn, port) {
		const until = this.verified.get(port);
		if (until !== void 0 && until > this.now()) return "ok";
		const nonce = newNonce();
		const path = `/health?device=${encodeURIComponent(conn.device_id ?? "")}&nonce=${nonce}`;
		const a = await this.send(port, "GET", path, {}, this.healthTimeoutMs);
		if (a.kind === "refused" || a.kind === "timeout") {
			this.verified.delete(port);
			return a.kind;
		}
		const data = a.envelope?.ok ? a.envelope.data : null;
		if (data?.service === "hermes-tube" && sameHex(data.proof, await serverProof(conn.token, nonce, port))) {
			this.verified.set(port, this.now() + VERIFY_TTL_MS);
			return "ok";
		}
		this.verified.delete(port);
		return "unverified";
	}
	/** `POST /ext/unpair` (best effort) and erases the local data. */
	async unpair() {
		if (await this.store.load()) try {
			await this.request("POST /ext/unpair");
		} catch {}
		await this.store.clear();
		const st = this.toStatus(null);
		this.emit(st);
		return st;
	}
	async request(key, ...args) {
		const params = args[0] ?? {};
		const [method, tpl] = key.split(" ");
		const path = buildPath(tpl, params.path, params.query);
		const conn = await this.store.load();
		if (!conn) {
			this.emit(this.toStatus(null));
			return fail("unauthorized", t("common", "unpaired"), { reason: "unpaired" });
		}
		const headers = { Authorization: `Bearer ${conn.token}` };
		if (params.body !== void 0) headers["Content-Type"] = "application/json";
		const go = (port) => this.send(port, method, path, headers, this.requestTimeoutMs, params.body);
		const proven = await this.proves(conn, conn.port);
		if (proven === "timeout") return this.finishError(conn, conn.port, fail("timeout", t("common", "timeout")));
		const first = proven === "ok" ? await go(conn.port) : { kind: proven };
		if (first.kind === "timeout") return this.finishError(conn, conn.port, fail("timeout", t("common", "timeout")));
		if (first.kind === "response" && !is401(first)) return this.finish(conn, conn.port, first);
		if (first.kind !== "unverified") this.verified.delete(conn.port);
		const others = (await this.discover()).filter((s) => s.port !== conn.port);
		for (const s of others) {
			if (await this.proves(conn, s.port) !== "ok") continue;
			const again = await go(s.port);
			if (again.kind === "response" && !is401(again)) return this.finish(conn, s.port, again);
		}
		if (first.kind === "refused") {
			const err = this.reconnectError();
			await this.saveStatus(conn, conn.port, "reconnect_needed", null, err.ok ? null : err.error);
			return err;
		}
		if (first.kind === "unverified") {
			const err = fail("unauthorized", t("common", "server_unverified"), { reason: "server_unverified" });
			await this.saveStatus(conn, conn.port, "unauthorized", null, err.ok ? null : err.error);
			return err;
		}
		const env = first.envelope && !first.envelope.ok ? first.envelope : fail("unauthorized", t("common", "unauthorized"));
		await this.saveStatus(conn, conn.port, "unauthorized", null, env.ok ? null : env.error);
		return env;
	}
	async status() {
		return this.toStatus(await this.store.load());
	}
	/** Notifies when the connection state changes (connected → reconnect_needed etc.). */
	onStatus(cb) {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}
	toStatus(conn) {
		if (!conn) return {
			state: "unpaired",
			port: null,
			device_id: null,
			last_ok_at: null,
			error: null
		};
		const s = conn.status;
		return {
			state: s?.state ?? "connected",
			port: conn.port,
			device_id: conn.device_id,
			last_ok_at: s?.last_ok_at ?? null,
			error: s?.error ?? null
		};
	}
	emit(st) {
		if (st.state === this.lastEmitted) return;
		this.lastEmitted = st.state;
		for (const cb of this.listeners) try {
			cb(st);
		} catch {}
	}
	reconnectError() {
		return fail("ext_endpoint_down", t("common", MESSAGE_KEYS.reconnectOpenHermes), { reason: "reconnect_needed" });
	}
	attemptError(a) {
		if (a.kind === "refused") return this.reconnectError();
		if (a.kind === "timeout") return fail("timeout", t("common", "timeout"));
		if (a.envelope && !a.envelope.ok) return a.envelope;
		return fail("internal", t("common", "invalid_response"), { details: { http_status: a.status } });
	}
	async finish(conn, port, a) {
		if (!a.envelope) return this.finishError(conn, port, this.attemptError(a));
		const env = a.envelope;
		if (!env.ok && TRANSPORT_ERRORS.has(env.error.code)) return this.finishError(conn, port, env);
		await this.saveStatus(conn, port, "connected", this.now(), null);
		return env;
	}
	async finishError(conn, port, env) {
		await this.saveStatus(conn, port, "error", null, env.ok ? null : env.error);
		return env;
	}
	async saveStatus(conn, port, state, okAt, error) {
		const prev = conn.status;
		const status = {
			state,
			last_ok_at: okAt ?? prev?.last_ok_at ?? null,
			error
		};
		const next = {
			...conn,
			port,
			status
		};
		this.emit(this.toStatus(next));
		if (!(port !== conn.port || prev?.state !== state || JSON.stringify(prev?.error ?? null) !== JSON.stringify(error) || okAt !== null && (prev?.last_ok_at == null || okAt - prev.last_ok_at >= PERSIST_OK_EVERY_MS))) return;
		const current = await this.store.load();
		if (!current || current.token !== conn.token) return;
		await this.store.save({
			...current,
			port,
			status
		});
	}
	async send(port, method, path, headers, timeoutMs, body) {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
		try {
			const res = await this.fetchImpl(`${extBaseUrl(port)}${path}`, {
				method,
				headers,
				body: body === void 0 ? void 0 : JSON.stringify(body),
				signal: ctrl.signal,
				cache: "no-store"
			});
			let parsed = null;
			try {
				parsed = await res.json();
			} catch {
				parsed = null;
			}
			return {
				kind: "response",
				status: res.status,
				envelope: isEnvelope(parsed) ? parsed : null
			};
		} catch {
			if (ctrl.signal.aborted) return { kind: "timeout" };
			return { kind: "refused" };
		} finally {
			clearTimeout(timer);
		}
	}
};
function buildPath(tpl, path, query) {
	let out = tpl.replace(/\{(\w+)\}/g, (_m, name) => {
		const v = path?.[name];
		if (v === void 0 || v === null || v === "") throw new Error(`missing path parameter "${name}" for ${tpl}`);
		return encodeURIComponent(String(v));
	});
	if (query) {
		const qs = new URLSearchParams();
		for (const [k, v] of Object.entries(query)) if (v !== void 0 && v !== null && v !== "") qs.set(k, String(v));
		const s = qs.toString();
		if (s) out += `?${s}`;
	}
	return out;
}
// extension/src/lib/messaging.ts
function normalize(res, what) {
	if (isEnvelope(res)) return res;
	return fail("internal", `no answer from ${what}`);
}
async function sendTabCommand(tabId, type, payload) {
	try {
		return normalize(await chrome.tabs.sendMessage(tabId, {
			type,
			payload
		}), `tab ${tabId}`);
	} catch (e) {
		return fail("internal", errorMessage(e));
	}
}
// extension/src/lib/router.ts
function createRouter() {
	const handlers = /* @__PURE__ */ new Map();
	function add(type, entry) {
		if (handlers.has(type)) throw new Error(`router: duplicate handler for "${type}"`);
		handlers.set(type, entry);
	}
	async function dispatch(message, sender = null) {
		if (!message || typeof message !== "object" || typeof message.type !== "string") return fail("invalid", "message without type");
		const { type, payload } = message;
		const entry = handlers.get(type);
		if (!entry) return fail("not_found", `unknown message type: ${type}`);
		try {
			const out = await entry.fn(payload ?? {}, sender);
			if (!entry.wrap) return isEnvelope(out) ? out : fail("internal", `handler for ${type} returned no envelope`);
			return ok(out);
		} catch (e) {
			return fail("internal", errorMessage(e));
		}
	}
	return {
		on(type, handler) {
			add(type, {
				wrap: true,
				fn: handler
			});
		},
		onEnvelope(type, handler) {
			add(type, {
				wrap: false,
				fn: handler
			});
		},
		dispatch,
		listen() {
			const listener = (message, sender, sendResponse) => {
				if (sender?.id && sender.id !== chrome.runtime.id) return false;
				const type = message?.type;
				if (typeof type !== "string" || !handlers.has(type)) return false;
				dispatch(message, sender).then(sendResponse, (e) => sendResponse(fail("internal", errorMessage(e))));
				return true;
			};
			chrome.runtime.onMessage.addListener(listener);
			return () => chrome.runtime.onMessage.removeListener(listener);
		},
		types() {
			return [...handlers.keys()];
		}
	};
}
// extension/src/lib/background.ts
function createBackground(opts) {
	const client = opts.client ?? new ExtClient();
	const now = opts.now ?? (() => Date.now());
	const router = createRouter();
	const stateListeners = /* @__PURE__ */ new Set();
	const alarmListeners = /* @__PURE__ */ new Map();
	let inflight = null;
	async function getState() {
		return (await chrome.storage.local.get(STORAGE_KEYS.stateCache))[STORAGE_KEYS.stateCache] ?? null;
	}
	async function doRefresh() {
		const res = await client.request("GET /ext/state");
		if (res.ok) {
			setLanguage(res.data.language);
			const cached = {
				state: res.data,
				fetched_at: now()
			};
			await chrome.storage.local.set({ [STORAGE_KEYS.stateCache]: cached });
			for (const cb of [...stateListeners]) try {
				await cb(res.data);
			} catch (e) {
				console.warn("[tube] state listener failed", e);
			}
		}
		return res;
	}
	/** one `GET /ext/state` at a time (alarm + popup at the same time) */
	function refreshState() {
		if (!inflight) inflight = doRefresh().finally(() => inflight = null);
		return inflight;
	}
	async function syncAlarm() {
		const got = await chrome.storage.local.get(STORAGE_KEYS.connection);
		if (!Boolean(got[STORAGE_KEYS.connection]?.token)) {
			await chrome.alarms.clear(ALARMS.state);
			return;
		}
		const period = 30 / 60;
		const existing = await chrome.alarms.get(ALARMS.state);
		if (!existing || existing.periodInMinutes !== period) await chrome.alarms.create(ALARMS.state, {
			periodInMinutes: period,
			delayInMinutes: period
		});
	}
	const ctx = {
		client,
		router,
		onState(cb) {
			stateListeners.add(cb);
			return () => stateListeners.delete(cb);
		},
		onAlarm(name, cb) {
			const list = alarmListeners.get(name) ?? [];
			list.push(cb);
			alarmListeners.set(name, list);
		},
		getState,
		refreshState,
		sendTabCommand,
		now
	};
	router.on("conn.status", async (p) => {
		if (p?.probe) await refreshState();
		return client.status();
	});
	router.onEnvelope("state.get", async (p) => {
		if (p?.refresh) return refreshState();
		return ok((await getState())?.state ?? null);
	});
	router.onEnvelope("feed.get", async (p) => {
		if ([
			"tab",
			"folder",
			"channel"
		].filter((k) => p?.[k]).length !== 1) return fail("invalid", "exactly one of tab, folder, channel", { details: { field: "tab|folder|channel" } });
		return client.request("GET /ext/feed", { query: {
			tab: p.tab,
			folder: p.folder,
			channel: p.channel,
			limit: p.limit,
			cursor: p.cursor ?? void 0
		} });
	});
	router.onEnvelope("videos.state", async (p) => client.request("POST /ext/videos/state", { body: p }));
	router.onEnvelope("read.mark", async (p) => client.request("POST /ext/read", { body: p }));
	for (const m of opts.modules) m.register(ctx);
	return {
		ctx,
		router,
		client,
		refreshState,
		start() {
			router.listen();
			chrome.alarms.onAlarm.addListener((alarm) => {
				if (alarm.name === ALARMS.state) return void refreshState();
				for (const cb of alarmListeners.get(alarm.name) ?? []) Promise.resolve().then(() => cb(alarm)).catch((e) => console.warn(`[tube] alarm ${alarm.name} failed`, e));
			});
			chrome.storage.onChanged.addListener((changes, area) => {
				if (area !== "local" || !(STORAGE_KEYS.connection in changes)) return;
				const { oldValue, newValue } = changes[STORAGE_KEYS.connection];
				if (oldValue?.token === newValue?.token) return;
				syncAlarm();
				if (newValue?.token) refreshState();
			});
			chrome.runtime.onInstalled?.addListener((details) => {
				syncAlarm();
				onInstalledWelcome(details);
			});
			chrome.runtime.onStartup?.addListener(() => void syncAlarm());
			syncAlarm();
		}
	};
}
// extension/src/background/history.ts
var MODULE$4 = "background/history";
var ROUTES$4 = ["POST /ext/sync/watch"];
var REAL_ROUTES$4 = ["POST /ext/sync/watch"];
var MESSAGES$4 = ["sync.watch"];
/** batches rejected with `invalid` (bug): kept for diagnostics, never resent. Local key. */
var WATCH_REJECTED_KEY = STORAGE_KEYS.watchRejected;
/** outbox cap (storage protection): past it, drops the oldest */
var OUTBOX_CAP = 2e4;
var VIDEO_ID = /^[\w-]{11}$/;
var keyOf = (e) => `${e.video_id}|${e.watched_at}`;
function validate(raw) {
	const e = raw;
	if (!e || typeof e !== "object") return "event must be an object";
	if (typeof e.video_id !== "string" || !VIDEO_ID.test(e.video_id)) return "video_id must be an 11-character YouTube id";
	if (typeof e.watched_at !== "number" || !Number.isInteger(e.watched_at) || e.watched_at < 0) return "watched_at must be integer seconds (UTC)";
	if (e.channel_id != null && typeof e.channel_id !== "string") return "channel_id must be text or null";
	return {
		video_id: e.video_id,
		watched_at: e.watched_at,
		channel_id: e.channel_id ?? null
	};
}
async function read$1() {
	const v = (await chrome.storage.local.get(STORAGE_KEYS.watchOutbox))[STORAGE_KEYS.watchOutbox];
	return Array.isArray(v) ? v : [];
}
var write = (list) => chrome.storage.local.set({ [STORAGE_KEYS.watchOutbox]: list });
/** read-modify-write of the outbox one at a time (messages and sending compete in the same SW) */
var chain = Promise.resolve();
function locked(fn) {
	const run = chain.then(fn, fn);
	chain = run.catch(() => void 0);
	return run;
}
function createOutbox(opts) {
	const now = opts.now ?? (() => Date.now());
	let flushing = null;
	async function removeSent(batch) {
		const done = new Set(batch.map(keyOf));
		await locked(async () => write((await read$1()).filter((e) => !done.has(keyOf(e)))));
	}
	async function reject(batch, error) {
		await removeSent(batch);
		const got = await chrome.storage.local.get(WATCH_REJECTED_KEY);
		const prev = Array.isArray(got[WATCH_REJECTED_KEY]) ? got[WATCH_REJECTED_KEY] : [];
		await chrome.storage.local.set({ [WATCH_REJECTED_KEY]: [...prev, {
			at: now(),
			events: batch,
			error
		}].slice(-20) });
	}
	async function runFlush() {
		const out = {
			sent: 0,
			batches: 0,
			stopped: null
		};
		for (;;) {
			const batch = (await read$1()).slice(0, 500);
			if (batch.length === 0) return out;
			const res = await opts.client.request("POST /ext/sync/watch", { body: { events: batch } });
			if (res.ok) {
				await removeSent(batch);
				out.sent += batch.length;
				out.batches++;
				continue;
			}
			out.stopped = res.error.code;
			if (res.error.code === "invalid") {
				console.error("[tube] POST /ext/sync/watch rejected the batch (invalid): bug, not resent", res.error);
				await reject(batch, {
					code: res.error.code,
					message: res.error.message
				});
			}
			return out;
		}
	}
	return {
		async enqueue(raw) {
			const ev = validate(raw);
			if (typeof ev === "string") return fail("invalid", ev, { details: { field: "event" } });
			return locked(async () => {
				const list = await read$1();
				const k = keyOf(ev);
				if (!list.some((e) => keyOf(e) === k)) {
					list.push(ev);
					await write(list.length > OUTBOX_CAP ? list.slice(-2e4) : list);
				}
				return ok({ queued: Math.min(list.length, OUTBOX_CAP) });
			});
		},
		flush() {
			if (!flushing) flushing = runFlush().finally(() => flushing = null);
			return flushing;
		},
		pending: read$1
	};
}
var CHANNEL_ID$2 = /^UC[\w-]{22}$/;
/** the probe never holds up the outbox longer than this */
var OWNER_PROBE_MS = 3e3;
/**
* Runs **in the tab's MAIN world** (`chrome.scripting.executeScript({func, args, world: 'MAIN'})`): serialized, no outer
* scope. Owner of `videoId` from the player's own response (`#movie_player.getPlayerResponse()`, then the page's
* `ytInitialPlayerResponse`), only when that response describes `videoId`. Read-only; null when in doubt.
*/
function probeWatchOwner(videoId) {
	const UC = /^UC[\w-]{22}$/;
	const pick = (resp) => {
		const d = resp?.videoDetails;
		if (!d || d.videoId !== videoId) return null;
		return typeof d.channelId === "string" && UC.test(d.channelId) ? d.channelId : null;
	};
	const sources = [() => document.getElementById("movie_player")?.getPlayerResponse?.(), () => globalThis.ytInitialPlayerResponse];
	for (const source of sources) try {
		const id = pick(source());
		if (id) return id;
	} catch {}
	return null;
}
/** Fills a missing `channel_id` from the sender tab's player; never fails the event (null stays null). */
async function withOwner(raw, sender) {
	const e = raw;
	const tabId = sender?.tab?.id;
	if (!e || typeof e !== "object" || e.channel_id != null || typeof tabId !== "number") return raw;
	if (typeof e.video_id !== "string" || !VIDEO_ID.test(e.video_id)) return raw;
	let timer;
	try {
		const probe = chrome.scripting.executeScript({
			target: { tabId },
			world: "MAIN",
			func: probeWatchOwner,
			args: [e.video_id]
		});
		const timeout = new Promise((r) => timer = setTimeout(() => r(null), OWNER_PROBE_MS));
		const id = (await Promise.race([probe, timeout]))?.[0]?.result;
		return typeof id === "string" && CHANNEL_ID$2.test(id) ? {
			...e,
			channel_id: id
		} : raw;
	} catch {
		return raw;
	} finally {
		clearTimeout(timer);
	}
}
var history = {
	MODULE: MODULE$4,
	ROUTES: ROUTES$4,
	REAL_ROUTES: REAL_ROUTES$4,
	MESSAGES: MESSAGES$4,
	register(ctx) {
		const box = createOutbox({
			client: ctx.client,
			now: ctx.now
		});
		ctx.router.onEnvelope("sync.watch", async (p, sender) => {
			const res = await box.enqueue(await withOwner(p, sender));
			if (res.ok && res.data.queued >= 50) box.flush();
			return res;
		});
		ctx.onState(() => {
			box.flush();
		});
	}
};
// extension/src/background/pairing.ts
var MODULE$3 = "background/pairing";
var ROUTES$3 = ["POST /pair/complete", "POST /ext/unpair"];
var REAL_ROUTES$3 = ROUTES$3;
var MESSAGES$3 = ["pair.submit", "pair.unpair"];
/** `{device_name, paired_at}` of the current pairing (the popup shows the name). */
var PAIR_INFO_KEY = STORAGE_KEYS.pairInfo;
/** Port chosen in the popup's "advanced" section (absent = automatic discovery). */
var PAIR_PORT_KEY = STORAGE_KEYS.pairPort;
/** The server truncates the name to 80. */
var NAME_MAX = 80;
/** Only the digits 0–9 of the text (pasting "481-516", "481 516", "Code: 481516"), at most 6. */
function normalizeCode(raw) {
	return (raw ?? "").replace(/[^0-9]/g, "").slice(0, 6);
}
/** "Chrome — macOS": the name Hermes shows in the device list. Nothing that identifies the person. */
function deviceName(nav = globalThis.navigator ?? {}) {
	const ua = nav.userAgent ?? "";
	const browser = nav.brave ? "Brave" : / Edg\//.test(ua) ? "Edge" : / OPR\//.test(ua) ? "Opera" : / Vivaldi\//.test(ua) ? "Vivaldi" : "Chrome";
	const os = /CrOS/.test(ua) ? "ChromeOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : null;
	return os ? `${browser} — ${os}` : browser;
}
/** Acceptable port in "advanced" (same range as `parseAddress`). */
function isValidPort(v) {
	return typeof v === "number" && Number.isInteger(v) && v >= 1024 && v <= 65535;
}
async function ensureStateAlarm() {
	const period = 30 / 60;
	const existing = await chrome.alarms.get(ALARMS.state);
	if (!existing || existing.periodInMinutes !== period) await chrome.alarms.create(ALARMS.state, {
		periodInMinutes: period,
		delayInMinutes: period
	});
}
function createPairing(opts = {}) {
	const delay = opts.firstSyncDelayMs ?? 1500;
	const nameOf = opts.deviceName ?? (() => deviceName());
	const clientFor = opts.clientFor ?? ((ports) => new ExtClient({ ports }));
	function firstSync(ctx) {
		setTimeout(() => {
			ctx.router.dispatch({
				type: "sync.now",
				payload: { trigger: "pair" }
			}).then((res) => {
				if (!res.ok) console.warn("[tube] first sync did not start:", res.error.code);
			});
		}, delay);
	}
	return {
		MODULE: MODULE$3,
		ROUTES: ROUTES$3,
		REAL_ROUTES: REAL_ROUTES$3,
		MESSAGES: MESSAGES$3,
		register(ctx) {
			ctx.router.onEnvelope("pair.submit", async (p) => {
				const code = normalizeCode(String(p?.code ?? ""));
				if (code.length !== 6) return fail("invalid", "pairing code must have 6 digits", { details: { field: "code" } });
				const port = p?.port ?? null;
				if (port !== null && !isValidPort(port)) return fail("invalid", "port must be an integer in 1024-65535", { details: { field: "port" } });
				const name = (String(p?.name ?? "").trim() || nameOf()).slice(0, NAME_MAX);
				if (port === null) await chrome.storage.local.remove(PAIR_PORT_KEY);
				else await chrome.storage.local.set({ [PAIR_PORT_KEY]: port });
				const res = await (port === null ? ctx.client : clientFor([port])).pair(code, name);
				if (!res.ok) return res;
				const info = {
					device_name: name,
					paired_at: ctx.now()
				};
				await chrome.storage.local.set({ [PAIR_INFO_KEY]: info });
				await ensureStateAlarm();
				firstSync(ctx);
				return res;
			});
			ctx.router.on("pair.unpair", async () => {
				const st = await ctx.client.unpair();
				await Promise.all([chrome.alarms.clear(ALARMS.state), chrome.alarms.clear(ALARMS.sync)]);
				await chrome.storage.local.clear();
				return st;
			});
		}
	};
}
var pairing = /* @__PURE__ */ createPairing();
// extension/src/lib/queue-release.ts
var QUEUE_WAITING_KEY = "queue_waiting";
var QUEUE_RELEASE_KEY = "queue_release";
var QUEUE_SNOOZE_KEY = "queue_snooze";
function area() {
	return (globalThis.chrome?.storage)?.session ?? null;
}
var idList = (v) => Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x.length > 0 && x.length <= 200))].slice(0, 400) : [];
async function read(key) {
	const s = area();
	if (!s) return null;
	const v = (await s.get(key))[key];
	return v && typeof v === "object" ? v : null;
}
async function writeWaiting(w) {
	const s = area();
	if (!s) return;
	if (w && w.items.length) await s.set({ [QUEUE_WAITING_KEY]: w });
	else await s.remove(QUEUE_WAITING_KEY);
}
/** Current release; `null` when absent, empty or expired. */
async function readRelease(now = Date.now()) {
	const r = await read(QUEUE_RELEASE_KEY);
	if (!r) return null;
	const at = Number(r.at);
	const ids = idList(r.ids);
	if (!Number.isFinite(at) || now - at > 72e5 || at - now > 6e4 || ids.length === 0) return null;
	return {
		ids,
		at
	};
}
/** The executor took this id: it is never released again by the same click. */
async function consumeRelease(id) {
	const s = area();
	if (!s) return;
	const r = await read(QUEUE_RELEASE_KEY);
	if (!r) return;
	const ids = idList(r.ids).filter((x) => x !== id);
	if (ids.length) await s.set({ [QUEUE_RELEASE_KEY]: {
		ids,
		at: r.at
	} });
	else await s.remove(QUEUE_RELEASE_KEY);
}
async function readSnooze() {
	return idList((await read(QUEUE_SNOOZE_KEY))?.ids);
}
/** Items that still need a click (not released, not snoozed). */
function unreleased(w, release, snoozed = []) {
	const skip = /* @__PURE__ */ new Set([...release?.ids ?? [], ...snoozed]);
	return (w?.items ?? []).filter((i) => !skip.has(i.id));
}
// extension/src/background/queue.ts
var MODULE$2 = "background/queue";
var ROUTES$2 = ["GET /ext/queue", "POST /ext/queue/{id}/result"];
var REAL_ROUTES$2 = ["GET /ext/queue", "POST /ext/queue/{id}/result"];
/**
* No message orders an execution: only the server queue. The two from the popup only **stop** (`queue.stop`) or
* **release** the queue and ask for a new `ExtState` (`queue.resume`) — what runs afterwards still comes from `GET /ext/queue`.
*/
var MESSAGES$2 = ["queue.stop", "queue.resume"];
/**
* Keys in chrome.storage.local (`STORAGE_KEYS.queueRun/queueCtl/queueLedger`).
* - `queue_run`: `QueueProgress` (progress for the popup + item in progress for the SW's rebirth).
* - `queue_ctl`: `{stopped, by, at}` — "Stop" (popup/notice). It only **stops**; never orders anything to run.
* - `queue_ledger`: items already started (`LedgerEntry`), never executed again.
*/
var QUEUE_RUN_KEY = STORAGE_KEYS.queueRun;
var QUEUE_CTL_KEY = STORAGE_KEYS.queueCtl;
var QUEUE_LEDGER_KEY = STORAGE_KEYS.queueLedger;
var PAUSE_MIN_MS = 3e3;
var HOLD_MS = {
	logged_out: 36e5,
	challenge: 216e5,
	failures: 18e5,
	cap: 3e5
};
/** how many items the ledger keeps (the oldest drop out; the server will already have them as done/failed) */
var LEDGER_MAX = 300;
var TAB_LOAD_TIMEOUT_MS$1 = 45e3;
/** the content script is not listening yet ("Receiving end does not exist"): retry up to this */
var READY_TIMEOUT_MS$1 = 2e4;
var READY_RETRY_MS$1 = 300;
/** cap for the whole command on the page (the content script has per-step deadlines, much shorter) */
var EXECUTE_TIMEOUT_MS = 12e4;
var KEEPALIVE_MS$1 = 2e4;
var YT = "https://www.youtube.com";
var CHANNEL_ID$1 = /^UC[\w-]{22}$/;
var ACTIONS = ["unsubscribe", "resubscribe"];
/** Short, stable reasons (they go in the `error` of `POST …/result`). `done` notes: `not_subscribed`, `already_subscribed`. */
var QUEUE_REASONS = [
	"not_subscribed",
	"already_subscribed",
	"button_not_found",
	"confirm_not_found",
	"state_unchanged",
	"wrong_channel",
	"logged_out",
	"challenge",
	"timeout",
	"stopped",
	"interrupted",
	"tab_closed",
	"invalid_item",
	"page_error"
];
var DONE_NOTES = ["not_subscribed", "already_subscribed"];
var channelPageUrl = (channelId) => `${YT}/channel/${channelId}`;
/** "Stop" (popup or in-page notice): the queue stops after the click in progress and does not restart on its own. */
async function requestQueueStop(by) {
	const ctl = {
		stopped: true,
		by,
		at: Date.now()
	};
	await chrome.storage.local.set({ [QUEUE_CTL_KEY]: ctl });
}
/** Resume after "Stop" (popup). Also releases a held queue (logged out, failures, cap). */
async function resumeQueue() {
	await chrome.storage.local.remove(QUEUE_CTL_KEY);
	const run = await readProgress();
	if (run && run.state !== "running") await writeProgress({
		...run,
		state: "idle",
		hold_reason: null,
		hold_until: null,
		consecutive_failures: 0
	});
}
async function readCtl() {
	const ctl = (await chrome.storage.local.get(QUEUE_CTL_KEY))[QUEUE_CTL_KEY];
	return ctl?.stopped ? ctl : null;
}
async function readProgress() {
	const v = (await chrome.storage.local.get(QUEUE_RUN_KEY))[QUEUE_RUN_KEY];
	return v && typeof v === "object" ? v : null;
}
function messageFor$1(p) {
	const channel = p.channel_title || p.channel_id || "";
	if (p.state === "running") {
		if (!p.action || p.index === 0) return t("queue", "status_starting");
		return t("queue", `progress_${p.action}`, {
			index: p.index,
			total: Math.max(p.total, p.index),
			channel
		});
	}
	if (p.state === "stopped") return t("queue", "status_stopped");
	if (p.state === "paused" && p.hold_reason) return t("queue", `status_paused_${p.hold_reason}`, { count: 20 });
	return t("queue", "status_idle", {
		done: p.done,
		failed: p.failed
	});
}
async function writeProgress(p) {
	const full = {
		...p,
		message: messageFor$1(p)
	};
	await chrome.storage.local.set({ [QUEUE_RUN_KEY]: full });
	return full;
}
function emptyProgress(now) {
	return {
		state: "idle",
		action: null,
		index: 0,
		total: 0,
		channel_id: null,
		channel_title: null,
		done: 0,
		failed: 0,
		last: null,
		consecutive_failures: 0,
		hold_reason: null,
		hold_until: null,
		started_at: null,
		updated_at: now,
		tab_id: null,
		origin_tab_id: null,
		current: null
	};
}
async function readLedger() {
	const v = (await chrome.storage.local.get(QUEUE_LEDGER_KEY))[QUEUE_LEDGER_KEY];
	return v && typeof v === "object" ? v : {};
}
async function writeLedgerEntry(id, entry) {
	const led = await readLedger();
	led[id] = entry;
	const ids = Object.keys(led);
	if (ids.length > LEDGER_MAX) {
		ids.sort((a, b) => led[a].at - led[b].at);
		for (const old of ids.slice(0, ids.length - LEDGER_MAX)) delete led[old];
	}
	await chrome.storage.local.set({ [QUEUE_LEDGER_KEY]: led });
}
/** Executable item: only `approved`, with human approval, a valid channel and action. */
function validItem(raw) {
	const it = raw;
	if (!it || typeof it !== "object") return null;
	if (typeof it.id !== "string" || !it.id || it.id.length > 200) return null;
	if (it.status !== "approved") return null;
	if (typeof it.approved_via !== "string" || !it.approved_via) return null;
	if (typeof it.approved_at !== "number" || !(it.approved_at > 0)) return null;
	if (typeof it.channel_id !== "string" || !CHANNEL_ID$1.test(it.channel_id)) return null;
	if (!ACTIONS.includes(it.action)) return null;
	return it;
}
function channelOf(view, channelId) {
	const ch = (view?.channels)?.[channelId];
	return ch && typeof ch === "object" ? ch : null;
}
/** The item the server delivered, if executable. */
function pickItem(view) {
	const v = view;
	const it = validItem(Array.isArray(v?.items) ? v.items[0] : void 0);
	return it ? {
		item: it,
		channel: channelOf(v, it.channel_id)
	} : null;
}
/** The listing for the "Run now" prompt (`GET /ext/queue?peek=1`): executable items only, at most `WAITING_MAX`. */
function waitingItems(view) {
	const v = view;
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const raw of Array.isArray(v?.items) ? v.items : []) {
		const it = validItem(raw);
		if (!it || seen.has(it.id)) continue;
		seen.add(it.id);
		out.push({
			id: it.id,
			channel_id: it.channel_id,
			channel_title: titleOf(channelOf(v, it.channel_id)),
			action: it.action
		});
		if (out.length >= 100) break;
	}
	return out;
}
/** Toolbar badge: how many approved items wait for "Run now" (empty = none). Never throws. */
async function setBadge(count) {
	const action = globalThis.chrome?.action;
	if (!action?.setBadgeText) return;
	try {
		await action.setBadgeText({ text: count > 0 ? String(Math.min(count, 999)) : "" });
		if (count > 0) await action.setBadgeBackgroundColor?.({ color: "#b45309" });
	} catch {}
}
/** Content script response → stable result. When in doubt, `failed/page_error` (never `done` without certainty). */
function normalizeResult(res) {
	const r = res;
	const err = typeof r?.error === "string" ? r.error : r?.error === null || r?.error === void 0 ? null : void 0;
	if (r?.status === "done" && (err === null || DONE_NOTES.includes(err))) return {
		status: "done",
		error: err ?? null
	};
	if (r?.status === "failed" && typeof err === "string" && QUEUE_REASONS.includes(err)) return {
		status: "failed",
		error: err
	};
	return {
		status: "failed",
		error: "page_error"
	};
}
var titleOf = (c) => typeof c?.title === "string" ? c.title.slice(0, 200) : null;
async function originTab$1() {
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			lastFocusedWindow: true
		});
		return tab?.id != null ? {
			tabId: tab.id,
			windowId: tab.windowId ?? -1
		} : null;
	} catch {
		return null;
	}
}
/** **Visible** tab (Chrome does not render a background tab), in the origin's window, next to it. */
async function createVisibleTab(origin) {
	if (origin && origin.windowId >= 0) try {
		return await chrome.tabs.create({
			url: "about:blank",
			active: true,
			windowId: origin.windowId,
			openerTabId: origin.tabId
		});
	} catch {}
	return chrome.tabs.create({
		url: "about:blank",
		active: true
	});
}
/** Closes the queue tab; if it was in view (or the user closed it), returns focus to the origin. Never throws. */
async function closeAndRestore$1(tabId, originId, closedByUser) {
	let wasActive = closedByUser;
	if (tabId !== null && !closedByUser) wasActive = (await chrome.tabs.get(tabId).catch(() => null))?.active === true;
	if (originId !== null && wasActive) await chrome.tabs.update(originId, { active: true }).catch(() => void 0);
	if (tabId !== null && !closedByUser) await chrome.tabs.remove(tabId).catch(() => void 0);
}
var isSignin = (url) => /^https:\/\/accounts\.google\.com\//.test(url) || /\/(ServiceLogin|signin)\b/.test(url);
var isChallenge = (url) => /^https:\/\/(www\.)?google\.[a-z.]+\/sorry\//.test(url) || /^https:\/\/www\.youtube\.com\/sorry\b/.test(url) || /^https:\/\/consent\./.test(url);
/** true = loaded a page (≠ the previous one); false = deadline. */
function waitTabLoaded(tabId, prevUrl, timeoutMs) {
	return new Promise((resolve) => {
		let done = false;
		const finish = (v) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			clearInterval(poll);
			chrome.tabs.onUpdated.removeListener(onUpdated);
			resolve(v);
		};
		const good = (tab) => tab?.status === "complete" && typeof tab.url === "string" && /^https?:\/\//.test(tab.url) && tab.url !== prevUrl;
		const onUpdated = (id, info, tab) => {
			if (id === tabId && info.status === "complete" && typeof tab?.url === "string" && /^https?:\/\//.test(tab.url)) finish(true);
		};
		const check = () => void chrome.tabs.get(tabId).then((tab) => good(tab) && finish(true)).catch(() => void 0);
		const timer = setTimeout(() => finish(false), timeoutMs);
		const poll = setInterval(check, 500);
		chrome.tabs.onUpdated.addListener(onUpdated);
		check();
	});
}
function createQueueModule(opts = {}) {
	const random = opts.random ?? Math.random;
	const busy = /* @__PURE__ */ new Set();
	const track = (p) => {
		busy.add(p);
		p.finally(() => busy.delete(p)).catch(() => void 0);
		return p;
	};
	let round = null;
	let flushing = null;
	let recovered = Promise.resolve();
	/** "Stop" arrived in this SW lifetime (wakes the pause) */
	const stopWaiters = /* @__PURE__ */ new Set();
	const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			stopWaiters.delete(done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		stopWaiters.add(done);
	}));
	function register(ctx) {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area === "session" && "queue_release" in changes && changes["queue_release"].newValue) {
				ctx.refreshState();
				return;
			}
			if (area !== "local" || !(QUEUE_CTL_KEY in changes)) return;
			if (changes[QUEUE_CTL_KEY].newValue?.stopped) for (const wake of [...stopWaiters]) wake();
		});
		ctx.onState((state) => {
			track(onState(ctx, state));
		});
		ctx.router.on("queue.stop", async () => {
			await requestQueueStop("popup");
			return readProgress();
		});
		ctx.router.on("queue.resume", async () => {
			await resumeQueue();
			ctx.refreshState();
			return readProgress();
		});
		recovered = track(recover(ctx));
	}
	async function report(ctx, id, result) {
		const res = await ctx.client.request("POST /ext/queue/{id}/result", {
			path: { id },
			body: {
				status: result.status,
				error: result.error
			}
		});
		if (res.ok) return "ok";
		if (res.error.code === "conflict" || res.error.code === "not_found") return "gone";
		return "error";
	}
	/** reports whatever is left unanswered by the server (once each); false = server still down */
	function flushReports(ctx) {
		if (flushing) return flushing;
		flushing = (async () => {
			const led = await readLedger();
			for (const [id, e] of Object.entries(led)) {
				if (e.reported || e.status === "skipped") continue;
				if (await report(ctx, id, {
					status: e.status,
					error: e.error
				}) === "error") return false;
				await writeLedgerEntry(id, {
					...e,
					reported: true
				});
			}
			return true;
		})().finally(() => flushing = null);
		return flushing;
	}
	async function recover(ctx) {
		try {
			const run = await readProgress();
			if (!run) return;
			const cur = run.current;
			if (cur && typeof cur.queue_id === "string" && cur.queue_id) {
				if (!(await readLedger())[cur.queue_id]) {
					const result = cur.phase === "finished" && cur.result ? normalizeResult(cur.result) : {
						status: "failed",
						error: "interrupted"
					};
					await writeLedgerEntry(cur.queue_id, {
						status: result.status,
						error: result.error,
						reported: false,
						at: ctx.now()
					});
				}
			}
			const tabId = typeof run.tab_id === "number" ? run.tab_id : null;
			const originId = typeof run.origin_tab_id === "number" ? run.origin_tab_id : null;
			if (tabId !== null) await closeAndRestore$1(tabId, originId, false);
			const ctl = await readCtl();
			await writeProgress({
				...emptyProgress(ctx.now()),
				...run,
				state: ctl ? "stopped" : run.hold_until && run.hold_until > ctx.now() ? "paused" : "idle",
				current: null,
				tab_id: null,
				updated_at: ctx.now()
			});
			if (cur) await flushReports(ctx);
		} catch (e) {
			console.warn("[tube] queue: recovery failed", errorMessage(e));
		}
	}
	async function onState(ctx, state) {
		await recovered;
		if (round) return;
		if (!await flushReports(ctx)) return;
		if (!(typeof state?.queue_pending === "number" && state.queue_pending > 0)) {
			if (!round) await announce(ctx, []);
			return;
		}
		if (round) return;
		round = (async () => {
			const release = await readRelease(ctx.now());
			if (release) await runRound(ctx, state, release);
			await announce(ctx);
		})().finally(() => round = null);
		await round;
	}
	/**
	* Lists what waits for "Run now" (`GET /ext/queue?peek=1`: nothing is lent) for the popup and the badge.
	* `known` = already known list (`[]` = nothing pending). Never runs anything.
	*/
	async function announce(ctx, known) {
		try {
			let items = known;
			if (!items) {
				const conn = await ctx.client.status();
				if (conn.state === "unpaired" || conn.state === "unauthorized") return;
				const res = await ctx.client.request.call(ctx.client, "GET /ext/queue", { query: { peek: "1" } });
				if (!res.ok) return;
				items = waitingItems(res.data);
			}
			await writeWaiting(items.length ? {
				items,
				at: ctx.now()
			} : null);
			const release = await readRelease(ctx.now());
			await setBadge(unreleased({
				items,
				at: 0
			}, release, await readSnooze()).length);
		} catch (e) {
			console.warn("[tube] queue: listing failed", errorMessage(e));
		}
	}
	async function runRound(ctx, state, release) {
		const released = new Set(release.ids);
		const conn = await ctx.client.status();
		if (conn.state === "unpaired" || conn.state === "unauthorized") return;
		const prev = await readProgress();
		if (await readCtl()) {
			if (prev?.state !== "stopped") await writeProgress({
				...emptyProgress(ctx.now()),
				...prev,
				state: "stopped",
				updated_at: ctx.now()
			});
			return;
		}
		if (prev?.hold_until && prev.hold_until > ctx.now()) return;
		const origin = await originTab$1();
		let p = {
			...emptyProgress(ctx.now()),
			state: "running",
			total: Math.min(20, state.queue_pending, released.size),
			consecutive_failures: prev?.consecutive_failures ?? 0,
			started_at: ctx.now(),
			origin_tab_id: origin?.tabId ?? null
		};
		const save = async (patch = {}) => {
			p = {
				...p,
				...patch,
				updated_at: ctx.now()
			};
			await writeProgress(p);
		};
		await save();
		let tabId = null;
		let userClosed = false;
		const closers = /* @__PURE__ */ new Set();
		const onRemoved = (id) => {
			if (id !== tabId) return;
			userClosed = true;
			for (const fn of [...closers]) fn();
		};
		chrome.tabs.onRemoved.addListener(onRemoved);
		const getInfo = chrome.runtime.getPlatformInfo;
		const keepalive = setInterval(() => void getInfo?.call(chrome.runtime)?.catch?.(() => void 0), KEEPALIVE_MS$1);
		let end = "idle";
		let hold = null;
		const stopRequested = async () => userClosed || await readCtl() !== null;
		try {
			let executedThisRound = 0;
			for (let n = 0; n < 20; n++) {
				if (await stopRequested()) {
					end = "stopped";
					break;
				}
				if (released.size === 0) break;
				const res = await ctx.client.request("GET /ext/queue");
				if (!res.ok) break;
				const picked = pickItem(res.data);
				if (!picked) break;
				const { item, channel } = picked;
				const known = (await readLedger())[item.id];
				if (known) {
					if (!known.reported && known.status !== "skipped") await flushReports(ctx);
					break;
				}
				if (!released.has(item.id)) break;
				if (executedThisRound > 0) {
					await sleep(PAUSE_MIN_MS + Math.floor(Math.min(Math.max(random(), 0), .999999) * 3001));
					if (await stopRequested()) {
						end = "stopped";
						break;
					}
				}
				await save({ current: {
					queue_id: item.id,
					channel_id: item.channel_id,
					action: item.action,
					phase: "claimed",
					started_at: ctx.now()
				} });
				const running = await ctx.client.request("POST /ext/queue/{id}/result", {
					path: { id: item.id },
					body: { status: "running" }
				});
				if (!running.ok) {
					await save({ current: null });
					if (running.error.code === "conflict" || running.error.code === "not_found") {
						await writeLedgerEntry(item.id, {
							status: "skipped",
							error: running.error.code,
							reported: true,
							at: ctx.now()
						});
						released.delete(item.id);
						await consumeRelease(item.id);
						continue;
					}
					break;
				}
				released.delete(item.id);
				await consumeRelease(item.id);
				executedThisRound++;
				await save({
					current: {
						...p.current,
						phase: "running"
					},
					index: p.index + 1,
					total: Math.max(p.total, p.index + 1),
					action: item.action,
					channel_id: item.channel_id,
					channel_title: titleOf(channel)
				});
				let result;
				try {
					if (tabId === null) {
						const tab = await createVisibleTab(origin);
						if (tab?.id == null) throw new Error("tab not created");
						tabId = tab.id;
						await save({ tab_id: tabId });
					}
					await save({ current: {
						...p.current,
						phase: "executing"
					} });
					result = await executeInTab(ctx, tabId, item, titleOf(channel), p.index, p.total);
				} catch (e) {
					console.warn("[tube] queue: tab failed", errorMessage(e));
					result = {
						status: "failed",
						error: userClosed ? "tab_closed" : "page_error"
					};
				}
				if (userClosed && result.status !== "done") result = {
					status: "failed",
					error: "tab_closed"
				};
				await save({ current: {
					...p.current,
					phase: "finished",
					result
				} });
				await writeLedgerEntry(item.id, {
					status: result.status,
					error: result.error,
					reported: false,
					at: ctx.now()
				});
				const sent = await report(ctx, item.id, result);
				if (sent !== "error") await writeLedgerEntry(item.id, {
					status: result.status,
					error: result.error,
					reported: true,
					at: ctx.now()
				});
				const failed = result.status === "failed";
				await save({
					current: null,
					done: p.done + (failed ? 0 : 1),
					failed: p.failed + (failed ? 1 : 0),
					consecutive_failures: failed ? p.consecutive_failures + 1 : 0,
					last: {
						queue_id: item.id,
						status: result.status,
						error: result.error
					}
				});
				if (result.error === "stopped" || result.error === "tab_closed" || userClosed) {
					if (!await readCtl()) await requestQueueStop(userClosed || result.error === "tab_closed" ? "tab" : "page");
					end = "stopped";
					break;
				}
				if (result.error === "logged_out" || result.error === "challenge") {
					hold = result.error;
					break;
				}
				if (p.consecutive_failures >= 2) {
					hold = "failures";
					break;
				}
				if (sent === "error") break;
				if (n === 19) hold = "cap";
			}
		} catch (e) {
			console.warn("[tube] queue: round failed", errorMessage(e));
		} finally {
			clearInterval(keepalive);
			chrome.tabs.onRemoved.removeListener(onRemoved);
			await closeAndRestore$1(tabId, origin?.tabId ?? null, userClosed);
			if (p.current) {
				if (!(await readLedger())[p.current.queue_id]) {
					const r = p.current.phase === "finished" && p.current.result ? p.current.result : {
						status: "failed",
						error: "interrupted"
					};
					await writeLedgerEntry(p.current.queue_id, {
						status: r.status,
						error: r.error,
						reported: false,
						at: ctx.now()
					});
				}
			}
			if (end !== "stopped" && hold) end = "paused";
			if (end !== "stopped" && await readCtl()) end = "stopped";
			await save({
				state: end,
				current: null,
				tab_id: null,
				hold_reason: end === "paused" ? hold : null,
				hold_until: end === "paused" && hold ? ctx.now() + HOLD_MS[hold] : null
			});
		}
	}
	async function executeInTab(ctx, tabId, item, title, index, total) {
		let closed = false;
		let wake = () => void 0;
		const untilClosed = new Promise((r) => wake = () => r(null));
		const onRemoved = (id) => {
			if (id !== tabId) return;
			closed = true;
			wake();
		};
		chrome.tabs.onRemoved.addListener(onRemoved);
		try {
			const target = channelPageUrl(item.channel_id);
			const prevUrl = (await chrome.tabs.get(tabId)).url;
			await chrome.tabs.update(tabId, { url: target });
			const loaded = await Promise.race([waitTabLoaded(tabId, prevUrl, opts.tabLoadTimeoutMs ?? TAB_LOAD_TIMEOUT_MS$1), untilClosed]);
			if (closed || loaded === null) return {
				status: "failed",
				error: "tab_closed"
			};
			if (!loaded) return {
				status: "failed",
				error: "timeout"
			};
			const landed = (await chrome.tabs.get(tabId).catch(() => null))?.url ?? "";
			if (isSignin(landed)) return {
				status: "failed",
				error: "logged_out"
			};
			if (isChallenge(landed)) return {
				status: "failed",
				error: "challenge"
			};
			if (!landed.startsWith(`${YT}/`)) return {
				status: "failed",
				error: "wrong_channel"
			};
			const payload = {
				queue_id: item.id,
				action: item.action,
				channel_url: target,
				channel_id: item.channel_id,
				channel_title: title,
				index,
				total: Math.max(total, index)
			};
			let timer;
			const timeout = new Promise((r) => timer = setTimeout(() => r("timeout"), opts.executeTimeoutMs ?? EXECUTE_TIMEOUT_MS));
			const deadline = Date.now() + (opts.readyTimeoutMs ?? READY_TIMEOUT_MS$1);
			try {
				for (;;) {
					const res = await Promise.race([
						ctx.sendTabCommand(tabId, "queue.execute", payload),
						untilClosed,
						timeout
					]);
					if (closed || res === null) return {
						status: "failed",
						error: "tab_closed"
					};
					if (res === "timeout") return {
						status: "failed",
						error: "timeout"
					};
					if (res.ok) return normalizeResult(res.data);
					if (!/Receiving end does not exist|Could not establish connection/i.test(res.error.message)) return {
						status: "failed",
						error: "page_error"
					};
					if (Date.now() > deadline) return {
						status: "failed",
						error: "timeout"
					};
					await new Promise((r) => setTimeout(r, READY_RETRY_MS$1));
				}
			} finally {
				clearTimeout(timer);
			}
		} finally {
			chrome.tabs.onRemoved.removeListener(onRemoved);
		}
	}
	return {
		MODULE: MODULE$2,
		ROUTES: ROUTES$2,
		REAL_ROUTES: REAL_ROUTES$2,
		MESSAGES: MESSAGES$2,
		register,
		async idle() {
			while (busy.size) await Promise.allSettled([...busy]);
		}
	};
}
var queue = createQueueModule();
var search = {
	MODULE: "background/search",
	ROUTES: ["GET /ext/search-jobs", "POST /ext/search-jobs/{id}/result"],
	REAL_ROUTES: [],
	MESSAGES: [],
	register(ctx) {
		ctx.onState(() => {});
	}
};
// extension/src/background/sync.ts
var MODULE = "background/sync";
var ROUTES = ["POST /ext/sync/subscriptions"];
var REAL_ROUTES = ["POST /ext/sync/subscriptions"];
var MESSAGES = ["sync.subscriptions", "sync.now"];
var FEED_CHANNELS_URL = "https://www.youtube.com/feed/channels";
/** contract: `SubscriptionBatchBody.channels` ≤ 5000 */
var MAX_CHANNELS = 5e3;
var SYNC_STATUS_KEY = STORAGE_KEYS.syncStatus;
var SYNC_PENDING_KEY = STORAGE_KEYS.syncPending;
var SYNC_RUN_KEY = STORAGE_KEYS.syncRun;
/** scraper reasons that, in a background tab, mean "the list did not load without the tab in view" */
var NEEDS_VISIBLE_REASONS = ["scroll_stalled", "timeout"];
/** a stored batch (network failure) older than this goes back as `partial` */
var PENDING_FRESH_MS = 9e5;
/** and older than this is discarded (the next alarm scrapes again) */
var PENDING_MAX_AGE_MS = 216e5;
var TAB_LOAD_TIMEOUT_MS = 6e4;
/** the scraper has a 5 min scroll cap */
var SCRAPE_TIMEOUT_MS = 33e4;
/** the content script has not answered yet ("Receiving end does not exist"): retry up to this */
var READY_TIMEOUT_MS = 2e4;
var READY_RETRY_MS = 500;
/** an API call every 20 s keeps the SW awake during the scroll (MV3 sleeps after 30 s idle) */
var KEEPALIVE_MS = 2e4;
var CHANNEL_ID = /^UC[\w-]{22}$/;
/**
* Runs **in the tab's MAIN world** (`chrome.scripting.executeScript({func, world: 'MAIN'})`): Chrome serializes only
* the function body — no references to outer scope. Reads the `.data` YouTube keeps on each list item
* (invisible to the isolated-world content script) and the `ytcfg`. Read-only.
*/
function probeSubscriptionIds() {
	const UC = /^UC[\w-]{22}$/;
	const g = globalThis;
	let logged_in = null;
	try {
		const cfg = g.ytcfg;
		const v = typeof cfg?.get === "function" ? cfg.get("LOGGED_IN") : cfg?.data_?.LOGGED_IN;
		if (typeof v === "boolean") logged_in = v;
	} catch {
		logged_in = null;
	}
	const find = (node, depth, test) => {
		if (depth > 10 || !node || typeof node !== "object") return void 0;
		for (const [k, v] of Object.entries(node)) if (test(k, v)) return v;
		for (const v of Object.values(node)) {
			const hit = find(v, depth + 1, test);
			if (hit !== void 0) return hit;
		}
	};
	const abs = (href) => {
		if (typeof href !== "string" || !href) return null;
		try {
			return new URL(href, "https://www.youtube.com").href;
		} catch {
			return null;
		}
	};
	const handleOf = (url) => {
		const m = url ? /\/@([^/?#]+)/.exec(url) : null;
		if (!m) return null;
		try {
			return `@${decodeURIComponent(m[1]).toLowerCase()}`;
		} catch {
			return `@${m[1].toLowerCase()}`;
		}
	};
	const items = [];
	const root = document.querySelector("ytd-browse:not([hidden])") ?? document;
	for (const el of Array.from(root.querySelectorAll("ytd-channel-renderer, ytd-grid-channel-renderer, yt-lockup-view-model"))) {
		const e = el;
		const inner = e.__data;
		const ctrl = e.polymerController;
		const data = e.data ?? inner?.data ?? ctrl?.data;
		if (!data || typeof data !== "object") continue;
		const id = find(data, 0, (k, v) => (k === "channelId" || k === "browseId" || k === "contentId") && typeof v === "string" && UC.test(v));
		if (typeof id !== "string") continue;
		const canonical = find(data, 0, (k, v) => k === "canonicalBaseUrl" && typeof v === "string");
		const link = el.querySelector("a[href*=\"/@\"], a[href*=\"/channel/\"]");
		const url = abs(canonical) ?? abs(link?.getAttribute("href"));
		items.push({
			channel_id: id,
			url,
			handle: handleOf(url)
		});
	}
	return {
		logged_in,
		items
	};
}
/**
* Runs **in the tab's MAIN world** before the scrape (serialized function: no outer scope; the names below are
* those of `NUDGE_EVENT`/`NUDGE_ATTR` in content/scraper, checked in a test). Installs a listener for the DOM event the
* scraper fires when the list stalls: finds the page's `ytd-continuation-item-renderer` and calls **once** the
* loading method the element itself exposes (on the element or on the `polymerController`), if any.
* It builds no request and reads no cookie or token: it only asks YouTube for what it would do on seeing the item on screen.
* Response in `<html data-tube-nudge>`: `called:<method>`, `already`, `none` (no method), `no_element`,
* `error:<method>`. Returns `false` if it was already installed.
*/
function installContinuationNudger() {
	const g = globalThis;
	const key = Symbol.for("tube.continuationNudger");
	if (g[key]) return false;
	g[key] = true;
	const METHODS = ["triggerIfNotPreviouslyTriggered", "trigger"];
	const done = /* @__PURE__ */ new WeakSet();
	document.addEventListener("tube:nudge-continuation", () => {
		const answer = (v) => document.documentElement.setAttribute("data-tube-nudge", v);
		const el = (document.querySelector("ytd-browse:not([hidden])") ?? document).querySelector("ytd-continuation-item-renderer");
		if (!el) return answer("no_element");
		if (done.has(el)) return answer("already");
		const e = el;
		const targets = [
			e,
			e.polymerController,
			e.inst
		].filter((x) => !!x && typeof x === "object");
		for (const target of targets) for (const name of METHODS) {
			const fn = target[name];
			if (typeof fn !== "function") continue;
			done.add(el);
			try {
				fn.call(target);
				return answer(`called:${name}`);
			} catch {
				return answer(`error:${name}`);
			}
		}
		return answer("none");
	});
	return true;
}
/** Completes ids through the MAIN world, drops items without a valid id, dedupes, caps at 5000. When in doubt, `partial`. */
function finalizeBatch(channels, signal, probe) {
	const byHandle = /* @__PURE__ */ new Map();
	const byUrl = /* @__PURE__ */ new Map();
	for (const it of probe?.items ?? []) {
		if (!CHANNEL_ID.test(it.channel_id)) continue;
		if (it.handle) byHandle.set(it.handle.toLowerCase(), it.channel_id);
		if (it.url) byUrl.set(it.url.toLowerCase(), it.channel_id);
	}
	let reason = null;
	let out = signal === "complete" ? "complete" : "partial";
	if (probe?.logged_in === false) {
		out = "partial";
		reason = "logged_out";
	}
	const seen = /* @__PURE__ */ new Set();
	const kept = [];
	let dropped = 0;
	for (const c of Array.isArray(channels) ? channels : []) {
		if (!c || typeof c.title !== "string") {
			dropped++;
			continue;
		}
		let id = typeof c.channel_id === "string" && CHANNEL_ID.test(c.channel_id) ? c.channel_id : null;
		if (!id) id = c.handle && byHandle.get(c.handle.toLowerCase()) || c.url && byUrl.get(c.url.toLowerCase()) || null;
		if (!id) {
			dropped++;
			continue;
		}
		if (seen.has(id)) continue;
		seen.add(id);
		kept.push(id === c.channel_id ? c : {
			...c,
			channel_id: id
		});
	}
	if (dropped > 0 && out === "complete") {
		out = "partial";
		reason = "missing_ids";
	}
	if (kept.length > 5e3) {
		kept.length = MAX_CHANNELS;
		if (out === "complete") reason = "too_many";
		out = "partial";
	}
	return {
		batch: {
			channels: kept,
			signal: out
		},
		dropped,
		reason
	};
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** active tab of the focused window (where the user asked for "sync now") */
async function originTab() {
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			lastFocusedWindow: true
		});
		return tab?.id != null && tab.windowId != null ? {
			tabId: tab.id,
			windowId: tab.windowId
		} : null;
	} catch {
		return null;
	}
}
/** Visible: active, in the origin's window, next to it; if the window does not accept a tab (popup, app), in the focused window. */
async function createSyncTab(visible, origin) {
	if (!visible) return chrome.tabs.create({
		url: "about:blank",
		active: false
	});
	if (origin) try {
		return await chrome.tabs.create({
			url: "about:blank",
			active: true,
			windowId: origin.windowId,
			openerTabId: origin.tabId
		});
	} catch {}
	return chrome.tabs.create({
		url: "about:blank",
		active: true
	});
}
/**
* Closes the sync tab and, if it was in view (or the user closed it), returns focus to the origin tab.
* Never throws (the origin window/tab may be gone).
*/
async function closeAndRestore(tabId, origin, closedByUser) {
	let wasActive = closedByUser;
	if (tabId !== null && !closedByUser) wasActive = (await chrome.tabs.get(tabId).catch(() => null))?.active === true;
	if (origin && wasActive) await chrome.tabs.update(origin.tabId, { active: true }).catch(() => void 0);
	if (tabId !== null && !closedByUser) await chrome.tabs.remove(tabId).catch(() => void 0);
}
async function scrapeInTab(ctx, visible) {
	let tabId = null;
	let closed = false;
	const origin = visible ? await originTab() : null;
	const closers = /* @__PURE__ */ new Set();
	const onRemoved = (id) => {
		if (id !== tabId) return;
		closed = true;
		for (const fn of closers) fn();
	};
	/** resolves null when the tab closes */
	const untilClosed = new Promise((r) => closers.add(() => r(null)));
	chrome.tabs.onRemoved.addListener(onRemoved);
	try {
		const tab = await createSyncTab(visible, origin);
		if (tab?.id == null) return {
			ok: false,
			code: "scrape_failed",
			message: "tab not created"
		};
		tabId = tab.id;
		await chrome.storage.local.set({ [SYNC_RUN_KEY]: {
			tab_id: tabId,
			origin_tab_id: origin?.tabId ?? null,
			visible,
			started_at: ctx.now()
		} });
		await chrome.tabs.update(tabId, { url: FEED_CHANNELS_URL });
		const loaded = await Promise.race([waitTabComplete(tabId), untilClosed]);
		if (closed || loaded === null) return {
			ok: false,
			code: "tab_closed",
			message: "tab closed"
		};
		if (loaded === false) return {
			ok: false,
			code: "tab_timeout",
			message: "feed/channels did not load"
		};
		const landed = (await chrome.tabs.get(tabId).catch(() => null))?.url ?? "";
		if (!landed.startsWith("https://www.youtube.com/feed/channels")) return {
			ok: false,
			code: /^https:\/\/accounts\.google\.com\//.test(landed) || /\/signin|ServiceLogin/.test(landed) ? "logged_out" : "scrape_failed",
			message: `landed on ${landed.split("?")[0] || "(unknown)"}`
		};
		await runInMain(tabId, installContinuationNudger);
		if (closed) return {
			ok: false,
			code: "tab_closed",
			message: "tab closed"
		};
		const deadline = Date.now() + READY_TIMEOUT_MS;
		let timer;
		const timeout = new Promise((r) => timer = setTimeout(() => r("timeout"), SCRAPE_TIMEOUT_MS));
		try {
			for (;;) {
				const res = await Promise.race([
					ctx.sendTabCommand(tabId, "scrape.subscriptions", { visible }),
					untilClosed,
					timeout
				]);
				if (closed || res === null) return {
					ok: false,
					code: "tab_closed",
					message: "tab closed"
				};
				if (res === "timeout") return {
					ok: false,
					code: "tab_timeout",
					message: "scrape did not finish"
				};
				if (res.ok) {
					const probe = await runProbe(tabId);
					if (closed) return {
						ok: false,
						code: "tab_closed",
						message: "tab closed"
					};
					return {
						ok: true,
						scrape: res.data,
						probe
					};
				}
				if (!/Receiving end does not exist|Could not establish connection/i.test(res.error.message) || Date.now() > deadline) return {
					ok: false,
					code: "scrape_failed",
					message: res.error.message
				};
				await sleep(READY_RETRY_MS);
			}
		} finally {
			clearTimeout(timer);
		}
	} catch (e) {
		return {
			ok: false,
			code: closed ? "tab_closed" : "scrape_failed",
			message: errorMessage(e)
		};
	} finally {
		chrome.tabs.onRemoved.removeListener(onRemoved);
		await closeAndRestore(tabId, origin, closed);
		await chrome.storage.local.remove(SYNC_RUN_KEY);
	}
}
/** loaded a real page (not the initial about:blank)? */
var loadedPage = (tab) => tab?.status === "complete" && typeof tab.url === "string" && /^https?:\/\//.test(tab.url);
/** true = loaded; false = timed out */
function waitTabComplete(tabId) {
	return new Promise((resolve) => {
		let done = false;
		const finish = (v) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			chrome.tabs.onUpdated.removeListener(onUpdated);
			resolve(v);
		};
		const onUpdated = (id, info, tab) => {
			if (id === tabId && info.status === "complete" && loadedPage({
				status: "complete",
				url: tab?.url
			})) finish(true);
		};
		const timer = setTimeout(() => finish(false), TAB_LOAD_TIMEOUT_MS);
		chrome.tabs.onUpdated.addListener(onUpdated);
		chrome.tabs.get(tabId).then((tab) => {
			if (loadedPage(tab)) finish(true);
		}).catch(() => void 0);
	});
}
async function runInMain(tabId, func) {
	try {
		return (await chrome.scripting.executeScript({
			target: { tabId },
			world: "MAIN",
			func
		}))?.[0]?.result;
	} catch (e) {
		console.warn(`[tube] sync: MAIN world (${func.name}) failed`, errorMessage(e));
		return;
	}
}
async function runProbe(tabId) {
	const r = await runInMain(tabId, probeSubscriptionIds);
	return r && Array.isArray(r.items) ? r : null;
}
async function readStatus() {
	return (await chrome.storage.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] ?? null;
}
async function readPending() {
	return (await chrome.storage.local.get(SYNC_PENDING_KEY))[SYNC_PENDING_KEY] ?? null;
}
function messageFor(s) {
	if (s.state === "running") return t("sync", "running");
	if (s.state === "ok") {
		if (s.signal === "complete") return t("sync", "done_complete", { count: s.sent });
		return t("sync", s.needs_visible ? "done_partial_needs_visible" : "done_partial", { count: s.sent });
	}
	const code = s.error?.code ?? "internal";
	return t("sync", [
		"invalid",
		"unauthorized",
		"ext_endpoint_down",
		"timeout",
		"tab_closed",
		"tab_timeout",
		"scrape_failed",
		"nothing_to_send",
		"logged_out",
		"cancelled"
	].includes(code) ? `error_${code}` : "error_other");
}
function createSyncer(ctx) {
	let current = null;
	let retrying = null;
	/** `needs_visible` omitted = keeps the previous one (nothing proved the list loads in full) */
	async function saveStatus(s) {
		const prev = await readStatus();
		const full = {
			...s,
			last_ok_at: s.last_ok_at ?? prev?.last_ok_at ?? null,
			needs_visible: s.needs_visible ?? prev?.needs_visible ?? false
		};
		await chrome.storage.local.set({ [SYNC_STATUS_KEY]: {
			...full,
			message: messageFor(full)
		} });
	}
	async function post(batch, trigger, meta) {
		const res = await ctx.client.request("POST /ext/sync/subscriptions", { body: batch });
		const base = {
			trigger,
			started_at: meta.started_at,
			finished_at: ctx.now(),
			signal: batch.signal,
			reason: meta.reason,
			sent: batch.channels.length,
			dropped: meta.dropped,
			needs_visible: meta.needs_visible
		};
		if (res.ok) {
			await chrome.storage.local.remove(SYNC_PENDING_KEY);
			const r = res.data;
			const downgraded = batch.signal === "complete" && r.signal === "partial";
			await saveStatus({
				...base,
				...downgraded ? {
					signal: "partial",
					reason: "server_partial"
				} : {},
				state: "ok",
				report: {
					added: r.added?.length ?? 0,
					updated: r.updated?.length ?? 0,
					marked_ex: r.marked_ex?.length ?? 0
				},
				error: null,
				last_ok_at: ctx.now()
			});
			return res;
		}
		const code = res.error.code;
		if (code === "invalid") {
			console.error("[tube] POST /ext/sync/subscriptions rejected the batch (invalid): bug, not resent", res.error);
			await chrome.storage.local.remove(SYNC_PENDING_KEY);
		} else if (code === "unauthorized") await chrome.storage.local.remove(SYNC_PENDING_KEY);
		else {
			const pending = {
				batch,
				scraped_at: meta.scraped_at,
				reason: meta.reason,
				dropped: meta.dropped,
				needs_visible: meta.needs_visible
			};
			await chrome.storage.local.set({ [SYNC_PENDING_KEY]: pending });
		}
		await saveStatus({
			...base,
			state: "error",
			report: null,
			error: {
				code,
				message: res.error.message
			}
		});
		return res;
	}
	async function send(channels, signal, trigger, meta = {}) {
		const started_at = ctx.now();
		const fin = finalizeBatch(channels, signal, meta.probe ?? null);
		const reason = fin.reason ?? meta.reason ?? null;
		return post(fin.batch, trigger, {
			started_at,
			scraped_at: started_at,
			reason,
			dropped: fin.dropped
		});
	}
	async function run(trigger) {
		const started_at = ctx.now();
		const idle = {
			trigger,
			started_at,
			finished_at: null,
			signal: null,
			reason: null,
			sent: 0,
			dropped: 0,
			report: null,
			error: null
		};
		await saveStatus({
			...idle,
			state: "running"
		});
		const getInfo = chrome.runtime.getPlatformInfo;
		const keepalive = setInterval(() => void getInfo?.call(chrome.runtime)?.catch?.(() => void 0), KEEPALIVE_MS);
		const visible = trigger === "manual" || trigger === "pair";
		try {
			const out = await scrapeInTab(ctx, visible);
			if (!out.ok) {
				await saveStatus({
					...idle,
					state: "error",
					finished_at: ctx.now(),
					error: {
						code: out.code,
						message: out.message
					}
				});
				return;
			}
			if (out.scrape.reason === "cancelled") {
				await saveStatus({
					...idle,
					state: "error",
					finished_at: ctx.now(),
					reason: "cancelled",
					error: {
						code: "cancelled",
						message: "cancelled by user"
					}
				});
				return;
			}
			const fin = finalizeBatch(out.scrape.channels, out.scrape.signal, out.probe);
			const reason = fin.reason ?? out.scrape.reason ?? null;
			const stalledInBackground = !visible && NEEDS_VISIBLE_REASONS.includes(out.scrape.reason ?? "");
			const needs_visible = fin.batch.signal === "complete" ? false : stalledInBackground ? true : visible ? false : void 0;
			if (fin.batch.channels.length === 0) {
				await saveStatus({
					...idle,
					state: "error",
					finished_at: ctx.now(),
					signal: fin.batch.signal,
					reason,
					dropped: fin.dropped,
					error: {
						code: "nothing_to_send",
						message: reason ?? "empty"
					}
				});
				return;
			}
			await post(fin.batch, trigger, {
				started_at,
				scraped_at: ctx.now(),
				reason,
				dropped: fin.dropped,
				needs_visible
			});
		} catch (e) {
			await saveStatus({
				...idle,
				state: "error",
				finished_at: ctx.now(),
				error: {
					code: "scrape_failed",
					message: errorMessage(e)
				}
			});
		} finally {
			clearInterval(keepalive);
		}
	}
	async function retryPending() {
		if (current || retrying) return;
		retrying = (async () => {
			const p = await readPending();
			if (!p) return;
			const age = ctx.now() - p.scraped_at;
			if (!(age >= 0) || age > PENDING_MAX_AGE_MS) {
				await chrome.storage.local.remove(SYNC_PENDING_KEY);
				return;
			}
			let batch = p.batch;
			let reason = p.reason;
			if (age > PENDING_FRESH_MS && batch.signal === "complete") {
				batch = {
					...batch,
					signal: "partial"
				};
				reason = "stale";
			}
			await post(batch, "retry", {
				started_at: ctx.now(),
				scraped_at: p.scraped_at,
				reason,
				dropped: p.dropped,
				needs_visible: p.needs_visible
			});
		})().finally(() => retrying = null);
		return retrying;
	}
	async function ensureAlarm() {
		const got = await chrome.storage.local.get(STORAGE_KEYS.connection);
		if (!Boolean(got[STORAGE_KEYS.connection]?.token)) {
			await chrome.alarms.clear(ALARMS.sync);
			return;
		}
		const existing = await chrome.alarms.get(ALARMS.sync);
		if (existing && existing.periodInMinutes === 360) return;
		const last = (await readStatus())?.last_ok_at ?? null;
		const since = last ? (ctx.now() - last) / 6e4 : Infinity;
		const delay = since < 360 ? Math.max(1, 360 - since) : 1;
		await chrome.alarms.create(ALARMS.sync, {
			periodInMinutes: 360,
			delayInMinutes: delay
		});
	}
	return {
		async start(trigger) {
			if (current) return ok({ started: true });
			const conn = await ctx.client.status();
			if (current) return ok({ started: true });
			if (conn.state === "unpaired") return fail("unauthorized", t("common", "unpaired"), { reason: "unpaired" });
			if (conn.state === "unauthorized") return fail("unauthorized", t("common", "unauthorized"), { reason: "unauthorized" });
			current = run(trigger).finally(() => current = null);
			return ok({ started: true });
		},
		send,
		retryPending,
		ensureAlarm,
		running: () => current
	};
}
// extension/src/background/index.ts
var bg = createBackground({ modules: [
	pairing,
	{
		MODULE,
		ROUTES,
		REAL_ROUTES,
		MESSAGES,
		register(ctx) {
			const syncer = createSyncer(ctx);
			ctx.router.onEnvelope("sync.now", (p) => syncer.start(p?.trigger === "pair" ? "pair" : "manual"));
			ctx.router.onEnvelope("sync.subscriptions", (p) => syncer.send(p.channels, "partial", "page"));
			ctx.onAlarm(ALARMS.sync, async () => {
				await syncer.start("alarm");
			});
			ctx.onState(() => {
				syncer.retryPending();
			});
			chrome.storage.onChanged.addListener((changes, area) => {
				if (area !== "local" || !(STORAGE_KEYS.connection in changes)) return;
				const { oldValue, newValue } = changes[STORAGE_KEYS.connection];
				if (oldValue?.token === newValue?.token) return;
				syncer.ensureAlarm();
			});
			chrome.runtime.onStartup?.addListener(() => void syncer.ensureAlarm());
			chrome.runtime.onInstalled?.addListener(() => void syncer.ensureAlarm());
			syncer.ensureAlarm();
			(async () => {
				const run = (await chrome.storage.local.get(SYNC_RUN_KEY))[SYNC_RUN_KEY];
				if (!run || syncer.running()) return;
				if (typeof run.tab_id === "number") {
					const origin = typeof run.origin_tab_id === "number" ? {
						tabId: run.origin_tab_id,
						windowId: -1
					} : null;
					await closeAndRestore(run.tab_id, origin, false);
				}
				await chrome.storage.local.remove(SYNC_RUN_KEY);
			})().catch(() => void 0);
		}
	},
	history,
	queue,
	search
] });
bg.start();
globalThis.__tubeDebug = {
	bootAt: Date.now(),
	refreshState: () => bg.refreshState(),
	dispatch: (message) => bg.router.dispatch(message),
	status: () => bg.client.status(),
	discover: () => bg.client.discover(),
	pair: (code, name) => bg.client.pair(code, name)
};
