# Custom Canvas — Changelog

A running log of every modification this extension makes to the Canvas LMS UI.
Each entry records **what** changed, **where** in Canvas it applies, and the
**selectors / files** touched so future edits can find the relevant code fast.

---

## 2026-04-29 (7)

### Planner — Centring fix was in the wrong function (native facade vs. injected row)
- **Where:** `src/content.js` (`skinPlannerGroupings()` native-toggle row block — the one that handles Canvas's `[data-testid="completed-items-toggle"]` button when Canvas itself renders the facade)
- **What:** Re-added the `isOnlyItem` flex-centring branch in `skinPlannerGroupings`, with the missing piece that makes it actually work: forcing `items.height` (not just `min-height`) to the hero's measured `offsetHeight`, plus `align-items: flex-start` so the centred toggle stays left-aligned within the column. Marks `group.dataset.ccCompletedOnlyToggle = 'true'` in this case (and `delete` in the non-only-item case) so any debugging probe can see which groups are in the centring branch.
- **Why:** Diagnostic output from the user revealed the actual bug: their groups all rendered Canvas's **native** completed-items facade (`.CompletedItemsFacade-styles__root` containing `<button data-testid="completed-items-toggle">`), not our injected `.cc-completed-toggle-row`. The centring logic I added in 2026-04-29 (5) and (6) lived in `syncPlannerCompletedCollapseControls()` — which **early-returns when the native facade exists**. So none of the centring code ran on the cards the user was looking at. Two changes back I had also deleted the matching `isOnlyItem` flex-centring from `skinPlannerGroupings` thinking it caused variance — that deletion was the actual root cause of the user-visible "not centred" bug. Restored, with the height-forcing fix applied here too.
- **Pattern (P16):** When a layout symptom has two possible code paths handling it (two functions, two component variants from the upstream library), fixing the symptom in one path doesn't fix the other. The fix has to live in the path that actually owns the rendered element, or in both — and the only reliable way to know which path is rendering is to read the live DOM. Diagnostic output is non-optional for this kind of debugging; without it I'd have kept guessing about the injected row when the actual element on screen was the native facade.

## 2026-04-29 (6)

### Planner — Toggle margin AND centring: condition was checking the wrong count
- **Where:** `src/content.js` (`syncPlannerCompletedCollapseControls()` body)
- **What:** Two structural fixes, both rooted in the same condition error in the prior change:
  - **Replaced `visibleTaskCount === 0` with `visibleNonToggleCount === 0`.** `visibleTaskCount` counts only **completed** items that are currently visible. When the user has *active* items above the toggle and collapses the completed section, `visibleTaskCount` drops to 0 (no visible completed) — but the toggle is **not** the only visible thing; the active items above it are still rendered. The prior code wrongly entered the "only-toggle / centre vertically / margin: 0" branch in this case, which is what produced the 0-px collapsed-after margin in the user's HTML samples. New variable counts every non-toggle wrapper (active + visible completed) and only takes the centring branch when *nothing* besides the toggle is visible in the group.
  - **Forced `items.height` (not just `min-height`) to the hero height in the centring branch.** `skinPlannerGroupings()` runs first each tick and writes `items.height = 'auto' !important`. The prior centring branch set only `min-height`, which `auto` cooperates with (intrinsic height wins if smaller than min-height — but only when the parent has no flex constraint forcing stretch, which it didn't in this layout). Setting `height` AND `min-height` to the measured `hero.offsetHeight` gives flex-centring real free space to distribute, so the toggle actually centres vertically against the course-card hero.
  - Added `align-items: flex-start` so the centred toggle stays left-aligned within the column rather than getting horizontally centred too.
  - Properly resets `height`, `min-height`, `flex-direction`, `justify-content`, `align-items` via `removeProperty` when the layout flips back from centring branch to plain block flow — prevents leftover styles from a previous tick.
- **Why:** The user pasted three HTML samples showing margin going `14px (initial)` → `6px (expanded)` → `0px (collapsed-after)`. The 14 → 6 jump was the prior `syncPlannerCompletedCollapseControls` `'6px'` literal (fixed in 2026-04-29 (5)). The 6 → 0 jump was the wrong-condition centring branch (this fix). With both addressed, the margin is now `14px` in **every** state where there are visible items above the toggle, and the only-toggle centring branch is entered only when no active items exist at all.
- **Pattern (P15):** State-derived variable names mislead. `visibleTaskCount` *sounds* like "count of visible tasks (anything task-shaped)", but the implementation only counted completed wrappers. Any condition built on it inherits the misleading scope. When a variable is the basis of a layout-mode flip, the variable's name should *exactly* describe what it counts, and the condition should *test what you mean*, not what's convenient with the variable that already exists.

## 2026-04-29 (5)

### Planner — Toggle margin variance traced to a *second* code path; vertical centring on only-toggle groups
- **Where:** `src/content.js` (`syncPlannerCompletedCollapseControls()` body, the function that owns our injected `.cc-completed-toggle-row`)
- **What:** The 2026-04-29 (4) fix only addressed `skinPlannerGroupings()`. There's a **second** function — `syncPlannerCompletedCollapseControls()` — that creates and styles our injected `<li class="cc-completed-toggle-row">` (used when Canvas hasn't rendered its native facade). Line 3974 still had the same shape of bug:
  ```js
  toggleRow.style.setProperty('margin-top', visibleTaskCount === 0 ? '0' : '6px', 'important');
  ```
  After expand → collapse, `visibleTaskCount` flipped, the margin flipped 6 px → 0 px on every click. The HTML samples the user pasted made this unambiguous: expanded showed `margin-top: 6px`, collapsed-after showed `margin-top: 0px`. Fix: replaced the conditional with branch-specific stable values:
  - Items above the toggle (`visibleTaskCount > 0`): always `margin-top: 14px`, items container `display: block`. Constant across expanded / collapsed clicks.
  - Only the toggle visible (`visibleTaskCount === 0`): `margin-top: 0` (centring handles spacing), items container `display: flex; flex-direction: column; justify-content: center`, *with* `min-height` set to the group's hero/title height (measured live via `offsetHeight`). Without `min-height` the flex-centre had no free space to distribute and the toggle just stacked at the top of the card — that's the second issue the user reported ("the link should be centred vertically. Which it is not.").
- **Why:** The vertical-centre branch was already trying to centre via `display: flex; justify-content: center` — but `skinPlannerGroupings()` (which runs first each tick) explicitly sets `items.height = auto`, so the flex container had no extra space to redistribute. Measuring the hero's `offsetHeight` and forcing `min-height` to match gives the items column the same height as the course-card hero on its left, which is what makes flex-centre actually visible.
- **Pattern (P14):** When the same DOM element is touched by multiple sibling functions in the same tick, the *latest* one wins on cascade — but only if it sets the property at all. If function B sets a property conditionally, function A's setting will leak through whenever B's condition is false. Audit by property: every property that needs to be stable should have exactly one writer, or every writer should set it unconditionally with the same value.

## 2026-04-29 (4)

### Planner — Completed-items toggle margin shrinks after expand → collapse
- **Where:** `src/content.js` (`skinPlannerGroupings()` items-children loop + native toggle row block)
- **What — three structural changes that together remove the margin variance:**
  - **Loop now skips the native completed-toggle row.** Added `if (child.matches('.planner-completed-items, [class*="CompletedItemsFacade-styles__root"])) return;` and a fallback `if (child.querySelector('[data-testid="completed-items-toggle"]')) return;`. The per-child loop wrote `margin-top: 6px` to every non-injected child, including the native toggle row, before the dedicated native-row block below overrode to 14 px. Within a single tick that override worked, but on tick boundaries during React's re-commit phase, the override conditional could skip while the loop's 6 px stuck — which is the value the user was seeing after toggling.
  - **Removed the `isOnlyItem ? '0' : '14px'` conditional.** Always sets `'14px'` now. `isOnlyItem` was computed every tick from `wrappers.length === 1 && wrappers[0] === nativeRow`. During React's re-render after a toggle click, the wrapper count can transiently flatten to just the toggle row itself for one or more ticks — flipping `isOnlyItem` true and writing **0 px**. The user reported the margin "becomes less" after toggling, which is exactly that flicker landing on 0.
  - **Removed the `isOnlyItem`-dependent flex/flex-direction/justify-content block on the items container.** It was tied to the same fragile condition and caused a one-tick layout shift between `display: block` and `display: flex; flex-direction: column; justify-content: center` whenever `isOnlyItem` flipped. Items container now always uses `display: block`.
- **Why:** The user reported `margin-top` on the toggle row changing — visibly shrinking — between expand → collapse cycles, despite the CSS rule and the JS override both nominally specifying 14 px. The root cause was three competing inline-style writes per tick, gated on a stateful condition that wasn't actually stable across React's reconciliation. The fix is to make 14 px the **only** thing any code path writes to that property, regardless of state. The same shape of bug as P11 (compounding box-shadows on every nested wrapper): when N pieces of code write the same property with `!important`, the latest one wins by source order — but tick timing across a React commit boundary can silently skip the latest writer, exposing the earlier ones.
- **Pattern (P13):** `!important` inline styles set in a loop are not idempotent across React re-renders — the loop runs over the DOM as it exists at one moment in time. Conditionals that read live DOM (`querySelector`, `wrappers.length`, etc.) inside the same tick can produce different answers on every run when the DOM is mid-mutation. For any property you want to be truly stable across renders, set it from a **single** code path with no conditionals, and skip that element from any iteration that might also write the property.

## 2026-04-29 (3)

### Planner — Completed-items toggle: kill chevron rotation animation, more breathing room above
- **Where:** `src/content.css` (`.cc-completed-toggle-row`, `.cc-completed-toggle-chevron`); `src/content.js` (native Canvas toggle row inline margin in `skinPlannerGroupings`)
- **What:**
  - Removed `transition: transform 0.18s ease` from `.cc-completed-toggle-chevron`. The chevron rotation between `aria-expanded="false"` (`rotate(0deg)` →) and `="true"` (`rotate(90deg)` ↓) now snaps instantly instead of easing.
  - Bumped `.cc-completed-toggle-row` `margin-top` from `6px` → `14px`, and the matching inline `margin-top` set on the native Canvas toggle `<li>` in `skinPlannerGroupings` from `'6px'` → `'14px'`. Both code paths needed updating because we enhance two different shapes of toggle row (our injected `.cc-completed-toggle-row` and Canvas's native `.planner-completed-items` `<li>`); they should look consistent regardless of which renders.
- **Why:** The 180ms rotation read as a "twitch" because the chevron is small (12×12) and the angle change is a hard 90° pivot — there's not enough motion arc for an eased animation to feel organic, so it just looks jittery. Snapping the icon swap is cleaner. The 6px margin was visually crowding the toggle against the last completed task card above it; 14px sits the row clear of the card's drop-shadow / border and matches the typical inter-card spacing in the planner.

## 2026-04-29 (2)

### Dark Mode — `.cc-completed-toggle-btn` painted with surface-raised bg behind the label
- **Where:** `src/content.css` (gray-button rule + `:hover` / `:focus` siblings, dark mode block)
- **What:** Consolidated the individual `.cc-`-prefixed exclusions in the gray-button rule into one broader pattern: `:not(.cc-task-link):not(.cc-feedback-item):not(.cc-section-toggle)` → `:not([class*="cc-"])`. Net effect: every `cc-*`-prefixed widget button (including `.cc-completed-toggle-btn`, which was missing from the explicit list) now skips the surface-raised paint.
- **Why:** The `<button class="cc-completed-toggle-btn">` that wraps the "Show/Hide N Completed Items" label was matching `<button>` in the gray rule's `:is(...)`, and the `:not()` chain enumerated `.cc-task-link / .cc-feedback-item / .cc-section-toggle` but missed `.cc-completed-toggle-btn`. The button's own rule sets `background: transparent` without `!important`, so the gray rule's `!important` paint won — the label span looked like it had an "extended background" because its parent button got `--cc-dark-surface-raised` painted behind it.
- **Pattern (P12):** Maintaining a hand-enumerated exclusion list for our own widget classes is fragile — every new `cc-*` widget needs to be added or the gray rule paints over it. Switch to the same `[class*="cc-"]` pattern Layer 0's exemption uses (where it's been working without collisions for months) so future widgets are automatically protected.

## 2026-04-29

### Dark Mode — InstUI Checkbox painted the whole row, not just the square
- **Where:** `src/content.css` (InstUI Checkbox paint rule near the toggleFacade block)
- **What:** Tightened `[class*="checkboxFacade"]` to `[class*="checkboxFacade__facade"]` on both the off-state paint rule and the `:checked + label` accent paint rule.
- **Why:** Substring match on `checkboxFacade` caught both the visible square (`css-…-checkboxFacade__facade`) AND the wrapper `css-…-checkboxFacade` element that contains the square + label text. Painting the wrapper made the entire checkbox row read as a dark filled rectangle ("extended background"), not just the square. Anchoring on the BEM `__facade` child suffix matches only the visible square — same fix shape as the Badge wrapper bug (P1) and the original textInput facade rule.
- **Pattern (P1, again):** Every time we use `[class*="X"]` to target an InstUI sub-element, we have to ask: does `X` also appear in the wrapper class name? If yes, anchor on the `__` BEM separator (`[class*="X__sub"]`) so only the actual sub-element matches. The `toggleFacade__facade` rule had this discipline; the `checkboxFacade` rule missed it. Sweep candidate: every other `[class*="…"]` selector in the dark-mode block.

## 2026-04-28 (9)

### Dark Mode — Profile tray "ends early" with a visible shadow band underneath
- **Where:** `src/content.css` (nav-tray-portal paint rule near line 4530, dark mode block)
- **What:** Three-part fix for the tray bg ending mid-viewport with a visible dark band:
  - Changed `box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5)` → `box-shadow: none` on the multi-selector tray paint rule (was hitting `#nav-tray-portal`, every direct child, every `[class*="tray"]`/`[class*="Tray__"]`/`[class*="trayContent"]` wrapper, `.navigation-tray-container`, `[role="dialog"]`, `[role="region"]` — about 9 stacked drop-shadows compounding).
  - Added a single soft halo `box-shadow: 0 0 32px rgba(0, 0, 0, 0.4)` only on the outer `[class*="Tray__"]` panel — directionless, so it works regardless of whether the tray slides in from left or right, and doesn't draw a visible band when content is shorter than the viewport.
  - Forced `min-height: 100vh; box-sizing: border-box` on the outer panel containers (`[class*="Tray__"]`, `.navigation-tray-container`, `[role="dialog"]` scoped to `#nav-tray-portal`) so the dark surface fills the viewport regardless of content height. Without this, InstUI's tray sized to its content, leaving the underlying page bg (`#191919`) visible below the panel's last child as a darker band — exactly the "sidebar ends early" symptom.
- **Why:** The downward y-offset on the shadow was wrong for a side-mounted slide-out panel — drop shadows belong on bottom-anchored UI (toasts, tooltips), not on full-height side trays. The compounding across nested wrappers made it worse: every layer InstUI nested its content in got its own shadow, so the visible "band" near the content's end was 5–9 drop-shadows stacked. And the missing `min-height` meant the dark surface itself ended where InstUI sized the tray, exposing the page bg below.
- **Pattern (P11):** Always anchor box-shadows on a single outer element, never on every wrapper in a chain. Multi-selector paint rules that include `box-shadow` in the same declaration block get applied N times when N elements match — even if each shadow is reasonable in isolation, N copies of it stack into something heavy and visually wrong. Either split the shadow into its own rule with a single specific selector (preferred) or scope the shadow with a `:not()` chain so only the outermost match keeps it.

## 2026-04-28 (8)

### Dark Mode — Profile-tray Logout button outline-only; close-button focus ring invisible
- **Where:** `src/content.css` (gray-button rule scope expanded; new IconButton focus-ring rule above the toggleFacade block)
- **What:**
  - Added `#nav-tray-portal, #flash_message_holder` to the scope of the gray-button paint rule (and its `:hover` / `:focus` siblings). Buttons rendered inside the profile tray and flash-message portals — most visibly the **Logout** button at the top of the profile tray — now receive `--cc-dark-surface-raised` background + `--cc-dark-border` border, matching how the same buttons render in main content. Previously the gray rule's scope listed only main-content / right-side / breadcrumb regions, so portal-mounted buttons fell through: Layer 0's portal blanket wiped the bg, the portal-paint rule sets only `color`/`border-color`, and Canvas's default `.btn` border survived as an outline-only ghost on the dark page.
  - Added an explicit `outline: 2px solid #fc5050` focus ring on InstUI IconButtons (`[data-cid*="IconButton"]`) inside `.ic-app`, `#nav-tray-portal`, and `#flash_message_holder` when `:focus-visible`. The close (X) button at the top of the profile tray and similar icon-only controls now show a clear accent-coloured focus halo in dark mode, matching the Canvas-red ring you see in light mode. Without this, `color-scheme: dark` hands focus styling back to the browser, and the default dark-themed focus halo often disappears against `--cc-dark-page-bg`.
- **Why:** Visual parity with light mode, traced from a side-by-side screenshot comparison. Both bugs share root cause **(P10):** rules scoped to "main content" implicitly assume buttons are mounted there, but Canvas mounts a meaningful chunk of interactive UI in `#nav-tray-portal` and `#flash_message_holder` portals outside the normal content tree. Any rule that talks about buttons / inputs / focus indicators needs to include the portal IDs in its scope, not just the content IDs.

## 2026-04-28 (7)

### Dark Mode — InstUI ToggleFacade / CheckboxFacade invisible in profile tray + accessibility settings
- **Where:** `src/content.css` (dark mode block — new section after the InstUI input-facade rule near line 5050)
- **What:** Added repaint rules for the InstUI Checkbox-as-Toggle ("Use High Contrast UI", "Use a Dyslexia Friendly Font" in the profile tray) and the standard square Checkbox:
  - `[class*="toggleFacade__facade"]` → `--cc-dark-surface` background + faint border (the off-state track is now visible)
  - `[class*="toggleFacade__iconToggle"]` → `--cc-dark-surface-raised` background + drop-shadow (the thumb contrasts against the track)
  - `[class*="toggleFacade__icon"] svg` → `--cc-dark-text` colour (the X / check inside the thumb is visible)
  - `[class*="checkbox__input"]:checked + label [class*="toggleFacade__facade"]` → `#fc5050` (on-state track tinted with our accent — works because InstUI mounts the semantic `<input>` as a sibling immediately before the `<label>` that contains the facade, so the adjacent-sibling combinator + descendant works)
  - `[class*="checkboxFacade"]` (the non-toggle square checkbox variant) → same dark surface + accent-on-checked treatment
- **Why:** Same root cause as the textInput / textArea / select / numberInput / dateInput / timeInput facades I painted earlier: InstUI's Checkbox component renders the visible widget as a wrapping `__facade` span, not the semantic `<input>` (which is hidden via `opacity: 0`). Layer 0 wipes the facade's background, the input is invisible by design, so the toggle becomes a visible-but-empty void in dark mode. Adding the toggleFacade family to the same enumerated paint list closes the gap.
- **Pattern reinforced (P4 from 2026-04-28 (2)):** Every InstUI form widget that "looks like an input" is actually a wrapping span hierarchy with a hidden semantic element. Paint the wrapper, not the leaf. Audit list to keep extending: textInput, textArea, select, numberInput, dateInput, timeInput, toggleFacade, checkboxFacade — and the next time something looks "broken", the first hypothesis should be "did Layer 0 wipe a `__facade` we haven't enumerated yet?"

## 2026-04-28 (6)

### Dark Mode — Disabled / secondary InstUI BaseButtons (e.g. "Apply" filter) showed outline only
- **Where:** `src/content.css` (gray-button rule + `:hover` / `:focus` siblings, dark mode block)
- **What:** Removed `:not([data-cid*="BaseButton"])` from the `:not()` chain on the gray-button paint rule. Kept `:not([data-cid*="IconButton"])` — genuinely icon-only InstUI buttons should stay transparent. Net effect: plain `<button data-cid="BaseButton Button">` (Apply, Cancel, Submit, secondary actions, disabled states) now gets `--cc-dark-surface-raised` background + `--cc-dark-border` border, instead of inheriting Canvas's default border with Layer 0 having wiped the bg.
- **Why:** Two changes back (2026-04-28 (3)) I excluded the entire BaseButton family to fix the Compose button looking "broken" in dark mode. The exclusion was over-broad — it spared Compose (an InstUI primary button with a coloured emotion-CSS bg) but also stripped the gray paint from every *secondary* / *disabled* BaseButton, which have no coherent native bg of their own. Once Layer 0 cleared their backgrounds, those buttons rendered as outline-only ghosts. The Apply filter button is the visible case the user reported, but the same pattern affects every secondary action across the assignment forms, gradebook controls, discussion forms, and account settings. Excluding only IconButton (which really should stay transparent) and re-including plain BaseButton Button restores the consistent secondary-button appearance across light and dark mode.
- **Trade-off acknowledged:** The Compose button (InstUI primary) will now also get the gray surface-raised paint, losing its native primary-blue emotion-CSS bg (Layer 0 wipes that anyway). If you want primary InstUI buttons to keep their accent colour in dark mode, the right fix is per-variant detection (e.g. an inline-style or generated-class signature for `color="primary"`), not a blanket BaseButton exclusion. Worth a follow-up if primary buttons reading as gray feels wrong.

## 2026-04-28 (5)

### Dark Mode — Sidebar `.btn` showed an outline but no fill (e.g. "Show Saved What-If Scores")
- **Where:** `src/content.css` (gray-button rule + `:hover` / `:focus` siblings, dark mode block)
- **What:** Removed `:not(:has(>i[class*="icon-"]:only-child))` and `:not(:has(>svg:only-child))` from the `:not()` chain on the gray-button paint rule (and the matching hover/focus duplicates). Affects `<button class="btn …"><i class="icon-…"></i> Text</button>`-shaped buttons everywhere in main content / right-side / breadcrumbs — they now correctly receive `--cc-dark-surface-raised` background + `--cc-dark-border` border, instead of inheriting Canvas's default border with Layer 0 having wiped the bg to transparent.
- **Why:** The two `:only-child` exclusions were intended to keep genuinely icon-only nav controls transparent (no surface-raised pill). They had a CSS quirk: **`:only-child` only counts element siblings, not text nodes.** A button with `<i class="icon-check-plus">` followed by the text "Show Saved …" makes the `<i>` *the* only child as far as CSS is concerned, because the surrounding text nodes don't count toward sibling math. So every Canvas `.btn` with leading-icon-plus-text — and there are many: "Show Saved What-If Scores", "Calculate Based Only on Graded Assignments", "Edit Page", etc. — was excluded from the gray paint, kept its Canvas border, lost its bg to Layer 0, and rendered as a hollow outline only in dark mode. The hamburger toggle, the InstUI BaseButton/IconButton family, and `.ic-app-course-nav-toggle` are already protected by explicit name/`data-cid` exclusions further up the `:not()` chain — the `:only-child` belt was redundant for them and harmful for everyone else.
- **Underlying pattern (P9):** CSS pseudo-classes that work on element siblings (`:only-child`, `:first-child`, `:nth-child`, `:empty`) are quietly text-node-blind. Using them to detect "this element is the *content* of its parent" — as opposed to "this element is the *only element* in its parent" — produces false positives whenever the parent has interleaved text. For Canvas buttons this is the difference between an icon-only kebab and an icon-prefixed labeled action, and the two should paint very differently. Targeting via element-only sibling pseudo-classes is the wrong tool for that distinction; in CSS, the only reliable way is name-based (`#id`, `.class`, `[data-cid]`).

## 2026-04-28 (4)

### Dark Mode — Module title overlap, DesignPLUS content blocks, defensive sweep
- **Where:** `src/content.css` (dark mode block, new section before the `hr` rule)
- **What — three connected fixes:**
  - **Module-item title fade gradient.** Canvas paints `.ig-title::after` (and similar wrappers on list items / recent-feedback / module items) with a right-edge `linear-gradient(to right, transparent, white)` to fake an ellipsis fade-out for long titles. The white terminus reads as a bright "smear" over the title text in dark mode — this is the "text layers overlapping" symptom on `<span class="name">Exam 1 Materials</span>` and other module rows. Added an override that repaints the gradient to terminate in `var(--cc-dark-page-bg)` instead of white. The truncation effect still works; it just blends. Selectors covered: `.ig-title::after`, `.ig-title-wrapper::after`, `.item_name::after`, `.item-name::after`, `.module-item-title::after`, `.name::after`, `.event-details::after`.
  - **DesignPLUS content containers.** The Layer 0 wildcard `[class*="dp-"]` exemption (added to preserve the UNL red `dp-header` banner) was over-broad — it preserved the tan/light backgrounds DesignPLUS gives to every `dp-content-block`, `dp-callout`, `dp-card`, `dp-quote`, `dp-info-box`, etc., so a course's Grade Scheme panel rendered with a mismatched off-color rectangle on the dark page. Added an explicit dark-mode rule painting those content containers (and UNL-institution `kl_*` custom classes) `background-color: transparent` + `border-color: var(--cc-dark-border)` so they sit flush against `--cc-dark-page-bg`. The `dp-header` banner and other hero/chrome regions are untouched (they don't match these specific content-container class names). Tables inside (`.ic-Table--striped` within `.dp-table-scroll`) now also paint each cell transparent for a consistent flat dark grid.
  - **Defensive sweep:** stripped `text-shadow: none !important` from `.ig-title` / `.name` / `.item_name` / `.module-item-title` / `.ig-row` / `.ig-header` (Canvas occasionally uses a 1px white emboss shadow that becomes a visible ghost in dark mode — another source of "overlapping layers"). Re-pinned `.screenreader-only` positioning (`position: absolute !important; left: -10000em; clip: rect(1px,1px,1px,1px); clip-path: inset(50%)`) so the duplicate SR-text that lives next to `.name` in Canvas's module-item link markup can't ever leak into view, regardless of which extension/theme an institution layers on top.
- **Why — what these three fixes have in common:**
  - **(P5 from 2026-04-28 (2)):** Layer 0's wildcard `[class*="dp-"]` exemption is the structural cause of Issue 2 — it's a "nuke-then-repaint" hole. The fix preserves the wildcard (so dp-header stays red) but adds explicit repaints for the dp-content-* family. Long term, swap the wildcard for an enumerated allowlist of the dp regions that should keep their colors (banner, hero, brand strip).
  - **(New, P7) Canvas's truncation-fade pseudo-elements aren't theme-aware.** Any `::after { background: linear-gradient(…, white) }` in Canvas's CSS is a dark-mode landmine. Other places this pattern appears in Canvas: discussion list items, conversation list items, file list rows, gradebook row labels — audit each as bugs surface.
  - **(New, P8) Screenreader-only duplicate text is a stack of hidden bombs.** Many Canvas links wrap `[hidden SR text] + [visible name]` in the same anchor. Any future rule that touches `position` or `width` on `.ic-app *` would unhide every duplicate. The new pin rule is a defense-in-depth that costs nothing.

## 2026-04-28 (3)

### Compose / InstUI Button — Stop forcing the gray "raised" pill in dark mode
- **Where:** `src/content.css` (gray-button rule + `:hover` / `:focus` siblings, dark mode block)
- **What:** Added `:not([data-cid*="BaseButton"])` to the `:not()` chain on the gray-button paint rule. InstUI's BaseButton family (`data-cid="BaseButton Button"`, `BaseButton IconButton`, `BaseButton CloseButton`, `BaseButton CondensedButton`) is now excluded from the surface-raised paint, so the Inbox **Compose** button — and every other InstUI Button anywhere in main content / right side / breadcrumbs — keeps its natural InstUI styling instead of being repainted with `--cc-dark-surface-raised` and a gray border.
- **Why:** The Compose button is `data-cid="BaseButton Button"` with both an icon and text. None of the existing exclusions caught it: the legacy `.Button--primary` class doesn't exist on InstUI buttons, the `[data-cid*="IconButton"]` exclusion only matches IconButton (not plain Button), and the `:has(>svg:only-child)` exclusion misses because the button has multiple wrappers. So the gray rule paints it `--cc-dark-surface-raised`, which on a primary action button reads as broken. Excluding the entire BaseButton family is the right call — InstUI buttons are managed by Canvas's emotion CSS, and our gray paint was always a guess that worked for some legacy `.Button` elements but actively broke the new InstUI ones.

### Theme — Remove the global "rounded button" feature
- **Where:** `src/content.js` (DEFAULTS, `applySettings`, `CC_CSS_VARS`); `src/content.css` (global `button, .Button, input[type="text"]…` border-radius rule + three `cc-preview-*` references)
- **What:**
  - Deleted `borderRadius: 8` from `DEFAULTS`.
  - Deleted `set('--cc-radius', s.borderRadius + 'px')` from `applySettings`.
  - Removed `'--cc-radius'` from `CC_CSS_VARS` (the tear-down sweep no longer needs to clear it).
  - Removed the global `button, .Button, input[type="text"], input[type="search"], select, textarea { border-radius: var(--cc-radius, 8px) !important }` rule that was forcing 8px on every button / input / select / textarea on every Canvas page.
  - Replaced the three internal `cc-preview-*` references to `var(--cc-radius, 8px)` with the literal `8px` so the modal preview's own button / input shapes stay 8px without depending on a removed variable.
- **Why:** The setting was never exposed in the modal — it was a silent global override that rounded every Canvas pill / button to 8px regardless of Canvas's own design intent. Removing it lets Canvas's native shapes (InstUI primary buttons, condensed pills, segmented controls, etc.) render with the radius InstUI / Canvas chose. The `cardRadius` setting (Course Cards → Corner Radius in the modal) is a different feature and is preserved.

## 2026-04-28 (2)

### Dark Mode — Three reported regressions traced to broader patterns
- **Where:** `src/content.css` (dark mode block — dashboard-header badge rule, gray-button rule, form-input block; new InstUI-facade rule)
- **What:**
  - **Alert icon button rendered as a red rectangle.** The dashboard-header notification rule used `[class*="badge"]` and `[class*="notification"]`, which match InstUI's `Badge` *wrapper* (the parent span around the icon button), not just the count pill inside it. Painting the wrapper red bleeds behind the button. Replaced the broad substring match with BEM-child anchors: `[class*="__badge"]`, `[class*="__count"]`, `[class*="__counter"]` (plus the existing enumerated `.nav-badge` / `.unread-count` / `.ic-unread-badge`), and added `:not(button):not([role="button"]):not(:has(button)):not(:has([role="button"]))` as a safety net so a wrapper that ever slips through still doesn't paint over its child button.
  - **`#courseMenuToggle` hamburger had a gray pill.** Two rules competed: the icon-only rule at line 4587 (`html[data-cc-dark-mode="on"] :is(#dashboard_header_container, …, .ic-app-nav-toggle-and-crumbs) :is(button, a, [role="button"]):has(svg, i[class*="icon-"]…)`, specificity (1,3,2)) intends transparent, but the gray-button rule at line 4573 has `:is(#course_show_secondary, #content, #right-side, #right-side, …)` — `:is()` elevates to ID specificity (1,12,1) and out-ranks the icon rule. Added `:not(#courseMenuToggle):not(.ic-app-course-nav-toggle):not([data-cid*="IconButton"]):not(:has(>i[class*="icon-"]:only-child)):not(:has(>svg:only-child))` to the gray rule (and its `:hover`/`:focus` siblings) so icon-only nav controls and InstUI IconButtons skip the surface-raised paint. Added a belt rule re-asserting transparent + light-icon color on `#courseMenuToggle` / `.ic-app-course-nav-toggle`.
  - **InstUI SimpleSelect (Inbox mailbox picker) rendered as a void.** InstUI's TextInput / TextArea / SimpleSelect / NumberInput / DateInput / TimeInput render their visible "input box" via a wrapping `__facade` span, not the inner `<input>` (which is InstUI-transparent by design). Layer 0 clears the facade's bg-color, the inner `<input>` is decoratively transparent, and our existing form-input rule paints the `<input>` — which doesn't show. Added a rule painting `[class*="textInput__facade"]`, `[class*="textArea__facade"]`, `[class*="select__facade"]`, `[class*="numberInput__facade"]`, `[class*="dateInput__facade"]`, `[class*="timeInput__facade"]`, plus `__layout` / `__inputLayout` chrome, with `--cc-dark-surface` and a subtle white-12% border. Also painted the SimpleSelect arrow icon (`[class*="select__icon"] svg`) with `--cc-dark-icon`.
- **Why:** Each user-reported symptom is an instance of a wider pattern — see `## Underlying patterns identified` below for the list. These three fixes are surgical; the wider remediation is queued for follow-up.
- **Underlying patterns identified:**
  - **(P1) `[class*="x"]` substring matches against InstUI conflate wrappers and children.** InstUI uses BEM-style class names — `Badge` (wrapper) vs `Badge__count` (pill). Substring matching paints both. Anchor selectors on the `__` separator (`[class*="__count"]`) or on the wrapper-only `[class*="-Badge"]` / `[class*="Badge:not(__"…` to avoid bleed.
  - **(P2) `data-cid` is a more stable target than generated `css-…` class names.** Canvas's InstUI components carry `data-cid="ComponentName Modifier"` reliably (e.g. `IconButton`, `SimpleSelect`, `BaseButton`). Use it as the primary selector for component identity, with class-name patterns as fallback.
  - **(P3) The `:is()` ID elevation breaks the icon-button rule.** `:is(#a, #b, .c)` takes the *max* specificity of its arguments — one ID promotes the entire `:is()` to ID-level. Any rule scoped by ID-elevated `:is()` will out-rank class-only rules, even when the latter look more specific. Either lower the gray rule's specificity or escalate icon-button rules with explicit IDs / `html[data-cc-dark-mode="on"] body …`. Long term, CSS Cascade Layers (`@layer cc-dark-blanket / cc-dark-paint / cc-dark-component`) would make ordering explicit and remove the specificity arms race entirely.
  - **(P4) Painting semantic elements when the visible appearance is on a wrapper.** InstUI's `__facade` is one example; others include `__inputContainer`, `__inputAdornment`, Modal `__layout`, custom Toggle / Checkbox sliders. Audit any "input-shaped" element that's actually a span hierarchy.
  - **(P5) Layer 0's "nuke-then-repaint" leaves voids whenever repaint enumeration misses a class.** Every InstUI component family is a candidate hole. The hybrid mitigation: extend Layer 0's exemption list to skip InstUI wrappers that paint themselves correctly *and* add explicit repaint rules for any wrapper Canvas paints with white/light backgrounds.
  - **(P6) The diagnostic only checks for under-paint, not over-paint.** `dark-mode-audit.js` flags light-on-dark-page elements but won't catch a button that has an unexpected red wrapper bg, a textInput facade that's transparent, or a kebab menu mistakenly given a surface-raised pill. Need a reverse-check pass that lists interactive elements with non-transparent / non-expected backgrounds.

## 2026-04-28

### Dark Mode — Declare `color-scheme` so native browser UI follows the theme
- **Where:** `src/content.css` (dark mode block, immediately after the `[data-cc-dark-mode="on"]` token block)
- **What:** Added `html[data-cc-dark-mode="on"] { color-scheme: dark }` and `html[data-cc-dark-mode="off"] { color-scheme: light }`. This is a single declaration with broad effect: the browser now renders native scrollbars, `<select>` popups, date / time / file pickers, `<input type="range">`, autofill highlight, text selection, and caret color in their dark-scheme variants. No layout or color shift on any of our hand-painted selectors — purely fills the gaps where Canvas content uses native widgets.
- **Why:** Dark mode previously left bright-white system widgets visible (most noticeably the page scrollbar when `Minimal Scrollbars` was off, and `<select>` dropdowns on assignment forms / quizzes). Declaring `color-scheme` is the standard mechanism for a user-toggled theme — it tells the user agent the page is dark so the parts the page can't style with CSS adapt automatically. The "off" side is set explicitly so when the extension's toggle says light, Canvas can't inherit the user's OS dark preference and end up half-themed.

### Dark Mode — Stop forcing a flat background on native-rendered `<input>` types
- **Where:** `src/content.css` (form inputs rule near the bottom of the dark mode block)
- **What:** Extended the `:not()` exclusion list on the form-input dark-paint rule to skip `[type="radio"]`, `[type="submit"]`, `[type="reset"]`, `[type="button"]`, `[type="image"]`, and `[type="file"]` in addition to the previous `color`/`range`/`checkbox`. Those types render via the OS / browser theme — applying our `--cc-dark-surface` background flattens radios into plain squares, removes the file-picker's "Choose File" button half, and overrides browser-styled submit buttons.
- **Why:** With the new `color-scheme: dark` declaration above, native input types already render correctly in dark mode without our help. Removing them from the override prevents visual regressions on Canvas pages that use radios (quiz answers, grading rubrics) or file uploads (assignment submissions).

## 2026-04-24 (8)

### List View — Tag polish: smaller pills, wider gap, centered with title row
- **Where:** `src/content.css` (variant-fingerprinted meta block); `src/content.js` (`skinPlannerGroupings()` variant-handling block, innerLayout inline override)
- **What:**
  - **Smaller pills:** applied `zoom: 0.85` to `PlannerItem-styles__badges` so Graded/Feedback pills scale proportionally (border, padding, text). Unlike `transform: scale`, zoom also shrinks the layout box, so flex gap measures correctly afterward.
  - **Wider tag-to-metrics gap:** bumped the meta rail's `gap` from `8px` to `14px` so Graded/Feedback no longer crowd the "8 pts / Due: 11:59 PM" text.
  - **Vertically center tags with the title row:** overrode `innerLayout`'s inline `align-items: flex-start` (set by the blanket row-skinning block earlier in the tick) to `center` for variant-matched rows. For standard cards this centers tags with the title. For with-feedback cards this also centers tags with the title, because `innerLayout` contains only the title+meta row — the feedback note is a sibling of innerLayout, not a child, so centering inside innerLayout means "centered with the top part" and the note is untouched.
- **Why:** User feedback after the prior alignment pass: Graded/Feedback pills felt oversized and crowded 8 pts/Due; tags visually floated off the title line.

## 2026-04-24 (7)

### List View — Card-center alignment applied to with-feedback variant too
- **Where:** `src/content.js` (`skinPlannerGroupings()` variant-handling block)
- **What:** Removed the variant split from 2026-04-24 (6). Both `standard` and `with-feedback` rows now use `align-items: center` inline on the root, with checkbox/icon margins zeroed out. Deleted the runtime title-measurement path since it's no longer needed.
- **Why:** Title-line alignment for with-feedback rows was geometrically correct (checkbox center == title center, verified via diagnostic) but visually read as "too high" next to the standard cards which are card-centered. User preference is consistent card-centering across variants, even though this places the checkbox near the title/note divider on with-feedback cards.

## 2026-04-24 (6)

### List View — Alignment split: card-center for standard, title-center for with-feedback
- **Where:** `src/content.js` (`skinPlannerGroupings()` variant-handling block)
- **What:**
  - **Standard variant:** switched root back to `align-items: center` inline (browser flexbox), and zeroed checkbox/icon margins. Because the card's content is just the title row (no stacked note), card-center == content-center, producing a symmetric look responsive to any future font/padding change for free.
  - **With-feedback variant:** kept the runtime title-measurement path — root at `flex-start`, checkbox/icon margin-top computed from `titleRect.y + titleRect.h/2 - elementHeight/2`. Card-centering would land checkbox in the comment area below the divider, so title-line alignment is semantically correct here.
  - Neither branch uses hardcoded pixel offsets; both respond to viewport resize and font changes on the next `tick()`.
- **Why:** User preference for standard cards to read as symmetrically centered; with-feedback cards must keep checkbox attached to the task line rather than drifting into the note.

## 2026-04-24 (5)

### List View — Checkbox/icon now align to title center, not column center
- **Where:** `src/content.js` (`skinPlannerGroupings()` variant-handling block); `src/content.css` (removed now-obsolete variant align-items/margin rules)
- **What:** The prior pass used `align-items: center` on the root, which geometrically centers checkbox+icon to the details column. Diagnostic showed center=33.5px for both checkbox and column — perfectly centered — but the column contains [type label, title] stacked, so column-center sits between them rather than on the title line. Replaced with per-row measurement:
  - Set root `align-items: flex-start` inline.
  - Measure the title element (last non-STYLE child of the primary/details column) via `getBoundingClientRect()`, compute its vertical center relative to the row's content-box.
  - Apply `margin-top: (titleCenter - element.height / 2)` inline on checkbox and icon so their geometric centers land on the title's vertical center.
  - Works identically for both standard and with-feedback variants since the title sits at the top of the layout column in each.
- **Why:** CSS `align-items: center` cannot target "the title line" because title position depends on font metrics, wrapping, and the presence of the type label — all of which vary. Measure-then-apply is the correct shape for this alignment.

## 2026-04-24 (4)

### List View — Feedback avatar shrink + tighter PFP-to-comment gap
- **Where:** `src/content.css` (variant-fingerprinted block, scoped under `[data-cc-planner-row-variant="with-feedback"] [data-cc-planner-role="note"]`)
- **What:**
  - Overrode Canvas's `PlannerItem-styles__feedbackAvatar` from `40x40` / `margin-right: 24px` to `24x24` / `margin-right: 10px` (plus `flex: 0 0 auto` to keep it from stretching in the flex-row note container).
  - Shrank the inner circular avatar span (`PlannerItem-styles__feedbackAvatar > span`, e.g. `css-*-avatar`) to `24x24` with `font-size: 11px; line-height: 24px` so any initials fallback still renders centered in the smaller circle.
- **Why:** At 40x40 with a 24px right-margin, the PFP read as a distinct visual block detached from the comment text. Shrinking it to match the 12px note typography (~24px circle) and halving the gap produces a single compact note line under the task-row divider.

## 2026-04-24 (3)

### List View — Checkbox/icon centering: move overrides from CSS to JS inline
- **Where:** `src/content.js` (`skinPlannerGroupings()` variant-handling block)
- **What:** The 2026-04-24 (2) CSS-only attempt didn't take effect because the earlier row-skinning code sets `align-items: flex-start` and `margin-top: 4px` on the root/completed/icon as **inline `!important` styles**, and inline `!important` outranks stylesheet `!important` regardless of selector specificity. Moved the variant-specific alignment overrides into the JS so they run after the blanket inline styles, inside the `if (rowVariant) { ... }` branch:
  - **Standard:** `row.align-items = center`, `completed.margin = 0`, `icon.margin-top = 0`.
  - **With-feedback:** `row.align-items = flex-start`, `completed.margin = 12px 0 0`, `icon.margin-top = 12px`.
  - **Unmatched rows:** restored to the stable defaults (`flex-start` + `4px` nudges) in the `else` branch so self-healing still works if the fingerprint stops matching.
- **Why:** Without this, the prior CSS changes were silently overridden and the user reported no visible change.

## 2026-04-24 (2)

### List View — Checkbox + icon vertical centering per variant (CSS attempt, superseded)
- **Where:** `src/content.css` (variant-fingerprinted block, scoped under `[data-cc-planner-row-variant]`)
- **What:** Added CSS rules to center checkbox/icon via `align-items: center` (standard) and `margin-top: 12px` (with-feedback). **(REVERTED in effect — see 2026-04-24 (3).)** CSS rules retained as documentation of intent; actual behavior is driven by inline JS overrides.
- **Why:** Inline `!important` in the JS row-skinning block beats stylesheet `!important`, so CSS alone couldn't reach these properties.

## 2026-04-24

### List View — Meta rail tags/metrics spacing fix
- **Where:** `src/content.css` (List View variant-fingerprinted block, scoped under `[data-cc-planner-row-variant]` `[data-cc-planner-role="meta"]`)
- **What:**
  - Added `gap: 8px` on the meta rail container.
  - Overrode Canvas's `PlannerItem-styles__badges { flex: 1 1 0% }` → `flex: 0 0 auto` so badges shrink-wrap their pills instead of growing to fill the rail.
  - Overrode Canvas's `PlannerItem-styles__metrics { flex: 0 0 160px; padding-left: 6px }` → `flex: 0 0 auto; width: auto; padding-left: 0` so metrics shrink-wrap to the due/points text width.
  - Net effect: Graded/Feedback pills sit flush against the points + due text with a consistent 8px gap, both hugging the right edge via Canvas's existing `justify-content: flex-end` on `PlannerItem-styles__secondary`.
- **Why:** DOM inspection showed Canvas's default metrics block was 160px wide containing ~90px of text, leaving ~70px of unconditional white space between the tags and the due/points text regardless of actual content width.

## 2026-04-23 (6)

### List View — Task row redesign via strict variant fingerprinting
- **Where:** `src/content.js` (`skinPlannerGroupings()` row loop, appended after the type-label simplifier); `src/content.css` (new block immediately after the stable `PlannerItem-styles__title` rule in the List View section)
- **What:**
  - **Variant fingerprinting in JS.** For each task row, inspect direct children of `PlannerItem-styles__layout` and `PlannerItem-styles__innerLayout` (filtering out `<style>` nodes). Only two exact shapes are tagged:
    - **Standard**: `layoutChildren = [innerLayout]`, `innerChildren = [details, secondary]` → row gets `data-cc-planner-row-variant="standard"`, details → `data-cc-planner-role="primary"`, secondary → `data-cc-planner-role="meta"`.
    - **With-feedback**: `layoutChildren = [innerLayout, feedback]`, same innerChildren pair → row gets `data-cc-planner-row-variant="with-feedback"`, feedback → `data-cc-planner-role="note"`, others same as above.
    Rows that don't match have any prior `data-cc-planner-row-variant` / `data-cc-planner-role` attributes cleared so stale decoration self-heals between ticks if Canvas mutates the row.
  - **Scoped CSS redesign.** New rules gated entirely on `[data-cc-planner-row-variant]` + `[data-cc-planner-role="..."]`:
    - `innerLayout` in matched rows: `gap: 12px` for clean column spacing (flex-direction inherited from Canvas default).
    - `[data-cc-planner-role="primary"]`: `flex: 1 1 auto; min-width: 0;` so title/type shrink first.
    - `[data-cc-planner-role="meta"]`: `flex: 0 0 auto; margin-left: auto; text-align: right; font-size: 12px; color: #64748b; margin-top: 0;` — turns secondary into a clean right rail for Graded/Feedback tags, points, and due time.
    - `[data-cc-planner-role="note"]` (with-feedback only): `margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(45,59,69,0.1); font-size: 12px; color: #475569;` — divider-separated secondary content.
  - **No text inspection, no reparenting, no global descendant targeting.** Unmatched rows keep today's stable shell only.
- **Why:** Prior redesign passes tried to infer meta/note layout from generic descendants or text content and kept breaking rows whose DOM didn't match. Strict fingerprint gating guarantees the redesign only applies where structure is verified from live DOM inspection, and self-heals if Canvas mutates the row later.

## 2026-04-23 (5)

### List View — Task Card height stabilization + alignment fix
- **Where:** `src/content.css` (scoped `[class*="Grouping-styles__items"] [class*="PlannerItem-styles__..."]` rules)
- **What:**
  - **Aggressive height collapse.** Added `height: auto !important` and `min-height: 0 !important` to `PlannerItem-styles__root`, `layout`, and `innerLayout`. Set `align-items: flex-start !important` on the root card and layout wrappers.
  - **Removed all auto-margins.** Canvas uses `margin-top: auto` on metrics to push them to the bottom of tall columns; neutralized this on all children of `.secondary`.
  - **Fixed grouping borders.** Added `border-top: none !important` and `border: none !important` to `Grouping-styles__root` to kill the colored top line seen in the screenshot.
  - **Refined toggle position.** Moved the "Show completed" toggle to align exactly with the checkbox column (`margin-left: -2px`) and added a hover state + larger arrow glyph.
- **Why:** The previous update left cards with a ~150px empty vertical gap because Canvas's `flex: 1` and `margin-top: auto` rules were still active. Top-aligning everything ensures a compact, predictable card shape regardless of content (like feedback or badges).

## 2026-04-23 (4)

### List View — Daily Class Card border cleanup, Task Card grid layout, toggle alignment
- **Where:** `src/content.css` (`[class*="Grouping-styles__..."]` and scoped `[class*="Grouping-styles__items"] [class*="PlannerItem-styles__..."]` rules)
- **What:**
  - **Removed all colored/gray border lines.** `Grouping-styles__root` gets `border: none !important` (removes Canvas's course-color top border that spans the full card). `Grouping-styles__items` gets `border-top: none !important` (removes the thin colored divider between the hero sidebar and the items tray). Task card borders (`border-top/right/bottom`) removed; shadow (`0 1px 4px rgba(0,0,0,0.09)`) alone defines the card edge.
  - **Task card layout: two-column grid.** `PlannerItem-styles__innerLayout` now uses `grid-template-columns: 1fr auto`. Left column: type label (muted 10px) + title (bold 13.5px). Right column: due + score side-by-side (top), then badges below — all right-aligned. Rationale: F-pattern reading — title and due are the first-shelf scan; badges are confirmation. Matches Todoist/Linear/Notion task card convention.
  - **"Show/Hide N completed items" button left-aligned.** `ToggleDetails` wrapper set to `text-align: left`. Button set to `display: inline-flex; padding: 4px 0 4px 2px; width: auto` so the `>` arrow sits flush under the task checkboxes. Arrow (`toggleDetails__icon`) rotates 90° via CSS transition when `aria-expanded="true"`, signaling the section can be collapsed.
- **Why:** Screenshot showed colored top borders on every Daily Class Card, no-border task cards whose hard `#e9eaec` edges looked like extra dividers, a centered toggle button misaligned with the checkbox column, and a secondary row where badges/score/due were in a flat left-right layout with no clear grouping.

## 2026-04-23 (2)

### List View — Daily Class Cards + Task Card redesign
- **Where:** `src/content.css` (new `[class*="Grouping-styles__..."]` and scoped `[class*="Grouping-styles__items"] [class*="PlannerItem-styles__..."]` rules, inserted before the Recent Activity section)
- **What:**
  - **Course name truncation.** `.Grouping-styles__title` (course name in the colored hero sidebar) now renders as a single line with `text-overflow: ellipsis`. Canvas's default gradient-fade `::after` overlay is removed.
  - **Daily Class Card rounding.** `.Grouping-styles__root` gets `overflow: hidden; border-radius: 8px` so the colored hero sidebar clips cleanly at the card corners.
  - **Gray items tray.** `.Grouping-styles__items` gets `background: #f2f3f5; padding: 8px; display: flex; flex-direction: column; gap: 6px` so Task Cards visually float above a subtle gray surface with even spacing.
  - **Task Cards: white, rounded, inset.** Scoped override on `[class*="Grouping-styles__items"] [class*="PlannerItem-styles__root"]`: `background: #fff; border-radius: 10px; padding: 10px 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.07); neutral border on top/right/bottom` (left border retains the course color stripe).
  - **Information hierarchy.** Type/course label → 10px muted gray uppercase, max 28ch with ellipsis. Task title → 13.5px bold `#1a1f2b`. Secondary row → badges left / metrics right via `justify-content: space-between`. Score + due → 11px compact row. Badge pills → 10px. Feedback → separated by a 1px `#f0f0f0` rule, 11px italic muted text.
- **Why:** The Canvas Planner groups items by course within each day (`.Grouping-styles__root`). These needed a clear "card-within-card" hierarchy: a colored course header card containing white, rounded task items with legible, structured metadata.

## 2026-04-23

### List View — Grouped refinement: subtle gray group surface, white task tiles, stronger preview parity
- **Where:** `src/content.js` (`previewListView` grouped branch mock data + grouped renderer); `src/content.css` (`[data-cc-planner-layout="grouped"] ...`, `.cc-preview-listview[data-layout="grouped"] ...`, dark-mode grouped overrides)
- **What:**
  - **Preview rebuilt around the actual requested hierarchy.** Group cards now render as a soft gray outer surface with white rounded assignment tiles inside instead of flat divider rows. The preview's grouped branch now carries a right-hand metadata rail for tags, points, and due time so pills stop drifting visually.
  - **Long-label preview data added.** Mock data now includes a long Honors course label (`HNRS: SOFTWARE DEVEL RAIK184H SEC 150 SPRING 2026`) plus an Accounting item with `Graded` / `Feedback` and `8 pts`, so the preview visibly exercises ellipsis and metadata placement.
  - **Preview completed-items affordance normalized.** Added a same-height `Show N completed items` row in grouped preview, styled like the task tiles instead of a smaller footer/control row.
  - **Live grouped cards now match that direction more closely.** Day groups use `background: var(--cc-planner-item-bg, #f5f7fa)`, `border-radius: 14px`, and tighter inset padding. Individual planner items are back to white rounded tiles with neutral borders, `min-height: 72px`, and `8px` inter-card spacing.
  - **Metadata rail tightened.** Grouped-mode `[class*="PlannerItem-styles__details"|"metrics"|"secondary"]` now stacks and right-aligns metadata with a fixed minimum width, while status/badge pills align to the far right consistently instead of wandering inside a loose wrap row.
  - **Completed-items row made card-shaped.** Grouped-mode `CompletedItemsFacade` / `CompletedItems-styles` / matching button selectors now use the same `72px` minimum height, white background, border, radius, and top spacing as the task tiles so "Show N completed items" no longer collapses into a shorter odd-shaped control.
- **Dark mode grouped overrides added.** Group surface falls back to a translucent dark page tint and inner task/completed rows use `var(--cc-dark-surface-raised)` with `var(--cc-dark-border)` so the new light-mode card structure does not break dark mode.
- **Why:** The previous grouped pass was technically cleaner than the first attempt, but it still didn't satisfy the actual UI goal visible in the screenshot: stronger separation between the day/course container and each assignment, predictable placement for `Graded` / `Feedback` / points / due time, and a completed-items row that occupies the same visual rhythm as a task. This pass shifts from "flatten everything" to "use very restrained task cards inside a calmer group surface," which better matches the extension's existing widget vocabulary and the user's stated preference.

## 2026-04-22

### List View — Grouped: match extension's card style + clamp long labels + normalize "Show N completed" row + consistent tag placement
- **Where:** `src/content.css` (`.cc-preview-lv-group`, `[data-cc-planner-layout="grouped"] [class*="Day-styles..."|"PlannerItem-styles..."|"CompletedItemsFacade"|"CompletedItems-styles"]`)
- **What:**
  - **Card style matches the rest of the extension.** Outer grouped cards used `box-shadow: 0 1px 3px + 0 1px 2px` with no border — inconsistent with `#cc-weekly-tasks .cc-widget` / `.cc-section-card`, which both use `border: 1px solid #e8eaec; border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.04)`. Both the preview card (`.cc-preview-lv-group`) and the Canvas-side day card now use those exact tokens.
  - **Long title / type label truncation.** Canvas course+type labels like `"HNRS: SOFTWARE DEVEL RAIK184H SEC 150 Spring 2026 ASSIGNMENT"` were wrapping to multiple lines and breaking row-height rhythm. Added `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%` to `[class*="PlannerItem-styles__type"]` and `[class*="PlannerItem-styles__title"]` in grouped + compact modes. Type label additionally capped at `max-width: 60ch` in grouped mode. Ancestor `min-width: 0` set on item root + its direct children so flex children are actually allowed to shrink below content size (required for ellipsis to work in a flex row).
  - **"Show N completed items" row matches item rows.** Canvas renders a `CompletedItemsFacade` affordance below completed items; it was landing inside the day card with different padding / background / border-radius than the list rows above it, creating a visual bump. Now forced to `background: transparent; box-shadow: none; border-top: 1px solid rgba(15,23,42,0.06); border-radius: 0; padding: 12px 8px; text-align: left; font-size: 13px` — same vertical rhythm as a list row. Defensive selectors cover `CompletedItemsFacade`, `CompletedItems-styles`, and `button[class*="complete"][class*="Facade"]`.
  - **Consistent tag placement in the meta row.** Canvas's detail row (points / Graded / Feedback / Missing / due time) varies in layout across item types, putting status chips at different x-positions. Now forced to `display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px` on `[class*="PlannerItem-styles__details"|"metrics"|"secondary"]`, plus `margin-left: auto` on `[class*="PlannerItem-styles__status"|"badge"|"statusPill"]` so Graded/Feedback/Missing pills always flush right regardless of what's to their left.
- **Why:** User feedback after seeing grouped layout against real Canvas data: (1) outer card's shadow didn't match the extension's existing widgets, (2) long course codes wrapped and broke row heights, (3) "Show 2 completed items" button sat at a different height than the list rows, (4) tag placement (Graded, Feedback, points, due time) drifted across items in the same card. All four issues traced to visual consistency — fixed with one token-matched card style, aggressive ellipsis on overflowing labels, unified row styling for the completed-items affordance, and flex-normalized meta row with status pills pinned right.

### List View — Grouped layout: drop inner cards, use hairline-divided list rows (research-driven rework)
- **Where:** `src/content.css` (`.cc-preview-lv-group*`, `.cc-preview-lv-mini*`, `[data-cc-planner-layout="grouped"] [class*="Day-styles..."|"PlannerItem-styles..."]`)
- **What:**
  - **Removed the "mini-card" visual treatment from inner rows.** The previous design used `background: #f6f8fa; border-radius: 8px; padding: 10px 12px` on each inner assignment — effectively nesting cards inside a card. Replaced with flat list rows: `background: transparent; border-radius: 0; border-bottom: 1px solid rgba(15,23,42,0.06)` with `padding: 12px 0`. Last row drops the divider.
  - **Applied the same flattening to the Canvas side.** `[data-cc-planner-layout="grouped"] [class*="PlannerItem-styles__root"]` now renders as transparent list rows with a hairline bottom divider instead of tinted mini-cards. Course-color left stripe retained since Canvas-side day-cards mix courses.
  - **Bumped title size to 14px** (up from 12.5px). Meta row to 12px (up from 10.5px). These are the NN/G readability thresholds — "if you need <14px, the card has too much."
  - **Sizes aligned to strict 8pt grid.** Outer card padding is now `16px`; header gap `12px`; row padding `12px 0`; header→body gap `8px + 12px divider`; card-to-card gap `16px`. No more stray 10/11/13 values.
  - **One shadow instead of shadow+ring.** Outer card was `0 1px 2px + 0 0 0 1px` (soft shadow + crisp outline ring, effectively a double boundary). Now `0 1px 3px + 0 1px 2px` — a single layered drop shadow.
  - **Course name typography.** Bumped to 15px / 700 with `letter-spacing: -0.1px` and `line-height: 1.3` for the condensed-but-readable feel Linear uses on its issue group headers.
  - **Count pill.** 11px / 600 on `rgba(15,23,42,0.05)` with `border-radius: 999px` and `padding: 3px 8px`.
  - **Checkbox: square → circular.** 18px circle with 1.5px `#cbd5e1` border; fills with `var(--cc-accent)` when done. Matches the convention in Things / Apple Reminders / Todoist for list-style tasks (square checkboxes read as "form input", circular reads as "tappable task").
  - **Meta row** now renders as `icon · day · time     STATUS` on a single line with the status chip flushed right via `margin-left: auto`. Icon sized to 12×12 SVG, colored `var(--cc-group-color)` at 0.9 opacity.
  - **Group header accent** pinned to a fixed 3px bar (decoupled from `--cc-planner-bar-width` since that slider would have made a 12px-wide header bar look heavy). Bar-width slider now only drives the per-item left stripe in other layouts, which is the sensible scope.
- **Why:** Previous design nested cards inside a card for a simple list of homogeneous items — assignments within a course. NN/G's canonical card-design article is explicit: *"Don't apply cards as a modern replacement for simple lists of similar items. Reserve them for situations where content variety justifies their larger footprint."* Linear, Things, Todoist, and Apple Reminders all implement the same pattern: one outer container for the group, flat rows inside. This rework follows suit — the course group remains a card (genuinely one "concept"), but the assignments within are a scannable list. Secondary research principles applied: 14px title floor for readable task text, 8pt grid for consistent spacing rhythm, one boundary (single shadow) instead of overlapping shadow/border layers.

### List View — Grouped layout aesthetic rework (cleaner, calmer, easier to scan)
- **Where:** `src/content.js` (`previewListView` grouped branch); `src/content.css` (`.cc-preview-lv-group*`, `.cc-preview-lv-mini*`, `[data-cc-planner-layout="grouped"] [class*="Day-styles..."|"PlannerItem-styles..."]`)
- **What:**
  - **Single-accent header.** Removed the redundant colored dot and the course-colored name text. The group header now shows one slim vertical accent bar (width = `var(--cc-planner-bar-width)` so the existing slider drives it), followed by the course name in the default text color, and a subtle gray count pill. One use of color instead of three.
  - **Title-cased class names.** `"INTRO TO PSYCH"` renders as `"Intro to Psych"` via a small in-file title-case helper that keeps words like `to`/`of`/`and` lowercase. No more shouty caps in the header.
  - **Vertical stack, not a grid.** Replaced `grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))` with `display: flex; flex-direction: column; gap: 6px`. Mini-cards are now full-width rows — titles render on a single line without ellipsis-clamp, meta stays readable.
  - **Flat mini-cards with checkbox on the left.** Each mini-card is `10px × 12px` padding, `#f6f8fa` background, `8px` radius. Layout: square checkbox on the left → body column with title on top and a single soft meta line below (`icon • day · time`). Status chip like `MISSING` pushed to the far right via `margin-left: auto`.
  - **Removed dashed divider under the group header.** Replaced with pure whitespace (`10px` margin-bottom on the header).
  - **One shadow, no border.** Outer card uses `0 1px 2px rgba(16,24,40,0.04), 0 0 0 1px rgba(16,24,40,0.05)` (soft shadow + crisp 1px shadow-ring) instead of `1px solid border + shadow + colored left border`. Canvas-side rules updated to match.
  - **Canvas-side mini-card cleanup.** `[data-cc-planner-layout="grouped"] [class*="PlannerItem-styles__root"]` now zeros `border-top/right/bottom` but preserves the course-color `border-left` (since Canvas groups by day, items in the same card can be from different classes and still need their color identity). Background softened to `#f6f8fa`, radius `8px`, padding `10px 12px`.
  - **Day-pretty in meta.** Meta line normalizes `"TODAY"` → `"Today"` and `"YESTERDAY"` → `"Yesterday"` for quieter scanning.
- **Why:** Previous grouped design read as busy — three uses of course color competing in the header, cramped grid of mini-cards clamping titles to 2 lines with ellipses, dashed divider adding visual weight, border+shadow doubling up. Drew from Linear / Things / Todoist / Apple Reminders conventions: restrained single-accent group header, vertical stack, calm single meta line, soft shadow only.

### List View — add "Grouped" layout (card of cards, one per class)
- **Where:** `src/content.js` (`applySettings` layout-validator, `tabListView` select options, `previewListView` rendering + mock data); `src/content.css` (`.cc-preview-lv-group*`, `.cc-preview-lv-mini*`, `[data-cc-planner-layout="grouped"] [class*="Day-styles__root"|"PlannerItem-styles__root"]`)
- **What:**
  - New `grouped` value added to the `plannerLayout` select (fourth option after Cards / Rows / Compact).
  - **Preview**: when `grouped` is selected, the mock items are regrouped by course (not day). Each course becomes an outer card with a colored left accent, a uppercase course name header, and an item count pill. Inside, assignments render as a grid of mini-cards (`grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))`) showing the type icon, the originating day label, the title (clamped to 2 lines), and a footer with status + due time. This is where the full "card containing smaller cards" concept is shown.
  - **Canvas side**: `[class*="Day-styles__root"]` / `[class*="Day-styles__day"]` receive outer-card styling (white bg, 1px soft border, shadow, rounded, `padding: 10px 12px`, margin-bottom from `--cc-planner-item-spacing`). `[class*="PlannerItem-styles__root"]` inside become mini-cards (`rgba(0,0,0,0.025)` tint, smaller radius, tighter padding, no shadow, no extra borders). In Canvas the outer card represents a day (not a class) because Canvas's Planner DOM groups items by day — note is included in the Style dropdown description.
  - **Mock data**: added two items to the TODAY day so grouping shows multiple assignments per course (Intro to Psych: Paper #2 + Chapter 3 reading; American History: Position Paper + Reading response).
  - **Compound specificity override extended**: `[data-cc-planner-item-bg="on"][data-cc-planner-layout="grouped"] [class*="Day-styles..."]` paints the outer day card with the user's chosen item background; mini-cards keep their translucent tint to preserve nested-card contrast.
- **Why:** User wanted a nested-card aesthetic — "one whole card next to the class, with smaller cards representing the assignments." The preview demonstrates the full class-grouped vision (since we control that DOM); the Canvas implementation applies the same aesthetic to Canvas's native day-grouped Planner DOM without fragile JS rebuilding.

### List View — major revamp: add layout selector, completion styles, section hiding, reactive preview
- **Where:** `src/content.js` (`DEFAULTS`, `CC_DATA_ATTRS`, `applySettings`, `tabListView`, `previewListView`, `PREVIEW_REACTIVE_KEYS`); `src/content.css` (List View block, preview block)
- **What:**
  - **Five new settings** on the List tab: `plannerLayout` (`cards`|`rows`|`compact`), `plannerDoneStyle` (`fade`|`strikethrough`|`hide`), `plannerEmphasizeToday`, `plannerHideEmptyDays`, `plannerHideActivity`. Persisted via `chrome.storage.sync`; projected onto `<html>` as `data-cc-planner-layout`, `data-cc-planner-done-style`, `data-cc-planner-emphasize-today`, `data-cc-planner-hide-empty-days`, `data-cc-planner-hide-activity` in `applySettings()` and torn down via `CC_DATA_ATTRS`.
  - **Tab reorganized** into five groups: Layout → Day Headers → Item Style → Completed Items → Recent Activity (was: Item Style → Day Headers → Completed Items → Recent Activity with no behavioral controls).
  - **CSS for Rows layout** on `[class*="PlannerItem-styles__root"]`: transparent bg, no shadow, no top/right borders, 1px bottom divider, `border-radius: 0`, tightened vertical padding. Course-color left bar preserved via the existing `border-left-width` rule.
  - **CSS for Compact layout**: same flat treatment as Rows plus `padding: 4px 8px`, `min-height: 0`, and `display: none` on `[class*="PlannerItem-styles__type"]` / `[class*="PlannerItem-styles__secondary"]` to collapse rows toward a single visual line.
  - **CSS for completion styles**: original opacity-fade rule now gated behind `[data-cc-planner-done-style="fade"]`. `strikethrough` variant sets `opacity: 1` + `text-decoration: line-through` on completed items. `hide` variant sets `display: none`.
  - **CSS for Emphasize Today**: boosts `font-size: 1.15em`, `font-weight: 800`, and `color: var(--cc-accent)` on the first child of `[class*="Day-styles__root"][aria-label^="Today"]` (and `Day-styles__day` / `.Day` variants).
  - **CSS for Hide Empty Days**: uses `:not(:has([class*="PlannerItem-styles__root"]))` on all three Day-container variants to skip day headers with zero items.
  - **CSS for Hide Activity Feed**: `display: none` on `#dashboard-activity`, `.ic-Dashboard-Activity`, `.recent_activity`.
  - **Compound specificity override**: `[data-cc-planner-item-bg="on"][data-cc-planner-layout="rows"|"compact"]` restores the user's custom item background when both a flat layout and a background color are set (same-specificity conflict with the layout rules).
  - **Preview rewritten** to be fully reactive: renders differently for each `plannerLayout`, drops the type-label row in compact mode, applies line-through per row in strikethrough mode, filters out completed items in hide mode, promotes the "TODAY" header with accent color when `plannerEmphasizeToday` is on, and omits the Recent Activity block when `plannerHideActivity` is on. Added `.cc-preview-lv-row--strike`, `.cc-preview-lv-title--compact`, `.cc-preview-lv-due--compact`, `.cc-preview-lv-day-hdr--today` CSS classes.
  - **`PREVIEW_REACTIVE_KEYS`** now includes `plannerLayout`, `plannerDoneStyle`, `plannerEmphasizeToday`, `plannerHideActivity` so the in-modal preview re-renders when any of those change.
- **Why:** The List tab was the weakest in the extension — seven cosmetic color/size knobs and zero behavior controls. Students face real density problems (too few items visible, empty-day clutter, "Today" visually identical to every other day, Recent Activity often unwanted) that color pickers can't solve. Layout is the single highest-impact choice and now drives the dominant look. Preview was static; now it actually shows your selections.

### Sidebar widgets — typography + breathing-room pass to match BetterCanvas vibe
- **Where:** `src/content.css`
  - To Do: `#cc-weekly-tasks .cc-section-card`, `.cc-section-label`, `.cc-section-count`, `.cc-section-list`, `.cc-task-link`, `.cc-task-title`, `.cc-task-meta`
  - Feedback: `#cc-recent-feedback .cc-feedback-count`, `.cc-feedback-list`, `.cc-feedback-item`, `.cc-feedback-item-title`, `.cc-feedback-item-detail`, `.cc-feedback-empty`
- **What:**
  - To Do: task titles `12.5px → 13px` (line-height `1.3 → 1.35`, title margin-bottom `2px → 3px`); meta row `11px → 12px` (gap `3px → 4px`); section count pills `9px → 11px` with height `18 → 20px` and padding `0 6 → 0 7`; section label `13 → 13.5px`; section-list gap `5 → 8px`; section-card padding `4×10 → 6×12`; task-link padding `8×8 → 10×10`.
  - Feedback (kept in sync as a typographic pair): count pill `9 → 11px` / height `18 → 20px` / padding `0 6 → 0 7`; list gap `8 → 10px`; item padding `10×11 → 12×12`; item title `13 → 13.5px`; detail `11 → 12px`; empty-state `13 → 13.5px`.
- **Why:** BetterCanvas's to-do items use 14px bold titles on 12px base text with ~14px between rows — their "calmer" feel came from larger text, not from less padding. Our widgets were 12.5/11/9px which read as cramped. This pass bumps every text tier ~0.5–1px and adds a bit of vertical breathing room while keeping the pastel-card architecture that differentiates us from BetterCanvas's flat rows.

## 2026-04-21

### Course grades page — keep Tasks under grade summary and mask table bleed-through in the secondary column
- **Where:** `src/content.js` (`ensureGradesWidgetHost()`); `src/content.css` (`html[data-cc-page="course-grades"] #right-side-wrapper`, `.ic-app-main-content__secondary`, `#cc-grades-widget-host`)
- **What:**
  - `ensureGradesWidgetHost()` now mounts `#cc-grades-widget-host` back inside `#right-side-wrapper`, directly after `#right-side`, so grade information stays above Tasks in the right column.
  - On the grades page, both `#right-side-wrapper` and `.ic-app-main-content__secondary` now get an explicit white background. `#cc-grades-widget-host` also gets its own white background, `padding-top`, and a top border to separate it from the grade summary block.
  - The host no longer uses the earlier left-content / margin-right hack; the widget returns to the 240px right-column width (`max-width: 240px`) that matches Canvas's `#right-side`.
- **Why:** Live layout diagnostics showed the real issue was table bleed-through, not host placement: `#grade-summary-content` was only `536px` wide while `#grades_summary` rendered at `916px`, so the grades table and row dividers were painting underneath the entire secondary column. The right-column host therefore needs an opaque background to mask the overflowing table.

### Course grades page — reserve sidebar gutter so table no longer collides with Tasks widget (REVERTED)
- **Where:** `src/content.js` (new `applyPageType()`, called from `tick()`); `src/content.css` (new `html[data-cc-page="course-grades"]` rules targeting `#content`, `.ic-Layout-contentMain`, `#not_right_side`, `#grades_summary_wrapper`, `#grades_summary`)
- **What:**
  - `applyPageType()` detects the `/courses/:id/grades` URL (regex `^/courses/\d+/grades\b`) and sets `document.documentElement.dataset.ccPage = 'course-grades'`; cleared on other pages. Called from `tick()` alongside `applyDashboardView()`.
  - CSS scoped to `html[data-cc-page="course-grades"]` adds `padding-right: 300px; box-sizing: border-box` on `#content`, `#main .ic-Layout-contentMain`, and `#not_right_side` to reserve space for the floated `#right-side` sidebar. `#grades_summary_wrapper` / `#grades_summary` / `#student-grades-table` get `max-width: 100%` so they wrap inside the narrower column; `#grades_summary_wrapper` gets `overflow-x: auto` as a fallback.
- **Why:** Diagnostic confirmed Canvas's grades-page main content doesn't reserve sidebar width — the `#grades_summary` table was extending under `#right-side` (measured 240×448 px overlap with our widget at x=932–1172), so the Tasks widget visually covered table cells. Constraining the main content leaves the sidebar column clear.

### Course grades page — revert padding-right approach
- **Where:** `src/content.css` (removed the `html[data-cc-page="course-grades"]` CSS block)
- **What:** Removed the `padding-right: 300px` override on `#content` / `.ic-Layout-contentMain` / `#not_right_side` and the `max-width` / `overflow-x` overrides on the grades table wrappers. `applyPageType()` in `content.js` and its `tick()` call remain (they still set `data-cc-page` on `<html>`), but no CSS currently reads that attribute — the page is back to Canvas's default grades layout.
- **Why:** The padding override broke the grades page layout more severely than the original overlap. Need a different approach — likely one that doesn't mutate Canvas's own content width.

### Tasks widget — stable ordering and visual separation on grades page
- **Where:** `src/content.js` (`injectWidget`); `src/content.css` (`#cc-weekly-tasks`)
- **What:**
  - **Stable ordering:** Canvas's React re-renders `#student-grades-right-content` after our widget is injected, which was flipping the order back (tasks above grades). `injectWidget()` now detects `#student-grades-right-content` on every tick and re-anchors the widget after it if Canvas moved it. Initial injection also inserts via `gradesContent.after()` rather than a plain `append`.
  - **Visual separation:** Added `margin-top: 20px` to `#cc-weekly-tasks` so the Tasks widget has clear breathing room from the grade info above it (previously only ~6px gap).

### Tasks widget — sections collapsed by default
- **Where:** `src/content.js` (`defaultWidgetSectionState`, `widgetSections`, `widgetSectionsByCourse`, toggle click handler)
- **What:** All section buckets (Overdue, Due Soon, Due This Week, All, and per-course sections) now start collapsed. Previously Overdue, Due Soon, and Due This Week were open by default. Changed all `?? true` open-state fallbacks to `?? false` and set the explicit defaults in `defaultWidgetSectionState` to `false`.

---

## 2026-04-16

### Tasks widget — hide empty priority buckets, fix ring/circle center text, refresh default color
- **Where:** `src/content.js` (`DEFAULTS.widgetProgressColor`, `circleProgressMarkup`, `progressMarkup`, `renderWidget`, preview bar/ring rendering); `src/content.css` (`.cc-progress-rings-center`, `.cc-fraction--ring`, `.cc-progress-circle-center`, `.cc-fraction--circle`, `.cc-progress-bar`, `.cc-progress-seg.done`, `.cc-preview-widget-fill`, `.cc-sk-bar`, new `.cc-all-empty`)
- **What:**
  - **Empty sections**: `renderWidget()` now filters out priority sections (Overdue / Due Soon / This Week / All) that have zero tasks, so the empty placeholder that used to sit below each heading is gone — it was reading as a lingering skeleton bar. Course grouping still shows every course card. If every bucket is empty, a single `.cc-all-empty` ("No tasks due this week.") message is shown instead.
  - **Ring + circle center text**: Swapped `justify-content: flex-start` + `padding-top: 21px` on `.cc-progress-rings-center` for `justify-content: center` with a `translate(-50%, calc(-50% + 4px))` optical nudge. `.cc-progress-circle-center` gets the same treatment (`+3px`). Fraction line-height tightened (`.cc-fraction--ring` font bumped 7→9px with `margin-top: -1px`; `.cc-fraction--circle` `margin-top` 2→0 and `line-height: 1`) so the two lines sit closer together and read as centered inside the ring.
  - **Default progress color**: `widgetProgressColor` default and every `|| '#8eaec4'` fallback changed to `#6366f1` (indigo-500). Skeleton shimmer bars repainted from neutral gray (`#eef1f3`/`#f6f8fa`) to indigo-tinted (`#e5e7fb`/`#f0f1ff`) to match. Static `background: #8eaec4` CSS (bar fill, segments "done" state, settings preview) follows.
- **Why:** Reported issues: empty priority sections showed placeholder bars that looked like skeletons; the % and fraction text in the ring/circle floated too high and felt loose; the stock grayish-blue loader color looked flat.

---

## 2026-04-15

### Widget — animated arc progress + skeleton loader
- **Where:** `src/content.js` (`activityRingsSvg`, `circleProgressMarkup`, `injectWidget`); `src/content.css` (new `.cc-progress-arc`, `@keyframes cc-arc-fill`, `.cc-skeleton-loader`, `.cc-sk-bar`)
- **What:**
  - **SVG arc animation**: Both the circle progress and activity rings progress arcs now animate in via `stroke-dashoffset` (`@keyframes cc-arc-fill`, 0.85 s ease-out). Each arc element gets CSS custom props `--arc-c` (circumference) and `--arc-offset` (target dashoffset), starts at full circumference (invisible), and CSS drives it to the target. Activity rings use staggered `animation-delay` (0, 120 ms, 240 ms per ring).
  - **Skeleton loader**: `injectWidget()` no longer injects `<div class="cc-loading">Loading tasks…</div>`. Instead it renders `.cc-skeleton-loader` with three shimmer bars (85 %, 60 %, 40 % wide), driven by `@keyframes cc-shimmer` with per-bar `animation-delay` offsets.

### General settings — Button roundedness slider (REVERTED)
- **Where:** `src/content.js` (`tabGeneral`); `src/content.css` (already wired via `--cc-radius`)
- **What:** New "Buttons" group in the General tab with a `rangeControl('borderRadius', 0, 20, 1, 'px')` row. The `borderRadius` default of 8 px and the `--cc-radius` wiring in `applySettings()` were already in place; this change exposes the control in the UI.
- **Why:** Canvas defaults to sharp edges; the extension's 8 px default is slightly rounded. Slider lets the user tune from sharp (0) to pill-shaped (20).

### General settings — remove Button Roundedness UI
- **Where:** `src/content.js` (`tabGeneral`)
- **What:** Removed the "Buttons" group from the General tab. The underlying `borderRadius` setting, `applySettings()` wiring (`--cc-radius`), and CSS rule on `button, .Button, input, select, textarea` remain — they are used by other parts of the extension — but the control is no longer exposed in the UI.

### General settings — Minimal Scroll Bars
- **Where:** `src/content.js` (`DEFAULTS`, `CC_DATA_ATTRS`, `applySettings`, `tabGeneral`); `src/content.css` (`[data-cc-minimal-scrollbars="on"]`)
- **What:** New `minimalScrollbars: true` default. `applySettings()` sets `data-cc-minimal-scrollbars` on `<html>`. CSS block targets `*::-webkit-scrollbar` (16 px, transparent), `*::-webkit-scrollbar-track/-track-piece/-corner` (transparent, no border), `*::-webkit-scrollbar-thumb` (rounded solid `#4b5563` darker gray with `min-height: 24px`, hover `#374151`), `*::-webkit-scrollbar-button:start/:end` (hidden, 0×0), and Firefox `scrollbar-width: auto` + `scrollbar-color: #4b5563 transparent`. Every declaration uses `!important` and the selectors also include `html`, `body`, and the bare `[data-cc-minimal-scrollbars="on"]` root (not just descendants) so Canvas's own high-specificity scrollbar styles are fully overridden. Thumb uses solid gray (not alpha) so it renders the same darker-gray color in both light and dark mode. Toggle added to the "Scroll Bars" group in General settings above the existing "Hide Scroll Bars" row. On by default.

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
