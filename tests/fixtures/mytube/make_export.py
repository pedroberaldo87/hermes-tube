"""Gera o export SINTÉTICO do MyTube v0.9.0 usado como fixture.

Reproduz, campo a campo e na mesma ordem de chaves, o que o MyTube grava:

- ref/mytube/src/content/sidebar/components/ExportImport.tsx:50-66
  (botão "Export" da sidebar): ``{version: 1, exportedAt, state, watchHistory}``
  → ``mytube-backup-2026-11-09.json``
- ref/mytube/src/dashboard/pages/Settings.tsx:35-48
  (página de opções "Download Backup"): ``{...state, watchHistory}`` (achatado)
  → ``mytube-backup-2026-11-09.dashboard.json``

``state`` é o que ``GET_STATE`` devolve (ref/mytube/src/background/index.ts:228-231):
``{...mytube_state, newVideoCounts}``. Tipos em ref/mytube/src/shared/types.ts:14-50.
Ordem das chaves de cada item segue quem o criou:
- inscrição sincronizada: scraper.ts:255-265 + storage.ts syncOrganizables (``id``, ``muted``,
  ``addedAt``, ``lastSyncedAt`` acrescentados no fim)
- item salvo à mão pelo "Now Playing": NowPlaying.tsx (``id`` primeiro) + storage.ts:24-55
  addOrganizable (``muted`` só para canal; ``undefined`` some no JSON)
IDs: ``crypto.randomUUID()`` (storage.ts:20-22) → UUID v4; aqui derivados de hash para
serem estáveis. ``watchHistory`` vem de ``db.getAll('watchHistory')`` (db.ts:151-154).

Canais, handles, avatares e vídeos são reais (verificados em 09/11/2026 por RSS e pela
página ``/@handle``); pastas, tags, datas e contadores são inventados.

Uso: python -I tests/fixtures/mytube/make_export.py   (reescreve os dois JSON)
"""

from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPORTED_AT = "2026-11-09T19:20:00.000Z"
T0 = 1785542400000  # 2026-08-01T00:00:00Z em ms (Date.now())
HOUR = 3_600_000
DAY = 24 * HOUR


def uid(key: str) -> str:
    h = hashlib.sha256(f"mytube-fixture:{key}".encode()).digest()
    return str(uuid.UUID(bytes=h[:16], version=4))


# --- pastas (3, aninhadas: Ciência > Espaço > Lançamentos) — storage.ts:100-110 ---
FOLDERS = [
    {
        "id": uid("folder:ciencia"),
        "name": "Ciência",
        "parentId": None,
        "color": "#2196f3",
        "order": 0,
    },
    {
        "id": uid("folder:espaco"),
        "name": "Espaço",
        "parentId": uid("folder:ciencia"),
        "color": "#673ab7",
        "order": 0,
    },
    {
        "id": uid("folder:lancamentos"),
        "name": "Lançamentos",
        "parentId": uid("folder:espaco"),
        "color": "#ff5722",
        "order": 0,
    },
]
F = {f["name"]: f["id"] for f in FOLDERS}

# --- tags (4) — storage.ts:163-169; cores da paleta de TagManager.tsx:11 ---
TAGS = [
    {"id": uid("tag:favorito"), "name": "favorito", "color": "#f44336"},
    {"id": uid("tag:aprender"), "name": "aprender", "color": "#4caf50"},
    {"id": uid("tag:pt-br"), "name": "PT-BR", "color": "#009688"},
    {"id": uid("tag:programacao"), "name": "programação", "color": "#ff9800"},
]
T = {t["name"]: t["id"] for t in TAGS}

A = "https://yt3.googleusercontent.com/"
# (handle, channelId, nome, avatar, pasta, tags, muted)  — inscrições sincronizadas via ytInitialData
SYNCED = [
    (
        "veritasium",
        "UCHnyfMqiRRG1u-2MsSQLbXA",
        "Veritasium",
        A
        + "7vCbvtCqtjQ3YLgsJt7Y952MQV1sBvhllSCSxHP8_sVZdcPCBrITfhkN2RdyCuwPnsByq-1GoA=s900-c-k-c0x00ffffff-no-rj",
        "Ciência",
        ["favorito", "aprender"],
        False,
    ),
    (
        "3blue1brown",
        "UCYO_jab_esuFRV4b17AJtAw",
        "3Blue1Brown",
        A
        + "ytc/AIdro_nFzZFPLxPZRHcE3SSwzdrbuWqfoWYwLAu0_2iO6blQYAU=s900-c-k-c0x00ffffff-no-rj",
        "Ciência",
        ["aprender"],
        False,
    ),
    (
        "numberphile",
        "UCoxcjq-8xIDTYp3uz647V5A",
        "Numberphile",
        A
        + "ytc/AIdro_nmbQSAGKk1OZCBBf_sPJqLoFfYOVDWRDzALocBjGQtHeI=s900-c-k-c0x00ffffff-no-rj",
        "Ciência",
        [],
        True,
    ),
    ("stevemould", "UCEIwxahdLz7bap-VDs9h35A", "Steve Mould", "", "Ciência", [], True),
    (
        "smartereveryday",
        "UC6107grRI4m0o2-emgoDnAA",
        "SmarterEveryDay",
        A
        + "ytc/AIdro_l59Ewmp0DHZBRWbY9dVqjd2_mWwvrn8ad0bJfmdbMRYcA=s900-c-k-c0x00ffffff-no-rj",
        "Ciência",
        ["favorito"],
        True,
    ),
    (
        "manualdomundo",
        "UCKHhA5hN2UohhFDfNXB_cvQ",
        "Manual do Mundo",
        "",
        "Ciência",
        ["PT-BR"],
        True,
    ),
    (
        "kurzgesagt",
        "UCsXVk37bltHxD1rDPwtNM8Q",
        "Kurzgesagt – In a Nutshell",
        A
        + "ytc/AIdro_n1Ribd7LwdP_qKtqWL3ZDfIgv9M1d6g78VwpHGXVR2Ir4=s900-c-k-c0x00ffffff-no-rj",
        "Espaço",
        ["favorito"],
        False,
    ),
    (
        "cienciatododia",
        "UCn9Erjy00mpnWeLnRqhsA1g",
        "Ciência Todo Dia",
        A
        + "ytc/AIdro_lQoeh3pIl35H0tiDQ6fG3YeSrn2hWxKKCIxN11NQvnDdg=s900-c-k-c0x00ffffff-no-rj",
        "Espaço",
        ["PT-BR", "aprender"],
        True,
    ),
    ("nasa", "UCLA_DiR1FfKNvjuUpBHmylQ", "NASA", "", "Lançamentos", [], True),
    (
        "nasaspaceflight",
        "UCSUu1lih2RifWkKtDOJdsBA",
        "NASASpaceflight",
        "",
        "Lançamentos",
        [],
        False,
    ),
    ("nerdologia", "UClu474HMt895mVxZdlIHXEA", "Nerdologia", "", None, ["PT-BR"], True),
    (
        "fireship",
        "UCsBjURrPoezykLs9EqgamOA",
        "Fireship",
        "",
        None,
        ["programação", "favorito"],
        False,
    ),
    (
        "computerphile",
        "UC9-y-6csu5WGm29I7JiwpnA",
        "Computerphile",
        "",
        None,
        ["programação", "aprender"],
        True,
    ),
]
# canonicalBaseUrl preserva a caixa do handle; o campo ``handle`` é minúsculo (scraper.ts:88-91)
URL_HANDLE = {
    "veritasium": "veritasium",
    "3blue1brown": "3blue1brown",
    "numberphile": "numberphile",
    "stevemould": "SteveMould",
    "smartereveryday": "smartereveryday",
    "manualdomundo": "manualdomundo",
    "kurzgesagt": "kurzgesagt",
    "cienciatododia": "CienciaTodoDia",
    "nasa": "NASA",
    "nasaspaceflight": "NASASpaceflight",
    "nerdologia": "nerdologia",
    "fireship": "Fireship",
    "computerphile": "Computerphile",
}


def synced_channel(i: int, row) -> dict:
    handle, cid, name, avatar, folder, tags, muted = row
    added = T0 + i * HOUR
    return {
        "type": "channel",
        "youtubeId": cid,
        "name": name,
        "thumbnailUrl": avatar,
        "url": f"https://www.youtube.com/@{URL_HANDLE[handle]}",
        "handle": handle,
        "folderId": F[folder] if folder else None,
        "tagIds": [T[t] for t in tags],
        "isSubscribed": True,
        "id": uid(f"org:{cid}"),
        "muted": muted,
        "addedAt": added,
        "lastSyncedAt": T0 + 99 * DAY + 7 * HOUR,
    }


def build_state() -> dict:
    orgs = [synced_channel(i, r) for i, r in enumerate(SYNCED)]
    # Inscrição vinda do fallback de DOM (scraper.ts:277-299): link /channel/UC…, sem handle.
    orgs.append(
        {
            "type": "channel",
            "youtubeId": "UCj1VqrHhDte54oLgPG4xpuQ",
            "name": "Stuff Made Here",
            "thumbnailUrl": A
            + "ytc/AIdro_mzfzJ9E1WEzyt1YlPXemHOwGBBnVCKzXva_mzmS5qqMg=s900-c-k-c0x00ffffff-no-rj",
            "url": "https://www.youtube.com/channel/UCj1VqrHhDte54oLgPG4xpuQ",
            "folderId": None,
            "tagIds": [],
            "isSubscribed": True,
            "id": uid("org:UCj1VqrHhDte54oLgPG4xpuQ"),
            "muted": True,
            "addedAt": T0 + 20 * HOUR,
            "lastSyncedAt": T0 + 99 * DAY + 7 * HOUR,
        }
    )
    # Canal salvo à mão (seguido sem inscrição) pelo Now Playing (NowPlaying.tsx + addOrganizable).
    orgs.append(
        {
            "id": uid("org:UCBa659QWEk1AI4Tg--mrJ2A"),
            "type": "channel",
            "youtubeId": "UCBa659QWEk1AI4Tg--mrJ2A",
            "name": "Tom Scott",
            "thumbnailUrl": A
            + "WxHs0Jf1Jp_4ZU84wxnRL0owNHkzaLUEiD-GIfgCrVjZ0JhgriPTdPfGrkf-U7zwIs5zQl9ccg=s900-c-k-c0x00ffffff-no-rj",
            "url": "https://www.youtube.com/@TomScottGo",
            "folderId": None,
            "tagIds": [T["aprender"]],
            "isSubscribed": False,
            "addedAt": T0 + 40 * DAY,
            "lastSyncedAt": T0 + 40 * DAY,
            "muted": True,
        }
    )
    # Playlist salva pelo Now Playing.
    orgs.append(
        {
            "id": uid("org:PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab"),
            "type": "playlist",
            "youtubeId": "PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab",
            "name": "Essence of linear algebra",
            "thumbnailUrl": "https://i.ytimg.com/vi/fNk_zzaMoSs/hqdefault.jpg",
            "url": "https://www.youtube.com/playlist?list=PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab",
            "folderId": F["Ciência"],
            "tagIds": [T["aprender"]],
            "isSubscribed": False,
            "addedAt": T0 + 41 * DAY,
            "lastSyncedAt": T0 + 41 * DAY,
        }
    )
    # Vídeo salvo pelo Now Playing (url = location.href; sem ``muted``).
    orgs.append(
        {
            "id": uid("org:KfODG5REyss"),
            "type": "video",
            "youtubeId": "KfODG5REyss",
            "name": "I finally saw quantum mechanics with my own eyes... (It's spookier than I expected)",
            "thumbnailUrl": "",
            "url": "https://www.youtube.com/watch?v=KfODG5REyss&t=754s",
            "folderId": F["Ciência"],
            "tagIds": [T["favorito"]],
            "isSubscribed": False,
            "addedAt": T0 + 96 * DAY,
            "lastSyncedAt": T0 + 96 * DAY,
            "channelName": "Veritasium",
        }
    )
    return {
        "organizables": orgs,
        "folders": FOLDERS,
        "tags": TAGS,
        # canal apagado no MyTube: não volta no próximo sync (storage.ts syncOrganizables)
        "deletedYoutubeIds": ["channel:UCY1kMZp36IQSyNx_9h4mpCg"],
        # db.getNewVideoCountsMap(): só canais com newCount > 0 (db.ts:108-118)
        "newVideoCounts": {
            "UCHnyfMqiRRG1u-2MsSQLbXA": 2,
            "UCsBjURrPoezykLs9EqgamOA": 5,
            "UCSUu1lih2RifWkKtDOJdsBA": 3,
        },
    }


WATCH_HISTORY = [
    {
        "videoId": "KfODG5REyss",
        "channelId": "UCHnyfMqiRRG1u-2MsSQLbXA",
        "title": "I finally saw quantum mechanics with my own eyes... (It's spookier than I expected)",
        "watchedAt": T0 + 96 * DAY + 2 * HOUR,
    },
    {
        "videoId": "iw9SZgyahqg",
        "channelId": "UCsBjURrPoezykLs9EqgamOA",
        "title": "The one thing holding theoretical CS together just broke... kinda",
        "watchedAt": T0 + 99 * DAY + 3 * HOUR,
    },
    {
        "videoId": "fNk_zzaMoSs",
        "channelId": "UCYO_jab_esuFRV4b17AJtAw",
        "title": "Vectors | Chapter 1, Essence of linear algebra",
        "watchedAt": T0 + 41 * DAY + HOUR,
    },
    {
        "videoId": "5C_HPTJg5ek",
        "channelId": "UCsBjURrPoezykLs9EqgamOA",
        "title": "Rust in 100 Seconds",
        "watchedAt": T0 + 60 * DAY,
    },
]


def dump(obj) -> str:
    # JSON.stringify(x, null, 2): indentação 2, UTF-8 cru, sem newline final
    return json.dumps(obj, indent=2, ensure_ascii=False)


def main() -> None:
    state = build_state()
    sidebar = {
        "version": 1,
        "exportedAt": EXPORTED_AT,
        "state": state,
        "watchHistory": WATCH_HISTORY,
    }
    dashboard = {**state, "watchHistory": WATCH_HISTORY}
    (HERE / "mytube-backup-2026-11-09.json").write_text(dump(sidebar), encoding="utf-8")
    (HERE / "mytube-backup-2026-11-09.dashboard.json").write_text(
        dump(dashboard), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
