// Chrome extension service worker
// Automatically opens the side panel when the toolbar action icon is clicked

chrome.runtime.onInstalled.addListener(() => {
  console.log("LocalMind Side Panel Extension installed.");
  // Enables opening side panel directly on clicking the extension icon
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.warn("setPanelBehavior failed:", err);
    });
  }
  // Right-click menu on selected text; ids match ASK_PROMPTS in sidepanel.js
  chrome.contextMenus.create({ id: "ask", title: "Ask LocalMind", contexts: ["selection"] });
  for (const [id, title] of [["explain", "Explain"], ["translate", "Translate to English"], ["fix", "Fix grammar"], ["summarize", "Summarize"]]) {
    chrome.contextMenus.create({ id, parentId: "ask", title, contexts: ["selection"] });
  }
});

// Hand the selection to the panel through session storage; the panel sends it once it is open.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  // open() must run before any await to keep the user gesture
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => console.warn("sidePanel.open failed:", err));
  chrome.storage.session.set({ pendingAsk: { action: info.menuItemId, text: info.selectionText, windowId: tab.windowId } });
});

// Ollama returns 403 for unknown Origin headers, and Chrome sends chrome-extension://<id> on POST.
// Strip Origin from this extension's own requests so no OLLAMA_ORIGINS change is needed on the server.
chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [1],
  addRules: [{
    id: 1,
    priority: 1,
    action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "remove" }] },
    condition: { initiatorDomains: [chrome.runtime.id], resourceTypes: ["xmlhttprequest"] }
  }]
}).catch((err) => console.warn("Origin rule failed:", err));

// Fallback listener for Chrome versions where openPanelOnActionClick isn't default
chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel && chrome.sidePanel.open) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => {
      console.warn("sidePanel.open failed:", err);
    });
  }
});
