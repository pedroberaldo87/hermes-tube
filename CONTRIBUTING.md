# Contributing to HermesTube

Thanks for looking at the project. This page covers how to set it up, how the repository is laid out, and what a good change looks like.

## Set up

You need:

- A local checkout of Hermes Agent (0.23.1 or newer) with the `hermes` command on your PATH. The Python tests and the plugin checks run against it. The `Makefile` looks for it in `$HERMES_ROOT/hermes-agent` (default `$HOME/.hermes/hermes-agent`); set `HERMES_SRC` if yours is elsewhere.
- [uv](https://docs.astral.sh/uv/), used by `make venv` to create the Python environment.
- Node.js 22 or newer and npm.

```bash
git clone https://github.com/pedroberaldo87/hermes-tube
cd hermes-tube
make venv     # .venv with Hermes's Python plus pytest and ruff
npm ci
```

To load your working copy into a Hermes profile you use for development, set `HERMES_TUBE_DEV_PROFILE` to its name and run `make link-dev` (it links `plugin/` into that profile and enables the plugin). `make status` lists the plugins of that profile. Use a throwaway profile, not the one you rely on.

## Run the checks

```bash
scripts/check           # everything
scripts/check --fast    # same, without the two builds
scripts/check --only ruff,pytest
```

The steps are `ruff`, `pytest`, `doctor`, `tsc`, `vitest`, `build-desktop`, `build-ext`, `gen-types`, `id-literal`, `catalog` and, on `main`, `artifacts` (the committed build output must match a fresh build); each prints one `OK`, `FAIL` or `SKIP` line, and the run ends with `CHECK: OK` or `CHECK: FAIL`. Please run it before opening a pull request and say in the description what it printed. A step is skipped, with the reason, when something it needs is missing (for example the `hermes` command).

Single tools, if you want a faster loop:

```bash
npm run typecheck       # tsc for the Desktop pages, the extension and the scripts
npm run test:js         # vitest
```

For Python, `scripts/check --only pytest` is the supported way to run the tests, because it sets up the Hermes path for you.

## Repository layout

- `plugin/` is the Hermes plugin; the catalog installs only this folder. `plugin/core/` holds the logic, `plugin/api/` and `plugin/rpc/` the Desktop calls, `plugin/ext/` the local server for the extension, `plugin/tools/` the agent tools, `plugin/routines/` the scheduled routines.
- `desktop-src/` is the source of the Desktop pages. It is built into `plugin/desktop/plugin.js` (not minified).
- `extension/` is the Chrome extension, built with Vite. It is installed separately from the plugin.
- `shared/` and `contract/` hold the types and the API contract shared by the plugin, the Desktop pages and the extension. `scripts/gen_types.py` generates types from them; the `gen-types` step fails if they are out of date.
- `tests/` has the Python tests and their fixtures; Desktop tests sit next to the code in `desktop-src/` and extension tests in `extension/test/`.
- `scripts/` has `check` and the helpers it calls.
- `docs/user/` has the user guides.

## Style

- Python: formatted and linted with ruff (line length 100, rules `E F I B UP`). Run `ruff format` on what you touch; `scripts/check` fails on unformatted code.
- TypeScript: `tsc` must pass with the strict configs in the repository (`tsconfig.*.json`).
- Inside the plugin, import with `tube_pkg.…`, not `plugin.…`.
- Do not put the plugin id as a literal in new code; use `PLUGIN_ID` from `plugin/_id.py`. The `id-literal` step checks this.
- No network calls and no background threads in `register()`.

## Tests

- A behavior change comes with a test. Write it first and see it fail, then make it pass.
- Tests do not use the network. A test that does must carry the `live` marker; those are left out of `scripts/check`.
- Fixtures go in the test file itself. The saved pages under `tests/fixtures/` are read-only; if you need a new one, make a small synthetic file and name it with `.synthetic.` in the file name.
- Screenshots and fixtures use made-up data only: no real channels from your account, no e-mail addresses, no tokens.

## Proposing a change

- For a bug fix or a small improvement, open a pull request directly.
- For anything larger (a new feature, a new permission, a change to what the extension does on youtube.com, a new network host), open an issue first and describe what you want to do. It saves both of us a rewrite.
- Windows testers wanted: the plugin has not yet run on a real Windows machine (WSL 2 or native). A report of what worked and what broke is a useful contribution on its own.
- Keep a pull request to one change. Say what changed, why, and what `scripts/check` printed.
- Anything that touches how cancellations are approved needs extra care: a cancellation must never be queued without a human click. See [SECURITY.md](SECURITY.md).
- Do not report security problems in a public issue; follow [SECURITY.md](SECURITY.md).

## Language

English is the project's language: code, comments, commit messages, issues, pull requests and documentation. Brazilian Portuguese belongs only in the pt-BR locale files of the user interface, the pt-BR side of the plugin's bilingual message tables, `README.pt-BR.md`, and test data that checks Portuguese output.

By contributing you agree that your work is released under the project's [MIT license](LICENSE). Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
