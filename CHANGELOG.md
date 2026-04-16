# Custom Canvas — Changelog

A running log of every modification this extension makes to the Canvas LMS UI.
Each entry records **what** changed, **where** in Canvas it applies, and the
**selectors / files** touched so future edits can find the relevant code fast.

---

## 2026-04-15

### Integrations tab — remove icon, align card to section formatting
- **Where:** `src/content.js` (`tabIntegrations`, `refreshIntegrationsStatus`); `src/content.css` (`.cc-integ-card`, `.cc-integ-card-foot`; removed `.cc-integ-card-head`, `.cc-integ-icon`, `.cc-integ-meta`, `.cc-integ-name*`, `.cc-integ-badge*`, `.cc-integ-desc`)
- **What:** Removed the Google Calendar icon and the entire card header. The card is now wrapped in a standard `.cc-section` with a `.cc-section-title` ("Google Calendar") matching the "Sync Settings" and "What to Sync" sections. `.cc-integ-card` border-radius changed from 14 px to 12 px to match `.cc-section-rows`; padding adjusted to `14px 18px` to match `.cc-row`. Removed the "Connected" badge (no header row to place it). Removed `border-top` from the foot (no head above it). Removed all now-dead CSS and the badge update from `refreshIntegrationsStatus()`.
- **Why:** User found the icon unnecessary; heading style was inconsistent with the other sections in the same tab.

### Integrations tab — service card v2: badge, white footer, real Disconnect button
- **Where:** `src/content.js` (`tabIntegrations`, `refreshIntegrationsStatus`); `src/content.css` (`.cc-integ-*`, `[data-gcal-status]`, `.cc-gcal-dot/email`, `.cc-last-synced`, new `.cc-integ-badge`, `.cc-integ-foot-left/right`, `.cc-integ-account`)
- **What:**
  - **"Connected" badge** added next to the service name in the card header (`[data-gcal-badge]`); updated by `refreshIntegrationsStatus()` — appears as a small green pill when authenticated, hidden otherwise.
  - **`[data-gcal-status]` → `display: contents`**: the element is now layout-transparent, so its two child divs (`.cc-integ-foot-left`, `.cc-integ-foot-right`) participate directly in the footer's `space-between` flex layout without a wrapper breaking the alignment.
  - **Footer background** changed from `--cc-ds-bg` (grey) to `--cc-ds-surface` (white) — the full card is now a single white surface with only a hairline border-top separator.
  - **`min-height: 64px`** on `.cc-integ-card-foot` prevents any height blink between connection states.
  - **Disconnect is now a real `.cc-btn-ghost`** padded to `9px 16px` (matching `.cc-btn`) so both buttons in the footer are the same height.
  - **Account indicator** redesigned: the green-pill chip is gone; the connected state shows a green dot + email text inline (`.cc-integ-account`), matching the flat account-info pattern used by Linear and Vercel.
  - **`refreshIntegrationsStatus()`** now renders the entire footer in one pass, including the last-synced sub-label, so there is no separate `[data-gcal-last-synced]` query — the text is computed and injected in the same template literal as the rest of the footer.
- **Why:** Disconnect was a tiny text link (hard to hit, unclear affordance). The grey card footer background was inconsistent with the white card header and the rest of the dialog. The account chip added a third visual style with no equivalent elsewhere in the UI.

### Integrations tab — service card layout redesign
- **Where:** `src/content.js` (`tabIntegrations`, `renderTabPane`, `refreshIntegrationsStatus`); `src/content.css` (new `.cc-integ-*` classes, updated `[data-gcal-status]`, removed `.cc-gcal-status-stack` / `.cc-gcal-sync-stack`)
- **What:**
  - **`tabIntegrations()`** now returns a custom `html` block instead of a `groups` array. The Google Calendar service is represented as a prominent card (`.cc-integ-card`) with a header row (44×44 Google-blue icon + name + description) and a footer row split left/right: account status on the left, Sync Now + last-synced label on the right.
  - The "Google Account" row and "Sync Now" row — previously two separate section cards stacked under the settings — are eliminated. Their content lives inside the single service card footer.
  - The old "Sync" section is renamed "Sync Settings" and retains only Auto-sync + Sync window rows. "What to Sync" stays as its own section.
  - **`renderTabPane()`** checks for `cfg.html` and uses it directly, falling back to the `cfg.groups` loop for all other tabs.
  - **`refreshIntegrationsStatus()`** updated: connected state no longer wraps chip+disconnect in `.cc-gcal-status-stack` (the `[data-gcal-status]` flex-column handles it); the `.cc-integ-sync` area is dimmed via `cc-integ-sync--off` class instead of looking for the sync button inside gated rows.
- **Why:** User found the previous layout (three separate stacked section cards, each containing just one or two rows) visually inconsistent with the rest of the dialog. The card pattern — one object per integration, with connection and sync actions colocated — matches how apps like Notion and Linear present integration settings.

### Integrations tab — theme alignment + height-blink fixes (Google Account & Sync Now)
- **Where:** `src/content.css` — `.cc-gcal-chip`, `.cc-gcal-email`, `.cc-gcal-status-stack`, `.cc-gcal-sync-stack`, `.cc-last-synced`, `.cc-btn-link`; new `[data-gcal-status]` rule; removed stale dark-mode overrides for chip, email, last-synced, btn-link
- **What:**
  - **Height-blink fix (Google Account row).** Added `[data-gcal-status]` rule with `min-height: 52px; display: inline-flex; align-items: center;`. The async `refreshIntegrationsStatus()` swaps the connect button (~36px) for the chip+disconnect stack (~52px); locking the wrapper to 52px keeps the row height constant in both states.
  - **Height-blink fix (Sync Now row).** Added `display: block; min-height: 1.4em` to `.cc-last-synced` so the reserved line is always present, even before the first sync populates the text. Prevents the row from growing when the timestamp first appears.
  - **Theme alignment.** `.cc-gcal-chip` background and border changed from hard-coded greens (`#f0faf0`, `#d4ead4`) to `var(--cc-ds-bg)` / `var(--cc-ds-border)` so the pill matches the dialog's own surface palette. `.cc-gcal-email`, `.cc-last-synced`, `.cc-btn-link` color values changed from hard-coded hex to CSS vars (`--cc-ds-body`, `--cc-ds-muted`) — these now auto-adapt in dark mode without manual overrides.
  - **Dark mode simplification.** Removed four previously-needed overrides (chip bg/border, email color, last-synced color, btn-link color) since those elements now resolve correctly through the shared design-system vars.
  - `.cc-gcal-status-stack` gap tightened from 6px → 4px (chip and Disconnect are one logical unit).
- **Why:** The hard-coded green chip clashed with the dialog's neutral white/grey palette; height blinking was visible every time the Integrations tab opened while auth status resolved asynchronously.

### Integrations — recover from deleted "Canvas" calendar + UI cleanup
- **Where:** `src/content.js` (`gcalGetOrCreateCalendar`, `gcalSyncNow` upsert loop + catch, `refreshIntegrationsStatus`, `tabIntegrations` Sync Now row); `src/content.css` (new `.cc-gcal-status-stack`, `.cc-gcal-chip`, `.cc-btn-link`, `.cc-gcal-sync-stack`; retired `.cc-gcal-account` / `.cc-gcal-sync-wrap`)
- **What:**
  - **Self-healing calendar lookup.** `gcalGetOrCreateCalendar` now verifies the cached `gcalCalendarId` by issuing a `GET /calendars/{id}` before returning it. On 404/410/403 the cached ID and the entire `gcalEventMap` are cleared (every event in the map lived inside the dead calendar), then the function falls through to find-or-create a fresh "Canvas" calendar.
  - **Sync loop resilience.** `gcalSyncNow` re-reads `gcalEventMap` from storage *after* `gcalGetOrCreateCalendar` so an in-memory copy can't shadow the cleared one. PATCH 404s still recreate the specific event; POST/PATCH 404/410 against the calendar itself now abort the sync instead of being silently swallowed. The outer `catch` clears `gcalCalendarId` + `gcalEventMap` on 404/410 so the next Sync Now creates a new calendar without requiring a reload. Logs sync stats (`created/updated/failed`).
  - **UI redesign.** The Google Account row now renders a vertical stack: an account chip (green dot + ellipsis-truncated email) on top, with a small text-link "Disconnect" below it — replacing the old single-line chip that was pushing the Disconnect button off the right edge. Added a `.cc-btn-link` minimal text-link button variant. The Sync Now row now stacks the primary button above the "Last synced …" label instead of laying them out horizontally. Both stacks are right-aligned within the row control area.
  - Dark-mode overrides updated for the renamed classes.
- **Why:** User deleted the dedicated "Canvas" calendar in Google Calendar; subsequent syncs silently failed because the cached ID pointed at a dead calendar and event-POST errors were swallowed. Separately, the old Integrations tab layout was cramped enough that the "Disconnect" button was being visually truncated.
- **Where:** `src/content.js` (`gcalBuildEvent`, new `gcalFormatLocalDate` helper)
- **What:** Switched synced events from timed (`start.dateTime` / `end.dateTime` at the exact `due_at`) to all-day (`start.date` / `end.date` in `YYYY-MM-DD` form). Date is computed in the user's local time zone so an 11:59pm-due item lands on its actual due date instead of bleeding into the next UTC day. End date is start + 1 since Google treats `end.date` as exclusive for all-day events.
- **Why:** All-day events are easier to scan in Google Calendar's week/month views than tiny timed slivers at midnight or late evening; existing synced events get converted on the next Sync Now via `PATCH`.

## 2026-04-14

### Integrations — strip trailing slash from OAuth redirect URI (REVERTED)
- **Where:** `src/background.js` (`handleGetToken`)
- **What:** Briefly stripped the trailing slash from `chrome.identity.getRedirectURL()` to work around a perceived Google Cloud Console limitation.
- **Why reverted:** Google Cloud Console *does* accept trailing slashes in Authorized redirect URIs — the earlier issue was that the user had added the URI to the *JavaScript origins* field by mistake. Once added to the correct field (Authorized redirect URIs), the slash is preserved. Reverted so we send the canonical `https://<id>.chromiumapp.org/` form that matches what Google stores.

### Integrations — move Google OAuth Client ID into `.env`
- **Where:** `.env` (new, git-ignored), `.env.example` (new, committed), `.gitignore`, `vite.config.js`, `src/background.js`
- **What:**
  - `src/background.js` now declares `const GCAL_CLIENT_ID = '__GCAL_CLIENT_ID__'` — a build-time placeholder instead of a hardcoded value
  - `vite.config.js` reads `.env` in the `copy-static-assets` plugin, substitutes `__GCAL_CLIENT_ID__` with the real value while copying `src/background.js` → `dist/background.js`, and warns if the key is missing or still the placeholder
  - `.env.example` documents the expected keys; `.gitignore` excludes `.env` and `.env.local` so secrets never get committed
- **Why:** Keeps the Client ID out of source control and makes it trivial to swap credentials without editing code.

### Integrations — switch OAuth to launchWebAuthFlow for cross-browser support
- **Where:** `src/background.js`, `src/content.js` (`gcalDisconnect`), `manifest.json`
- **What:**
  - Replaced `chrome.identity.getAuthToken` (Chrome-only) with `chrome.identity.launchWebAuthFlow`, which works in all Chromium browsers (Chrome, Edge, Brave, Opera, Vivaldi, Arc) and Firefox
  - Background constructs a Google OAuth2 authorization URL, opens it via `launchWebAuthFlow`, parses the access token from the redirect fragment, and caches it in `chrome.storage.local` with an expiry timestamp
  - `handleGetToken` returns the cached token if still valid (with a 60s buffer); otherwise it launches the OAuth flow when interactive, or returns null when not
  - `handleRemoveToken` revokes the token at `oauth2.googleapis.com/revoke` and clears it from local storage
  - Added `"key"` field to `manifest.json` to pin the extension ID across all Chromium browsers — one redirect URI works everywhere
  - Added `browser_specific_settings.gecko` for Firefox compatibility
  - Removed the `oauth2` block from `manifest.json` (only needed by `getAuthToken`)
  - `gcalDisconnect` simplified — background handles token clearing and revocation
- **Why:** Reported `"This API is not supported on Microsoft Edge"` error from the previous `getAuthToken`-based implementation. `launchWebAuthFlow` is the cross-browser standard.

## 2026-04-13

### Integrations tab — Google Calendar sync
- **Where:** Integrations tab (`src/content.js` `tabIntegrations()`, new `gcal*` helpers); `src/background.js` (OAuth token proxy); `src/content.css` (new `.cc-btn`, `.cc-btn-ghost`, `.cc-gcal-*`, `.cc-last-synced`); `manifest.json` (`oauth2`, `identity` permission, Google host permissions)
- **What:**
  - Replaced the disabled stub with a fully functional Google Calendar integration
  - OAuth2 via `chrome.identity.getAuthToken` — no redirect pages or manual tokens
  - On first connect, automatically creates a dedicated "Canvas" calendar in Google Calendar so Canvas events stay separate from the primary calendar
  - "Sync Now" button pushes upcoming Canvas items as events; upserts (patches existing events, creates new ones) using a local event-ID map to prevent duplicates
  - "Auto-sync on page load" toggle — fires `gcalSyncNow(false)` silently on every Canvas page load when enabled
  - Configurable sync window (14–180 days ahead) via range slider
  - Per-type toggles: Assignments, Quizzes, Discussions, Announcements
  - Connected-account chip shows email + "Disconnect" button; disconnecting revokes the OAuth token and clears all local state
  - Last-synced timestamp updates after each sync ("just now", "5m ago", etc.)
  - Sections 2 & 3 are gated (greyed out) until the user is connected
  - Added `row()` 4th `extraAttrs` parameter to support `data-gcal-gated` attribute on rows
- **Why:** The Integrations tab was a non-functional stub. Implementing Google Calendar sync as the first real integration.

### Dark Mode — Round 8 fixes (avatar double outline, al-trigger download background)
- **Where:** `src/content.css` (dark mode block)
- **What:**
  - **Avatar double outline eliminated.** The account profile ring rule was applying `border + border-radius + box-shadow` to both the `.ic-avatar` wrapper div AND the `img` inside it — creating two concentric rings. Also caused the photo to appear off-center because adding `border` to an img shifts its layout box. Removed the `img` selectors; rule now targets `.ic-avatar` only, and added `overflow: hidden` to ensure the image is cleanly clipped to the circle.
  - **Download / action-menu trigger background removed.** Canvas's `<a class="al-trigger" role="button">` (the gear/action icon next to file entries) was matching the content-area `[role="button"]` rule and receiving `background-color: var(--cc-dark-surface-raised)` — appearing as a box behind the download icon. Added `:not(.al-trigger)` to both the base and hover/focus button selectors.
- **Why:** User screenshots showed two concentric rings around the account avatar photo and a lighter background box behind download action icons. HTML inspection confirmed both root causes.

### Dark Mode — Round 7 fixes (DesignPLUS banner, empty badge line, SVG icons, Ally button)
- **Where:** `src/content.css` (dark mode block)
- **What:**
  - **DesignPLUS course banner restored.** UNL uses DesignPLUS (`dp-*` classes/IDs) for styled course homepages. The Layer 0 blanket rule was clearing `background-color` on `dp-header` and sibling elements, wiping the UNL red banner. Added `[class*="dp-"]` and `[id^="dp-"]` to the blanket `:not(:where(...))` exemption so DesignPLUS handles its own backgrounds (it has a built-in `dp-dark-mode` class activated alongside our dark mode).
  - **Empty badge red line eliminated.** Our sidebar badge rule painted all `.menu-item__badge` elements red with a border and box-shadow. Canvas renders empty `<span class="menu-item__badge"></span>` nodes even when there are no unread messages; our rule made these tiny elements appear as red lines next to the Account avatar. Added a `:empty` override that sets `background: transparent`, `border: none`, `box-shadow: none`, `width/height/padding: 0` to hide them entirely.
  - **Canvas SVG download icons inverted.** `<img src="/images/svg-icons/svg_icon_download.svg">` and similar SVG-as-img icons have dark-colored paths invisible on a dark background. Added `filter: invert(0.85)` on `img[src*="/images/svg-icons/"]` to make them read as light icons. Does not affect inline `<svg>` or other images.
  - **Ally accessibility button excluded from surface paint.** `<button class="ally-accessible-versions">` was matching the content-area button rule and receiving `background-color: var(--cc-dark-surface-raised)` + border, creating a visible dark box next to course content file titles. Added `:not(.ally-accessible-versions):not([class*="ally-"])` to both the normal and hover/focus button selectors.
- **Why:** User shared screenshots and HTML inspections of 3 broken regions: UNL red course banner wiped on DesignPLUS homepages, red horizontal line next to Account avatar, and dark boxes around download icons. Ally button identified from HTML inspection of the download icon area.

### Dark Mode — Round 6 fixes (color inheritance, dividers, stream icons, Inbox, course-sections)
- **Where:** `src/content.css` (dark mode block)
- **What:**
  - **Root/sidebar color inheritance fixed.** Canvas sets `color: rgb(39,53,64)` on `body` and `header#header`, which cascades into every container (`#application`, `#wrapper`, `#main`, `#not_right_side`, `div.ic-app-header__main-navigation`, all nav `<li>` elements, etc.). Added `color: var(--cc-dark-text) !important` to both the Layer 1 page-surface block and the Layer 2 sidebar block so those containers contribute dark text rather than inheriting Canvas's near-black default. Confirmed by audit: 25–27 dark-text nodes per page, all now fixed.
  - **Dividers now visible.** `--cc-dark-border` raised from `rgba(255,255,255,0.028)` (2.8% — effectively invisible) to `rgba(255,255,255,0.09)` (~9%). Also changed `hr` specifically to `rgba(255,255,255,0.16)` so explicit horizontal rules read as actual dividers. Affects every border/divider in the UI. Per user: "generally, horizontal dividers should be a little lighter in color."
  - **Inbox selected-thread light-blue override.** Canvas injects `background-color: rgb(229, 242, 248)` inline on the selected/highlighted conversation row. The blanket rule exempts `[style*="background"]` to protect course card hero colors, so this light blue survived. Added a targeted `html[data-cc-dark-mode="on"] #application [style*="background-color: rgb(229, 242"]` override → `rgba(255,255,255,0.06)` to neutralize it.
  - **Stream-type icons repainted.** `.stream-icon` and `[class*="stream-icon"]` in the activity feed lost their Canvas-colored backgrounds to the blanket rule. Added a repaint to `rgba(255,255,255,0.10)` with `var(--cc-dark-icon)` text so the glyph stays readable.
  - **Dashboard card notification badges.** `.ic-DashboardCard__action-badge`, `[class*="action-badge"]`, `[class*="item_count"]` inside `#DashboardCard_Container` repainted as red pills (`#e0062f`) matching the sidebar badge style.
  - **To Do "Classes" mode section cards flattened.** In "Classes" grouping, sections have `data-section="course__CourseName"`. These were getting `background: #2c2c2c` which made them appear as raised boxes stacked inside the widget. Added a `[data-section^="course__"]` rule that resets them to `transparent` so they blend with the widget background and read as a flat grouped list.
- **Why:** Audit (dark-mode-audit.js) run across Inbox, Course home, and Course assignments pages. Identified root color inheritance, inline blue bg, and cc-section-count false positives. User additionally reported: random lighter-shade backgrounds, missing Dashboard notification colors, weird To Do class-name backgrounds, and invisible dividers.

### Dark Mode — Round 5 fixes (calmer dividers, LTI alert paint, global badge coverage)
- **Where:** `src/content.css` (dark mode block)
- **What:**
  - **Dividers calmer.** `--cc-dark-border` dropped again, from `rgba(255,255,255,0.055)` to `rgba(255,255,255,0.028)`. At 1px they now read as a faint hint rather than a bright stroke against the dark surface.
  - **LTI / notification alert paint.** Added a block painting `.ic-notification, .ic-notification__content, .ic-notification__body, .alert, .alert-info, .alert-warning, .alert-success, .alert-error, .alert-message, .ic-flash-*, #unsupported_browser, #browser_alert, .browser-alert, .unsupported-browser, [class*="Alert__"], [class*="Alert__content"]` to `var(--cc-dark-surface-raised)` with a `var(--cc-dark-border)` hairline and `var(--cc-dark-text)` text. Recursively paints inner `p/h1-h5/span/div/a/strong/em` so the alert body doesn't drop back to Canvas defaults. Fixes the "This tool needs to be loaded in a new browser window" white box on LTI pages — that's a Canvas `.alert`/`.ic-notification` container that my Round 4 rules didn't enumerate.
  - **Global red-badge coverage.** Extended badge rules beyond `#header` to the whole `.ic-app`: `.menu-item__badge, [class*="menu-item__badge"], .unread-count, .nav-badge, .ic-unread-badge, .ic-unread-badge__total-count, .ic-notification__icon, .recent_activity .unread-count, .message-list .read-state:before, .discussion-new-activity, .unread-messages-count, .unread-grade` → Canvas-red `#e0062f` pill with a `--cc-dark-page-bg` outer ring. Sidebar-scoped override keeps the sidebar ring tuned to `--cc-dark-nav-bg` so it pops against the darker nav bg.
  - **Late / missing submission pills.** Painted to amber (`#8a6a1e` / `#ffe8a8`) and deep red (`#7a1e22` / `#ffcccc`) so they stay semantically readable instead of washing out to white Canvas defaults.
- **Why:** User round 5 feedback: "There are still some notification backgrounds that do not have a red background! And e.g. the 'This tool needs to be loaded in a new browser window' has a white background still! Any ideas why? And I feel like the dividers are too bright."

### Dark Mode — Round 4 fixes (`:where()` specificity drop, enumerated dialogs, broad link paint, red-line kill)
- **Where:** `src/content.css` (dark mode block, ~lines 2906–3340)
- **What:**
  - **Blanket specificity bomb defused.** The Layer 0 nuke `[data-cc-dark-mode="on"] .ic-app *:not(...)` was (0,7,3) because every `:not()` argument contributed its full specificity. Any class-level repaint was doomed. Wrapped the `:not()` arg list in `:where()` so the blanket is now (0,2,0). Every existing class-based repaint rule now ties or wins on source order — the stack of `html[data-cc-dark-mode="on"] #application` prefix hacks from Round 3 become unnecessary (kept them; they still work, just no longer required).
  - **Enumerated dialog/modal/tray selectors (BetterCanvas pattern).** Learned from reading BetterCanvas's `darkmode_css` string: they don't use a blanket nuke at all — they enumerate every Canvas legacy and InstUI class explicitly. Added the same pattern to Layer 3 portals: `[class*="Modal__layout"]`, `[class*="Modal__body"]`, `[class*="Modal__header"]`, `[class*="Modal__footer"]`, `[class*="Modal__container"]`, `[class*="Tray__content"]`, `[class*="Tray__layout"]`, `.ReactModal__Content`, `.ReactModalPortal > div`, `.ic-Modal`, `.ic-Modal__content`, plus the ui-dialog titlebar/buttonpane/title pieces. Fixes "transparent dialogues" — previously only `[role="dialog"]` and `.ui-dialog` matched, which missed InstUI's generated-class wrappers.
  - **Broad link paint.** Added a second link rule `[data-cc-dark-mode="on"] .ic-app a:not(.Button)...:not([class*="cc-"])` → `color: var(--cc-dark-link)`. The original rule only covered `#content/#dashboard/#right-side/.ic-app-main-content` scopes, so links in floating containers, breadcrumbs, embedded user_content, footers, sidebars-inside-modals, etc. stayed at Canvas's near-black default — unreadable on dark bg. Plus a dedicated portal link rule for dialogs/trays/menus.
  - **Red line killer.** Canvas draws red borders/shadows on a bunch of states (`.ui-state-error`, `.error_box`, `input.error`, `[aria-invalid="true"]`, `.ic-Form-message--error`, `[class*="FormField__"][class*="error"]`, `hr`). All now force `border-color: var(--cc-dark-border)`, `box-shadow: none`, `outline-color: var(--cc-dark-border)`. Additionally, neutralized Canvas's colored left-accent borders on `.ig-row, .ig-header, .ic-item-row, .stream-item, .discussion-entry` (transparent) so unpublished/publish markers don't cut red lines across the dark surface. `hr` elements converted to 1px `background-color: var(--cc-dark-border)` no-border divs.
  - **Layer 0 portal blanket broadened.** Added `[class*="Modal__"]` and `[class*="Tray__"]` to the portal-blanket selector so InstUI modal/tray descendants get the transparent wipe before the enumerated repaint takes over.
- **Why:** User reported "transparent dialogues, random red lines, black links" in Round 4 and asked me to study BetterCanvas. Three findings: (1) BetterCanvas enumerates selectors rather than nuking, so they don't have the specificity bug I did; (2) their link rule targets `a` globally inside the dark scope, not just `#content`; (3) they don't fight Canvas's red accents — they just overpaint every container explicitly. Applied all three.
- **Reference:** BetterCanvas source at `github.com/UseBetterCanvas/bettercanvas`, `js/content.js` → `generateDarkModeCSS()` (the `darkmode_css` string literal with their full enumerated selector list + `--bcbackground-*`, `--bcborders`, `--bclinks` variable set).

### Dark Mode — Round 3 fixes (specificity rewrite, softer divider + shadow, profile ring, tray/badge/icon repaint)
- **Where:** `src/content.css` (dark mode block, ~lines 2906–3290)
- **What:**
  - **Root cause fix — specificity rewrite.** The Layer 0 blanket `[data-cc-dark-mode="on"] .ic-app *:not(...)` has specificity (0,7,3). Class-only repaint rules like `[data-cc-dark-mode="on"] .ic-DashboardCard` are (0,2,0) — they *lose* to the blanket and the element stays `background-color: transparent`. This explains every "weird outline / transparent card / no active state" symptom. Fixed by prefixing the losing rules with an ID (`#header`, `#application`, `#DashboardCard_Container`) or switching to `html[data-cc-dark-mode="on"]` (the attribute lives on `<html>`, so `[data-cc-dark-mode="on"] html` never matched anyway). Every Layer 1 / raised-surfaces / sidebar / tray / badge / card rule is now ID-prefixed.
  - **Softer divider lines.** `--cc-dark-border` dropped from `rgba(255,255,255,0.09)` to `rgba(255,255,255,0.055)` so table rows, card borders, and dropdown separators read as calm hairlines instead of bright strokes.
  - **Course card shadow reduced + outlines killed.** `#DashboardCard_Container .ic-DashboardCard` now uses `box-shadow: 0 1px 3px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.22)` (matches light-mode lift), `border-radius: 6px`, explicit `background-color: var(--cc-dark-surface-raised)`, and `border: none; outline: none` on the card + all inner wrappers so no ring draws around the hero.
  - **Dashboard background on scroll.** Rewrote Layer 1 page-level paints: `html[data-cc-dark-mode="on"]` + `body` as direct selectors (the old `[data-cc-dark-mode="on"] html` never matched because the attribute is on `<html>` itself). Added `min-height: 100vh` on `html` and `body` so the dark page fills the full scroll height.
  - **Account Profile ring.** `#header #global_nav_profile_link .ic-avatar, img` now has `border: 2px solid rgba(255,255,255,0.22); border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,0.35)` so the avatar has a clear outline against the sidebar.
  - **Sidebar active state (finally).** Moved to `html[data-cc-dark-mode="on"] #header .ic-app-header__menu-list-item--active .ic-app-header__menu-list-link` (adds `#header`, so specificity now beats the blanket). Bg bumped to `rgba(255,255,255,0.16)`, `margin: 0 4px`, pure white text + svg fill.
  - **Notification badge.** `html[data-cc-dark-mode="on"] #header .menu-item__badge` repainted to Canvas-red `#e0062f` with a 2px ring of the sidebar bg color so the unread count pops against dark nav.
  - **Courses tray (nav-tray-portal).** Tray rules now use `html[data-cc-dark-mode="on"]` prefix and cover `[class*="Tray__"]`, `[class*="trayContent"]`, `[role="dialog"]`, `[role="region"]`, plus `> *` children. Background paints to `var(--cc-dark-surface)` with a heavy drop shadow. Added hover/focus highlight for tray links.
  - **Icon container bg.** New rule for `#application :is(#content, #right-side, ...) :is(button.Button--icon-action, [class*="Icon__"], [role="button"][class*="Icon__"])` paints a `--cc-dark-surface-raised` pill so inline action icons (toolbars, kebabs, etc.) render with a readable container. Icon svgs inside InstUI wrappers forced to `currentColor`.
- **Why:** User round 3 feedback: "1) NOT a full outline around the Account Profile 2) Dashboard background is missing / transparent when you scroll 3) Shadows on Course Cards needs to be less — weird outlines in cards 4) Notification-type icons don't have background and don't render properly 5) Courses dialogue background is transparent 6) Divider lines too strong 7) Still no active background or active text on Sidebar". Every issue traced back to the same specificity bug with the Layer 0 blanket.

## 2026-04-12

### Dark Mode — Round 2 fixes (logo, shadows, active nav, progress color, blotchy course pages, download icons, profile separator)
- **Where:** `src/content.css` (dark mode block, ~lines 2906–3275)
- **What:**
  - **Blanket no longer kills `background-image`.** Removed `background-image: none !important` from the Layer 0 blanket and the portal blanket. Canvas's institution logo lives as a background-image on the logomark container (or a child) — the previous blanket wiped it, which is why the logo disappeared in dark mode. Only `background-color` is cleared now.
  - **Course cards keep their shadow.** `[data-cc-dark-mode="on"] .ic-DashboardCard` now paints `box-shadow: 0 6px 18px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.35)` and `border-radius: 10px; overflow: hidden` so the card floats off the dark page like it does in light mode. Inner `.ic-DashboardCard__box`/`__link` still `box-shadow: none` so the shadow isn't duplicated.
  - **Sidebar active nav item highlight.** Added `[data-cc-dark-mode="on"] .ic-app-header__menu-list-item--active .ic-app-header__menu-list-link` → `background-color: rgba(255,255,255,0.10); border-radius: 8px; color: #ffffff`, with matching rules for `[aria-current="page"]`, `.menu-item__text`, and the inner `svg`/`svg path`. The current page now reads clearly in dark mode.
  - **Profile separator line — aggressive kill.** Replaced the targeted `:has(#global_nav_profile_link)` rule with a blanket sidebar rule: `[data-cc-dark-mode="on"] #header *, .ic-app-header *, #header *::before, #header *::after, .ic-app-header *::before, .ic-app-header *::after { border-top-color: transparent !important; border-bottom-color: transparent !important; box-shadow: none !important; }`. Plus `border: none !important` on the `:has(#global_nav_profile_link)` wrapper. This catches the line regardless of whether Canvas draws it as a `border`, a `::before` pseudo, or a `box-shadow: inset 0 1px 0`.
  - **Course pages no longer blotchy.** Removed the `background-color: var(--cc-dark-surface) !important` paint from `#wiki_page_show, #course_home_content, #course_show_secondary, .content-box, .item-group-container, .ig-header, .ig-list, .ig-row, .module-sequence-footer, .summary, .ic-item-row, .assignment-details, .student-assignment-overview, .header-bar-outer-container, .sticky-toolbar, .header-bar, .page-toolbar, .breadcrumbs, nav#breadcrumbs` etc. They now `background-color: transparent !important` (inheriting the page bg). Only genuinely-raised surfaces (`.ic-DashboardCard`, planner items, recent activity, stream items) still paint to `--cc-dark-surface-raised`. Removed a duplicated "Raised surfaces" rule that had been left behind.
  - **Tasks widget progress circle color.** Changed the SVG stroke rule from `:is(...) svg :is(path, circle, ...):not([stroke="none"]) { stroke: currentColor !important; }` to `:not([stroke])`. Now SVG elements with an explicit `stroke="#hex"` presentation attribute (our progress circle, rings, etc.) keep their color instead of being force-repainted to currentColor (which was resolving to the dark-mode text color and making the circle white).
  - **Download-type icons.** Broadened the icon-color rule to also cover `[class*="Icon__"]` (InstUI-generated classes) and added `background-color: transparent !important` to the icon + `::before` selector. Also added a catch-all `[data-cc-dark-mode="on"] .ic-app :is([class*="IconDownload"], [class*="icon-download"], [class*="download-button"], a.download, button.download)` → transparent bg, light color, dark border.

### Dark Mode — Universal paint-through strategy (fix stray white regions)
- **Where:** `src/content.css` (`/* ---------- Global Dark Mode ---------- */` block, ~lines 2906–3260)
- **What:** Reworked dark mode from "enumerate every Canvas selector" to a **nuke-then-repaint** layered strategy.
  - **Layer 0 (blanket):** `[data-cc-dark-mode="on"] .ic-app *:not([style*="background"]):not([class*="cc-"]):not([id^="cc-"]):not(svg):not(svg *):not(img):not(.ic-avatar):not(.ic-avatar *) { background-color: transparent !important; background-image: none !important; }`. A second copy targets portal-mounted surfaces (`[role="menu"]`, `[role="listbox"]`, `[role="tooltip"]`, `[role="dialog"]`, `.ui-menu`, `.ui-dialog`, `[class*="Menu__"]`, `[class*="Popover__"]`, `[class*="Tooltip__"]`, `#flash_message_holder`, `#nav-tray-portal`). Exemptions keep course-card hero colors (inline styled), our `cc-*` widgets, SVG paint, and avatars intact.
  - **Layer 1 (page):** existing page-level containers still repaint to `--cc-dark-page-bg`. They win over the blanket via later source order.
  - **Layer 2 (sidebar):** added a new `--cc-dark-nav-bg: #141414` variable. `#header`, `.ic-app-header`, `.ic-app-header__logomark-container`, `.ic-app-header__main-navigation` now paint to `--cc-dark-nav-bg` instead of `--cc-dark-page-bg`, so the left sidebar reads as a distinct darker region from the main content.
  - **Profile separator line:** Canvas draws a `border-top` above the profile menu item that's invisible in light mode but shows up in dark mode. Force-removed via `border-top: none !important; border-bottom: none !important; box-shadow: none !important` on `.ic-app-header__menu-list-item`, `:has(#global_nav_profile_link)`, and `#global_nav_profile_link` plus their `::before`/`::after`.
  - **Course-card three-dots button:** added a higher-specificity override (`#content #DashboardCard_Container .ic-DashboardCard .Button--icon-action-rev` etc.) that forces `background: transparent !important; border: none !important` so the kebab button no longer reads as a pill on hover/focus. The specificity (2 IDs + 2 classes) beats the generic "content buttons get surface-raised bg" rule.
  - **Layer 3 portals:** added repaint rules for `[role="menu"]`, `[role="listbox"]`, `[role="tooltip"]`, `[role="dialog"]`, `.ui-menu`, `.ui-dialog`, `.ui-widget-content`, `[class*="Menu__menu"]`, `[class*="Popover__content"]`, `[class*="Tooltip__content"]` → `background-color: var(--cc-dark-surface-raised)`, dark border, hover states `rgba(255,255,255,0.06)`. Canvas dropdowns and popovers that mount via React portals now get properly themed.
  - **Tables:** `#content table, thead, tbody, tfoot, tr, th, td` → transparent background, dark borders (fixes white-row stripes in grade/assignment tables).
  - **To Do section cards:** strengthened the existing dark override for `#cc-weekly-tasks .cc-section-card[data-section]` to set `--cc-section-bg: #2c2c2c !important` at the variable level (not just the computed `background`), so per-section overdue/due_soon/due_week/per-class backgrounds no longer leak through.
- **Why:** The previous approach required manually enumerating every Canvas selector, and kept missing things (course-card kebab, dropdowns, tooltips, tables, class-name section cards). The blanket-transparent approach guarantees that any Canvas element we haven't named inherits the dark page background by default, instead of leaking a stray white box.

### Tasks Widget — Persist custom To Do across all pages with a right sidebar
- **Where:** `src/content.js` (`tick()` routing block)
- **What:** Removed the `isDashboard()` gate around `injectWidget()` so the custom "This Week" widget renders on course pages (and any other page that has `#right-side`), not just the dashboard. `injectCardGrades()` is still dashboard-card-view only. The widget's own guards (`#right-side` exists, no duplicate `#cc-weekly-tasks`) make the extra calls cheap; the planner API is user-scoped so the data is identical across pages and `lastWidgetRaw` caches it.
- **Why:** User reported the widget only appeared on the Dashboard. Course pages have `#right-side` but no `.Sidebar__TodoListContainer`, so `injectWidget()` now prepends to the sidebar instead of replacing native To Do.

### Tasks Widget — "Group By" setting: Priority vs Classes
- **Where:** `src/content.js` (DEFAULTS `widgetGroupBy`, new `widgetSectionsByCourse()`, `widgetSections()`, `tabWidget()` settings UI, `PREVIEW_REACTIVE_KEYS`, `WIDGET_RERENDER_KEYS`; preview sample items)
- **What:** Added a `widgetGroupBy` setting (default `'priority'`). When set to `'Classes'`, the section cards show one collapsible section per enrolled course (Economics, Accounting, etc.) instead of the Overdue / Due Soon / This Week / All priority buckets. Both modes share the same expand/collapse state mechanism. The settings preview updates reactively. Added a **Group By** row in the To Do → Behavior settings group.

---

## 2026-04-11

### Settings — Title Case for all row labels and option values
- **Where:** `src/content.js` (all `row()` calls in `tabGeneral`, `tabCards`, `tabListView`, `tabSidebar`, `tabWidget`, `tabRecentFeedback`)
- **What:** Capitalised every settings row label to Title Case (e.g., `'Dark mode'`→`'Dark Mode'`, `'Show completed'`→`'Show Completed'`, `'Sort by'`→`'Sort By'`, etc.). Also renamed `'Ring (per course)'`→`'Ring'` in the progress style dropdown and `'Due date'`→`'Due Date'` in the sort-by dropdown.

### Settings — Rename settings tabs
- **Where:** `src/content.js` (`TABS` constant)
- **What:** Renamed tabs: Cards, List (was List View), Sidebar, To Do (was Widget), Feedback (was Recent Feedback). Integrations and General unchanged.

### Dark Mode — Notion-style palette rewrite
- **Where:** `src/content.css` (entire `/* ---------- Global Dark Mode ---------- */` block)
- **What:** Replaced the blue-tinted palette (`#1a1d21` base) with a warmer Notion-style palette (`#1e1e1e` base, `#252525` cards, `#2c2c2c` elevated, `#141414` nav, `#e8e8e8` primary text, `#9e9e9e` secondary text, `rgba(255,255,255,0.07)` borders). Fixed the wrong `.cc-section-label` background rule (label is text, not a badge). Added previously missing coverage: `.cc-check` borders, `.cc-done .cc-task-title`, `.cc-section-chevron`, `.cc-progress` track, `.cc-progress-label`, `.cc-progress-seg` empty track, `.cc-fraction--circle`, `.cc-fraction--ring`, `.cc-progress-rings-pct`, ring legend items.

---



### General — Default font changed to Inter
- **Where:** `src/content.js` (defaults `fontFamily`)
- **What:** Changed the default `fontFamily` setting from `'default'` to `'Inter'` so new installs get Inter as the site font out of the box.

### Tasks Widget — Remove fraction label in Bar and Segments modes
- **Where:** `src/content.js` (`renderWidget`)
- **What:** Removed the standalone `fractionHtml` element ("7 / 15 tasks") that appeared between the progress indicator and the section cards in Bar and Segments modes. The "Show fraction" toggle still works for Ring and Circle modes, which embed the fraction inside their center.

### Tasks Widget — Reduce gap between section header and task list when expanded
- **Where:** `src/content.css` (`.cc-section-card.is-open .cc-section-panel`, `.cc-preview-widget-section.is-open .cc-preview-widget-list`)
- **What:** Reduced `padding-top` from `10px` to `4px` on the expanded panel, removing the extra bottom-margin appearance below section labels like "Overdue". Applied to both the live widget and preview.

### Tasks Widget — Circle and Half Circle progress modes
- **Where:** `src/content.js` (`circleProgressMarkup`, `progressMarkup`, `previewWidget`, settings dropdown); `src/content.css` (`.cc-progress-circle`, `.cc-progress-circle-svg`, `.cc-progress-circle-center`, `.cc-progress-circle-pct`, `.cc-fraction--circle`, dark-mode override)
- **What:** Added two new progress style options: "Circle" (full donut) and "Half Circle" (semicircular gauge). Both use a single SVG arc with the user's `widgetProgressColor`, show percentage in the center, and support the "Show fraction" toggle. The color picker appears for these modes (hidden only for Ring). Header count hidden for circle styles. Preview and live widget both render consistently.

### Tasks Widget — Customizable progress bar/segment color
- **Where:** `src/content.js` (defaults `widgetProgressColor`, `progressMarkup`, `previewWidget`, settings UI, `PREVIEW_REACTIVE_KEYS`, `WIDGET_RERENDER_KEYS`)
- **What:** Added `widgetProgressColor` setting (default `#8eaec4`). A color picker appears in the Progress settings group when style is Bar or Segments (hidden for Ring). The chosen color is applied inline to the bar fill and done-segment backgrounds in both the live widget and the settings preview.

### Recent Feedback — Count badge height fix
- **Where:** `src/content.css` (`.cc-feedback-count`)
- **What:** Bumped count pill height from `16px` to `18px` to match the Tasks Widget section count sizing.

### Settings Dialog — Match Tasks Widget preview to real widget structure
- **Where:** `src/content.js` (`previewWidget` section markup); `src/content.css` (`.cc-preview-widget-section-toggle`, `.cc-preview-widget-section-label`, `.cc-preview-widget-section-count`, `.cc-preview-widget-section-chevron`, etc.)
- **What:** Removed the `cc-preview-widget-section-head`, `cc-preview-widget-section-topline`, and `cc-preview-widget-section-note` elements from the preview. The toggle now matches the real widget: label + right group (count pill + chevron) in a single row. Section card padding changed from `10px` to `0 10px` with `padding-bottom: 8px` on `.is-open`, `border-radius` to `12px`, toggle `min-height: 28px`. Count pill and chevron sizes/colors aligned to the real widget values.

### Tasks Widget — Remove colored due dates in task cards
- **Where:** `src/content.css` (`.cc-task-due--overdue`, `.cc-task-due--soon`, `.cc-task-due--week`, dark-mode overrides)
- **What:** Replaced per-urgency colors (red, amber, blue) with a single neutral color (`#2d3b45` light, `#e8eaed` dark) for all due date/time text. Font-weight 700 retained.

### Settings Dialog — Fix Tasks Widget live preview overflow
- **Where:** `src/content.js` (`previewWidget`); `src/content.css` (`.cc-preview-col`, `.cc-preview-content`, `.cc-preview-widget-list`, `.cc-preview-widget-section.is-open .cc-preview-widget-list`)
- **What:** All preview collapsible sections now render closed so the widget fits within the preview pane. Fixed the same `padding-top` leak on `.cc-preview-widget-list` (moved to `.is-open` only). Changed `.cc-preview-col` from `overflow: hidden` to scrollable (`overflow-y: auto`, hidden scrollbar) with `align-items: flex-start` + `margin: auto 0` on content so previews center when short but scroll instead of clipping when tall.

### Tasks Widget + Recent Feedback — Scroll-edge fade masks (REVERTED)
- **Where:** `src/content.css`, `src/content.js`
- **What:** Removed scroll-edge fade masks (`.cc-fade-top`, `.cc-fade-bottom`, `.cc-fade-both` CSS classes and `updateScrollFade`/`initScrollFade` JS functions). Originally added then removed by request.

### Tasks Widget — Improve task card text readability
- **Where:** `src/content.css` (`.cc-task-title`, `.cc-task-meta`)
- **What:** Bumped task title from `11.5px` → `12.5px` (eliminates subpixel rendering inconsistency), line-height from `1.25` → `1.3`, and margin-bottom from `1px` → `2px` for more breathing room before the meta row. Meta font-size from `10px` → `11px` for easier scanning of course names and due dates.

### Tasks Widget — Fix excess height on collapsed sections
- **Where:** `src/content.css` (`.cc-section-panel`, `.cc-section-card.is-open .cc-section-panel`)
- **What:** Moved `padding-top: 10px` from the base `.cc-section-panel` rule (always applied) to the `.is-open` variant only. The padding was part of the element's own box and leaked through the `0fr` grid collapse, adding ~10px of extra space below the toggle when closed. Also added `padding-top` to the transition so it animates smoothly on open/close.

### Recent Feedback Widget — Scrollable list with max height
- **Where:** `src/content.css` (`.cc-feedback-list`)
- **What:** Added `max-height: 280px; overflow-y: auto; scrollbar-width: none` to the feedback list so it scrolls when expanded beyond the visible area. Webkit scrollbar hidden to match the Tasks widget style.

### Recent Feedback Widget — Truncate list with "Show more" button
- **Where:** `src/content.js` (`recentFeedbackWidgetMarkup`, `syncRecentFeedbackWidget`); `src/content.css` (`.cc-feedback-hidden`, `.cc-feedback-show-all`)
- **What:** Added `FEEDBACK_SHOW_LIMIT = 3` constant. Items beyond the first 3 receive class `cc-feedback-hidden` (`display: none`). A "Show N more" button is rendered below the list when hidden items exist; clicking it removes the hidden class from all items and removes itself. Button styled with hover state and dark-mode override.

### Tasks Widget + Recent Feedback — Count badge sizing and centering fix
- **Where:** `src/content.css` (`.cc-section-count`, `.cc-feedback-count`)
- **What:** Replaced fixed `width: 24px; height: 18px; display: block; line-height: 16px` with `min-width: 16px; height: 16px; padding: 0 4px; display: inline-flex; align-items: center; justify-content: center`. The pill now self-sizes around its content (compact for "0", wider for "15"), and flexbox centering is used instead of the `line-height` trick which was unreliable across fonts. Font-size 10px → 9px.

### Recent Feedback Widget — Match counter style to Tasks widget
- **Where:** `src/content.css` (`.cc-feedback-count`)
- **What:** Replaced the old 24×24 pill (`inline-flex`, padding 0 8px, `#f5f7f9` bg) with the same pill geometry used by `.cc-section-count` in the Tasks widget: 24×18px fixed, `padding: 0`, `rgba(255,255,255,0.8)` bg, `rgba(45,59,69,0.1)` border, `font-size: 10px`, `line-height: 16px`, `text-align: center`.

### Tasks Widget — Fix collapsible section chevron shift
- **Where:** `src/content.css` (`.cc-section-chevron`)
- **What:** Added `transform-origin: center center` and `will-change: transform` to the chevron element so the rotation pivot is always the geometric center and the browser composites the rotation on the GPU layer, eliminating any subpixel shift during open/close.

### Tasks Widget — Smaller checkbox and separator dots
- **Where:** `src/content.css` (`.cc-check`, `.cc-task-sep`)
- **What:** Checkbox reduced from 14×14px to 12×12px (`flex: 0 0 12px`, `border-radius: 2px`, `font-size: 8px`, `line-height: 9px`). Separator dot `font-size` reduced from 7px to 5px.

### Tasks Widget — Move section card vertical spacing onto the toggle button
- **Where:** `src/content.css` (`.cc-section-card`, `.cc-section-toggle`)
- **What:** Removed vertical padding from the card (`8px 10px` → `0 10px`) and placed it on the toggle button instead (`padding: 0` → `padding: 6px 0`). The button now owns its own breathing room, so `align-items: center` reliably centers label/count/chevron within the button's own content box rather than within an implicit card-padding region. Cards are shorter and content is optically centered.

### Tasks Widget — Section card polish (Overdue / Due Soon / This Week / All)
- **Where:** `src/content.js` (`sectionMarkup`); `src/content.css` (`.cc-section-card`, `.cc-section-toggle`, `.cc-section-label`, `.cc-section-right`, `.cc-section-count`, `.cc-section-chevron`, dark-mode block).
- **What:** Reduced card padding from `12px` to `8px 10px 0` (no bottom padding); `padding-bottom: 8px` re-added only on `.is-open` so collapsed cards have no extra bottom space. Removed section description lines ("Past due and open.", "Within 24 hours.", etc.) — `<p class="cc-section-note">` removed from markup and its CSS deleted. Background tints lightened closer to white (e.g. overdue `#fbf5f4` → `#fef9f8`). Restructured toggle so count badge and chevron share a new `.cc-section-right` flex container with `gap: 4px`, bringing them visually adjacent. Both badges shrunk slightly (count `22px` → `18px`, chevron `20px` → `18px`, SVG `14px` → `12px`). Removed stale `.cc-section-head`, `.cc-section-topline`, `.cc-section-note` CSS blocks and their dark-mode overrides.

### Tasks Widget — Task card text made more compact
- **Where:** `src/content.css` (`.cc-task-link`, `.cc-task-row`, `.cc-task-title`, `.cc-task-meta`).
- **What:** Title `14px → 12.5px`, line-height `1.3 → 1.25`, bottom margin `2px → 1px`. Meta `11px → 10px`, gap `4px → 3px`. Card link padding `8px 10px → 6px 8px`, row gap `10px → 8px`.

### Tasks Widget — Checkbox smaller; sep dots smaller; ring center shifted down
- **Where:** `src/content.css` (`.cc-check`, `.cc-task-sep`, `.cc-progress-rings-center`).
- **What:** Checkbox `18×18px → 14×14px`, border-radius `4px → 3px`, checkmark font `12px → 9px`, line-height `16px → 11px`. Sep dots gained `font-size: 7px` (inheriting the 10px meta size was too large). Ring center `padding-top: 17px → 21px` — shifts the pct+fraction group ~4px lower so it reads as intentionally below-center rather than at dead-center.

### Tasks Widget — Count badge fixed-width oval; ring fraction tightened; title smaller
- **Where:** `src/content.css` (`.cc-section-count`, `.cc-progress-rings-center`, `.cc-fraction--ring`, `.cc-task-title`).
- **What:** Count badge changed from `min-width: 18px` + `padding: 0 6px` (variable width) to fixed `width: 24px; height: 18px; padding: 0` — all badges are now an identical 24×18 oval regardless of digit count. Replaced flex centering with `line-height: 16px; text-align: center` (16px = 18px height − 2px borders) for reliable text centering. Ring fraction: `font-size: 8px → 7px`, gap `1px → 0`. Task title: `12.5px → 11.5px`.

### Tasks Widget — Count/chevron true centering; ring fraction repositioned
- **Where:** `src/content.css` (`.cc-section-count`, `.cc-section-chevron`, `.cc-progress-rings-center`, `.cc-fraction--ring`).
- **What:** Added `box-sizing: border-box` and `overflow: hidden` to count and chevron so the 18px dimension correctly includes the 1px border, giving a clean 16px inner flex area. Ring center changed to `justify-content: flex-start` with `padding-top: 17px` — this puts the percentage line-box center at the exact geometric center of the 56px ring center (28px from top), with the fraction (shrunk to `8px`) hanging 1px below it.

### Tasks Widget — Progress fraction placement (ring center + bar dedup)
- **Where:** `src/content.js` (`activityRingsMarkup`, `progressMarkup`, `renderWidget`); `src/content.css` (`.cc-progress-rings-center`, `.cc-fraction--ring`).
- **What:** Ring view: fraction (`done/total`) now renders inside `.cc-progress-rings-center` directly below the percentage, via new `.cc-fraction--ring` style (9.5px, tabular-nums). Center div changed to `flex-direction: column; gap: 2px` so they stack. The outer `fractionHtml` is suppressed for ring style. Bar view: `cc-count` header badge removed (`hideHeaderCount` extended to cover bar) so only the `cc-fraction` below the bar remains. `progressMarkup` and `activityRingsMarkup` gain a `showFraction` parameter to thread this through.

### Tasks Widget — Count/chevron centering fix; section tint colors strengthened
- **Where:** `src/content.css` (`.cc-section-right`, `.cc-section-count`, `.cc-section-chevron`, `.cc-section-chevron svg`, `.cc-section-card` tints).
- **What:** Changed `.cc-section-right`, `.cc-section-count`, and `.cc-section-chevron` from `inline-flex` to `flex` and added `line-height: 1` to block parent line-height from skewing vertical centering. Section card tints restored to clearly distinguishable values: overdue `#fde8e7` (rose), due-soon `#fef2d8` (amber), this-week `#e4f1fb` (blue), all `#eef2f6` (slate). Section borders now use the urgency hue at low opacity for coherence.

### Tasks Widget — Collapsible max-height, tooltip shadow, contrast fixes
- **Where:** `src/content.css` (`.cc-section-list`, `#cc-preview-tooltip`, `.cc-task-due--*`, `.cc-task-meta`, dark-mode tooltip).
- **What:**
  - Max-height of open sections increased: non-all `188px → 248px`, all `260px → 340px`.
  - Assignment preview tooltip shadow stripped back to `0 2px 8px rgba(15,23,42,0.08)` (dark mode: `0 2px 8px rgba(0,0,0,0.28)`) — removes the large dramatic spread.
  - Urgency due-date text colors darkened to meet WCAG AA (≥4.5:1) on near-white backgrounds: overdue `#b54747 → #c03535` (~5.6:1), due-soon `#9d6f14 → #8a5e0a` (~5.3:1), this-week `#4f7890 → #2e6a8a` (~6:1).
  - Task meta text (`#6b7780 → #505e67`) darkened for legibility at 11px.

---

## 2026-04-09 (PRD — Canvas Enhancer feature set)

### General — Global Dark Mode
- **Where:** `src/content.js` (`DEFAULTS`, `CC_DATA_ATTRS`, `applySettings`, `tabGeneral`); `src/content.css` (`[data-cc-dark-mode="on"]` block).
- **What:** Added `darkMode` setting (default `false`). Toggle in General → Extension section. Sets `data-cc-dark-mode` on `<html>`. CSS overrides Canvas's page bg (`#1a1d21`), surfaces (`#23272b`), header (`#111316`), body text (`#e8eaed`), form inputs, and borders. The modal is excluded from text overrides.

### Left Sidebar — Label position (left/right) + Smart Resize
- **Where:** `src/content.js` (`DEFAULTS`, `CC_DATA_ATTRS`, `applySettings`, `tabSidebar`); `src/content.css` (sidebar label-left block).
- **What:** Added `sidebarLabelPosition` setting (`'right'` default). New "Label position" select in Sidebar → Visibility. When `'left'`, CSS reverses nav-link flex direction. Compound selector automatically reduces icon size and row padding by 20%.

### Left Sidebar — FontAwesome icon set
- **Where:** `src/content.js` (`ICON_MAP`, `ensureIconSet`, `applyIconSet`, `removeIconSet`, `tick`, `tabSidebar`); `src/content.css` (`.cc-icon-hidden`, `.cc-nav-icon`).
- **What:** Added `iconSet` setting (`'default'` | `'fontawesome'`). New "Icons" section in Sidebar tab. `applyIconSet()` (called from `tick()`) hides original Canvas SVGs and injects FA 6 `<i>` elements for 15 mapped nav items. FA CSS loaded from cdnjs CDN.

### Tasks Widget — Fraction counter
- **Where:** `src/content.js` (`DEFAULTS`, `renderWidget`, `tabWidget`, `PREVIEW_REACTIVE_KEYS`, `WIDGET_RERENDER_KEYS`); `src/content.css` (`.cc-fraction`).
- **What:** Added `widgetShowFraction` (default `true`). Renders `"done / total tasks"` below the progress indicator. Toggle in Widget → Progress.

### Tasks Widget — Smart Folders (filter pills)
- **Where:** `src/content.js` (`DEFAULTS`, `applyFilter`, `renderWidget`, `injectWidget`, `tabWidget`, `WIDGET_RERENDER_KEYS`); `src/content.css` (`.cc-filters`, `.cc-filter-pill`, `.cc-filter-count`).
- **What:** Added `widgetFilter` setting (`'all'` | `'overdue'` | `'due_soon'` | `'this_week'`). `applyFilter()` filters tasks for the live widget; counts are computed per render. Filter pills above the task list; clicking a pill calls `saveSettings` then `rerenderWidget()` (instant from cached data). "Default view" select in Widget → Filters.

### Tasks Widget — Assignment previews (hover tooltip)
- **Where:** `src/content.js` (`DEFAULTS`, `normalize`, `renderWidget`, `attachTooltipListeners`, `buildTooltip`, `showTooltip`, `hideTooltip`, `domInit`); `src/content.css` (`#cc-preview-tooltip`).
- **What:** Added `assignmentPreviewsEnabled` (default `true`). `normalize()` stores `plannableId`/`courseId`; these are rendered as data attrs on `<li>`. `attachTooltipListeners()` uses delegated `mouseover`. After 400 ms, fetches assignment/quiz from Canvas API, caches in `previewCache`, shows tooltip with title, stripped description (200 chars), and points.

### Advanced — Command Palette (Ctrl+K)
- **Where:** `src/content.js` (`DEFAULTS`, `fetchPaletteData`, `buildPalette`, `openPalette`, `closePalette`, `searchPalette`, `renderPaletteResults`, `domInit`); `src/content.css` (`#cc-palette-root`, `.cc-pal-*`).
- **What:** Added `commandPaletteEnabled` (default `true`). Ctrl+K / ⌘K opens a full-screen overlay. `fetchPaletteData()` pre-fetches active courses + 8-week planner items on load, cached in `chrome.storage.local` for 1 hour. Fuzzy search: prefix = 3 pts, contains = 1 pt. Results grouped Courses / Assignments with match highlighting. Keyboard nav ↑↓, Enter, Esc.

### Integrations Tab — Google Calendar placeholder
- **Where:** `src/content.js` (`TABS`, `TAB_RENDERERS`, `tabIntegrations`); `src/content.css` (`.cc-btn-disabled`, `.cc-soon-badge`, `.cc-toggle.cc-disabled`).
- **What:** New sixth tab "Integrations". Disabled "Sync now" button + auto-sync toggle — UI mockup for future OAuth2.

### Widget — Fast re-render from cached raw data
- **Where:** `src/content.js` (`injectWidget`, `rerenderWidget`, `lastWidgetRaw`).
- **What:** `injectWidget()` stores raw API response in `lastWidgetRaw`. `rerenderWidget()` re-runs `normalize()` against cached data (no API call) for instant filter/sort/fraction updates.

---

## 2026-04-09

### List View — Fix: CSS selectors broken by Canvas CSS modules (settings had no effect on real site)
- **Where:** `src/content.css` (entire `/* List View (Planner) & Recent Activity */` block).
- **What:** Canvas uses CSS modules so actual DOM class names are hashed (e.g. `PlannerItem-styles__root--a1b2c3`). Static selectors `.PlannerItem`, `.PlannerApp`, `.planner-app`, `.Day`, `.planner-day` matched nothing on the real page — only the live preview (which uses our own `.cc-preview-lv-*` classes) was styled. Fixed by replacing every Canvas planner selector with `[class*="PlannerItem-styles__root"]` and `[class*="Day-styles__day"]`/`[class*="Day-styles__root"]` substring selectors. Also consolidated the two separate `.PlannerItem` blocks into one.
- **Why:** Live Preview read CSS variables directly and worked fine; the real Canvas page never matched any rule.

### Card View — Color scheme replaced with Background, Text, and Accent color pickers
- **Where:** `src/content.js` (`DEFAULTS`, `CC_DATA_ATTRS`, `CC_CSS_VARS`, `applySettings`, `tabCards`); `src/content.css` (card theme block).
- **What:**
  - Removed `cardTheme` preset dropdown (`default | pastel | mono | vibrant | dark | warm | cool`) and all associated CSS rules.
  - Added `cardBgColor` and `cardTextColor` settings (empty = Canvas default) with CSS vars `--cc-card-bg` / `--cc-card-text`, data attrs `ccCardBg` / `ccCardText`.
  - Card View "Theme" group replaced by a "Colors" group with Background, Text color, and Accent color rows.
  - Remaining density/border-radius rows moved into a new "Style" group.
- **Why:** Matches the per-field color picker pattern already used in List View.

### Card View — Course Information section background fix (corrected selectors)
- **Where:** `src/content.css` (`[data-cc-card-bg="on"]` rule block).
- **What:** Fixed incorrect selectors from first attempt. `.ic-DashboardCard__box` is the OUTER card wrapper (not a body section) — targeting it was painting the entire card container including behind the course image. The actual Course Information section is `.ic-DashboardCard__link` (an `<a>` tag inside the header). Corrected targets: `.ic-DashboardCard`, `.ic-DashboardCard__link`, `.ic-DashboardCard__header_content`, `.ic-DashboardCard__action-container`. The hero div (`.ic-DashboardCard__header_hero`) keeps its course color untouched.

### Card View — "Gap between cards" feature removed (REVERTED)
- **Where:** `src/content.js`, `src/content.css`.
- **What:** Removed `cardGap` setting entirely. Deleted `DEFAULTS.cardGap`, `CARD_GAP_SELECTORS`, `clearCardGapInline()`, `applyCardGapInline()`, the `--cc-card-gap` CSS var entry, the `set('--cc-card-gap', …)` call in `applySettings()`, the row in `tabCards()`, and all call sites. Preview card grid reverts to a fixed `12px` gap. The two prior attempts to implement this (CSS rule, then inline JS) are both removed.

### List View preview — bar width, item spacing, and Recent Activity block fixed
- **Where:** `previewListView()` in `src/content.js`; `.cc-preview-lv-row`, `.cc-preview-lv-day`, new `.cc-preview-lv-activity-*` rules in `src/content.css`.
- **What:**
  - `plannerBarWidth` was invisible in the preview — fixed by adding `border-left-width: var(--cc-planner-bar-width, 5px); border-left-style: solid;` to `.cc-preview-lv-row` and inline `border-left-color: ${it.color}` per row in the JS template.
  - `plannerItemSpacing` was invisible — fixed by adding `gap: var(--cc-planner-item-spacing, 8px)` to `.cc-preview-lv-day`.
  - `activityItemBg` had no preview element — fixed by adding a mock "Recent Activity" block (two items using `.cc-preview-lv-activity-item`) whose background reads `var(--cc-activity-item-bg, transparent)`.
  - Removed planner keys from `PREVIEW_REACTIVE_KEYS` — all planner settings are now purely CSS-var driven and update the preview automatically without a full HTML re-render.

### Dashboard view detection — `data-cc-dashboard-view` attribute
- **Where:** `<html>` element; detected via `#DashboardCard_Container`, `#dashboard-activity`, `.PlannerApp`.
- **What:** New `detectDashboardView()` returns `'card' | 'activity' | 'list' | null`. New `applyDashboardView()` stamps `data-cc-dashboard-view` on `<html>` and only writes it when the value changes (no-op if unchanged, preventing mutation observer loops). Called from `tick()` on every observer fire. `'ccDashboardView'` added to `CC_DATA_ATTRS` so the master kill switch removes it. `lastView` guard prevents redundant attribute writes.
- **Why:** Provides a stable CSS hook so view-specific rules can use `html[data-cc-dashboard-view="card"]` selectors, and lets the settings modal display the current view.

### Dashboard BG_TARGETS — Planner and Recent Activity added
- **Where:** `BG_TARGETS` array in `src/content.js`.
- **What:** Added `.PlannerApp`, `.PlannerHeader`, `.Day`, `.planner-day`, `.PlannerItem`, `#dashboard-activity`, `.ic-Dashboard-Activity` so `applyBgInline()` sweeps background color onto these containers in addition to the existing Card View targets.

### CSS — Planner and Recent Activity coverage (`src/content.css`)
- **Where:** New `/* List View (Planner) & Recent Activity */` section after the card-theme block.
- **What:**
  - `.PlannerItem` gets `border-radius: var(--cc-card-radius, 8px)` and optional box-shadow from `data-cc-card-shadow` — same shadow rules as `.ic-DashboardCard`.
  - `.recent_activity li` and `.ic-Dashboard-Activity .stream-item` get `border-radius: var(--cc-card-radius, 8px)`.
  - `[data-cc-bg-color="on"]` block extended to cover `.PlannerApp`, `.PlannerHeader`, `.Day`, `.PlannerItem`, `#dashboard-activity`, `.ic-Dashboard-Activity`.
- **Why:** Background color and card shape settings were Card-View-only; they now apply consistently across all three dashboard views.

### Tab renamed: "Course Cards" → "Card View"
- **Where:** `TABS` array and `tabCards()` title/desc in `src/content.js`.
- **What:** Label changed to match Canvas's own terminology.

### Settings modal — "List View" tab
- **Where:** `tabListView()` + `previewListView()` in `src/content.js`; `/* List View preview */` + `/* List View (Planner) & Recent Activity */` sections in `src/content.css`.
- **What:** Full List View tab added between Card View and Left Sidebar with four groups:
  - *Item Style*: background, text color, accent bar width (0–12px), item spacing (4–24px)
  - *Day Headers*: background, text color
  - *Completed Items*: opacity slider (20–100%)
  - *Recent Activity*: item background
- **Preview redesigned** to match actual Canvas Planner layout: full-width day-header strip, item rows with colored left bar + circular checkbox + icon + title + course/time meta. Completed item shown faded. Recent Activity block below.
- **New DEFAULTS:** `plannerItemBg`, `plannerItemTextColor`, `plannerBarWidth` (5px), `plannerItemSpacing` (8px), `plannerDayBg`, `plannerDayTextColor`, `plannerDoneOpacity` (50%), `activityItemBg`.
- **New CSS vars:** `--cc-planner-item-bg/text`, `--cc-planner-bar-width`, `--cc-planner-item-spacing`, `--cc-planner-done-opacity`, `--cc-planner-day-bg/text`, `--cc-activity-item-bg`.
- **New CSS rules on live Canvas:** item spacing via `margin-top`; item bg/text via data-attr gated rules; bar width via `border-left-width`; completed item opacity via attribute/class selectors; day header bg/text; Recent Activity item bg.
- **BG_TARGETS:** `.PlannerApp`, `.PlannerHeader`, `#dashboard-activity`, `.ic-Dashboard-Activity` added (container sweep for page bg color); `.Day` and `.PlannerItem` excluded — independent CSS-var rules handle those.
- **Why:** Replaced the earlier minimal tab (4 settings, wrong preview) with Card-View-level depth.

### Settings modal — Card View only hints
- **Where:** `tabCards()` in `src/content.js`.
- **What:** Added hint text to rows whose settings only affect Card View: Color scheme, Density, Image-related rows (show/opacity), Layout rows (gap, header height). Corner radius and Shadow rows updated to note they apply to cards and planner items.
- **Why:** Users in List View or Recent Activity would otherwise see settings with no visible effect and no indication why.

---

## 2026-04-06

### Project scaffold
- Created Vite-based Chrome MV3 extension.
- Files: `manifest.json`, `vite.config.js`, `package.json`, `src/content.js`, `src/content.css`.
- Build command: `npm run build` → outputs `dist/`.
- Manifest scope: `https://canvas.unl.edu/*`, permissions `["storage"]`, content script runs at `document_idle`.

### Dashboard — replace native "To Do" widget
- **Where:** Dashboard `#right-side` sidebar.
- **What:** Replaces `.Sidebar__TodoListContainer` with a custom "This Week" widget.
- **Behavior:**
  - Fetches `/api/v1/planner/items` for the current week (Monday 00:00 → next Monday 00:00, local time) using the user's session cookie.
  - Renders a gradient progress bar (`done/total`, percentage label).
  - Sorted task list: incomplete first, then by due date. Each row shows checkbox, title, course, type, due time.
  - Completion is determined by `planner_override.marked_complete`, `planner_override.dismissed`, or any `submissions.{submitted,excused,graded}`.
  - Idempotent injection guarded by `#cc-weekly-tasks`; throttled `MutationObserver` on `<html>` re-injects after Canvas's React re-renders / SPA navigation.
- **Code:** all logic in `src/content.js`; styles under `#cc-weekly-tasks .cc-*` in `src/content.css`.

### Left navigation — spacing & rounded active state (initial pass)
- **Where:** `.ic-app-header__main-navigation` and `.ic-app-header__menu-list-item .ic-app-header__menu-list-link`.
- **What:**
  - Added 8px horizontal padding to the nav column.
  - Vertical `gap: 6px` between menu items.
  - Inset link with `margin: 0 6px` + `border-radius: 10px` so the clickable area no longer touches the column edges.
  - Active state (`--active`, `aria-current="page"`) renders as a rounded inset square instead of a full-width bar.
  - Hides default left-edge active indicator (`::before`).

### Left navigation — width / background experiment (REVERTED)
- Briefly tried widening `.ic-app-header` to 112px and shifting `#wrapper` / `#main` by `padding-left: 112px`, plus a solid white background and dark icons/text.
- **Result:** broke the layout (main content overlap, theme conflicts).
- **Resolution:** reverted on 2026-04-07 — see next entry.

---

## 2026-04-07

### Subtle gridlines behind Live Preview card
- **Where:** `.cc-preview-col` in `src/content.css` (the preview column, not the card interior).
- **What:** 20×20px grid at `rgba(15,23,42,0.04)` applied via two crossed `linear-gradient` backgrounds on the column. The `.cc-preview` card itself kept its original 135° gradient — grid now sits *behind* the card so it reads as a floating element on a gridded backdrop.
- **Initial mistake:** first put the grid on `.cc-preview` (the card interior) — reverted.

### Sidebar color pickers — double-pass detection
- **Bug:** even with live DOM detection, the active-item text picker showed white because `getComputedStyle()` returned `rgb(255,255,255)` at the moment `tabSidebar()` first ran — Canvas hadn't fully applied its active-link styles yet. Diagnostic later confirmed the real color was `rgb(123, 50, 50)` once the DOM settled.
- **Fix:** new `syncSidebarPickerFallbacks()` re-reads `detectSidebarColors()` and updates any unset-setting picker's `value` + `setAttribute('value', …)` in place. Called from a new `postRenderTabPane()` hook at the end of `renderTabPane()`. Runs three times when the Left Sidebar tab opens:
  1. Synchronously (immediately after render)
  2. `requestAnimationFrame` (next paint)
  3. `setTimeout(120ms)` (catches late Canvas React updates)
- **Why triple-call:** Canvas sometimes delays applying `--active` styles depending on the current route. The rAF catches render-cycle updates; the 120ms timeout catches async React state updates. Only picks up colors for settings the user hasn't already overridden.

### Sidebar color pickers — detect real DOM values
- **Where:** new `detectSidebarColors()`, `rgbToHex()`, `parseRgbString()`, `flattenColor()`, `findOpaqueAncestorBg()` helpers in `src/content.js`. `tabSidebar()` calls them at render time.
- **What:** instead of passing static hex guesses (`#2d3b45`, `#ffffff`) as picker fallbacks, each sidebar color picker now reads the *actual current computed color* from the live sidebar DOM. For the active item's translucent overlay, the rgba is flattened against the first opaque ancestor background so the hex picker shows the visible blended color rather than `#ffffff`.
- **Why:** my previous fallbacks were guessing at Canvas defaults. On UNL Canvas, `#header.ic-app-header` is actually `rgb(69, 69, 69)` (#454545), not `#2d3b45`. The active item overlay is `rgba(255,255,255,0.16)` which blends to something like `#5C6569` on the dark header — not pure white. The pickers now show exactly what the user sees.

### Color picker prefilled values
- **Where:** `colorControl()` in `src/content.js` + every call site.
- **What:** `colorControl(key)` now accepts a second `fallback` argument (default still `#000000`). Each call site passes a semantically correct fallback so the picker shows the real current effective color when the setting is unset:
  - `sidebarBgColor` → `#2d3b45` (Canvas's stock dark nav)
  - `sidebarTextColor` / `sidebarActiveTextColor` / `sidebarActiveColor` → `#ffffff`
  - `bgColor` → `#ffffff`
  - `textColor` → `#2d3b45` (Canvas's stock body text)
  - `modalAccentColor` → `#fc5050` (the design-system red)
  - `accentColor` → `#008ee2` (Canvas link blue)
- **Why:** `<input type="color">` requires a hex value and can't represent "unset" or "transparent" — before this, every unset color picker showed black, making it look like the current color was black even when it was actually white/red/etc.

### FOUC fix — hide Canvas until the extension is applied
- **Manifest:** `run_at` changed from `document_idle` → `document_start`. Content script CSS and JS are now injected before Canvas parses its HTML, so our styles are in the cascade when the default UI would otherwise paint.
- **CSS FOUC guard:** new rule at the top of `content.css`:
  ```css
  html:not(.cc-ready) body { opacity: 0 !important; pointer-events: none !important; }
  html.cc-ready body { opacity: 1; transition: opacity 160ms ease; }
  ```
  Canvas body is invisible (and non-interactive) until `<html>` gains the `cc-ready` class, then fades in softly.
- **Bootstrap split into two phases.**
  - **`earlyInit()`** runs immediately at document_start: `await loadSettings()` → `applySettings(settings)` (sets CSS vars + data attrs on `<html>`, which is available even before body is parsed). Adds `cc-ready` in a `finally` block so body is always revealed even on error.
  - **`domInit()`** runs on `DOMContentLoaded`: `applyBgInline()`, mutation observer, first `tick()`.
- **Safe fallbacks.** `applyBgInline()` now bails if `document.body` is null (document_start). `ensurePageFont()` re-queues itself on `DOMContentLoaded` if `document.head` is null. A `setTimeout(markReady, 3000)` safety net force-reveals body after 3s no matter what, so a crash in early init can't leave Canvas permanently invisible.
- **Result:** on cold load and SPA navigation, users see a brief blank (~20–100ms while settings load + CSS computes) followed by a smooth fade-in with all customizations already applied. No more flash of stock Canvas.

### Ring gap — reinstated at 3px (real) / 2px (preview)
- **Where:** `gap` constants in `activityRingsSvg()` and preview ring SVG generation.
- **What:** bumped real widget gap 0 → 3 (r1=75, r2=62, r3=49, inner diameter 88px). Preview gap 0 → 2 (r1=54.5, r2=43.5, r3=32.5, inner diameter ~56px). Still leaves plenty of margin around the 56×56 / 38×38 center text boxes.

### Master kill switch + monochrome ring tracks
- **Extension master toggle.** New `extensionEnabled: true` setting in `DEFAULTS`. New `Extension` group at the top of the General tab with a single toggle "Enable Custom Canvas". When flipped off, `applySettings` runs `tearDownOverrides()` which removes all `CC_DATA_ATTRS` (`ccCardShadow`, `ccSidebarBg`, etc.) from `<html>`, removes all `CC_CSS_VARS` (`--cc-card-radius`, `--cc-bg-color`, etc.), clears inline bg styles via `clearBgInline()`, and removes the Weekly Tasks widget. `injectWidget()`, `tick()`, and `applyBgInline()` all bail immediately when the flag is false, so the mutation observer can't resurrect anything. Canvas returns to stock look instantly. Flipping the toggle back on reapplies everything.
- **Monochrome ring tracks.** New `hexToRgba(hex, alpha)` helper. `activityRingsSvg()` now computes each ring's track stroke as `hexToRgba(color, 0.18)` — i.e. the course's own color at 18% opacity instead of a neutral `#eaedf1`. When a ring is empty, the track is a pastel version of the filled arc's color, which reads as a cohesive palette instead of a gray background.
- **Gap removed between rings.** Changed `gap` from 6 → 0 in both real widget and preview ring SVGs. Rings now touch at their stroke boundaries (no visible space between concentric circles). With gap 0: real widget r1=75, r2=65, r3=55 (inner diameter 100px); preview r1=54.5, r2=45.5, r3=36.5 (inner diameter ~64px). Both give comfortable margins for the center text.

### Preview reactivity bug fixes
- **`refreshPreview()` was silently broken.** It was looking for `.cc-preview-wrap`, but I'd renamed that class to `.cc-preview-content` when removing the card-in-card wrapper a few turns back. The function became a no-op, so dropdown changes in Tasks Widget (progress style, sort, filter toggles) didn't re-render the preview. Fixed the selector and added a null-check for `cfg.preview` (General tab returns null).
- **`cardColumns` preview didn't react.** `.cc-preview-card-grid` had hardcoded `grid-template-columns: repeat(3, 1fr)` with no reactive rule. Added `[data-cc-card-columns="2/3/4/5/auto"]` CSS rules that mirror the real dashboard. Plus a `transition` on `grid-template-columns` for a smooth reflow.
- **Sidebar active-item text color.** New `sidebarActiveTextColor` setting paired with `sidebarActiveColor`. The Active Item row is now two rows (background + text). Real sidebar CSS sets `color` on the active link text and `fill`/`color` on the active link's SVG icons (all gated on `data-cc-sidebar-active-text`). Preview sidebar `.cc-preview-sidebar-item.active` picks up the same var.

### Row labels — vertically centered with stable position
- **Where:** `.cc-row-label` in `src/content.css`.
- **What:** removed the fixed `padding-top: 10px`. Replaced with `min-height: 44px` (matches trigger height) + `display: flex; flex-direction: column; justify-content: center;`.
- **Result:** the label's box is **always 44px tall** regardless of how tall the row's control side gets. Inside that box, title + hint are flex-centered vertically. The row keeps `align-items: flex-start` so the box itself sits at the top and doesn't shift when a shell expands.
- **Why it fixes both issues at once:** previously, a long `title + hint` label with `padding-top: 10px` sat ~24-52px from the row top, making it look bottom-heavy next to the 44px trigger. Now the label content is centered in a 44px box at the top of the row → visual midline exactly matches the trigger's midline. And because the label box has a fixed height (min-height) and is anchored to `flex-start`, it can't move when the shell's row grows.

### Modal accent color — now customizable
- **Setting:** new `modalAccentColor: '#fc5050'` in `DEFAULTS`.
- **Wiring:** `applySettings` writes `--cc-modal-accent` on `<html>`. `.cc-modal-root`'s local `--cc-ds-accent` definition now reads `var(--cc-modal-accent, #fc5050)` — so setting the variable on html cascades into the modal and replaces the red throughout (selected dropdown options, toggle-on state, range slider thumb, active tab).
- **Active tab now uses the accent.** `.cc-tab.active` color switched from `var(--cc-ds-text)` (dark gray) to `var(--cc-ds-accent)` (default red, now user-controllable). White background + accent-color text per the user's spec.
- **UI:** new "Modal" group in the General tab with a single color picker.

### Left Sidebar — color customization
- **Settings:** `sidebarBgColor`, `sidebarTextColor`, `sidebarActiveColor` in `DEFAULTS`. Empty default = use Canvas's stock colors.
- **`applySettings`:** writes three CSS variables with Canvas's defaults as fallback values (`#2d3b45` for bg, `#ffffff` for text, `rgba(255,255,255,0.18)` for active), and three data attributes (`data-cc-sidebar-bg/text/active`) gating the override rules.
- **UI:** new "Colors" group in `tabSidebar()` with three color pickers: Background, Text & icons, Active item.
- **Real-sidebar CSS:** gated rules target `#header.ic-app-header`, `.ic-app-header__logomark-container` for bg; `.ic-app-header__menu-list-link`, `.menu-item__text`, `.ic-app-header svg / .ic-icon-svg / svg path` for text/icon color (both `color` and `fill` so icon SVGs pick it up); the active link selectors for active bg.
- **Preview sidebar CSS:** rewritten to read from the same `--cc-sidebar-bg/text/active` vars so dragging a color picker updates both the preview mockup and the real sidebar in lockstep.
- **Why gating:** when the user hasn't set a color, the `[data-cc-sidebar-*]` attributes are `"off"` and none of the override rules fire — Canvas keeps its default look.

### Borderless shells, stable text, hidden scrollbars, auto scroll
- **No border on the shell — ever.** Removed `border`, hover border-color, and the open-state `border-bottom` divider. `.cc-select` is now a borderless rounded container with `background: var(--cc-ds-bg)` as the only chrome. Trigger hover is `rgba(0,0,0,0.04)` bg tint. Menu has no border and inherits the parent's background. No visible seam, no outline in any state.
- **Stable label/text position.** Root cause of the "text moves slightly" issue was twofold: (a) `.cc-row` switched from `align-items: center` to `flex-start` via the `.cc-row-expanded` class when a shell opened, and (b) the trigger gained a `border-bottom` on open, adding 0.8px to its height. Fix: `.cc-row` now uses `align-items: flex-start` **always** with `.cc-row-label { padding-top: 10px }` and `.cc-row-control { align-self: flex-start }`, so the label's vertical position is identical regardless of the row's height. Combined with the borderless trigger (no more 0.8px shift), nothing moves when a shell opens or closes. `.cc-row-expanded` class is still toggled by JS but no longer has CSS effects.
- **Hidden scrollbars inside the modal.** Added `.cc-modal-root * { scrollbar-width: none }` and `.cc-modal-root *::-webkit-scrollbar { display: none }`. Wheel/trackpad/touch scrolling still works, just no visible scrollbars (Firefox + WebKit).
- **Auto-scroll shell into view.** New `scrollSelectIntoView(el)` helper: when a shell expands and part of it would be clipped by the controls column, the column smooth-scrolls to center the shell vertically. If the shell is taller than the column, the top is anchored with 16px padding instead. Called from `setSelectState(..., true)` via `setTimeout(280ms)` — slightly after the 250ms grid-template-rows transition completes so the final height is known. Uses `getBoundingClientRect()` to check current visibility + `col.scrollBy({ top, behavior: 'smooth' })` for the scroll.

### Shell dropdown polish + layout + tab transitions
- **Dropdown shell refactor.** Border moved from trigger/menu individually to the `.cc-select` parent. Both inner elements (`.cc-select-trigger`, `.cc-select-menu`) are now borderless and transparent. When open, a single `0.8px` divider between trigger and menu is produced by `border-bottom` on the trigger. Result: the whole thing reads as one continuous shadcn/Radix-style component instead of two abutting boxes. Trigger hover gets a subtle bg tint.
- **Row top-alignment when expanded.** New `setSelectState(el, open)` helper toggles `.cc-row-expanded` on the parent `.cc-row` alongside the select's `open` class. CSS rule `.cc-row.cc-row-expanded { align-items: flex-start; }` + `padding-top: 11px` on `.cc-row-label` keeps the label pinned to the top when the shell expands instead of drifting to the vertical center. Non-dropdown rows (toggles, ranges, color pickers) keep center alignment. Helper is used consistently in trigger-click, option-click, outside-click, ESC, and close-siblings paths.
- **General tab — no preview column.** `tabGeneral()` returns `preview: null`. `renderTabPane()` detects this and adds `.cc-pane-layout--full` to the layout wrapper, which skips the preview column entirely and gives the controls column full width (`max-width: 680px`, centered, larger padding).
- **Course Cards preview — 2 rows × 3 cols.** `previewCards()` now returns 6 mock cards instead of 3 (Linear Algebra, Database Design, Business Strategy, Discrete Math, Operating Systems, World History, each with unique accent colors). Grid is still 3 columns so it wraps to 2 rows naturally. Card header height shrunk from `55%` → `42%` of the real height var, body padding tightened, code text 10→9px, title 13→11px with ellipsis truncation, so all 6 cards fit in the preview column height.
- **Dots in preview backdrop.** Added a subtle `radial-gradient` dot pattern (18×18px, 8% opacity) on `.cc-preview-col`. Makes the preview column visually distinct from the controls column at a glance.
- **Smoother tab transitions.** `.cc-tab` now has `border: 0.8px solid transparent` by default (reserves border space so switching to active doesn't cause a 1px layout jump), and the transition list explicitly covers `background`, `color`, `border-color`, `font-weight` at 220ms ease. Active state no longer changes padding (padding was being adjusted to compensate for the new border, now it's always reserved).
- **"Reset all to defaults" → "Reset".**

### Ring center text — fix margin once and for all
- **Geometry recalculated.** Real widget: SVG 168, strokeW **10** (was 12), gap 6 → 3 rings at radius 75/59/43. Innermost ring spans r=38–48, so the empty inner space is 76px diameter. Preview: SVG **124** (was 116), strokeW **8** (was 10), gap **4** (was 5) → 3 rings at radius 55/43/31, inner space 54px diameter.
- **Center container is now a fixed box, not `inset: 0`.** Real widget: `position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 56px; height: 56px;`. Preview: same trick at `38×38`. Because the box is *physically smaller* than the innermost ring's inner diameter, the text **cannot reach the rings** no matter the font weight or value.
- **Font shrunk substantially.** Real widget percentage: 36px → **22px**. Preview: 24px → **14px**.
- **Resulting margin (real widget):** "100%" at 22px ≈ 46px wide, fits in 56-box with 5px on each side, and the box itself sits 10px inside the inner ring's edge. Total visual gap from text to inner ring: **~15px**.

### General — text color + font family
- **Settings:** new `textColor: ''` and `fontFamily: 'default'` in `DEFAULTS`. Persisted in `chrome.storage.sync` like everything else.
- **`applySettings`:** writes `--cc-text-color` and `--cc-font-family` CSS variables, sets `data-cc-text-color` / `data-cc-font` on `<html>`, and calls `ensurePageFont(family)` which lazy-loads the matching Google Fonts stylesheet on first use (idempotent: skips if already loaded).
- **UI:** new `Text` and `Font` groups in `tabGeneral()`. Background settings consolidated into a single `Background` group. Font dropdown offers Default / System UI / Inter / Sora / Roboto / Lato / Poppins / Open Sans / Nunito / Source Sans 3 / Merriweather (serif).
- **Text-color CSS:** scoped to Canvas's main content containers (`.ic-app-main-content`, `#content`, `#dashboard`, `nav#breadcrumbs`, `.header-bar`, `.ic-Dashboard-header__layout`) plus their descendants — but explicitly **excludes** `svg` / `svg *` (icons keep their own colors). Also `revert !important` on `.menu-item__badge`, `[class*="badge"]`, `.ic-DashboardCard__action-badge`, `.Button--primary`, `.btn-primary` so badges and primary buttons stay distinct. Modal and `#cc-weekly-tasks` widget live outside `.ic-app-main-content` so they're naturally unaffected.
- **Font CSS:** broad `body, body *, button, input, select, textarea` sweep with `!important` (fonts cascade naturally and don't break contrast). Modal and widget protected with their own `!important` Sora rule that wins via specificity + `!important`.
- **Why scoped not global text color:** an unscoped `body *` rule would have nuked the modal's intentional color hierarchy and the widget's design tokens. Containing it to `.ic-app-main-content` and friends keeps custom colors out of our own UI surfaces.

### Sub-page background coverage — course toolbar + breadcrumbs
- **Where:** `BG_TARGETS` in `src/content.js`.
- **What:** added `nav#breadcrumbs`, `.breadcrumbs`, `.header-bar-outer-container`, `.sticky-toolbar`, `.header-bar`, `.page-toolbar`, `#course_home_content`, `#wiki_page_show`, `#course_show_secondary`, `.course-menu` to the inline-style sweep.
- **Why:** Diagnostic on a course wiki page showed the breadcrumb bar (`nav#breadcrumbs`) and the sticky course title toolbar (`div.header-bar.page-toolbar.as-course-home`) were still painting white. The diagnostic also revealed which elements should *not* be repainted: the dark left nav (`#header.ic-app-header`), notification badges (`.menu-item__badge`), button surfaces (`.btn`, `.css-*-baseButton__content`), jQuery UI dialogs (`.ui-dialog*`), and dropdown menus (`.al-options`) — all need contrast against the page bg to remain readable, so they were deliberately excluded.

### Recent Feedback — repaint the `::after` fade gradient
- **Where:** new CSS rule `[data-cc-bg-color="on"] .event-details::after` in `src/content.css`. Added `.event-details`, `.recent_feedback_icon`, `a.recent_feedback_icon` to `FEEDBACK_TARGETS` in `src/content.js`.
- **What:** F12 found the gradient lives on `div.event-details::after` (parent `a.recent_feedback_icon`), with value `linear-gradient(to right, rgba(255, 255, 255, 0) 0%, rgb(255, 255, 255) 80%)`. The right edge of each Recent Feedback item fades into white to fake text truncation. Pseudo-elements can't be touched via `element.style.setProperty` (inline-style approach), so it had to be a CSS rule. The new rule overrides the gradient end-stop with `var(--cc-bg-color)` so the fade now matches the user's chosen color seamlessly. Parent containers also added to the inline-style sweep so the rest of the row matches.

### Background — patch the Dashboard header layout strip
- **Where:** `BG_TARGETS` in `src/content.js`.
- **What:** added `.ic-Dashboard-header__layout`, `[class*="Dashboard-header__layout"]`, `[class*="ic-Dashboard-header"]`, `.ic-dashboard-app`, `.ic-DashboardCard__box`.
- **Why:** F12 inspection on the user's UNL Canvas revealed the sticky header strip above the dashboard cards is a `div.medium.ic-Dashboard-header__layout` with `rgba(255, 255, 255, 0.95)` background — a selector my previous list didn't cover. Every other element in `#main` was correctly painting the user's color (verified via diagnostic), so this was the one missing piece.

### Flat sections, simpler preview, ring polish v2
- **Live Preview — no more card-in-card.** Removed the inner `.cc-preview` wrapper (gradient bg + border + "LIVE PREVIEW" label) from `previewGeneral`, `previewCards`, `previewSidebar`, `previewWidget`. Each preview function now returns just the content. The preview column has plain `var(--cc-ds-bg)` background (no dots, no inner card). Content sits directly in `.cc-preview-content`. The "Live preview" label is gone — column position makes its purpose obvious.
- **Collapsibles → flat sections.** Industry research (macOS System Preferences, Linear, Figma, Stripe, Notion, 1Password, Vercel, Raycast) shows the consensus: navigation selects topic, content shows all settings flat with subtle visual section headers. Collapsibles are reserved for dozens of advanced options. We have 3-10 settings per tab — a perfect fit for flat. Replaced `<details>`/`<summary>` markup with plain `.cc-section` blocks. Section title is small uppercase muted text above each card, rows live in a card below (macOS style). No expand/collapse, no chevrons, no interaction overhead — just visual grouping.
- **Tab description removed.** Per the minimalism push: dropped `cfg.desc` from the controls header. Section titles + row labels carry enough context.
- **Ring widget — major aesthetic rework.**
  - **Neutral gray tracks** (`#eaedf1`) instead of course-tinted-at-16%-opacity. The previous "rainbow tracks" effect (4 different colors stacked at low opacity) competed with the actual progress arcs. Now the tracks are uniform light gray and only the filled arcs carry the course color, exactly like Apple Activity Rings.
  - **Cap visible rings at 3** (down from 4). Each ring is thicker (`strokeW: 12`, was 10) with bigger gap (`6`, was 4). Innermost ring radius is now ~50px (was ~36) → 100px inner diameter for the center text.
  - **Bigger center text:** `36px` percentage (was 26px), perfectly readable, no more cramped feel.
  - **Subtitle removed** ("X OF Y DONE") — user requested. Just the percentage now.
  - **Removed the gradient backdrop card** — the rings stand on their own without a card behind them, consistent with the new "no card-in-card" rule.
  - **Removed the drop-shadow filter** — was over-styled.
  - **Preview ring matches:** size 116px, stroke 10, gap 5, max 3 rings, center 24px, no subtitle, no backdrop. Same neutral gray tracks.

### Bulletproof bg, shell dropdowns, ring polish, minimal chrome
- **Background — bypass the CSS cascade entirely.** Previous CSS-only attempts kept losing to Canvas's painted layers (could not isolate which specific selector). Switched to JS-driven inline styles: new `applyBgInline()` walks a list of `BG_TARGETS` (`body`, `#wrapper`, `#main`, `#dashboard`, `#right-side`, `.ic-Layout-*`, `.ic-app-main-content*`, `#DashboardCard_Container`, etc.) and `style.setProperty('background-color', color, 'important')` on each. Inline `!important` beats every external CSS rule. Re-applied on every mutation tick so React re-renders don't wipe it. When the user clears the color, `clearBgInline()` removes the inline overrides. Old `[data-cc-bg-color="on"]` CSS kept as a backup.
- **Recent Feedback gradient — same JS sweep.** Added `FEEDBACK_TARGETS` covering `#right-side .events_list li`, `.recent_feedback li`, `.Sidebar__RecentFeedbackContainer li`, `[class*="recent"|"Recent"|"feedback"|"Feedback"] li`, `.ToDoSidebarItem`. Each gets `background-image: none !important` (kills the white fade gradient) and the matching bg color inline.
- **Dropdowns are now inline shells.** Replaced the `position: absolute` popover with the modern grid trick: `.cc-select-menu-wrap { display: grid; grid-template-rows: 0fr; }` → `.cc-select.open { grid-template-rows: 1fr; }`. The inner `.cc-select-menu` has `overflow: hidden; min-height: 0` so it collapses cleanly. The trigger's bottom corners square off when open and the menu joins it as one continuous shell. No height measurement needed; transitions smoothly between any natural heights.
- **Ring widget — aesthetic upgrade.** Added a subtle `linear-gradient(180deg, #fafbfc → transparent)` backdrop with 12px radius around the ring + legend so they feel grouped. Drop-shadow on the SVG (`filter: drop-shadow(0 2px 4px rgba(0,0,0,0.05))`) gives soft depth. Center now stacks `26px` percentage + tiny uppercase `X OF Y DONE` caption. Legend rows have more breathing room (gap 6px), the dot has a 2px white outline (Apple Activity Ring style), and the count text is one notch lighter. Same polish applied to the preview ring.
- **Minimal modal chrome.**
  - **Header:** removed the "Customize how Canvas looks" subtitle. Logo shrunk 40→30px, title 20→16px, header padding 16/32 → 14/24. Just logo + name + close button.
  - **Footer removed entirely.** "Changes saved automatically" indicator deleted.
  - **Reset button** moved into the bottom of the left tab rail. Tab nav is now `flex-direction: column` with `.cc-tabs-list { flex: 1 1 auto }` (tabs at top) and `.cc-modal-reset { flex: 0 0 auto; margin-top: 16px }` (reset pinned at bottom). Ghost styling, accent on hover.

### Deep fixes: page bg cascade, feedback gradient, ring overlap cap, preview fit
- **Page background — proper cascade.** Previous fix only targeted `html, body, .ic-app, #application`, which Canvas doesn't paint. Canvas's inner panels (`#main`, `#dashboard`, `#not_right_side`, `.ic-Layout-wrapper/columns/contentWrapper/contentMain`, `.ic-app-main-content`, `#right-side`, `#DashboardCard_Container`, etc.) all carry their own white backgrounds that covered the body-level color. Now every one of those containers gets `background-color: var(--cc-bg-color)` gated on a new `[data-cc-bg-color="on"]` data attribute set by `applySettings` when a color is picked. The rule only fires when the user has actually chosen a color, so the default look is preserved otherwise.
- **Recent Feedback gradient.** Canvas's right-sidebar list items have a right-side fade-out `linear-gradient` (to fake truncation on long text) that bled through as a mismatched white bar on top of the custom bg. Added rules that clear `background-image` and force `background-color: var(--cc-bg-color)` on `#right-side .events_list li`, `.recent_feedback li`, `.Sidebar__RecentFeedbackContainer li`, their `::before`/`::after` pseudo-elements, any `[class*="recent"|"Recent"|"feedback"|"Feedback"] li`, and `.ToDoSidebarItem` for good measure.
- **Ring overlap — hard cap at 4 visible rings.** Previous fix was insufficient: with `strokeW=11, gap=4`, a user with 5+ courses had an innermost ring of radius ~14.5 (diameter 29px) while the center "%" text at 22px is ~50px wide — text visibly sat on top of the inner rings. Now `MAX_VISIBLE_RINGS = 4` with `strokeW=10, gap=4`, so the innermost ring has radius ~34 (diameter 68px) — comfortably larger than the 20px "%" text. Courses beyond 4 still appear in the legend (with 0.7 opacity so it's clear they're not in the chart).
- **Preview fit — measured to fit.** Computed worst-case preview card height was ~558px but preview column usable height is ~554px on an 800px-tall viewport. Shrunk preview ring from 120 → **104px**, stroke 9 → 8, center text 17 → 15px, `.cc-preview-widget-rings` gap 10 → 8 / margin-bottom 12 → 10, `.cc-preview` padding trimmed, preview list capped at **3 items in ring mode** (4 in other modes), legend capped at 4. New computed worst-case: ~430px, fits comfortably with margin.
- **Theme tab merged into Course Cards:** removed `tabTheme` / `previewTheme` from `src/content.js`, added their rows (Accent color, Density, Border radius) to the existing "Theme" group in `tabCards()`. `TABS` and `TAB_RENDERERS` updated. Theme tab no longer appears.
- **Page background now applies to the whole page:** background rules in `src/content.css` now target `html, body, .ic-app, #application` for color, and `body` (with `body::before` for blur overlay) for image. Previously they only touched `#dashboard` and `.ic-app-main-content`, which only covered the card container.
- **Ring style: header counter no longer overlaps rings:** when `widgetProgressStyle === 'ring'`, `renderWidget()` and `previewWidget()` skip rendering the header `done/total` badge — the ring's center already shows the overall %, making the badge redundant. Widget root gets `data-style="ring"` so CSS can add extra `margin-bottom` on the header.
- **Preview fits the ring:** shrunk preview ring from 140×140 → 120×120, stroke 10→9, and widened `.cc-preview-widget-frame` max-width from 320px → 340px. The ring now sits comfortably inside the preview card with padding on all sides.

### Activity rings — multi-course progress visualization
- **Where:** `progressMarkup()`, new `groupByCourse()`, `activityRingsSvg()`, `activityRingsMarkup()`, `fetchCourseColors()`, `courseColorFor()` in `src/content.js`. New `.cc-progress-rings*` + `.cc-ring-legend-*` rules in `src/content.css`. Preview widget ring style rewritten to match.
- **What:** the `ring` progress style now renders as concentric Apple-Activity-Ring-style circles, one per course, with their own track + filled arc. Ring container is **168×168px** (real widget) / 140×140 (preview), stroke 11px, 4px gap between rings. Center shows overall %. Below the rings is a legend listing each course with a colored dot and `done/total`.
- **Course colors:** fetched once from `GET /api/v1/users/self/colors` (Canvas's per-user course color map), cached in `courseColorCache`. Falls back to a rotating palette (`#fc5050`, `#008ee2`, `#00c389`, …) if the API fails or a course has no custom color.
- **API wiring:** `injectWidget()` now `Promise.all([fetchPlannerItems(), fetchCourseColors()])` so the widget has both before first render. `normalize()` grabs a `contextCode` (`course_<id>`) per task so colors can be looked up.
- **Research:** confirmed this style is actually from **Tasks for Canvas**, not BetterCampus. BetterCampus does have a "colorful chart with various rings color coded by course" per its listing, but the definitive multi-ring pattern is Tasks for Canvas's.

### General tab
- **Where:** new `tabGeneral()` + `previewGeneral()` in `src/content.js`. Added `{ id: 'general', label: 'General' }` to `TABS`; `currentTab` now defaults to `'general'`. Reuses existing `bgColor`/`bgImage`/`bgBlur` settings and their `applySettings` wiring and Canvas-targeting CSS (both of which had been left in place when the Background tab was removed).
- **Groups:** Background color (page bg color picker), Background image (URL + blur slider).
- **Preview:** reinstates the framed background preview block that was removed with the old Background tab (same `.cc-preview-bg-*` CSS).
- **Why:** user asked for a place to change the overall page background color.

### Dropdown bug fix — preview + widget reactivity
- **Where:** custom dropdown option-click handler in `renderTabPane()` in `src/content.js`.
- **What:** handler now calls `refreshPreview()` and `rerenderWidget()` after save, mirroring the logic already present in the `input`-event path used by ranges/toggles/color pickers.
- **Why:** the dropdown handler returned early without the reactivity calls, so changing Progress Style (or any other reactive dropdown setting like Card Theme or Sort) wouldn't update the preview or the live widget until the modal was reopened.

### Live preview label — breathing room
- **Where:** `.cc-preview` and `.cc-preview-label` in `src/content.css`.
- **What:** label is now a normal-flow block with `margin-bottom: 18px` instead of `position: absolute`. Preview padding adjusted to `14px 20px 22px` to account for the label being in the flow.
- **Why:** previously the absolutely-positioned label hovered ~8px above the preview content with no real separation. Now there's an obvious gap below the label and the mock content never risks overlapping it.

### Course Cards — Theme presets
- **Where:** new `cardTheme` setting in `DEFAULTS`, `applySettings` (writes `data-cc-card-theme`), new `Theme` group in `tabCards()`, theme rules in `src/content.css` under `[data-cc-card-theme="*"]`.
- **Presets:** Default / Pastel / Monochrome / Vibrant / Warm / Cool / Dark.
- **How it works:** each preset applies a CSS `filter` (saturate/hue-rotate/grayscale/sepia) to `.ic-DashboardCard__header_image` and retints the card body background. Same rules target the preview cards (`.cc-preview-card-*`) so the modal preview matches the real dashboard exactly.
- **Dark preset** additionally sets card text color to `#f3f4f6` via `.ic-DashboardCard__header-title` / `__header-subtitle` / link selectors.

### Tasks Widget — progress styles, sort, filters
- **Where:** new settings `widgetProgressStyle`, `widgetSortBy`, `widgetShowCompleted`, `widgetHideAnnouncements`, `widgetHideDiscussions` in `DEFAULTS`. `normalize()` now takes settings and filters/sorts accordingly. `renderWidget()` calls new `progressMarkup()` helper. New groups in `tabWidget()`.
- **Progress styles:** `bar` (default), `ring` (56px SVG with blue→green gradient + pct text), `segments` (one segment per task, filled = done). Rendered identically in the live preview.
- **Sort by:** Due date / Status / Course / Type. `normalize()` switches on `widgetSortBy` and uses `localeCompare` for course/type.
- **Filters:** Show completed (on by default), Hide announcements, Hide discussions. Filters apply both to real widget and preview.
- **Preview reactivity:** added `PREVIEW_REACTIVE_KEYS` and `refreshPreview()` — when a setting that CSS vars can't handle changes (progress style, sort, filters, card theme), the `.cc-preview-wrap` innerHTML is regenerated without touching controls, so the preview updates live without losing scroll position or closing dropdowns.
- **Real widget reactivity:** `WIDGET_RERENDER_KEYS` set triggers `rerenderWidget()` which removes and re-injects the widget on the dashboard, so changes apply instantly there too.

### Preview backdrop — dots instead of grid lines
- **Where:** `.cc-preview-col` in `src/content.css`.
- **What:** replaced the crossed `linear-gradient` grid with a `radial-gradient` dot pattern (16×16px tiles, ~11% opacity). Cleaner and less busy than full lines, same "canvas surface" effect.

### Card image toggle — keep the course color
- **Where:** `.ic-DashboardCard__header_image` / `__header_hero` rules under `[data-cc-card-image="hidden"]` in `src/content.css`.
- **What:** replaced `display: none` on the image container with `background-image: none` + `display: none` on any child `<img>`. This removes the picture but leaves the colored header block (which on Canvas is the same element or a sibling) intact, so hiding the image still shows the course color.
- **Why:** previous rule collapsed the entire header area including the color block.

### Dropdown shadows removed
- **Where:** `.cc-select-menu` in `src/content.css`.
- **What:** removed the `box-shadow` on the open dropdown menu. Border + positioning alone define the popover.

### Compact tab rail
- **Where:** `.cc-modal-tabs` and `.cc-tab` / `.cc-tab.active` in `src/content.css`.
- **What:** shrunk the tab rail from 232px → 168px wide, padding 32/20 → 20/12, tab padding 12/16 → 9/12, font-size 14→13, gap 8→4, border-radius 12→8 on active state. Account for the 1.6px border on active tabs by trimming their padding to match.
- **Why:** rail was eating disproportionate horizontal space with only 4 short labels.

### Removed Background tab
- **Where:** `TABS`, `TAB_RENDERERS`, and `tabBackground`/`previewBackground` in `src/content.js`.
- **What:** deleted the Background tab entry and its renderer functions. The underlying `applySettings` code that writes background CSS vars is untouched, so any previously-saved background settings still apply harmlessly (they're all defaulted to off). Canvas-targeting CSS for `#dashboard` background also left in place for now — dormant without a UI.
- **Why:** the tab wasn't pulling its weight; background customization will likely come back as a cleaner feature later.

### Custom dropdown component (replaces native `<select>`)
- **Where:** `selectControl()` in `src/content.js` now emits a `.cc-select` widget instead of a native `<select>`. Pane handler special-cases `.cc-select` to wire trigger + options. CSS rules under `/* Custom dropdown */` in `src/content.css`.
- **What:**
  - Trigger button shows current label + chevron; click expands an absolutely-positioned menu downward (`top: calc(100% + 6px)`), rounded 10px, shadowed.
  - Options are flat buttons with hover + selected states; selected option highlighted in the accent color.
  - Chevron rotates 180° when open. Slide-in animation on open.
  - Click-outside and `Escape` both close any open menu (ESC closes dropdown first, then modal on second press).
  - Only one dropdown open at a time (opening another closes the previous).
  - Proper ARIA: `aria-haspopup="listbox"`, `aria-expanded`, `role="listbox"`, `role="option"`.
- **Layout fix:** removed `overflow: hidden` from `.cc-group` so the menu can extend past the group's border. Summary corner rounding now handled explicitly (full radius when closed, top-only when open).
- **Why:** native `<select>` was clipping longer option labels ("Cozy" in Density) because of the min-width and the constrained column. Custom dropdown sizes to content, supports ellipsis, and fits the design system.

### Modal — split layout with sticky preview + collapsible groups
- **Where:** `renderTabPane()` in `src/content.js`; `.cc-modal-pane`, new `.cc-pane-layout`, `.cc-preview-col`, `.cc-controls-col`, `.cc-group*` rules in `src/content.css`.
- **What:**
  - Refactored each `tab*()` renderer to return a config object (`{title, desc, preview, groups: [{title, rows}]}`) instead of a raw HTML string.
  - Modal pane is now a two-column flex layout:
    - **Preview column (left, 48%)** — stationary. Preview is centered vertically and horizontally, has its own overflow: hidden, and stays put while you scroll controls.
    - **Controls column (right, 52%)** — the only scrolling axis. Contains the tab's title/desc header and the collapsible groups.
  - Settings are grouped semantically (e.g. Course Cards → Shape / Image / Layout), rendered with native `<details>`/`<summary>` accordions. First group auto-opens per tab. Chevron rotates 180° on open.
  - Rows are no longer individual cards — inside a group they're flat dividers (`border-bottom` only), so groups read as single containers.
  - Tightened row typography (14/12px) and control widths (range 160px, text input 200px) to fit the narrower column.
- **Why:** user asked for a cleaner, more navigable modal — preview should stay visible while tweaking controls, and progressive disclosure (tab → group → row) reduces the amount the user has to scan at once. Native `<details>` is accessible and needs zero extra JS.

### Modal redesign — Sora + new design system
- **Where:** all `.cc-modal*`, `.cc-tab`, `.cc-row`, `.cc-btn*`, `.cc-toggle*` rules in `src/content.css`. Previews and Canvas-targeting rules untouched.
- **What:**
  - Loaded **Sora** from Google Fonts via `ensureFont()` in `src/content.js` (preconnect + stylesheet `<link>` injected on first modal open).
  - Adopted color tokens as CSS vars on `.cc-modal-root`: `--cc-ds-primary #333`, `--cc-ds-accent #fc5050`, `--cc-ds-bg #f6f8fa`, `--cc-ds-surface #fff`, `--cc-ds-border #e7ecf2`, `--cc-ds-body #616972`, `--cc-ds-muted #9fabb7`, `--cc-ds-footer #272a2b`.
  - Modal panel: `min(1180px, 90vw) × min(760px, 90vh)`, light bg (`#f6f8fa`), `0.8px` border, 16px radius.
  - Header: white surface with logo / title / subtitle / ghost close button.
  - Tab nav: ghost buttons that go solid white with `0.8px` border + 12px radius when active (no shadows).
  - Pane: 36/48px padding; settings rows are now individual white cards (`0.8px` border, 12px radius, 20/24px padding).
  - Typography: Sora throughout. Title 24/600, body 16/400 with 0.32px letter-spacing per the type scale.
  - Form controls: 10px radius, `0.8px solid #e7ecf2`, focus border `#333`. Range slider `accent-color: #fc5050`. Toggle switch turns red when on.
  - Footer: dark `#272a2b` strip with reset button (ghost) and "Changes saved automatically" muted label.
- **What was deliberately omitted:** the design system specs `pressed-3d` buttons (hard offset shadows + translateY hover). Per follow-up instruction, buttons and the active tab are flat — only the color tokens, typography, borders, radii, and layout were adopted.
- **Where:** every settings tab in `#cc-modal-root` (`.cc-modal-pane`).
- **What:** added a "Live preview" panel at the top of each tab showing scaled mockups of what the tab controls — mini course cards, sidebar strip, themed buttons/inputs, background frame, and Tasks Widget.
- **How it works:** previews use scoped class names (`.cc-preview-card`, `.cc-preview-sidebar-item`, etc.) but read from the **same** `--cc-*` CSS variables and `[data-cc-*]` attributes already set on `<html>`, so dragging any slider updates both the preview and the real Canvas page in lockstep with zero extra wiring.
- **Why:** users can fine-tune appearance without hunting on the real dashboard, and see the effect even on tabs (Background, Theme) that don't visibly affect what's behind the modal.

### Customization modal + toolbar action
- **Where:** new in-page modal injected into `document.body`, opened from the extension toolbar icon.
- **What:**
  - Added `chrome.action` (no popup) and a service worker (`src/background.js`) that listens for `chrome.action.onClicked` and sends `{type: 'cc-toggle-modal'}` to the active tab's content script.
  - Content script listens via `chrome.runtime.onMessage` and toggles `#cc-modal-root`.
  - Modal: fixed full-screen with darkened + blurred backdrop (`backdrop-filter: blur(6px)`), centered panel `min(1080px, 88vw) × min(720px, 88vh)`, rounded 18px, drop shadow.
  - Page behind is non-interactive — backdrop covers everything; `<html>.cc-modal-locked` disables scroll.
  - Closes on backdrop click, X button, or `Escape`.
  - Sidebar tab nav inside the modal (Course Cards / Left Sidebar / Theme / Background / Tasks Widget); right pane renders the active tab.
  - Footer "Reset all to defaults" button clears `chrome.storage.sync` and reapplies defaults.
- **Why:** central place to control aesthetics without leaving Canvas.

### Settings infrastructure
- **Where:** `src/content.js` — `DEFAULTS`, `loadSettings`, `saveSettings`, `applySettings`.
- **What:**
  - All settings persisted in `chrome.storage.sync`.
  - Settings applied as CSS custom properties (`--cc-*`) and `data-cc-*` attributes on `<html>`, so CSS rules can react instantly without re-injection.
  - `chrome.storage.onChanged` listener re-applies settings on cross-tab changes (popup ↔ content script reactive pattern, mirroring BetterCanvas).

### Course Card customization (gated by data attributes / CSS vars)
- **Where:** `.ic-DashboardCard`, `.ic-DashboardCard__header_image`, `.ic-DashboardCard__header_hero`, `.ic-DashboardCard__box`.
- **Settings:** corner radius (0–24px), shadow style (none/soft/strong), show/hide image, image opacity (0–1), header height (60–200px), grid columns (auto/2/3/4/5), card gap (4–40px).

### Left Sidebar customization
- **Where:** existing sidebar rules (see 2026-04-06 entry) reworked.
- **What:**
  - All sidebar rules now gated by `[data-cc-sidebar-restyle="on"]` so the user can disable our restyle entirely.
  - Hardcoded `22px` icon size and `10px` label size replaced with CSS vars `--cc-sidebar-icon-size` and `--cc-sidebar-label-size`.
  - New `[data-cc-sidebar-labels="off"]` rule hides `.menu-item__text` for icon-only mode.
- **Settings:** restyle on/off, icon size (14–32px), label size (8–14px), show/hide labels.

### Theme customization
- **Where:** `.Button--primary`, `.Button--link`, button/input border-radius globally.
- **Settings:** accent color (CSS var `--cc-accent` flows into primary buttons and link colors), density (compact/cozy/comfortable, scales card action padding), global border radius (`--cc-radius` for buttons/inputs/selects).

### Background customization
- **Where:** `#dashboard`, `.ic-app-main-content`.
- **Settings:** solid background color, background image URL (cover / fixed), background blur (0–20px via `backdrop-filter` on a `::before` overlay).

### Weekly Tasks widget — toggle to disable
- **Where:** existing widget injection logic.
- **What:** new `widgetEnabled` setting (default `true`); when toggled off, the widget is removed and Canvas's native `.Sidebar__TodoListContainer` is left alone (until next dashboard load — re-enabling will re-inject on the next mutation tick).

### Left navigation — shrink icons & labels (replaces width experiment)
- **Where:** `.ic-app-header__menu-list-item .ic-app-header__menu-list-link` and its descendants.
- **What:**
  - Reverted all width / background / color overrides — Canvas's default nav width and theme colors are preserved.
  - SVG icons forced to **22×22** (down from ~28).
  - Labels (`.menu-item__text` and the link's child `<div>`) set to **10px / line-height 1.2** with `letter-spacing: 0`.
  - `word-break: normal` and `overflow-wrap: normal` on the link to prevent mid-word splits.
  - Tighter vertical padding (8px) and `gap: 4px` between items to compensate for the smaller icons.
  - Active background switched back to a light overlay (`rgba(255,255,255,0.18)`) appropriate for Canvas's dark nav; rounded square inset preserved.

---

## 2026-04-09

### Sidebar color pickers — detect visible text color, not `<a>` color
- **Where:** `detectSidebarColors()` in `src/content.js`.
- **What:** `getComputedStyle(link).color` was reading the `<a>` element, but Canvas frequently paints the visible label color on a child span (`.menu-item__text`) or inner `<div>`. Diagnostic on an active Dashboard link showed `<a>` color `rgb(255,255,255)` while the visible `.menu-item__text` was `rgb(208,0,0)` — so the picker was prefilled with white instead of the actual red text color.
- **Fix:**
  - New `readLinkTextColor(link)` helper walks the link's text-bearing descendants (prefers `.menu-item__text`, then any inner `div`/`span` with non-whitespace text), reads `getComputedStyle(el).color` on the deepest match, and only falls back to the `<a>`'s own color if nothing is found.
  - New `readActiveBgColor(activeLink)` walks the `<a>` → `<li>` → wrapper chain and returns the first non-transparent background, flattened over the nearest opaque ancestor — so Canvas variants that style the active state on the `<li>` instead of the `<a>` are picked up.
  - `detectSidebarColors()` now also prefers an inactive `<li>` for the base text-color reading so an `--active` override can't pollute it.
- **Why:** ensures the Active-item text and Active-item background pickers always prefill with the color the user actually sees, not the stale `<a>`-level default. Especially matters when the user hasn't overridden either setting.

### Cards tab — removed "Columns" selector
- **Where:** `tabCards()` "Layout" group in `src/content.js`; `[data-cc-card-columns="..."]` rules in `src/content.css`.
- **What:** dropped the Columns dropdown that let users force a 2/3/4/5-column grid on `.ic-DashboardCard__box`. Removed the `cardColumns` default, the `root.dataset.ccCardColumns` assignment in `applySettings()`, the five `[data-cc-card-columns="…"] .ic-DashboardCard__box` rules, the width-reset helper, and the preview-grid `[data-cc-card-columns="…"]` variants (preview now always renders 3 columns).
- **Why:** user requested — column count should be left to Canvas's own responsive layout.

### Tasks Widget — inherit page font instead of forcing Sora
- **Where:** `#cc-weekly-tasks` font rules in `src/content.css`.
- **What:**
  - Removed `#cc-weekly-tasks, #cc-weekly-tasks *` from the `font-family: "Sora" … !important` protection rule (now scoped to `.cc-modal-root` only).
  - Changed `#cc-weekly-tasks` base rule from a hardcoded system-font stack to `font-family: inherit` so the widget picks up Canvas's body font (or the user's page-font override from the General tab).
- **Why:** the widget lives on the Canvas page and should match every other component. Previously it always rendered in Sora regardless of what the rest of the page used.

---

## How to read this file

- Group entries by date (YYYY-MM-DD), most recent at the bottom of each section.
- Each change should answer: **Where** (Canvas DOM region), **What** (selectors + visual effect), and ideally **Why** if the choice isn't obvious.
- Reverted changes stay in the log with a `(REVERTED)` tag and a note about what replaced them — so future-us can avoid re-trying things that didn't work.
