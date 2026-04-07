# Custom Canvas — Changelog

A running log of every modification this extension makes to the Canvas LMS UI.
Each entry records **what** changed, **where** in Canvas it applies, and the
**selectors / files** touched so future edits can find the relevant code fast.

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

## How to read this file

- Group entries by date (YYYY-MM-DD), most recent at the bottom of each section.
- Each change should answer: **Where** (Canvas DOM region), **What** (selectors + visual effect), and ideally **Why** if the choice isn't obvious.
- Reverted changes stay in the log with a `(REVERTED)` tag and a note about what replaced them — so future-us can avoid re-trying things that didn't work.
