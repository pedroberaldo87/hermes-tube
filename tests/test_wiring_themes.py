"""Themes end to end through the real graph — ``ThemeService`` + ``Searcher`` +
real ``VideoStore``/``FeedEngine``/``TabService``; only YouTube and the model are fakes.

Covers the risk that the real Searcher was never tested together with the theme code."""

from __future__ import annotations

from typing import Any

from fakes import FakeClock, FakeLLM, FakeSettings, FakeYouTube

from tube_pkg import wiring
from tube_pkg.core import db as core_db
from tube_pkg.core import types as T

DAY = 86400


def cid(n: int) -> str:
    return f"UCwiringtheme{n:011d}"


def vid(n: int) -> str:
    return f"wth{n:08d}"


def hit(n: int, channel: int, now: int) -> T.SearchHit:
    return T.SearchHit(
        video_id=vid(n),
        title=f"Agentes de IA na prática {n}",
        channel_id=cid(channel),
        channel_title=f"Canal {channel}",
        duration_s=900,
        views=1000 + n,
        published_text="2 days ago",
        published_at=now - 2 * DAY,
    )


def curate_all(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "items": [
            {"video_id": it["video_id"], "keep": True, "score": 0.9, "why": "Bom para o tema."}
            for it in payload["items"]
        ]
    }


def test_theme_end_to_end_through_the_real_graph(tmp_path, wire) -> None:
    clock = FakeClock()
    now = clock.now()
    yt = FakeYouTube()
    # relevance and "recent" return different sets; video 2 shows up in both (dedup)
    yt.add_search("agentes de IA", [hit(1, 1, now), hit(2, 1, now)], T.SearchOrder.relevance)
    yt.add_search("agentes de IA", [hit(2, 1, now), hit(3, 1, now)], T.SearchOrder.date)
    yt.add_search("AI agents", [hit(4, 2, now), hit(5, 1, now)])
    llm = FakeLLM(model="modelo-teste")
    llm.script(
        T.AiTask.theme_expand,
        {
            "name": "Agentes de IA",
            "icon": "🤖",
            "searches": ["agentes de IA", "AI agents", "agentes LLM", "x y", "z w"],
            "include_terms": ["agente"],
            "exclude_terms": ["reaction"],
            "mode": "fresh",
        },
    )
    llm.script(T.AiTask.theme_curate, curate_all)
    wire.set("youtube", yt)
    wire.set("llm", llm)
    wire.set("clock", clock)

    db = core_db.build(path=str(tmp_path / "t.db"))
    try:
        graph = wiring.Graph(db=db, settings=FakeSettings(), ctx=None)
        themes = graph.get("themes")
        searcher = graph.get("searcher")
        assert type(searcher).__module__ == "tube_pkg.core.search_jobs"  # real, not the fake
        assert themes.fetch_seed is not None  # wired to the Refresher by the graph

        stages: list[str] = []
        preview = themes.create("agentes de IA", on_progress=lambda p: stages.append(p.stage))

        assert preview.theme.status is T.ThemeStatus.preview, preview.theme
        assert preview.theme.error is None, preview.theme.error  # model plan accepted
        got = sorted(it.video_id for it in preview.items)
        assert got == [vid(n) for n in (1, 2, 3, 4, 5)]  # dedup across searches and orders
        seeds = {s.channel_id for s in preview.seeds}
        assert cid(1) in seeds and cid(2) not in seeds  # seed = channel with ≥ 3 kept
        assert list(dict.fromkeys(stages))[:1] == ["expand"] and "curate" in stages
        searched = [arg for name, arg in yt.calls if name == "search"]
        assert {"AI agents", "agentes de IA"} <= set(searched)
        assert len(searched) == 10  # 5 searches × (relevance + recent), no repeats

        saved = themes.save(preview.theme.id)
        page = graph.get("feed").page(saved.tab.id)
        shown = sorted(it.video.id for it in page.items)
        assert shown == got  # the saved tab shows the preview through the real feed engine
    finally:
        db.close()
