# Security policy

LocalMind's core promise is that your conversations go only to the Ollama server you choose, and are stored only in your browser. We take anything that breaks that promise, or puts users at risk, seriously.

## Supported versions

Only the latest release and the `main` branch are supported. Fixes are not backported.

## Reporting a vulnerability

**Please don't open a public issue for security problems.**

Report privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**. Include:

- what is affected and the impact
- steps or a proof of concept to reproduce it
- your Chrome and Ollama versions

You can expect an acknowledgement within 7 days and an update on the fix within 30 days. Once it is fixed, we are happy to credit you in the release notes unless you prefer to stay anonymous.

## Security model

What LocalMind does, and the limits you should know about:

| Area | Behaviour |
|---|---|
| Network | The panel only sends requests to the server address in Settings: `/api/tags`, `/api/chat`, `/api/pull` and `/api/delete`. No telemetry, analytics, CDNs or remote fonts. |
| Host permissions | `http://*/*` and `https://*/*` are requested so that any server address works, and so the panel can read a tab's text when you ask it to. The extension has no content scripts and never changes web pages. |
| Reading pages | With the `scripting` permission, the panel reads the visible text of the active tab **only when you click 📄 Page**. The `contextMenus` permission adds **Ask LocalMind** on selected text, which passes only that selection. Page text and selections go to your own server, like any other message, and are saved with the chat in `chrome.storage.local`. |
| Origin header | A `declarativeNetRequest` rule removes the `Origin` header **only** from requests this extension makes (`initiatorDomains` is the extension's own ID), so Ollama accepts them. It never affects other sites or extensions. |
| Storage | Settings, About You and chats are stored unencrypted in `chrome.storage.local`. Anyone with access to your browser profile can read them. Don't put passwords or API keys in chats or About You. |
| Rendering | Model replies are HTML-escaped before the small Markdown formatter runs, so a reply can't inject markup or scripts. |
| Ollama server | Ollama has no authentication. Anyone who can reach it can chat with, download or delete its models, with or without LocalMind. Keep it on a trusted network and never expose port 11434 to the internet. Use `https://` behind a reverse proxy if traffic crosses networks you don't trust. |
| Model management | Removing a model deletes it from the server for every user, so the panel always asks for confirmation first. |

Reports about any of the rows above are in scope. Weaknesses in Ollama itself should be reported to the [Ollama project](https://github.com/ollama/ollama/security).
