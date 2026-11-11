(function() {
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
	function fail$1(code, message, extra = {}) {
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
	function getLanguage() {
		return current;
	}
	/** Text for the key in the current language; falls back to en and then to the key itself. `{name}` is interpolated. */
	function t$1(ns, key, vars) {
		const raw = CATALOGS[current][ns][key] ?? CATALOGS.en[ns][key] ?? key;
		if (!vars) return raw;
		return raw.replace(/\{(\w+)\}/g, (m, name) => name in vars ? String(vars[name]) : m);
	}
	// extension/src/lib/messaging.ts
	function normalize(res, what) {
		if (isEnvelope(res)) return res;
		return fail$1("internal", `no answer from ${what}`);
	}
	async function sendRequest(type, payload) {
		try {
			return normalize(await chrome.runtime.sendMessage({
				type,
				payload
			}), "background");
		} catch (e) {
			return fail$1("internal", errorMessage(e));
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
			if (!message || typeof message !== "object" || typeof message.type !== "string") return fail$1("invalid", "message without type");
			const { type, payload } = message;
			const entry = handlers.get(type);
			if (!entry) return fail$1("not_found", `unknown message type: ${type}`);
			try {
				const out = await entry.fn(payload ?? {}, sender);
				if (!entry.wrap) return isEnvelope(out) ? out : fail$1("internal", `handler for ${type} returned no envelope`);
				return ok(out);
			} catch (e) {
				return fail$1("internal", errorMessage(e));
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
					dispatch(message, sender).then(sendResponse, (e) => sendResponse(fail$1("internal", errorMessage(e))));
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
	// extension/src/lib/content.ts
	var CONTENT_ATTR = "data-tube-ext";
	async function startContent(opts) {
		const doc = opts.doc ?? document;
		const urlOf = opts.url ?? (() => new URL(location.href));
		const active = /* @__PURE__ */ new Map();
		let state = null;
		state = (await chrome.storage.local.get(STORAGE_KEYS.stateCache))[STORAGE_KEYS.stateCache]?.state ?? null;
		setLanguage(state?.language);
		const router = createRouter();
		for (const mod of opts.modules) for (const cmd of mod.COMMANDS) {
			const fn = mod.commands?.[cmd];
			if (fn) router.on(cmd, fn);
		}
		const stopListening = router.listen();
		function mark() {
			doc.documentElement.setAttribute(CONTENT_ATTR, "ready");
			doc.documentElement.setAttribute(`${CONTENT_ATTR}-modules`, [...active.keys()].join(","));
		}
		function wants(mod, url) {
			try {
				return mod.matches(url, state);
			} catch (e) {
				console.warn(`[tube] ${mod.MODULE}.matches failed`, e);
				return false;
			}
		}
		async function evaluate() {
			const url = urlOf();
			for (const [name, entry] of [...active]) {
				if (wants(entry.mod, url)) continue;
				active.delete(name);
				try {
					entry.mod.stop?.();
				} catch (e) {
					console.warn(`[tube] ${name}.stop failed`, e);
				}
			}
			for (const mod of opts.modules) {
				if (active.has(mod.MODULE) || !wants(mod, url)) continue;
				const listeners = /* @__PURE__ */ new Set();
				const ctx = {
					url,
					state,
					send: sendRequest,
					t: t$1,
					onState(cb) {
						listeners.add(cb);
						return () => listeners.delete(cb);
					}
				};
				active.set(mod.MODULE, {
					mod,
					listeners
				});
				try {
					await mod.start(ctx);
				} catch (e) {
					active.delete(mod.MODULE);
					console.warn(`[tube] ${mod.MODULE}.start failed: ${errorMessage(e)}`);
				}
			}
			mark();
		}
		let chain = Promise.resolve();
		const schedule = () => chain = chain.then(evaluate, evaluate);
		const onNavigate = () => void schedule();
		const onStorage = (changes, area) => {
			if (area !== "local" || !(STORAGE_KEYS.stateCache in changes)) return;
			state = changes[STORAGE_KEYS.stateCache].newValue?.state ?? null;
			setLanguage(state?.language);
			for (const { listeners } of active.values()) for (const cb of listeners) cb(state);
			schedule();
		};
		doc.addEventListener("yt-navigate-finish", onNavigate);
		doc.defaultView?.addEventListener("popstate", onNavigate);
		chrome.storage.onChanged.addListener(onStorage);
		await schedule();
		return {
			active: () => [...active.keys()],
			refresh: schedule,
			dispose() {
				doc.removeEventListener("yt-navigate-finish", onNavigate);
				doc.defaultView?.removeEventListener("popstate", onNavigate);
				chrome.storage.onChanged.removeListener(onStorage);
				stopListening();
				for (const { mod } of active.values()) mod.stop?.();
				active.clear();
			}
		};
	}
	var home = {
		MODULE: "content/home",
		ROUTES: [
			"GET /ext/feed",
			"POST /ext/videos/state",
			"POST /ext/read"
		],
		REAL_ROUTES: [],
		COMMANDS: [],
		matches: (url, state) => url.pathname === "/" && state?.home_on_youtube === true,
		start() {},
		stop() {}
	};
	// extension/src/content/sync-overlay.ts
	var OVERLAY_TAG = "tube-sync-overlay";
	var CSS$1 = `
:host {
  all: initial !important;
  display: block !important;
  position: fixed !important;
  z-index: 2147483647 !important;
  left: 50% !important;
  bottom: 24px !important;
  transform: translateX(-50%) !important;
  color-scheme: light dark !important;
  pointer-events: auto !important;
}
.card {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: min(560px, calc(100vw - 32px));
  padding: 12px 16px;
  border: 1px solid GrayText;
  border-radius: 10px;
  background: Canvas;
  color: CanvasText;
  box-shadow: 0 4px 18px color-mix(in srgb, CanvasText 22%, transparent);
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  text-align: left;
}
.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.6;
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse { 50% { opacity: 0.15; } }
.text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.title { font-weight: 600; }
.count { font-variant-numeric: tabular-nums; }
.note { font-size: 12px; opacity: 0.8; }
button {
  flex: none;
  font: inherit;
  padding: 4px 12px;
  border: 1px solid ButtonBorder;
  border-radius: 6px;
  background: ButtonFace;
  color: ButtonText;
  cursor: pointer;
}
button:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
button:disabled { cursor: default; opacity: 0.6; }
@media (prefers-reduced-motion: reduce) {
  .dot { animation: none; }
}
`;
	/** Shows the notice (replaces a previous one left behind). */
	function showSyncOverlay(opts) {
		const doc = opts.doc ?? document;
		const view = doc.defaultView ?? window;
		for (const old of Array.from(doc.querySelectorAll(OVERLAY_TAG))) old.remove();
		const host = doc.createElement(OVERLAY_TAG);
		const root = host.attachShadow({ mode: "open" });
		const style = doc.createElement("style");
		style.textContent = CSS$1;
		const card = doc.createElement("div");
		card.className = "card";
		card.setAttribute("role", "status");
		card.setAttribute("aria-live", "polite");
		const dot = doc.createElement("span");
		dot.className = "dot";
		dot.setAttribute("aria-hidden", "true");
		const text = doc.createElement("div");
		text.className = "text";
		const title = doc.createElement("span");
		title.className = "title";
		title.textContent = t$1("sync", "overlay_title");
		const count = doc.createElement("span");
		count.className = "count";
		count.dataset.role = "count";
		count.textContent = t$1("sync", "overlay_count", { count: 0 });
		const safe = doc.createElement("span");
		safe.className = "note";
		safe.textContent = t$1("sync", "overlay_safe");
		const keep = doc.createElement("span");
		keep.className = "note";
		keep.textContent = t$1("sync", "overlay_keep");
		text.append(title, count, safe, keep);
		const button = doc.createElement("button");
		button.type = "button";
		button.textContent = t$1("sync", "overlay_cancel");
		button.setAttribute("aria-keyshortcuts", "Escape");
		card.append(dot, text, button);
		root.append(style, card);
		let removed = false;
		let cancelled = false;
		const cancel = () => {
			if (cancelled || removed) return;
			cancelled = true;
			button.disabled = true;
			try {
				opts.onCancel();
			} catch (e) {
				console.warn("[tube] sync overlay: onCancel failed", e);
			}
		};
		const onKey = (e) => {
			if (e.key !== "Escape" || removed) return;
			e.preventDefault();
			e.stopPropagation();
			cancel();
		};
		button.addEventListener("click", cancel);
		view.addEventListener("keydown", onKey, true);
		(doc.body ?? doc.documentElement).append(host);
		return {
			update(n) {
				if (!removed) count.textContent = t$1("sync", "overlay_count", { count: Math.max(0, Math.floor(n)) });
			},
			remove() {
				if (removed) return;
				removed = true;
				view.removeEventListener("keydown", onKey, true);
				host.remove();
			},
			get removed() {
				return removed;
			}
		};
	}
	// extension/src/content/scraper.ts
	var MODULE$6 = "content/scraper";
	var ROUTES$6 = ["POST /ext/sync/subscriptions"];
	var REAL_ROUTES$6 = ["POST /ext/sync/subscriptions"];
	var YT$1 = "https://www.youtube.com";
	/** DOM event that asks the MAIN world to trigger the continuation (listener: background/sync `installContinuationNudger`) */
	var NUDGE_EVENT = "tube:nudge-continuation";
	/** attribute on `<html>` with the MAIN world's response: `called:<method>`, `none`, `already`, `no_element`, `error:<method>` */
	var NUDGE_ATTR = "data-tube-nudge";
	var CHANNEL_ID$3 = /^UC[\w-]{22}$/;
	var ITEM = "ytd-channel-renderer, ytd-grid-channel-renderer, yt-lockup-view-model";
	var ITEM_NAME = [
		"[id=\"channel-info\"] [id=\"text\"]",
		"[id=\"channel-title\"] [id=\"text\"]",
		"[id=\"info\"] [id=\"text\"]",
		".yt-lockup-metadata-view-model-wiz__title",
		".yt-lockup-metadata-view-model__title",
		".ytLockupMetadataViewModelTitle"
	].join(", ");
	var ITEM_LINK = [
		"a[id=\"main-link\"]",
		"a[id=\"channel-info\"]",
		"[id=\"channel-info\"] a",
		"a.yt-lockup-metadata-view-model-wiz__title",
		"a.yt-lockup-metadata-view-model__title",
		"a.ytLockupMetadataViewModelTitle",
		"a[href*=\"/@\"]",
		"a[href*=\"/channel/\"]"
	].join(", ");
	var ITEM_AVATAR = "[id=\"avatar\"] img, [id=\"img\"] img, img[id=\"img\"], .yt-lockup-view-model-wiz__content-image img, .yt-lockup-view-model__content-image img, .ytLockupViewModelContentImage img, img";
	var CONTINUATION = "ytd-continuation-item-renderer";
	var LOGGED_OUT_DOM$1 = "ytd-background-promo-renderer, a[href*=\"accounts.google.com/ServiceLogin\"], a[href*=\"accounts.google.com/v3/signin\"]";
	var absUrl = (href) => {
		if (!href) return null;
		try {
			return new URL(href, YT$1).href;
		} catch {
			return null;
		}
	};
	var absThumb = (src) => {
		if (!src) return null;
		if (src.startsWith("//")) return `https:${src}`;
		return /^https?:\/\//.test(src) ? src : null;
	};
	/** `/@Handle` → `@handle` (lowercase; Hermes normalizes again) */
	function handleOf(url) {
		if (!url) return null;
		const m = /\/@([^/?#]+)/.exec(url);
		if (!m) return null;
		try {
			return `@${decodeURIComponent(m[1]).toLowerCase()}`;
		} catch {
			return `@${m[1].toLowerCase()}`;
		}
	}
	/** `/channel/UC…` → `UC…` */
	function channelIdOf(url) {
		const m = url ? /\/channel\/(UC[\w-]{22})(?:[/?#]|$)/.exec(url) : null;
		return m ? m[1] : null;
	}
	var isChannelId = (v) => typeof v === "string" && CHANNEL_ID$3.test(v);
	var rec = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : null;
	var at = (v, ...path) => {
		let cur = v;
		for (const k of path) {
			if (cur == null || typeof cur !== "object") return void 0;
			cur = cur[k];
		}
		return cur;
	};
	var str$1 = (v) => typeof v === "string" && v.trim() ? v.trim() : null;
	var DATA_MARKERS$1 = [
		"var ytInitialData = ",
		"window[\"ytInitialData\"] = ",
		"window['ytInitialData'] = ",
		"ytInitialData = "
	];
	/** Cuts out the JSON object starting at `start`, respecting strings and escapes. */
	function sliceJsonObject$2(text, start) {
		if (text[start] !== "{") return null;
		let depth = 0;
		let inStr = false;
		for (let i = start; i < text.length; i++) {
			const c = text[i];
			if (inStr) {
				if (c === "\\") i++;
				else if (c === "\"") inStr = false;
				continue;
			}
			if (c === "\"") inStr = true;
			else if (c === "{") depth++;
			else if (c === "}") {
				depth--;
				if (depth === 0) return text.slice(start, i + 1);
			}
		}
		return null;
	}
	/** `ytInitialData` from the inline `<script>`s (the content script cannot see the page's global variable). */
	function readInitialData$1(doc) {
		for (const s of Array.from(doc.querySelectorAll("script:not([src])"))) {
			const text = s.textContent ?? "";
			for (const marker of DATA_MARKERS$1) {
				const idx = text.indexOf(marker);
				if (idx === -1) continue;
				const json = sliceJsonObject$2(text, idx + marker.length);
				if (!json) continue;
				try {
					return JSON.parse(json);
				} catch {}
			}
		}
		return null;
	}
	function lastThumb(list) {
		if (!Array.isArray(list) || list.length === 0) return null;
		return absThumb(str$1(at(list[list.length - 1], "url")));
	}
	/** A channel renderer → `ChannelIn`, or null if it is not a channel. */
	function fromRenderer(r, kind) {
		let id = null;
		let title = null;
		let url = null;
		let thumb = null;
		let handle = null;
		if (kind === "lockupViewModel") {
			const browse = at(r, "rendererContext", "commandContext", "onTap", "innertubeCommand", "browseEndpoint");
			const browseId = str$1(at(browse, "browseId"));
			const contentId = str$1(r.contentId);
			if (!(r.contentType === "LOCKUP_CONTENT_TYPE_CHANNEL" || isChannelId(browseId) || isChannelId(contentId))) return null;
			id = isChannelId(browseId) ? browseId : isChannelId(contentId) ? contentId : null;
			if (contentId?.startsWith("@")) handle = contentId.toLowerCase();
			title = str$1(at(r, "metadata", "lockupMetadataViewModel", "title", "content"));
			url = absUrl(str$1(at(browse, "canonicalBaseUrl")));
			thumb = absThumb(str$1(at(r, "contentImage", "collectionThumbnailViewModel", "primaryThumbnail", "thumbnailViewModel", "image", "sources", 0, "url"))) ?? absThumb(str$1(at(r, "contentImage", "decoratedAvatarViewModel", "avatar", "avatarViewModel", "image", "sources", 0, "url"))) ?? absThumb(str$1(at(r, "contentImage", "avatarViewModel", "image", "sources", 0, "url")));
		} else {
			id = isChannelId(r.channelId) ? r.channelId : null;
			title = str$1(at(r, "title", "runs", 0, "text")) ?? str$1(at(r, "title", "simpleText"));
			thumb = lastThumb(at(r, "thumbnail", "thumbnails"));
			url = absUrl(str$1(at(r, "navigationEndpoint", "commandMetadata", "webCommandMetadata", "url"))) ?? absUrl(str$1(at(r, "navigationEndpoint", "browseEndpoint", "canonicalBaseUrl")));
			if (!id) {
				const b = str$1(at(r, "navigationEndpoint", "browseEndpoint", "browseId"));
				if (isChannelId(b)) id = b;
			}
		}
		if (!title || !id && !url) return null;
		if (!url && id) url = `${YT$1}/channel/${id}`;
		handle = handleOf(url) ?? handle;
		if (!id) id = channelIdOf(url);
		return {
			title,
			channel_id: id,
			handle,
			url,
			thumb
		};
	}
	var RENDERERS = [
		"gridChannelRenderer",
		"channelRenderer",
		"lockupViewModel"
	];
	/** Recursive search (depth ≤ 25) for channel renderers; dedup by id. */
	function extractFromInitialData(data) {
		const out = [];
		const seen = /* @__PURE__ */ new Set();
		const walk = (node, depth) => {
			if (depth > 25 || !node || typeof node !== "object") return;
			if (Array.isArray(node)) {
				for (const v of node) walk(v, depth + 1);
				return;
			}
			const r = node;
			for (const k of RENDERERS) {
				const inner = rec(r[k]);
				if (!inner) continue;
				const c = fromRenderer(inner, k);
				if (c) {
					const key = c.channel_id ?? c.handle ?? c.url ?? c.title;
					if (!seen.has(key)) {
						seen.add(key);
						out.push(c);
					}
					return;
				}
			}
			for (const v of Object.values(r)) if (v && typeof v === "object") walk(v, depth + 1);
		};
		walk(data, 0);
		return out;
	}
	/** `in` (ytcfg LOGGED_IN true), `out` (LOGGED_IN false or login promo), `unknown` (no clue). */
	function detectLogin$1(doc) {
		let flag = null;
		for (const s of Array.from(doc.querySelectorAll("script:not([src])"))) {
			const text = s.textContent ?? "";
			const m = /"LOGGED_IN"\s*:\s*(true|false)/.exec(text);
			if (m) {
				flag = m[1] === "true";
				break;
			}
			if (text.includes("\"backgroundPromoRenderer\"") && text.includes("ytInitialData")) flag = false;
		}
		if (flag === false) return "out";
		if (doc.querySelector(LOGGED_OUT_DOM$1)) return "out";
		return flag === true ? "in" : "unknown";
	}
	/** Root of the visible page (YouTube keeps other pages' `ytd-browse` hidden during SPA navigation). */
	function scope(doc) {
		return doc.querySelector("ytd-browse:not([hidden])") ?? doc;
	}
	var domItems = (doc) => Array.from(scope(doc).querySelectorAll(ITEM));
	var hasContinuation = (doc) => scope(doc).querySelector(CONTINUATION) !== null;
	function fromDom(el) {
		const title = str$1(el.querySelector(ITEM_NAME)?.textContent);
		const url = absUrl(el.querySelector(ITEM_LINK)?.getAttribute("href"));
		if (!title || !url || !handleOf(url) && !channelIdOf(url)) return null;
		const img = el.querySelector(ITEM_AVATAR);
		return {
			title,
			channel_id: channelIdOf(url),
			handle: handleOf(url),
			url,
			thumb: absThumb(img?.getAttribute("src"))
		};
	}
	var defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
	function defaultScroll(doc) {
		return () => {
			const view = doc.defaultView;
			try {
				doc.querySelector(CONTINUATION)?.scrollIntoView?.({ block: "end" });
			} catch {}
			try {
				view?.scrollTo?.(0, doc.documentElement.scrollHeight);
			} catch {}
		};
	}
	var STEPS = 4;
	function defaultSteppedScroll(doc, sleep, stepMs) {
		return async () => {
			const view = doc.defaultView;
			const el = doc.scrollingElement ?? doc.documentElement;
			const fire = () => {
				try {
					view?.dispatchEvent(new Event("scroll"));
					doc.dispatchEvent(new Event("scroll"));
				} catch {}
			};
			const height = view?.innerHeight || 800;
			const bottom = () => Math.max(el.scrollHeight - height, 0);
			const start = Math.max(bottom() - height, 0);
			for (let i = 0; i <= STEPS; i++) {
				el.scrollTop = start + (bottom() - start) * i / STEPS;
				fire();
				await sleep(stepMs);
			}
			try {
				doc.querySelector(CONTINUATION)?.scrollIntoView?.({ block: "center" });
			} catch {}
			fire();
		};
	}
	function defaultNudge(doc) {
		return async () => {
			const html = doc.documentElement;
			html.removeAttribute(NUDGE_ATTR);
			doc.dispatchEvent(new CustomEvent(NUDGE_EVENT));
			return html.getAttribute("data-tube-nudge") ?? "unavailable";
		};
	}
	/** Merges data + DOM: id from the data when the DOM has none (same handle/url); larger avatar. */
	function merge(dom, data) {
		const byId = /* @__PURE__ */ new Map();
		const byHandle = /* @__PURE__ */ new Map();
		const byUrl = /* @__PURE__ */ new Map();
		for (const d of data) {
			if (d.channel_id) byId.set(d.channel_id, d);
			if (d.handle) byHandle.set(d.handle, d);
			if (d.url) byUrl.set(d.url.toLowerCase(), d);
		}
		const used = /* @__PURE__ */ new Set();
		const out = [];
		const seen = /* @__PURE__ */ new Set();
		for (const item of dom) {
			const match = item.channel_id && byId.get(item.channel_id) || item.handle && byHandle.get(item.handle) || item.url && byUrl.get(item.url.toLowerCase()) || null;
			if (match) used.add(match);
			const c = {
				title: item.title,
				channel_id: item.channel_id ?? match?.channel_id ?? null,
				handle: item.handle ?? match?.handle ?? null,
				url: match?.url ?? item.url ?? null,
				thumb: match?.thumb ?? item.thumb ?? null
			};
			const key = c.channel_id ?? c.handle ?? c.url ?? c.title;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(c);
		}
		let missingFromDom = 0;
		for (const d of data) {
			if (used.has(d)) continue;
			missingFromDom++;
			const key = d.channel_id ?? d.handle ?? d.url ?? d.title;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(d);
		}
		return {
			channels: out,
			missingFromDom
		};
	}
	/** Scrolls /feed/channels to the end and returns the whole list + signal. Never throws. */
	async function scrapeSubscriptions(opts = {}) {
		const doc = opts.doc ?? document;
		const url = opts.url ?? new URL(doc.defaultView?.location.href ?? location.href);
		const sleep = opts.sleep ?? defaultSleep;
		const now = opts.now ?? (() => Date.now());
		const scroll = opts.scroll ?? defaultScroll(doc);
		const roundMs = opts.roundMs ?? 1e3;
		const stableRounds = opts.stableRounds ?? 2;
		const maxStallRounds = opts.maxStallRounds ?? 15;
		const maxMs = opts.maxMs ?? 3e5;
		const waitItemsMs = opts.waitItemsMs ?? 2e4;
		const steppedScroll = opts.steppedScroll ?? defaultSteppedScroll(doc, sleep, opts.stepMs ?? 250);
		const nudge = opts.nudge ?? defaultNudge(doc);
		const progress = (n) => {
			try {
				opts.onProgress?.(n);
			} catch {}
		};
		const stats = {
			dom_items: 0,
			data_items: 0,
			rounds: 0,
			unparsed: 0,
			missing_ids: 0,
			attempts: [],
			hidden_rounds: 0
		};
		const attempt = (what) => {
			stats.attempts.push(what);
			if (stats.attempts.length > 20) stats.attempts.shift();
		};
		let collected = [];
		const finish = (signal, reason) => {
			stats.missing_ids = collected.filter((c) => !c.channel_id).length;
			if (signal === "complete" && collected.length === 0) return {
				channels: collected,
				signal: "partial",
				reason: "empty",
				stats
			};
			return {
				channels: collected,
				signal,
				reason,
				stats
			};
		};
		const aborted = () => opts.abort?.aborted === true || doc.defaultView?.closed === true;
		const abortReason = () => opts.abort?.aborted && opts.abort.reason === "cancelled" ? "cancelled" : "aborted";
		try {
			if (url.pathname !== "/feed/channels") return finish("partial", "wrong_page");
			const t0 = now();
			while (domItems(doc).length === 0 && detectLogin$1(doc) !== "out" && now() - t0 < waitItemsMs) {
				if (aborted()) return finish("partial", abortReason());
				await sleep(Math.min(500, roundMs));
			}
			let reason = null;
			if (detectLogin$1(doc) === "out") reason = "logged_out";
			else if (domItems(doc).length > 0) {
				let prev = domItems(doc).length;
				let stable = 0;
				let stalled = 0;
				let triedStepped = false;
				let triedNudge = false;
				progress(prev);
				for (;;) {
					if (aborted()) {
						reason = abortReason();
						break;
					}
					if (now() - t0 > maxMs) {
						reason = "timeout";
						break;
					}
					scroll();
					stats.rounds++;
					await sleep(roundMs);
					if (aborted()) {
						reason = abortReason();
						break;
					}
					const count = domItems(doc).length;
					const more = hasContinuation(doc);
					const grew = count !== prev;
					if (grew) {
						stable = 0;
						stalled = 0;
					} else if (more) {
						if (opts.visible && doc.visibilityState === "hidden") stats.hidden_rounds++;
						else stalled++;
					} else stable++;
					prev = count;
					progress(count);
					if (!more && stable >= stableRounds) break;
					if (grew || !more || stalled === 0) continue;
					if (stalled >= maxStallRounds && triedStepped && triedNudge) {
						reason = "scroll_stalled";
						break;
					}
					if (!triedStepped || stalled % 5 === 1) {
						await steppedScroll();
						triedStepped = true;
						attempt("stepped_scroll");
					} else if (!triedNudge || stalled % 5 === 2) {
						let answer = "error";
						try {
							answer = await nudge();
						} catch {}
						triedNudge = true;
						attempt(`page_nudge:${answer}`);
					}
				}
			}
			const data = extractFromInitialData(readInitialData$1(doc));
			const els = domItems(doc);
			const parsed = [];
			for (const el of els) {
				const c = fromDom(el);
				if (c) parsed.push(c);
				else stats.unparsed++;
			}
			stats.dom_items = els.length;
			stats.data_items = data.length;
			const merged = merge(parsed, data);
			collected = merged.channels;
			if (reason) return finish("partial", reason);
			if (detectLogin$1(doc) === "out") return finish("partial", "logged_out");
			if (els.length === 0) return finish("partial", data.length > 0 ? "selector_missing" : "empty");
			if (stats.unparsed > 0) return finish("partial", "unparsed_items");
			if (merged.missingFromDom > 0) return finish("partial", "dom_mismatch");
			return finish("complete", "end_of_list");
		} catch (e) {
			console.warn("[tube] scraper failed", e);
			return finish("partial", "error");
		}
	}
	var running = null;
	function overlayFor(ctrl) {
		try {
			return showSyncOverlay({ onCancel: () => ctrl.abort("cancelled") });
		} catch (e) {
			console.warn("[tube] sync overlay failed", e);
			return null;
		}
	}
	var scraper = {
		MODULE: MODULE$6,
		ROUTES: ROUTES$6,
		REAL_ROUTES: REAL_ROUTES$6,
		COMMANDS: ["scrape.subscriptions"],
		matches: (url) => url.pathname === "/feed/channels",
		start() {},
		stop() {
			running?.ctrl.abort();
		},
		commands: { "scrape.subscriptions": async (req) => {
			if (running) return running.result;
			const ctrl = new AbortController();
			const visible = req?.visible === true;
			const overlay = visible ? overlayFor(ctrl) : null;
			const result = scrapeSubscriptions({
				abort: ctrl.signal,
				visible,
				onProgress: (n) => overlay?.update(n)
			}).finally(() => {
				overlay?.remove();
				running = null;
			});
			running = {
				ctrl,
				result
			};
			return result;
		} }
	};
	var searchContent = {
		MODULE: "content/search",
		ROUTES: [],
		REAL_ROUTES: [],
		COMMANDS: ["search.extract"],
		matches: (url) => url.pathname === "/results",
		start() {},
		commands: { "search.extract": async () => ({ payload: null }) }
	};
	// node_modules/preact/dist/preact.module.js
	var n;
	var l;
	var u$1;
	var i$1;
	var r;
	var o;
	var e;
	var f$1;
	var c;
	var a;
	var s;
	var h;
	var p;
	var v;
	var d = {};
	var w = [];
	var _ = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
	var g = Array.isArray;
	function m(n, l) {
		for (var u in l) n[u] = l[u];
		return n;
	}
	function b(n) {
		n && n.parentNode && n.parentNode.removeChild(n);
	}
	function k(l, u, t) {
		var i, r, o, e = {};
		for (o in u) "key" == o ? i = u[o] : "ref" == o ? r = u[o] : e[o] = u[o];
		if (arguments.length > 2 && (e.children = arguments.length > 3 ? n.call(arguments, 2) : t), "function" == typeof l && null != l.defaultProps) for (o in l.defaultProps) void 0 === e[o] && (e[o] = l.defaultProps[o]);
		return x(l, e, i, r, null);
	}
	function x(n, t, i, r, o) {
		var e = {
			type: n,
			props: t,
			key: i,
			ref: r,
			__k: null,
			__: null,
			__b: 0,
			__e: null,
			__c: null,
			constructor: void 0,
			__v: null == o ? ++u$1 : o,
			__i: -1,
			__u: 0
		};
		return null == o && null != l.vnode && l.vnode(e), e;
	}
	function S(n) {
		return n.children;
	}
	function C(n, l) {
		this.props = n, this.context = l;
	}
	function $(n, l) {
		if (null == l) return n.__ ? $(n.__, n.__i + 1) : null;
		for (var u; l < n.__k.length; l++) if (null != (u = n.__k[l]) && null != u.__e) return u.__e;
		return "function" == typeof n.type ? $(n) : null;
	}
	function I(n) {
		if (n.__P && n.__d) {
			var u = n.__v, t = u.__e, i = [], r = [], o = m({}, u);
			o.__v = u.__v + 1, l.vnode && l.vnode(o), q(n.__P, o, u, n.__n, n.__P.namespaceURI, 32 & u.__u ? [t] : null, i, null == t ? $(u) : t, !!(32 & u.__u), r), o.__v = u.__v, o.__.__k[o.__i] = o, D(i, o, r), u.__e = u.__ = null, o.__e != t && P(o);
		}
	}
	function P(n) {
		if (null != (n = n.__) && null != n.__c) return n.__e = n.__c.base = null, n.__k.some(function(l) {
			if (null != l && null != l.__e) return n.__e = n.__c.base = l.__e;
		}), P(n);
	}
	function A(n) {
		(!n.__d && (n.__d = !0) && i$1.push(n) && !H.__r++ || r != l.debounceRendering) && ((r = l.debounceRendering) || o)(H);
	}
	function H() {
		try {
			for (var n, l = 1; i$1.length;) i$1.length > l && i$1.sort(e), n = i$1.shift(), l = i$1.length, I(n);
		} finally {
			i$1.length = H.__r = 0;
		}
	}
	function L(n, l, u, t, i, r, o, e, f, c, a) {
		var s, h, p, v, y, _, g = t && t.__k || w, m = l.length;
		for (f = T(u, l, g, f, m), s = 0; s < m; s++) null != (p = u.__k[s]) && (h = -1 != p.__i && g[p.__i] || d, p.__i = s, _ = q(n, p, h, i, r, o, e, f, c, a), v = p.__e, p.ref && h.ref != p.ref && (h.ref && J(h.ref, null, p), a.push(p.ref, p.__c || v, p)), null == y && null != v && (y = v), 4 & p.__u ? (f = j(p, f, n), h.__e && (h.__e = null)) : "function" == typeof p.type && void 0 !== _ ? f = _ : v && (f = v.nextSibling), p.__u &= -7);
		return u.__e = y, f;
	}
	function T(n, l, u, t, i) {
		var r, o, e, f, c, a = u.length, s = a, h = 0;
		for (n.__k = new Array(i), r = 0; r < i; r++) null != (o = l[r]) && "boolean" != typeof o && "function" != typeof o ? ("string" == typeof o || "number" == typeof o || "bigint" == typeof o || o.constructor == String ? o = n.__k[r] = x(null, o, null, null, null) : g(o) ? o = n.__k[r] = x(S, { children: o }, null, null, null) : void 0 === o.constructor && o.__b > 0 ? o = n.__k[r] = x(o.type, o.props, o.key, o.ref ? o.ref : null, o.__v) : n.__k[r] = o, f = r + h, o.__ = n, o.__b = n.__b + 1, e = null, -1 != (c = o.__i = O(o, u, f, s)) && (s--, (e = u[c]) && (e.__u |= 2)), null == e || null == e.__v ? (-1 == c && (i > a ? h-- : i < a && h++), "function" != typeof o.type && (o.__u |= 4)) : c != f && (c == f - 1 ? h-- : c == f + 1 ? h++ : (c > f ? h-- : h++, o.__u |= 4))) : n.__k[r] = null;
		if (s) for (r = 0; r < a; r++) null != (e = u[r]) && 0 == (2 & e.__u) && (e.__e == t && (t = $(e)), K(e, e));
		return t;
	}
	function j(n, l, u) {
		var t, i;
		if ("function" == typeof n.type) {
			for (t = n.__k, i = 0; t && i < t.length; i++) t[i] && (t[i].__ = n, l = j(t[i], l, u));
			return l;
		}
		n.__e != l && (l && n.type && !l.parentNode && (l = $(n)), l = u.insertBefore(n.__e, l || null));
		do
			l = l && l.nextSibling;
		while (null != l && 8 == l.nodeType);
		return l;
	}
	function O(n, l, u, t) {
		var i, r, o, e = n.key, f = n.type, c = l[u], a = null != c && 0 == (2 & c.__u);
		if (null === c && null == e || a && e == c.key && f == c.type) return u;
		if (t > (a ? 1 : 0)) {
			for (i = u - 1, r = u + 1; i >= 0 || r < l.length;) if (null != (c = l[o = i >= 0 ? i-- : r++]) && 0 == (2 & c.__u) && e == c.key && f == c.type) return o;
		}
		return -1;
	}
	function z(n, l, u) {
		"-" == l[0] ? n.setProperty(l, null == u ? "" : u) : n[l] = null == u ? "" : "number" != typeof u || _.test(l) ? u : u + "px";
	}
	function N(n, l, u, t, i) {
		var r, o;
		n: if ("style" == l) if ("string" == typeof u) n.style.cssText = u;
		else {
			if ("string" == typeof t && (n.style.cssText = t = ""), t) for (l in t) u && l in u || z(n.style, l, "");
			if (u) for (l in u) t && u[l] == t[l] || z(n.style, l, u[l]);
		}
		else if ("o" == l[0] && "n" == l[1]) r = l != (l = l.replace(s, "$1")), o = l.toLowerCase(), l = o in n || "onFocusOut" == l || "onFocusIn" == l ? o.slice(2) : l.slice(2), n.l || (n.l = {}), n.l[l + r] = u, u ? t ? u[a] = t[a] : (u[a] = h, n.addEventListener(l, r ? v : p, r)) : n.removeEventListener(l, r ? v : p, r);
		else {
			if ("http://www.w3.org/2000/svg" == i) l = l.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
			else if ("width" != l && "height" != l && "href" != l && "list" != l && "form" != l && "tabIndex" != l && "download" != l && "rowSpan" != l && "colSpan" != l && "role" != l && "popover" != l && l in n) try {
				n[l] = null == u ? "" : u;
				break n;
			} catch (n) {}
			"function" == typeof u || (null == u || !1 === u && "-" != l[4] ? n.removeAttribute(l) : n.setAttribute(l, "popover" == l && 1 == u ? "" : u));
		}
	}
	function V(n) {
		return function(u) {
			if (this.l) {
				var t = this.l[u.type + n];
				if (null == u[c]) u[c] = h++;
				else if (u[c] < t[a]) return;
				return t(l.event ? l.event(u) : u);
			}
		};
	}
	function q(n, u, t, i, r, o, e, f, c, a) {
		var s, h, p, v, y, d, _, k, x, M, I, P, A, H, T, j, F = u.type;
		if (void 0 !== u.constructor) return null;
		128 & t.__u && (c = !!(32 & t.__u), o = [f = u.__e = t.__e]), (s = l.__b) && s(u);
		n: if ("function" == typeof F) {
			h = e.length;
			try {
				if (x = u.props, M = F.prototype && F.prototype.render, I = (s = F.contextType) && i[s.__c], P = s ? I ? I.props.value : s.__ : i, t.__c ? k = (p = u.__c = t.__c).__ = p.__E : (M ? u.__c = p = new F(x, P) : (u.__c = p = new C(x, P), p.constructor = F, p.render = Q), I && I.sub(p), p.state || (p.state = {}), p.__n = i, v = p.__d = !0, p.__h = [], p._sb = []), M && null == p.__s && (p.__s = p.state), M && null != F.getDerivedStateFromProps && (p.__s == p.state && (p.__s = m({}, p.__s)), m(p.__s, F.getDerivedStateFromProps(x, p.__s))), y = p.props, d = p.state, p.__v = u, v) M && null == F.getDerivedStateFromProps && null != p.componentWillMount && p.componentWillMount(), M && null != p.componentDidMount && p.__h.push(p.componentDidMount);
				else {
					if (M && null == F.getDerivedStateFromProps && x !== y && null != p.componentWillReceiveProps && p.componentWillReceiveProps(x, P), u.__v == t.__v || !p.__e && null != p.shouldComponentUpdate && !1 === p.shouldComponentUpdate(x, p.__s, P)) {
						u.__v != t.__v && (p.props = x, p.state = p.__s, p.__d = !1), u.__e = t.__e, u.__k = t.__k, u.__k.some(function(n) {
							n && (n.__ = u);
						}), w.push.apply(p.__h, p._sb), p._sb = [], p.__h.length && e.push(p), f = $(t);
						break n;
					}
					null != p.componentWillUpdate && p.componentWillUpdate(x, p.__s, P), M && null != p.componentDidUpdate && p.__h.push(function() {
						p.componentDidUpdate(y, d, _);
					});
				}
				if (p.context = P, p.props = x, p.__P = n, p.__e = !1, A = l.__r, H = 0, M) p.state = p.__s, p.__d = !1, A && A(u), s = p.render(p.props, p.state, p.context), w.push.apply(p.__h, p._sb), p._sb = [];
				else do
					p.__d = !1, A && A(u), s = p.render(p.props, p.state, p.context), p.state = p.__s;
				while (p.__d && ++H < 25);
				p.state = p.__s, null != p.getChildContext && (i = m(m({}, i), p.getChildContext())), M && !v && null != p.getSnapshotBeforeUpdate && (_ = p.getSnapshotBeforeUpdate(y, d)), T = null != s && s.type === S && null == s.key ? E(s.props.children) : s, f = L(n, g(T) ? T : [T], u, t, i, r, o, e, f, c, a), p.base = u.__e, u.__u &= -161, p.__h.length && e.push(p), k && (p.__E = p.__ = null);
			} catch (n) {
				if (e.length = h, u.__v = null, c || null != o) {
					if (n.then) {
						for (u.__u |= c ? 160 : 128; f && 8 == f.nodeType && f.nextSibling;) f = f.nextSibling;
						null != o && (o[o.indexOf(f)] = null), u.__e = f;
					} else if (null != o) for (j = o.length; j--;) b(o[j]);
				} else u.__e = t.__e;
				u.__k ??= t.__k || [], n.then || B(u), l.__e(n, u, t);
			}
		} else null == o && u.__v == t.__v ? (u.__k = t.__k, u.__e = t.__e) : f = u.__e = G(t.__e, u, t, i, r, o, e, c, a);
		return (s = l.diffed) && s(u), 128 & u.__u ? void 0 : f;
	}
	function B(n) {
		n && (n.__c && (n.__c.__e = !0), n.__k && n.__k.some(B));
	}
	function D(n, u, t) {
		for (var i = 0; i < t.length; i++) J(t[i], t[++i], t[++i]);
		l.__c && l.__c(u, n), n.some(function(u) {
			try {
				n = u.__h, u.__h = [], n.some(function(n) {
					n.call(u);
				});
			} catch (n) {
				l.__e(n, u.__v);
			}
		});
	}
	function E(n) {
		return "object" != typeof n || null == n || n.__b > 0 ? n : g(n) ? n.map(E) : void 0 !== n.constructor ? null : m({}, n);
	}
	function G(u, t, i, r, o, e, f, c, a) {
		var s, h, p, v, y, w, _, m = i.props || d, k = t.props, x = t.type;
		if ("svg" == x ? o = "http://www.w3.org/2000/svg" : "math" == x ? o = "http://www.w3.org/1998/Math/MathML" : o || (o = "http://www.w3.org/1999/xhtml"), null != e) {
			for (s = 0; s < e.length; s++) if ((y = e[s]) && "setAttribute" in y == !!x && (x ? y.localName == x : 3 == y.nodeType)) {
				u = y, e[s] = null;
				break;
			}
		}
		if (null == u) {
			if (null == x) return document.createTextNode(k);
			u = document.createElementNS(o, x, k.is && k), c && (l.__m && l.__m(t, e), c = !1), e = null;
		}
		if (null == x) m === k || c && u.data == k || (u.data = k);
		else {
			if (e = "textarea" == x && null != k.defaultValue ? null : e && n.call(u.childNodes), !c && null != e) for (m = {}, s = 0; s < u.attributes.length; s++) m[(y = u.attributes[s]).name] = y.value;
			for (s in m) y = m[s], "dangerouslySetInnerHTML" == s ? p = y : "children" == s || s in k || "value" == s && "defaultValue" in k || "checked" == s && "defaultChecked" in k || N(u, s, null, y, o);
			for (s in k) y = k[s], "children" == s ? v = y : "dangerouslySetInnerHTML" == s ? h = y : "value" == s ? w = y : "checked" == s ? _ = y : c && "function" != typeof y || m[s] === y || N(u, s, y, m[s], o);
			if (h) c || p && (h.__html == p.__html || h.__html == u.innerHTML) || (u.innerHTML = h.__html), t.__k = [];
			else if (p && (u.innerHTML = ""), L("template" == t.type ? u.content : u, g(v) ? v : [v], t, i, r, "foreignObject" == x ? "http://www.w3.org/1999/xhtml" : o, e, f, e ? e[0] : i.__k && $(i, 0), c, a), null != e) for (s = e.length; s--;) b(e[s]);
			c && "textarea" != x || (s = "value", "progress" == x && null == w ? u.removeAttribute("value") : null != w && (w !== u[s] || "progress" == x && !w || "option" == x && w != m[s]) && N(u, s, w, m[s], o), s = "checked", null != _ && _ != u[s] && N(u, s, _, m[s], o));
		}
		return u;
	}
	function J(n, u, t) {
		try {
			if ("function" == typeof n) {
				var i = "function" == typeof n.__u;
				i && n.__u(), i && null == u || (n.__u = n(u));
			} else n.current = u;
		} catch (n) {
			l.__e(n, t);
		}
	}
	function K(n, u, t) {
		var i, r;
		if (l.unmount && l.unmount(n), (i = n.ref) && (i.current && i.current != n.__e || J(i, null, u)), null != (i = n.__c)) {
			if (i.componentWillUnmount) try {
				i.componentWillUnmount();
			} catch (n) {
				l.__e(n, u);
			}
			i.base = i.__P = i.__n = null;
		}
		if (i = n.__k) for (r = 0; r < i.length; r++) i[r] && K(i[r], u, t || "function" != typeof n.type);
		t || b(n.__e), n.__c = n.__ = n.__e = void 0;
	}
	function Q(n, l, u) {
		return this.constructor(n, u);
	}
	function R(u, t, i) {
		var r, o, e, f;
		t == document && (t = document.documentElement), l.__ && l.__(u, t), o = (r = "function" == typeof i) ? null : i && i.__k || t.__k, e = [], f = [], q(t, u = (!r && i || t).__k = k(S, null, [u]), o || d, d, t.namespaceURI, !r && i ? [i] : o ? null : t.firstChild ? n.call(t.childNodes) : null, e, !r && i ? i : o ? o.__e : t.firstChild, r, f), D(e, u, f), u.props.children = null;
	}
	n = w.slice, l = { __e: function(n, l, u, t) {
		for (var i, r, o; l = l.__;) if ((i = l.__c) && !i.__) try {
			if ((r = i.constructor) && null != r.getDerivedStateFromError && (i.setState(r.getDerivedStateFromError(n)), o = i.__d), null != i.componentDidCatch && (i.componentDidCatch(n, t || {}), o = i.__d), o) return i.__E = i;
		} catch (l) {
			n = l;
		}
		throw n;
	} }, u$1 = 0, C.prototype.setState = function(n, l) {
		var u = null != this.__s && this.__s != this.state ? this.__s : this.__s = m({}, this.state);
		"function" == typeof n && (n = n(m({}, u), this.props)), n && m(u, n), null != n && this.__v && (l && this._sb.push(l), A(this));
	}, C.prototype.forceUpdate = function(n) {
		this.__v && (this.__e = !0, n && this.__h.push(n), A(this));
	}, C.prototype.render = S, i$1 = [], o = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e = function(n, l) {
		return n.__v.__b - l.__v.__b;
	}, H.__r = 0, f$1 = Math.random().toString(8), c = "__d" + f$1, a = "__a" + f$1, s = /(PointerCapture)$|Capture$/i, h = 0, p = V(!1), v = V(!0);
	// extension/src/content/sidebar/guide.ts
	var SECTION_TAG = "tube-guide-section";
	var MINI_TAG = "tube-guide-mini";
	var PANEL_TAG = "tube-guide-panel";
	var OURS = /* @__PURE__ */ new Set([
		SECTION_TAG.toUpperCase(),
		MINI_TAG.toUpperCase(),
		PANEL_TAG.toUpperCase()
	]);
	var DEFAULT_METRICS = {
		rowH: 40,
		rowEnd: 12,
		radius: 10,
		padX: 12,
		icon: 24,
		iconGap: 24,
		font: "Roboto, Arial, sans-serif",
		fs: 14,
		lh: 20,
		secPad: "12px",
		sepBorder: "",
		headFs: 16,
		headLh: 22,
		text: null,
		accent: null
	};
	function guideSections(doc) {
		return doc.querySelector("tp-yt-app-drawer#guide ytd-guide-renderer #sections") ?? doc.querySelector("ytd-guide-renderer #sections");
	}
	function miniItems(doc) {
		return doc.querySelector("ytd-mini-guide-renderer #items");
	}
	var isSection = (el) => el.tagName === "YTD-GUIDE-SECTION-RENDERER";
	var hrefOf = (entry) => entry.querySelector("a")?.getAttribute("href") ?? "";
	/** Subscriptions section: has the subscriptions link (/feed/channels) or channel entries with a
	*  visible avatar (the "Explore" section also points to /channel/… but uses an icon, with the avatar hidden). */
	function subscriptionsSection(sections) {
		const list = [...sections.children].filter(isSection);
		for (const s of list) if (s.querySelector("a[href^=\"/feed/channels\"]")) return s;
		for (const s of list) if ([...s.querySelectorAll("ytd-guide-entry-renderer")].filter((e) => {
			const img = e.querySelector("yt-img-shadow");
			return /^\/(@|channel\/)/.test(hrefOf(e)) && img !== null && !img.hasAttribute("hidden");
		}).length > 0) return s;
		return null;
	}
	/** How many of YouTube's own sections may sit above Subscriptions for "right above it" to still be in view. */
	var SUBS_NEAR_TOP = 2;
	/** Puts (or keeps) the section right above Subscriptions when that is near the top of the guide; otherwise (no such
	*  section, or YouTube lists it far down, below the fold) right after the first section. Returns whether it moved anything. */
	function placeSection(sections, host) {
		const found = subscriptionsSection(sections);
		const subs = found && [...sections.children].filter(isSection).indexOf(found) <= SUBS_NEAR_TOP ? found : null;
		if (subs) {
			if (host.parentElement === sections && host.nextElementSibling === subs) return false;
			sections.insertBefore(host, subs);
			return true;
		}
		const first = [...sections.children].find(isSection);
		if (!first) return null;
		if (host.parentElement === sections && first.nextElementSibling === host) return false;
		first.after(host);
		return true;
	}
	/** Mini-guide: after Subscriptions; otherwise before "You"; otherwise at the end. */
	function placeMini(items, host) {
		const entries = [...items.children].filter((e) => !OURS.has(e.tagName));
		const subs = entries.find((e) => hrefOf(e) === "/feed/subscriptions");
		if (subs) {
			if (subs.nextElementSibling === host) return false;
			subs.after(host);
			return true;
		}
		const you = entries.find((e) => hrefOf(e).startsWith("/feed/you"));
		if (you) {
			if (you.previousElementSibling === host) return false;
			you.before(host);
			return true;
		}
		if (items.lastElementChild === host) return false;
		items.append(host);
		return true;
	}
	var px = (v, min, max, fallback) => {
		const n = v ? parseFloat(v) : NaN;
		return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10) / 10 : fallback;
	};
	/** Only sufficiently opaque `rgb()/rgba()`; transparent (alpha 0) will not do. */
	function color(v) {
		const s = v?.trim() ?? "";
		const m = /^rgba?\(([\d\s.,%]+)\)$/.exec(s);
		if (!m) return null;
		const parts = m[1].split(",").map((p) => parseFloat(p));
		if (parts.length === 4 && !(parts[3] > 0)) return null;
		return s;
	}
	/** Reads the computed style of a neighboring entry; any odd value falls back to the measured default. */
	function measureGuide(sections) {
		const m = { ...DEFAULT_METRICS };
		const view = sections.ownerDocument.defaultView;
		if (!view) return m;
		const entries = [...sections.querySelectorAll("ytd-guide-entry-renderer")].filter((e) => !e.closest(SECTION_TAG));
		const entry = entries.find((e) => !e.hasAttribute("active") && e.querySelector("yt-img-shadow[hidden]")) ?? entries[0];
		if (!entry) return m;
		const cs = (el) => el ? view.getComputedStyle(el) : null;
		const es = cs(entry);
		const rect = entry.getBoundingClientRect();
		m.rowH = px(es?.height === "auto" ? `${rect.height}` : es?.height, 28, 64, rect.height >= 28 && rect.height <= 64 ? rect.height : m.rowH);
		m.radius = px(es?.borderTopLeftRadius, 0, 24, m.radius);
		m.padX = px(cs(entry.querySelector("tp-yt-paper-item"))?.paddingLeft, 0, 32, m.padX);
		const icon = cs(entry.querySelector("yt-icon.guide-icon, yt-icon"));
		m.icon = px(icon?.width, 16, 32, m.icon);
		m.iconGap = px(icon?.marginRight, 8, 40, m.iconGap);
		const title = cs(entry.querySelector(".title, yt-formatted-string"));
		if (title?.fontFamily && title.fontFamily.length < 120) m.font = title.fontFamily;
		m.fs = px(title?.fontSize, 11, 18, m.fs);
		m.lh = px(title?.lineHeight, 14, 26, m.lh);
		m.text = color(title?.color);
		m.accent = color(cs(entry.querySelector("#newness-dot"))?.backgroundColor);
		const sec = entry.closest("ytd-guide-section-renderer");
		const ss = cs(sec);
		if (ss) {
			const pads = [
				ss.paddingTop,
				ss.paddingRight,
				ss.paddingBottom,
				ss.paddingLeft
			].map((v) => px(v, 0, 32, 12));
			m.secPad = pads.map((p) => `${p}px`).join(" ");
			const bw = px(ss.borderBottomWidth, 0, 4, 0);
			const bc = ss.borderBottomColor;
			if (bw > 0 && ss.borderBottomStyle && ss.borderBottomStyle !== "none" && /^rgba?\(/.test(bc ?? "")) m.sepBorder = `${bw}px ${ss.borderBottomStyle} ${bc}`;
			const secRect = sec.getBoundingClientRect();
			const inner = secRect.width - pads[1] - pads[3];
			if (rect.width > 0 && inner > 0) {
				const end = inner - (rect.left - secRect.left - pads[3]) - rect.width;
				if (end >= 0 && end <= 48) m.rowEnd = Math.round(end * 10) / 10;
			}
		}
		const head = cs(sections.querySelector("ytd-guide-section-renderer h3:not([hidden]) #guide-section-title"));
		m.headFs = px(head?.fontSize, 12, 22, m.headFs);
		m.headLh = px(head?.lineHeight, 14, 30, m.headLh);
		return m;
	}
	function metricsCss(m) {
		const lines = [
			`--g-row-h:${m.rowH}px`,
			`--g-row-end:${m.rowEnd}px`,
			`--g-radius:${m.radius}px`,
			`--g-pad-x:${m.padX}px`,
			`--g-icon:${m.icon}px`,
			`--g-icon-gap:${m.iconGap}px`,
			`--g-font:${m.font.replace(/[;{}<>]/g, "")}`,
			`--g-fs:${m.fs}px`,
			`--g-lh:${m.lh}px`,
			`--g-sec-pad:${m.secPad}`,
			`--g-head-fs:${m.headFs}px`,
			`--g-head-lh:${m.headLh}px`
		];
		if (m.sepBorder) lines.push(`--m-sep:${m.sepBorder}`);
		return `:host{${lines.join(";")}}`;
	}
	/** The guide drawer is open (or there is no drawer: the guide is always in view). */
	function drawerOpen(host) {
		const drawer = host.closest("tp-yt-app-drawer");
		return !drawer || drawer.hasAttribute("opened");
	}
	function miniVisible(host) {
		const mini = host.closest("ytd-mini-guide-renderer");
		return Boolean(mini) && !mini.hasAttribute("hidden");
	}
	/** Right edge of the guide (for the pane to abut it); 0 when there is no layout (jsdom). */
	function guideEdge(host, kind) {
		const r = (kind === "section" ? host.closest("#contentContainer") ?? host.parentElement : host.closest("ytd-mini-guide-renderer"))?.getBoundingClientRect();
		return r && r.right > 0 ? r.right : kind === "section" ? 240 : 72;
	}
	function mastheadBottom(doc) {
		const r = doc.querySelector("#masthead-container")?.getBoundingClientRect();
		return r && r.bottom > 0 && r.bottom < 200 ? r.bottom : 56;
	}
	/**
	* Observes only what is needed: the theme (`html[dark]`), the guide drawer (subtree), the mini-guide, the attributes of
	* `ytd-app` and whatever holds the drawer (drawer swap). Before the guide exists, observes the document until it shows up.
	*/
	function watchGuide(doc, onChange) {
		let targets = [];
		let boot = false;
		const mo = new MutationObserver(() => onChange());
		function wanted() {
			const out = [[doc.documentElement, {
				attributes: true,
				attributeFilter: ["dark"]
			}]];
			const sections = guideSections(doc);
			const drawer = sections?.closest("tp-yt-app-drawer") ?? null;
			const mini = doc.querySelector("ytd-mini-guide-renderer");
			const app = doc.querySelector("ytd-app");
			if (drawer) {
				out.push([drawer, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ["opened", "persistent"]
				}]);
				if (drawer.parentElement) out.push([drawer.parentElement, { childList: true }]);
			} else if (sections?.parentElement) out.push([sections.parentElement, {
				childList: true,
				subtree: true
			}]);
			if (mini) out.push([mini, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["hidden", "mini-guide-visible"]
			}]);
			if (app) out.push([app, {
				attributes: true,
				attributeFilter: ["mini-guide-visible", "guide-persistent-and-visible"]
			}]);
			boot = !sections;
			if (boot) out.push([doc.body ?? doc.documentElement, {
				childList: true,
				subtree: true
			}]);
			return out;
		}
		function retarget() {
			const next = wanted();
			if (next.length === targets.length && next.every(([el], i) => el === targets[i] && el.isConnected)) return;
			mo.disconnect();
			targets = next.map(([el]) => el);
			for (const [el, init] of next) mo.observe(el, init);
		}
		retarget();
		return {
			retarget,
			/** observing the whole document (guide not drawn yet) */
			booting: () => boot,
			dispose() {
				mo.disconnect();
				targets = [];
			}
		};
	}
	// extension/src/content/sidebar/model.ts
	/** Stable key of a row (roving tabindex, focus, `data-key`). */
	var keyOf = (kind, id) => `${kind === "tab" ? "t" : "f"}:${id}`;
	var str = (v) => typeof v === "string" ? v : null;
	var nonNeg = (v) => typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
	/** Everything coming from the server goes through here: wrong types become empty/zero, nothing throws. */
	function normalizeState(raw) {
		const s = raw && typeof raw === "object" ? raw : {};
		const tabs = [];
		const seenTabs = /* @__PURE__ */ new Set();
		for (const t of Array.isArray(s.tabs) ? s.tabs : []) {
			if (!t || typeof t !== "object") continue;
			const r = t;
			const id = str(r.tab_id);
			if (!id || seenTabs.has(id)) continue;
			seenTabs.add(id);
			tabs.push({
				id,
				name: str(r.name) ?? "",
				count: nonNeg(r.count),
				icon: str(r.icon)
			});
		}
		const folders = [];
		for (const f of Array.isArray(s.folders) ? s.folders : []) {
			if (!f || typeof f !== "object") continue;
			const r = f;
			const id = str(r.folder_id);
			if (!id) continue;
			folders.push({
				folder_id: id,
				name: str(r.name) ?? "",
				count: nonNeg(r.count),
				parent_id: str(r.parent_id)
			});
		}
		return {
			total: nonNeg(s.new_total),
			tabs,
			folders,
			refreshing: s.refresh_running === true
		};
	}
	/** Tree by `parent_id`. Missing parent → root; cycle → broken at the root; repeated id → the first. */
	function buildFolderTree(folders) {
		const byId = /* @__PURE__ */ new Map();
		for (const f of folders) if (!byId.has(f.folder_id)) byId.set(f.folder_id, f);
		const parentOf = /* @__PURE__ */ new Map();
		for (const f of byId.values()) {
			let p = f.parent_id && byId.has(f.parent_id) && f.parent_id !== f.folder_id ? f.parent_id : null;
			if (p) {
				const seen = /* @__PURE__ */ new Set([f.folder_id]);
				for (let cur = p; cur; cur = byId.get(cur)?.parent_id ?? null) {
					if (seen.has(cur)) {
						p = null;
						break;
					}
					seen.add(cur);
					if (!byId.has(cur)) break;
				}
			}
			parentOf.set(f.folder_id, p);
		}
		const kids = /* @__PURE__ */ new Map();
		for (const f of byId.values()) {
			const p = parentOf.get(f.folder_id) ?? null;
			const list = kids.get(p) ?? [];
			list.push(f);
			kids.set(p, list);
		}
		const build = (parent, level) => (kids.get(parent) ?? []).map((f) => {
			const children = build(f.folder_id, level + 1);
			const sum = children.reduce((a, c) => a + c.count, 0);
			return {
				id: f.folder_id,
				name: f.name,
				count: Math.max(f.count, sum),
				level,
				parentId: parent,
				children
			};
		});
		return build(null, 1);
	}
	/** Visible rows, in screen order: tabs, then folders (descending only into open ones). */
	function visibleKeys(tabs, tree, expanded) {
		const out = tabs.map((t) => keyOf("tab", t.id));
		const walk = (nodes) => {
			for (const n of nodes) {
				out.push(keyOf("folder", n.id));
				if (n.children.length && expanded.has(n.id)) walk(n.children);
			}
		};
		walk(tree);
		return out;
	}
	function findFolder(tree, id) {
		for (const n of tree) {
			if (n.id === id) return n;
			const hit = findFolder(n.children, id);
			if (hit) return hit;
		}
		return null;
	}
	var locale = (lang) => lang === "pt-BR" ? "pt-BR" : "en";
	/** Counter: empty when zero (the counter disappears), compact from a thousand. */
	function formatCount(n, lang) {
		if (!n || n <= 0) return "";
		if (n < 1e3) return String(n);
		return new Intl.NumberFormat(locale(lang), {
			notation: "compact",
			maximumFractionDigits: 1
		}).format(n);
	}
	var UNITS = [
		["year", 31536e3],
		["month", 2592e3],
		["week", 604800],
		["day", 86400],
		["hour", 3600],
		["minute", 60]
	];
	/** `published_at` (seconds, server) → "3 hours ago" in the active language. */
	function relativeAge(publishedAtS, nowMs, lang) {
		if (typeof publishedAtS !== "number" || !Number.isFinite(publishedAtS) || publishedAtS <= 0) return "";
		const diff = Math.max(0, nowMs / 1e3 - publishedAtS);
		const fmt = new Intl.RelativeTimeFormat(locale(lang), { numeric: "always" });
		for (const [unit, size] of UNITS) if (diff >= size) return fmt.format(-Math.floor(diff / size), unit);
		return fmt.format(-Math.max(1, Math.floor(diff / 60)), "minute");
	}
	function durationLabel(s) {
		if (typeof s !== "number" || !Number.isFinite(s) || s <= 0) return "";
		const total = Math.round(s);
		const h = Math.floor(total / 3600);
		const m = Math.floor(total % 3600 / 60);
		const sec = String(total % 60).padStart(2, "0");
		return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
	}
	var VIDEO_ID$1 = /^[A-Za-z0-9_-]{11}$/;
	var isVideoId = (id) => typeof id === "string" && VIDEO_ID$1.test(id);
	/** The only link destination the bar creates. */
	var watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
	/** Thumbnail from the contract (ext-protocol). */
	var thumbUrl = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
	var BUILTIN_TAB_ICONS = {
		"all-new": "new",
		favorites: "star",
		later: "later",
		":later": "later"
	};
	/** Built-in tab (by id) → its icon; the own drawing beats the server's emoji ("▶", "⭐"). */
	function builtinTabIcon(id) {
		return Object.prototype.hasOwnProperty.call(BUILTIN_TAB_ICONS, id) ? BUILTIN_TAB_ICONS[id] : null;
	}
	/** Tab icon from the server: only a short emoji is shown (as text); anything else uses the default icon. */
	function tabGlyph(icon) {
		if (!icon) return null;
		const s = icon.trim();
		if (!s || [...s].length > 2 || /[\w<>&"'/\\]/.test(s)) return null;
		return s;
	}
	// extension/src/content/sidebar/styles.ts
	var PALETTE = `
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
`;
	var SECTION_CSS = `${PALETTE}
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
`;
	var MINI_CSS = `${PALETTE}
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
`;
	var PANEL_CSS = `${PALETTE}
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
`;
	// node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js
	var f = 0;
	Array.isArray;
	function u(e, t, n, o, i, u) {
		t || (t = {});
		var a, c, p = t;
		if ("ref" in p) for (c in p = {}, t) "ref" == c ? a = t[c] : p[c] = t[c];
		var l$1 = {
			type: e,
			props: p,
			key: n,
			ref: a,
			__k: null,
			__: null,
			__b: 0,
			__e: null,
			__c: null,
			constructor: void 0,
			__v: --f,
			__i: -1,
			__u: 0,
			__source: i,
			__self: u
		};
		if ("function" == typeof e && (a = e.defaultProps)) for (c in a) void 0 === p[c] && (p[c] = a[c]);
		return l.vnode && l.vnode(l$1), l$1;
	}
	// extension/src/content/sidebar/icons.tsx
	var stroke = {
		fill: "none",
		stroke: "currentColor",
		"stroke-width": 1.5,
		"stroke-linecap": "round",
		"stroke-linejoin": "round"
	};
	var svg = (children, size = 24) => /* @__PURE__ */ u("svg", {
		viewBox: "0 0 24 24",
		width: size,
		height: size,
		"aria-hidden": "true",
		focusable: "false",
		children
	});
	/** Tab: stack of videos (related to the Subscriptions icon, without being identical). */
	var TabIcon = () => svg([
		/* @__PURE__ */ u("path", {
			d: "M6.5 3.75h11",
			...stroke
		}, "a"),
		/* @__PURE__ */ u("rect", {
			x: "3.75",
			y: "6.75",
			width: "16.5",
			height: "13",
			rx: "2.25",
			...stroke
		}, "b"),
		/* @__PURE__ */ u("path", {
			d: "M10.25 10.6v5.3l4.4-2.65z",
			fill: "currentColor"
		}, "c")
	]);
	/** "All new": inbox tray (what arrived). */
	var NewIcon = () => svg([/* @__PURE__ */ u("path", {
		d: "M5.6 6.4 3.75 13.5v4.25c0 1.1.9 2 2 2h12.5c1.1 0 2-.9 2-2V13.5L18.4 6.4c-.3-.85-1.1-1.4-2-1.4H7.6c-.9 0-1.7.55-2 1.4z",
		...stroke
	}, "a"), /* @__PURE__ */ u("path", {
		d: "M3.75 13.5h4.5l1.5 2.25h4.5l1.5-2.25h4.5",
		...stroke
	}, "b")]);
	/** "Favorites": outline star. */
	var StarIcon = () => svg(/* @__PURE__ */ u("path", {
		d: "M12 3.9l2.47 5.01 5.53.8-4 3.9.94 5.5L12 16.53 7.06 19.1 8 13.6 4 9.7l5.53-.8z",
		...stroke
	}));
	/** "Watch later": clock. */
	var LaterIcon = () => svg([/* @__PURE__ */ u("circle", {
		cx: "12",
		cy: "12",
		r: "8.25",
		...stroke
	}, "a"), /* @__PURE__ */ u("path", {
		d: "M12 7.75V12l2.75 2.75",
		...stroke
	}, "b")]);
	var FolderIcon = () => svg(/* @__PURE__ */ u("path", {
		d: "M3.75 7.25c0-1.1.9-2 2-2h3.6l2 2.25h6.9c1.1 0 2 .9 2 2v7.25c0 1.1-.9 2-2 2H5.75c-1.1 0-2-.9-2-2z",
		...stroke
	}));
	/** Section mark in the mini-guide: stacked folders. */
	var HermesIcon = () => svg([/* @__PURE__ */ u("path", {
		d: "M6.5 4.25h3l1.5 1.5h6.5c.97 0 1.75.78 1.75 1.75",
		...stroke
	}, "a"), /* @__PURE__ */ u("path", {
		d: "M3.75 9.75c0-1.1.9-2 2-2h3.6l2 2h6.9c1.1 0 2 .9 2 2v6c0 1.1-.9 2-2 2H5.75c-1.1 0-2-.9-2-2z",
		...stroke
	}, "b")]);
	/** HermesTube mark next to the section name: a wing (Hermes's), in the same outline style. */
	var WingIcon = () => svg([/* @__PURE__ */ u("path", {
		d: "M3.75 16.25C4 10 9.5 5.25 20.25 4.75c-.6 2.4-2.2 4-4.75 4.75h3.25c-.9 2.1-2.7 3.4-5.25 3.75h2.75c-1.3 2.4-3.7 3.75-6.75 3.75-2.2 0-4.1-.3-5.75-.75z",
		...stroke
	}, "a"), /* @__PURE__ */ u("path", {
		d: "M8.5 12.25c1.6-1.6 3.9-2.6 7-2.75M8 15c1.3-1 3.1-1.6 5.5-1.75",
		...stroke
	}, "b")]);
	var ChevronIcon = () => svg(/* @__PURE__ */ u("path", {
		d: "M9.5 6.5L15 12l-5.5 5.5",
		...stroke
	}), 16);
	var CloseIcon = () => svg(/* @__PURE__ */ u("path", {
		d: "M6.5 6.5l11 11M17.5 6.5l-11 11",
		...stroke
	}));
	var BackIcon = () => svg(/* @__PURE__ */ u("path", {
		d: "M19 12H5.5M11 6.5L5.5 12l5.5 5.5",
		...stroke
	}));
	var CheckIcon = () => svg(/* @__PURE__ */ u("path", {
		d: "M5 12.5l4.5 4.5L19 7.5",
		...stroke
	}), 20);
	var InfoIcon = () => svg([/* @__PURE__ */ u("circle", {
		cx: "12",
		cy: "12",
		r: "8.25",
		...stroke
	}, "a"), /* @__PURE__ */ u("path", {
		d: "M12 11v5M12 8v.01",
		...stroke
	}, "b")], 16);
	var OffIcon = () => svg([/* @__PURE__ */ u("path", {
		d: "M8.5 8.5a5 5 0 0 0 7 7M10 6.3a5 5 0 0 1 7.7 7.7",
		...stroke
	}, "a"), /* @__PURE__ */ u("path", {
		d: "M4.5 4.5l15 15M12 3v2M12 19v2",
		...stroke
	}, "b")], 16);
	var ViaIcon = () => svg(/* @__PURE__ */ u("path", {
		d: "M3.75 7.25c0-1.1.9-2 2-2h3.6l2 2.25h6.9c1.1 0 2 .9 2 2v7.25c0 1.1-.9 2-2 2H5.75c-1.1 0-2-.9-2-2z",
		...stroke
	}), 14);
	// extension/src/content/sidebar/view.tsx
	var OFF_TEXT = {
		reconnect_needed: "disconnected",
		unauthorized: "unauthorized",
		error: "conn_error"
	};
	var isOff = (c) => c in OFF_TEXT;
	function plural(t, lang, base, count) {
		return t(`${base}_${new Intl.PluralRules(lang === "pt-BR" ? "pt-BR" : "en").select(count) === "one" ? "one" : "other"}`, { count: formatCount(count, lang) || "0" });
	}
	function Count({ n, lang }) {
		const text = formatCount(n, lang);
		return text ? /* @__PURE__ */ u("span", {
			class: "count",
			"data-part": "count",
			"aria-hidden": "true",
			children: text
		}) : null;
	}
	function itemLabel(p, name, count) {
		return count > 0 ? `${name}, ${plural(p.t, p.lang, "new_count", count)}` : name;
	}
	function FolderItem({ node, p }) {
		const key = keyOf("folder", node.id);
		const has = node.children.length > 0;
		const open = has && p.expanded.has(node.id);
		return /* @__PURE__ */ u("div", {
			role: "treeitem",
			"data-key": key,
			"aria-level": node.level,
			"aria-expanded": has ? open ? "true" : "false" : void 0,
			"aria-selected": p.openKey === key ? "true" : "false",
			"aria-label": itemLabel(p, node.name, node.count),
			tabIndex: p.focusKey === key ? 0 : -1,
			children: [/* @__PURE__ */ u("div", {
				class: node.level > 1 ? "row sub" : "row",
				style: node.level > 1 ? { "--indent": `${(node.level - 2) * 12}px` } : void 0,
				children: [
					node.level === 1 ? /* @__PURE__ */ u("span", {
						class: "icon",
						children: /* @__PURE__ */ u(FolderIcon, {})
					}) : null,
					/* @__PURE__ */ u("span", {
						class: "label",
						children: node.name
					}),
					/* @__PURE__ */ u(Count, {
						n: node.count,
						lang: p.lang
					}),
					has ? /* @__PURE__ */ u("span", {
						class: "toggle",
						"data-part": "toggle",
						title: p.t(open ? "collapse" : "expand"),
						children: /* @__PURE__ */ u(ChevronIcon, {})
					}) : null
				]
			}), open ? /* @__PURE__ */ u("div", {
				role: "group",
				children: node.children.map((c) => /* @__PURE__ */ u(FolderItem, {
					node: c,
					p
				}, c.id))
			}) : null]
		});
	}
	function SectionView(p) {
		const { t, data } = p;
		const off = isOff(p.conn);
		const empty = data.tabs.length === 0 && data.folders.length === 0;
		const total = formatCount(data.total, p.lang);
		return /* @__PURE__ */ u("div", {
			class: "section",
			"data-part": "section",
			"data-off": off ? "true" : void 0,
			children: [
				/* @__PURE__ */ u("h3", {
					class: "head",
					children: [
						/* @__PURE__ */ u("span", {
							class: "head-mark",
							"data-part": "wing",
							children: /* @__PURE__ */ u(WingIcon, {})
						}),
						/* @__PURE__ */ u("span", {
							class: "head-title",
							children: t("title")
						}),
						data.refreshing ? /* @__PURE__ */ u("span", {
							class: "spin",
							"data-part": "refreshing",
							role: "img",
							"aria-label": t("refreshing"),
							title: t("refreshing")
						}) : null,
						total ? /* @__PURE__ */ u("span", {
							class: "total",
							"data-part": "total",
							"aria-label": plural(t, p.lang, "new_count", data.total),
							children: total
						}) : null
					]
				}),
				off ? /* @__PURE__ */ u("p", {
					class: "note",
					"data-part": "conn",
					role: "status",
					children: [/* @__PURE__ */ u(OffIcon, {}), /* @__PURE__ */ u("span", { children: t(OFF_TEXT[p.conn]) })]
				}) : null,
				empty ? /* @__PURE__ */ u("p", {
					class: "note",
					"data-part": "empty",
					children: [/* @__PURE__ */ u(InfoIcon, {}), /* @__PURE__ */ u("span", { children: t("empty_hint") })]
				}) : /* @__PURE__ */ u("div", {
					class: "tree",
					role: "tree",
					"aria-label": t("tree_label"),
					"data-off": off ? "true" : void 0,
					onClick: p.onClick,
					onKeyDown: p.onKeyDown,
					onFocusIn: p.onFocusIn,
					children: [data.tabs.map((tab) => {
						const key = keyOf("tab", tab.id);
						return /* @__PURE__ */ u("div", {
							role: "treeitem",
							"data-key": key,
							"aria-level": 1,
							"aria-selected": p.openKey === key ? "true" : "false",
							"aria-label": itemLabel(p, tab.name, tab.count),
							tabIndex: p.focusKey === key ? 0 : -1,
							children: /* @__PURE__ */ u("div", {
								class: "row",
								children: [
									/* @__PURE__ */ u(TabIconBox, { tab }),
									/* @__PURE__ */ u("span", {
										class: "label",
										children: tab.name
									}),
									/* @__PURE__ */ u(Count, {
										n: tab.count,
										lang: p.lang
									})
								]
							})
						}, key);
					}), p.tree.map((n) => /* @__PURE__ */ u(FolderItem, {
						node: n,
						p
					}, keyOf("folder", n.id)))]
				})
			]
		});
	}
	function MiniView(p) {
		const badge = formatCount(p.total, p.lang);
		const label = p.total > 0 ? `${p.t("title")}, ${plural(p.t, p.lang, "new_count", p.total)}` : p.t("title");
		return /* @__PURE__ */ u("button", {
			type: "button",
			class: "mini",
			"data-part": "mini",
			"aria-label": label,
			"aria-expanded": p.open ? "true" : "false",
			title: label,
			onClick: p.onClick,
			children: [/* @__PURE__ */ u("span", {
				class: "mini-icon",
				children: [/* @__PURE__ */ u(HermesIcon, {}), badge && !isOff(p.conn) ? /* @__PURE__ */ u("span", {
					class: "badge",
					"data-part": "badge",
					"aria-hidden": "true",
					children: badge
				}) : null]
			}), /* @__PURE__ */ u("span", {
				class: "mini-title",
				children: p.t("title")
			})]
		});
	}
	function VideoCard({ item, p }) {
		const v = item.video;
		const id = v.id;
		const channel = (item.channel && typeof item.channel.title === "string" ? item.channel.title : null) ?? (typeof v.channel_title === "string" ? v.channel_title : "");
		const why = item.why && typeof item.why.label === "string" && item.why.label ? item.why.label + (typeof item.why.detail === "string" && item.why.detail ? ` · ${item.why.detail}` : "") : "";
		const dur = durationLabel(v.duration_s);
		const age = relativeAge(v.published_at, p.now, p.lang);
		const seen = !item.is_new || p.open?.read === "done" || p.open?.read === "pending" || p.open?.read === "sending";
		return /* @__PURE__ */ u("a", {
			class: seen ? "video seen" : "video",
			"data-part": "video",
			href: watchUrl(id),
			children: [/* @__PURE__ */ u("span", {
				class: "thumb",
				children: [/* @__PURE__ */ u("img", {
					src: thumbUrl(id),
					alt: "",
					loading: "lazy",
					decoding: "async",
					referrerpolicy: "no-referrer",
					onError: p.on.imgError
				}), dur ? /* @__PURE__ */ u("span", {
					class: "dur",
					"data-part": "duration",
					children: dur
				}) : null]
			}), /* @__PURE__ */ u("span", {
				class: "meta",
				children: [
					why ? /* @__PURE__ */ u("span", {
						class: "why",
						children: [/* @__PURE__ */ u(ViaIcon, {}), /* @__PURE__ */ u("span", {
							"data-part": "why",
							children: why
						})]
					}) : null,
					/* @__PURE__ */ u("span", {
						class: "title",
						"data-part": "title",
						children: typeof v.title === "string" ? v.title : ""
					}),
					channel ? /* @__PURE__ */ u("span", {
						class: "line",
						"data-part": "channel",
						children: channel
					}) : null,
					/* @__PURE__ */ u("span", {
						class: "line",
						children: [item.is_new && !seen ? /* @__PURE__ */ u("span", {
							class: "new-dot",
							"aria-hidden": "true"
						}) : null, /* @__PURE__ */ u("span", {
							"data-part": "age",
							children: age
						})]
					})
				]
			})]
		});
	}
	function Skeleton({ n }) {
		return /* @__PURE__ */ u(S, { children: Array.from({ length: n }, (_, i) => /* @__PURE__ */ u("div", {
			class: "video",
			"data-part": "skeleton",
			"aria-hidden": "true",
			children: [/* @__PURE__ */ u("span", { class: "thumb sk" }), /* @__PURE__ */ u("span", {
				class: "meta",
				children: [
					/* @__PURE__ */ u("span", {
						class: "sk sk-line",
						style: { width: "40%" }
					}),
					/* @__PURE__ */ u("span", {
						class: "sk sk-line",
						style: { width: "92%" }
					}),
					/* @__PURE__ */ u("span", {
						class: "sk sk-line",
						style: { width: "70%" }
					})
				]
			})]
		}, `sk${i}`)) });
	}
	var BUILTIN_ICON = {
		new: NewIcon,
		star: StarIcon,
		later: LaterIcon
	};
	/** Tab icon: the built-in tabs' own drawing › short server emoji (text) › the default. */
	function TabIconBox({ tab }) {
		const builtin = builtinTabIcon(tab.id);
		if (builtin) {
			const Icon = BUILTIN_ICON[builtin];
			return /* @__PURE__ */ u("span", {
				class: "icon",
				"data-icon": builtin,
				children: /* @__PURE__ */ u(Icon, {})
			});
		}
		const glyph = tabGlyph(tab.icon);
		return /* @__PURE__ */ u("span", {
			class: "icon",
			"data-icon": glyph ? "glyph" : "tab",
			children: glyph ? /* @__PURE__ */ u("span", {
				class: "glyph",
				children: glyph
			}) : /* @__PURE__ */ u(TabIcon, {})
		});
	}
	function Picks({ p }) {
		const rows = [];
		for (const tab of p.data.tabs) {
			const key = keyOf("tab", tab.id);
			rows.push(/* @__PURE__ */ u("button", {
				type: "button",
				class: "pick",
				"data-pick": key,
				onClick: p.on.pick,
				children: [
					/* @__PURE__ */ u(TabIconBox, { tab }),
					/* @__PURE__ */ u("span", {
						class: "label",
						children: tab.name
					}),
					formatCount(tab.count, p.lang) ? /* @__PURE__ */ u("span", {
						class: "count",
						children: formatCount(tab.count, p.lang)
					}) : null
				]
			}, key));
		}
		const walk = (nodes) => {
			for (const n of nodes) {
				const key = keyOf("folder", n.id);
				rows.push(/* @__PURE__ */ u("button", {
					type: "button",
					class: "pick",
					"data-pick": key,
					onClick: p.on.pick,
					style: { "--indent": `${(n.level - 1) * 16}px` },
					children: [
						/* @__PURE__ */ u("span", {
							class: "icon",
							children: /* @__PURE__ */ u(FolderIcon, {})
						}),
						/* @__PURE__ */ u("span", {
							class: "label",
							children: n.name
						}),
						formatCount(n.count, p.lang) ? /* @__PURE__ */ u("span", {
							class: "count",
							children: formatCount(n.count, p.lang)
						}) : null
					]
				}, key));
				walk(n.children);
			}
		};
		walk(p.tree);
		if (!rows.length) return /* @__PURE__ */ u("div", {
			class: "state",
			"data-part": "empty",
			children: /* @__PURE__ */ u("span", {
				class: "state-hint",
				children: p.t("empty_hint")
			})
		});
		return /* @__PURE__ */ u(S, { children: rows });
	}
	function FeedBody({ s, p }) {
		if (s.status === "loading") return /* @__PURE__ */ u(Skeleton, { n: 5 });
		if (s.status === "error") return /* @__PURE__ */ u("div", {
			class: "state",
			"data-part": "error",
			role: "alert",
			children: [
				/* @__PURE__ */ u("span", {
					class: "state-title",
					children: p.t("feed_error")
				}),
				/* @__PURE__ */ u("span", {
					class: "state-hint",
					children: p.t("feed_error_hint")
				}),
				/* @__PURE__ */ u("button", {
					type: "button",
					class: "pill",
					onClick: p.on.retry,
					children: p.t("retry")
				})
			]
		});
		const items = s.items.filter((i) => i && i.video && isVideoId(i.video.id));
		if (!items.length && !s.cursor) return /* @__PURE__ */ u("div", {
			class: "state",
			"data-part": "empty",
			children: [/* @__PURE__ */ u("span", {
				class: "state-title",
				children: p.t("feed_empty")
			}), /* @__PURE__ */ u("span", {
				class: "state-hint",
				children: p.t("feed_empty_hint")
			})]
		});
		return /* @__PURE__ */ u(S, { children: [
			items.map((item) => /* @__PURE__ */ u(VideoCard, {
				item,
				p
			}, item.video.id)),
			s.more === "loading" ? /* @__PURE__ */ u(Skeleton, { n: 2 }) : null,
			s.cursor && s.more !== "loading" ? /* @__PURE__ */ u("div", {
				class: "more",
				children: [s.more === "error" ? /* @__PURE__ */ u("span", {
					class: "msg",
					children: p.t("more_error")
				}) : null, /* @__PURE__ */ u("button", {
					type: "button",
					class: "pill",
					"data-part": "more",
					onClick: p.on.more,
					children: p.t(s.more === "error" ? "retry" : "load_more")
				})]
			}) : null
		] });
	}
	function PanelView(p) {
		const s = p.open;
		const feed = s?.view === "feed" && s.scope;
		const heading = feed ? s.scope.name : p.t("title");
		const count = feed ? p.scopeCount : p.data.total;
		const canMark = Boolean(feed) && s.status === "ready" && s.read === "idle" && (p.scopeCount > 0 || s.items.some((i) => i?.is_new));
		const back = Boolean(feed) && s.anchor === "mini";
		return /* @__PURE__ */ u("section", {
			class: "panel",
			"data-part": "panel",
			role: "dialog",
			"aria-modal": "false",
			"aria-labelledby": "tube-panel-title",
			hidden: !s,
			style: {
				"--left": `${Math.round(p.left + 8)}px`,
				"--top": `${Math.round(p.top + 8)}px`,
				"--undo-ms": `${p.undoMs}ms`
			},
			onKeyDown: p.on.keydown,
			children: s ? /* @__PURE__ */ u(S, { children: [
				/* @__PURE__ */ u("header", {
					class: back ? "p-head with-back" : "p-head",
					children: [
						back ? /* @__PURE__ */ u("button", {
							type: "button",
							class: "round",
							"data-part": "back",
							"aria-label": p.t("back"),
							title: p.t("back"),
							onClick: p.on.back,
							children: /* @__PURE__ */ u(BackIcon, {})
						}) : null,
						/* @__PURE__ */ u("div", {
							class: "p-titles",
							children: [/* @__PURE__ */ u("h2", {
								class: "p-title",
								id: "tube-panel-title",
								"data-part": "heading",
								tabIndex: -1,
								children: heading
							}), /* @__PURE__ */ u("span", {
								class: "p-sub",
								children: count > 0 ? plural(p.t, p.lang, "new_count", count) : p.t("none_new")
							})]
						}),
						canMark ? /* @__PURE__ */ u("button", {
							type: "button",
							class: "pill",
							"data-part": "mark",
							onClick: p.on.mark,
							children: [/* @__PURE__ */ u(CheckIcon, {}), p.t("mark_read")]
						}) : null,
						/* @__PURE__ */ u("button", {
							type: "button",
							class: "round",
							"data-part": "close",
							"aria-label": p.t("close"),
							title: p.t("close"),
							onClick: p.on.close,
							children: /* @__PURE__ */ u(CloseIcon, {})
						})
					]
				}),
				s.read === "pending" ? /* @__PURE__ */ u("div", {
					class: "undo",
					"data-part": "undo-bar",
					role: "status",
					children: [
						/* @__PURE__ */ u("span", {
							class: "undo-text",
							children: p.t("marked_read")
						}),
						/* @__PURE__ */ u("button", {
							type: "button",
							onClick: p.on.undo,
							children: p.t("undo")
						}),
						/* @__PURE__ */ u("span", {
							class: "undo-progress",
							"aria-hidden": "true"
						})
					]
				}) : null,
				s.read === "error" ? /* @__PURE__ */ u("p", {
					class: "msg",
					"data-part": "read-error",
					role: "alert",
					children: p.t("mark_failed")
				}) : null,
				/* @__PURE__ */ u("div", {
					class: "p-body",
					"data-part": "list",
					"aria-busy": s.view === "feed" && s.status === "loading" ? "true" : "false",
					children: s.view === "tree" ? /* @__PURE__ */ u(Picks, { p }) : /* @__PURE__ */ u(FeedBody, {
						s,
						p
					})
				})
			] }) : null
		});
	}
	// extension/src/content/sidebar/controller.ts
	/** Own key in chrome.storage.local: open folders in the tree (`{expanded: string[]}`). */
	var SIDEBAR_TREE_KEY = STORAGE_KEYS.sidebarTree;
	var UNDO_MS = 5e3;
	/** More than this many re-placements in 10 s = a fight with YouTube: the bar gives up (disappears). */
	var MAX_PLACEMENTS = 40;
	async function startSidebar(ctx, opts = {}) {
		const doc = opts.doc ?? document;
		const now = opts.now ?? (() => Date.now());
		const win = doc.defaultView ?? window;
		let dead = false;
		let data = normalizeState(ctx.state);
		let tree = buildFolderTree(data.folders);
		let conn = "unknown";
		const expanded = /* @__PURE__ */ new Set();
		let focusKey = null;
		let open = null;
		let openKey = null;
		let seq = 0;
		let pendingRead = null;
		let theme = "light";
		let placements = [];
		let section = null;
		let mini = null;
		let panel = null;
		let watcher = null;
		const cleanups = [];
		const tr = (key, vars) => ctx.t("sidebar", key, vars);
		function die(e) {
			if (dead) return;
			try {
				console.debug("[tube] sidebar off:", e instanceof Error ? e.message : String(e));
			} catch {}
			teardown(false);
		}
		function guard(fn) {
			return (...a) => {
				if (dead) return;
				try {
					fn(...a);
				} catch (e) {
					die(e);
				}
			};
		}
		const later = (p) => {
			p.catch(die);
		};
		function makeHost(tag, kind, css) {
			const el = doc.createElement(tag);
			el.setAttribute("data-theme", theme);
			const root = el.attachShadow({ mode: "closed" });
			opts.inspect?.(kind, root);
			const base = doc.createElement("style");
			base.textContent = css;
			const vars = doc.createElement("style");
			const mount = doc.createElement("div");
			mount.className = "mount";
			root.append(base, vars, mount);
			for (const type of [
				"keydown",
				"keyup",
				"keypress"
			]) mount.addEventListener(type, (e) => e.stopPropagation());
			return {
				el,
				root,
				vars,
				mount
			};
		}
		/** Follows `html[dark]`; returns whether it changed (the section line is measured again in the new theme). */
		function setTheme() {
			const next = doc.documentElement.hasAttribute("dark") ? "dark" : "light";
			const changed = next !== theme;
			theme = next;
			for (const host of [
				section,
				mini,
				panel
			]) if (host && host.el.getAttribute("data-theme") !== theme) host.el.setAttribute("data-theme", theme);
			return changed;
		}
		function remeasure() {
			const sections = guideSections(doc);
			if (!sections) return;
			const css = metricsCss(measureGuide(sections));
			for (const host of [
				section,
				mini,
				panel
			]) if (host && host.vars.textContent !== css) host.vars.textContent = css;
		}
		function placed() {
			const t = Date.now();
			placements = placements.filter((x) => t - x < 1e4);
			placements.push(t);
			if (placements.length > MAX_PLACEMENTS) throw new Error("guide keeps rebuilding; giving up");
		}
		/** Checks the position of the hosts (called by the observers and by navigation). */
		function check() {
			let moved = setTheme();
			const sections = guideSections(doc);
			if (sections) {
				if (!section) {
					section = makeHost(SECTION_TAG, "section", SECTION_CSS);
					moved = true;
				}
				if (placeSection(sections, section.el) === true) {
					placed();
					moved = true;
				}
			} else if (section?.el.isConnected) section.el.remove();
			const items = miniItems(doc);
			if (items) {
				if (!mini) {
					mini = makeHost(MINI_TAG, "mini", MINI_CSS);
					moved = true;
				}
				if (placeMini(items, mini.el)) {
					placed();
					moved = true;
				}
			}
			if (moved) {
				remeasure();
				draw();
			}
			if (open) {
				const anchor = open.anchor === "section" ? section?.el : mini?.el;
				if (!(anchor?.isConnected && (open.anchor === "section" ? drawerOpen(anchor) : miniVisible(anchor)))) closePanel(false);
			}
			watcher?.retarget();
		}
		function scopeCount(scope) {
			if (!scope) return data.total;
			if (scope.kind === "tab") return data.tabs.find((t) => t.id === scope.id)?.count ?? 0;
			return findFolder(tree, scope.id)?.count ?? 0;
		}
		function draw() {
			if (dead) return;
			const lang = getLanguage();
			if (section) R(k(SectionView, {
				t: tr,
				lang,
				data,
				tree,
				expanded,
				focusKey: focusKey ?? keys()[0] ?? null,
				openKey: open?.anchor === "section" ? openKey : null,
				conn,
				onClick: onTreeClick,
				onKeyDown: onTreeKey,
				onFocusIn: onTreeFocus
			}), section.mount);
			if (mini) R(k(MiniView, {
				t: tr,
				lang,
				total: data.total,
				open: open?.anchor === "mini",
				conn,
				onClick: onMiniClick
			}), mini.mount);
			if (panel) {
				const anchorEl = open?.anchor === "mini" ? mini?.el : section?.el;
				R(k(PanelView, {
					t: tr,
					lang,
					now: now(),
					open,
					data,
					tree,
					left: anchorEl ? guideEdge(anchorEl, open?.anchor ?? "section") : 240,
					top: mastheadBottom(doc),
					undoMs: UNDO_MS,
					scopeCount: scopeCount(open?.scope ?? null),
					on: panelOn
				}), panel.mount);
			}
		}
		function applyState(state) {
			if (!state) return;
			data = normalizeState(state);
			tree = buildFolderTree(data.folders);
			const keys = visibleKeys(data.tabs, tree, expanded);
			if (focusKey && !keys.includes(focusKey)) focusKey = null;
			draw();
		}
		async function refreshConn() {
			const res = await ctx.send("conn.status", {});
			if (dead || !res?.ok || !res.data) return;
			const next = res.data.state;
			if (next !== conn) {
				conn = next;
				draw();
			}
		}
		const keys = () => visibleKeys(data.tabs, tree, expanded);
		/** Row by key (ids come from the server: text comparison, never a built selector). */
		function rowEl(key) {
			if (!section) return null;
			for (const el of section.root.querySelectorAll("[data-key]")) if (el.getAttribute("data-key") === key) return el;
			return null;
		}
		function focusRow(key) {
			focusKey = key;
			draw();
			rowEl(key)?.focus();
		}
		function scopeOf(key) {
			const id = key.slice(2);
			if (key.startsWith("t:")) {
				const tab = data.tabs.find((t) => t.id === id);
				return tab ? {
					kind: "tab",
					id,
					name: tab.name
				} : null;
			}
			const f = findFolder(tree, id);
			return f ? {
				kind: "folder",
				id,
				name: f.name
			} : null;
		}
		function setExpanded(id, on) {
			if (on === expanded.has(id)) return;
			if (on) expanded.add(id);
			else expanded.delete(id);
			draw();
			later(chrome.storage.local.set({ [SIDEBAR_TREE_KEY]: { expanded: [...expanded] } }));
		}
		const keyFromEvent = (e) => e.target?.closest?.("[data-key]")?.getAttribute("data-key") ?? null;
		const onTreeClick = guard((e) => {
			const key = keyFromEvent(e);
			if (!key) return;
			if (e.target.closest("[data-part=\"toggle\"]")) {
				e.preventDefault();
				setExpanded(key.slice(2), !expanded.has(key.slice(2)));
				return;
			}
			focusKey = key;
			toggleScope(key, "section");
		});
		const onTreeFocus = guard((e) => {
			const key = keyFromEvent(e);
			if (key && key !== focusKey) {
				focusKey = key;
				draw();
			}
		});
		const onTreeKey = guard((e) => {
			const key = keyFromEvent(e);
			if (!key || e.altKey || e.ctrlKey || e.metaKey) return;
			const list = keys();
			const i = list.indexOf(key);
			const folder = key.startsWith("f:") ? findFolder(tree, key.slice(2)) : null;
			const go = (k) => {
				if (k) focusRow(k);
				e.preventDefault();
			};
			switch (e.key) {
				case "ArrowDown": return go(list[Math.min(list.length - 1, i + 1)]);
				case "ArrowUp": return go(list[Math.max(0, i - 1)]);
				case "Home": return go(list[0]);
				case "End": return go(list[list.length - 1]);
				case "ArrowRight":
					e.preventDefault();
					if (folder?.children.length) {
						if (!expanded.has(folder.id)) setExpanded(folder.id, true);
						else focusRow(keyOf("folder", folder.children[0].id));
					}
					return;
				case "ArrowLeft":
					e.preventDefault();
					if (folder?.children.length && expanded.has(folder.id)) setExpanded(folder.id, false);
					else if (folder?.parentId) focusRow(keyOf("folder", folder.parentId));
					return;
				case "Enter":
				case " ":
					e.preventDefault();
					focusKey = key;
					toggleScope(key, "section");
					return;
				case "Escape":
					if (open) {
						e.preventDefault();
						closePanel(true);
					}
					return;
				case "Tab":
					if (!e.shiftKey && open && open.anchor === "section" && openKey === key && focusFirstInPanel()) e.preventDefault();
					return;
			}
		});
		const onMiniClick = guard(() => {
			if (open?.anchor === "mini") return closePanel(true);
			flushRead();
			openPanel({
				anchor: "mini",
				view: "tree",
				scope: null,
				status: "ready",
				items: [],
				cursor: null,
				more: "idle",
				read: "idle"
			}, null);
		});
		function ensurePanel() {
			if (!panel) {
				panel = makeHost(PANEL_TAG, "panel", PANEL_CSS);
				remeasure();
			}
			if (!panel.el.isConnected) (doc.body ?? doc.documentElement).append(panel.el);
			return panel;
		}
		function focusables() {
			if (!panel || !open) return [];
			return [...panel.root.querySelectorAll("button, a[href]")].filter((el) => !el.hasAttribute("disabled"));
		}
		function focusFirstInPanel() {
			const first = focusables()[0];
			if (!first) return false;
			first.focus();
			return true;
		}
		function anchorEl() {
			if (!open) return null;
			if (open.anchor === "mini") return mini?.root.querySelector("[data-part=\"mini\"]") ?? null;
			return openKey ? rowEl(openKey) : null;
		}
		function openPanel(state, key) {
			ensurePanel();
			open = state;
			openKey = key;
			draw();
			if (!listening) listen(true);
		}
		function toggleScope(key, anchor) {
			if (open && openKey === key && open.anchor === anchor && open.view === "feed") {
				closePanel(true);
				return;
			}
			const scope = scopeOf(key);
			if (!scope) return;
			flushRead();
			openPanel({
				anchor,
				view: "feed",
				scope,
				status: "loading",
				items: [],
				cursor: null,
				more: "idle",
				read: "idle"
			}, key);
			later(load(false));
		}
		async function load(more) {
			if (!open?.scope) return;
			const mine = ++seq;
			const scope = open.scope;
			const req = {
				[scope.kind]: scope.id,
				limit: 20
			};
			if (more && open.cursor) req.cursor = open.cursor;
			if (more) open = {
				...open,
				more: "loading"
			};
			else open = {
				...open,
				status: "loading",
				items: [],
				cursor: null,
				more: "idle"
			};
			draw();
			const res = await ctx.send("feed.get", req);
			if (dead || mine !== seq || !open?.scope || open.scope.id !== scope.id || open.scope.kind !== scope.kind) return;
			if (res?.ok && res.data && Array.isArray(res.data.items)) {
				const items = more ? [...open.items, ...res.data.items] : res.data.items;
				const seen = /* @__PURE__ */ new Set();
				const unique = items.filter((i) => {
					const id = i?.video?.id;
					if (typeof id !== "string" || seen.has(id)) return false;
					seen.add(id);
					return true;
				});
				const cursor = typeof res.data.next_cursor === "string" && res.data.next_cursor ? res.data.next_cursor : null;
				open = {
					...open,
					status: "ready",
					items: unique,
					cursor,
					more: "idle"
				};
				if (conn !== "connected" && conn !== "unknown") later(refreshConn());
			} else {
				open = more ? {
					...open,
					more: "error"
				} : {
					...open,
					status: "error"
				};
				later(refreshConn());
			}
			draw();
		}
		function closePanel(restoreFocus) {
			if (!open) return;
			const target = restoreFocus ? anchorEl() : null;
			flushRead();
			open = null;
			openKey = null;
			seq++;
			draw();
			if (listening) listen(false);
			target?.focus();
		}
		function scopeBody(scope) {
			return {
				kind: scope.kind,
				id: scope.id
			};
		}
		async function sendRead(scope) {
			const res = await ctx.send("read.mark", scopeBody(scope));
			if (dead) return;
			const here = open?.scope && open.scope.kind === scope.kind && open.scope.id === scope.id;
			if (!res?.ok) {
				if (here) {
					open = {
						...open,
						read: "error"
					};
					draw();
				}
				return;
			}
			if (here) {
				open = {
					...open,
					read: "done",
					items: open.items.map((i) => ({
						...i,
						is_new: false
					}))
				};
				draw();
			}
			const fresh = await ctx.send("state.get", { refresh: true });
			if (!dead && fresh?.ok && fresh.data) applyState(fresh.data);
		}
		function flushRead() {
			if (!pendingRead) return;
			const { scope, timer } = pendingRead;
			pendingRead = null;
			clearTimeout(timer);
			if (open?.read === "pending") open = {
				...open,
				read: "sending"
			};
			later(sendRead(scope));
		}
		const panelOn = {
			close: guard(() => closePanel(true)),
			back: guard(() => {
				if (!open) return;
				flushRead();
				seq++;
				open = {
					...open,
					view: "tree",
					scope: null,
					status: "ready",
					items: [],
					cursor: null,
					more: "idle",
					read: "idle"
				};
				openKey = null;
				draw();
				panel?.root.querySelector("[data-pick]")?.focus();
			}),
			pick: guard((e) => {
				const key = e.currentTarget?.getAttribute("data-pick");
				if (!key) return;
				const scope = scopeOf(key);
				if (!scope || !open) return;
				flushRead();
				open = {
					...open,
					view: "feed",
					scope,
					status: "loading",
					items: [],
					cursor: null,
					more: "idle",
					read: "idle"
				};
				openKey = key;
				draw();
				panel?.root.querySelector("[data-part=\"heading\"]")?.focus();
				later(load(false));
			}),
			mark: guard(() => {
				if (!open?.scope || open.read !== "idle") return;
				const scope = open.scope;
				const timer = setTimeout(guard(() => {
					if (pendingRead?.timer !== timer) return;
					flushRead();
				}), UNDO_MS);
				pendingRead = {
					scope,
					timer
				};
				open = {
					...open,
					read: "pending"
				};
				draw();
				panel?.root.querySelector("[data-part=\"undo-bar\"] button")?.focus();
			}),
			undo: guard(() => {
				if (!pendingRead) return;
				clearTimeout(pendingRead.timer);
				pendingRead = null;
				if (open) open = {
					...open,
					read: "idle"
				};
				draw();
				panel?.root.querySelector("[data-part=\"mark\"]")?.focus();
			}),
			retry: guard(() => later(load(false))),
			more: guard(() => later(load(true))),
			keydown: guard((e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					closePanel(true);
					return;
				}
				if (e.key !== "Tab") return;
				const list = focusables();
				const at = list.indexOf(panel.root.activeElement);
				const back = anchorEl();
				if (!back) return;
				if (e.shiftKey && at <= 0 || !e.shiftKey && at === list.length - 1) {
					e.preventDefault();
					back.focus();
				}
			}),
			imgError: guard((e) => {
				const img = e.currentTarget;
				if (img) img.style.visibility = "hidden";
			})
		};
		let listening = false;
		const pathHasOurs = (e) => {
			const path = e.composedPath();
			return [
				section?.el,
				mini?.el,
				panel?.el
			].some((el) => el && path.includes(el));
		};
		const onPointerDown = guard((e) => {
			if (!open || pathHasOurs(e)) return;
			const anchor = anchorEl();
			closePanel(false);
			setTimeout(guard(() => {
				const active = doc.activeElement;
				if (!active || active === doc.body || active === doc.documentElement) anchor?.focus({ preventScroll: true });
			}), 0);
		});
		const onDocKey = guard((e) => {
			if (open && e.key === "Escape" && !pathHasOurs(e)) closePanel(true);
		});
		const onResize = guard(() => draw());
		function listen(on) {
			listening = on;
			const fn = on ? "addEventListener" : "removeEventListener";
			doc[fn]("pointerdown", onPointerDown, true);
			doc[fn]("mousedown", onPointerDown, true);
			doc[fn]("keydown", onDocKey, true);
			win[fn]("resize", onResize);
		}
		function teardown(sendPending) {
			if (dead) return;
			if (sendPending && pendingRead) {
				const { scope, timer } = pendingRead;
				clearTimeout(timer);
				pendingRead = null;
				Promise.resolve().then(() => ctx.send("read.mark", scopeBody(scope))).catch(() => void 0);
			}
			if (pendingRead) clearTimeout(pendingRead.timer);
			pendingRead = null;
			dead = true;
			if (listening) try {
				listen(false);
			} catch {}
			watcher?.dispose();
			for (const c of cleanups.splice(0)) try {
				c();
			} catch {}
			for (const host of [
				section,
				mini,
				panel
			]) {
				if (!host) continue;
				try {
					R(null, host.mount);
				} catch {}
				host.el.remove();
			}
			section = mini = panel = null;
		}
		const onNavigate = guard(() => check());
		let lastBoot = 0;
		let bootTimer = null;
		const onMutate = guard(() => {
			if (!watcher?.booting()) return check();
			const t = Date.now();
			if (t - lastBoot >= 200) {
				lastBoot = t;
				check();
			} else if (!bootTimer) bootTimer = setTimeout(guard(() => {
				bootTimer = null;
				lastBoot = Date.now();
				check();
			}), 200 - (t - lastBoot));
		});
		cleanups.push(() => {
			if (bootTimer) clearTimeout(bootTimer);
		});
		const onStorage = guard((changes, area) => {
			if (area !== "local") return;
			if (STORAGE_KEYS.connection in changes) later(refreshConn());
			if (SIDEBAR_TREE_KEY in changes) {
				const list = changes[SIDEBAR_TREE_KEY].newValue?.expanded;
				if (Array.isArray(list)) {
					expanded.clear();
					for (const id of list) if (typeof id === "string") expanded.add(id);
					draw();
				}
			}
		});
		const onVisible = guard(() => {
			if (doc.visibilityState === "visible") later(refreshConn());
		});
		const onPageHide = guard(() => flushRead());
		try {
			const saved = ((await chrome.storage.local.get(SIDEBAR_TREE_KEY))?.[SIDEBAR_TREE_KEY])?.expanded;
			if (Array.isArray(saved)) {
				for (const id of saved) if (typeof id === "string") expanded.add(id);
			}
		} catch {}
		try {
			cleanups.push(ctx.onState(guard((s) => applyState(s))));
			doc.addEventListener("yt-navigate-finish", onNavigate);
			cleanups.push(() => doc.removeEventListener("yt-navigate-finish", onNavigate));
			doc.addEventListener("visibilitychange", onVisible);
			cleanups.push(() => doc.removeEventListener("visibilitychange", onVisible));
			win.addEventListener("pagehide", onPageHide);
			cleanups.push(() => win.removeEventListener("pagehide", onPageHide));
			chrome.storage.onChanged.addListener(onStorage);
			cleanups.push(() => chrome.storage.onChanged.removeListener(onStorage));
			watcher = watchGuide(doc, onMutate);
			check();
			later(refreshConn());
		} catch (e) {
			die(e);
		}
		return { stop() {
			teardown(true);
		} };
	}
	// extension/src/content/sidebar/index.ts
	var MODULE$4 = "content/sidebar";
	var ROUTES$4 = [
		"GET /ext/state",
		"GET /ext/feed",
		"POST /ext/read"
	];
	var REAL_ROUTES$4 = ROUTES$4;
	function createSidebarModule(opts = {}) {
		let ctl = null;
		let gen = 0;
		return {
			MODULE: MODULE$4,
			ROUTES: ROUTES$4,
			REAL_ROUTES: REAL_ROUTES$4,
			COMMANDS: [],
			matches: (url, state) => state !== null && !url.pathname.startsWith("/embed/"),
			async start(ctx) {
				const mine = ++gen;
				ctl?.stop();
				ctl = null;
				try {
					const c = await startSidebar(ctx, opts);
					if (mine !== gen) c.stop();
					else ctl = c;
				} catch (e) {
					console.debug("[tube] sidebar did not start:", e instanceof Error ? e.message : String(e));
				}
			},
			stop() {
				gen++;
				ctl?.stop();
				ctl = null;
			}
		};
	}
	var sidebar = createSidebarModule();
	var thumbs = {
		MODULE: "content/thumbs",
		ROUTES: ["GET /ext/state"],
		REAL_ROUTES: [],
		COMMANDS: [],
		matches: (_url, state) => state?.extras_honest_thumbnails === true,
		start() {},
		stop() {}
	};
	// extension/src/content/tracker.ts
	var MODULE$2 = "content/tracker";
	var ROUTES$2 = ["POST /ext/sync/watch"];
	var REAL_ROUTES$2 = ["POST /ext/sync/watch"];
	/** slack on the accepted advance: delta ≤ wall × speed × 1.25 + 1 s */
	var SLACK_FACTOR = 1.25;
	var SLACK_S = 1;
	var VIDEO_ID = /^[\w-]{11}$/;
	var CHANNEL_ID$2 = /^UC[\w-]{22}$/;
	/** Pure rule: takes player samples, returns the `WatchEvent` when it passes the threshold (once per video). */
	var WatchCounter = class {
		videoId = null;
		watched = 0;
		lastPos = null;
		lastAt = 0;
		sent = /* @__PURE__ */ new Set();
		/** seconds of real playback of the current video */
		watchedSeconds() {
			return this.watched;
		}
		/** resets the baseline (seek, ad, long pause): the next sample only fixes the position */
		resetBase() {
			this.lastPos = null;
		}
		sample(s) {
			if (!s.videoId || !VIDEO_ID.test(s.videoId)) {
				this.lastPos = null;
				return null;
			}
			if (s.videoId !== this.videoId) {
				this.videoId = s.videoId;
				this.watched = 0;
				this.lastPos = null;
			}
			if (s.ad || !Number.isFinite(s.currentTime)) {
				this.lastPos = null;
				return null;
			}
			if (this.lastPos !== null && !s.paused) {
				const delta = s.currentTime - this.lastPos;
				const wall = Math.max(0, (s.at - this.lastAt) / 1e3);
				const rate = Number.isFinite(s.rate) && s.rate > 0 ? s.rate : 1;
				if (delta > 0 && delta <= wall * rate * SLACK_FACTOR + SLACK_S) this.watched += delta;
			}
			this.lastPos = s.currentTime;
			this.lastAt = s.at;
			if (this.sent.has(s.videoId)) return null;
			if (!(Number.isFinite(s.duration) && s.duration > 0 && this.watched / s.duration > .6) && !(this.watched > 240)) return null;
			this.sent.add(s.videoId);
			const ev = {
				video_id: s.videoId,
				watched_at: Math.floor(s.at / 1e3)
			};
			ev.channel_id = s.channelId && CHANNEL_ID$2.test(s.channelId) ? s.channelId : null;
			return ev;
		}
	};
	var PLAYER = "#movie_player";
	/** retry delivering to the background: 2 s, 4 s, … up to 60 s */
	var RETRY_MIN_MS = 2e3;
	var RETRY_MAX_MS = 6e4;
	var AD_CLASSES = ["ad-showing", "ad-interrupting"];
	function videoIdOf(url) {
		if (url.pathname !== "/watch") return null;
		const v = url.searchParams.get("v");
		return v && VIDEO_ID.test(v) ? v : null;
	}
	/** Cuts out the JSON object starting at `start`, respecting strings and escapes. */
	function sliceJsonObject$1(text, start) {
		if (text[start] !== "{") return null;
		let depth = 0;
		let inStr = false;
		for (let i = start; i < text.length; i++) {
			const c = text[i];
			if (inStr) {
				if (c === "\\") i++;
				else if (c === "\"") inStr = false;
				continue;
			}
			if (c === "\"") inStr = true;
			else if (c === "{") depth++;
			else if (c === "}") {
				depth--;
				if (depth === 0) return text.slice(start, i + 1);
			}
		}
		return null;
	}
	var DETAILS_MARKER = "\"videoDetails\":";
	/**
	* Owner id from the inline player response (`ytInitialPlayerResponse.videoDetails`) of the page as it was loaded, only
	* when that object describes `videoId`. After a SPA switch the inline script still describes the first video: no id.
	*/
	function inlineOwnerOf(doc, videoId) {
		for (const s of Array.from(doc.querySelectorAll("script:not([src])"))) {
			const text = s.textContent ?? "";
			const idx = text.indexOf(DETAILS_MARKER);
			if (idx === -1) continue;
			const json = sliceJsonObject$1(text, idx + 15);
			if (!json) continue;
			try {
				const d = JSON.parse(json);
				if (d.videoId !== videoId) return null;
				return typeof d.channelId === "string" && CHANNEL_ID$2.test(d.channelId) ? d.channelId : null;
			} catch {
				return null;
			}
		}
		return null;
	}
	/**
	* Owner of the video, only if the page already shows the current video (in the SPA the old DOM lingers for a while).
	* The signed-in page links the owner as `/@handle` (no id): then the inline player response, if it is this video's.
	* `cache` keeps the inline answer per video (the inline scripts never change after load; samples arrive ~4×/s).
	*/
	function channelIdFor(doc, videoId, cache) {
		const flexy = doc.querySelector("ytd-watch-flexy");
		const shown = flexy?.getAttribute("video-id");
		if (shown && shown !== videoId) return null;
		const root = flexy ?? doc;
		for (const a of Array.from(root.querySelectorAll("ytd-video-owner-renderer a[href*=\"/channel/UC\"]"))) {
			const m = /\/channel\/(UC[\w-]{22})/.exec(a.getAttribute("href") ?? "");
			if (m) return m[1];
		}
		if (!cache.has(videoId)) cache.set(videoId, inlineOwnerOf(doc, videoId));
		return cache.get(videoId) ?? null;
	}
	function createTracker(opts = {}) {
		const doc = opts.doc ?? document;
		const urlOf = opts.url ?? (() => new URL(doc.defaultView?.location.href ?? location.href));
		const now = opts.now ?? (() => Date.now());
		const send = opts.send ?? ((type, ev) => sendRequest(type, ev));
		const counter = opts.counter ?? new WatchCounter();
		const pending = [];
		const owners = /* @__PURE__ */ new Map();
		let delivering = false;
		let on = false;
		let retryTimer = null;
		let backoff = RETRY_MIN_MS;
		/** delivers to the background; failed → retries on the next sample **or** by timer (the video may have ended) */
		async function deliver() {
			if (delivering || pending.length === 0) return;
			delivering = true;
			let failed = false;
			try {
				while (pending.length > 0) {
					const res = await send("sync.watch", pending[0]);
					if (!res.ok) {
						if (res.error.code === "invalid") pending.shift();
						else failed = true;
						break;
					}
					pending.shift();
				}
			} catch {
				failed = true;
			} finally {
				delivering = false;
			}
			if (failed && !retryTimer) {
				retryTimer = setTimeout(() => {
					retryTimer = null;
					deliver();
				}, backoff);
				backoff = Math.min(backoff * 2, RETRY_MAX_MS);
			} else if (!failed) backoff = RETRY_MIN_MS;
		}
		const onSample = (e) => {
			const video = e.target;
			if (!(video instanceof HTMLMediaElement)) return;
			const player = video.closest(PLAYER);
			if (!player) return;
			const videoId = videoIdOf(urlOf());
			const ad = AD_CLASSES.some((c) => player.classList.contains(c));
			const ev = counter.sample({
				videoId,
				currentTime: video.currentTime,
				duration: video.duration,
				paused: video.paused,
				ad,
				rate: video.playbackRate,
				at: now(),
				channelId: videoId ? channelIdFor(doc, videoId, owners) : null
			});
			if (ev) pending.push(ev);
			deliver();
		};
		const onJump = (e) => {
			if (e.target instanceof HTMLMediaElement && e.target.closest(PLAYER)) counter.resetBase();
		};
		return {
			counter,
			start() {
				if (on) return;
				on = true;
				doc.addEventListener("timeupdate", onSample, true);
				doc.addEventListener("seeking", onJump, true);
				doc.addEventListener("emptied", onJump, true);
			},
			stop() {
				if (!on) return;
				on = false;
				doc.removeEventListener("timeupdate", onSample, true);
				doc.removeEventListener("seeking", onJump, true);
				doc.removeEventListener("emptied", onJump, true);
				counter.resetBase();
			}
		};
	}
	/** one per page: the runtime calls stop/start on every navigation; videos already sent are remembered */
	var sessionCounter = new WatchCounter();
	var active = null;
	var tracker = {
		MODULE: MODULE$2,
		ROUTES: ROUTES$2,
		REAL_ROUTES: REAL_ROUTES$2,
		COMMANDS: [],
		matches: (url) => url.pathname === "/watch",
		start(ctx) {
			active?.stop();
			active = createTracker({
				counter: sessionCounter,
				send: (type, ev) => ctx.send(type, ev)
			});
			active.start();
		},
		stop() {
			active?.stop();
			active = null;
		}
	};
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
	var MODULE$1 = "background/queue";
	var ROUTES$1 = ["GET /ext/queue", "POST /ext/queue/{id}/result"];
	var REAL_ROUTES$1 = ["GET /ext/queue", "POST /ext/queue/{id}/result"];
	/**
	* No message orders an execution: only the server queue. The two from the popup only **stop** (`queue.stop`) or
	* **release** the queue and ask for a new `ExtState` (`queue.resume`) — what runs afterwards still comes from `GET /ext/queue`.
	*/
	var MESSAGES = ["queue.stop", "queue.resume"];
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
	var TAB_LOAD_TIMEOUT_MS = 45e3;
	/** the content script is not listening yet ("Receiving end does not exist"): retry up to this */
	var READY_TIMEOUT_MS = 2e4;
	var READY_RETRY_MS = 300;
	/** cap for the whole command on the page (the content script has per-step deadlines, much shorter) */
	var EXECUTE_TIMEOUT_MS = 12e4;
	var KEEPALIVE_MS = 2e4;
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
	function messageFor(p) {
		const channel = p.channel_title || p.channel_id || "";
		if (p.state === "running") {
			if (!p.action || p.index === 0) return t$1("queue", "status_starting");
			return t$1("queue", `progress_${p.action}`, {
				index: p.index,
				total: Math.max(p.total, p.index),
				channel
			});
		}
		if (p.state === "stopped") return t$1("queue", "status_stopped");
		if (p.state === "paused" && p.hold_reason) return t$1("queue", `status_paused_${p.hold_reason}`, { count: 20 });
		return t$1("queue", "status_idle", {
			done: p.done,
			failed: p.failed
		});
	}
	async function writeProgress(p) {
		const full = {
			...p,
			message: messageFor(p)
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
	async function originTab() {
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
	async function closeAndRestore(tabId, originId, closedByUser) {
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
				if (tabId !== null) await closeAndRestore(tabId, originId, false);
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
			const origin = await originTab();
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
			const keepalive = setInterval(() => void getInfo?.call(chrome.runtime)?.catch?.(() => void 0), KEEPALIVE_MS);
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
				await closeAndRestore(tabId, origin?.tabId ?? null, userClosed);
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
				const loaded = await Promise.race([waitTabLoaded(tabId, prevUrl, opts.tabLoadTimeoutMs ?? TAB_LOAD_TIMEOUT_MS), untilClosed]);
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
				const deadline = Date.now() + (opts.readyTimeoutMs ?? READY_TIMEOUT_MS);
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
						await new Promise((r) => setTimeout(r, READY_RETRY_MS));
					}
				} finally {
					clearTimeout(timer);
				}
			} finally {
				chrome.tabs.onRemoved.removeListener(onRemoved);
			}
		}
		return {
			MODULE: MODULE$1,
			ROUTES: ROUTES$1,
			REAL_ROUTES: REAL_ROUTES$1,
			MESSAGES,
			register,
			async idle() {
				while (busy.size) await Promise.allSettled([...busy]);
			}
		};
	}
	createQueueModule();
	// extension/src/content/unsubscribe.ts
	var MODULE = "content/unsubscribe";
	/** the results go to the server through background/queue */
	var ROUTES = [];
	var REAL_ROUTES = [];
	var QUEUE_OVERLAY_TAG = "tube-queue-overlay";
	var DEFAULT_TIMEOUTS = {
		ready: 2e4,
		dialog: 6e3,
		verify: 1e4
	};
	var CHANNEL_ID = /^UC[\w-]{22}$/;
	var fail = (error) => ({
		status: "failed",
		error
	});
	var done = (note = null) => ({
		status: "done",
		error: note
	});
	/** `UC…` from a `https://www.youtube.com/channel/UC…` URL (or relative); null for anything else. */
	function channelIdFromUrl(url) {
		if (!url) return null;
		try {
			const u = new URL(url, "https://www.youtube.com");
			if (u.hostname !== "www.youtube.com" && u.hostname !== "youtube.com" && u.hostname !== "m.youtube.com") return null;
			const m = /^\/channel\/(UC[\w-]{22})(?:\/|$)/.exec(u.pathname);
			return m ? m[1] : null;
		} catch {
			return null;
		}
	}
	var DATA_MARKERS = [
		"var ytInitialData = ",
		"window[\"ytInitialData\"] = ",
		"window['ytInitialData'] = ",
		"ytInitialData = "
	];
	/** Cuts out the JSON object starting at `start`, respecting strings and escapes. */
	function sliceJsonObject(text, start) {
		if (text[start] !== "{") return null;
		let depth = 0;
		let inStr = false;
		for (let i = start; i < text.length; i++) {
			const c = text[i];
			if (inStr) {
				if (c === "\\") i++;
				else if (c === "\"") inStr = false;
				continue;
			}
			if (c === "\"") inStr = true;
			else if (c === "{") depth++;
			else if (c === "}") {
				depth--;
				if (depth === 0) return text.slice(start, i + 1);
			}
		}
		return null;
	}
	function readInitialData(doc) {
		for (const s of Array.from(doc.querySelectorAll("script:not([src])"))) {
			const text = s.textContent ?? "";
			for (const marker of DATA_MARKERS) {
				const idx = text.indexOf(marker);
				if (idx === -1) continue;
				const json = sliceJsonObject(text, idx + marker.length);
				if (!json) continue;
				try {
					const v = JSON.parse(json);
					if (v && typeof v === "object") return v;
				} catch {}
			}
		}
		return null;
	}
	var dig = (o, ...path) => path.reduce((acc, k) => acc && typeof acc === "object" ? acc[k] : void 0, o);
	/**
	* Channel ids the page claims to be itself. Only sources that describe **the page** (never a bare `channelId`, which
	* shows up in shelves of other channels). Sources that disagree all show up: the caller refuses.
	*/
	function readPageChannelIds(doc) {
		const ids = /* @__PURE__ */ new Set();
		const add = (v) => {
			if (v && CHANNEL_ID.test(v)) ids.add(v);
		};
		for (const l of Array.from(doc.querySelectorAll("link[rel=\"canonical\"]"))) add(channelIdFromUrl(l.getAttribute("href")));
		for (const m of Array.from(doc.querySelectorAll("meta[property=\"og:url\"]"))) add(channelIdFromUrl(m.getAttribute("content")));
		for (const m of Array.from(doc.querySelectorAll("meta[itemprop=\"identifier\"], meta[itemprop=\"channelId\"]"))) add(m.getAttribute("content"));
		const data = readInitialData(doc);
		if (data) {
			const ext = dig(data, "metadata", "channelMetadataRenderer", "externalId");
			if (typeof ext === "string") add(ext);
			const canon = dig(data, "microformat", "microformatDataRenderer", "urlCanonical");
			if (typeof canon === "string") add(channelIdFromUrl(canon));
		}
		return [...ids];
	}
	var LOGGED_OUT_DOM = "ytd-background-promo-renderer, a[href*=\"accounts.google.com/ServiceLogin\"], a[href*=\"accounts.google.com/v3/signin\"]";
	/** `in` (ytcfg LOGGED_IN true), `out` (LOGGED_IN false or login promo/link), `unknown`. */
	function detectLogin(doc) {
		let flag = null;
		for (const s of Array.from(doc.querySelectorAll("script:not([src])"))) {
			const m = /"LOGGED_IN"\s*:\s*(true|false)/.exec(s.textContent ?? "");
			if (m) {
				flag = m[1] === "true";
				break;
			}
		}
		if (flag === false) return "out";
		if (doc.querySelector(LOGGED_OUT_DOM)) return "out";
		return flag === true ? "in" : "unknown";
	}
	/** Captcha/challenge/consent in place of the channel page. */
	function detectChallenge(doc, url) {
		if (url && (/^https:\/\/(www\.)?google\.[a-z.]+\/sorry\//.test(url) || /^https:\/\/www\.youtube\.com\/sorry\b/.test(url) || /^https:\/\/consent\./.test(url))) return true;
		return doc.querySelector("form#captcha-form, form[action*=\"/sorry/\"], iframe[src*=\"recaptcha\"], .g-recaptcha, #recaptcha") !== null;
	}
	/** Visible: no `hidden`, `aria-hidden="true"` or `display:none` on the element itself or above it. */
	function isShown(el) {
		for (let cur = el; cur; cur = cur.parentElement) {
			if (cur.hasAttribute("hidden") || cur.getAttribute("aria-hidden") === "true") return false;
			const style = cur.style;
			if (style?.display === "none" || style?.visibility === "hidden") return false;
			const view = cur.ownerDocument?.defaultView;
			if (view && cur instanceof view.HTMLElement) {
				const cs = view.getComputedStyle(cur);
				if (cs.display === "none" || cs.visibility === "hidden") return false;
			}
		}
		return el !== null;
	}
	/** Roots of the channel header (new and classic layout). Buttons outside them (shelves) do not count. */
	var HEADER_ROOTS = "#page-header, yt-page-header-renderer, ytd-c4-tabbed-header-renderer, #channel-header-container";
	var SUB_CONTAINERS = "ytd-subscribe-button-renderer, yt-subscribe-button-view-model";
	/** Subscribe button of the channel header, or null. */
	function findSubscribeButton(doc) {
		for (const root of Array.from(doc.querySelectorAll(HEADER_ROOTS))) {
			if (!isShown(root)) continue;
			for (const box of Array.from(root.querySelectorAll(SUB_CONTAINERS))) {
				if (!isShown(box)) continue;
				const btn = box.querySelector("button");
				if (btn && isShown(btn)) return btn;
			}
		}
		return null;
	}
	/**
	* Button shape classes, old and current naming. The live page (Nov 2026) renders the spec-button classes in camelCase
	* (`ytSpecButtonShapeNextFilled` on the signed-out "Subscribe"); the `yt-spec-button-shape-next--*` names are gone.
	*/
	var SHAPE_SUBSCRIBED = ["yt-spec-button-shape-next--tonal", "ytSpecButtonShapeNextTonal"];
	var SHAPE_NOT_SUBSCRIBED = ["yt-spec-button-shape-next--filled", "ytSpecButtonShapeNextFilled"];
	/** State from the `subscribed` attribute (classic layout) or the button shape (tonal subscribed, filled not). */
	function subscriptionState(button) {
		const box = button.closest(SUB_CONTAINERS);
		if (button.hasAttribute("subscribed") || box?.hasAttribute("subscribed") || box?.querySelector("[subscribed]")) return "subscribed";
		const cls = button.classList;
		if (SHAPE_SUBSCRIBED.some((c) => cls.contains(c))) return "subscribed";
		if (SHAPE_NOT_SUBSCRIBED.some((c) => cls.contains(c))) return "not_subscribed";
		return "unknown";
	}
	var DIALOGS = "tp-yt-paper-dialog, yt-confirm-dialog-renderer, yt-dialog-view-model, [role=\"dialog\"], dialog";
	var MENUS = "tp-yt-iron-dropdown, ytd-menu-popup-renderer, yt-sheet-view-model, yt-contextual-sheet-layout, [role=\"menu\"], [role=\"listbox\"]";
	var MENU_ITEMS = "ytd-menu-service-item-renderer, yt-list-item-view-model, tp-yt-paper-item, [role=\"menuitem\"], [role=\"option\"]";
	function confirmButtonIn(dialog) {
		const direct = dialog.querySelector("#confirm-button button, #confirm-button [role=\"button\"], [slot=\"primaryAction\"] button");
		if (direct && isShown(direct)) return direct;
		const vm = dialog.matches("yt-dialog-view-model") ? dialog : dialog.querySelector("yt-dialog-view-model");
		if (vm) {
			const btns = Array.from(vm.querySelectorAll("[class*=\"dialog-view-model\"][class*=\"buttons\"] button")).filter(isShown);
			if (btns.length >= 2) return btns[btns.length - 1];
		}
		return null;
	}
	var shownSet = (doc, sel) => new Set(Array.from(doc.querySelectorAll(sel)).filter(isShown));
	var normText = (s) => (s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
	/** Header elements that carry the channel's name (new and classic layout). */
	var NAME_NODES = `${HEADER_ROOTS.split(",").map((r) => `${r.trim()} h1, ${r.trim()} #channel-name #text`).join(", ")}, yt-page-header-renderer yt-dynamic-text-view-model`;
	/**
	* The channel's name as the page shows it (header, `og:title`/`itemprop=name`, `<title>`, `ytInitialData`). The
	* unsubscribe confirmation always names the channel, in any language; a survey or promotion does not. Names shorter
	* than 2 characters are ignored (too easy to find by chance).
	*/
	function pageChannelNames(doc) {
		const names = /* @__PURE__ */ new Set();
		const add = (v) => {
			const n = normText(v);
			if (n.length >= 2 && n.length <= 200) names.add(n);
		};
		for (const el of Array.from(doc.querySelectorAll(NAME_NODES))) add(el.textContent);
		add(doc.querySelector("meta[property=\"og:title\"]")?.getAttribute("content"));
		add(doc.querySelector("meta[itemprop=\"name\"]")?.getAttribute("content"));
		const title = doc.querySelector("title")?.textContent ?? "";
		if (/ - YouTube\s*$/.test(title)) add(title.replace(/ - YouTube\s*$/, ""));
		for (const s of Array.from(doc.querySelectorAll("script:not([src])"))) {
			const m = /"channelMetadataRenderer"\s*:\s*\{\s*"title"\s*:\s*("(?:[^"\\]|\\.){1,400}")/.exec(s.textContent ?? "");
			if (!m) continue;
			try {
				add(JSON.parse(m[1]));
			} catch {}
			break;
		}
		return [...names];
	}
	/**
	* confirm button of a dialog that **appeared after** our click **and names the channel** (`names`). Any other
	* dialog (survey, Premium promotion, "still watching?") is never clicked: the caller fails with `confirm_not_found`.
	*/
	function newConfirm(doc, before, names) {
		if (!names.length) return null;
		for (const d of Array.from(doc.querySelectorAll(DIALOGS))) {
			if (before.has(d) || !isShown(d)) continue;
			const text = normText(d.textContent);
			if (!names.some((n) => text.includes(n))) continue;
			const b = confirmButtonIn(d);
			if (b) return b;
		}
		return null;
	}
	/**
	* Labels of the unsubscribe menu item (whole text, lowercase NFKC), when YouTube renders it without the icon name:
	* en, pt, es, fr, de, it (escaped: source files stay ASCII).
	*/
	var UNSUBSCRIBE_LABELS = /* @__PURE__ */ new Set([
		"unsubscribe",
		"cancelar inscrição",
		"cancelar inscripción",
		"anular suscripción",
		"se désabonner",
		"abo beenden",
		"annulla iscrizione"
	]);
	function isUnsubscribeItem(el) {
		if (Array.from(el.querySelectorAll("[icon]")).some((i) => /person_minus|unsubscribe/i.test(i.getAttribute("icon") ?? ""))) return true;
		return UNSUBSCRIBE_LABELS.has(normText(el.textContent));
	}
	/**
	* unsubscribe item of a menu that **appeared after** our click: the one with the unsubscribe icon (or its exact
	* label). No such item → `null` (the caller fails with `confirm_not_found`): never "the last item" of a menu.
	*/
	function newMenuItem(doc, before) {
		for (const m of Array.from(doc.querySelectorAll(MENUS))) {
			if (before.has(m) || !isShown(m)) continue;
			const all = Array.from(m.querySelectorAll(MENU_ITEMS)).filter(isShown);
			const pick = all.filter((el) => !all.some((o) => o !== el && o.contains(el))).find(isUnsubscribeItem);
			if (!pick) continue;
			return (pick.matches("tp-yt-paper-item, [role=\"menuitem\"], [role=\"option\"]") ? pick : pick.querySelector("tp-yt-paper-item, [role=\"menuitem\"], [role=\"option\"], button")) ?? pick;
		}
		return null;
	}
	/** Waits for `probe` to return something (on every DOM mutation and every 100 ms), until the deadline or the abort. Never waits blindly. */
	function waitUntil(doc, probe, ms, signal) {
		const first = probe();
		if (first) return Promise.resolve(first);
		if (signal.aborted) return Promise.resolve(null);
		return new Promise((resolve) => {
			let finished = false;
			const finish = (v) => {
				if (finished) return;
				finished = true;
				obs.disconnect();
				clearInterval(poll);
				clearTimeout(timer);
				signal.removeEventListener("abort", onAbort);
				resolve(v);
			};
			const check = () => {
				try {
					const v = probe();
					if (v) finish(v);
				} catch {}
			};
			const onAbort = () => finish(null);
			const obs = new MutationObserver(check);
			obs.observe(doc.documentElement, {
				childList: true,
				subtree: true,
				attributes: true
			});
			const poll = setInterval(check, 100);
			const timer = setTimeout(() => finish(null), ms);
			signal.addEventListener("abort", onAbort);
		});
	}
	var CSS = `
:host {
  all: initial !important;
  display: block !important;
  position: fixed !important;
  z-index: 2147483647 !important;
  left: 50% !important;
  bottom: 24px !important;
  transform: translateX(-50%) !important;
  color-scheme: light dark !important;
  pointer-events: auto !important;
}
.card {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: min(560px, calc(100vw - 32px));
  padding: 12px 16px;
  border: 1px solid GrayText;
  border-radius: 10px;
  background: Canvas;
  color: CanvasText;
  box-shadow: 0 4px 18px color-mix(in srgb, CanvasText 22%, transparent);
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  text-align: left;
}
.dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: currentColor; opacity: 0.6; animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.15; } }
.text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.title { font-weight: 600; }
.progress { font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.note { font-size: 12px; opacity: 0.8; }
button { flex: none; font: inherit; padding: 4px 12px; border: 1px solid ButtonBorder; border-radius: 6px; background: ButtonFace; color: ButtonText; cursor: pointer; }
button:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
button:disabled { cursor: default; opacity: 0.6; }
@media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
`;
	/** Notice "unsubscribing 2 of 5 · <channel> · Stop". Text only via `textContent` (the channel title is not HTML). */
	function showQueueOverlay(doc, req, onStop) {
		const view = doc.defaultView ?? window;
		for (const old of Array.from(doc.querySelectorAll(QUEUE_OVERLAY_TAG))) old.remove();
		const host = doc.createElement(QUEUE_OVERLAY_TAG);
		const root = host.attachShadow({ mode: "open" });
		const style = doc.createElement("style");
		style.textContent = CSS;
		const card = doc.createElement("div");
		card.className = "card";
		card.setAttribute("role", "status");
		card.setAttribute("aria-live", "polite");
		const dot = doc.createElement("span");
		dot.className = "dot";
		dot.setAttribute("aria-hidden", "true");
		const text = doc.createElement("div");
		text.className = "text";
		const title = doc.createElement("span");
		title.className = "title";
		title.textContent = t$1("queue", `overlay_title_${req.action}`);
		const progress = doc.createElement("span");
		progress.className = "progress";
		progress.dataset.role = "progress";
		const channel = typeof req.channel_title === "string" && req.channel_title || req.channel_id || "";
		const index = Number.isFinite(req.index) ? Number(req.index) : 1;
		const total = Math.max(index, Number.isFinite(req.total) ? Number(req.total) : 1);
		progress.textContent = t$1("queue", `progress_${req.action}`, {
			index,
			total,
			channel
		});
		const note = doc.createElement("span");
		note.className = "note";
		note.textContent = t$1("queue", "overlay_note");
		text.append(title, progress, note);
		const button = doc.createElement("button");
		button.type = "button";
		button.textContent = t$1("queue", "overlay_stop");
		button.setAttribute("aria-keyshortcuts", "Escape");
		card.append(dot, text, button);
		root.append(style, card);
		let stopped = false;
		let removed = false;
		const stop = () => {
			if (stopped || removed) return;
			stopped = true;
			button.disabled = true;
			progress.textContent = t$1("queue", "overlay_stopped");
			try {
				onStop();
			} catch (e) {
				console.warn("[tube] queue overlay: onStop failed", e);
			}
		};
		const onKey = (e) => {
			if (e.key !== "Escape" || removed) return;
			e.preventDefault();
			e.stopPropagation();
			stop();
		};
		button.addEventListener("click", stop);
		view.addEventListener("keydown", onKey, true);
		(doc.body ?? doc.documentElement).append(host);
		return {
			status(s) {
				if (!removed && !stopped) progress.textContent = s;
			},
			remove() {
				if (removed) return;
				removed = true;
				view.removeEventListener("keydown", onKey, true);
				host.remove();
			}
		};
	}
	/** Runs a queue item on this page. Never throws; when in doubt, `failed` without clicking. */
	async function executeQueueItem(req, opts = {}) {
		const doc = opts.doc ?? document;
		const url = opts.url ?? doc.defaultView?.location?.href ?? "";
		const tmo = {
			...DEFAULT_TIMEOUTS,
			...opts.timeouts
		};
		const ctrl = new AbortController();
		const signal = ctrl.signal;
		if (!req || req.action !== "unsubscribe" && req.action !== "resubscribe") return fail("invalid_item");
		const fromUrl = channelIdFromUrl(req.channel_url);
		const fromId = typeof req.channel_id === "string" && CHANNEL_ID.test(req.channel_id) ? req.channel_id : null;
		if (req.channel_id !== void 0 && !fromId || fromId && fromUrl && fromId !== fromUrl) return fail("invalid_item");
		const expected = fromId ?? fromUrl;
		if (!expected) return fail("invalid_item");
		const overlay = opts.overlay === false ? null : showQueueOverlay(doc, req, () => {
			ctrl.abort();
			requestQueueStop("overlay").catch(() => void 0);
		});
		const channel = typeof req.channel_title === "string" && req.channel_title || expected;
		let result;
		try {
			result = await run(doc, url, req.action, expected, tmo, signal);
		} catch (e) {
			console.warn("[tube] queue.execute failed", errorMessage(e));
			result = signal.aborted ? fail("stopped") : fail("page_error");
		}
		overlay?.status(t$1("queue", result.status === "done" ? "overlay_result_done" : "overlay_result_failed", {
			channel,
			reason: t$1("queue", `reason_${result.error ?? "none"}`)
		}));
		return result;
	}
	async function run(doc, url, action, expected, tmo, signal) {
		if (/^https:\/\/accounts\.google\.com\//.test(url)) return fail("logged_out");
		if (detectChallenge(doc, url)) return fail("challenge");
		const urlId = channelIdFromUrl(url);
		if (urlId && urlId !== expected) return fail("wrong_channel");
		await waitUntil(doc, () => {
			if (detectLogin(doc) === "out" || detectChallenge(doc, url)) return true;
			const ids = readPageChannelIds(doc);
			if (!ids.length) return false;
			return ids.some((id) => id !== expected) || findSubscribeButton(doc) !== null;
		}, tmo.ready, signal);
		if (signal.aborted) return fail("stopped");
		if (detectLogin(doc) === "out") return fail("logged_out");
		if (detectChallenge(doc, url)) return fail("challenge");
		const ids = readPageChannelIds(doc);
		if (!ids.length || ids.some((id) => id !== expected)) return fail("wrong_channel");
		const button = findSubscribeButton(doc);
		if (!button) return fail("button_not_found");
		const state = subscriptionState(button);
		if (state === "unknown") return fail("button_not_found");
		const target = action === "unsubscribe" ? "not_subscribed" : "subscribed";
		if (state === target) return done(action === "unsubscribe" ? "not_subscribed" : "already_subscribed");
		const names = pageChannelNames(doc);
		const dialogsBefore = shownSet(doc, DIALOGS);
		const menusBefore = shownSet(doc, MENUS);
		if (signal.aborted) return fail("stopped");
		button.click();
		if (action === "unsubscribe") {
			const next = await waitUntil(doc, () => {
				const c = newConfirm(doc, dialogsBefore, names);
				if (c) return {
					kind: "confirm",
					el: c
				};
				const m = newMenuItem(doc, menusBefore);
				return m ? {
					kind: "menu",
					el: m
				} : null;
			}, tmo.dialog, signal);
			if (signal.aborted) return fail("stopped");
			if (!next) return fail("confirm_not_found");
			let confirm = next.kind === "confirm" ? next.el : null;
			if (next.kind === "menu") {
				const before = shownSet(doc, DIALOGS);
				next.el.click();
				confirm = await waitUntil(doc, () => newConfirm(doc, before, names), tmo.dialog, signal);
				if (signal.aborted) return fail("stopped");
				if (!confirm) return fail("confirm_not_found");
			}
			if (signal.aborted) return fail("stopped");
			confirm.click();
		}
		const never = new AbortController().signal;
		return await waitUntil(doc, () => {
			const b = findSubscribeButton(doc);
			return b !== null && subscriptionState(b) === target;
		}, tmo.verify, never) ? done() : fail("state_unchanged");
	}
	// extension/src/content/bootstrap.ts
	startContent({ modules: [
		sidebar,
		thumbs,
		home,
		scraper,
		tracker,
		{
			MODULE,
			ROUTES,
			REAL_ROUTES,
			COMMANDS: ["queue.execute"],
			/** never attaches on its own: only the background command (item coming from `GET /ext/queue`) */
			matches: () => false,
			start() {},
			commands: { "queue.execute": (payload) => executeQueueItem(payload) }
		},
		searchContent
	] }).catch((e) => console.warn("[tube] content bootstrap failed", e));
})();
