# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. A public issue tells everyone about the flaw before there is a fix.

Report it privately through GitHub: open the **Security** tab of this repository and click **Report a vulnerability**. That opens a private thread that only the maintainer can see.

If that button is not available to you, open a normal issue that says only "security report, please contact me", with no details, and I will set up a private channel.

Useful things to include: the version or commit, what you did, what you expected and what happened, and whether it needs Hermes Desktop, the browser extension, or both.

This is a single-maintainer project. There is no bounty and no guaranteed response time, but I read every report and will answer in the same thread.

## Supported versions

Only the latest release (and the current `main`) gets fixes. If you are on an older version, update first and check whether the problem is still there.

## What this plugin touches

This is a description of what the code does today, so you can judge a report against it. If you find something that does not match, that is worth reporting.

**A local server for the browser extension.**

- It is a small HTTP server from the Python standard library, running inside the Hermes process. It listens on `127.0.0.1` only, never on all interfaces, on the first free port from 47615 to 47624.
- It starts on demand (when the Desktop page asks for status, when you start pairing, or when the `tube_status` tool runs), not when the plugin loads. It shuts down when the plugin is disabled in the profile's `config.yaml`.
- A request is refused if its `Host` header is not loopback with the server's port, or if it carries an `Origin` that does not start with `chrome-extension://`.
- Pairing uses a 6-digit code shown in Hermes Desktop. It is valid for 5 minutes, works once, and locks after 5 wrong attempts. A new code replaces the old one. The code itself is never sent: pairing is a password-authenticated key exchange (SPAKE2) bound to the port, so another program listening on one of these ports learns nothing it can use, and each try spends one of the code's 5 attempts. Before the extension sends its token to a port, that port must prove it knows the token.
- After pairing, the extension gets a random token. The database keeps only a SHA-256 hash of the token and a salted hash of each code, not the values themselves. Every route except the health check and pairing needs that token. Unpairing in the extension revokes it.
- The extension can ask the server for: its own state, the video feed, the queue of approved cancellations, and search jobs; and it can send the list of subscriptions, watch history, video read/saved state, and results of queue items and search jobs.

**Network access from the plugin.** The plugin's Python code requests pages from `www.youtube.com`: channel feeds, channel pages, each channel's uploads and Shorts playlists, `/shorts/<id>` and `/watch` pages (also in the background after refreshes) and search results. It follows redirects, and it connects only to public internet addresses: loopback, private networks, link-local addresses and other reserved ranges are refused, on every redirect. Video thumbnails are loaded from `i.ytimg.com` by the Desktop pages and the extension's sidebar, and channel avatars from the addresses YouTube gives. The plugin sends no login and no account cookie; the only cookie is YouTube's anonymous consent cookie `SOCS=CAI`, and it is sent only to YouTube hosts. Calls to your AI model go through Hermes's own model client, so the plugin holds no model API key.

**The "Set up the extension" button.** Only when a person presses it in Hermes Desktop (the `POST /extension/setup` route; no agent tool, routine, `/tube` command or chat reaches it, and nothing runs when the plugin loads), on the computer where Hermes runs:

- It copies the extension shipped inside the plugin to one fixed folder, `HermesTube Extension` in the home folder, with a marker file `hermes-tube-folder.json` (the plugin's id, the version and the files it wrote). The destination never comes from the request. A folder or file with that name without the marker, or a link, is refused and left untouched; files are never written through a link; an update rewrites only the files Hermes wrote and removes only files the previous marker lists.
- To offer a browser, it looks for Chrome, Edge, Brave, Chromium, Vivaldi, Opera and (macOS) Arc in fixed places only, reading files and running nothing: app bundles in `/Applications` and the home folder's Applications folder on macOS; known commands, `/snap/bin` and Flatpak exports on Linux (and a Flatpak's own permission files, to tell whether it can see the folder); known install paths on Windows, without the registry. It never reads a browser profile. The request can name at most one browser, as a key from that closed list; a path, a command or any other field is refused before anything is written.
- It then opens that browser's own Extensions page and shows the folder in the file manager: `open -b <bundle id>` and `open -R` on macOS; the browser's program (or its snap or Flatpak launcher) and `xdg-open` on Linux (only with a display); the browser's `.exe` and `explorer /select,` on Windows. Each is a fixed argument list, never a shell, with a time limit of a few seconds. Errors reach the screen as a generic message; details go only to the Hermes log.
- The browser still requires the person's own gestures (Developer mode, then loading the folder), and the extension still requires the pairing code. The plugin never edits browser profiles or settings, never passes `--load-extension` and never automates clicks.

**"Ask Hermes to help".** A second button under the setup steps opens a new Hermes Desktop chat (public `host.newChat` + `host.composer.setDraft`) with a fixed English request written by the plugin: the operating system, the folder path, the chosen browser, the steps, and rules for the agent — do not read or change the browser's profile or settings, do not get around the browser's required gestures (no `--load-extension`, no policies, no automated clicks), do not install anything without saying so first. It is only a draft: nothing is sent until the person presses Send, and the agent then works with Hermes's usual tools and approvals. No agent tool is added. Without that Desktop API, the button copies the same text instead.

**What it does not do.**

- It does not read browser profiles, cookie stores or passwords, in the plugin or in the extension. The extension does not request the `cookies` permission.
- It does not start shells. The only subprocesses are the ones the "Set up the extension" button starts, described above.
- It does not cancel a YouTube subscription on its own. A cancellation enters the queue only when a person approves it: with the "Cancel N subscriptions" button in the Cleanup section of Hermes Desktop, or with the confirmation choice of `/tube cleanup`. The extension then performs it in your own signed-in browser tab. Agent tools and routines cannot approve one.

**Known limits.** These follow from how Hermes and the browser work today. They are not bugs to report, unless you find a way around what is described here.

- Hermes does not tell a plugin which client made an RPC call. The `cleanup.approve` and `cleanup.resubscribe` methods therefore accept a call from any client authenticated to your Hermes gateway, not only the Desktop app, and so does `pair.start`, which creates a pairing code. Such a client could pair itself as a browser, then take approved items before your browser does, or report them as done without running them. Paired browsers are listed under "Connected browsers" in HermesTube; disconnect any you do not recognize.
- An agent that can control your screen could press "Cancel N subscriptions" in Desktop.
- Software that runs as your user, including an agent you gave shell or file-write tools in the same profile, can write an approved item straight into the plugin's database, but it still waits for your click in the extension, as below. Give shell and file tools only to agents you trust in the profile where HermesTube is installed.
- The extension asks for Chrome's `tabs` permission, which Chrome describes as "Read your browsing history". It uses it only for its own tab: to open that tab next to the one you are on and switch back afterwards, and to see where its own tab ended up (for example Google's sign-in page when you are signed out). It does not read, keep or send the address or title of any other tab.
- `/tube` works only in a direct chat with your bot. In a group, channel or thread it approves nothing, installs or removes no routines and shows none of your data: it only answers that it works in a direct chat (`/tube help` also lists the commands). In a direct chat, Hermes's `approvals.approvers` setting still decides who may answer its buttons.
- When the plugin's Python files change on disk, it reloads its code within a few seconds, without a restart of Hermes. The reload is refused, with a warning in the Hermes log, while a plugin file or folder belongs to another user or can be written by group or others. Anyone who can write to the plugin's folder as you can still run code inside Hermes. Install the plugin in a folder only you can write to, and do not give agents file-write access to it.
- Before each round of unsubscribes, the extension shows the number of approved items on its toolbar icon and asks in its popup ("N approved unsubscribes are waiting"). Nothing changes on YouTube until you click Run now there. The click covers only the items listed at that moment; closing the browser or reloading the extension discards it.

**Where data lives.** One SQLite database in the active Hermes profile, at `<HERMES_HOME>/plugin-data/hermes-tube/tube.db`, with the lock file `ext-server.lock` next to it. It holds your channels, folders, tags, tabs, video states, watch history sent by the extension, change history and paired devices. It is not encrypted; the plugin makes the file and its `-wal`/`-shm` files readable only by you (mode 0600). The plugin reads the profile's `config.yaml` (read-only) for its own settings and to check that it is enabled. After you confirm `/tube routines`, it writes launcher scripts to `<HERMES_HOME>/scripts/` and creates Hermes cron jobs, which uninstalling does not remove. The import routes read a `.json` file at a path given in the request (up to 50 MB). The "Set up the extension" button writes the `HermesTube Extension` folder in the home folder, which uninstalling does not remove.

## Out of scope

- Anything that needs the attacker to already control your machine, your Hermes profile or your browser profile.
- YouTube changing its page layout and breaking the plugin. That is a bug, so please use a normal issue.
- Reports from an automated scanner with no working path to impact.
