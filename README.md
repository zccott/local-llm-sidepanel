# LocalMind

Chat with [Ollama](https://ollama.com) models from Chrome's side panel. The model runs on your computer or on another machine on your network, and your chats never leave it.

[![CI](https://github.com/zccott/local-llm-sidepanel/actions/workflows/ci.yml/badge.svg)](https://github.com/zccott/local-llm-sidepanel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2f5f4b.svg)](LICENSE)

<img src="docs/images/screenshot.png" alt="LocalMind side panel in light theme: a two-message chat with gpt-oss, a session memory bar, and the token counter" width="380">

## Features

- **Side panel chat** next to any tab, with streamed replies and a Stop button.
- **Conversation memory**: each chat sends its recent history, like ChatGPT.
- **About You**: facts about you that every chat knows. A built-in prompt helps you copy what ChatGPT, Claude or Gemini already knows about you.
- **Session memory**: notices things like "my name is…" or "I prefer…" and reminds the model of them for the rest of the chat. You can edit these facts.
- **Chat history** saved in your browser, with search across titles and messages.
- **Model manager**: pick a model, or download and remove models on the server from Settings.
- **Context inspector**: see exactly what is sent to the model and the token estimate, and export a chat as Markdown or JSON.
- **Light and dark themes**, or follow the system setting.
- **Works with any Ollama server** you can reach, with no server configuration beyond making it listen on your network.

## Quick start

You need Chrome 114 or newer (Edge and Brave work too) and an Ollama server with at least one model (`ollama pull llama3.2`).

1. **Build the extension**

   ```sh
   git clone https://github.com/zccott/local-llm-sidepanel.git
   cd local-llm-sidepanel
   ./build.sh
   ```

2. **Load it in Chrome**: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select `dist/localmind`.

3. **Connect**: click the LocalMind toolbar icon, open **⚙️ Settings** and set the server address:
   - Ollama on this computer: `http://localhost:11434` (the default)
   - Ollama on another machine: `http://<its-ip>:11434`, after starting Ollama there with `OLLAMA_HOST=0.0.0.0 ollama serve`

The [User Guide](docs/USER_GUIDE.md) covers every feature and has a troubleshooting table.

## Privacy

- Requests go only to the server address you set. There is no telemetry, analytics or cloud service.
- Settings and chats are stored in `chrome.storage.local` on your computer.
- The extension asks for access to all `http://` and `https://` addresses only so that you can point it at any server. It contacts nothing else.

See [SECURITY.md](SECURITY.md) for the security model and how to report a problem.

## Documentation

| Document | For |
|---|---|
| [User Guide](docs/USER_GUIDE.md) | Installing, connecting and using every feature |
| [Architecture](docs/ARCHITECTURE.md) | How it works, with diagrams: components, message flow, stored data |
| [Contributing](CONTRIBUTING.md) | Development setup, tests and pull requests |
| [Changelog](CHANGELOG.md) | What changed in each version |

## Development

No bundler or framework: edit the files and reload the extension. Node 20+ is only needed for the tests.

```sh
npm install
npx playwright install chromium     # once
npm test                            # build, then run the end-to-end test against a mock Ollama
OLLAMA_URL=http://192.168.1.50:11434 npm test   # same test against a real server
```

```
├── manifest.json        Extension manifest (MV3)
├── background.js        Service worker: opens the panel, strips the Origin header for Ollama
├── sidepanel.html/.css/.js   The whole app
├── icons/               Toolbar icons (icon.svg is the source)
├── build.sh             Checks and packages into dist/
├── tests/               Playwright end-to-end test and mock Ollama server
└── docs/                User guide, architecture, screenshot
```

## Contributing

Bug reports, ideas and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## License

[MIT](LICENSE)
