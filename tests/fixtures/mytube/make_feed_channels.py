"""Gera as páginas SINTÉTICAS de /feed/channels (a real exige login).

Estrutura derivada do que o scraper do MyTube v0.9.0 lê:

- ytInitialData: ref/mytube/src/content/scraper.ts:340-372 (marcador ``var ytInitialData = ``,
  JSON recortado por contagem de chaves — por isso nenhuma string aqui contém ``{`` ou ``}``),
  busca recursiva por ``gridChannelRenderer`` / ``channelRenderer`` / ``lockupViewModel``
  (scraper.ts:101-128) e campos lidos em scraper.ts:130-221.
- DOM (fallback quando ytInitialData não rende canais): ref/mytube/src/shared/selectors.ts:15-18
  (``subscriptionItem``, ``subscriptionItemName``, ``subscriptionItemLink``,
  ``subscriptionItemAvatar``), usados em scraper.ts:269-302.

Saídas:
- ``feed-channels.synthetic.html``          ytInitialData (3 formas de renderer) + DOM coerente
- ``feed-channels.dom-only.synthetic.html`` só DOM (sem ytInitialData) → exercita o fallback

Canais e IDs são reais (verificados em 09/11/2026); o layout é sintético.
Uso: python -I tests/fixtures/mytube/make_feed_channels.py
"""

from __future__ import annotations

import html
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
A = "//yt3.googleusercontent.com/"

# (channelId, título, handle na URL, avatar sem esquema)
CHANNELS = [
    (
        "UCHnyfMqiRRG1u-2MsSQLbXA",
        "Veritasium",
        "veritasium",
        A
        + "7vCbvtCqtjQ3YLgsJt7Y952MQV1sBvhllSCSxHP8_sVZdcPCBrITfhkN2RdyCuwPnsByq-1GoA=s900-c-k-c0x00ffffff-no-rj",
    ),
    (
        "UCsBjURrPoezykLs9EqgamOA",
        "Fireship",
        "Fireship",
        A
        + "3fPNbkf_xPyCleq77ZhcxyeorY97NtMHVNUbaAON_RBDH9ydL4hJkjxC8x_4mpuopkB8oI7Ct6Y=s900-c-k-c0x00ffffff-no-rj",
    ),
    (
        "UCYO_jab_esuFRV4b17AJtAw",
        "3Blue1Brown",
        "3blue1brown",
        A
        + "ytc/AIdro_nFzZFPLxPZRHcE3SSwzdrbuWqfoWYwLAu0_2iO6blQYAU=s900-c-k-c0x00ffffff-no-rj",
    ),
    (
        "UCsXVk37bltHxD1rDPwtNM8Q",
        "Kurzgesagt – In a Nutshell",
        "kurzgesagt",
        A
        + "ytc/AIdro_n1Ribd7LwdP_qKtqWL3ZDfIgv9M1d6g78VwpHGXVR2Ir4=s900-c-k-c0x00ffffff-no-rj",
    ),
    (
        "UCKHhA5hN2UohhFDfNXB_cvQ",
        "Manual do Mundo",
        "manualdomundo",
        A
        + "eeXFm7_mIItuMYmrE9HRFjtwjXEG6Qvs7yJTZBdHmNyFwbi1v28gDd3tQ9JjzsjE1lSTOtb_=s900-c-k-c0x00ffffff-no-rj",
    ),
    (
        "UCn9Erjy00mpnWeLnRqhsA1g",
        "Ciência Todo Dia",
        "CienciaTodoDia",
        A
        + "ytc/AIdro_lQoeh3pIl35H0tiDQ6fG3YeSrn2hWxKKCIxN11NQvnDdg=s900-c-k-c0x00ffffff-no-rj",
    ),
    (
        "UCLA_DiR1FfKNvjuUpBHmylQ",
        "NASA",
        "NASA",
        A
        + "eIf5fNPcIcj9ig-wZBeq4stFy1lgjWTW1nLT5dYlFkHZprZ03QBiMcbpwNMB6XSBjrSFGtAGQg=s900-c-k-c0x00ffffff-no-rj",
    ),
    (
        "UC9-y-6csu5WGm29I7JiwpnA",
        "Computerphile",
        "Computerphile",
        A
        + "ebHMyRfch3u2UTZN1WQJDp9J5U7o38T_WnGkd2QhAIQwBgvozdaOCOnfDMtngtoHWutJvLl4i0c=s900-c-k-c0x00ffffff-no-rj",
    ),
    (
        "UCSUu1lih2RifWkKtDOJdsBA",
        "NASASpaceflight",
        "NASASpaceflight",
        A
        + "nDf29MGJSu5YrnAAdL2ofQsOTaOb74D7ILcgIr_7xJNJMSaGMcv5I366SF32oSUM7VO6PHYQpQ=s900-c-k-c0x00ffffff-no-rj",
    ),
    (
        "UCj1VqrHhDte54oLgPG4xpuQ",
        "Stuff Made Here",
        None,  # sem handle: link /channel/UC…
        A
        + "ytc/AIdro_mzfzJ9E1WEzyt1YlPXemHOwGBBnVCKzXva_mzmS5qqMg=s900-c-k-c0x00ffffff-no-rj",
    ),
]


def path_of(cid: str, handle: str | None) -> str:
    return f"/@{handle}" if handle else f"/channel/{cid}"


def channel_renderer(cid, title, handle, avatar) -> dict:
    """Forma clássica: scraper.ts:178-213 (channelId, title.simpleText, thumbnail, navigationEndpoint)."""
    p = path_of(cid, handle)
    return {
        "channelRenderer": {
            "channelId": cid,
            "title": {"simpleText": title},
            "navigationEndpoint": {
                "commandMetadata": {
                    "webCommandMetadata": {
                        "url": p,
                        "webPageType": "WEB_PAGE_TYPE_CHANNEL",
                    }
                },
                "browseEndpoint": {"browseId": cid, "canonicalBaseUrl": p},
            },
            "thumbnail": {
                "thumbnails": [
                    {
                        "url": avatar.replace("=s900-", "=s88-"),
                        "width": 88,
                        "height": 88,
                    },
                    {
                        "url": avatar.replace("=s900-", "=s176-"),
                        "width": 176,
                        "height": 176,
                    },
                ]
            },
            "subscriberCountText": {"simpleText": f"@{handle}" if handle else title},
            "subscriptionButton": {"subscribed": True},
        }
    }


def grid_channel_renderer(cid, title, handle, avatar) -> dict:
    """Forma em grade: mesmo ramo de scraper.ts:178-213, com title.runs e sem webCommandMetadata."""
    p = path_of(cid, handle)
    return {
        "gridChannelRenderer": {
            "channelId": cid,
            "title": {"runs": [{"text": title}]},
            "navigationEndpoint": {
                "browseEndpoint": {"browseId": cid, "canonicalBaseUrl": p}
            },
            "thumbnail": {
                "thumbnails": [
                    {
                        "url": avatar.replace("=s900-", "=s88-"),
                        "width": 88,
                        "height": 88,
                    }
                ]
            },
        }
    }


def lockup_view_model(cid, title, handle, avatar, content_id=None) -> dict:
    """Forma nova: scraper.ts:137-177 (contentId, metadata.lockupMetadataViewModel.title.content,
    rendererContext.commandContext.onTap.innertubeCommand.browseEndpoint). Este ramo NÃO lê avatar."""
    p = path_of(cid, handle)
    return {
        "lockupViewModel": {
            "contentId": content_id or cid,
            "contentType": "LOCKUP_CONTENT_TYPE_CHANNEL",
            "contentImage": {
                "collectionThumbnailViewModel": {
                    "primaryThumbnail": {
                        "thumbnailViewModel": {
                            "image": {
                                "sources": [
                                    {
                                        "url": avatar.replace("=s900-", "=s88-"),
                                        "width": 88,
                                        "height": 88,
                                    }
                                ]
                            }
                        }
                    }
                }
            },
            "metadata": {"lockupMetadataViewModel": {"title": {"content": title}}},
            "rendererContext": {
                "commandContext": {
                    "onTap": {
                        "innertubeCommand": {
                            "browseEndpoint": {"browseId": cid, "canonicalBaseUrl": p}
                        }
                    }
                }
            },
        }
    }


def initial_data() -> dict:
    c = CHANNELS
    classic = [channel_renderer(*x) for x in c[0:6]]
    classic.append(
        channel_renderer(*c[0])
    )  # duplicata: o scraper deduplica por channelId (scraper.ts:250-253)
    grid = [grid_channel_renderer(*x) for x in c[6:8]]
    lockups = [lockup_view_model(*c[8]), lockup_view_model(*c[9])]
    # contentId "@handle" + browseId UC…: o browseId prevalece (scraper.ts:138-166)
    lockups[0]["lockupViewModel"]["contentId"] = "@NASASpaceflight"
    return {
        "responseContext": {"serviceTrackingParams": []},
        "contents": {
            "twoColumnBrowseResultsRenderer": {
                "tabs": [
                    {
                        "tabRenderer": {
                            "selected": True,
                            "content": {
                                "sectionListRenderer": {
                                    "contents": [
                                        {
                                            "itemSectionRenderer": {
                                                "contents": [
                                                    {
                                                        "shelfRenderer": {
                                                            "title": {
                                                                "runs": [
                                                                    {"text": "A-Z"}
                                                                ]
                                                            },
                                                            "content": {
                                                                "expandedShelfContentsRenderer": {
                                                                    "items": classic
                                                                }
                                                            },
                                                        }
                                                    },
                                                    {"gridRenderer": {"items": grid}},
                                                    {
                                                        "richGridRenderer": {
                                                            "contents": [
                                                                {
                                                                    "richItemRenderer": {
                                                                        "content": l
                                                                    }
                                                                }
                                                                for l in lockups
                                                            ]
                                                        }
                                                    },
                                                ]
                                            }
                                        }
                                    ]
                                }
                            },
                        }
                    }
                ]
            }
        },
        "header": {
            "feedTabbedHeaderRenderer": {
                "title": {"runs": [{"text": "All subscriptions"}]}
            }
        },
    }


def dom_items() -> str:
    """Um item por canal, alternando as 3 formas que selectors.ts:15-18 aceitam."""
    out = []
    for i, (cid, title, handle, avatar) in enumerate(CHANNELS):
        href = "https://www.youtube.com" + path_of(cid, handle)
        t, h, a = (
            html.escape(title),
            html.escape(href),
            html.escape("https:" + avatar.replace("=s900-", "=s88-")),
        )
        kind = i % 3
        if kind == 0:  # ytd-channel-renderer + #channel-info + #avatar img
            out.append(
                f'<ytd-channel-renderer class="style-scope ytd-expanded-shelf-contents-renderer">\n'
                f'  <div id="avatar-section"><a id="main-link" href="{h}"><yt-img-shadow id="avatar">'
                f'<img id="img" src="{a}" width="136"></yt-img-shadow></a></div>\n'
                f'  <div id="info-section"><a id="channel-info" href="{h}">'
                f'<ytd-channel-name id="channel-title"><yt-formatted-string id="text">{t}</yt-formatted-string>'
                f"</ytd-channel-name></a></div>\n"
                f'  <div id="buttons"><ytd-subscribe-button-renderer subscribed><button aria-label="Unsubscribe from {t}">'
                f"Subscribed</button></ytd-subscribe-button-renderer></div>\n"
                f"</ytd-channel-renderer>"
            )
        elif (
            kind == 1
        ):  # ytd-grid-channel-renderer + #main-link + #info #text + #img img
            out.append(
                f'<ytd-grid-channel-renderer class="style-scope ytd-grid-renderer">\n'
                f'  <a id="main-link" href="{h}"><div id="img"><img src="{a}"></div>\n'
                f'  <div id="info"><span id="text">{t}</span></div></a>\n'
                f"</ytd-grid-channel-renderer>"
            )
        else:  # yt-lockup-view-model + classes wiz
            out.append(
                f'<yt-lockup-view-model class="ytd-rich-item-renderer lockup">\n'
                f'  <div class="yt-lockup-view-model-wiz__content-image"><img src="{a}"></div>\n'
                f'  <div class="yt-lockup-view-model-wiz__metadata">'
                f'<a class="yt-lockup-metadata-view-model-wiz__title" href="{h}">{t}</a></div>\n'
                f"</yt-lockup-view-model>"
            )
    return "\n".join(out)


HEAD = """<!doctype html>
<!-- SINTÉTICO — formato do MyTube v0.9.0 (scraper.ts, selectors.ts). Ver tests/fixtures/README.md.
     A página real https://www.youtube.com/feed/channels exige login e NÃO foi baixada. -->
<html lang="en"><head><meta charset="utf-8"><title>Subscriptions - YouTube</title>
<link rel="canonical" href="https://www.youtube.com/feed/channels">
"""


def page(with_data: bool) -> str:
    parts = [HEAD]
    if with_data:
        data = json.dumps(initial_data(), ensure_ascii=False, separators=(",", ":"))
        assert "{" not in "".join(
            json.loads(data).__repr__().split("'")[1::2]
        )  # nenhuma string com chaves
        parts.append(
            f'<script nonce="synthetic">var ytInitialData = {data};</script>\n'
        )
    parts.append(
        '</head><body>\n<ytd-app><ytd-page-manager id="page-manager"><ytd-browse page-subtype="subscriptions">\n'
        '<div id="contents">\n'
    )
    parts.append(dom_items())
    parts.append(
        "\n</div>\n</ytd-browse></ytd-page-manager></ytd-app>\n</body></html>\n"
    )
    return "".join(parts)


def main() -> None:
    (HERE / "feed-channels.synthetic.html").write_text(page(True), encoding="utf-8")
    (HERE / "feed-channels.dom-only.synthetic.html").write_text(
        page(False), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
