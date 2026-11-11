# Live probe: the extension on the real youtube.com, signed out

Uses the network (youtube.com). Not part of `scripts/check` nor of `npm run e2e`; run it by hand.

```
source .unit-env                                       # or export TMPDIR to a scratch folder
EXT_DIST_DIR=$TMPDIR/tube-live/dist npm run build:ext  # build the extension
EXT_DIST_DIR=$TMPDIR/tube-live/dist npx playwright test -c extension/e2e/live/playwright.live.config.ts
```

About 7 minutes and 12 page loads. Options: `LIVE_STEPS=4,7` (only some steps; 5 and 6 need 2),
`LIVE_CHANNELS=1` (fewer channel pages), `LIVE_MAX_LOADS=10` (lower page budget; 40 at most),
`LIVE_OUT` (output folder, default `$TMPDIR/tube-live/`), `TUBE_PY` (Python, default `python`).

Output: `report.json` (one entry per step, with a verdict — proved / failed / partial — and the evidence),
`shots/`, `dom/` (minimal DOM cuts: no scripts, styles, images or SVG paths), `server.log`. Keep them out of git.

It loads the built extension in Chrome for Testing (headless, brand-new temporary profile, deleted at the end)
and starts the real extension server on a throwaway database (`server.py`; refuses to run unless `TUBE_DB_PATH`
is inside `TMPDIR`). Then:

1. youtube.com: content-script marker, the extension's isolated world, console of the page and the service worker;
2. pairing through the popup: 5 wrong codes (locked), the right one after the lock, then a new code;
3. channel pages by `/channel/UC…` and `/@handle`, read with the extension's own functions (bundled from
   `extension/src/content`), plus an inventory of what the real header has;
4. a 19 s public video (muted) past the threshold, replayed; then a video switch without reload (title click,
   thumbnail click, the app's `yt-navigate` event); events in the outbox and on the server;
5. "Sync now" from the popup (signed out, `/feed/channels` redirects to the Google sign-in page);
6. one approved unsubscribe on the disposable server: 90 s without a click (nothing may open), then "Run now";
7. the sync notice on a real channel page, YouTube in dark (its Appearance menu: signed out it does not follow
   the device theme) with the device in dark and in light, 1280 and 420 px wide; contrast of every text.

Limits built in: only `*.youtube.com`, `*.ytimg.com`, `*.ggpht.com`, `*.googlevideo.com` and the disposable
server are reachable (everything else, including the other ports of the extension range, is aborted and listed);
at most 40 YouTube page loads with a 4 s pause; it never signs in and never clicks "Subscribe". A MAIN-world
listener logs every click on the page, so the extension's own clicks show up too. Page waits poll through CDP:
YouTube enforces Trusted Types, which blocks Playwright's `waitForFunction` string predicates.

Needs `@playwright/test` 1.64 with its Chrome for Testing (chromium-1248) already in the Playwright cache.
