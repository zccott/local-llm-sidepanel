# Contributing to LocalMind

Thanks for helping. LocalMind is a small, dependency-free Chrome extension for chatting with Ollama models. Contributions of every size are welcome: bug reports, fixes, features, docs and accessibility improvements.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug**: open an issue with the *Bug report* template. Include your Chrome version, Ollama version, steps and what you expected.
- **Suggest a feature**: open an issue with the *Feature request* template before writing a lot of code, so we can agree on scope.
- **Fix something**: issues labelled `good first issue` are small and self-contained.
- **Security problems**: don't open a public issue. Follow [SECURITY.md](SECURITY.md).

## Development setup

The extension itself needs no tools. Node 20 or newer is only needed for the tests (`.nvmrc` pins the version CI uses).

```sh
git clone https://github.com/zccott/local-llm-sidepanel.git
cd local-llm-sidepanel
npm install
npx playwright install chromium   # once, for the end-to-end test
./build.sh                        # writes dist/localmind
```

Load `dist/localmind` in `chrome://extensions` (Developer mode → **Load unpacked**). After editing, run `./build.sh` again and click reload on the extension. Keep loading the same folder: Chrome ties saved chats to it.

| Command | What it does |
|---|---|
| `./build.sh` or `npm run build` | Syntax-check JS, validate the manifest, write `dist/localmind/` and `dist/localmind.zip` |
| `npm test` | Build, then run the end-to-end test against the built-in mock Ollama |
| `OLLAMA_URL=http://host:11434 npm test` | Run the same test against a real Ollama server |
| `OLLAMA_URL=… E2E_PULL=1 npm test` | Also download and remove `all-minilm` (~46 MB) on that server |

To debug the panel, right-click inside it and choose **Inspect**.

## How the code is organised

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. It has diagrams of the components, the message flow, the prompt the model receives and the stored data.

## Guidelines

- **No build step and no runtime dependencies.** Plain HTML, CSS and modern JavaScript that Chrome runs directly. Dev-only tools (like Playwright) are fine.
- **Privacy first.** The extension may only contact the Ollama server the user configured. No telemetry, analytics, CDNs or remote fonts.
- **Styling.** Use the CSS custom properties on `:root` in `sidepanel.css`, and add any new colour to both the light and the `[data-theme="dark"]` token blocks.
- **Accessibility.** Interactive elements are real `<button>`s or inputs with labels, keyboard reachable, with visible focus.
- **Layout.** Check the panel at 360 px wide: no horizontal scroll.
- **Errors.** Catch network failures and show the user what to do next. The server may be offline or unreachable.
- **Comments** explain *why*, not *what*.

## Tests

`tests/e2e.cjs` loads the built extension into Chromium and drives the real UI: chatting, Stop, history, search, settings, themes, the model manager and export. `tests/mock-ollama.cjs` fakes the Ollama API. Like real Ollama, it rejects requests that carry an `Origin` header.

When you change behaviour, add or update a `check(...)` in the test. If you change the Ollama API calls, update the mock to match the real API.

## Pull requests

1. Fork and create a branch from `main`.
2. Make your change, with tests and docs.
3. Run `npm test` and make sure it passes. If you can, also run it against a real server.
4. Use [Conventional Commits](https://www.conventionalcommits.org) for messages, e.g. `feat: search chat history`, `fix: keep partial reply on Stop`.
5. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).
6. Open the pull request and fill in the template. Include light and dark screenshots for UI changes.

## Releasing (maintainers)

1. Bump `version` in `manifest.json` and `package.json` (they must match).
2. Move the **Unreleased** changelog entries under `## [X.Y.Z] - YYYY-MM-DD`.
3. Commit, then tag and push:

   ```sh
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

The [Release workflow](.github/workflows/release.yml) then checks that the tag matches both versions and runs the tests. It publishes a GitHub Release named `LocalMind vX.Y.Z` with `localmind-vX.Y.Z.zip` attached, using that version's changelog section plus install steps as the notes. To rebuild an existing release, run the workflow from the **Actions** tab and enter the tag.

Every push to `main` also produces the zip as a CI artifact (kept 14 days), for testing builds between releases.
