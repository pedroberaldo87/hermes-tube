# HermesTube

Take back control of what you watch. HermesTube brings your YouTube subscriptions into Hermes. There you organize them
into folders and tags, build your own tabs, and see at a glance what's new from the channels you care about. Your
Hermes model does the boring part: it suggests folders and builds a whole tab from a topic you type. There's no
sign-up and no server on our side: we collect nothing, and your data stays on your machine. A small browser extension
hooks up your YouTube account, and it never unsubscribes from anything unless you click. You pick what you watch. Not
the algorithm.

**English** · [Português](README.pt-BR.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
![Hermes Agent ≥ 0.23.1](https://img.shields.io/badge/Hermes%20Agent-%E2%89%A5%200.23.1-blueviolet)
![Chrome 120+, Manifest V3](https://img.shields.io/badge/Chrome-120%2B%20%C2%B7%20Manifest%20V3-4285F4)

![HermesTube cover image with the project name](assets/hermes-tube.jpg)

![The Subscriptions section of HermesTube in Hermes Desktop with sample data: the tab bar across the top, the tab of all new videos selected, and a grid of new videos, each card with a line saying why it is there](docs/screenshots/home.png)

All screenshots use sample data invented for this project: made-up channels and videos, no real account.

## About

**What it is.** HermesTube is a plugin for Hermes Agent. It adds a page to Hermes Desktop, tools the agent can call,
a `/tube` command and optional scheduled routines. A companion Chrome extension, shipped with the plugin and loaded
by you, is the only part that touches your YouTube account. It is an independent project, formerly MyTube, and is
not made by or affiliated with YouTube, Google or Nous Research.

**Who it is for.** People who follow a lot of YouTube channels and want to see them their own way, not in one long
list ranked by YouTube. It helps most if you already use Hermes and have a model set up there.

**What it does.**
- A Subscriptions section with your own tabs: by folder and tag, by hand-picked channels, by topic, or mixed. Each
  video says why it is in the tab.
- A folder pane, and a Manage table with batch actions and undo.
- "Organize with Hermes": your model proposes folders and tags; you accept or reject them by group.
- Topic tabs: type a topic, the model plans YouTube searches, keeps what fits and says why.
- Videos play in the Watch section with Hermes's own embedded player, next to an Up next list.
- Ask the agent in the chat what's new on YouTube today; it answers from your own tabs.
- Playlists of your own: add any video to a playlist from its card or from the player, and play one from the
  Playlists tab. They live in HermesTube on your computer, not on your YouTube account.

**New in this first version, run end to end only on a small scale.** They are covered by automated tests and were
run on one real YouTube account and one real Telegram chat (what ran is listed at the end of Features); treat them as
experimental until a release says otherwise.
- Cleanup: fixed rules pick inactive and unwatched channels and the model explains why. You approve in Hermes, you
  click Run now in the extension, and only then does it unsubscribe, one channel at a time, in a visible tab.
  Ex-subscriptions keep a Resubscribe button for 30 days.
- `/tube` with buttons on Telegram, and five routines on Hermes's scheduler.
- Video cards in the Desktop chat, and a HermesTube section with your folders in the left menu of youtube.com.

**What it does not do.**
- It does not use the official YouTube API and does not log in to YouTube. The plugin reads public pages; account
  actions happen in your own browser through the extension. YouTube's Terms of Service may not allow this kind of
  automated access: use HermesTube at your own risk.
- It never unsubscribes on its own. The AI, the agent tools and the routines only build lists.
- No cloud, no account, no API key of its own, no telemetry.
- It does not download videos.
- English and Brazilian Portuguese only. The extension is not on the Chrome Web Store yet: the plugin ships it, and
  you load it in Chrome yourself.

## Features

- A Subscriptions section with built-in tabs (All new, Favorites, Watch later) and tabs you make: Category (folders and tags), Channels, Topic or Mixed.
- Per-tab filters: hide Shorts, unwatched only, videos per channel, duration.
- A line on every video saying why it is in the tab (folder, tag, channel or topic).
- Mark as watched, save for later, archive, "not for me".
- Folder pane with nested folders and new-video counts, a status bar counter and command palette entries.
- Manage table (folder, tags, last video, pace, share of Shorts, recent watching, relation) with batch actions and a change history with undo.
- Follow a channel without subscribing: paste a channel link, a video link or an @handle.
- Organize with Hermes: folder and tag suggestions from your Hermes model, accepted or rejected by group.
- Cleanup with approval (inactive, not watched, off your profile, marked by you) and Ex-subscriptions with Resubscribe for 30 days.
- Topic tabs built from YouTube search results by your Hermes model.
- Videos play in the Watch section with Hermes's own embedded player, under the app's embed consent.
- Playlists: Add to playlist on any video card or in the player, and a Playlists tab with Play all, rename and
  delete. They are kept in the plugin's database; nothing is written to your YouTube account.
- Nine agent tools, video cards in the Desktop chat, and `/tube` with buttons on Telegram.
- Five scheduled routines on Hermes's own scheduler; four of them use no model.
- Demo data: 40 public channels in 6 folders, without touching your account.
- Companion Chrome extension: subscription sync, watch history, a sidebar on youtube.com and the approved unsubscribes.
- English and Brazilian Portuguese.

This is the first version. Run end to end on one real signed-in YouTube account (interface in Brazilian Portuguese, one to three subscriptions): reading subscriptions, unsubscribing and resubscribing through the extension, and the sidebar on youtube.com. Run on one real Telegram chat: `/tube` status and tabs, triage with its buttons, cleanup with an empty list, installing the routines, and the morning digest message. Built and covered by automated tests but not yet run end to end: the other four routines' messages, `/tube topic` on Telegram, the video cards in the Desktop chat, adding a channel by link, other YouTube interface languages and long subscription lists. Treat all of them as experimental.

## Installation

Install HermesTube in the Hermes on the computer where your browser is: the extension only talks to the Hermes on its own computer. If your Hermes Desktop is connected to a gateway on another computer, switch it to This device before you open HermesTube.

You need:

- Hermes Agent 0.23.1 or newer, with Hermes Desktop for the pages.
- An AI model set up in Hermes for the AI features (organize, cleanup reasons, topic tabs, the folder summary routine). Everything else works without one.
- For the extension: a Chromium browser on the same computer as Hermes, signed in to YouTube — Chrome 120 or newer, Edge, Brave, Chromium, Vivaldi, Opera or (on macOS) Arc. Day-to-day testing is in Chrome on macOS; the install guide says what has been tried on each system.
- Systems: macOS (day to day) and Linux (run in a Debian container, also without a screen). Windows, with Hermes inside WSL 2 (the usual way) or installed natively, is checked only by automated tests and a Linux container that imitates WSL: it has not yet run on a real Windows machine. Windows is in beta and we are looking for testers: if you run it on Windows, open an issue with what worked and what broke. Pull requests are welcome. The install guide has the details, including what to do when the browser on Windows cannot reach Hermes inside WSL.
- git (the install clones the repository). On a minimal Linux, the Hermes installer also needs `libatomic1`. Node.js 22 or newer only if you build the extension yourself.

1. Install and enable the plugin:

   ```bash
   hermes plugins install pedroberaldo87/hermes-tube/plugin --enable
   ```

   Hermes warns that this is a "custom (unreviewed) source": expected for a plugin installed from a repository. Once the catalog listing is live, `hermes plugins install hermes-tube` works too (until then it says the plugin is not in the catalog). Without `--enable`, answer yes to "Enable now?", or switch the plugin on in Hermes Desktop under Capabilities → Plugins. If the tools or `/tube` do not show up, restart the gateway: `hermes gateway restart`.

2. Open HermesTube in the Hermes Desktop sidebar and load the demo, paste a channel, or connect the extension.

3. Set up the browser extension: in HermesTube choose "Connect the browser extension", pick your browser if Hermes found more than one, and press **Set up the extension**. The plugin ships the extension built; Hermes copies it to a `HermesTube Extension` folder in your home folder and opens that browser's Extensions page and the folder. The browser then needs two clicks from you: turn on Developer mode, and drag the folder onto the page (or choose Load unpacked and pick it). The screen always shows these steps, the address and the folder path with copy buttons, so you can also do it by hand; if you get stuck, **Ask Hermes to help** opens a chat with a ready request that you read and send. Later, the same button updates the extension.

   To build it yourself instead:

   ```bash
   git clone https://github.com/pedroberaldo87/hermes-tube
   cd hermes-tube
   npm ci
   EXT_DIST_DIR=extension/dist npm run build:ext
   ```

   In your browser, open its Extensions page (`chrome://extensions`, `edge://extensions`, …), turn on Developer mode, choose Load unpacked and pick the `extension/dist` folder.

4. Pair it: on the same screen a 6-digit code appears (valid for 5 minutes, single use). Type it in the tab the extension opens when it is loaded (or in its popup) and press Connect.

If it goes wrong: "The plugin isn't on in …" (in the side panel or on the main screen), or a connect dialog that says you're connected to another computer, means the Desktop is on a profile or a gateway without the plugin. Switch the Desktop to This device, go back to the profile where you installed it, or turn the plugin on in Capabilities → Plugins.

The full guide, with troubleshooting and how to remove everything, is in [docs/user/install.md](docs/user/install.md). To remove the plugin: `hermes plugins remove hermes-tube` (remove the routines first if you installed them).

## Configuration

Settings live in Hermes, per profile: Capabilities → Plugins, gear on the HermesTube row. They are declared in `plugin/plugin.yaml`.

| Setting | Default | What it does |
|---|---|---|
| RSS refresh interval (minutes) | 30 | minimum time between automatic checks for new videos (5 or more) |
| Language | `auto` | `en`, `pt-BR` or `auto`; `auto` follows the app on the pages and Hermes's display language (`display.language`) in `/tube`, tools and routines, falling back to English |
| Keep ex-subscriptions (days) | 30 | how long cancelled channels stay in Ex-subscriptions |
| Topic tabs refresh (days) | 7 | saved with each new topic tab; this version does not refresh topic tabs on its own |

The AI features run on the plugin's own task, listed in Settings → Models as "YouTube curator", so you can give them a different model from the chat. The plugin needs no API key and no environment variable.

## Usage

- **Desktop.** HermesTube in the sidebar opens the HermesTube page at its Subscriptions section. Manage and Cleanup are sections of the same HermesTube page, and the Subscriptions pane shows your folder tree. Click a video to watch it in the Watch section, or ⌘/Ctrl-click to open it on YouTube.
- **Chat.** Ask "what's new on YouTube today?", "why don't I see channel X anymore?" or "make a tab about home espresso". Hermes uses the plugin's nine `tube_*` tools. They never approve a cancellation.
- **`/tube`.** A summary in any chat. On Telegram (or another Hermes messaging platform with buttons): `/tube triage`, `/tube cleanup`, `/tube topic <subject>`, `/tube routines`. Use it in a direct chat with your bot, not in a group. See [docs/user/telegram.md](docs/user/telegram.md).
- **Routines.** Five scheduled routines (morning digest, favorites, folder summary, monthly cleanup list, new channels without a folder), installed from Telegram with one confirmation.
- **Extension.** Syncs your subscriptions on pairing, every 6 hours and on Sync now; records the videos you watch; adds a HermesTube section to YouTube's left menu; runs the unsubscribes you approved, one at a time, in a visible tab, with a Stop button.

![The folder pane at the side of Hermes Desktop with folders, channels and new-video counts](docs/screenshots/folder-pane.png)

![The Manage table with several channels selected and the batch action bar](docs/screenshots/manage.png)

![The Cleanup section with sample data: channels grouped by reason (Not watched, Off your profile), two of them ticked, the Review cancellation (2) button and an empty Ex-subscriptions list](docs/screenshots/cleanup.png)

![The new topic tab dialog showing the preview: the videos kept, why each one fits, and the channels behind them](docs/screenshots/theme-tab-preview.png)

![A video playing in the Watch section of HermesTube with Hermes's own embedded player, the title and channel below it](docs/screenshots/watching-tab.png)

![The HermesTube section in YouTube's left menu, above Subscriptions, with folders and new-video counts](docs/screenshots/youtube-sidebar.png)

## Privacy and disclosure

- The plugin reads only public `www.youtube.com` pages, without login: channel RSS feeds, channel pages, the uploads and Shorts playlists of each channel, `/shorts/<id>` and `/watch` pages to learn each recent video's length and whether it is a Short, and the search page for topic tabs. The Desktop pages load thumbnails from `i.ytimg.com` and channel avatars from the addresses YouTube gives.
- Your data is one SQLite database in the Hermes profile (`<HERMES_HOME>/plugin-data/hermes-tube/`). The AI features send channel names, video titles and your folder names to the model you set up in Hermes, also from scheduled jobs made from the plugin's automation blueprints, which run with nobody present.
- The extension talks only to the plugin's local server on `127.0.0.1` (ports 47615 to 47624) and acts only in your signed-in browser.
- No telemetry, no analytics, no server of ours.

Everything the plugin does on your machine and on the network, with the file that shows it, is in the [Disclosure section of plugin/README.md](plugin/README.md#disclosure).

## How it works

- **Plugin** (`plugin/`, Python, runs inside Hermes): REST routes for the Desktop pages (`plugin/dashboard/plugin_api.py`, `plugin/api/`), RPC methods for long jobs and approvals (`plugin/rpc/`), agent tools (`plugin/tools/`), the `/tube` command (`plugin/commands.py`), routines and blueprints (`plugin/routines/`, `plugin/blueprints.py`) and a `pre_llm_call` hook for the chat video card. Data goes to SQLite through Hermes's plugin storage (`plugin/adapters/storage.py`); YouTube pages are read with the standard library (`plugin/core/youtube.py`, `plugin/core/http.py`); model calls go through Hermes (`plugin/adapters/hermes_llm.py`).
- **Desktop pages** (`desktop-src/`, TypeScript and React on the Hermes Desktop plugin SDK): built with esbuild, not minified, into `plugin/desktop/plugin.js`, which Hermes Desktop loads.
- **Extension** (`extension/`, Manifest V3, Preact, built with Vite): reads youtube.com in your browser and talks to a small HTTP server the plugin starts on demand on `127.0.0.1` (`plugin/ext/_server.py`), after pairing with a code.
- **Shared contract**: the REST API (`contract/api.yaml`), the database schema (`contract/schema.sql`), the extension protocol (`contract/ext-protocol.md`) and the types generated from them (`shared/`).

The Hermes plugin catalog installs only the `plugin/` folder. It carries a built copy of the extension (`plugin/extension/`, rebuilt with `npm run build:ext:plugin`), which the "Set up the extension" button copies out; the extension's source is `extension/`.

## Development

You need a local checkout of Hermes Agent with the `hermes` command on your PATH, [uv](https://docs.astral.sh/uv/), and Node.js 22 or newer. Details in [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
make venv              # .venv with Hermes's Python plus pytest and ruff
npm ci
scripts/check          # ruff, pytest, plugin doctor, tsc, vitest, both builds, generated types, catalog validation
scripts/check --fast   # the same without the builds
npm run typecheck      # tsc only
npm run test:js        # vitest only
```

- `HERMES_SRC` points to the Hermes Agent checkout (default `$HOME/.hermes/hermes-agent`); `TUBE_PY` overrides the Python that `scripts/check` uses.
- `HERMES_TUBE_DEV_PROFILE=<profile> make link-dev` links `plugin/` into a Hermes profile you use for development and enables it; `make status` lists that profile's plugins. Use a throwaway profile.
- Tests use saved or synthetic pages, not the network. Tests that hit the network are marked `live` and are left out by default.

## Security

Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md). It also lists what the plugin and the extension touch.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Pedro Beraldo.

*Author.* Pedro Beraldo: [GitHub](https://github.com/pedroberaldo87) · [X](https://x.com/PedroBeraldo)

*Where it comes from.* HermesTube continues MyTube (github.com/pedroberaldo87/MyTube), a Chrome extension by the same
author that organized subscriptions inside youtube.com. MyTube was published under GPL-3.0; code carried over from it
is relicensed under MIT by its sole author.

*How it was built.* HermesTube was built with Hermes Agent itself. Pedro Beraldo defined the product, wrote down the
decisions and decided what ships. An AI agent turned that into a plan and more than 80 written task briefs; each
brief was run by a separate Hermes Agent session using a Claude model, in its own git worktree, writing tests first.
Work was merged after review, and the project's full check (tests, type check, catalog validator) gates what ships.

*What belongs to Hermes.* Hermes Agent and Hermes Desktop are made by Nous Research (MIT). HermesTube is built on
their plugin interfaces. The video player is Hermes Desktop's own embedded player; the plugin only hands it the
video link. This is an independent project, not affiliated with or endorsed by Nous Research.

*Third-party code.* The Python plugin and the Desktop code bundle no third-party library: the Desktop code imports
only what Hermes Desktop provides at runtime. The browser extension, which the plugin also ships built, bundles
Preact (MIT). See THIRD_PARTY_NOTICES.md.

*YouTube.* YouTube is a trademark of Google LLC. HermesTube is not affiliated with or endorsed by YouTube or Google.
It reads public YouTube pages and acts only in your own browser. The demo lists 40 public YouTube channels by name;
they have no connection with this project.

*Hackathon.* Built for the Hermes Agent Plugin Hackathon (November 2026).

License texts of third-party code: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
