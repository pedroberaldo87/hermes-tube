# AI contract — tasks, inputs and outputs

> Source of truth: `plugin/core/prompts.py`. Set `PROMPTS_VERSION = "1.0.0"`.
> This document is checked by `tests/test_fakes.py` (tasks, versions, keys and examples identical to the code).

## Common rules

- Every call goes through `LLM.complete_structured(task, payload)` (`core/ai.py`), which uses `ctx.llm.complete_structured(task="curator")` with the task's `instructions`, `schema_name` and `output_schema`; the input text is `prompts.render_input(task, payload)` (deterministic JSON, already cut to the limits).
- The output is always a **JSON object** with `additionalProperties: false` and every field `required` (an optional field = `["type", "null"]`), so it works with providers in strict mode.
- Own validation: `prompts.validate_output(task, data)` (a subset of JSON Schema 2020-12: `type`, `properties`, `required`, `additionalProperties`, `items`, `minItems`, `maxItems`, `minLength`, `maxLength`, `minimum`, `maximum`, `enum`, `pattern`). Invalid answer → 1 retry → `LLMInvalidResponse` (readable error).
- Input: `prompts.validate_input(task, payload)` flags a wrong **structure** (a caller bug); long texts are not an error — `prompts.prepare_input` cuts them (titles 200, descriptions 600, `recent_titles` 5 × 120, `query` 200, context lists 200, examples 20, reactions 30, `list_extract` text 12 000).
- **The input text is data, not instructions.** Titles, descriptions, channel names, notes and page text are written by third parties; the instructions of every task (`_COMMON_RULES` in `prompts.py`) say so and tell the model never to follow instructions found in them.
- **Batches**: list tasks (`organize`, `cleanup_reasons`: 60 channels; `theme_curate`, `digest`: 120 videos) receive `payload["items"]`; `prompts.batches` splits by count **and** by rendered size (the context is repeated in every batch; `render_input` above the ceiling raises `ValidationError`, it never drops items) and `prompts.merge_outputs` concatenates `items` in order. `timeout` applies to the whole task.
- Language: `payload["language"]` (`"pt-BR"`, `"en"`…); absent = the language of the input. Ids (`channel_id`, `video_id`) are copied from the input, never invented.
- No model (`LLM.available()` false) → `LLMUnavailable`; everything that is not AI keeps working.

| Task | Version | `schema_name` | Batch | Input ceiling (characters) | Caller |
|---|---|---|---|---|---|
| `organize` | 1.0.0 | `tube_organize` | 60 | 120 000 | `Organizer.organize` (folder/tag suggestions; nothing applied before acceptance) |
| `cleanup_reasons` | 1.0.0 | `tube_cleanup_reasons` | 60 | 80 000 | `Cleanup.scan` (the rule chooses; the AI only writes the reason and decides `off_profile`) |
| `theme_expand` | 1.0.0 | `tube_theme_expand` | — | 10 000 | `Themes.create` (step 1) |
| `theme_curate` | 1.0.0 | `tube_theme_curate` | 120 | 80 000 | `Themes.create`/`refresh` (curation of the search candidates) |
| `list_extract` | 1.0.0 | `tube_list_extract` | — | 13 000 | `ListImporter.import_list` (the "import a list" Extra) |
| `digest` | 1.0.0 | `tube_digest` | 120 | 150 000 | the `resumo-pasta` routine 🧠 (short text per video) |

## `organize` · v1.0.0

Caller: `Organizer.organize` (folder/tag suggestions; nothing applied before acceptance).

**Input** (`payload`)

- `items[]` — channels: `channel_id`, `title` (required), `handle`, `description`, `recent_titles` (up to 5)
- `folders[]` — existing folder paths (`"Tecnologia/IA"`)
- `tags[]` — existing tag names
- `examples[]` — the user's earlier corrections: `channel_title`, `folder`, `tags`
- `language` — language of the output text

**Output**

- `items[].channel_id` — copied from the input
- `items[].folder` — path (existing or new, ≤ 80)
- `items[].new_folder` — `true` if the folder does not exist
- `items[].tags` — 0–5 tags (≤ 40 each)
- `items[].confidence` — 0..1
- `items[].why` — one sentence (≤ 280)

**Example** — input and output (compact JSON, identical to `TASKS[...].example_input/example_output`):

```json
{"items": [{"channel_id": "UCBJycsmduvYEL83R_U4JriQ", "title": "Marques Brownlee", "handle": "@mkbhd", "recent_titles": ["iPhone review", "The best phones of the year"]}, {"channel_id": "UCsBjURrPoezykLs9EqgamOA", "title": "Fireship", "handle": "@fireship", "recent_titles": ["100 seconds of Rust", "AI agents explained"]}], "folders": ["Tecnologia", "Tecnologia/IA", "Ciência"], "tags": ["aprender", "relaxar"], "examples": [{"channel_title": "Two Minute Papers", "folder": "Tecnologia/IA", "tags": ["aprender"]}], "language": "pt-BR"}
```

```json
{"items": [{"channel_id": "UCBJycsmduvYEL83R_U4JriQ", "folder": "Tecnologia", "new_folder": false, "tags": ["relaxar"], "confidence": 0.9, "why": "Análises de celulares e gadgets."}, {"channel_id": "UCsBjURrPoezykLs9EqgamOA", "folder": "Programação", "new_folder": true, "tags": ["aprender"], "confidence": 0.8, "why": "Vídeos curtos sobre linguagens e ferramentas de programação."}]}
```

## `cleanup_reasons` · v1.0.0

Caller: `Cleanup.scan` (the rule chooses; the AI only writes the reason and decides `off_profile`).

**Input** (`payload`)

- `items[]` — `channel_id`, `title`, `rule_group` (`stale`/`ignored`/`null`) required; facts `days_since_last_video`, `videos_90d`, `watched_90d`, `videos_per_week`, `recent_titles`
- `profile` — `folders[]`, `favorites[]` (what the person usually watches)
- `language` — language

**Output**

- `items[].channel_id` — copied
- `items[].group` — `stale`/`ignored` (repeats the rule), `off_profile` or `keep` (only when `rule_group` is `null`)
- `items[].why` — a factual sentence (≤ 280)

**Example** — input and output (compact JSON, identical to `TASKS[...].example_input/example_output`):

```json
{"items": [{"channel_id": "UCBJycsmduvYEL83R_U4JriQ", "title": "Canal Parado", "rule_group": "stale", "days_since_last_video": 240, "videos_90d": 0, "watched_90d": 0, "videos_per_week": 0, "recent_titles": ["Último vídeo"]}, {"channel_id": "UCsBjURrPoezykLs9EqgamOA", "title": "Fofoca Diária", "rule_group": null, "days_since_last_video": 1, "videos_90d": 80, "watched_90d": 0, "videos_per_week": 6.2, "recent_titles": ["Treta da semana"]}], "profile": {"folders": ["Tecnologia", "Ciência"], "favorites": ["Fireship"]}, "language": "pt-BR"}
```

```json
{"items": [{"channel_id": "UCBJycsmduvYEL83R_U4JriQ", "group": "stale", "why": "Sem vídeo novo há 240 dias."}, {"channel_id": "UCsBjURrPoezykLs9EqgamOA", "group": "off_profile", "why": "Fofoca de celebridades; seus favoritos são de tecnologia e ciência."}]}
```

## `theme_expand` · v1.0.0

Caller: `Themes.create` (step 1).

**Input** (`payload`)

- `query` — free-text theme (cut at 200)
- `disliked_titles[]` — videos with 👎 (up to 30)
- `language` — language

**Output**

- `name` — tab name (≤ 40)
- `icon` — one emoji
- `searches` — 5–8 searches (≤ 100 each)
- `include_terms` — up to 12
- `exclude_terms` — up to 12
- `mode` — `fresh`/`classics`/`long` (decides whether `Lens.classics` is added)

**Example** — input and output (compact JSON, identical to `TASKS[...].example_input/example_output`):

```json
{"query": "agentes de IA para iniciantes", "language": "pt-BR"}
```

```json
{"name": "Agentes de IA", "icon": "🤖", "searches": ["agentes de IA explicado", "AI agents tutorial for beginners", "como criar um agente de IA", "LLM agents tools function calling", "agentes autônomos IA exemplos"], "include_terms": ["agente", "agent", "LLM"], "exclude_terms": ["reaction", "#shorts"], "mode": "fresh"}
```

## `theme_curate` · v1.0.0

Caller: `Themes.create`/`refresh` (curation of the search candidates).

**Input** (`payload`)

- `query` — theme
- `include_terms[]`
- `exclude_terms[]`
- `items[]` — candidates: `video_id`, `title` required; `channel_title`, `duration_s`, `views`, `published_text`, `source` (`search`/`classics`/`rss`)
- `liked_titles[]` — earlier 👍
- `disliked_titles[]` — earlier 👎 (negative example)
- `language` — language

**Output**

- `items[].video_id` — copied
- `items[].keep` — keeps it in the tab
- `items[].score` — 0..1 (sorts the tab)
- `items[].why` — sentence (≤ 280)

**Example** — input and output (compact JSON, identical to `TASKS[...].example_input/example_output`):

```json
{"query": "agentes de IA para iniciantes", "include_terms": ["agente", "agent"], "exclude_terms": ["reaction"], "items": [{"video_id": "dQw4w9WgXcQ", "title": "AI Agents, clearly explained", "channel_title": "Fireship", "duration_s": 600, "views": 1200000, "published_text": "2 months ago", "source": "search"}, {"video_id": "aaaaaaaaaaa", "title": "REACTING to AI agents!!!", "channel_title": "Reacts", "duration_s": 1500, "views": 900, "published_text": "1 day ago", "source": "search"}], "disliked_titles": ["Top 10 AI tools (sponsored)"], "language": "pt-BR"}
```

```json
{"items": [{"video_id": "dQw4w9WgXcQ", "keep": true, "score": 0.92, "why": "Explicação direta do conceito, boa para iniciantes."}, {"video_id": "aaaaaaaaaaa", "keep": false, "score": 0.1, "why": "Vídeo de reação, sem conteúdo próprio."}]}
```

## `list_extract` · v1.0.0

Caller: `ListImporter.import_list` (the "import a list" Extra).

**Input** (`payload`)

- `url` — source page
- `title` — page title or `null`
- `text` — page text (cut at 12 000 characters)
- `language` — language

**Output**

- `title` — short title of the list or `null`
- `items[].name` — channel name as it appears on the page
- `items[].handle_or_url` — @handle/URL or `null`
- `items[].note` — what the page says (≤ 280) or `null`

**Example** — input and output (compact JSON, identical to `TASKS[...].example_input/example_output`):

```json
{"url": "https://example.com/meus-canais-favoritos", "title": "Os 3 canais que mais me ensinaram", "text": "1. Fireship (@fireship) — programação em 100 segundos.\n2. 3Blue1Brown: matemática visual. youtube.com/@3blue1brown\n3. Ciência Todo Dia, ciência em português.", "language": "pt-BR"}
```

```json
{"title": "Os 3 canais que mais me ensinaram", "items": [{"name": "Fireship", "handle_or_url": "@fireship", "note": "Programação em 100 segundos."}, {"name": "3Blue1Brown", "handle_or_url": "youtube.com/@3blue1brown", "note": "Matemática visual."}, {"name": "Ciência Todo Dia", "handle_or_url": null, "note": "Ciência em português."}]}
```

## `digest` · v1.0.0

Caller: the `resumo-pasta` routine 🧠 (short text per video).

**Input** (`payload`)

- `folder` — folder name or `null`
- `items[]` — videos: **`video_id`, `title`, `description` required** (description = the RSS `media:description`, cut at 600); `channel_title`, `duration_s`, `published_at`
- `language` — language

**Output**

- `items[].video_id` — copied
- `items[].summary` — 1–2 sentences (≤ 400)

**Example** — input and output (compact JSON, identical to `TASKS[...].example_input/example_output`):

```json
{"folder": "Tecnologia/IA", "items": [{"video_id": "dQw4w9WgXcQ", "title": "AI Agents, clearly explained", "description": "What an agent is, tools, memory and a demo. Sponsor: …", "channel_title": "Fireship", "duration_s": 600, "published_at": 1794225600}], "language": "pt-BR"}
```

```json
{"items": [{"video_id": "dQw4w9WgXcQ", "summary": "Explica o que é um agente de IA (ferramentas, memória) com uma demo."}]}
```

## Fake for tests

`tests/fakes` → `FakeLLM`: `script(task, answer|function|exception)` queues answers per task; it validates the input (`ValidationError`) and the output (`LLMInvalidResponse` = "refuses output outside the schema"); `FakeLLM(auto=True)` answers with valid outputs derived from the `payload`; `available=False` → `LLMUnavailable`.
