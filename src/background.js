// Custom Canvas — background service worker
// Sole job: when the user clicks the toolbar icon, tell the content script
// on the active Canvas tab to toggle its customization modal.

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'cc-toggle-modal' });
  } catch (err) {
    // Content script isn't loaded on this tab (e.g., not a Canvas page).
    // Silently ignore — nothing to toggle.
  }
});
