"""``core/youtube.py`` (``YouTubeClient``) with saved pages only (``tests/fixtures/youtube``).

The real client runs on ``core/http.Client`` with a fake transport (``Router``): no network in
``check``. The ``live`` tests (outside ``check``) make 1 real call per function.
"""

from __future__ import annotations

import inspect
import json
import re
from collections.abc import Callable, Mapping
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from fakes import FakeClock, FakeSettings, FakeYouTube
from fakes import youtube as fake_yt

from tube_pkg.core import http as H
from tube_pkg.core import types as T
from tube_pkg.core import youtube as Y

FIX = Path(__file__).resolve().parent / "fixtures"
YT = FIX / "youtube"
NOW = 1_794_225_600  # 2026-11-09 12:00 UTC (= fakes.DEFAULT_NOW)
DAY = 86_400

FIRESHIP = "UCsBjURrPoezykLs9EqgamOA"
VERITASIUM = "UCHnyfMqiRRG1u-2MsSQLbXA"
BASE = "https://www.youtube.com"


# --------------------------------------------------------------------------- harness


def _read(rel: str) -> str:
    return (YT / rel).read_text(encoding="utf-8")


def _ts(iso: str) -> int:
    return int(datetime.fromisoformat(iso).timestamp())


Route = T.HttpResponse | bytes | str | BaseException | Callable[[H.TransportRequest], Any] | None


class Router:
    """Fake ``http.Client`` transport: exact URL (or without query) → answer; else → 404."""

    def __init__(self, routes: Mapping[str, Route] | None = None) -> None:
        self.routes: dict[str, Route] = dict(routes or {})
        self.requests: list[H.TransportRequest] = []

    def __call__(self, req: H.TransportRequest) -> T.HttpResponse:
        self.requests.append(req)
        route = self.routes.get(req.url)
        if route is None:
            route = self.routes.get(req.url.split("?", 1)[0])
        if callable(route) and not isinstance(route, T.HttpResponse | BaseException):
            route = route(req)
        if route is None:
            return T.HttpResponse(404, req.url, {"content-type": "text/html"}, b"<html>404</html>")
        if isinstance(route, BaseException):
            raise route
        if isinstance(route, T.HttpResponse):
            return T.HttpResponse(route.status, req.url, dict(route.headers), route.content)
        body = route.encode("utf-8") if isinstance(route, str) else bytes(route)
        return T.HttpResponse(200, req.url, {"content-type": "text/html"}, body)

    @property
    def urls(self) -> list[str]:
        return [r.url for r in self.requests]

    def header(self, index: int, name: str) -> str | None:
        for k, v in self.requests[index].headers.items():
            if k.lower() == name.lower():
                return v
        return None


def make(routes: Mapping[str, Route] | None = None, **settings: Any) -> tuple[Any, Router]:
    router = Router(routes)
    st = FakeSettings(**settings)
    http = H.Client(settings=st, transport=router, sleep=lambda _s: None)
    client = Y.build(http=http, settings=st, clock=FakeClock(NOW))
    return client, router


def head_fixture(rel: str) -> T.HttpResponse:
    """Saved ``curl -sI`` → ``HttpResponse`` (status + headers, empty body)."""
    lines = [ln.rstrip("\r") for ln in _read(rel).splitlines()]
    lines = [ln for ln in lines if ln and not ln.startswith("#")]
    status = int(lines[0].split()[1])
    headers: dict[str, str] = {}
    for ln in lines[1:]:
        key, _, value = ln.partition(":")
        headers[key.strip().lower()] = value.strip()
    return T.HttpResponse(status, "", headers, b"")


def initial_data(rel: str) -> dict[str, Any]:
    text = _read(rel)
    match = re.search(r"ytInitialData\s*=\s*", text)
    assert match is not None
    data, _ = json.JSONDecoder().raw_decode(text, match.end())
    return data


def page(var: str, data: Any) -> str:
    """Minimal HTML with ``var <var> = <json>;`` (synthetic fixture inside the test)."""
    return f"<html><body><script>var {var} = {json.dumps(data)};</script></body></html>"


# --------------------------------------------------------------------------- contract


def test_build_signature_matches_contract():
    assert T.BUILD_SIGNATURES["plugin/core/youtube.py:build"] == (
        "build(*, http, settings, clock=None) -> YouTubeClient"
    )
    params = inspect.signature(Y.build).parameters
    assert list(params) == ["http", "settings", "clock"]
    assert all(p.kind is inspect.Parameter.KEYWORD_ONLY for p in params.values())
    assert params["http"].default is inspect.Parameter.empty
    assert params["settings"].default is inspect.Parameter.empty
    assert params["clock"].default is None


def test_build_without_clock_does_no_network():
    router = Router()
    st = FakeSettings()
    client = Y.build(http=H.Client(settings=st, transport=router), settings=st)
    assert isinstance(client, T.YouTubeClient)
    assert router.requests == []


def _protocol_methods() -> list[str]:
    return sorted(
        name
        for name, value in vars(T.YouTubeClient).items()
        if not name.startswith("_") and callable(value)
    )


def _shape(fn: Any) -> list[tuple[str, Any, Any]]:
    sig = inspect.signature(fn)
    return [(p.name, p.kind, p.default) for p in sig.parameters.values() if p.name != "self"]


def test_real_and_fake_satisfy_the_same_protocol():
    client, _ = make()
    fake = FakeYouTube()
    assert isinstance(client, T.YouTubeClient)
    assert isinstance(fake, T.YouTubeClient)
    methods = _protocol_methods()
    assert methods == [
        "fetch_channel_rss",
        "fetch_channel_uploads",
        "frame_url",
        "is_short",
        "parse_search_payload",
        "resolve_channel",
        "search",
        "video_details",
    ]
    for name in methods:
        expected = _shape(getattr(T.YouTubeClient, name))
        assert _shape(getattr(type(client), name)) == expected, name
        assert _shape(getattr(FakeYouTube, name)) == expected, name


# --------------------------------------------------------------------------- RSS


def test_rss_veritasium_with_description_views_and_shorts():
    url = f"{BASE}/feeds/videos.xml?channel_id={VERITASIUM}"
    client, router = make({url: _read("rss/veritasium.xml")})
    feed = client.fetch_channel_rss(VERITASIUM)
    assert router.urls == [url]
    assert "SOCS=CAI" in (router.header(0, "cookie") or "")
    assert feed.channel.id == VERITASIUM  # the feed carries the id without the "UC" prefix
    assert feed.channel.title == "Veritasium"
    assert feed.channel.url == f"{BASE}/channel/{VERITASIUM}"
    assert len(feed.videos) == 15
    first = feed.videos[0]
    assert first.id == "rL0qEmTRI-I"
    assert first.channel_id == VERITASIUM
    assert first.title == "Why do deserts get cold at night?"
    assert first.published_at == _ts("2026-11-06T14:00:17+00:00")
    assert first.views == 1563718
    assert first.description is not None
    assert first.description.startswith("The desert ground is blistering hot")
    assert first.channel_title == "Veritasium"
    assert first.is_short is True  # /shorts/<id> link in the feed
    normal = next(v for v in feed.videos if v.id == "KfODG5REyss")
    assert normal.is_short is None  # /watch link: unknown (confirmed on demand by the refresh)
    assert sum(1 for v in feed.videos if v.is_short) == 10
    assert max(len(v.description or "") for v in feed.videos) == 4899
    stamps = [v.published_at or 0 for v in feed.videos]
    assert stamps == sorted(stamps, reverse=True)


def test_rss_fireship_matches_fake_parser_field_by_field():
    for name, cid in (("fireship", FIRESHIP), ("veritasium", VERITASIUM)):
        xml = _read(f"rss/{name}.xml")
        client, _ = make({f"{BASE}/feeds/videos.xml?channel_id={cid}": xml})
        real = client.fetch_channel_rss(cid)
        fake = fake_yt.parse_rss(xml)
        assert real.channel.id == fake.channel.id == cid
        assert [
            (v.id, v.channel_id, v.title, v.published_at, v.description, v.views)
            for v in real.videos
        ] == [
            (v.id, v.channel_id, v.title, v.published_at, v.description, v.views)
            for v in fake.videos
        ]
    fireship = Y.parse_rss(_read("rss/fireship.xml"))
    assert len(fireship.videos) == 15
    assert all(v.is_short is None for v in fireship.videos)
    assert all(v.description for v in fireship.videos)


def test_rss_entry_without_group_and_cap_of_15():
    entries = "".join(
        f"<entry><yt:videoId>vid{i:08d}</yt:videoId><yt:channelId>{FIRESHIP}</yt:channelId>"
        f"<title>t{i}</title><published>2026-11-0{1 + i % 9}T00:00:00+00:00</published></entry>"
        for i in range(20)
    )
    xml = (
        '<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" '
        'xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">'
        f"<yt:channelId>{FIRESHIP}</yt:channelId><title>X</title>"
        "<entry><title>sem id</title></entry>" + entries + "</feed>"
    )
    feed = Y.parse_rss(xml)
    assert len(feed.videos) == 15
    assert all(v.views is None and v.description is None for v in feed.videos)
    assert feed.videos[0].published_at == _ts("2026-11-09T00:00:00+00:00")


def test_rss_empty_feed_uses_requested_channel_id():
    xml = '<feed xmlns="http://www.w3.org/2005/Atom"><title>Novo</title></feed>'
    feed = Y.parse_rss(xml, channel_id=FIRESHIP)
    assert feed.channel.id == FIRESHIP
    assert feed.channel.title == "Novo"
    assert feed.videos == ()
    with pytest.raises(T.YouTubeError, match="without a channel id"):
        Y.parse_rss(xml)


@pytest.mark.parametrize(
    "body",
    [
        "<feed><entry>",  # broken XML
        "<html><body>not xml</body></html>",  # HTML instead of the feed
        '<?xml version="1.0"?><!DOCTYPE feed [<!ENTITY a "aaaa">]><feed>&a;</feed>',  # DTD
        "",
        "<rss><channel><title>outro formato</title></channel></rss>",
    ],
)
def test_rss_unreadable_is_youtube_error(body):
    client, _ = make({f"{BASE}/feeds/videos.xml?channel_id={FIRESHIP}": body})
    with pytest.raises(T.YouTubeError):
        client.fetch_channel_rss(FIRESHIP)


@pytest.mark.parametrize("status", [404, 410, 429, 500, 503])
def test_rss_http_errors_are_readable(status):
    url = f"{BASE}/feeds/videos.xml?channel_id={FIRESHIP}"
    client, _ = make({url: T.HttpResponse(status, url, {}, b"nope")})
    with pytest.raises(T.YouTubeError) as err:
        client.fetch_channel_rss(FIRESHIP)
    assert str(status) in str(err.value)
    assert err.value.details.get("status") == status


def test_rss_network_failure_is_youtube_error():
    url = f"{BASE}/feeds/videos.xml?channel_id={FIRESHIP}"
    client, router = make({url: H.TransportError("connection refused")})
    with pytest.raises(T.YouTubeError) as err:
        client.fetch_channel_rss(FIRESHIP)
    assert "connection refused" in str(err.value)
    assert len(router.requests) == H.ATTEMPTS


@pytest.mark.parametrize("bad", ["", "abc", "@Fireship", "UCshort", f"{FIRESHIP}x", None])
def test_rss_invalid_channel_id_is_validation_error(bad):
    client, router = make()
    with pytest.raises(T.ValidationError):
        client.fetch_channel_rss(bad)
    assert router.requests == []


# --------------------------------------------------------------------------- resolve channel


def _fireship_routes() -> dict[str, Route]:
    return {
        f"{BASE}/@fireship": _read("channel/handle.Fireship.html"),
        f"{BASE}/channel/{FIRESHIP}": _read("channel/channel-id.UCsBjURrPoezykLs9EqgamOA.html"),
        f"{BASE}/c/fireship": _read("channel/c.Fireship.html"),
        f"{BASE}/user/fireshipio": _read("channel/handle.Fireship.html"),
        f"{BASE}/fireshipio": _read("channel/handle.Fireship.html"),
    }


def _assert_fireship(info: T.ChannelInfo) -> None:
    assert info.id == FIRESHIP
    assert info.title == "Fireship"
    assert info.handle == "@Fireship"
    assert info.url == f"{BASE}/channel/{FIRESHIP}"
    assert info.thumb is not None
    assert info.thumb.startswith("https://yt3.googleusercontent.com/")


@pytest.mark.parametrize(
    ("text", "url"),
    [
        ("@Fireship", f"{BASE}/@fireship"),
        ("https://www.youtube.com/@Fireship", f"{BASE}/@fireship"),
        ("youtube.com/@Fireship/videos?view=0", f"{BASE}/@fireship"),
        ("https://m.youtube.com/@fireship", f"{BASE}/@fireship"),
        (FIRESHIP, f"{BASE}/channel/{FIRESHIP}"),
        (f"https://www.youtube.com/channel/{FIRESHIP}/videos", f"{BASE}/channel/{FIRESHIP}"),
        ("https://www.youtube.com/c/Fireship", f"{BASE}/c/fireship"),
        ("https://www.youtube.com/user/FireshipIO", f"{BASE}/user/fireshipio"),
    ],
)
def test_resolve_channel_every_url_form(text, url):
    client, router = make(_fireship_routes())
    _assert_fireship(client.resolve_channel(text))
    assert router.urls == [url]


def test_resolve_channel_legacy_vanity_falls_back_from_c_to_root():
    routes = _fireship_routes()
    del routes[f"{BASE}/c/fireship"]
    routes[f"{BASE}/fireship"] = _read("channel/c.Fireship.html")
    client, router = make(routes)
    _assert_fireship(client.resolve_channel("https://www.youtube.com/Fireship"))
    assert router.urls == [f"{BASE}/c/fireship", f"{BASE}/fireship"]


def test_resolve_channel_c_404_is_readable_error():
    body = _read("channel/c.kurzgesagt.404.html").encode()
    url = f"{BASE}/c/kurzgesagt"
    client, router = make({url: T.HttpResponse(404, url, {}, body)})
    with pytest.raises(T.YouTubeError) as err:
        client.resolve_channel("https://www.youtube.com/c/kurzgesagt")
    msg = str(err.value)
    assert "kurzgesagt" in msg and "404" in msg
    assert router.urls == [f"{BASE}/c/kurzgesagt", f"{BASE}/kurzgesagt"]


def _veritasium_channel_page() -> str:
    return page(
        "ytInitialData",
        {
            "metadata": {
                "channelMetadataRenderer": {
                    "title": "Veritasium",
                    "externalId": VERITASIUM,
                    "vanityChannelUrl": "http://www.youtube.com/@veritasium",
                    "avatar": {
                        "thumbnails": [{"url": "https://yt3.ggpht.com/v=s900", "width": 900}]
                    },
                }
            }
        },
    )


@pytest.mark.parametrize(
    "link",
    [
        "https://www.youtube.com/watch?v=KfODG5REyss&t=10",
        "https://youtu.be/KfODG5REyss",
        "https://www.youtube.com/shorts/KfODG5REyss",
        "https://www.youtube.com/live/KfODG5REyss",
    ],
)
def test_resolve_channel_from_video_link(link):
    client, router = make(
        {
            f"{BASE}/watch?v=KfODG5REyss": _read("watch/normal.KfODG5REyss.html"),
            f"{BASE}/channel/{VERITASIUM}": _veritasium_channel_page(),
        }
    )
    info = client.resolve_channel(link)
    assert info.id == VERITASIUM
    assert info.title == "Veritasium"
    assert info.handle == "@veritasium"
    assert info.thumb == "https://yt3.ggpht.com/v=s900"
    assert router.urls == [f"{BASE}/watch?v=KfODG5REyss", f"{BASE}/channel/{VERITASIUM}"]


def test_resolve_channel_from_video_falls_back_to_watch_page_data():
    client, _ = make({f"{BASE}/watch?v=KfODG5REyss": _read("watch/normal.KfODG5REyss.html")})
    info = client.resolve_channel("https://youtu.be/KfODG5REyss")
    assert info.id == VERITASIUM
    assert info.title == "Veritasium"
    assert info.url == f"{BASE}/channel/{VERITASIUM}"


def test_resolve_channel_legacy_c4_header():
    data = {
        "header": {
            "c4TabbedHeaderRenderer": {
                "channelId": FIRESHIP,
                "title": "Fireship",
                "avatar": {
                    "thumbnails": [
                        {"url": "https://yt3.ggpht.com/a=s48", "width": 48},
                        {"url": "https://yt3.ggpht.com/a=s176", "width": 176},
                    ]
                },
                "channelHandleText": {"runs": [{"text": "@Fireship"}]},
            }
        }
    }
    client, _ = make({f"{BASE}/@fireship": page("ytInitialData", data)})
    info = client.resolve_channel("@Fireship")
    assert (info.id, info.title, info.handle) == (FIRESHIP, "Fireship", "@Fireship")
    assert info.thumb == "https://yt3.ggpht.com/a=s176"


def test_parse_channel_page_prefers_page_header_avatar_size():
    info = Y.parse_channel_page(_read("channel/handle.Fireship.html"))
    _assert_fireship(info)
    assert "=s160-" in (info.thumb or "")


@pytest.mark.parametrize(
    "text", ["", "   ", "mkbhd", "https://example.com/@x", "https://www.youtube.com/feed/x", None]
)
def test_resolve_channel_unrecognized_input_is_validation_error(text):
    client, router = make()
    with pytest.raises(T.ValidationError):
        client.resolve_channel(text)
    assert router.requests == []


@pytest.mark.parametrize(
    "body",
    [
        "<html><body>sem dados</body></html>",
        page("ytInitialData", {"contents": {}}),
        page("ytInitialData", {"metadata": {"channelMetadataRenderer": {"title": "x"}}}),
        page("ytInitialData", {"metadata": []}),
        "<script>var ytInitialData = {broken</script>",
    ],
)
def test_resolve_channel_page_without_channel_data_is_youtube_error(body):
    client, _ = make({f"{BASE}/@fireship": body})
    with pytest.raises(T.YouTubeError):
        client.resolve_channel("@Fireship")


def test_resolve_channel_consent_redirect_is_readable():
    consent = "https://consent.youtube.com/m?continue=x"
    client, _ = make(
        {
            f"{BASE}/@fireship": T.HttpResponse(302, "", {"location": consent}),
            "https://consent.youtube.com/m": "<html>Before you continue to YouTube</html>",
        }
    )
    with pytest.raises(T.YouTubeError) as err:
        client.resolve_channel("@Fireship")
    assert "consent" in str(err.value)


# --------------------------------------------------------------------------- search


def _search_route(rel: str, seen: list[dict[str, list[str]]]) -> Callable[..., Any]:
    body = _read(rel)

    def respond(req: H.TransportRequest) -> str:
        seen.append(parse_qs(urlsplit(req.url).query))
        return body

    return respond


def test_search_relevance_from_saved_page():
    seen: list[dict[str, list[str]]] = []
    routes = {f"{BASE}/results": _search_route("search/en-rust-programming.relevance.html", seen)}
    client, router = make(routes)
    hits = client.search("rust programming")
    assert seen[0]["search_query"] == ["rust programming"]
    assert "sp" not in seen[0]
    assert "search_query=rust+programming" in router.urls[0]
    assert len(hits) == 17
    assert hits[0].video_id == "rQ_J9WH6CGk"
    assert all(T.SearchHit is type(h) for h in hits)
    assert all(re.fullmatch(r"UC[\w-]{22}", h.channel_id) for h in hits)
    assert len({h.video_id for h in hits}) == len(hits)
    bek = next(h for h in hits if h.channel_title == "BekBrace")
    assert bek.channel_id == "UC7EVSn5inapL20oPSwAwEUg"
    assert bek.duration_s == 3 * 3600 + 5 * 60 + 4
    assert bek.views == 676779
    assert bek.published_text == "2y ago"
    assert bek.published_at == NOW - 2 * 365 * DAY
    assert bek.description is not None and bek.description.startswith("Duration: 3 hours")
    shorts = {"H6ML7P19ySw", "vPYMZie__aM"}  # shortsLockupViewModel are left out
    assert not shorts & {h.video_id for h in hits}


def test_search_by_date_uses_sp_parameter():
    seen: list[dict[str, list[str]]] = []
    routes = {f"{BASE}/results": _search_route("search/en-rust-programming.date.html", seen)}
    client, router = make(routes)
    hits = client.search("rust programming", T.SearchOrder.date)
    assert seen[0]["sp"] == ["EgIIBA=="]  # "this month" filter: sorting by date is gone
    assert "sp=EgIIBA%3D%3D" in router.urls[0]
    assert len(hits) == 17
    client.search("rust programming", "date")  # the enum str also works
    assert seen[1]["sp"] == ["EgIIBA=="]


def test_search_videos_only_page_has_20_hits_with_fields():
    hits = Y.parse_search_payload(_read("search/en-rust-programming.videos.html"), now=NOW)
    assert len(hits) == 20
    assert all(h.duration_s and h.duration_s > 0 for h in hits)
    assert all(h.views is not None for h in hits)
    assert all(h.published_at is not None and h.published_at < NOW for h in hits)


@pytest.mark.parametrize(
    ("language", "query", "accept", "hl"),
    [
        ("pt-BR", "rust programming", "pt-BR", "pt-BR"),
        ("auto", "receita de pão caseiro", "pt-BR", "pt-BR"),
        ("auto", "rust programming", "en-US", "en"),
        ("en", "receita de pão caseiro", "en-US", "en"),
    ],
)
def test_search_language_header(language, query, accept, hl):
    seen: list[dict[str, list[str]]] = []
    rel = "search/pt-receita-de-pao-caseiro.relevance.pt-BR.html"
    client, router = make({f"{BASE}/results": _search_route(rel, seen)}, language=language)
    client.search(query)
    assert (router.header(0, "accept-language") or "").startswith(accept)
    assert seen[0]["hl"] == [hl]


def test_search_portuguese_interface_texts():
    seen: list[dict[str, list[str]]] = []
    rel = "search/pt-receita-de-pao-caseiro.relevance.pt-BR.html"
    client, _ = make({f"{BASE}/results": _search_route(rel, seen)}, language="pt-BR")
    hits = client.search("receita de pão caseiro")
    assert len(hits) == 13
    top = next(h for h in hits if h.views == 10472419)
    assert top.published_text == "há 6 anos"
    assert top.published_at == NOW - 6 * 365 * DAY
    assert top.duration_s == 10 * 60 + 43
    assert top.channel_title == "Amo Pão Caseiro"


@pytest.mark.parametrize("status", [429, 500, 404])
def test_search_http_error_is_youtube_error(status):
    client, _ = make({f"{BASE}/results": T.HttpResponse(status, "", {}, b"")})
    with pytest.raises(T.YouTubeError):
        client.search("rust")


def test_search_page_without_initial_data_is_youtube_error():
    client, _ = make({f"{BASE}/results": "<html>captcha</html>"})
    with pytest.raises(T.YouTubeError):
        client.search("rust")


@pytest.mark.parametrize(("query", "order"), [("", "relevance"), ("   ", "date"), ("x", "views")])
def test_search_invalid_input_is_validation_error(query, order):
    client, router = make()
    with pytest.raises(T.ValidationError):
        client.search(query, order)
    assert router.requests == []


# --------------------------------------------------------------------------- extension payload

SEARCH_FIXTURES = sorted(p.name for p in (YT / "search").glob("*.html"))


@pytest.mark.parametrize("name", SEARCH_FIXTURES)
def test_payload_parser_matches_fake_on_every_saved_search(name):
    text = _read(f"search/{name}")
    client, router = make()
    real = client.parse_search_payload(text)
    fake = fake_yt.parse_search(text)
    assert [(h.video_id, h.channel_id, h.title) for h in real] == [
        (h.video_id, h.channel_id, h.title.strip())
        for h in fake  # the real one strips leading/trailing spaces
    ]
    assert [h.duration_s for h in real] == [h.duration_s for h in fake]
    assert len(real) >= 10
    assert router.requests == []


def test_payload_accepts_dict_html_json_and_wrapper_with_same_result():
    rel = "search/en-rust-programming.relevance.html"
    data = initial_data(rel)
    client, router = make()
    from_html = client.parse_search_payload(_read(rel))
    assert client.parse_search_payload(data) == from_html
    assert client.parse_search_payload(json.dumps(data)) == from_html
    assert client.parse_search_payload({"ytInitialData": data}) == from_html
    assert client.parse_search_payload({"ytInitialData": json.dumps(data)}) == from_html
    seen: list[dict[str, list[str]]] = []
    searched, _ = make({f"{BASE}/results": _search_route(rel, seen)})
    assert searched.search("rust programming") == from_html
    assert router.requests == []


def test_payload_with_contents_but_no_videos_is_empty():
    client, _ = make()
    assert (
        client.parse_search_payload({"contents": {"sectionListRenderer": {"contents": []}}}) == []
    )


@pytest.mark.parametrize(
    "payload",
    [
        "",
        "not a page",
        "{broken json",
        "[1, 2]",
        {"foo": "bar"},
        {"ytInitialData": 3},
        [{"videoRenderer": {}}],
        42,
        None,
    ],
)
def test_payload_garbage_is_youtube_error(payload):
    client, _ = make()
    with pytest.raises(T.YouTubeError):
        client.parse_search_payload(payload)


def _video_renderer(video_id: str, **extra: Any) -> dict[str, Any]:
    vr: dict[str, Any] = {
        "videoId": video_id,
        "title": {"runs": [{"text": f"title {video_id}"}]},
        "ownerText": {
            "runs": [
                {
                    "text": "Chan",
                    "navigationEndpoint": {"browseEndpoint": {"browseId": FIRESHIP}},
                }
            ]
        },
    }
    vr.update(extra)
    return vr


def test_payload_live_and_odd_renderers():
    data = {
        "contents": [
            {
                "videoRenderer": _video_renderer(
                    "live0000001",
                    viewCountText={"runs": [{"text": "1,234"}, {"text": " watching"}]},
                )
            },
            {"videoRenderer": _video_renderer("nochan00001", ownerText={"runs": [{"text": "x"}]})},
            {"videoRenderer": {"videoId": 12}},
            {"videoRenderer": "oops"},
            {"videoRenderer": _video_renderer("dup00000001", lengthText={"simpleText": "0:59"})},
            {"videoRenderer": _video_renderer("dup00000001")},
            {"videoRenderer": _video_renderer("bad", lengthText={"simpleText": "SHORTS"})},
        ]
    }
    client, _ = make()
    hits = client.parse_search_payload(data)
    assert [h.video_id for h in hits] == ["live0000001", "dup00000001"]
    live, dup = hits
    assert live.duration_s is None and live.views is None and live.published_at is None
    assert dup.duration_s == 59


def test_lockup_view_model_videos_are_parsed():
    lockup = {
        "contentId": "lockup00001",
        "contentType": "LOCKUP_CONTENT_TYPE_VIDEO",
        "contentImage": {
            "thumbnailViewModel": {
                "overlays": [
                    {
                        "thumbnailBottomOverlayViewModel": {
                            "badges": [{"thumbnailBadgeViewModel": {"text": "12:34"}}]
                        }
                    }
                ]
            }
        },
        "metadata": {
            "lockupMetadataViewModel": {
                "title": {"content": "Lockup video"},
                "metadata": {
                    "contentMetadataViewModel": {
                        "metadataRows": [
                            {
                                "metadataParts": [
                                    {
                                        "text": {
                                            "content": "Some Channel",
                                            "commandRuns": [
                                                {
                                                    "onTap": {
                                                        "innertubeCommand": {
                                                            "browseEndpoint": {
                                                                "browseId": VERITASIUM
                                                            }
                                                        }
                                                    }
                                                }
                                            ],
                                        }
                                    }
                                ]
                            },
                            {
                                "metadataParts": [
                                    {"text": {"content": "1.2M views"}},
                                    {"text": {"content": "3 weeks ago"}},
                                ]
                            },
                        ]
                    }
                },
            }
        },
    }
    playlist = {"contentId": "PLxxxxxxxx", "contentType": "LOCKUP_CONTENT_TYPE_PLAYLIST"}
    data = {"contents": [{"lockupViewModel": playlist}, {"lockupViewModel": lockup}]}
    hits = Y.parse_search_payload(data, now=NOW)
    assert len(hits) == 1
    hit = hits[0]
    assert (hit.video_id, hit.title, hit.channel_id) == ("lockup00001", "Lockup video", VERITASIUM)
    assert hit.channel_title == "Some Channel"
    assert hit.duration_s == 12 * 60 + 34
    assert hit.views == 1_200_000
    assert hit.published_text == "3 weeks ago"
    assert hit.published_at == NOW - 21 * DAY


def test_lockup_from_channel_videos_page_uses_default_channel():
    text = (FIX / "mytube" / "youtube-channel-videos.html").read_text(encoding="utf-8")
    assert Y.parse_search_payload(text, now=NOW) == []  # no owner, nothing made up
    hits = Y.parse_search_payload(text, now=NOW, default_channel_id=FIRESHIP)
    assert [h.video_id for h in hits] == ["jxGJT1weu4w", "KOpTWx1Eou4", "YP73B9D20V4"]
    assert [h.duration_s for h in hits] == [287, 274, 309]
    assert hits[0].views == 509_000
    assert hits[0].published_at == NOW - DAY
    assert all(h.channel_id == FIRESHIP for h in hits)


# --------------------------------------------------------------------------- video details


@pytest.mark.parametrize(
    ("rel", "vid", "duration", "live", "upcoming", "channel"),
    [
        ("watch/normal.KfODG5REyss.html", "KfODG5REyss", 3955, False, False, VERITASIUM),
        (
            "watch/live-now.ROboUHfPUrU.html",
            "ROboUHfPUrU",
            None,
            True,
            False,
            "UCLA_DiR1FfKNvjuUpBHmylQ",
        ),
        (
            "watch/upcoming.9XM0lpVlvo0.html",
            "9XM0lpVlvo0",
            None,
            False,
            True,
            "UCSUu1lih2RifWkKtDOJdsBA",
        ),
        (
            "watch/live-ended.jfKfPfyJRdk.html",
            "jfKfPfyJRdk",
            121601512,
            False,
            False,
            "UCSJ4gkVC6NrvII8umztf0Ow",
        ),
    ],
)
def test_video_details_from_saved_pages(rel, vid, duration, live, upcoming, channel):
    url = f"{BASE}/watch?v={vid}"
    client, router = make({url: _read(rel)})
    details = client.video_details(vid)
    assert router.urls == [url]
    assert details.video_id == vid
    assert details.duration_s == duration
    assert details.is_live is live
    assert details.is_upcoming is upcoming
    assert details.channel_id == channel
    assert details.title


def test_video_details_errors():
    vid = "KfODG5REyss"
    url = f"{BASE}/watch?v={vid}"
    unavailable = page(
        "ytInitialPlayerResponse",
        {"playabilityStatus": {"status": "ERROR", "reason": "Video unavailable"}},
    )
    cases: list[Route] = [
        T.HttpResponse(404, url, {}, b""),
        T.HttpResponse(500, url, {}, b""),
        "<html>no player</html>",
        unavailable,
        page("ytInitialPlayerResponse", {"videoDetails": "x"}),
        page("ytInitialPlayerResponse", {"videoDetails": {"videoId": "otherid0000"}}),
    ]
    for route in cases:
        client, _ = make({url: route})
        with pytest.raises(T.YouTubeError) as err:
            client.video_details(vid)
        assert err.value.message
    client, _ = make({url: unavailable})
    with pytest.raises(T.YouTubeError, match="Video unavailable"):
        client.video_details(vid)


@pytest.mark.parametrize("bad", ["", "short", "KfODG5REyss/x", "../../etc", None])
def test_video_id_validation_without_network(bad):
    client, router = make()
    for call in (client.video_details, client.is_short, client.frame_url):
        with pytest.raises(T.ValidationError):
            call(bad)
    assert router.requests == []


# --------------------------------------------------------------------------- Short and frame


def test_is_short_200_vs_303_without_following_redirect():
    short = f"{BASE}/shorts/rL0qEmTRI-I"
    normal = f"{BASE}/shorts/KfODG5REyss"
    client, router = make(
        {
            short: head_fixture("shorts/short.rL0qEmTRI-I.txt"),
            normal: head_fixture("shorts/normal.KfODG5REyss.txt"),
            f"{BASE}/watch?v=KfODG5REyss": "should not be fetched",
        }
    )
    assert client.is_short("rL0qEmTRI-I") is True
    assert client.is_short("KfODG5REyss") is False
    assert router.urls == [short, normal]


@pytest.mark.parametrize(
    "response",
    [
        T.HttpResponse(404, "", {}, b""),
        T.HttpResponse(429, "", {}, b""),
        T.HttpResponse(500, "", {}, b""),
        T.HttpResponse(302, "", {"location": "https://consent.youtube.com/m?continue=x"}),
        T.HttpResponse(303, "", {}),
    ],
)
def test_is_short_errors(response):
    url = f"{BASE}/shorts/KfODG5REyss"
    client, router = make({url: response})
    with pytest.raises(T.YouTubeError):
        client.is_short("KfODG5REyss")
    assert set(router.urls) == {url}  # never follows the redirect


def test_is_short_relative_watch_redirect_is_not_short():
    url = f"{BASE}/shorts/KfODG5REyss"
    client, _ = make({url: T.HttpResponse(303, url, {"Location": "/watch?v=KfODG5REyss"})})
    assert client.is_short("KfODG5REyss") is False


def test_frame_url_has_no_network():
    client, router = make()
    assert client.frame_url("KfODG5REyss") == "https://i.ytimg.com/vi/KfODG5REyss/hq2.jpg"
    assert client.frame_url("KfODG5REyss") == FakeYouTube().frame_url("KfODG5REyss")
    assert router.requests == []


# --------------------------------------------------------------------------- no stray exception

GARBAGE_PAGES = [
    "",
    "\x00\xff",
    '<script>var ytInitialData = {"a": [</script>',
    page("ytInitialData", {"contents": {"a": [None, 1, "x", {"videoRenderer": None}]}}),
    page("ytInitialData", {"header": {"c4TabbedHeaderRenderer": []}, "metadata": None}),
    page("ytInitialPlayerResponse", {"videoDetails": {"lengthSeconds": "abc"}}),
    page("ytInitialPlayerResponse", []),
    "<feed><entry><published>ontem</published></entry></feed>",
]


@pytest.mark.parametrize("body", GARBAGE_PAGES)
def test_garbage_pages_never_raise_loose_exceptions(body):
    routes: dict[str, Route] = {
        f"{BASE}/feeds/videos.xml": body,
        f"{BASE}/@fireship": body,
        f"{BASE}/results": body,
        f"{BASE}/watch": body,
    }
    client, _ = make(routes)
    calls = [
        lambda: client.fetch_channel_rss(FIRESHIP),
        lambda: client.resolve_channel("@Fireship"),
        lambda: client.search("x"),
        lambda: client.parse_search_payload(body),
        lambda: client.video_details("KfODG5REyss"),
    ]
    for call in calls:
        try:
            call()
        except T.YouTubeError as err:
            assert err.message
        except Exception as err:  # noqa: BLE001
            pytest.fail(f"stray exception: {type(err).__name__}: {err}")


def test_unexpected_http_exception_becomes_youtube_error():
    class Boom:
        def get(self, *a: Any, **k: Any) -> T.HttpResponse:
            raise KeyError("boom")

        def download_to(self, *a: Any, **k: Any) -> int:
            raise KeyError("boom")

    client = Y.build(http=Boom(), settings=FakeSettings(), clock=FakeClock(NOW))
    with pytest.raises(T.YouTubeError):
        client.fetch_channel_rss(FIRESHIP)
    with pytest.raises(T.YouTubeError):
        client.is_short("KfODG5REyss")


# --------------------------------------------------------------------------- texts


@pytest.mark.parametrize(
    ("text", "ago"),
    [
        ("2y ago", 2 * 365 * DAY),
        ("3mo ago", 3 * 30 * DAY),
        ("2w ago", 14 * DAY),
        ("11d ago", 11 * DAY),
        ("16h ago", 16 * 3600),
        ("1 day ago", DAY),
        ("5 minutes ago", 300),
        ("30 seconds ago", 30),
        ("Streamed 3 days ago", 3 * DAY),
        ("Premiered 1 year ago", 365 * DAY),
        ("há 6 anos", 6 * 365 * DAY),
        ("há 1 ano", 365 * DAY),
        ("há 5 meses", 5 * 30 * DAY),
        ("há 1 mês", 30 * DAY),
        ("há 2 semanas", 14 * DAY),
        ("há 3 dias", 3 * DAY),
        ("há 4 horas", 4 * 3600),
        ("há 10 minutos", 600),
        ("Transmitido há 2 dias", 2 * DAY),
    ],
)
def test_parse_relative_time(text, ago):
    assert Y.parse_relative_time(text, NOW) == NOW - ago


@pytest.mark.parametrize("text", [None, "", "yesterday", "Scheduled for 11/13/26", "há muito"])
def test_parse_relative_time_unknown(text):
    assert Y.parse_relative_time(text, NOW) is None


@pytest.mark.parametrize(
    ("text", "value"),
    [
        ("676,779 views", 676779),
        ("1 view", 1),
        ("No views", 0),
        ("10.472.419 visualizações", 10472419),
        ("1 visualização", 1),
        ("Nenhuma visualização", 0),
        ("509K views", 509_000),
        ("2.6M", 2_600_000),
        ("1.2B views", 1_200_000_000),
        ("10\u00a0mi", 10_000_000),
        ("94 mil visualizações", 94_000),
        ("1,5 mi de visualizações", 1_500_000),
        ("2 bi", 2_000_000_000),
        ("1,234 watching", None),
        ("12 assistindo", None),
        ("", None),
        (None, None),
        ("views", None),
    ],
)
def test_parse_count(text, value):
    assert Y.parse_count(text) == value


@pytest.mark.parametrize(
    ("text", "value"),
    [
        ("3:05:04", 11104),
        ("10:43", 643),
        ("0:59", 59),
        (" 1:00:00 ", 3600),
        ("SHORTS", None),
        ("LIVE", None),
        ("", None),
        (None, None),
        ("1:99", None),
    ],
)
def test_parse_duration(text, value):
    assert Y.parse_duration(text) == value


# ----------------------------------------------------------------- fallback: /videos page

MKBHD = "UCBJycsmduvYEL83R_U4JriQ"
MISSING = "UCzzzzzzzzzzzzzzzzzzzzzz"
LEGACY = "UCfix1legacysynthetic000"


def videos_url(channel_id: str) -> str:
    return f"{BASE}/channel/{channel_id}/videos"


def test_rss_404_and_5xx_are_feed_outage_not_missing_channel():
    """Rule 1: RSS 404/5xx says the *feed* is down, never that the channel is gone."""
    for status in (404, 500, 503):
        url = f"{BASE}/feeds/videos.xml?channel_id={FIRESHIP}"
        client, _ = make({url: T.HttpResponse(status, url, {}, b"<html>err</html>")})
        with pytest.raises(T.YouTubeError) as info:
            client.fetch_channel_rss(FIRESHIP)
        details = info.value.details
        assert details["status"] == status
        assert details.get("feed_unavailable") is True
        assert not details.get("channel_missing")
        assert Y.is_feed_outage(info.value) is True
        assert Y.is_channel_missing(info.value) is False
    assert Y.is_feed_outage(T.YouTubeError("timeout", reason="timeout")) is False


def test_channel_uploads_lockup_format_real_page():
    """Current format (``lockupViewModel``), a trimmed real page captured while RSS was down."""
    client, router = make({videos_url(FIRESHIP): _read(f"channel_videos.{FIRESHIP}.html")})
    feed = client.fetch_channel_uploads(FIRESHIP)
    assert isinstance(feed, T.RssFeed)  # same type as RSS
    assert Y.dates_are_approximate(feed) is True
    assert not Y.dates_are_approximate(T.RssFeed(channel=feed.channel, videos=()))
    req = router.requests[0]
    assert req.url.startswith(videos_url(FIRESHIP))
    assert (router.header(0, "accept-language") or "").startswith("en-US")
    assert "SOCS=CAI" in (router.header(0, "cookie") or "")
    assert feed.channel.id == FIRESHIP
    assert feed.channel.title == "Fireship"
    assert feed.channel.url == f"{BASE}/channel/{FIRESHIP}"
    assert len(feed.videos) == Y.RSS_MAX_VIDEOS  # the page carries 30; the RSS cap applies
    first = feed.videos[0]
    assert first.id == "pf5tXJZM1Rw"
    assert first.title == "OpenAI spent $1.2 million hacking Linux... and it was a bargain"
    assert first.published_at == NOW - 4 * 3600  # "4h ago"
    assert first.duration_s == 6 * 60 + 30
    assert first.views == 472_000  # "472K"
    assert first.is_short is None  # a Short does not show in /videos; handled as RSS does
    assert first.channel_id == FIRESHIP and first.channel_title == "Fireship"
    assert first.description is None
    by_id = {v.id: v for v in feed.videos}
    assert by_id["iw9SZgyahqg"].published_at == NOW - 3 * DAY  # "3d ago"
    assert by_id["nEaJMdM1djM"].published_at == NOW - 12 * DAY  # "12d ago"
    assert by_id["G_em1hHPnXY"].published_at == NOW - 14 * DAY  # "2w ago"
    assert by_id["WrCjAAl9okA"].published_at == NOW - 30 * DAY  # "1mo ago"
    assert by_id["iw9SZgyahqg"].views == 1_900_000  # "1.9M"
    assert all(v.channel_id == FIRESHIP for v in feed.videos)
    assert all(v.duration_s for v in feed.videos)
    stamps = [v.published_at or 0 for v in feed.videos]
    assert stamps == sorted(stamps, reverse=True)
    assert len({v.id for v in feed.videos}) == len(feed.videos)


def test_channel_uploads_collab_video_keeps_page_channel():
    """Collaboration video ("Veritasium", "and 2swap" on the 1st line): owner = the page channel."""
    client, _ = make({videos_url(VERITASIUM): _read(f"channel_videos.{VERITASIUM}.html")})
    feed = client.fetch_channel_uploads(VERITASIUM)
    collab = next(v for v in feed.videos if v.id == "kS-CGkiPetQ")
    assert collab.channel_id == VERITASIUM
    assert collab.views == 8_900_000
    assert collab.published_at == NOW - 5 * 30 * DAY  # "5mo ago"
    assert feed.videos[0].id == "KfODG5REyss"
    assert feed.videos[0].published_at == NOW - 5 * DAY


def test_channel_uploads_legacy_video_renderer_format_synthetic():
    """Old format (``richItemRenderer > videoRenderer`` and ``gridVideoRenderer``), synthetic,
    built from the saved search ``videoRenderer`` items (declared in the fixture header)."""
    client, _ = make({videos_url(LEGACY): _read("channel_videos.legacy.synthetic.html")})
    feed = client.fetch_channel_uploads(LEGACY)
    assert Y.dates_are_approximate(feed)
    assert feed.channel.id == LEGACY and feed.channel.title == "area-44 Legacy (synthetic)"
    got = {v.id: v for v in feed.videos}
    expected_age = {
        "5C_HPTJg5ek": 3 * 60,  # 3 minutes ago
        "0y6RKiIk6cs": 5 * 3600,  # 5 hours ago
        "rQ_J9WH6CGk": 2 * DAY,  # Streamed 2 days ago
        "BpPEoZW5IiY": 21 * DAY,  # 3 weeks ago
        "MoqtsYLGCC4": 4 * 30 * DAY,  # 4 months ago
        "VXbRd5J0vNU": 365 * DAY,  # 1 year ago
        "IT0187cHGfI": 2 * 365 * DAY,  # Premiered 2 years ago (gridVideoRenderer)
    }
    for video_id, age in expected_age.items():
        assert got[video_id].published_at == NOW - age, video_id
        assert got[video_id].duration_s, video_id
        assert got[video_id].views, video_id
        assert got[video_id].channel_id == LEGACY
    # live and scheduled: no age or duration, but the video comes through (RSS has them too)
    assert got["fix1live001"].published_at is None and got["fix1live001"].duration_s is None
    assert got["fix1live001"].views is None
    assert got["fix1upcom01"].published_at is None
    assert [v.id for v in feed.videos][-2:] == ["fix1live001", "fix1upcom01"]
    assert [v.id for v in feed.videos][:7] == list(expected_age)


def _lockup_item(video_id: str, age: str, label: str | None = None) -> dict[str, Any]:
    part: dict[str, Any] = {"text": {"content": age}}
    if label:
        part["accessibilityLabel"] = label
    return {
        "richItemRenderer": {
            "content": {
                "lockupViewModel": {
                    "contentId": video_id,
                    "contentType": "LOCKUP_CONTENT_TYPE_VIDEO",
                    "metadata": {
                        "lockupMetadataViewModel": {
                            "title": {"content": f"title {video_id}"},
                            "metadata": {
                                "contentMetadataViewModel": {
                                    "metadataRows": [
                                        {
                                            "metadataParts": [
                                                {
                                                    "text": {"content": "12K"},
                                                    "accessibilityLabel": "12 thousand views",
                                                    "leadingIcon": {"name": "PLAY_ARROW_OUTLINED"},
                                                },
                                                part,
                                            ]
                                        }
                                    ]
                                }
                            },
                        }
                    },
                }
            }
        }
    }


def _uploads_page(channel_id: str, items: list[dict[str, Any]], *, tab: str = "videos") -> str:
    data = {
        "contents": {
            "twoColumnBrowseResultsRenderer": {
                "tabs": [
                    {
                        "tabRenderer": {
                            "title": tab.title(),
                            "selected": True,
                            "endpoint": {
                                "commandMetadata": {"webCommandMetadata": {"url": f"/@x/{tab}"}}
                            },
                            "content": {"richGridRenderer": {"contents": items}},
                        }
                    }
                ]
            }
        },
        "metadata": {"channelMetadataRenderer": {"title": "Canal X", "externalId": channel_id}},
    }
    return page("ytInitialData", data)


@pytest.mark.parametrize(
    ("text", "label", "ago"),
    [
        ("30 seconds ago", None, 30),
        ("5 minutes ago", None, 5 * 60),
        ("1 minute ago", None, 60),
        ("4h ago", "4 hours ago", 4 * 3600),
        ("1 hour ago", None, 3600),
        ("3d ago", "3 days ago", 3 * DAY),
        ("1 day ago", None, DAY),
        ("2w ago", "2 weeks ago", 14 * DAY),
        ("1 week ago", None, 7 * DAY),
        ("1mo ago", "1 month ago", 30 * DAY),
        ("11 months ago", None, 11 * 30 * DAY),
        ("2y ago", "2 years ago", 2 * 365 * DAY),
        ("1 year ago", None, 365 * DAY),
        ("Streamed 3 hours ago", None, 3 * 3600),
        ("Streamed 2 weeks ago", None, 14 * DAY),
        ("Premiered 6 days ago", None, 6 * DAY),
        ("?", "5 days ago", 5 * DAY),  # short unreadable text: the accessibility label applies
    ],
)
def test_channel_uploads_relative_time_texts(text, label, ago):
    html = _uploads_page(FIRESHIP, [_lockup_item("abcdefghijk", text, label)])
    client, _ = make({videos_url(FIRESHIP): html})
    (video,) = client.fetch_channel_uploads(FIRESHIP).videos
    assert video.published_at == NOW - ago
    assert video.views == 12_000


def test_channel_uploads_parser_is_pure_and_accepts_dict():
    data = initial_data(f"channel_videos.{FIRESHIP}.html")
    feed = Y.parse_channel_uploads(data, now=NOW, channel_id=FIRESHIP)
    assert feed.videos[0].id == "pf5tXJZM1Rw"
    with pytest.raises(T.YouTubeError):
        Y.parse_channel_uploads(data, now=NOW, channel_id=VERITASIUM)  # another page


def test_channel_without_videos_tab_gives_empty_feed():
    """Channel without a Videos tab: YouTube serves Home; nothing there becomes a channel upload."""
    html = _uploads_page(FIRESHIP, [_lockup_item("abcdefghijk", "2 days ago")], tab="featured")
    client, _ = make({videos_url(FIRESHIP): html})
    feed = client.fetch_channel_uploads(FIRESHIP)
    assert feed.channel.id == FIRESHIP and feed.videos == ()


def test_channel_uploads_missing_channel_alert_page_is_404():
    """Measured on 11/10 01:25 UTC: missing channel → HTTP **200** with an ERROR ``alerts``
    ("This channel does not exist."). Counts as a page 404."""
    client, _ = make({videos_url(MISSING): _read(f"channel_videos.missing.{MISSING}.html")})
    with pytest.raises(T.YouTubeError) as info:
        client.fetch_channel_uploads(MISSING)
    assert info.value.details["status"] == 404
    assert Y.is_channel_missing(info.value) is True
    assert "does not exist" in info.value.message


def test_channel_uploads_http_404_is_missing_but_5xx_is_not():
    url = videos_url(FIRESHIP)
    client, _ = make({url: T.HttpResponse(404, url, {}, b"<html>404</html>")})
    with pytest.raises(T.YouTubeError) as info:
        client.fetch_channel_uploads(FIRESHIP)
    assert Y.is_channel_missing(info.value) is True
    client, _ = make({url: T.HttpResponse(500, url, {}, b"<html>500</html>")})
    with pytest.raises(T.YouTubeError) as info:
        client.fetch_channel_uploads(FIRESHIP)
    assert info.value.details["status"] == 500
    assert Y.is_channel_missing(info.value) is False


@pytest.mark.parametrize(
    "body", ["<html>sem dados</html>", "{}", "", "<html>var ytInitialData = [1];"]
)
def test_channel_uploads_garbage_is_youtube_error(body):
    client, _ = make({videos_url(FIRESHIP): body})
    with pytest.raises(T.YouTubeError) as info:
        client.fetch_channel_uploads(FIRESHIP)
    assert not Y.is_channel_missing(info.value)


def test_channel_uploads_validates_id_without_network():
    client, router = make()
    with pytest.raises(T.ValidationError):
        client.fetch_channel_uploads("Fireship")
    assert router.requests == []


# --------------------------------------------------------------------------- live (outside check)


@pytest.fixture
def live_client() -> Any:
    st = FakeSettings()
    return Y.build(http=H.build(settings=st), settings=st)


@pytest.mark.live
def test_live_channel_uploads_vs_rss(live_client):
    """Fallback × RSS on 3 channels. RSS up: the recent regular RSS videos show on the page with a
    consistent approximate date. RSS down: only checks that the page gives ≥ 10 videos."""
    report: list[str] = []
    for channel_id in (FIRESHIP, VERITASIUM, MKBHD):
        page_feed = live_client.fetch_channel_uploads(channel_id)
        assert page_feed.channel.id == channel_id
        assert len(page_feed.videos) >= 10, channel_id
        assert all(v.published_at for v in page_feed.videos[:10])
        try:
            rss = live_client.fetch_channel_rss(channel_id)
        except T.YouTubeError as err:
            assert Y.is_feed_outage(err), err.message
            report.append(f"{channel_id}: RSS down ({err.details.get('status')}), page ok")
            continue
        page_by_id = {v.id: v for v in page_feed.videos}
        oldest_page = min(v.published_at or 0 for v in page_feed.videos)
        normal = [v for v in rss.videos if not v.is_short and (v.published_at or 0) > oldest_page]
        common = [v for v in normal if v.id in page_by_id]
        assert len(common) >= max(1, len(normal) - 2), channel_id  # premiere/live may be missing
        for v in common:
            exact = v.published_at or 0
            approx = page_by_id[v.id].published_at or 0
            age = max(live_client._now() - exact, 3600)
            assert abs(approx - exact) <= max(0.5 * age, 2 * 3600), (v.id, exact, approx)
        report.append(f"{channel_id}: RSS up, {len(common)} in common")
    print("; ".join(report))


@pytest.mark.live
def test_live_fetch_channel_rss(live_client):
    try:
        feed = live_client.fetch_channel_rss(FIRESHIP)
    except T.YouTubeError as err:
        if Y.is_feed_outage(err):  # known outage of the feed server: not our bug
            pytest.skip(f"YouTube RSS is down right now: {err.message}")
        raise
    assert feed.channel.id == FIRESHIP and feed.videos


@pytest.mark.live
def test_live_resolve_channel(live_client):
    assert live_client.resolve_channel("@Fireship").id == FIRESHIP


@pytest.mark.live
def test_live_search(live_client):
    assert len(live_client.search("rust programming", T.SearchOrder.date)) >= 5


@pytest.mark.live
def test_live_video_details(live_client):
    assert live_client.video_details("KfODG5REyss").duration_s


@pytest.mark.live
def test_live_is_short(live_client):
    assert live_client.is_short("rL0qEmTRI-I") is True
