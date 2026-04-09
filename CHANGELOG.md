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

## How to read this file

- Group entries by date (YYYY-MM-DD), most recent at the bottom of each section.
- Each change should answer: **Where** (Canvas DOM region), **What** (selectors + visual effect), and ideally **Why** if the choice isn't obvious.
- Reverted changes stay in the log with a `(REVERTED)` tag and a note about what replaced them — so future-us can avoid re-trying things that didn't work.
