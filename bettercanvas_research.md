# BetterCanvas (a.k.a. "Better Canvas" / now "BetterCampus") — Technical Research

A deep dive into how the BetterCanvas Chrome / Firefox extension actually modifies Instructure Canvas LMS pages. Source for almost everything below is the **open-source GitHub repo**, which is the literal shipping code (not a clone):

- GitHub: https://github.com/UseBetterCanvas/bettercanvas (also reachable as `ksucpea/bettercanvas`)
- Chrome Web Store ID: `cndibmoanboadcifjkjbdpjgfedanolh` — https://chromewebstore.google.com/detail/bettercanvas/cndibmoanboadcifjkjbdpjgfedanolh
- Firefox add-on: https://addons.mozilla.org/addon/better-canvas/
- Marketing site: https://www.better-canvas.com/
- Author: `ksucpea` (email `ksucpea@gmail.com`); the project has been rebranded "BetterCampus" but the codebase still says "Better Canvas". 100k+ users per the listing.
- License: in the repo (GPL-style large LICENSE file).

The repo at the time of this research is at version **5.12.6** of the manifest. All file references below are from `main`.

---

## 1. The Extension at a Glance

```
bettercanvas/
├── manifest.json          # 793 bytes — see full contents below
├── _locales/...           # Crowdin-managed i18n (en, de, es, fr, it, ja, pt_PT, ru, sv, zh_CN, zh_TW)
├── icon/                  # PNGs
├── css/
│   ├── content.css        # ~14 KB — styles injected into Canvas pages
│   ├── popup.css          # ~15 KB — styles for the toolbar popup
│   └── options.css        # ~1.6 KB — styles for the full options page
├── html/
│   ├── popup.html         # ~66 KB — the entire settings UI
│   └── options.html       # ~3 KB — wrapper that loads popup.html-style content
└── js/
    ├── background.js      # ~5 KB — MV3 service worker, defaults + uninstall URL
    ├── content.js         # ~152 KB / ~2,200 LOC — does ALL the page modification
    └── popup.js           # ~686 KB — the entire popup UI logic (huge — appears to bundle theme browser, color pickers, etc.)
```

Crucially: **there is no build step in the published repo**. No webpack, no vite, no `package.json`, no `dist/`. The files are plain ES2018-ish JavaScript and are loaded into the browser as-is. The user is told to load it via "Load unpacked" in Chrome.

The single big `popup.js` (686 KB) is the only thing that hints at any prior bundling — it likely contains hand-rolled inline modules for theme browsing, color palette serialization, the theme browser network calls (to `diditupe.dev`), etc. There's no React/Vue/etc. visible in `content.js`.

---

## 2. `manifest.json` — The Whole Thing

```json
{
  "manifest_version": 3,
  "name": "Better Canvas",
  "description": "Feature packed extension for Canvas.",
  "version": "5.12.6",
  "icons": {
    "16": "icon/icon-16.png",
    "32": "icon/icon-32.png",
    "48": "icon/icon-48.png",
    "128": "icon/icon-128.png"
  },
  "action": {
    "default_icon": { "19": "icon/icon-19.png", "38": "icon/icon-38.png" },
    "default_popup": "html/popup.html",
    "default_title": "Better Canvas"
  },
  "background": { "service_worker": "js/background.js" },
  "options_page": "html/options.html",
  "content_scripts": [
    {
      "matches": ["https://*/*"],
      "js": ["js/content.js"],
      "css": ["css/content.css"],
      "run_at": "document_start"
    }
  ],
  "permissions": ["storage"],
  "default_locale": "en"
}
```

Key observations — these matter a lot if you want to clone it:

1. **The content script matches `https://*/*` — every HTTPS site on the web.** It does *not* restrict to `*.instructure.com`. The reason is that many universities host Canvas under their own domain (`canvas.myuniversity.edu`, `learn.school.edu`, etc.), so the extension can't know up front. The user enters their Canvas URL once, the extension stores it in `custom_domain`, and after that the content script bails out early on every other site. (See section 4.)
2. **`permissions: ["storage"]` only.** No `activeTab`, no `tabs`, no `webRequest`, no `cookies`, no `host_permissions`. The broad `https://*/*` content script match is what gives it page access. It does *not* read cookies or session tokens directly — it relies on the user's existing Canvas session because it runs *inside* the page context and `fetch()` automatically carries the user's cookies.
3. **`run_at: document_start`** — runs *before* DOM parse, so dark mode CSS can be injected as early as possible to prevent the FOUC (white flash before dark mode kicks in).
4. **MV3 service worker** for `background.js`. The service worker is essentially a one-shot install handler — it does almost nothing at runtime (see section 3).
5. **No `web_accessible_resources`** — the extension never injects anything into the page's main JS world. All DOM work happens from the isolated content-script world.
6. **No `host_permissions`**, no declarativeNetRequest. There is no request interception, no header rewriting. The extension is purely a DOM-level mod.

---

## 3. `background.js` — Defaults & Uninstall

The service worker has exactly one job: on `chrome.runtime.onInstalled`, it walks a giant `default_options` object and writes any missing keys to `chrome.storage.local` and `chrome.storage.sync`. After that, if `new_install` is true, it pops open the options page.

This object also tells you the entire feature surface. Paraphrased:

```js
{
  "local": {
    "previous_colors": null,
    "previous_theme": null,
    "errors": [],          // last 20 stack traces, used by the "report a bug" UI
    "saved_themes": {},
    "liked_themes": []
  },
  "sync": {
    // Dark mode color tokens (the "preset")
    "dark_preset": {
      "background-0": "#161616",  "background-1": "#1e1e1e",  "background-2": "#262626",
      "borders":      "#3c3c3c",
      "text-0":       "#f5f5f5",  "text-1":       "#e2e2e2",  "text-2":       "#ababab",
      "links":        "#56Caf0",
      "sidebar":      "#1e1e1e",  "sidebar-text": "#f5f5f5"
    },
    "dark_mode": true,
    "auto_dark": false,
    "auto_dark_start": { "hour": "20", "minute": "00" },
    "auto_dark_end":   { "hour": "08", "minute": "00" },
    "device_dark": false,           // follow OS dark mode
    "dark_mode_fix": [],            // pages where the heuristic "fixer" should run

    // Dashboard cards
    "gradient_cards": false,
    "disable_color_overlay": false,
    "condensed_cards": false,
    "card_method_date": false,
    "card_method_dashboard": false,
    "card_limit": 25,
    "custom_cards":   {},  // per-course: name, code, img, hidden, weight, credits, eid, gr
    "custom_cards_2": {},  // per-course: 4 customizable button links
    "custom_cards_3": {},  // per-course: url binding + cached color
    "dashboard_grades": false,
    "grade_hover": false,
    "dashboard_notes": false,
    "dashboard_notes_text": "",

    // Assignments / planner
    "assignments_due": true,
    "num_assignments": 4,
    "assignments_done": [],
    "assignment_states": {},        // per-assignment local "complete" toggle, with eviction
    "assignment_date_format": false,
    "card_overdues": false,
    "relative_dues": false,
    "custom_assignments": [],
    "custom_assignments_overflow": ["custom_assignments"],

    // Better Todo (right-side panel)
    "better_todo": false,
    "todo_hr24": false,
    "num_todo_items": 4,
    "hover_preview": true,
    "todo_overdues": false,
    "todo_colors": false,
    "hide_completed": false,
    "hide_feedback": false,

    // Reminders (browser-wide popup that shows on non-Canvas pages too)
    "remind": false,
    "reminders": [],
    "reminder_count": 1,
    "multi_remind": false,

    // GPA calc
    "gpa_calc": false,
    "gpa_calc_weighted": true,
    "gpa_calc_cumulative": false,
    "cumulative_gpa": { "name": "Cumulative GPA", "hidden": false, "weight": "dnc", "credits": 999, "gr": 3.21 },
    "gpa_calc_bounds": {
      "A+": { "cutoff": 97, "gpa": 4.3 }, "A": { "cutoff": 93, "gpa": 4 }, ...
      "F":  { "cutoff": 0,  "gpa": 0 }
    },

    // Misc aesthetics
    "custom_font": { "link": "", "family": "" },
    "custom_styles": "",            // user CSS, just dumped into a <style>
    "remlogo": null,                // remove Canvas logo
    "full_width": null,
    "tab_icons": false,             // colored favicon per course

    // System / domain
    "custom_domain": [""],          // user-supplied list of Canvas hostnames to activate on
    "id": "",                       // anonymous user id used by the theme browser
    "browser_show_likes": false,
    "show_updates": false
  }
}
```

The **only other thing** the background script does is:

```js
chrome.runtime.setUninstallURL("https://diditupe.dev/bettercanvas/goodbye");
```

So `diditupe.dev` is the developer's backend. (`popup.js` almost certainly hits this domain for the theme browser / community themes feature; that file is too large to read in full but the GitHub blob is publicly browsable if you want to confirm.)

There is **no analytics, no telemetry, no tab listeners, no message routing** in the background script. All real work happens in the content script.

---

## 4. The Content Script — How It Actually Modifies Canvas

`js/content.js` is one file, ~2,200 lines, no classes, no modules — pure top-level functions and a handful of mutable globals:

```js
const domain = window.location.origin;
const current_page = window.location.pathname;
let assignments = null;     // Promise<planner items>
let grades = null;          // Promise<courses w/ enrollments>
let announcements = [];
let options = {};           // populated from chrome.storage.sync
```

### 4.1 Bootstrap and the "is this a Canvas page?" trick

Because the content script matches `https://*/*`, it has to figure out whether the current page is Canvas. The flow:

```js
isDomainCanvasPage();

function isDomainCanvasPage() {
    chrome.storage.sync.get(['custom_domain', 'dark_mode', 'dark_preset', 'device_dark', 'remind'], result => {
        options = result;
        if (result.custom_domain.length && result.custom_domain[0] !== "") {
            for (let i = 0; i < result.custom_domain.length; i++) {
                if (domain.includes(result.custom_domain[i])) {
                    startExtension();   // ← YES, this is Canvas
                    return;
                }
            }
            // not Canvas: still run the cross-site reminder watcher
            setTimeout(reminderWatch, 2000);
            setInterval(reminderWatch, 60000);
            chrome.storage.onChanged.addListener(...);
        } else {
            setupCustomURL();   // first-run probe
        }
    });
}
```

If no custom domain is configured yet, it runs `setupCustomURL`, which opportunistically calls `GET /api/v1/courses?per_page=100` on whatever site you're currently on. If it gets a non-empty array back, it concludes "this is Canvas", saves the current origin into `custom_domain`, then reloads. If the API call fails or returns nothing, it does nothing — silently. This is how the extension "auto-detects" the user's school's Canvas without ever asking permission for specific hosts.

After `startExtension()`, the order of operations is:

```js
function startExtension() {
    toggleDarkMode();                   // immediate — runs at document_start, no wait
    chrome.storage.sync.get(null, result => {
        options = { ...options, ...result };
        toggleAutoDarkMode();
        getApiData();                   // fetch planner + grades + colors via REST
        checkDashboardReady();          // attach the big MutationObserver
        loadCustomFont();
        applyAestheticChanges();        // inject the "smaller features" stylesheet
        changeFavicon();
        updateReminders();
        setTimeout(() => runDarkModeFixer(false), 800);   // heuristic pass
        setTimeout(() => runDarkModeFixer(false), 4500);  // and again, after React renders
    });

    chrome.runtime.onMessage.addListener(recieveMessage); // popup ↔ content bridge
    chrome.storage.onChanged.addListener(applyOptionsChanges);
}
```

### 4.2 Reactive option changes (no page reload required)

`applyOptionsChanges` is a giant `switch` over storage keys. The popup never sends messages to enable/disable features — it just writes to `chrome.storage.sync`, and the content script's `onChanged` listener calls the right setup function. This is also how the popup and the content script stay in sync without IPC.

```js
chrome.storage.onChanged.addListener(applyOptionsChanges);

function applyOptionsChanges(changes) {
    let rewrite = {};
    Object.keys(changes).forEach(k => rewrite[k] = changes[k].newValue);
    options = { ...options, ...rewrite };

    Object.keys(changes).forEach(key => {
        switch (key) {
            case "dark_mode": case "dark_preset": case "device_dark":
                toggleDarkMode(); break;
            case "auto_dark": case "auto_dark_start": case "auto_dark_end":
                toggleAutoDarkMode(); break;
            case "gradient_cards":
                changeGradientCards(); break;
            case "dashboard_notes":
                loadDashboardNotes(); break;
            case "dashboard_grades": case "grade_hover":
                if (!grades) getGrades();
                insertGrades(); break;
            case "assignments_due": case "num_assignments":
                if (!assignments) getAssignments();
                if (document.querySelectorAll(".bettercanvas-card-assignment").length === 0)
                    setupCardAssignments();
                loadCardAssignments(); break;
            // ... ~20 more cases
            case "custom_styles": case "remlogo": case "condensed_cards":
            case "hide_feedback": case "full_width":
                applyAestheticChanges(); break;
        }
    });
}
```

This is the *single most copyable pattern* in the whole extension: keep all state in `chrome.storage.sync`, react to `onChanged`, and have a 1:1 mapping from option keys to "rerun this DOM patcher".

### 4.3 Popup ↔ content message bridge

The popup occasionally needs to *read* something from the page (e.g. "what colors are currently on the dashboard?"). For that, there's a tiny message handler:

```js
function recieveMessage(request, sender, sendResponse) {
    switch (request.message) {
        case "getCards":
            options.card_method_dashboard ? getCardsFromDashboard() : getCards();
            sendResponse(true); break;
        case "setcolors":  changeColorPreset(request.options); sendResponse(true); break;
        case "getcolors":  sendResponse(getCardColors()); break;
        case "inspect":    sendResponse(inspectDarkMode(true)); break;
        case "fixdm":      sendResponse(runDarkModeFixer(true)); break;
        default:           sendResponse(true);
    }
}
```

That's it. The popup writes settings via `chrome.storage.sync.set` and only uses `chrome.tabs.sendMessage` for these few imperatives.

### 4.4 Talking to Canvas's REST API

The extension makes plain `fetch()` calls to Canvas's official `api/v1/...` endpoints from the content script. Because the content script runs inside the user's browser with the user's cookies, **no auth token is needed** — Canvas's session cookie is sent automatically.

```js
async function getData(url) {
    let response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    });
    return await response.json();
}
```

Endpoints used (every one of them is documented in Canvas's public REST API reference at `canvas.instructure.com/doc/api/`):

| Purpose | Endpoint |
|---|---|
| List all courses (auto-detect, dashboard cards) | `GET /api/v1/courses?per_page=100` |
| Grades | `GET /api/v1/courses?include[]=concluded&include[]=total_scores&include[]=computed_current_score&include[]=current_grading_period_scores&per_page=100` |
| Planner / todo / assignments | `GET /api/v1/planner/items?start_date=<one week ago ISO>&per_page=75` |
| User's per-course color choices | `GET /api/v1/users/self/colors` |
| Set a course color (used by "color preset" feature) | `PUT /api/v1/users/self/colors/courses_<id>` body `{"hexcode":"#xxx"}` |
| (commented-out experiment) Class statistics | `GET /api/v1/courses/<id>/assignments?include[]=score_statistics&include[]=submission` |

For any **mutating** call (e.g. setting course colors), it grabs Canvas's CSRF token from the `_csrf_token` cookie:

```js
const CSRFtoken = function () {
    return decodeURIComponent((document.cookie.match('(^|;) *_csrf_token=([^;]*)') || '')[2]);
};

// later:
fetch(domain + "/api/v1/users/self/colors/courses_" + course_id, {
    method: "PUT",
    headers: {
        "content-type": "application/json",
        "accept": "application/json",
        "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ "hexcode": colors[cnum] })
});
```

So: read the `_csrf_token` cookie, put it in the `X-CSRF-Token` header, and Canvas's regular Rails CSRF middleware accepts the request. There is **no OAuth, no developer key, no API token** — it just rides the user's session. This is the same trick most Canvas user-mod extensions use.

### 4.5 Handling Canvas's React re-renders (the SPA problem)

Canvas dashboard, planner, and todo sidebar are React. They mount lazily and re-render on navigation, which would normally wipe out any DOM injection. BetterCanvas solves this with a single `MutationObserver` rooted at `<html>`:

```js
function checkDashboardReady() {
    if (current_page !== "/" && current_page !== "") return;

    const callback = (mutationList) => {
        for (const mutation of mutationList) {
            if (mutation.type === "childList") {
                if (mutation.target == document.querySelector("#DashboardCard_Container")) {
                    let cards = document.querySelectorAll('.ic-DashboardCard');
                    changeGradientCards();
                    setupCardAssignments();
                    loadCardAssignments();
                    customizeCards(cards);
                    insertGrades();
                    loadDashboardNotes();
                    setupGPACalc();
                    showUpdateMsg();
                } else if (mutation.target == document.querySelector('#right-side')) {
                    if (!mutation.target.querySelector(".bettercanvas-todosidebar")) {
                        setupBetterTodo();
                        loadBetterTodo();
                    }
                }
            }
        }
    };

    const observer = new MutationObserver(callback);
    observer.observe(document.querySelector('html'), { childList: true, subtree: true });
}
```

Notes on this approach:

- It observes the *entire document tree* with `{childList: true, subtree: true}` — expensive in theory, but works.
- It uses `mutation.target == document.querySelector("#DashboardCard_Container")` as the trigger — i.e. "wait for Canvas's React tree to add children to the dashboard root, then re-apply all my customizations".
- All the patcher functions (`customizeCards`, `loadCardAssignments`, etc.) are written to be idempotent: they look for an existing `.bettercanvas-*` element and replace its contents instead of duplicating.
- There's a separate `iframeObserver` that watches for new `<iframe>`s (Canvas embeds rich content via iframes) and injects the dark mode `<style>` into each iframe's `contentDocument` so embedded content doesn't blind you.

There's also a tiny `resetTimer` debounce on dashboard card patches (1 ms loop until cards exist) used by certain edges, plus two `setTimeout(runDarkModeFixer, 800/4500)` calls on startup to give React's first and second render passes time to settle.

### 4.6 Dark mode — the actual mechanism

Dark mode is **NOT a `prefers-color-scheme` swap** and **NOT CSS filter inversion**. It's a giant hand-crafted selector list with hardcoded color variables substituted in.

```js
let darkStyleInserted = false;

function toggleDarkMode() {
    const css = generateDarkModeCSS();
    if ((options.dark_mode === true || options.device_dark === true) && !darkStyleInserted) {
        let style = document.createElement('style');
        style.textContent = css;
        document.documentElement.append(style);
        style.id = 'darkcss';
        style.className = "bettercanvas-darkmode-enabled";
        darkStyleInserted = true;
    } else if (darkStyleInserted) {
        let style = document.querySelector("#darkcss");
        style.textContent = (options.dark_mode || options.device_dark) ? css : "";
    }
    runiframeChecker();
}
```

`generateDarkModeCSS()` takes the user's `dark_preset` (10 color tokens) and substitutes them into a baseline CSS string that begins like:

```css
#announcementWrapper>div>div, #breadcrumbs, #calendar-app .fc-agendaWeek-view .fc-body,
#calendar-app .fc-event, #calendar-app .fc-month-view .fc-body, #context-list-holder,
.ic-DashboardCard, .ic-DashboardCard__header_content, .ic-discussion-row,
.ic-Layout-wrapper, .conversations .panel, .dropdown-menu, .form, .header-bar,
.PlannerHeader-styles__root, .Day-styles__root, ... { background: <bg-1>; color: <text-0>; }
/* ...thousands of selectors... */
```

It is, essentially, **a giant hand-maintained list of Canvas's class names** mapping each visual region to one of `background-0/1/2`, `text-0/1/2`, `borders`, `links`, `sidebar`, `sidebar-text`. The CSS uses `!important` heavily to win against Canvas's own stylesheets. Because the `<style>` is appended to `<html>` at `document_start`, it's in place before Canvas's CSS even loads (in many cases — for slow connections it still flashes briefly).

To handle pages where the maintained selector list is incomplete, there's a runtime "fixer":

```js
function runDarkModeFixer(override = false) {
    if (options.dark_mode !== true) return ...;
    if (!override && !options.dark_mode_fix.includes(window.location.pathname)) return ...;
    return inspectDarkMode();
}
```

`inspectDarkMode()` walks **every element** with `document.querySelectorAll("*")`, reads its computed `background`, `border-color`, and `color`, and uses heuristics like:

```js
if (r > 245 && g > 245 && b > 245 && /* not already a known dark token */) {
    el.style.cssText = "background:" + dark_preset["background-0"] + "!important;" +
                       "color:"      + dark_preset["text-0"]      + "!important;" + el.style.cssText;
}
```

Translation: "if this element looks white-ish and isn't already one of my colors, force it dark." It does the same for near-white backgrounds → background-1, light borders → borders, near-black text → text-0. This is opt-in per-pathname (`dark_mode_fix` is an array of paths the user has flagged) because it's expensive and prone to over-recoloring.

The dark mode also propagates into iframes via the `runiframeChecker` MutationObserver — see 4.5.

### 4.7 The "smaller features" aesthetics stylesheet

Several toggleable features are implemented as a *single shared `<style>` tag* whose contents are concatenated from the active option flags:

```js
function applyAestheticChanges() {
    let style = document.querySelector("#bettercanvas-aesthetics") || document.createElement('style');
    style.id = "bettercanvas-aesthetics";
    style.textContent = "";
    if (options.condensed_cards)
        style.textContent += ".ic-DashboardCard__header_hero{height:60px!important}" +
                             ".ic-DashboardCard__header-subtitle,.ic-DashboardCard__header-term{display:none}";
    if (options.remlogo)
        style.textContent += ".ic-app-header__logomark-container{display:none}";
    if (options.disable_color_overlay)
        style.textContent += ".ic-DashboardCard__header_hero{opacity:0!important}" +
                             ".ic-DashboardCard__header-button-bg{opacity:1!important}";
    if (options.hide_feedback)
        style.textContent += ".recent_feedback{display:none}";
    if (options.full_width)
        style.textContent += ".ic-Layout-wrapper{max-width:100%!important}";
    if (options.custom_styles !== "")
        style.textContent += options.custom_styles;     // user-supplied CSS, raw
    document.documentElement.appendChild(style);
}
```

The `custom_styles` field is the "userstyle" escape hatch — anything the user pastes there is appended raw.

### 4.8 Custom font (Google Fonts)

```js
function loadCustomFont() {
    // ...
    link.href = `https://fonts.googleapis.com/css2?family=${options.custom_font.link}&display=swap`;
    link.rel  = "stylesheet";
    document.head.appendChild(link);
    style.textContent = `*, input, a, button, h1,h2,h3,h4,h5,h6, p, span {font-family: ${options.custom_font.family}!important}`;
}
```

A `<link>` to fonts.googleapis.com plus a universal-selector override. No font subsetting or sandboxing.

### 4.9 Custom dashboard cards

The cards data model is split across three storage keys (a versioning scar):

- `custom_cards[course_id]` → `{ default, name, code, img, hidden, weight, credits, eid, gr }` — the visible name/code/image overrides plus GPA-calc metadata.
- `custom_cards_2[course_id]` → `{ links: [{path, is_default}, ...4] }` — the 4 customizable nav buttons.
- `custom_cards_3[course_id]` → `{ url, color }` — which Canvas instance the card belongs to (so multi-Canvas users don't see the wrong cards) and a cached color.

Two acquisition strategies:

```js
// Strategy 1: hit Canvas REST
async function getCards(api = null) {
    let dashboard_cards = api || await getData(`${domain}/api/v1/courses?per_page=100`);
    // sort by enrollment_term_id (most recent term first) or by created_at if option set
    // populate the three custom_cards_* objects
    // also delete entries for courses that no longer exist
}

// Strategy 2: scrape the rendered dashboard
function getCardsFromDashboard() {
    document.querySelectorAll(".ic-DashboardCard").forEach(card => {
        const id = card.querySelector(".ic-DashboardCard__link").href.split("courses/")[1];
        // ...build the same shape from DOM
    });
}
```

The user toggles between them via `card_method_dashboard`. Strategy 2 exists because some Canvas installations restrict the courses API.

Customization is then applied via `customizeCards()` (around line 1548), which walks the DOM cards and rewrites their innerText / image / link buttons / etc. according to the stored data, also handling hidden cards (`display: none`).

### 4.10 Setting card colors at the server level

The "color palette" feature is unusual — instead of CSS-overriding card colors, the extension actually **PUTs the new colors back to Canvas** so that they persist across devices and inside Canvas's own UI. This is the only mutating API call in the codebase:

```js
async function changeColorPreset(colors) {
    const csrfToken = CSRFtoken();
    // ... sort cards by href so palette assignment is stable ...
    sortedCards.forEach((card, i) => {
        const course_id = card.href.split("courses/")[1];
        const cnum = i % colors.length;
        // Queue a delayed PUT for each card (delay = 250 ms) so Canvas doesn't rate-limit
        let changeCardColor = () => {
            fetch(domain + "/api/v1/users/self/colors/courses_" + course_id, {
                method: "PUT",
                headers: {
                    "content-type": "application/json",
                    "accept": "application/json",
                    "X-CSRF-Token": csrfToken
                },
                body: JSON.stringify({ "hexcode": colors[cnum] })
            }).then(() => {
                card.el.querySelector(".ic-DashboardCard__header_hero")
                       .style.backgroundColor = colors[cnum];
            });
        };
        // ...push into a queue and drain on a setInterval...
    });
}
```

### 4.11 Gradient cards

Cards normally have a flat header color. Gradient mode reads each card's RGB, converts to HSL, picks a hue offset based on which sextant of the color wheel it lives in, and emits per-card CSS:

```js
let [h, s, l] = rgbToHsl(r, g, b);
let degree   = ((h % 60) / 60) >= .66 ?  30
             : ((h % 60) / 60) <= .33 ? -30 : 15;
let newh     = h > 300 ? (360 - (h + 65)) + (65 + degree) : h + 65 + degree;
cardcss.textContent += `.ic-DashboardCard:nth-of-type(${i+1}) .ic-DashboardCard__header_hero{
    background: linear-gradient(115deg,
        hsl(${h}deg, ${s}%, ${l}%) 5%,
        hsl(${newh}deg, ${s}%, ${l}%) 100%
    )!important
}`;
```

Pure CSS — no canvas/SVG.

### 4.12 Dashboard grades + grade hover

Grade insertion uses the planner-fetched `grades` data and matches by course id:

```js
function insertGrades() {
    if (!options.dashboard_grades) { /* hide existing */; return; }
    grades.then(data => {
        document.querySelectorAll('.ic-DashboardCard').forEach(card => {
            const course_id = parseInt(card.querySelector(".ic-DashboardCard__link").href.split("courses/")[1]);
            const g = data.find(x => x.id === course_id);
            if (!g) return;
            const gp = g.enrollments[0].has_grading_periods
                ? g.enrollments[0].current_period_computed_current_score
                : g.enrollments[0].computed_current_score;
            const percent = (gp || "--") + "%";
            const el = card.querySelector(".bettercanvas-card-grade") ||
                       makeElement("a", card.querySelector(".ic-DashboardCard__header"),
                                   { className: "bettercanvas-card-grade", textContent: percent });
            if (options.grade_hover) el.classList.add("bettercanvas-hover-only");
            el.setAttribute("href", `${domain}/courses/${course_id}/grades`);
        });
    });
}
```

`bettercanvas-hover-only` is a CSS class with `opacity:0%`, plus a sibling rule `.ic-DashboardCard:hover .bettercanvas-card-grade.bettercanvas-hover-only{opacity:100%}`. So "grade hover" is just CSS.

### 4.13 Card assignment lists

Each `.ic-DashboardCard` gets a `.bettercanvas-card-container` injected that lists the next N upcoming assignments for that course, pulled from `/api/v1/planner/items`. The list is precomputed via `preloadAssignmentEls()` into a `Promise<{ [course_id]: [{el, due, type, ...}] }>` so re-renders are cheap. Marking an assignment as "done" toggles a class and writes to `assignment_states[plannable_id]` in storage; that map is capped at ~7400 bytes JSON to stay under the per-key sync quota.

```js
function setAssignmentState(id, updates) {
    let states = options.assignment_states;
    if (JSON.stringify(states).length > 7400) {
        // evict oldest by expire date, keep most recent
    }
    states[id] = states[id] ? { ...states[id], ...updates } : updates;
    chrome.storage.sync.set({ assignment_states: states }).then(...);
}
```

This is a pragmatic workaround for `chrome.storage.sync`'s 8 KB-per-item quota.

### 4.14 Browser-wide assignment reminders

The reminders feature is the *only* part of the extension that does anything on non-Canvas pages. Because the content script runs on all `https://` pages, when the URL is *not* the user's Canvas, it just runs:

```js
setTimeout(reminderWatch, 2000);
setInterval(reminderWatch, 60000);
```

`reminderWatch` reads `chrome.storage.sync.get("reminders")`, walks the list, and for any item due within 6 hours (or 2 hours for the second alert) injects a floating `<div id="bettercanvas-reminders">` into the current page's `<body>`. Each reminder has `{ d: due-time, t: title, h: href, c: dismiss-count }`. Reminders are seeded by `updateReminders()` from the planner data while the user is on Canvas. Cross-device by virtue of being in `chrome.storage.sync`.

### 4.15 Tab favicons by course color

```js
function changeFavicon() {
    if (!options.tab_icons) return;
    let match = current_page.match(/courses\/(?<id>\d*)/);
    if (match && options.custom_cards_3[match.groups.id]?.color) {
        document.querySelector('link[rel="icon"').href =
            `data:image/svg+xml;utf8,<svg ... fill="${color.replace("#","%23")}" .../>`;
    }
}
```

A data-URI SVG with the Canvas logo path filled with the course's color, swapped into the page's `<link rel="icon">`.

### 4.16 GPA calculator

`setupGPACalc()` injects a "what-if" calculator into Canvas's grades page. Bounds (A+/A/A-/...) are stored in `gpa_calc_bounds` so the user can choose a custom scale. Cumulative GPA across courses is computed from the cached grades + per-card credits/weight metadata kept in `custom_cards`.

### 4.17 Custom user CSS

`options.custom_styles` is just appended to the aesthetics `<style>` (see 4.7). Total userstyle escape hatch — there is no sanitization.

### 4.18 Error logging

```js
function logError(e) {
    chrome.storage.local.get("errors", storage => {
        if (storage.errors.length > 20) storage.errors = [];
        chrome.storage.local.set({ errors: storage.errors.concat(e.stack) });
    });
}
```

Errors are stored locally and surfaced in the popup's "report a bug" UI. Nothing is sent off-device.

---

## 5. The Popup / Options UI

`html/popup.html` is ~66 KB of static HTML — every option control rendered up front. `js/popup.js` is ~686 KB and is the only place that looks like it might once have been bundled (it's the largest file in the repo by ~5x). It handles:

- Reading and writing every key in `chrome.storage.sync`
- The community theme browser (loads/posts themes against `diditupe.dev`)
- The color picker / palette UI
- The assignment overflow editor
- The GPA bounds editor
- Sending the imperative messages (`getCards`, `setcolors`, `getcolors`, `inspect`, `fixdm`) to the active tab via `chrome.tabs.sendMessage`

There is **no React, no Vue, no Lit**. The DOM is built imperatively. `options.html` is a thin wrapper that loads the same content in a full-page tab as the chrome extension options page.

The settings UI is connected to the live page entirely via `chrome.storage.onChanged` — a great pattern: the popup never has to know whether the content script is running or which tab to talk to.

---

## 6. Internationalization

`_locales/<lang>/messages.json` — standard Chrome i18n. Languages: en, de, es, fr, it, ja, pt_PT, ru, sv, zh_CN, zh_TW. Crowdin-managed (`crowdin.yml` at the repo root).

---

## 7. Architectural Summary

| Aspect | Choice |
|---|---|
| Manifest | MV3, single content script on `https://*/*`, no host_permissions |
| Permissions | `["storage"]` only |
| Build tooling | None — plain JS, plain CSS, plain HTML |
| Framework | None (vanilla DOM) |
| State | `chrome.storage.sync` (settings, cross-device) + `chrome.storage.local` (themes, errors) |
| Reactivity | `chrome.storage.onChanged` switch in content.js |
| Re-render handling | One MutationObserver on `<html>` watching `#DashboardCard_Container` and `#right-side`; idempotent patcher functions |
| Styling | Single big injected `<style>` for dark mode (with template substitution), separate `<style>` per feature group |
| Auth to Canvas API | Implicit — relies on user's session cookie; CSRF read from `_csrf_token` cookie for PUTs |
| Cross-Canvas-instance | User-supplied `custom_domain` array; first run probes via `/api/v1/courses` |
| Background work | Almost none — service worker only sets defaults and an uninstall URL |
| External services | `diditupe.dev` (theme browser, uninstall page); Google Fonts (custom font feature) |

---

## 8. How to Build Your Own Version

If you want to clone the architecture (or Cherry-pick its better parts), here's the minimum viable recipe:

### Minimal manifest (MV3)

```json
{
  "manifest_version": 3,
  "name": "MyCanvas",
  "version": "0.1.0",
  "permissions": ["storage"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" },
  "options_page": "options.html",
  "content_scripts": [{
    "matches": ["https://*/*"],
    "js": ["content.js"],
    "css": ["content.css"],
    "run_at": "document_start"
  }]
}
```

Note: matching all of `https://*/*` is what the Chrome Web Store will scrutinize most. If you only need to support a fixed list of Canvas hosts, prefer `"matches": ["https://*.instructure.com/*", "https://canvas.myschool.edu/*"]` and skip the auto-detect dance entirely.

### Minimum content-script skeleton

```js
const domain = location.origin;
const path   = location.pathname;
let opts = {};

(async function init() {
  opts = await chrome.storage.sync.get(null);
  // 1. Auto-detect or check user-specified domain
  if (!opts.custom_domain || !opts.custom_domain.some(d => domain.includes(d))) {
    return tryAutoDetect();
  }

  // 2. Inject dark mode CSS as early as possible (we run at document_start)
  injectDarkMode();

  // 3. Wait for Canvas's React to render the dashboard, then patch it
  new MutationObserver(() => {
    const dash = document.querySelector("#DashboardCard_Container");
    if (dash && dash.children.length) patchDashboard();
  }).observe(document.documentElement, { childList: true, subtree: true });

  // 4. React to settings changes without page reload
  chrome.storage.onChanged.addListener(changes => {
    Object.assign(opts, Object.fromEntries(
      Object.entries(changes).map(([k, v]) => [k, v.newValue])
    ));
    if ("dark_mode"   in changes) injectDarkMode();
    if ("dashboard_*" in changes) patchDashboard();
    // ... etc
  });
})();

async function tryAutoDetect() {
  try {
    const r = await fetch(`${domain}/api/v1/courses?per_page=1`, {
      headers: { Accept: "application/json" }
    });
    if (!r.ok) return;
    const data = await r.json();
    if (Array.isArray(data) && data.length) {
      const list = (await chrome.storage.sync.get("custom_domain")).custom_domain || [];
      list.push(domain);
      await chrome.storage.sync.set({ custom_domain: list });
      location.reload();
    }
  } catch {}
}
```

### Hitting Canvas's API

You don't need a developer key. The user is already signed in; `fetch` carries cookies. For mutating calls, grab CSRF from the cookie:

```js
const csrf = decodeURIComponent(
  (document.cookie.match('(^|;) *_csrf_token=([^;]*)') || [,,''])[2]
);

await fetch(`${domain}/api/v1/users/self/colors/courses_${id}`, {
  method: "PUT",
  headers: {
    "content-type": "application/json",
    "X-CSRF-Token": csrf
  },
  body: JSON.stringify({ hexcode: "#ff8800" })
});
```

Useful endpoints (all GET unless noted):

- `/api/v1/courses?per_page=100&include[]=total_scores&include[]=current_grading_period_scores`
- `/api/v1/planner/items?start_date=<ISO>&per_page=75`
- `/api/v1/users/self/colors`
- `PUT /api/v1/users/self/colors/courses_<id>`
- `/api/v1/courses/<id>/assignments?include[]=score_statistics&include[]=submission`
- `/api/v1/courses/<id>/assignment_groups`
- `/api/v1/courses/<id>/quizzes`
- `/api/v1/users/self/missing_submissions`
- `/api/v1/users/self/upcoming_events`

Full reference: https://canvas.instructure.com/doc/api/ — anything documented there is fair game with cookie auth.

### Dark mode strategies, ranked

1. **Hand-curated selector list (BetterCanvas's approach).** Most reliable visually, lowest perf cost, but high maintenance burden — every Canvas update can break rules. The list is a literal hardcoded string in `generateDarkModeCSS()` with token placeholders for the user's color choices.
2. **CSS variable shimming.** Modern Canvas exposes some `--ic-brand-*` custom properties. You can override these in a small stylesheet and get a partial dark mode for free. It won't cover everything (rich content, some legacy classes) but it's a 50-line file instead of a 5,000-line one.
3. **Heuristic per-element walker (BetterCanvas's `inspectDarkMode`).** `querySelectorAll("*")` plus computed-style sniffing. Slow on large pages, prone to over-recoloring images and badges. BetterCanvas only runs this on pathnames the user has explicitly opted in via the `dark_mode_fix` array.
4. **Filter inversion (`html { filter: invert(1) hue-rotate(180deg) }`).** Cheap but ugly — breaks images, breaks user-uploaded content, breaks anything color-coded.

For a clone, a hybrid of (1) for the chrome and (2) for the body content is probably ideal.

### Surviving Canvas's React re-renders

The single most important pattern: **make every patcher function idempotent** and **trigger them from a `MutationObserver`** whose root is broad (`<html>`) but whose action is narrowed by checking `mutation.target`. Your patchers should:

- Look for an existing `.myext-foo` element and replace its contents instead of always appending.
- Use stable attribute selectors that survive React reconciliation (`.ic-DashboardCard`, `#DashboardCard_Container`, `#right-side`, etc. — these have been stable for years).
- Avoid replacing or removing nodes Canvas's React owns. Mutate inside your own injected wrappers, or set `style.cssText` / `classList` on Canvas elements (which React tolerates).

### Settings UX

Don't bother with a message bus between popup and content script. Have the popup write to `chrome.storage.sync` directly, and have the content script subscribe via `onChanged`. This means:

- The popup doesn't need to know which tab is active or whether the content script is loaded.
- Settings sync to other devices automatically.
- You can re-apply features without a page reload.

The only thing you actually need messages for is "ask the page to do a one-shot thing" (e.g. "give me the current card colors so the picker can show them"). BetterCanvas's `recieveMessage` switch has only 5 cases.

### Storage budget pitfalls

`chrome.storage.sync` has an **8 KB per item** and **100 KB total** quota. BetterCanvas hits this with `assignment_states` (per-assignment user toggles), and copes by:

- Capping the JSON size at 7,400 bytes and evicting oldest entries.
- Splitting card data across three keys (`custom_cards`, `custom_cards_2`, `custom_cards_3`) — this is partly historical but also a quota-avoidance trick.
- Storing things that don't need cross-device sync (theme cache, error logs) in `chrome.storage.local` instead.

### Things BetterCanvas does NOT do (that you might be tempted to)

- It does not request `host_permissions`. It does not need them — content scripts on `https://*/*` plus implicit cookie auth cover everything.
- It does not use a web request listener to rewrite Canvas's HTML or CSS.
- It does not inject scripts into the page's main world (`world: "MAIN"`). All work happens in the isolated content script world.
- It does not call any Canvas OAuth flow or store any access token.
- It does not use a build system. (For a clone you probably should — the 686 KB hand-written `popup.js` is exactly what you'd avoid by using Vite + a small UI library.)
- It does not bundle React. Vanilla DOM is sufficient for an extension this size and dramatically reduces store-review friction.

### Pitfalls you should expect

- **Canvas class names occasionally change.** The codebase has a few comments hinting at past breakage. A clone needs a strategy for graceful degradation when a selector goes missing.
- **Some Canvas installations disable parts of the API.** That's why BetterCanvas has `getCardsFromDashboard` as a fallback to `getCards`.
- **The Chrome Web Store is suspicious of `<all_urls>` content scripts.** Be ready to justify in the store review that you need it because Canvas can be self-hosted under any domain. BetterCanvas has been approved with this for years, so it's clearly defensible, but you'll need to write a clear privacy policy.
- **CSP on certain Canvas pages.** Custom-font injection can break if a school enforces a strict `font-src`. There's no workaround inside an extension content script for this beyond falling back to system fonts.
- **`chrome.storage.sync` is per-extension, per-Google-account.** If a user switches Chrome profiles, their settings disappear. BetterCanvas accepts this.

---

## 9. Sources

- GitHub repo (canonical): https://github.com/UseBetterCanvas/bettercanvas
- README: https://github.com/UseBetterCanvas/bettercanvas/blob/main/README.md
- `manifest.json`: https://raw.githubusercontent.com/UseBetterCanvas/bettercanvas/main/manifest.json
- `js/background.js`: https://raw.githubusercontent.com/UseBetterCanvas/bettercanvas/main/js/background.js
- `js/content.js`: https://raw.githubusercontent.com/UseBetterCanvas/bettercanvas/main/js/content.js
- `css/content.css`: https://raw.githubusercontent.com/UseBetterCanvas/bettercanvas/main/css/content.css
- Chrome Web Store listing: https://chromewebstore.google.com/detail/bettercanvas/cndibmoanboadcifjkjbdpjgfedanolh
- Firefox listing: https://addons.mozilla.org/en-US/firefox/addon/better-canvas/
- Marketing site: https://www.better-canvas.com/
- Author email (per README): ksucpea@gmail.com
- Canvas LMS REST API reference: https://canvas.instructure.com/doc/api/
- Comparable open-source Canvas mod for cross-reference: https://github.com/Code-with-Ski/Canvas-LMS-Mods
- Older spiritual ancestor (Chrome ext format study): https://github.com/shawnr/gesso

All code excerpts in this document were copied directly from the files listed above; nothing is paraphrased or AI-summarized except where the file was too large to quote in full (notably the body of `generateDarkModeCSS()` and the bulk of `popup.js`).
