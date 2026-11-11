"""Confere as fixtures de tests/fixtures (unidade area-40). Só biblioteca padrão, sem rede.

Uso: python -I tests/fixtures/verify_fixtures.py     → sai 0 se tudo ok, 1 se algo falhou.

Checagens:
- todo arquivo citado na tabela do README.md existe, e todo arquivo da pasta está na tabela;
- RSS (youtube/rss/*.xml): XML válido, 15 <entry>, cada uma com media:description;
- busca (youtube/search/*.html): ytInitialData presente e decodificável, ≥ 10 videoId distintos;
- canal/watch: ytInitialData (e ytInitialPlayerResponse no watch) quando a página é 200;
- /shorts/: status 200 para o Short e 303 para o vídeo normal;
- hackertube/videos.sample.jsonl: 200 linhas JSON válidas com ``vid``;
- export do MyTube: JSON válido, ~15 canais, 3 pastas aninhadas, 4 tags;
- páginas sintéticas: marcadas como SINTÉTICO e com os seletores do MyTube;
- tamanho total da pasta < 25 MB.
"""

from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
MAX_BYTES = 25 * 1024 * 1024
ATOM = "{http://www.w3.org/2005/Atom}"
MRSS = "{http://search.yahoo.com/mrss/}"
VIDEO_ID = re.compile(r'"videoId":"([A-Za-z0-9_-]{11})"')
# arquivos da pasta que não são fixtures e não precisam estar na tabela
NOT_FIXTURES = {"README.md", "verify_fixtures.py", ".gitkeep"}

failures: list[str] = []


def check(ok: bool, msg: str) -> bool:
    print(("ok   " if ok else "FAIL ") + msg)
    if not ok:
        failures.append(msg)
    return ok


def extract_json(text: str, marker: str):
    """Decodifica o objeto JSON que vem logo depois de ``marker`` (ex.: ``var ytInitialData``)."""
    i = text.find(marker)
    if i < 0:
        return None
    j = text.find("{", i)
    if j < 0:
        return None
    try:
        return json.JSONDecoder().raw_decode(text, j)[0]
    except json.JSONDecodeError:
        return None


def readme_files() -> list[str]:
    """Caminhos (relativos a tests/fixtures) da 1ª coluna das tabelas do README."""
    readme = HERE / "README.md"
    if not check(readme.is_file(), "README.md existe"):
        return []
    out = []
    for line in readme.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        m = re.fullmatch(r"`([^`]+)`", cells[0]) if cells else None
        if m:
            out.append(m.group(1))
    return out


def all_files() -> list[Path]:
    return sorted(
        p for p in HERE.rglob("*") if p.is_file() and "__pycache__" not in p.parts
    )


def check_readme() -> None:
    cited = readme_files()
    check(len(cited) > 0, f"README cita {len(cited)} arquivos")
    for rel in cited:
        check((HERE / rel).is_file(), f"citado no README existe: {rel}")
    cited_set = set(cited)
    for p in all_files():
        rel = p.relative_to(HERE).as_posix()
        if rel in NOT_FIXTURES:
            continue
        check(rel in cited_set, f"arquivo está na tabela do README: {rel}")


def check_rss() -> None:
    files = sorted((HERE / "youtube/rss").glob("*.xml"))
    check(len(files) >= 2, f"RSS: {len(files)} canais (≥ 2)")
    for f in files:
        try:
            root = ET.parse(f).getroot()
        except ET.ParseError as e:
            check(False, f"RSS {f.name}: XML inválido ({e})")
            continue
        entries = root.findall(f"{ATOM}entry")
        with_desc = sum(
            1 for e in entries if e.find(f"{MRSS}group/{MRSS}description") is not None
        )
        check(len(entries) == 15, f"RSS {f.name}: {len(entries)} <entry> (= 15)")
        check(
            with_desc == len(entries) and with_desc > 0,
            f"RSS {f.name}: media:description em {with_desc}/{len(entries)}",
        )


def check_search() -> None:
    files = sorted((HERE / "youtube/search").glob("*.html"))
    check(len(files) >= 4, f"busca: {len(files)} páginas (≥ 4)")
    for f in files:
        text = f.read_text(encoding="utf-8", errors="replace")
        data = extract_json(text, "var ytInitialData")
        ids = set(VIDEO_ID.findall(text))
        check(data is not None, f"busca {f.name}: ytInitialData decodificável")
        check(len(ids) >= 10, f"busca {f.name}: {len(ids)} videoId distintos (≥ 10)")


def check_channel_and_watch() -> None:
    for f in sorted((HERE / "youtube/channel").glob("*.html")):
        text = f.read_text(encoding="utf-8", errors="replace")
        if ".404." in f.name:
            check(
                "var ytInitialData" not in text and len(text) < 10_000,
                f"canal {f.name}: resposta 404 real (sem ytInitialData)",
            )
            continue
        data = extract_json(text, "var ytInitialData")
        ext = (
            (data or {})
            .get("metadata", {})
            .get("channelMetadataRenderer", {})
            .get("externalId", "")
        )
        check(
            bool(re.fullmatch(r"UC[A-Za-z0-9_-]{22}", ext)),
            f"canal {f.name}: externalId {ext or '—'}",
        )
    for f in sorted((HERE / "youtube/watch").glob("*.html")):
        text = f.read_text(encoding="utf-8", errors="replace")
        player = extract_json(text, "var ytInitialPlayerResponse")
        vid = (player or {}).get("videoDetails", {}).get("videoId", "")
        check(
            vid != "" and vid in f.name,
            f"watch {f.name}: ytInitialPlayerResponse com videoId {vid or '—'}",
        )
        check(
            extract_json(text, "var ytInitialData") is not None,
            f"watch {f.name}: ytInitialData decodificável",
        )


def check_shorts() -> None:
    expected = {"short.": "200", "normal.": "303"}
    files = sorted((HERE / "youtube/shorts").glob("*.txt"))
    check(len(files) == 2, f"shorts: {len(files)} capturas (= 2)")
    for f in files:
        text = f.read_text(encoding="utf-8")
        m = re.search(r"^HTTP/\S+ (\d{3})", text, re.MULTILINE)
        status = m.group(1) if m else "—"
        want = next((v for k, v in expected.items() if f.name.startswith(k)), "?")
        check(status == want, f"shorts {f.name}: status {status} (esperado {want})")
        check("# command: curl -sI" in text, f"shorts {f.name}: comando registrado")
        cookies = re.findall(
            r"^set-cookie:\s*([^=;\s]+)=([^;]*)", text, re.MULTILINE | re.IGNORECASE
        )
        check(
            all(v == "<redacted>" for _, v in cookies),
            f"shorts {f.name}: valores de set-cookie redigidos ({len(cookies)})",
        )


def check_hackertube() -> None:
    f = HERE / "hackertube/videos.sample.jsonl"
    if not check(f.is_file(), "hackertube: videos.sample.jsonl existe"):
        return
    lines = f.read_text(encoding="utf-8").splitlines()
    good = 0
    for line in lines:
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and re.fullmatch(
            r"[A-Za-z0-9_-]{11}", str(obj.get("vid", ""))
        ):
            good += 1
    check(len(lines) == 200, f"hackertube: {len(lines)} linhas (= 200)")
    check(
        good == len(lines),
        f"hackertube: {good}/{len(lines)} linhas JSON válidas com vid",
    )
    check(
        (HERE / "hackertube/LICENSE-NOTE.md").is_file(),
        "hackertube: LICENSE-NOTE.md existe",
    )
    for big in (
        "embeddings.npy",
        "hackertube-data.zip",
        "mentions.jsonl",
        "videos.jsonl",
    ):
        check(
            not (HERE / "hackertube" / big).exists(),
            f"hackertube: {big} não versionado",
        )


def check_mytube() -> None:
    d = HERE / "mytube"
    sidebar = json.loads(
        (d / "mytube-backup-2026-11-09.json").read_text(encoding="utf-8")
    )
    dash = json.loads(
        (d / "mytube-backup-2026-11-09.dashboard.json").read_text(encoding="utf-8")
    )
    check(
        sidebar.get("version") == 1 and "exportedAt" in sidebar and "state" in sidebar,
        "mytube export (sidebar): {version: 1, exportedAt, state, watchHistory}",
    )
    state = sidebar["state"]
    check(
        set(dash) == set(state) | {"watchHistory"},
        "mytube export (dashboard): {...state, watchHistory}",
    )
    channels = [o for o in state.get("organizables", []) if o.get("type") == "channel"]
    folders = state.get("folders", [])
    by_id = {f["id"]: f for f in folders}

    def depth(f):
        n = 1
        while f.get("parentId"):
            f = by_id[f["parentId"]]
            n += 1
        return n

    check(13 <= len(channels) <= 17, f"mytube export: {len(channels)} canais (~15)")
    check(
        len(folders) == 3 and max(map(depth, folders)) == 3,
        f"mytube export: {len(folders)} pastas, aninhamento 3",
    )
    check(
        len(state.get("tags", [])) == 4,
        f"mytube export: {len(state.get('tags', []))} tags (= 4)",
    )
    check(
        (d / "youtube-channel-videos.html").is_file(),
        "mytube: youtube-channel-videos.html copiado",
    )

    for name in (
        "feed-channels.synthetic.html",
        "feed-channels.dom-only.synthetic.html",
    ):
        text = (d / name).read_text(encoding="utf-8")
        check("SINTÉTICO" in text, f"{name}: marcado como SINTÉTICO")
        check(
            text.count("ytd-channel-renderer") > 0 and "yt-lockup-view-model" in text,
            f"{name}: itens DOM do scraper",
        )
    data = extract_json(
        (d / "feed-channels.synthetic.html").read_text(encoding="utf-8"),
        "var ytInitialData = ",
    )
    check(data is not None, "feed-channels.synthetic.html: ytInitialData decodificável")

    sub = (d / "subscribe-button.synthetic.html").read_text(encoding="utf-8")
    check("SINTÉTICO" in sub, "subscribe-button.synthetic.html: marcado como SINTÉTICO")
    for state_name in (
        "not-subscribed",
        "subscribed-classic",
        "subscribed-view-model",
        "menu-open",
        "confirm-dialog",
    ):
        check(
            f'data-fixture-state="{state_name}"' in sub,
            f"subscribe-button.synthetic.html: estado {state_name}",
        )


def check_size() -> None:
    total = sum(p.stat().st_size for p in all_files())
    check(total < MAX_BYTES, f"tamanho total {total / 1024 / 1024:.1f} MB (< 25 MB)")


def main() -> int:
    for step in (
        check_readme,
        check_rss,
        check_search,
        check_channel_and_watch,
        check_shorts,
        check_hackertube,
        check_mytube,
        check_size,
    ):
        try:
            step()
        except Exception as e:  # noqa: BLE001 — qualquer erro vira falha legível
            check(False, f"{step.__name__}: {type(e).__name__}: {e}")
    print(f"\n{'FALHOU' if failures else 'OK'}: {len(failures)} falha(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
