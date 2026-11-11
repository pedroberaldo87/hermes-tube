# tests/fixtures — páginas salvas (unidade area-40)

Pasta **só leitura** para as outras unidades (fixture nova fica no próprio arquivo de teste).
Conferir: `python -I tests/fixtures/verify_fixtures.py` (sai 0 se tudo ok; só biblioteca padrão, sem rede).

## Como foi capturado

Tudo o que é "real" foi baixado em **2026-11-09** (horários em UTC), **sem login, sem cookie, sem perfil de
navegador**, com:

```
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
curl -sS -L --compressed -A "$UA" -H 'Accept-Language: en-US,en;q=0.9' -o <arquivo> '<URL>'
```

Na tabela, "padrão" = esse comando. Para `/shorts/` foi `curl -sI` **sem** `-L` (comando no topo de cada `.txt`;
valores de `set-cookie` trocados por `<redacted>`). As páginas do YouTube contêm `ytcfg` com `visitorData`
anônimo gerado na hora (não é credencial de conta).

Sintético = escrito à mão ou gerado por script desta pasta, **no formato do MyTube v0.9.0**
(`ref/mytube`, fora do git); o cabeçalho de cada arquivo cita os arquivo:linha usados.

## Arquivos

| arquivo | origem | captura (UTC) | comando | o que testa | consumidores |
|---|---|---|---|---|---|
| `youtube/rss/veritasium.xml` | https://www.youtube.com/feeds/videos.xml?channel_id=UCHnyfMqiRRG1u-2MsSQLbXA | 2026-11-09T19:11:05Z | padrão | RSS Atom, 15 `<entry>`, `media:description` longas (até 4.899 caracteres) e **10 Shorts** (link `/shorts/<id>` na `<entry>`) | area-youtube, area-status |
| `youtube/rss/fireship.xml` | https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA | 2026-11-09T19:11:06Z | padrão | RSS de canal só com vídeos normais (0 Shorts nos 15), descrições curtas | area-youtube, area-status |
| `youtube/search/en-rust-programming.relevance.html` | https://www.youtube.com/results?hl=en&gl=US&search_query=rust+programming | 2026-11-09T19:11:18Z | padrão | busca por relevância (EN): `ytInitialData`, 17 `videoRenderer` + 25 `shortsLockupViewModel` + 3 `lockupViewModel` | area-youtube, area-29 |
| `youtube/search/en-rust-programming.date.html` | https://www.youtube.com/results?hl=en&gl=US&search_query=rust+programming&sp=CAI%253D | 2026-11-09T19:11:19Z | padrão | busca ordenada por data (`sp=CAI%3D`) | area-youtube, area-29 |
| `youtube/search/en-rust-programming.videos.html` | https://www.youtube.com/results?hl=en&gl=US&search_query=rust+programming&sp=EgIQAQ%253D%253D | 2026-11-09T19:11:20Z | padrão | filtro "só vídeos" (`sp=EgIQAQ==`): 20 `videoRenderer`, nenhum Short | area-youtube, area-29 |
| `youtube/search/en-rust-programming.week.html` | https://www.youtube.com/results?hl=en&gl=US&search_query=rust+programming&sp=EgQIAxAB | 2026-11-09T19:15:54Z | padrão | filtro "esta semana + só vídeos" (`sp=EgQIAxAB`), extra | area-youtube, area-29 |
| `youtube/search/pt-receita-de-pao-caseiro.relevance.html` | https://www.youtube.com/results?hl=en&gl=US&search_query=receita+de+p%C3%A3o+caseiro | 2026-11-09T19:11:21Z | padrão | busca em PT com interface EN: 14 `videoRenderer`, 40 Shorts, 1 `channelRenderer` | area-youtube, area-29 |
| `youtube/search/pt-receita-de-pao-caseiro.relevance.pt-BR.html` | https://www.youtube.com/results?hl=pt-BR&gl=BR&search_query=receita+de+p%C3%A3o+caseiro | 2026-11-09T21:35:42Z | padrão, mas com `-H 'Accept-Language: pt-BR,pt;q=0.9'` | mesma busca com interface em português (`HL=pt`, `GL=BR`): "há 6 anos", "10.472.419 visualizações" | area-youtube, area-29 |
| `youtube/search/pt-receita-de-pao-caseiro.week.html` | https://www.youtube.com/results?hl=en&gl=US&search_query=receita+de+p%C3%A3o+caseiro&sp=EgQIAxAB | 2026-11-09T19:15:55Z | padrão | busca PT, "esta semana + só vídeos" (ordem recente) | area-youtube, area-29 |
| `youtube/channel/handle.Fireship.html` | https://www.youtube.com/@Fireship?hl=en&gl=US | 2026-11-09T19:15:57Z | padrão | resolver canal por `@handle` → `metadata.channelMetadataRenderer.externalId` | area-youtube, area-channels |
| `youtube/channel/channel-id.UCsBjURrPoezykLs9EqgamOA.html` | https://www.youtube.com/channel/UCsBjURrPoezykLs9EqgamOA?hl=en&gl=US | 2026-11-09T19:15:57Z | padrão | resolver canal por `/channel/UC…` | area-youtube, area-channels |
| `youtube/channel/c.Fireship.html` | https://www.youtube.com/c/Fireship?hl=en&gl=US | 2026-11-09T19:15:58Z | padrão | `/c/<nome>` que **ainda resolve** (200, mesma página do canal) | area-youtube, area-channels |
| `youtube/channel/c.kurzgesagt.404.html` | https://www.youtube.com/c/kurzgesagt?hl=en&gl=US | 2026-11-09T19:15:58Z | padrão | `/c/<nome>` que **não resolve**: resposta real 404 (755 bytes, sem `ytInitialData`) | area-youtube, area-channels |
| `youtube/watch/normal.KfODG5REyss.html` | https://www.youtube.com/watch?v=KfODG5REyss&hl=en&gl=US | 2026-11-09T19:15:25Z | padrão | vídeo normal: `ytInitialPlayerResponse.videoDetails` (`lengthSeconds=3955`, `isLiveContent=false`) | area-youtube |
| `youtube/watch/live-now.ROboUHfPUrU.html` | https://www.youtube.com/watch?v=ROboUHfPUrU&hl=en&gl=US | 2026-11-09T19:15:37Z | padrão | **ao vivo agora** (NASA ISS): `liveBroadcastDetails.isLiveNow=true`, `lengthSeconds=0` | area-youtube |
| `youtube/watch/live-ended.jfKfPfyJRdk.html` | https://www.youtube.com/watch?v=jfKfPfyJRdk&hl=en&gl=US | 2026-11-09T19:15:26Z | padrão | **transmissão encerrada** (lofi girl): `isLiveNow=false` + `endTimestamp`, `playabilityStatus=UNPLAYABLE` | area-youtube |
| `youtube/watch/upcoming.9XM0lpVlvo0.html` | https://www.youtube.com/watch?v=9XM0lpVlvo0&hl=en&gl=US | 2026-11-09T19:15:27Z | padrão | **transmissão agendada** (não é estreia/Premiere — ver nota): `isUpcoming=true`, `startTimestamp=2026-11-13T16:45:00+00:00`, `LIVE_STREAM_OFFLINE` | area-youtube |
| `youtube/shorts/short.rL0qEmTRI-I.txt` | https://www.youtube.com/shorts/rL0qEmTRI-I | 2026-11-09T19:16:15Z | `curl -sI` (no arquivo) | `/shorts/<id>` de um Short → **HTTP 200** | area-youtube, area-feed |
| `youtube/shorts/normal.KfODG5REyss.txt` | https://www.youtube.com/shorts/KfODG5REyss | 2026-11-09T19:16:16Z | `curl -sI` (no arquivo) | `/shorts/<id>` de vídeo normal → **HTTP 303**, `location: https://www.youtube.com/watch?v=KfODG5REyss` | area-youtube, area-feed |
| `hackertube/videos.sample.jsonl` | https://hackertube.org/download/hackertube-data.zip → `videos.jsonl` | 2026-11-09T19:17Z | padrão (zip) + extração; `head -200 videos.jsonl` | 200 primeiras linhas (melhor score primeiro), JSON por linha com `vid`, `title`, `channel`, `why_hn`, `categories`… | area-extras |
| `hackertube/DATA.md` | mesmo zip | 2026-11-09T19:17Z | cópia sem alteração | dicionário de campos do dataset (export de 2026-10-31) | area-extras |
| `hackertube/api-export.json` | https://hackertube.org/api/export | 2026-11-09T19:17Z | padrão (JSON reindentado) | manifesto do dataset: nome/tamanho do zip e de cada arquivo | area-extras |
| `hackertube/LICENSE-NOTE.md` | sintético (texto) | 2026-11-09 | — | crédito e licença ODC-By 1.0 do HackerTube | area-extras |
| `lists/hn-ask-youtube-channels-intellectually-curious.32220192.html` | https://news.ycombinator.com/item?id=32220192 | 2026-11-09T19:18:18Z | padrão | "Ask HN: YouTube Channels for the Intellectually Curious": 316 comentários, 537 menções a `youtube.com`, só a 1ª página da thread | area-lists |
| `mytube/mytube-backup-2026-11-09.json` | **sintético, formato do MyTube v0.9.0** | gerado 2026-11-09 | `python -I tests/fixtures/mytube/make_export.py` | export da barra lateral `{version:1, exportedAt, state, watchHistory}`: 15 canais, 3 pastas aninhadas (Ciência › Espaço › Lançamentos), 4 tags | area-data |
| `mytube/mytube-backup-2026-11-09.dashboard.json` | **sintético, formato do MyTube v0.9.0** | gerado 2026-11-09 | idem | export da página de opções `{...state, watchHistory}` (achatado), mesmo conteúdo | area-data |
| `mytube/make_export.py` | sintético (gerador) | — | — | gera os dois exports; cita `ExportImport.tsx:50-66`, `Settings.tsx:35-48`, `background/index.ts:228-231`, `shared/types.ts:14-50`, `storage.ts`, `db.ts:151-154` | area-data |
| `mytube/youtube-channel-videos.html` | cópia de `ref/mytube/test/fixtures/youtube-channel-videos.html` (página real `@Fireship/videos` reduzida a 3 itens pelo MyTube) | copiado 2026-11-09 | `cp` | `ytInitialData` → `richGridRenderer` → `richItemRenderer` → `lockupViewModel` de vídeo | area-youtube, area-26 |
| `mytube/feed-channels.synthetic.html` | **sintético, formato do MyTube v0.9.0** (`/feed/channels` real exige login) | gerado 2026-11-09 | `python -I tests/fixtures/mytube/make_feed_channels.py` | `ytInitialData` com `channelRenderer` (6 + 1 duplicado), `gridChannelRenderer` (2), `lockupViewModel` (2) + DOM coerente | area-26, area-state |
| `mytube/feed-channels.dom-only.synthetic.html` | **sintético, formato do MyTube v0.9.0** | gerado 2026-11-09 | idem | só DOM, sem `ytInitialData` → caminho de fallback do scraper | area-26, area-state |
| `mytube/make_feed_channels.py` | sintético (gerador) | — | — | gera as duas páginas de `/feed/channels`; cita `scraper.ts` e `selectors.ts` | area-26, area-state |
| `mytube/subscribe-button.synthetic.html` | **sintético, formato do MyTube v0.9.0** (botão "Inscrito" real exige login) | escrito 2026-11-09 | à mão | estados do botão (não inscrito, inscrito clássico, inscrito layout novo EN/PT-BR), menu com "Unsubscribe" e diálogo de confirmação aberto/oculto, um por `<section data-fixture-state>` | area-28 |

## Seletores do MyTube reproduzidos nas páginas sintéticas

`/feed/channels` (`feed-channels*.synthetic.html`):

- `ref/mytube/src/content/scraper.ts:340-372` — `ytInitialData` lido de `<script>` inline pelos marcadores
  `var ytInitialData = ` / `window["ytInitialData"] = `, recorte por contagem de chaves (por isso nenhuma string do
  JSON sintético contém `{` ou `}`)
- `scraper.ts:101-128` — busca recursiva (profundidade ≤ 20) por `gridChannelRenderer`, `channelRenderer`, `lockupViewModel`
- `scraper.ts:130-221` — campos lidos de cada renderer; `scraper.ts:250-253` — dedup por `channelId`
- `scraper.ts:269-302` + `ref/mytube/src/shared/selectors.ts:15-18` — fallback DOM:
  `subscriptionItem` = `ytd-channel-renderer, ytd-grid-channel-renderer, ytd-rich-item-renderer:has(ytd-channel-renderer), yt-lockup-view-model`;
  `subscriptionItemName` = `#channel-info #text, #info #text, .yt-lockup-metadata-view-model-wiz__title`;
  `subscriptionItemLink` = `#channel-info a, #main-link, a.yt-lockup-metadata-view-model-wiz__title`;
  `subscriptionItemAvatar` = `#avatar img, #img img, .yt-lockup-view-model-wiz__content-image img`

Botão de inscrição e cancelamento (`subscribe-button.synthetic.html`):

- `ref/mytube/src/content/unsubscribe.ts:103-106` — container `ytd-subscribe-button-renderer, yt-subscribe-button-view-model`
- `unsubscribe.ts:112` — `container.querySelector('button')`
- `unsubscribe.ts:118-122` — inscrito se `button[subscribed]`, `aria-label` contém `unsubscribe`/`inscrit`,
  `container[subscribed]` ou `container [subscribed]`
- `unsubscribe.ts:131-134` — diálogo `tp-yt-paper-dialog:not([aria-hidden="true"]), yt-confirm-dialog-renderer, ytd-popup-container tp-yt-paper-dialog`
- `unsubscribe.ts:137-139` — confirmar `#confirm-button button, #confirm-button yt-button-renderer button, [slot="primaryAction"] button`
- `unsubscribe.ts:149-163` — menu `tp-yt-paper-item, ytd-menu-service-item-renderer, tp-yt-paper-listbox tp-yt-paper-item` com
  texto `unsubscribe` / `cancelar inscri` / `desinscrever`; `unsubscribe.ts:165-168` — confirmação após o menu
- `ref/mytube/src/shared/selectors.ts:9` — `channelSubscribeButton` = `#subscribe-button, ytd-subscribe-button-renderer`;
  `ref/mytube/src/content/injector.ts:588-593` — âncoras `#inner-header-container`, `#channel-header-container`,
  `.page-header-view-model-wiz__page-header-headline`

O MyTube consulta `document`; nos testes, escopar a consulta à `<section data-fixture-state="…">` desejada.

## Notas

- **Estreia (Premiere):** não encontrada. Procurei em buscas ordenadas por data ("premiere official video",
  "trailer premiere"…) e em `/videos` de 18 canais (música, K-pop, ciência); nenhum vídeo com selo
  "Premiere"/`upcomingEventData` sem login. Fica a transmissão agendada `upcoming.9XM0lpVlvo0.html`, que tem
  o mesmo formato de "ainda não começou" (`isUpcoming`, `startTimestamp`, `LIVE_STREAM_OFFLINE`).
- **Idioma:** o parâmetro `hl=pt-BR` **não** basta — com `Accept-Language: en-US` o YouTube respondeu `HL=en`
  (só `gl=BR` pegou). A interface em português só veio com `Accept-Language: pt-BR` (resposta `HL=pt`).
- **`/c/<nome>`:** `/c/Fireship` ainda resolve (200); `/c/kurzgesagt` dá 404 real — as duas respostas estão salvas.
- **Sem login, o botão de inscrição** da página de canal real é um `buttonRenderer` "Subscribe" que abre o modal
  "Sign in to subscribe to this channel." — não há `subscribeButtonViewModel` nem estado "inscrito".
- Tamanho total ≈ 22 MB (< 25 MB); o zip do HackerTube, `mentions.jsonl` e `embeddings.npy` não são versionados.

### Página `/videos` do canal — plano B do RSS (area-44, 10/11/2026 UTC)
| Arquivo | Origem | Uso |
|---|---|---|
| `youtube/channel_videos.UCsBjURrPoezykLs9EqgamOA.html` | real (Fireship), só o `ytInitialData` enxuto | formato atual (`lockupViewModel`) |
| `youtube/channel_videos.UCHnyfMqiRRG1u-2MsSQLbXA.html` | real (Veritasium), só o `ytInitialData` enxuto | formato atual, datas relativas variadas |
| `youtube/channel_videos.legacy.synthetic.html` | **sintético** (cabeçalho do arquivo diz como) | formato antigo (`videoRenderer`/`gridVideoRenderer`) |
| `youtube/channel_videos.missing.UCzzzzzzzzzzzzzzzzzzzzzz.html` | real (canal inexistente, HTTP 404) | página 404 = canal não existe |

### Playlists de envios e página de Short — duração e tipo (area-8, 10/11/2026 UTC)
Comando padrão + `-b 'SOCS=CAI'`, `?list=<id>&hl=en`; só o que o parser lê (cabeçalho de cada arquivo diz URL e hora).
| Arquivo | Origem | Uso |
|---|---|---|
| `youtube/playlist/uploads.UUHnyfMqiRRG1u-2MsSQLbXA.html` | real (Veritasium, `UU…`, 17:19:35Z), 100 `lockupViewModel` | duração no selo **inclusive dos Shorts**; os 15 vídeos de `rss/veritasium.xml` estão nela |
| `youtube/playlist/shorts.UUSHHnyfMqiRRG1u-2MsSQLbXA.html` | real (Veritasium, `UUSH…`, 17:19:38Z), 95 `shortsLockupViewModel` | quem é Short (sem duração); os 10 Shorts do RSS estão nela |
| `youtube/playlist/uploads.UUsBjURrPoezykLs9EqgamOA.html` | real (Fireship, `UU…`, 17:19:40Z), 100 itens | canal só com vídeos > 5 min (os 15 do `rss/fireship.xml`) |
| `youtube/playlist/shorts.UUSHsBjURrPoezykLs9EqgamOA.html` | real (Fireship, `UUSH…`, 17:19:43Z), 48 itens | Shorts antigos do canal |
| `youtube/playlist/missing.UUSHXUPKJO5MZQN11PqgIvyuvQ.html` | real (Andrej Karpathy, `UUSH…`, ~17:05Z) | canal **sem Shorts**: HTTP 200 + `alerts` "The playlist does not exist." |
| `youtube/shorts/page.rL0qEmTRI-I.html` | real (`/shorts/rL0qEmTRI-I`, 17:19:45Z), só `ytInitialPlayerResponse.videoDetails` | Short: a página 200 traz `lengthSeconds` (86) |
