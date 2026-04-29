// CustomCanvas — background service worker
// Responsibilities:
//   1. Toolbar icon click → toggle modal in active Canvas tab.
//   2. Proxy Google OAuth for the content script via launchWebAuthFlow.
//      Using launchWebAuthFlow (instead of getAuthToken) makes the flow
//      work in all Chromium browsers (Chrome, Edge, Brave, Opera, Vivaldi,
//      Arc) as well as Firefox — not just Google Chrome.

// ---------- Google Calendar OAuth ----------

// Injected at build time by vite.config.js from .env (GCAL_CLIENT_ID).
const GCAL_CLIENT_ID = '__GCAL_CLIENT_ID__';
const GCAL_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
];

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'cc-toggle-modal' });
  } catch (err) {
    // Content script isn't loaded on this tab (e.g., not a Canvas page).
    // Silently ignore — nothing to toggle.
  }
});

// Message proxy for Google Calendar OAuth. Content scripts cannot call
// chrome.identity.launchWebAuthFlow directly, so the modal sends requests here.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'cc-gcal-get-token') {
    handleGetToken(!!msg.interactive).then(sendResponse);
    return true; // keep the message channel open for async sendResponse
  }
  if (msg?.type === 'cc-gcal-remove-token') {
    handleRemoveToken().then(sendResponse);
    return true;
  }
});

// Check storage for a cached token. Return it if still valid; otherwise
// launch the OAuth flow (only when interactive=true).
async function handleGetToken(interactive) {
  try {
    const stored = await chrome.storage.local.get(['gcalAccessToken', 'gcalTokenExpiry']);
    const now = Date.now();

    // Return cached token if it has at least 60s of life left
    if (stored.gcalAccessToken && stored.gcalTokenExpiry && stored.gcalTokenExpiry > now + 60_000) {
      console.log('[CC bg] returning cached token');
      return { token: stored.gcalAccessToken };
    }

    if (!interactive) {
      console.log('[CC bg] no cached token and non-interactive — returning null');
      return { token: null, error: 'no cached token' };
    }

    // Launch OAuth popup. The redirect URI is whatever the browser exposes
    // via getRedirectURL() — Chromium returns https://<id>.chromiumapp.org/,
    // Firefox returns https://<uuid>.extensions.allizom.org/. The user
    // registers the matching URI as an Authorized Redirect URI in Google
    // Cloud Console.
    // Returns "https://<extension-id>.chromiumapp.org/" — must match the
    // Authorized redirect URI registered in Google Cloud Console exactly,
    // including the trailing slash.
    const redirectUri = chrome.identity.getRedirectURL();
    console.log('[CC bg] launching auth flow, redirectUri=', redirectUri);

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GCAL_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', GCAL_SCOPES.join(' '));
    // Ask for "select account" every time so users can switch Google accounts
    authUrl.searchParams.set('prompt', 'select_account');

    const responseUrl = await new Promise((resolve) => {
      chrome.identity.launchWebAuthFlow(
        { url: authUrl.toString(), interactive: true },
        (url) => {
          if (chrome.runtime.lastError) {
            console.warn('[CC bg] launchWebAuthFlow lastError:', chrome.runtime.lastError.message);
            resolve(null);
          } else {
            resolve(url || null);
          }
        }
      );
    });

    if (!responseUrl) {
      return { token: null, error: 'auth flow cancelled or failed' };
    }

    // Parse the token from the URL fragment: ...#access_token=...&expires_in=...&token_type=Bearer
    const fragment = responseUrl.split('#')[1] || '';
    const params = new URLSearchParams(fragment);
    const token = params.get('access_token');
    const expiresIn = parseInt(params.get('expires_in') || '3600', 10);

    if (!token) {
      console.warn('[CC bg] no access_token in response URL', responseUrl);
      return { token: null, error: 'no access_token in response' };
    }

    const expiry = Date.now() + expiresIn * 1000;
    await chrome.storage.local.set({
      gcalAccessToken: token,
      gcalTokenExpiry: expiry,
    });

    console.log('[CC bg] auth flow succeeded, token cached until', new Date(expiry).toISOString());
    return { token };

  } catch (e) {
    console.error('[CC bg] handleGetToken threw:', e);
    return { token: null, error: String(e) };
  }
}

// Clear the cached token locally and revoke it on Google's side.
async function handleRemoveToken() {
  try {
    const stored = await chrome.storage.local.get(['gcalAccessToken']);
    if (stored.gcalAccessToken) {
      // Fire and forget — revocation failure shouldn't block disconnect
      fetch(`https://oauth2.googleapis.com/revoke?token=${stored.gcalAccessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }).catch(() => {});
    }
    await chrome.storage.local.remove(['gcalAccessToken', 'gcalTokenExpiry']);
    return { ok: true };
  } catch (e) {
    console.warn('[CC bg] handleRemoveToken error:', e);
    return { ok: false, error: String(e) };
  }
}
