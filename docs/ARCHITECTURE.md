# Architecture

LocalMind is a Manifest V3 Chrome extension with no build step and no runtime dependencies. It is plain HTML, CSS and JavaScript that talks directly to an [Ollama](https://ollama.com) server over HTTP.

- [Components](#components)
- [Files](#files)
- [Sending a message](#sending-a-message)
- [What the model receives](#what-the-model-receives)
- [Why the Origin header is removed](#why-the-origin-header-is-removed)
- [Stored data](#stored-data)
- [Ollama API used](#ollama-api-used)
- [Build and test](#build-and-test)

## Components

```mermaid
flowchart LR
  subgraph Chrome["Chrome browser"]
    direction TB
    SW["background.js<br/>service worker"]
    DNR[("declarativeNetRequest<br/>rule: remove Origin")]
    Panel["Side panel<br/>sidepanel.html / .css / .js"]
    Store[("chrome.storage.local<br/>settings + chats")]
    SW -- "registers on start" --> DNR
    Panel <-- "read / write" --> Store
  end

  Ollama["Ollama server<br/>this computer or LAN<br/>:11434"]

  Panel -- "fetch /api/*" --> DNR
  DNR -- "request without Origin" --> Ollama
  Ollama -- "NDJSON stream" --> Panel
```

- **Service worker** (`background.js`) opens the side panel when you click the toolbar icon and registers one network rule that strips the `Origin` header from the extension's own requests.
- **Side panel** (`sidepanel.js`) holds all app logic: settings, chat sessions, prompt assembly, streaming, the model manager, search and export.
- **Storage** is `chrome.storage.local`. Nothing is synced or sent anywhere except the Ollama server you configure.

## Files

| File | Responsibility |
|---|---|
| `manifest.json` | Permissions (`sidePanel`, `storage`, `declarativeNetRequestWithHostAccess`, `scripting` for reading the active tab's text, `contextMenus` for the right-click menu), host access (`http://*/*`, `https://*/*`) so any server address works, side panel and icon registration. |
| `background.js` | Side panel open-on-click behaviour; the **Ask LocalMind** right-click menu, which opens the panel and queues the selection in `chrome.storage.session` (`pendingAsk`) for the panel to send; the dynamic rule that removes `Origin` (see [below](#why-the-origin-header-is-removed)). |
| `sidepanel.html` | Markup: header, model bar, history drawer with search, messages, input, Settings and Context Inspector dialogs. |
| `sidepanel.css` | Design tokens on `:root` (light) and `:root[data-theme="dark"]`, then component styles. All colours come from tokens. |
| `sidepanel.js` | State, storage, Ollama client, NDJSON reader, prompt builder, memory miner, rendering, model manager, theme, export. |
| `build.sh` | Syntax-checks the JS, validates the manifest, writes `dist/localmind/` and `dist/localmind.zip`. |
| `tests/e2e.cjs` | Playwright test that loads `dist/localmind` and drives the real UI. |
| `tests/mock-ollama.cjs` | Small fake Ollama API so tests run without a model. |

## Sending a message

```mermaid
sequenceDiagram
  actor User
  participant Panel as sidepanel.js
  participant Store as chrome.storage.local
  participant Ollama as Ollama /api/chat

  User->>Panel: types message, presses Enter
  Panel->>Panel: add user message to session
  Panel->>Panel: mine facts ("my name is…", "I prefer…")
  Panel->>Panel: buildChatPayload(session)
  Panel->>Ollama: POST {model, messages, stream: true, options.num_ctx: 8192}
  loop each NDJSON line
    Ollama-->>Panel: {"message": {"content": "…"}}
    Panel->>Panel: append text, re-render bubble
  end
  alt finished or Stop pressed
    Panel->>Panel: keep reply text (drop it if empty)
  else HTTP or stream error
    Panel->>Panel: mark user message + reply as error (excluded from future context)
  end
  Panel->>Panel: re-render chat (model label, time, error card)
  Panel->>Store: save sessions
```

Stop uses an `AbortController`. Lines of the stream can arrive split across network chunks, so `readNdjson()` keeps the incomplete tail in a buffer until the next chunk arrives. Chat streaming and model downloads share that reader.

## What the model receives

Every request is rebuilt from stored state by `buildChatPayload()`:

```mermaid
flowchart TD
  SP["System Prompt<br/>(Settings)"] --> SYS
  AY["About You<br/>(Settings, every chat)"] --> SYS
  MF["Memory facts<br/>(this chat only)"] --> SYS
  SYS["system message"] --> OUT

  H["Chat history<br/>(attached page text is prepended<br/>to its user message)"] --> F1{"last N messages<br/>(Max History, default 20)"}
  F1 --> F2{"skip empty replies<br/>and failed messages"}
  F2 --> OUT["messages[] sent to /api/chat"]
```

The token counter under the input box is computed from this same payload, at roughly 4 characters per token, so it shows what the next request will actually cost.

## Why the Origin header is removed

Chrome attaches `Origin: chrome-extension://<id>` to an extension's POST and DELETE requests. Ollama rejects unknown origins with **403** unless the server sets `OLLAMA_ORIGINS`. GET requests carry no Origin, which is why the model list loads but chat fails.

```mermaid
sequenceDiagram
  participant Panel as Side panel
  participant Rule as DNR rule (background.js)
  participant Ollama

  rect rgba(180, 35, 24, 0.12)
  Note over Panel,Ollama: Without the rule
  Panel->>Ollama: POST /api/chat<br/>Origin: chrome-extension://abc
  Ollama-->>Panel: 403 Forbidden
  end

  rect rgba(47, 95, 75, 0.15)
  Note over Panel,Ollama: With the rule
  Panel->>Rule: POST /api/chat<br/>Origin: chrome-extension://abc
  Rule->>Ollama: POST /api/chat (Origin removed)
  Ollama-->>Panel: 200, streamed reply
  end
```

The rule only matches requests whose initiator is this extension (`initiatorDomains: [chrome.runtime.id]`), so it never touches normal browsing. Users can still set `OLLAMA_ORIGINS="chrome-extension://*"` on the server instead.

## Stored data

All keys live in `chrome.storage.local`, which Chrome scopes to the extension's ID. For an unpacked extension, the ID depends on the folder it was loaded from.

```mermaid
erDiagram
  SETTINGS {
    string baseUrl "http://localhost:11434"
    string systemPrompt
    string profile "About You"
    string theme "light | dark | system"
    bool contextMiner
    int maxHistory "default 20"
  }
  SESSION ||--o{ MESSAGE : contains
  SESSION {
    string id "session_<timestamp>"
    string title "first prompt, 30 chars"
    string createdAt "ISO date"
    string[] minedFacts "max 10"
  }
  MESSAGE {
    string role "user | assistant"
    string content
    string timestamp "ISO date"
    string model "assistant only"
    bool error "excluded from context"
    object page "attached tab: title, url, text (max 16000 chars), total"
  }
```

| Key | Value |
|---|---|
| `localmind_settings` | `SETTINGS` object |
| `localmind_sessions` | array of `SESSION`, newest first |
| `localmind_current_session_id` | id of the open chat |

## Ollama API used

| Endpoint | Used for |
|---|---|
| `GET /api/tags` | Model dropdown, model list in Settings, connection status |
| `POST /api/chat` | Chat replies, streamed as NDJSON |
| `POST /api/pull` | Download a model, streamed progress (`status`, `completed`, `total`) |
| `DELETE /api/delete` | Remove a model from the server (asks for confirmation first) |

## Build and test

```mermaid
flowchart LR
  SRC["source files"] --> B["build.sh<br/>node --check, manifest JSON check"]
  B --> D["dist/localmind/<br/>(load unpacked)"]
  B --> Z["dist/localmind.zip<br/>(share)"]
  D --> T["tests/e2e.cjs<br/>Playwright + Chromium"]
  M["tests/mock-ollama.cjs"] -. "default" .-> T
  R["real Ollama<br/>OLLAMA_URL=…"] -. "optional" .-> T
```

The mock server returns 403 for any request that has an `Origin` header, just like Ollama. A passing chat test therefore also proves the Origin rule works. CI runs the same test against the mock on every push and pull request.
