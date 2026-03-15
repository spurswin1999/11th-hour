// background.js — service worker
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'OPEN_COMPARE') {
    chrome.tabs.create({ url: chrome.runtime.getURL('compare.html') });
  }

  // Content scripts cannot write to chrome.storage.session directly on some pages.
  // Route all storage writes through the service worker which has full access.
  if (message.type === 'STORE_CAPTURE') {
    chrome.storage.session.set(message.payload);
  }

  // An iframe captured the PDF — tell the main frame to update its button
  if (message.type === 'PDF_CAPTURED_IN_FRAME' && sender.tab?.id) {
    chrome.tabs.sendMessage(sender.tab.id, { type: 'PDF_READY_IN_TAB' }, { frameId: 0 });
  }
});
