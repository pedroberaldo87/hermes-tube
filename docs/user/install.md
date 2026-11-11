# Installing HermesTube

This guide covers the plugin, the browser extension and pairing. The overview and the full disclosure are in the [README](../../plugin/README.md).

## What you need

- Hermes Agent 0.23.1 or newer and Hermes Desktop.
- For the AI features: a model set up in Hermes (Settings → Models). Without one, organize, cleanup reasons and topic tabs say what is missing; everything else works.
- For the extension: a Chromium browser on the same computer as Hermes, signed in to the YouTube account you want to organize — Google Chrome 120 or newer, Microsoft Edge, Brave, Chromium, Vivaldi, Opera or (on macOS) Arc. The extension is developed and tested day to day in Chrome on macOS; see "Supported systems" below and the table in section 3 for what has been tried on each system. Node.js 22 or newer is needed only to build the extension yourself (section 3, "Build it yourself").
- git, because `hermes plugins install` clones the repository. On a minimal Linux, the Hermes installer also needs `libatomic1`: if it stops while installing Node.js with "libatomic.so.1: cannot open shared object file", run `sudo apt-get install -y libatomic1` (Debian, Ubuntu) and run the installer again.

## Supported systems

| System | Status |
|---|---|
| macOS | Used day to day. |
| Linux | Run in a Debian container: install, the pages' data, pairing codes, the setup button and loading the extension in Chromium. Not used day to day on a Linux desktop. On a server without a screen, everything works except opening the browser: the setup button only prepares the folder and says so. |
| Windows, Hermes inside WSL 2 (the usual way to run Hermes on Windows) | Checked by automated tests and in a Linux container that imitates WSL (folders, settings and Windows programs replaced by stand-ins). **Not yet run on a real Windows machine.** |
| Windows, Hermes installed natively | The plugin's code no longer calls anything that exists only on macOS or Linux; checked by automated tests that imitate Windows. **Not yet run on a real Windows machine.** |

**Hermes inside WSL.** The plugin runs in Linux and the browser runs on Windows, so:

- the setup button puts the folder in your Windows user folder, `C:\Users\<you>\HermesTube Extension`, where the Windows browser can load it, and the screen shows that Windows path. Hermes finds your Windows user folder from `USERPROFILE` when WSL passes it on, or as the only personal folder in `C:\Users` (or the one named like your Linux user); it runs nothing to find it. If it cannot tell, the folder stays in your Linux home and the screen shows it as `\\wsl.localhost\<distribution>\home\<you>\HermesTube Extension`; if the browser does not accept that path, copy the folder to your Windows user folder in Explorer and load the copy;
- Hermes starts the Windows browser and Explorer through WSL interop (on by default). With interop off (`[interop] enabled = false` in `/etc/wsl.conf`) it only prepares the folder and says so;
- the extension reaches the plugin at `127.0.0.1` (ports 47615 to 47624). WSL 2 forwards `localhost` connections from Windows to programs in WSL that listen on `127.0.0.1`; this is on by default (`localhostForwarding`), and the [Hermes WSL guide](https://hermes-agent.nousresearch.com/docs/user-guide/windows-wsl-quickstart) describes it. If the popup keeps saying it can't find Hermes: make sure `%USERPROFILE%\.wslconfig` does not set `localhostForwarding=false`; on Windows 11 22H2 or newer, turn on mirrored networking (`networkingMode=mirrored` under `[wsl2]` in that file), then run `wsl --shutdown` and start Hermes again; a VPN or firewall on Windows can also get in the way. The plugin's server only ever listens on `127.0.0.1`, so making it listen on all addresses is not an option; if none of this helps, run Hermes natively on Windows.

**Hermes installed natively on Windows.** Two things differ from macOS and Linux: the plugin does not reload its own code when its files change (Windows gives no simple way to check who owns them), so restart Hermes after `hermes plugins update`; and the plugin's database keeps the permissions of the folder it is in (only you, in your user folder, where Hermes keeps it by default; the Hermes log warns if it is elsewhere).

## 1. Install the plugin

Until HermesTube is listed in the Hermes plugin catalog, install it from the repository:

```bash
hermes plugins install pedroberaldo87/hermes-tube/plugin --enable
```

Hermes then says "Warning: custom (unreviewed) source — not from the Hermes catalog." That is expected for any plugin installed from a repository. `--enable` installs and turns the plugin on in one step; without it, Hermes asks "Enable now?".

Once the listing is live, this works too (until then it answers that `hermes-tube` is not in the Hermes plugin catalog):

```bash
hermes plugins install hermes-tube
```

## 2. Turn it on

Pick one:

- answer yes when the install asks "Enable now?";
- run `hermes plugins enable hermes-tube`;
- in Hermes Desktop, open Capabilities → Plugins and switch HermesTube on. The row has an Agent switch (tools, `/tube`, routines) and a Desktop switch (pages, pane, status bar counter); turning the plugin on turns both on.

If the tools or `/tube` do not show up in a chat, restart the gateway, as Hermes suggests after the install: `hermes gateway restart`.

The plugin is per profile. If the pane says the plugin is not on in the current profile, switch back to the profile where you installed it, or install it there too.

Open HermesTube in the Desktop sidebar. The first time, a welcome card offers three ways to start: connect the browser extension, paste a channel, or try the demo.

## 3. Set up the extension

The plugin ships the extension already built, so you do not need Node.js or git. In HermesTube, choose "Connect the browser extension". The screen lists the Chromium browsers Hermes found on its computer; if there are several, pick the one you use for YouTube. Then press **Set up the extension**. On the computer where Hermes runs, Hermes:

- copies the extension to a folder named `HermesTube Extension` in your home folder, with a small file inside, `hermes-tube-folder.json`, that marks the folder as created by Hermes and records the version;
- opens that browser's own Extensions page (`chrome://extensions`, `edge://extensions`, `brave://extensions`, `vivaldi://extensions`, `opera://extensions`) and shows the folder in Finder, Explorer or your file manager.

No browser lets a program install an extension from outside its store by itself, so two clicks are left to you. The screen in Hermes lists them, with the names your browser uses:

1. Turn on Developer mode. In Chrome, Brave, Chromium, Vivaldi, Opera and Arc the switch is at the top right of the Extensions page; in Edge it is in the left-hand panel.
2. Drag the `HermesTube Extension` folder onto the page. Or choose Load unpacked and pick the folder; the screen has a button to copy its path.

The extension then opens a tab that asks for the pairing code (next section). Pin it to the toolbar if you like.

### By hand, without the button

The same screen always shows the manual way too, whether or not the button worked: the steps, the address of the Extensions page and the folder path, each with a copy button. On your own:

1. Press **Set up the extension** once (it creates the folder even if it cannot open the browser), or build the folder yourself (below).
2. In your browser, open its Extensions page (for example `chrome://extensions` or `edge://extensions`).
3. Turn on Developer mode.
4. Choose Load unpacked and pick the `HermesTube Extension` folder in your home folder.

Where the folder is:

| System | Folder |
|---|---|
| macOS | `HermesTube Extension` in your home folder (the folder with your user name) |
| Linux | `/home/<you>/HermesTube Extension` |
| Windows | `C:\Users\<you>\HermesTube Extension` |
| Windows, Hermes inside WSL | `C:\Users\<you>\HermesTube Extension` (or, if Hermes could not find your Windows user folder, in your Linux home: the screen shows the path) |

### On each system

- **macOS.** Hermes finds browsers in `/Applications` and in the Applications folder of your home folder, and opens the Extensions page with `open -b <app id>`, then shows the folder in Finder.
- **Windows.** Checked only by automated tests so far (see "Supported systems"). Hermes finds browsers in their usual install folders (`Program Files`, `Program Files (x86)` and your `AppData\Local`). A `chrome://` address cannot be opened by double-clicking, so Hermes starts the browser's own program with the address, and opens `explorer.exe` from the Windows folder with the folder selected. The path on screen uses backslashes, ready to paste in the Load unpacked window. With Hermes inside WSL, the same happens through WSL interop, and the browsers are looked for in the same Windows folders.
- **Linux.** Hermes finds browsers by their usual commands (`google-chrome`, `microsoft-edge`, `brave-browser`, `chromium`, `vivaldi`, `opera`) and their snap and Flatpak installs, then opens your home folder in the file manager so you can drag the folder. It needs a desktop session (`DISPLAY` or `WAYLAND_DISPLAY`); on a computer without a screen (a server) it only prepares the folder and says so: set up the extension on a computer with a browser that runs Hermes too, because the extension talks only to a Hermes on its own computer.
  - A **Flatpak** browser only sees the folders it was given. If it cannot see `HermesTube Extension`, the screen says so and shows one command to give it read access, for example `flatpak override --user --filesystem='/home/<you>/HermesTube Extension:ro' com.google.Chrome`; run it in a terminal, then close and reopen the browser.
  - A **snap** browser sees folders under `/home` only. If your home folder is elsewhere, use a version of the browser that is not a snap.

What has been tried so far:

| System | Browser | Tried for real | Covered by automated tests only |
|---|---|---|---|
| macOS | Google Chrome | found in `/Applications`; the Extensions page opened in a separate Chrome window; the folder loads | — |
| macOS | Chrome for Testing (a second Chromium) | the Extensions page opened through `open -b`; the folder loads and the pairing tab opens | — |
| macOS | Edge, Brave, Chromium, Vivaldi, Opera, Arc | — | finding them and the commands Hermes runs |
| Linux (Debian "trixie", in a container) | Chromium 156 | found, the folder copied, the Extensions page opened on a virtual X screen (Xvfb), the folder loads and the pairing tab opens | — |
| Linux | Chrome, Edge, Brave, Vivaldi, Opera; snap and Flatpak installs | Flatpak and snap detection read from real files in that container | the commands Hermes runs, Wayland |
| Windows, Hermes inside WSL (imitated in a Linux container) | Chrome (a stand-in program) | the folder written to the Windows user folder, the Windows path on screen, the browser and `explorer.exe` started with the right arguments, a changed file repaired; without interop, only the folder; without a Windows user folder, the Linux home | no real Windows, real browser or real WSL network |
| Windows, native | all | **not yet run on a real Windows machine** | finding each browser in its install folders, the commands, backslash paths, the file lock and port rules of the local server |

Good to know:

- The button does something only when you press it. Hermes never writes the folder or opens a browser on its own, from a chat, a tool or a routine.
- Hermes never touches a folder with that name that it did not create. If one is already there, rename or move it and press Check again.
- Hermes never reads or changes your browser's profile or settings, and never tries to skip Developer mode or Load unpacked.
- If Hermes Desktop is connected to Hermes on another computer, the folder is created and the browser is opened on that computer. The extension only talks to a Hermes on the same computer (`127.0.0.1`), so set it up on the computer where Hermes runs.
- To update: when a new version of the plugin brings a newer extension, the same button says **Update the extension**. Hermes rewrites its own files in the same folder; then press the reload button on the extension's card in the browser's Extensions page.

### Stuck? Ask Hermes

Below the steps, **Ask Hermes to help** opens a new chat with a ready request: your system, the folder path, the browser you picked and the steps. Nothing is sent until you read it and press Send. The request asks Hermes to guide you and tells it not to touch the browser's profile or settings, not to try to get around Developer mode or Load unpacked, and not to install anything without telling you first. On a Hermes Desktop that cannot open a chat from a plugin, the button is **Copy a request for Hermes** instead and copies the same text.

### Build it yourself

If you prefer to build the extension yourself (or the button is not available), it lives in the `extension/` folder of the repository:

```bash
git clone https://github.com/pedroberaldo87/hermes-tube
cd hermes-tube
npm ci
EXT_DIST_DIR=extension/dist npm run build:ext
```

Then, in your browser:

1. Open its Extensions page (`chrome://extensions`, `edge://extensions`, …).
2. Turn on Developer mode.
3. Choose Load unpacked and pick the `extension/dist` folder.
4. Pin the extension to the toolbar.

To update it later: pull, run the build again and press the reload button on the extension's card.

## 4. Pair the extension with Hermes

1. In Hermes Desktop, open HermesTube and choose "Connect the browser extension". A 6-digit code appears below the setup steps. It is valid for 5 minutes and works once.
2. Type or paste the code in the tab the extension opened when it was loaded (later, click the extension icon in Chrome) and press Connect.
3. The extension looks for Hermes on this computer (`127.0.0.1`, ports 47615 to 47624) and pairs. You do not need to type an address.
4. It then opens your YouTube subscriptions page in a tab, scrolls through it and sends the list to Hermes. A notice on the page says it is reading and that nothing in your account changes. Keep the tab in view; it closes by itself.

After that, the extension syncs again every 6 hours and whenever you press Sync now in its popup. It also records the videos you watch on youtube.com in that browser (after 60% or 4 minutes), which the Cleanup section uses for the "Not watched" group.

## 5. Check the settings

In Capabilities → Plugins, the gear on the HermesTube row opens its settings:

| Setting | Default | What it does |
|---|---|---|
| RSS refresh interval (minutes) | 30 | minimum time between automatic checks for new videos |
| Language | auto | language of the messages; `auto` follows the app on the pages and the Hermes language (`display.language`) in `/tube`, tools and routines, falling back to English |
| Keep ex-subscriptions (days) | 30 | how long cancelled channels stay in Ex-subscriptions |
| Topic tabs refresh (days) | 7 | stored, but the periodic new search is not scheduled in this version |

## Troubleshooting

| What you see | What to do |
|---|---|
| "Can't find Hermes on this computer" in the popup | Open Hermes Desktop and the HermesTube page, then try again. The local connection starts when the page asks for status. If it keeps failing, another app may be using ports 47615 to 47624. With Hermes inside WSL, see "Hermes inside WSL" under Supported systems (localhost forwarding, mirrored networking). |
| "This code has expired", "already used" or "blocked" | Create a new code in HermesTube ("Connect the browser extension"). A code lasts 5 minutes, works once and locks after 5 wrong tries. |
| "The plugin is turned off in Hermes" | Turn it on in Capabilities → Plugins. |
| "Sign in to YouTube" | Sign in to your YouTube account in that Chrome profile, then Sync now. |
| "Partly synced" or "Needs a visible sync" | YouTube did not load the whole list in a background tab. Press Sync now and keep the tab in view. A partial list never marks anything as unsubscribed. |
| "Hermes is closed" or "Open Hermes to reconnect" | The extension talks to Hermes only while Hermes runs. Open it; the extension reconnects by itself. |
| "There's already a folder named HermesTube Extension" | Hermes did not create that folder and does not touch it. Rename or move it, then press Check again. |
| "Hermes couldn't open Chrome" (or Edge, Brave…) | Open the browser's Extensions page yourself (the screen has a button to copy the address) and follow the two steps. If Hermes runs on another computer, or on a computer without a screen, see section 3. With Hermes inside WSL and interop off, Hermes cannot start Windows programs: open the browser yourself. |
| "Hermes didn't find Chrome, Edge, Brave…" | Hermes still prepares the folder. Open your browser's Extensions page yourself and follow the manual steps on the screen. |
| "… is a Flatpak and can't see this folder yet" | Run the command shown on the screen once, then close and reopen the browser (section 3, Linux). |
| Load unpacked does not show the folder | Paste the path from the screen's copy button into the folder window (on macOS, press Cmd+Shift+G first; on Linux, Ctrl+L). |
| The pane disappeared | Closing the only HermesTube pane turns the Desktop half off. Turn it back on in Capabilities → Plugins. |
| Organize or topic tabs ask for a model | Pick a model in Settings → Models. The plugin's task is listed there as "YouTube curator", so you can give it a different model from the chat. |

## Removing HermesTube

1. If you installed routines, remove them first: `/tube routines remove` on Telegram, or `hermes cron list`, then `hermes cron remove <id>` for each `hermes-tube-…` job and delete the `hermes-tube-*.py` files in the profile's `scripts/` folder. Uninstalling the plugin does not remove them.
2. In the extension popup, choose Disconnect, then remove the extension on the browser's Extensions page. If Hermes set it up, also delete the `HermesTube Extension` folder in your home folder (and, if you gave a Flatpak browser access to it, take it back with `flatpak override --user --nofilesystem='<the same path>' <app id>`).
3. Run `hermes plugins remove hermes-tube`.
4. Your data stays in the profile's `plugin-data/hermes-tube/` folder. Delete that folder to erase it.
