// Quick OCR Snip background service worker.
// It reacts to the toolbar icon and keyboard shortcut, injects the snipping UI,
// and captures the currently visible tab when the content script asks for it.

const CONTENT_FILES = ["content.js"];

async function startSnip(tab) {
  if (!tab || !tab.id || !tab.url) return;

  // Chrome does not allow scripting on internal browser pages.
  if (/^(chrome|edge|about|chrome-extension):/i.test(tab.url)) {
    return;
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content.css"]
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: CONTENT_FILES
    });

    await chrome.tabs.sendMessage(tab.id, { type: "QOS_START_SNIP" });
  } catch (error) {
    console.error("Quick OCR Snip could not start:", error);
  }
}

chrome.action.onClicked.addListener((tab) => {
  startSnip(tab);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "start-ocr-snip") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  startSnip(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "QOS_CAPTURE_VISIBLE_TAB") return false;

  chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      return;
    }

    sendResponse({ ok: true, dataUrl });
  });

  // Keep the message channel open while captureVisibleTab finishes.
  return true;
});
