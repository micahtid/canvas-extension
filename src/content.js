// Custom Canvas — content script
// Two responsibilities:
//   1. Replace the dashboard's native "To Do" sidebar with a weekly task list.
//   2. Render an in-page customization modal (opened from the toolbar icon)
//      that lets the user tweak Canvas's appearance via CSS variables and
//      data attributes on <html>.

const WIDGET_ID = 'cc-weekly-tasks';
const GRADES_WIDGET_HOST_ID = 'cc-grades-widget-host';
const RECENT_FEEDBACK_WIDGET_ID = 'cc-recent-feedback';
const FEEDBACK_SHOW_LIMIT = 3;
const NATIVE_SELECTOR = '.Sidebar__TodoListContainer';
const SIDEBAR_SELECTOR = '#right-side';
const MODAL_ID = 'cc-modal-root';

// ---------- settings ----------

const DEFAULTS = {
  // Master kill switch
  extensionEnabled: true,

  // Course cards
  cardRadius: 8,
  cardShadow: 'soft',         // 'none' | 'soft' | 'strong'
  cardShowImage: true,
  cardImageOpacity: 1.0,
  cardHeaderHeight: 110,
  cardBgColor: '',            // empty = Canvas default
  cardTextColor: '',          // empty = Canvas default

  // Left sidebar (the global Canvas nav)
  sidebarRestyle: true,
  sidebarIconSize: 22,
  sidebarLabelSize: 10,
  sidebarShowLabels: true,
  sidebarBgColor: '',
  sidebarTextColor: '',
  sidebarActiveColor: '',
  sidebarActiveTextColor: '',

  // Theme
  accentColor: '#008ee2',
  density: 'cozy',            // 'compact' | 'cozy' | 'comfortable'

  // Background
  bgColor: '',
  bgImage: '',
  bgBlur: 0,

  // Page-level text + font
  textColor: '',
  fontFamily: 'Inter',

  // Modal accent (used by active tab, selected dropdown option, toggle on, slider)
  modalAccentColor: '#fc5050',

  // Weekly Tasks widget
  widgetEnabled: true,
  widgetProgressStyle: 'bar', // 'bar' | 'ring' | 'segments'
  widgetProgressColor: '#6366f1',
  widgetSortBy: 'dueDate',    // 'dueDate' | 'status' | 'course' | 'type'
  widgetGroupBy: 'priority',  // 'priority' | 'course'
  widgetShowCompleted: true,
  widgetHideAnnouncements: false,
  widgetHideDiscussions: false,

  // List View (Planner) & Recent Activity
  plannerLayout: 'cards',        // 'cards' | 'rows' | 'compact' — dominant look
  plannerDoneStyle: 'fade',      // 'fade' | 'strikethrough' | 'hide'
  plannerEmphasizeToday: true,   // accent the "Today" day header
  plannerHideEmptyDays: false,   // skip day headers with no items
  plannerHideActivity: false,    // remove Recent Activity feed from List view
  plannerTaskRowRedesignEnabled: true, // align task metadata + compact note rows
  plannerItemBg: '',          // empty = Canvas default
  plannerItemTextColor: '',   // empty = Canvas default
  plannerBarWidth: 5,         // px — colored left stripe per item
  plannerItemSpacing: 8,      // px — gap between items
  plannerDayBg: '',           // empty = Canvas default
  plannerDayTextColor: '',    // empty = Canvas default
  plannerDoneOpacity: 50,     // % — opacity of completed items
  activityItemBg: '',         // empty = Canvas default

  // Dark mode
  darkMode: false,

  // Sidebar layout
  sidebarLabelPosition: 'bottom', // 'bottom' | 'right'

  // Tasks widget — extended
  widgetShowFraction: true,
  widgetFilter: 'all',           // legacy setting retained for older stored configs
  assignmentPreviewsEnabled: true,

  // Recent Feedback widget
  recentFeedbackEnabled: true,
  recentFeedbackShowDetails: true,

  // Command palette
  commandPaletteEnabled: true,
  hideScrollBars: false,
  minimalScrollbars: true,

  // Google Calendar integration
  gcalAutoSync: false,
  gcalDaysAhead: 60,
  gcalSyncAssignments: true,
  gcalSyncQuizzes: true,
  gcalSyncDiscussions: false,
  gcalSyncAnnouncements: false,
};

let settings = { ...DEFAULTS };

async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    settings = { ...DEFAULTS, ...stored };
    if (settings.sidebarLabelPosition === 'left') settings.sidebarLabelPosition = 'right';
    settings.plannerHideEmptyDays = false;
  } catch (e) {
    settings = { ...DEFAULTS };
  }
  return settings;
}

async function saveSettings(partial) {
  Object.assign(settings, partial);
  try {
    await chrome.storage.sync.set(partial);
  } catch (e) {
    console.warn('[CustomCanvas] save failed', e);
  }
}

// ---------- Google Calendar integration ----------

async function gcalGetToken(interactive = false) {
  // chrome.identity is unavailable in content scripts — proxy via background
  console.log('[CC] gcalGetToken start, interactive=', interactive);
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'cc-gcal-get-token',
      interactive,
    });
    console.log('[CC] gcalGetToken response:', response);
    if (response?.error) {
      console.warn('[CC] gcalGetToken error from bg:', response.error);
    }
    return response?.token || null;
  } catch (e) {
    console.warn('[CC] gcal token sendMessage failed', e);
    return null;
  }
}

async function gcalRequest(token, method, path, body) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, opts);
  if (res.status === 204) return null;
  if (!res.ok) throw Object.assign(new Error(`GCal ${res.status}`), { status: res.status });
  return res.json();
}

async function gcalGetOrCreateCalendar(token) {
  const stored = await chrome.storage.local.get('gcalCalendarId');

  // Verify the cached ID still points to a live calendar. If the user deleted
  // the "Canvas" calendar in Google Calendar, the cached ID is stale — every
  // event ID in gcalEventMap is also dead since those events lived inside
  // that deleted calendar. Clear both and fall through to create a fresh one.
  if (stored.gcalCalendarId) {
    try {
      await gcalRequest(token, 'GET',
        `calendars/${encodeURIComponent(stored.gcalCalendarId)}`);
      return stored.gcalCalendarId;
    } catch (err) {
      if (err.status === 404 || err.status === 410 || err.status === 403) {
        console.log('[CC] cached calendar is gone — clearing stale state');
        await chrome.storage.local.remove(['gcalCalendarId', 'gcalEventMap']);
      } else {
        throw err;
      }
    }
  }

  // No (valid) cached ID — look for an existing "Canvas" calendar in the
  // user's list before creating a new one, so we pick up a calendar the user
  // may have created manually.
  const list = await gcalRequest(token, 'GET', 'users/me/calendarList?maxResults=250');
  const existing = (list?.items || []).find(c => c.summary === 'Canvas');
  if (existing) {
    await chrome.storage.local.set({ gcalCalendarId: existing.id });
    return existing.id;
  }

  const cal = await gcalRequest(token, 'POST', 'calendars', {
    summary: 'Canvas',
    description: 'Assignments and due dates synced from Canvas LMS by Custom Canvas.',
  });
  // Explicitly reset the event map — if the old calendar was deleted the
  // map was cleared above, but creating a fresh calendar also invalidates
  // any events whose IDs might have lingered in memory.
  await chrome.storage.local.set({ gcalCalendarId: cal.id, gcalEventMap: {} });
  return cal.id;
}

// YYYY-MM-DD in the user's local time zone — so an 11:59pm-due item
// stays on its actual due date instead of bleeding into the next UTC day.
function gcalFormatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function gcalBuildEvent(item) {
  const due = new Date(item.plannable.due_at);
  const startDate = gcalFormatLocalDate(due);
  // Google Calendar treats end.date as exclusive — end must be the day after
  // start for a single all-day event.
  const endDate = gcalFormatLocalDate(
    new Date(due.getFullYear(), due.getMonth(), due.getDate() + 1)
  );
  const title = item.context_name
    ? `[${item.context_name}] ${item.plannable.title}`
    : item.plannable.title;
  return {
    summary: title,
    description: `View in Canvas: ${item.html_url || ''}`,
    start: { date: startDate },
    end:   { date: endDate },
    extendedProperties: { private: { canvasId: `${item.plannable_type}_${item.plannable_id}` } },
  };
}

async function gcalSyncNow(interactive = false) {
  console.log('[CC] gcalSyncNow start, interactive=', interactive);
  // Show "Connecting…" on the connect button while the OAuth popup is up
  const connectBtn = document.querySelector(`#${MODAL_ID} [data-action="gcal-connect"]`);
  if (interactive && connectBtn) {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';
  }

  try {
    const token = await gcalGetToken(interactive);
    console.log('[CC] gcalSyncNow token result:', token ? 'GOT TOKEN' : 'NO TOKEN');
    if (!token) {
      // User cancelled OAuth or auth failed — reset UI
      await refreshIntegrationsStatus();
      return;
    }

    // Fetch and store user email synchronously so the UI can show it
    if (!(await chrome.storage.local.get('gcalEmail')).gcalEmail) {
      try {
        const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json());
        if (info.email) {
          await chrome.storage.local.set({ gcalEmail: info.email });
        }
      } catch { /* non-fatal */ }
    }

    // Flip UI to connected state immediately — before the (potentially long) sync
    await refreshIntegrationsStatus();

    // Now mark the sync button as syncing
    const syncBtn = document.querySelector(`#${MODAL_ID} [data-action="gcal-sync"]`);
    if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = 'Syncing…'; }

    const calId = await gcalGetOrCreateCalendar(token);

    // Read the event map AFTER gcalGetOrCreateCalendar — if the prior Canvas
    // calendar was deleted, that call wiped the map and we need the fresh
    // (empty) one, not a stale in-memory copy.
    const mapStored = await chrome.storage.local.get('gcalEventMap');
    const eventMap = mapStored.gcalEventMap ? { ...mapStored.gcalEventMap } : {};

    // Fetch Canvas planner items for the sync window
    const now = new Date();
    const windowEnd = new Date(now.getTime() + settings.gcalDaysAhead * 86400000);
    const params = new URLSearchParams({
      start_date: now.toISOString(),
      end_date: windowEnd.toISOString(),
      per_page: '100',
    });
    const res = await fetch(`/api/v1/planner/items?${params}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Canvas API ${res.status}`);
    const allItems = await res.json();

    // Filter by user-selected types (only whitelisted types with explicit true)
    const typeFilter = {
      assignment:       settings.gcalSyncAssignments,
      quiz:             settings.gcalSyncQuizzes,
      discussion_topic: settings.gcalSyncDiscussions,
      announcement:     settings.gcalSyncAnnouncements,
    };
    const items = allItems.filter(item =>
      item.plannable?.due_at && typeFilter[item.plannable_type] === true
    );

    // Upsert events into Google Calendar. Track failures so we can surface a
    // meaningful status if everything fails (e.g., calendar deleted mid-sync).
    let created = 0, updated = 0, failed = 0;
    for (const item of items) {
      const key = `${item.plannable_type}_${item.plannable_id}`;
      const event = gcalBuildEvent(item);
      try {
        if (eventMap[key]) {
          await gcalRequest(token, 'PATCH',
            `calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventMap[key])}`, event);
          updated++;
        } else {
          const res2 = await gcalRequest(token, 'POST',
            `calendars/${encodeURIComponent(calId)}/events`, event);
          if (res2?.id) { eventMap[key] = res2.id; created++; }
        }
      } catch (err) {
        // PATCH 404 → the specific event was deleted; recreate it.
        if (err.status === 404 && eventMap[key]) {
          delete eventMap[key];
          try {
            const res2 = await gcalRequest(token, 'POST',
              `calendars/${encodeURIComponent(calId)}/events`, event);
            if (res2?.id) { eventMap[key] = res2.id; created++; }
          } catch (err2) {
            failed++;
            // If re-POST fails with 404/410, the calendar itself is gone —
            // abort the whole sync so the next run recreates the calendar.
            if (err2.status === 404 || err2.status === 410) throw err2;
          }
        } else if (err.status === 404 || err.status === 410) {
          // POST into a dead calendar — abort, next sync will recreate it.
          throw err;
        } else {
          failed++;
        }
      }
    }
    console.log(`[CC] sync complete: ${created} created, ${updated} updated, ${failed} failed`);

    await chrome.storage.local.set({ gcalEventMap: eventMap, gcalLastSynced: Date.now() });
    if (syncBtn) { syncBtn.disabled = false; syncBtn.textContent = 'Sync Now'; }
    await refreshIntegrationsStatus();

  } catch (err) {
    console.warn('[CustomCanvas] GCal sync failed', err);
    // If the sync aborted because the calendar disappeared (404/410), drop
    // the stale cached ID + event map so the next sync creates a fresh
    // calendar without requiring the user to reload.
    if (err?.status === 404 || err?.status === 410) {
      await chrome.storage.local.remove(['gcalCalendarId', 'gcalEventMap']);
    }
    const btn = document.querySelector(`#${MODAL_ID} [data-action="gcal-sync"]`);
    if (btn) {
      btn.textContent = 'Sync failed';
      setTimeout(() => {
        if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Sync Now'; }
      }, 3000);
    }
    // Reset the connect button if it's still showing "Connecting…"
    await refreshIntegrationsStatus();
  }
}

async function gcalDisconnect() {
  try {
    // Background clears its cached token + revokes it server-side
    await chrome.runtime.sendMessage({ type: 'cc-gcal-remove-token' });
  } catch { /* non-fatal */ }
  await chrome.storage.local.remove(['gcalCalendarId', 'gcalEventMap', 'gcalLastSynced', 'gcalEmail']);
  refreshIntegrationsStatus();
}

async function refreshIntegrationsStatus() {
  const root = document.getElementById(MODAL_ID);
  if (!root || currentTab !== 'integrations') return;

  const token = await gcalGetToken(false);
  const local = await chrome.storage.local.get(['gcalEmail', 'gcalLastSynced']);
  const connected = !!token;

  // Render the complete card footer (left info column + right action buttons).
  // [data-gcal-status] is display:contents so its child divs participate directly
  // in the footer's flex space-between layout.
  const statusEl = root.querySelector('[data-gcal-status]');
  if (statusEl) {
    if (connected) {
      const mins = local.gcalLastSynced
        ? Math.round((Date.now() - local.gcalLastSynced) / 60000)
        : null;
      const lastText = mins === null ? 'Never synced'
        : mins < 1 ? 'Last synced just now'
        : mins < 60 ? `Last synced ${mins}m ago`
        : `Last synced ${Math.round(mins / 60)}h ago`;
      statusEl.innerHTML = `
        <div class="cc-integ-foot-left">
          <div class="cc-integ-account">
            <span class="cc-gcal-dot"></span>
            <span class="cc-gcal-email" title="${escapeHtml(local.gcalEmail || '')}">${escapeHtml(local.gcalEmail || 'Google Account')}</span>
          </div>
          <div class="cc-last-synced">${lastText}</div>
        </div>
        <div class="cc-integ-foot-right">
          <button class="cc-btn-ghost" data-action="gcal-disconnect">Disconnect</button>
          <button class="cc-btn" data-action="gcal-sync">Sync Now</button>
        </div>`;
    } else {
      statusEl.innerHTML = `
        <div class="cc-integ-foot-left">
          <div class="cc-integ-account cc-integ-account--off">Not connected</div>
          <div class="cc-last-synced"></div>
        </div>
        <div class="cc-integ-foot-right">
          <button class="cc-btn" data-action="gcal-connect">Connect Google Calendar</button>
        </div>`;
    }
  }

  // Enable or disable gated settings rows based on connection state
  root.querySelectorAll('[data-gcal-gated]').forEach(rowEl => {
    rowEl.classList.toggle('cc-row--disabled', !connected);
    rowEl.setAttribute('aria-disabled', connected ? 'false' : 'true');
    rowEl.querySelectorAll('input').forEach(el => { el.disabled = !connected; });
  });
}

// Selectors for the page-level background sweep. Inline styles set via JS beat
// Canvas's CSS cascade (and survive React re-renders if we re-apply on mutation).
const BG_TARGETS = [
  // Top-level layout containers
  'body', '.ic-app', '#wrapper', '#main', '#not_right_side',
  '#content', '#content-wrapper', '#dashboard', '.ic-dashboard-app',
  '#right-side', '#right-side-wrapper',
  '.ic-Layout-wrapper', '.ic-Layout-columns',
  '.ic-Layout-contentWrapper', '.ic-Layout-contentMain',
  '.ic-app-main-content', '.ic-app-main-content__primary', '.ic-app-main-content__secondary',

  // Dashboard — Card View
  '#DashboardCard_Container', '.ic-DashboardCard__box',
  '.ic-Dashboard-header__layout',
  '[class*="Dashboard-header__layout"]',
  '[class*="ic-Dashboard-header"]',

  // Dashboard — List View (Planner): sweep the containers but NOT individual
  // items (.PlannerItem, .Day) — those have their own CSS-var rules so the
  // user can set them independently of the page background.
  '.PlannerApp', '.PlannerHeader',

  // Dashboard — Recent Activity
  '#dashboard-activity', '.ic-Dashboard-Activity',

  // Course / sub-page chrome (breadcrumbs + sticky course title toolbar)
  'nav#breadcrumbs',
  '.breadcrumbs',
  '.header-bar-outer-container',
  '.sticky-toolbar',
  '.header-bar',
  '.page-toolbar',
  '#course_home_content',
  '#wiki_page_show',
  '#course_show_secondary',
  '.course-menu',
];

// Sidebar list items that Canvas paints with a fade-out gradient.
// We clear background-image and re-set background-color to match.
// (The actual right-fade is on `.event-details::after` — handled in CSS,
// since pseudo-elements can't be touched via element.style.)
const FEEDBACK_TARGETS = [
  '#right-side .events_list',
  '#right-side .events_list li',
  '#right-side .recent_feedback',
  '#right-side .recent_feedback li',
  '#right-side .recent_feedback_icon',
  '#right-side a.recent_feedback_icon',
  '#right-side .event-details',
  '#right-side .Sidebar__RecentFeedbackContainer',
  '#right-side .Sidebar__RecentFeedbackContainer li',
  '#right-side .Sidebar__TodoListContainer',
  '#right-side .Sidebar__TodoListContainer li',
  '#right-side section li',
  '#right-side .ToDoSidebarItem',
  '#right-side [class*="recent"] li',
  '#right-side [class*="Recent"] li',
  '#right-side [class*="feedback"] li',
  '#right-side [class*="Feedback"] li',
];

let lastAppliedBg = null;

// Pre-join selector lists so the DOM sweep runs as two querySelectorAll
// calls instead of ~70. Invalid selectors would break the whole string, so
// we keep the try/catch for safety.
const BG_SELECTOR = BG_TARGETS.join(',');
const FEEDBACK_SELECTOR = FEEDBACK_TARGETS.join(',');
const ALL_BG_SELECTOR = `${BG_SELECTOR},${FEEDBACK_SELECTOR}`;

function clearBgInline() {
  try {
    document.querySelectorAll(ALL_BG_SELECTOR).forEach(el => {
      el.style.removeProperty('background-color');
      el.style.removeProperty('background-image');
    });
  } catch {}
}

function applyBgInline() {
  if (!document.body) return; // document_start — body not parsed yet
  const color = settings.extensionEnabled ? settings.bgColor : '';
  if (!color) {
    if (lastAppliedBg) {
      clearBgInline();
      lastAppliedBg = null;
    }
    return;
  }
  try {
    document.querySelectorAll(BG_SELECTOR).forEach(el => {
      el.style.setProperty('background-color', color, 'important');
    });
  } catch {}
  try {
    document.querySelectorAll(FEEDBACK_SELECTOR).forEach(el => {
      el.style.setProperty('background-image', 'none', 'important');
      el.style.setProperty('background-color', color, 'important');
    });
  } catch {}
  lastAppliedBg = color;
}


// All data attributes we set on <html>. Used by the disable tear-down to
// remove every override the extension applies.
const CC_DATA_ATTRS = [
  'ccCardShadow', 'ccCardImage', 'ccCardBg', 'ccCardText',
  'ccSidebarRestyle', 'ccSidebarLabels', 'ccSidebarLabelPos', 'ccDensity',
  'ccBgColor', 'ccBgImage', 'ccTextColor', 'ccFont',
  'ccSidebarBg', 'ccSidebarText', 'ccSidebarActive', 'ccSidebarActiveText',
  'ccDashboardView', 'ccDarkMode',
  'ccHideScrollbars', 'ccMinimalScrollbars',
  'ccPlannerItemBg', 'ccPlannerItemText',
  'ccPlannerDayBg', 'ccPlannerDayText',
  'ccPlannerLayout', 'ccPlannerDoneStyle',
  'ccPlannerEmphasizeToday', 'ccPlannerHideEmptyDays', 'ccPlannerHideActivity',
  'ccActivityItemBg',
];
const CC_CSS_VARS = [
  '--cc-card-radius', '--cc-card-image-opacity', '--cc-card-header-height',
  '--cc-card-bg', '--cc-card-text',
  '--cc-sidebar-icon-size', '--cc-sidebar-label-size',
  '--cc-accent',
  '--cc-bg-color', '--cc-bg-image', '--cc-bg-blur',
  '--cc-text-color', '--cc-font-family', '--cc-modal-accent',
  '--cc-sidebar-bg', '--cc-sidebar-text', '--cc-sidebar-active', '--cc-sidebar-active-text',
  '--cc-planner-item-bg', '--cc-planner-item-text',
  '--cc-planner-bar-width', '--cc-planner-item-spacing', '--cc-planner-done-opacity',
  '--cc-planner-day-bg', '--cc-planner-day-text',
  '--cc-activity-item-bg',
];

function tearDownOverrides() {
  const root = document.documentElement;
  clearBgInline();
  for (const k of CC_DATA_ATTRS) delete root.dataset[k];
  for (const v of CC_CSS_VARS) root.style.removeProperty(v);
  syncGlobalNavToggleControls(false);
  const w = document.getElementById(WIDGET_ID);
  if (w) w.remove();
  removeGradesWidgetHost(true);
  restoreNativeRecentFeedback();
}

function applySettings(s) {
  const root = document.documentElement;
  const sidebarDefaults = detectSidebarColors();

  // Master kill switch — tear everything down and bail.
  if (!s.extensionEnabled) {
    tearDownOverrides();
    return;
  }

  const set = (k, v) => root.style.setProperty(k, v);
  // For optional color settings: when the user supplied a value, set the CSS
  // var and mark the data attr 'on'; otherwise clear the var and mark 'off'
  // (CSS rules fall back to Canvas defaults).
  const setOptionalVar = (cssVar, dataKey, value) => {
    if (value) {
      set(cssVar, value);
      root.dataset[dataKey] = 'on';
    } else {
      root.style.removeProperty(cssVar);
      root.dataset[dataKey] = 'off';
    }
  };

  set('--cc-card-radius', s.cardRadius + 'px');
  set('--cc-card-image-opacity', String(s.cardImageOpacity));
  set('--cc-card-header-height', s.cardHeaderHeight + 'px');

  set('--cc-sidebar-icon-size', s.sidebarIconSize + 'px');
  set('--cc-sidebar-label-size', s.sidebarLabelSize + 'px');
  set('--cc-sidebar-bg', s.sidebarBgColor || sidebarDefaults.bg || '#2d3b45');
  set('--cc-sidebar-text', s.sidebarTextColor || sidebarDefaults.text || '#ffffff');
  set('--cc-sidebar-active', s.sidebarActiveColor || sidebarDefaults.activeBg || 'rgba(255, 255, 255, 0.18)');
  set('--cc-sidebar-active-text', s.sidebarActiveTextColor || sidebarDefaults.activeText || sidebarDefaults.text || '#ffffff');

  set('--cc-accent', s.accentColor);

  set('--cc-bg-color', s.bgColor || 'transparent');
  set('--cc-bg-image', s.bgImage ? `url("${s.bgImage.replace(/"/g, '\\"')}")` : 'none');
  set('--cc-bg-blur', s.bgBlur + 'px');

  set('--cc-modal-accent', s.modalAccentColor || '#fc5050');
  set('--cc-text-color', s.textColor || 'inherit');
  const fontStack = s.fontFamily && s.fontFamily !== 'default'
    ? (s.fontFamily === 'system'
        ? 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
        : `"${s.fontFamily}", -apple-system, BlinkMacSystemFont, sans-serif`)
    : 'inherit';
  set('--cc-font-family', fontStack);
  if (s.fontFamily && s.fontFamily !== 'default' && s.fontFamily !== 'system') {
    ensurePageFont(s.fontFamily);
  }
  syncGlobalNavToggleControls();

  root.dataset.ccCardShadow = s.cardShadow;
  root.dataset.ccCardImage = s.cardShowImage ? 'shown' : 'hidden';

  setOptionalVar('--cc-card-bg', 'ccCardBg', s.cardBgColor);
  setOptionalVar('--cc-card-text', 'ccCardText', s.cardTextColor);
  root.dataset.ccSidebarRestyle = s.sidebarRestyle ? 'on' : 'off';
  root.dataset.ccSidebarLabels = s.sidebarShowLabels ? 'on' : 'off';
  root.dataset.ccDensity = s.density;
  root.dataset.ccBgColor = s.bgColor ? 'on' : 'off';
  root.dataset.ccBgImage = s.bgImage ? 'on' : 'off';
  root.dataset.ccTextColor = s.textColor ? 'on' : 'off';
  root.dataset.ccFont = (s.fontFamily && s.fontFamily !== 'default') ? 'on' : 'off';
  root.dataset.ccSidebarBg = s.sidebarBgColor ? 'on' : 'off';
  root.dataset.ccSidebarText = s.sidebarTextColor ? 'on' : 'off';
  root.dataset.ccSidebarActive = s.sidebarActiveColor ? 'on' : 'off';
  root.dataset.ccSidebarActiveText = s.sidebarActiveTextColor ? 'on' : 'off';

  // Always-on numeric planner vars (no data-attr gate needed — CSS uses them with fallbacks)
  set('--cc-planner-bar-width', s.plannerBarWidth + 'px');
  set('--cc-planner-item-spacing', s.plannerItemSpacing + 'px');
  set('--cc-planner-done-opacity', (s.plannerDoneOpacity / 100).toFixed(2));

  setOptionalVar('--cc-planner-item-bg', 'ccPlannerItemBg', s.plannerItemBg);
  setOptionalVar('--cc-planner-item-text', 'ccPlannerItemText', s.plannerItemTextColor);
  setOptionalVar('--cc-planner-day-bg', 'ccPlannerDayBg', s.plannerDayBg);
  setOptionalVar('--cc-planner-day-text', 'ccPlannerDayText', s.plannerDayTextColor);
  setOptionalVar('--cc-activity-item-bg', 'ccActivityItemBg', s.activityItemBg);

  // Planner behavior — enum + toggles gate CSS rules via data attributes
  root.dataset.ccPlannerLayout = ['cards', 'rows', 'compact', 'grouped'].includes(s.plannerLayout)
    ? s.plannerLayout : 'cards';
  root.dataset.ccPlannerDoneStyle = ['fade', 'strikethrough', 'hide'].includes(s.plannerDoneStyle)
    ? s.plannerDoneStyle : 'fade';
  root.dataset.ccPlannerEmphasizeToday = s.plannerEmphasizeToday ? 'on' : 'off';
  root.dataset.ccPlannerHideEmptyDays = 'off';
  root.dataset.ccPlannerHideActivity = s.plannerHideActivity ? 'on' : 'off';

  root.dataset.ccDarkMode = s.darkMode ? 'on' : 'off';
  root.dataset.ccHideScrollbars = s.hideScrollBars ? 'on' : 'off';
  root.dataset.ccMinimalScrollbars = s.minimalScrollbars ? 'on' : 'off';
  root.dataset.ccSidebarLabelPos = ['bottom', 'right'].includes(s.sidebarLabelPosition)
    ? s.sidebarLabelPosition
    : (s.sidebarLabelPosition === 'left' ? 'right' : 'bottom');

  // Belt-and-suspenders: also paint backgrounds via inline styles, which
  // bypass Canvas's CSS cascade entirely.
  applyBgInline();
  removeLegacySidebarIcons();
}

// ---------- weekly tasks widget ----------

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const daysFromMonday = (day + 6) % 7;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - daysFromMonday);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return { start: monday, end: nextMonday };
}

function formatDue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} ${time}`;
}

async function fetchPlannerItems() {
  const { start, end } = getWeekRange();
  const params = new URLSearchParams({
    start_date: start.toISOString(),
    end_date: end.toISOString(),
    per_page: '100',
  });
  const res = await fetch(`/api/v1/planner/items?${params}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Planner API ${res.status}`);
  return res.json();
}

// Convert a hex color to an rgba string at the given alpha. Used for ring
// tracks so each ring's empty portion is a tinted version of its own color
// instead of a flat neutral gray.
function hexToRgba(hex, alpha) {
  if (!hex || typeof hex !== 'string') return `rgba(148, 163, 184, ${alpha})`;
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return `rgba(148, 163, 184, ${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(n => Number.isNaN(n))) return `rgba(148, 163, 184, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

let courseColorCache = null;
async function fetchCourseColors() {
  if (courseColorCache) return courseColorCache;
  try {
    const res = await fetch('/api/v1/users/self/colors', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`colors ${res.status}`);
    const data = await res.json();
    // data.custom_colors is a map like { course_123: "#ff0000", ... }
    courseColorCache = data.custom_colors || {};
  } catch {
    courseColorCache = {};
  }
  return courseColorCache;
}

let cardGradesPromise = null;
async function fetchCardGrades() {
  if (cardGradesPromise) return cardGradesPromise;
  const params = new URLSearchParams();
  params.append('include[]', 'concluded');
  params.append('include[]', 'total_scores');
  params.append('include[]', 'computed_current_score');
  params.append('include[]', 'current_grading_period_scores');
  params.set('per_page', '100');
  cardGradesPromise = fetch(`/api/v1/courses?${params.toString()}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
    .then(async res => {
      if (!res.ok) throw new Error(`grades ${res.status}`);
      return res.json();
    })
    .then(courses => {
      const gradeMap = new Map();
      for (const course of Array.isArray(courses) ? courses : []) {
        const enrollment = Array.isArray(course?.enrollments) ? course.enrollments.find(Boolean) : null;
        if (!enrollment) continue;
        const rawScore = enrollment.has_grading_periods
          ? enrollment.current_period_computed_current_score
          : enrollment.computed_current_score;
        const score = Number(rawScore);
        if (!Number.isFinite(score)) continue;
        gradeMap.set(Number(course.id), score);
      }
      return gradeMap;
    })
    .catch(err => {
      console.warn('[CustomCanvas] card grades unavailable', err);
      return new Map();
    });
  return cardGradesPromise;
}

function getCardCourseId(card) {
  const link = card.querySelector('.ic-DashboardCard__link');
  if (!link?.href) return null;
  try {
    const url = new URL(link.href, location.origin);
    const match = url.pathname.match(/\/courses\/(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function formatCardGrade(score) {
  if (!Number.isFinite(score)) return null;
  const rounded = Math.round(score * 10) / 10;
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${label}%`;
}

async function injectCardGrades() {
  const cards = document.querySelectorAll('.ic-DashboardCard');
  if (!cards.length) return;
  const grades = await fetchCardGrades();
  cards.forEach(card => {
    const existing = card.querySelector('.cc-card-grade-tag');
    const courseId = getCardCourseId(card);
    const label = courseId != null ? formatCardGrade(grades.get(courseId)) : null;
    if (!label || courseId == null) {
      existing?.remove();
      return;
    }
    const host = card.querySelector('.ic-DashboardCard__header') || card.querySelector('.ic-DashboardCard__header_hero');
    if (!host) return;
    const tag = existing || document.createElement('a');
    tag.className = 'cc-card-grade-tag';
    tag.textContent = label;
    tag.href = `/courses/${courseId}/grades`;
    tag.setAttribute('aria-label', `Open course grades (${label})`);
    if (tag.parentElement !== host) host.appendChild(tag);
  });
}

function courseColorFor(task, colors, fallbackIndex) {
  // planner items give us context_type/id via plannable_date, but we need the contextName -> color mapping.
  // The /colors endpoint keys look like "course_<id>". task.contextCode on the planner item is typically "course_<id>".
  if (task.contextCode && colors[task.contextCode]) return colors[task.contextCode];
  const palette = ['#fc5050', '#008ee2', '#00c389', '#f59e0b', '#9333ea', '#ec4899', '#14b8a6', '#64748b'];
  return palette[fallbackIndex % palette.length];
}

function isComplete(item) {
  if (item.planner_override?.marked_complete) return true;
  if (item.planner_override?.dismissed) return true;
  const subs = item.submissions;
  if (subs && typeof subs === 'object') {
    if (subs.submitted || subs.excused || subs.graded) return true;
  }
  return false;
}

const RELEVANT_TYPES = new Set([
  'assignment', 'quiz', 'discussion_topic', 'wiki_page', 'planner_note', 'announcement',
]);

const TYPE_LABEL = {
  assignment: 'Assignment',
  quiz: 'Quiz',
  discussion_topic: 'Discussion',
  wiki_page: 'Page',
  planner_note: 'Note',
  announcement: 'Announcement',
};

function getPreviewCacheKey({ courseId, plannableId, type }) {
  return `${type || 'unknown'}_${courseId || 'none'}_${plannableId || 'none'}`;
}

function normalizePreviewData(data, type) {
  if (!data) return null;
  const title = data.title || data.name || 'Untitled';
  const description = data.description || data.message || data.body || data.details || '';
  return {
    ...data,
    type,
    title,
    name: data.name || title,
    description,
  };
}

function seedPreviewCacheFromPlannerItem(item) {
  if (!item?.plannable_type || item?.plannable_id == null) return;
  const key = getPreviewCacheKey({
    courseId: item.course_id || item.context_id || null,
    plannableId: item.plannable_id,
    type: item.plannable_type,
  });
  const seeded = normalizePreviewData({
    title: item.plannable?.title || item.plannable?.name || 'Untitled',
    description: item.plannable?.description || item.plannable?.message || item.plannable?.body || item.description || '',
    points_possible: item.plannable?.points_possible,
  }, item.plannable_type);
  const existing = previewCache.get(key);
  if (!existing || (!existing.description && seeded?.description)) {
    previewCache.set(key, { ...existing, ...seeded });
  }
}

function normalize(items, s = settings) {
  let mapped = items
    .filter(it => RELEVANT_TYPES.has(it.plannable_type))
    .filter(it => !(s.widgetHideAnnouncements && it.plannable_type === 'announcement'))
    .filter(it => !(s.widgetHideDiscussions && it.plannable_type === 'discussion_topic'))
    .map(it => {
      seedPreviewCacheFromPlannerItem(it);
      // contextCode pairs context_type with whichever ID is populated. Canvas
      // planner items sometimes ship only course_id, sometimes only context_id
      // (when context_type === 'Course').
      let contextCode = '';
      if (it.context_type && it.course_id) contextCode = `course_${it.course_id}`;
      else if (it.context_type === 'Course' && it.context_id) contextCode = `course_${it.context_id}`;
      return {
        id: `${it.plannable_type}-${it.plannable_id}`,
        plannableId: it.plannable_id,
        courseId: it.course_id || it.context_id || null,
        title: it.plannable?.title || it.plannable?.name || 'Untitled',
        dueAt: it.plannable?.due_at || it.plannable?.todo_date || it.plannable_date,
        url: it.html_url || '#',
        contextName: it.context_name || '',
        contextCode,
        complete: isComplete(it),
        type: it.plannable_type,
      };
    });

  if (!s.widgetShowCompleted) mapped = mapped.filter(t => !t.complete);

  mapped.sort((a, b) => {
    switch (s.widgetSortBy) {
      case 'course':
        return (a.contextName || '').localeCompare(b.contextName || '');
      case 'type':
        return (a.type || '').localeCompare(b.type || '');
      case 'status':
      case 'dueDate':
      default:
        if (a.complete !== b.complete) return a.complete ? 1 : -1;
        return new Date(a.dueAt || 0) - new Date(b.dueAt || 0);
    }
  });

  return mapped;
}

function applyFilter(tasks, filter) {
  const now = Date.now();
  const h24 = now + 24 * 60 * 60 * 1000;
  const weekEnd = endOfWeekTs(now);
  switch (filter) {
    case 'overdue':
      return tasks.filter(t => !t.complete && t.dueAt && new Date(t.dueAt).getTime() < now);
    case 'due_soon':
      return tasks.filter(t => !t.complete && t.dueAt && new Date(t.dueAt).getTime() >= now && new Date(t.dueAt).getTime() <= h24);
    case 'due_week':
      return tasks.filter(t => {
        if (t.complete || !t.dueAt) return false;
        const due = new Date(t.dueAt).getTime();
        return !Number.isNaN(due) && due > h24 && due <= weekEnd;
      });
    case 'this_week':
    case 'all':
    default:
      return tasks;
  }
}

function endOfWeekTs(now = Date.now()) {
  const date = new Date(now);
  const day = date.getDay();
  const daysUntilEnd = 6 - day;
  date.setDate(date.getDate() + daysUntilEnd);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function taskUrgency(task, now = Date.now()) {
  if (task.complete || !task.dueAt) return 'none';
  const due = new Date(task.dueAt).getTime();
  if (Number.isNaN(due)) return 'none';
  if (due < now) return 'overdue';
  if (due <= now + (24 * 60 * 60 * 1000)) return 'due_soon';
  if (due <= endOfWeekTs(now)) return 'due_week';
  return 'none';
}

function defaultWidgetSectionState() {
  return {
    overdue: false,
    due_soon: false,
    due_week: false,
    all: false,
  };
}

let widgetSectionState = defaultWidgetSectionState();

function widgetSections(tasks, colors = {}) {
  if (settings.widgetGroupBy === 'course') return widgetSectionsByCourse(tasks, colors);
  const overdue = applyFilter(tasks, 'overdue');
  const dueSoon = applyFilter(tasks, 'due_soon');
  const dueWeek = applyFilter(tasks, 'due_week');
  const sections = [
    {
      key: 'overdue',
      label: 'Overdue',
      note: 'Past due and open.',
      empty: 'No overdue tasks.',
      tasks: overdue,
    },
    {
      key: 'due_soon',
      label: 'Due Soon',
      note: 'Within 24 hours.',
      empty: 'Nothing due soon.',
      tasks: dueSoon,
    },
    {
      key: 'due_week',
      label: 'This Week',
      note: 'Due before Sunday.',
      empty: 'Nothing else due this week.',
      tasks: dueWeek,
    },
    {
      key: 'all',
      label: 'All',
      note: 'Everything in this view.',
      empty: 'Nothing due this week.',
      tasks,
    },
  ];
  const defaults = defaultWidgetSectionState();
  return sections.map(section => ({
    ...section,
    open: widgetSectionState[section.key] ?? defaults[section.key] ?? false,
  }));
}

function widgetSectionsByCourse(tasks, colors = {}) {
  const groups = groupByCourse(tasks);
  return groups.map((group, i) => {
    const key = `course__${group.name}`;
    return {
      key,
      label: group.name,
      empty: 'No tasks for this course.',
      tasks: group.tasks,
      color: courseColorFor({ contextCode: group.contextCode }, colors, i),
      open: widgetSectionState[key] ?? false,
    };
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function groupByCourse(tasks) {
  const map = new Map();
  for (const t of tasks) {
    const name = t.contextName || t.course || 'Other';
    const key = t.contextCode || name || 'other';
    if (!map.has(key)) {
      map.set(key, {
        key,
        name,
        contextCode: t.contextCode,
        total: 0,
        done: 0,
        tasks: [],
      });
    }
    const g = map.get(key);
    g.total++;
    if (t.complete) g.done++;
    g.tasks.push(t);
  }
  return Array.from(map.values());
}

function widgetSectionStyle(section) {
  if (!section?.color) return '';
  const color = section.color;
  return [
    `--cc-section-bg:${hexToRgba(color, 0.10)}`,
    `--cc-section-bg-dark:${hexToRgba(color, 0.14)}`,
    `--cc-preview-section-bg:${hexToRgba(color, 0.10)}`,
    `--cc-preview-section-bg-dark:${hexToRgba(color, 0.14)}`,
  ].join(';');
}

// Cap visible rings at 3 — keeps each ring thick, the spacing legible, and
// leaves a generous center region for the percentage text. Extra courses
// still show in the legend.
const MAX_VISIBLE_RINGS = 3;

function activityRingsSvg(groups, colors) {
  const size = 168;
  const cx = size / 2;
  const cy = size / 2;
  const strokeW = 10;
  const gap = 3;
  const maxR = (size / 2) - (strokeW / 2) - 4;
  // With 3 rings at gap 3: r1=75, r2=62, r3=49. Innermost stroke spans 44-54.
  // Empty inner space r<44 → 88px diameter. 56x56 center box sits with
  // ~16px margin on each side from the innermost ring's inner edge.

  const sliced = groups.slice(0, MAX_VISIBLE_RINGS);
  const rings = sliced.map((g, i) => {
    const r = maxR - i * (strokeW + gap);
    if (r < strokeW) return '';
    const c = 2 * Math.PI * r;
    const pct = g.total === 0 ? 0 : Math.min(1, g.done / g.total);
    const offset = c * (1 - pct);
    const color = courseColorFor({ contextCode: g.contextCode }, colors, i);
    const trackStroke = hexToRgba(color, 0.18);
    const delay = (i * 120).toFixed(0);
    return `
      <circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="none" stroke="${trackStroke}" stroke-width="${strokeW}"/>
      <circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${c.toFixed(2)}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})" class="cc-progress-arc" style="--arc-c:${c.toFixed(2)};--arc-offset:${offset.toFixed(2)};animation-delay:${delay}ms"/>
    `;
  }).join('');

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${rings}</svg>`;
}

function activityRingsMarkup(groups, colors, totalPct, done, total, showFraction) {
  if (groups.length === 0) {
    return `<div class="cc-progress-rings-empty">No tasks this week</div>`;
  }
  const legend = groups.map((g, i) => {
    const color = courseColorFor({ contextCode: g.contextCode }, colors, i);
    const inRing = i < MAX_VISIBLE_RINGS;
    return `
      <div class="cc-ring-legend-item${inRing ? '' : ' cc-ring-legend-extra'}">
        <span class="cc-ring-legend-dot" style="background:${color}"></span>
        <span class="cc-ring-legend-name">${escapeHtml(g.name)}</span>
        <span class="cc-ring-legend-count">${g.done}/${g.total}</span>
      </div>
    `;
  }).join('');
  const ringFraction = showFraction
    ? `<div class="cc-fraction cc-fraction--ring">${done}/${total}</div>`
    : '';
  return `
    <div class="cc-progress-rings">
      <div class="cc-progress-rings-svg">
        ${activityRingsSvg(groups, colors)}
        <div class="cc-progress-rings-center">
          <div class="cc-progress-rings-pct">${totalPct}%</div>
          ${ringFraction}
        </div>
      </div>
      <div class="cc-progress-rings-legend">${legend}</div>
    </div>
  `;
}

function circleProgressMarkup(pct, done, total, showFraction) {
  const barColor = settings.widgetProgressColor || '#6366f1';
  const trackColor = hexToRgba(barColor, 0.18);
  const size = 120;
  const strokeW = 10;
  const r = (size / 2) - (strokeW / 2) - 2;
  const cx = size / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  const fraction = showFraction ? `<div class="cc-fraction cc-fraction--circle">${done}/${total}</div>` : '';
  return `
    <div class="cc-progress-circle">
      <div class="cc-progress-circle-svg" style="width:${size}px;height:${size}px;">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
          <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${trackColor}" stroke-width="${strokeW}"/>
          <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${barColor}" stroke-width="${strokeW}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${c.toFixed(2)}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cx})" class="cc-progress-arc" style="--arc-c:${c.toFixed(2)};--arc-offset:${offset.toFixed(2)}"/>
        </svg>
        <div class="cc-progress-circle-center">
          <div class="cc-progress-circle-pct">${pct}%</div>
          ${fraction}
        </div>
      </div>
    </div>
  `;
}

function progressMarkup(style, done, total, pct, tasks, colors, showFraction) {
  if (style === 'ring') {
    const groups = groupByCourse(tasks);
    return activityRingsMarkup(groups, colors || {}, pct, done, total, showFraction);
  }
  if (style === 'circle') return circleProgressMarkup(pct, done, total, showFraction);

  const barColor = settings.widgetProgressColor || '#6366f1';
  if (style === 'segments') {
    const n = total || 1;
    const segs = Array.from({ length: n }, (_, i) => `<div class="cc-progress-seg${i < done ? ' done' : ''}"${i < done ? ` style="background:${barColor}"` : ''}></div>`).join('');
    return `
      <div class="cc-progress-segments">${segs}</div>
      <div class="cc-progress-label">${pct}% complete</div>
    `;
  }
  return `
    <div class="cc-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
      <div class="cc-progress-bar" style="width:${pct}%;background:${barColor}"></div>
    </div>
    <div class="cc-progress-label">${pct}% complete</div>
  `;
}

function taskItemMarkup(task, now = Date.now()) {
  const urgency = taskUrgency(task, now);
  const dueClass = urgency === 'overdue'
    ? ' cc-task-due--overdue'
    : urgency === 'due_soon'
      ? ' cc-task-due--soon'
      : urgency === 'due_week'
        ? ' cc-task-due--week'
      : '';
  return `
    <li class="cc-task ${task.complete ? 'cc-done' : ''}"
        data-urgency="${urgency}"
        data-plannable-id="${task.plannableId != null ? task.plannableId : ''}"
        data-course-id="${task.courseId != null ? escapeHtml(String(task.courseId)) : ''}"
        data-plannable-type="${escapeHtml(task.type)}">
      <a href="${escapeHtml(task.url)}" class="cc-task-link">
        <div class="cc-task-row">
          <span class="cc-check" aria-hidden="true">${task.complete ? '✓' : ''}</span>
          <div class="cc-task-body">
            <div class="cc-task-title">${escapeHtml(task.title)}</div>
            <div class="cc-task-meta">
              <span class="cc-task-course">${escapeHtml(task.contextName)}</span>
              <span class="cc-task-sep">•</span>
              <span class="cc-task-type">${TYPE_LABEL[task.type] || task.type}</span>
              ${task.dueAt ? `<span class="cc-task-sep">•</span><span class="cc-task-due${dueClass}">${escapeHtml(formatDue(task.dueAt))}</span>` : ''}
            </div>
          </div>
        </div>
      </a>
    </li>
  `;
}

function widgetSectionMarkup(section, now = Date.now()) {
  const listHtml = section.tasks.length === 0
    ? `<li class="cc-section-empty">${section.empty}</li>`
    : section.tasks.map(task => taskItemMarkup(task, now)).join('');
  const panelId = `cc-section-panel-${section.key}`;
  const style = widgetSectionStyle(section);

  return `
    <section class="cc-section-card${section.open ? ' is-open' : ' is-collapsed'}" data-section="${section.key}"${section.color ? ' data-course-colorized="true"' : ''}${style ? ` style="${style}"` : ''}>
      <button class="cc-section-toggle" data-section="${section.key}" type="button" aria-expanded="${section.open ? 'true' : 'false'}" aria-controls="${panelId}">
        <span class="cc-section-label">${section.label}</span>
        <span class="cc-section-right">
          <span class="cc-section-count">${section.tasks.length}</span>
          <span class="cc-section-chevron" aria-hidden="true">
            <svg viewBox="0 0 20 20" focusable="false"><path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </span>
      </button>
      <div class="cc-section-panel-wrap">
        <div class="cc-section-panel" id="${panelId}" aria-hidden="${section.open ? 'false' : 'true'}"${section.open ? '' : ' inert'}>
          <ul class="cc-section-list">${listHtml}</ul>
        </div>
      </div>
    </section>
  `;
}

function setWidgetSectionExpanded(sectionEl, open) {
  if (!sectionEl) return;
  sectionEl.classList.toggle('is-open', open);
  sectionEl.classList.toggle('is-collapsed', !open);
  const toggle = sectionEl.querySelector('.cc-section-toggle');
  const panel = sectionEl.querySelector('.cc-section-panel');
  toggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (panel) {
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    panel.inert = !open;
    if (open) panel.removeAttribute('inert');
    else panel.setAttribute('inert', '');
  }
}

function renderWidget(container, tasks, colors) {
  const total = tasks.length;
  const done = tasks.filter(t => t.complete).length;
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  const style = settings.widgetProgressStyle || 'bar';
  const now = Date.now();
  const sections = widgetSections(tasks, colors);

  const showFraction = !!settings.widgetShowFraction;
  // In course grouping, keep every course card visible; in priority grouping,
  // hide sections with zero tasks so the widget only shows actionable buckets.
  const byCourse = settings.widgetGroupBy === 'course';
  const visibleSections = byCourse ? sections : sections.filter(s => s.tasks.length > 0);
  const sectionsHtml = visibleSections.length > 0
    ? visibleSections.map(section => widgetSectionMarkup(section, now)).join('')
    : `<div class="cc-all-empty">No tasks due this week.</div>`;

  // Header count is redundant when a fraction is already displayed near the progress element
  const hideHeaderCount = style === 'ring' || style === 'bar' || style === 'circle';
  container.innerHTML = `
    <div class="cc-widget" data-style="${style}">
      <div class="cc-header">
        <h2 class="cc-title">This Week</h2>
        ${hideHeaderCount ? '' : `<span class="cc-count">${done}/${total}</span>`}
      </div>
      ${progressMarkup(style, done, total, pct, tasks, colors, showFraction)}
      <div class="cc-sections">${sectionsHtml}</div>
    </div>
  `;
}

let inFlight = false;
let lastWidgetRaw = null; // { items, colors } — cached for instant re-renders

async function injectWidget() {
  if (!settings.extensionEnabled) return;
  if (!settings.widgetEnabled) return;
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);
  if (!sidebar) {
    document.getElementById(WIDGET_ID)?.remove();
    removeGradesWidgetHost(true);
    return;
  }

  const onCourseGradesPage = isCourseGradesPage();
  const native = sidebar.querySelector(NATIVE_SELECTOR);
  const gradesContent = sidebar.querySelector('#student-grades-right-content');
  const existing = document.getElementById(WIDGET_ID);

  if (existing) {
    if (onCourseGradesPage) {
      const host = ensureGradesWidgetHost(sidebar);
      if (host && existing.parentElement !== host) host.append(existing);
    } else {
      if (existing.parentElement !== sidebar) {
        if (native) native.replaceWith(existing);
        else sidebar.append(existing);
      }
      // Canvas can re-render #student-grades-right-content after our widget was
      // appended, pushing grades content to the bottom. Re-anchor on every tick.
      if (gradesContent && (existing.compareDocumentPosition(gradesContent) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        gradesContent.after(existing);
      }
      removeGradesWidgetHost();
    }
    return;
  }

  const container = document.createElement('div');
  container.id = WIDGET_ID;
  container.innerHTML = `<div class="cc-widget"><div class="cc-header"><h2 class="cc-title">This Week</h2></div><div class="cc-skeleton-loader" aria-hidden="true"><div class="cc-sk-bar cc-sk-bar--wide"></div><div class="cc-sk-bar cc-sk-bar--medium"></div><div class="cc-sk-bar cc-sk-bar--narrow"></div></div></div>`;
  container.addEventListener('click', (e) => {
    const toggle = e.target.closest('.cc-section-toggle');
    if (!toggle) return;
    const sectionKey = toggle.dataset.section;
    if (!sectionKey) return;
    const defaults = defaultWidgetSectionState();
    const nextOpen = !(widgetSectionState[sectionKey] ?? defaults[sectionKey] ?? false);
    widgetSectionState[sectionKey] = nextOpen;
    setWidgetSectionExpanded(toggle.closest('.cc-section-card'), nextOpen);
  });

  if (onCourseGradesPage) {
    const host = ensureGradesWidgetHost(sidebar);
    (host || sidebar).append(container);
  } else if (native) native.replaceWith(container);
  else if (gradesContent) gradesContent.after(container);
  else sidebar.append(container);

  if (inFlight) return;
  inFlight = true;
  try {
    const [items, colors] = await Promise.all([
      fetchPlannerItems(),
      fetchCourseColors(),
    ]);
    lastWidgetRaw = { items, colors };
    const tasks = normalize(items);
    const live = document.getElementById(WIDGET_ID);
    if (live) renderWidget(live, tasks, colors);
  } catch (err) {
    const live = document.getElementById(WIDGET_ID);
    if (live) live.querySelector('.cc-widget').innerHTML += `<div class="cc-error">Failed to load: ${escapeHtml(err.message)}</div>`;
  } finally {
    inFlight = false;
  }
}

function getRecentFeedbackNativeHost() {
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);
  if (!sidebar) return null;

  const modern = sidebar.querySelector('.Sidebar__RecentFeedbackContainer');
  if (modern) return modern.closest('section') || modern;

  const legacy = sidebar.querySelector('.recent_feedback');
  if (legacy) return legacy.closest('section') || legacy;

  return Array.from(sidebar.querySelectorAll('section')).find(section => {
    const text = (section.textContent || '').trim();
    return /recent feedback/i.test(text) && section.querySelector('li');
  }) || null;
}

function getRecentFeedbackList(host) {
  if (!host) return null;
  if (host.matches('ul, ol')) return host;
  return host.querySelector('.Sidebar__RecentFeedbackContainer, .recent_feedback, ul, ol');
}

function hideNativeRecentFeedback(host) {
  if (!host) return;
  if (host.dataset.ccRecentFeedbackHidden !== 'true') {
    host.dataset.ccPrevDisplay = host.style.display || '';
  }
  host.style.setProperty('display', 'none', 'important');
  host.dataset.ccRecentFeedbackHidden = 'true';
}

function restoreNativeRecentFeedback() {
  const host = getRecentFeedbackNativeHost();
  if (host?.dataset.ccRecentFeedbackHidden === 'true') {
    const prevDisplay = host.dataset.ccPrevDisplay || '';
    if (prevDisplay) host.style.display = prevDisplay;
    else host.style.removeProperty('display');
    delete host.dataset.ccPrevDisplay;
    delete host.dataset.ccRecentFeedbackHidden;
  }
  const widget = document.getElementById(RECENT_FEEDBACK_WIDGET_ID);
  if (widget) widget.remove();
}

function extractRecentFeedbackItems(host) {
  const list = getRecentFeedbackList(host);
  if (!list) return [];

  return Array.from(list.querySelectorAll('li')).map((li, index) => {
    const iconLink = li.querySelector('a.recent_feedback_icon, [class*="recent_feedback_icon"]');
    const detailRoot = li.querySelector('.event-details') || li;
    const allLinks = Array.from(li.querySelectorAll('a[href]'));
    const primaryLink = allLinks.find(link => link !== iconLink && (link.textContent || '').trim()) || allLinks[0] || null;
    const rawText = (detailRoot.innerText || detailRoot.textContent || li.innerText || '')
      .split(/\n+/)
      .map(part => part.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    let title = (primaryLink?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!title) title = rawText[0] || 'Feedback';

    const detailLines = rawText.slice();
    const titleIndex = detailLines.findIndex(line => line === title);
    if (titleIndex !== -1) detailLines.splice(titleIndex, 1);

    return {
      id: `${index}-${primaryLink?.href || title}`,
      href: primaryLink?.href || iconLink?.href || '#',
      title,
      detail: detailLines.join(' - '),
      iconHtml: iconLink?.innerHTML || '',
    };
  }).filter(item => item.title || item.detail);
}

function recentFeedbackWidgetMarkup(items, opts = {}) {
  const showDetails = opts.showDetails ?? settings.recentFeedbackShowDetails;
  const hasMore = items.length > FEEDBACK_SHOW_LIMIT;
  const hiddenCount = items.length - FEEDBACK_SHOW_LIMIT;

  return `
    <div class="cc-feedback-widget" data-show-details="${showDetails ? 'on' : 'off'}">
      <div class="cc-feedback-header">
        <h2 class="cc-feedback-title">Recent Feedback</h2>
        <span class="cc-feedback-count">${items.length}</span>
      </div>
      ${items.length === 0 ? `
        <div class="cc-feedback-empty">No recent feedback yet.</div>
      ` : `
        <div class="cc-feedback-list">
          ${items.map((item, i) => `
            <a class="cc-feedback-item${i >= FEEDBACK_SHOW_LIMIT ? ' cc-feedback-hidden' : ''}" href="${escapeHtml(item.href)}">
              <span class="cc-feedback-body">
                <span class="cc-feedback-item-title">${escapeHtml(item.title)}</span>
                ${showDetails && item.detail ? `<span class="cc-feedback-item-detail">${escapeHtml(item.detail)}</span>` : ''}
              </span>
            </a>
          `).join('')}
        </div>
        ${hasMore ? `<button class="cc-feedback-show-all" type="button">Show ${hiddenCount} more</button>` : ''}
      `}
    </div>
  `;
}

function recentFeedbackSignature(items) {
  return [
    settings.recentFeedbackShowDetails ? '1' : '0',
    ...items.map(item => `${item.title}|${item.detail}|${item.href}|${item.iconHtml.length}`),
  ].join('||');
}

function syncRecentFeedbackWidget() {
  const existing = document.getElementById(RECENT_FEEDBACK_WIDGET_ID);
  if (!settings.extensionEnabled || !settings.recentFeedbackEnabled) {
    restoreNativeRecentFeedback();
    return;
  }

  const host = getRecentFeedbackNativeHost();
  if (!host) {
    if (existing) existing.remove();
    return;
  }

  hideNativeRecentFeedback(host);
  const items = extractRecentFeedbackItems(host);
  const signature = recentFeedbackSignature(items);
  const container = existing || document.createElement('div');
  container.id = RECENT_FEEDBACK_WIDGET_ID;
  if (!existing) host.before(container);
  if (container.dataset.renderSignature === signature) return;
  container.dataset.renderSignature = signature;
  container.innerHTML = recentFeedbackWidgetMarkup(items);
  const showAllBtn = container.querySelector('.cc-feedback-show-all');
  if (showAllBtn) {
    showAllBtn.addEventListener('click', () => {
      container.querySelectorAll('.cc-feedback-hidden').forEach(el => el.classList.remove('cc-feedback-hidden'));
      showAllBtn.remove();
    });
  }
}

// ---------- modal ----------

const TABS = [
  { id: 'general',      label: 'General' },
  { id: 'cards',        label: 'Cards' },
  { id: 'listview',     label: 'List' },
  { id: 'sidebar',      label: 'Sidebar' },
  { id: 'widget',       label: 'To Do' },
  { id: 'recentfeedback', label: 'Feedback' },
  { id: 'integrations', label: 'Integrations' },
];

let currentTab = 'general';

// Open/close a custom dropdown, keeping aria state in sync. On open, wait
// for the expansion transition to finish then scroll the shell into view if
// any part would be clipped by the controls column.
function setSelectState(el, open) {
  const trigger = el.querySelector('.cc-select-trigger');
  if (open) {
    el.classList.add('open');
    trigger?.setAttribute('aria-expanded', 'true');
    // Wait for the 250ms grid-template-rows transition to settle.
    setTimeout(() => {
      if (el.classList.contains('open')) scrollSelectIntoView(el);
    }, 280);
  } else {
    el.classList.remove('open');
    trigger?.setAttribute('aria-expanded', 'false');
  }
}

// Smooth-scroll the .cc-controls-col so the given shell is fully visible,
// preferring to center it vertically when it overflows.
function scrollSelectIntoView(el) {
  const col = el.closest('.cc-controls-col');
  if (!col) return;
  const selRect = el.getBoundingClientRect();
  const colRect = col.getBoundingClientRect();
  const pad = 16;
  const fullyVisible =
    selRect.top >= colRect.top + pad &&
    selRect.bottom <= colRect.bottom - pad;
  if (fullyVisible) return;
  // Try to center; if the shell is taller than the column, anchor top.
  const selCenter = selRect.top + selRect.height / 2;
  const colCenter = colRect.top + colRect.height / 2;
  let delta = selCenter - colCenter;
  if (selRect.height > colRect.height - pad * 2) {
    delta = selRect.top - (colRect.top + pad);
  }
  col.scrollBy({ top: delta, behavior: 'smooth' });
}

function ensureFont() {
  if (document.getElementById('cc-font-sora')) return;
  const preconnect1 = document.createElement('link');
  preconnect1.rel = 'preconnect';
  preconnect1.href = 'https://fonts.googleapis.com';
  const preconnect2 = document.createElement('link');
  preconnect2.rel = 'preconnect';
  preconnect2.href = 'https://fonts.gstatic.com';
  preconnect2.crossOrigin = 'anonymous';
  const link = document.createElement('link');
  link.id = 'cc-font-sora';
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap';
  document.head.append(preconnect1, preconnect2, link);
}

// Lazy-load a Google Font for the user's page-wide font preference.
function ensurePageFont(family) {
  if (!family || family === 'default' || family === 'system') return;
  if (!document.head) {
    // document_start — head doesn't exist yet. Retry when ready.
    document.addEventListener('DOMContentLoaded', () => ensurePageFont(family), { once: true });
    return;
  }
  const id = 'cc-page-font-' + family.replace(/\s+/g, '-');
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

function removeLegacySidebarIcons() {
  document.querySelectorAll('.cc-nav-icon').forEach(el => el.remove());
  document.querySelectorAll('.cc-icon-hidden').forEach(el => el.classList.remove('cc-icon-hidden'));
}

// ---------- assignment previews (hover tooltip) ----------

const previewCache = new Map();
const PREVIEW_HOVER_DELAY_MS = 500;
let previewTimer = null;
let tooltipEl = null;
let currentHoverTask = null;

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function buildTooltip(data) {
  const desc = data.description ? stripHtml(data.description) : '';
  const pts = data.points_possible != null ? `${data.points_possible} pts` : '';
  const meta = data.type && TYPE_LABEL[data.type] ? TYPE_LABEL[data.type] : '';
  const chips = [
    meta ? `<span class="cc-tooltip-chip">${escapeHtml(meta)}</span>` : '',
    pts ? `<span class="cc-tooltip-chip cc-tooltip-chip--accent">${escapeHtml(pts)}</span>` : '',
  ].join('');
  return `
    <div class="cc-tooltip-title">${escapeHtml(data.name || data.title || 'Assignment')}</div>
    ${chips ? `<div class="cc-tooltip-meta">${chips}</div>` : ''}
    ${desc ? `<div class="cc-tooltip-desc">${escapeHtml(desc)}${data.description && data.description.length > 160 ? '...' : ''}</div>` : ''}
  `;
}

function getPreviewEndpoint(courseId, plannableId, type) {
  if (!courseId || plannableId == null) return null;
  if (type === 'assignment') return `/api/v1/courses/${courseId}/assignments/${plannableId}`;
  if (type === 'quiz') return `/api/v1/courses/${courseId}/quizzes/${plannableId}`;
  if (type === 'announcement' || type === 'discussion_topic') {
    return `/api/v1/courses/${courseId}/discussion_topics/${plannableId}`;
  }
  return null;
}

function showTooltip(taskEl, html) {
  hideTooltip();
  tooltipEl = document.createElement('div');
  tooltipEl.id = 'cc-preview-tooltip';
  tooltipEl.innerHTML = html;
  document.body.appendChild(tooltipEl);
  const rect = taskEl.getBoundingClientRect();
  const ttW = tooltipEl.offsetWidth || 280;
  const ttH = tooltipEl.offsetHeight || 72;
  let top = rect.top - ttH - 6;
  if (rect.top - ttH - 6 < 8) top = rect.bottom + 6;
  let left = rect.left + ((rect.width - ttW) / 2);
  if (left + ttW > window.innerWidth - 8) left = window.innerWidth - ttW - 8;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  tooltipEl.style.top = top + 'px';
  tooltipEl.style.left = left + 'px';
  requestAnimationFrame(() => { if (tooltipEl) tooltipEl.classList.add('visible'); });
}

function hideTooltip() {
  clearTimeout(previewTimer);
  previewTimer = null;
  if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
}

let tooltipsAttached = false;
function attachTooltipListeners() {
  if (tooltipsAttached) return;
  tooltipsAttached = true;
  document.addEventListener('mouseover', (e) => {
    if (!settings.assignmentPreviewsEnabled) { hideTooltip(); return; }
    const taskEl = e.target.closest?.('#cc-weekly-tasks .cc-task');
    if (taskEl === currentHoverTask) return;
    currentHoverTask = taskEl;
    clearTimeout(previewTimer);
    hideTooltip();
    if (!taskEl) return;
    const courseId = taskEl.dataset.courseId;
    const plannableId = taskEl.dataset.plannableId;
    const type = taskEl.dataset.plannableType;
    if (!plannableId || !type) return;
    previewTimer = setTimeout(async () => {
      const key = getPreviewCacheKey({ courseId, plannableId, type });
      let data = previewCache.get(key);
      const endpoint = getPreviewEndpoint(courseId, plannableId, type);
      if (endpoint && (!data || (!data.description && data.points_possible == null))) {
        try {
          const res = await fetch(endpoint, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
          if (res.ok) {
            data = normalizePreviewData({ ...(data || {}), ...(await res.json()) }, type);
            previewCache.set(key, data);
          }
        } catch {}
      }
      if (data && currentHoverTask === taskEl) showTooltip(taskEl, buildTooltip(data));
    }, PREVIEW_HOVER_DELAY_MS);
  });
  document.addEventListener('mouseout', (e) => {
    const taskEl = e.target.closest?.('#cc-weekly-tasks .cc-task');
    if (!taskEl) return;
    const next = e.relatedTarget;
    if (next && taskEl.contains(next)) return;
    currentHoverTask = null;
    hideTooltip();
  });
  window.addEventListener('scroll', hideTooltip, true);
}

// ---------- command palette ----------

const PALETTE_ID = 'cc-palette-root';
const PALETTE_SHORTCUT_ICONS = {
  navigate: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 2l2.5 2.5H9v7h1.5L8 14 5.5 11.5H7v-7H5.5L8 2z" fill="currentColor"/></svg>',
  open: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 3h10v10H3z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5 8h6M8 5l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 4.5h10M5 8h6M6 11.5h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};
let paletteData = null;
let paletteOpen = false;
let paletteSearchDebounce = null;

function setPaletteBackgroundInteractivity(disabled) {
  const root = document.getElementById(PALETTE_ID);
  Array.from(document.body.children).forEach((el) => {
    if (el === root) return;
    if (disabled) {
      el.dataset.ccPalettePrevInert = el.inert ? 'true' : 'false';
      el.inert = true;
      return;
    }
    if (!('ccPalettePrevInert' in el.dataset)) return;
    if (el.dataset.ccPalettePrevInert !== 'true') el.inert = false;
    delete el.dataset.ccPalettePrevInert;
  });
  document.documentElement.classList.toggle('cc-palette-locked', disabled);
}

function weekStart() {
  const { start } = getWeekRange();
  return start.toISOString().split('T')[0];
}

function weeksAhead(n) {
  const { start } = getWeekRange();
  const d = new Date(start);
  d.setDate(d.getDate() + n * 7);
  return d.toISOString().split('T')[0];
}

async function fetchPaletteData() {
  try {
    const stored = await new Promise(r => chrome.storage.local.get('ccPalette', d => r(d.ccPalette)));
    if (stored && Date.now() - stored.ts < 3_600_000) { paletteData = stored; return; }
    const [courses, items] = await Promise.all([
      fetch('/api/v1/courses?enrollment_state=active&per_page=50', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(r => r.json()),
      fetch(`/api/v1/planner/items?start_date=${weekStart()}&end_date=${weeksAhead(8)}&per_page=100`, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(r => r.json()),
    ]);
    paletteData = {
      ts: Date.now(),
      courses: Array.isArray(courses)
        ? courses
            .filter(c => c.workflow_state === 'available' && !c.access_restricted_by_date)
            .map(c => ({ id: c.id, name: c.name || c.course_code || '', url: `/courses/${c.id}` }))
        : [],
      assignments: Array.isArray(items)
        ? items
            .filter(it => RELEVANT_TYPES.has(it.plannable_type))
            .map(it => ({
              id: it.plannable_id,
              title: it.plannable?.title || it.plannable?.name || 'Untitled',
              courseId: it.course_id,
              courseName: it.context_name || '',
              url: it.html_url || '#',
              type: it.plannable_type,
              complete: isComplete(it),
            }))
        : [],
    };
    chrome.storage.local.set({ ccPalette: paletteData });
  } catch (e) {
    console.warn('[CustomCanvas] palette prefetch failed', e);
  }
}

function searchPalette(query) {
  if (!paletteData || !query.trim()) return [];
  const q = query.toLowerCase().trim();
  const results = [];
  for (const c of paletteData.courses) {
    const name = (c.name || '').toLowerCase();
    const score = name.startsWith(q) ? 3 : name.includes(q) ? 1 : 0;
    if (score > 0) results.push({ type: 'course', name: c.name, subtitle: '', url: c.url, score });
  }
  for (const a of paletteData.assignments) {
    const name = (a.title || '').toLowerCase();
    const cn = (a.courseName || '').toLowerCase();
    const score = name.startsWith(q) ? 3 : name.includes(q) ? 1 : cn.includes(q) ? 0.5 : 0;
    if (score > 0) results.push({ type: 'assignment', name: a.title, subtitle: a.courseName, url: a.url, score, atype: a.type, complete: a.complete });
  }
  results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return results.slice(0, 12);
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx)) +
    `<mark class="cc-pal-highlight">${escapeHtml(text.slice(idx, idx + query.length))}</mark>` +
    escapeHtml(text.slice(idx + query.length));
}

function renderPaletteResults(results, query) {
  const list = document.getElementById('cc-palette-list');
  if (!list) return;
  if (!results.length) {
    list.innerHTML = `<div class="cc-pal-empty">${query ? 'No results.' : 'Type to search courses and assignments...'}</div>`;
    return;
  }
  let html = '';
  let lastType = null;
  results.forEach((r, i) => {
    if (r.type !== lastType) {
      lastType = r.type;
      html += `<div class="cc-pal-section-header">${r.type === 'course' ? 'Courses' : 'Assignments'}</div>`;
    }
    const statusBadge = r.type === 'assignment'
      ? `<span class="cc-pal-status${r.complete ? ' is-complete' : ''}">${r.complete ? 'Complete' : 'Open'}</span>`
      : '';
    html += `
      <button class="cc-pal-item${i === 0 ? ' cc-pal-active' : ''}" data-url="${escapeHtml(r.url)}" data-idx="${i}" type="button">
        <div class="cc-pal-text">
          <div class="cc-pal-name">${highlightMatch(r.name, query)}</div>
          ${r.subtitle ? `<div class="cc-pal-sub">${escapeHtml(r.subtitle)}</div>` : ''}
        </div>
        <span class="cc-pal-meta">
          ${statusBadge}
          <span class="cc-pal-badge">${r.type === 'course' ? 'Course' : (TYPE_LABEL[r.atype] || 'Task')}</span>
        </span>
      </button>`;
  });
  list.innerHTML = html;
}

function buildPalette() {
  if (document.getElementById(PALETTE_ID)) return;
  const root = document.createElement('div');
  root.id = PALETTE_ID;
  root.innerHTML = `
    <div class="cc-pal-backdrop"></div>
    <div id="cc-palette">
      <div class="cc-pal-search-row">
        <svg class="cc-pal-search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input id="cc-palette-input" type="text" placeholder="Search courses and assignments..." autocomplete="off" spellcheck="false">
      </div>
      <div id="cc-palette-list">
        <div class="cc-pal-empty">Type to search courses and assignments...</div>
      </div>
      <div class="cc-pal-footer">
        <span class="cc-pal-footer-hint"><span class="cc-pal-key cc-pal-key--icon">${PALETTE_SHORTCUT_ICONS.navigate}</span><span>Navigate</span></span>
        <span class="cc-pal-footer-hint"><span class="cc-pal-key cc-pal-key--icon">${PALETTE_SHORTCUT_ICONS.open}</span><span>Open</span></span>
        <span class="cc-pal-footer-hint"><span class="cc-pal-key cc-pal-key--icon">${PALETTE_SHORTCUT_ICONS.close}</span><span>Close</span></span>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const input = root.querySelector('#cc-palette-input');
  const list  = root.querySelector('#cc-palette-list');
  root.querySelector('.cc-pal-backdrop').addEventListener('click', closePalette);

  input.addEventListener('input', () => {
    clearTimeout(paletteSearchDebounce);
    paletteSearchDebounce = setTimeout(() => {
      const results = searchPalette(input.value);
      renderPaletteResults(results, input.value.trim());
    }, 80);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
      return;
    }

    const items = list.querySelectorAll('.cc-pal-item');
    if (!items.length) return;
    const active = list.querySelector('.cc-pal-item.cc-pal-active');
    let idx = active ? parseInt(active.dataset.idx || '0', 10) : -1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = Math.min(idx + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = Math.max(idx - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active?.dataset.url) { location.href = active.dataset.url; closePalette(); }
      return;
    } else {
      return;
    }
    items.forEach(item => item.classList.toggle('cc-pal-active', parseInt(item.dataset.idx, 10) === idx));
    const next = list.querySelector(`.cc-pal-item[data-idx="${idx}"]`);
    next?.scrollIntoView({ block: 'nearest' });
  });

  list.addEventListener('mousemove', (e) => {
    const item = e.target.closest('.cc-pal-item');
    if (!item) return;
    list.querySelectorAll('.cc-pal-item').forEach(node => node.classList.toggle('cc-pal-active', node === item));
  });

  list.addEventListener('click', (e) => {
    const item = e.target.closest('.cc-pal-item');
    if (item?.dataset.url) { location.href = item.dataset.url; closePalette(); }
  });
}

function openPalette() {
  buildPalette();
  const root = document.getElementById(PALETTE_ID);
  if (!root) return;
  root.classList.add('open');
  paletteOpen = true;
  setPaletteBackgroundInteractivity(true);
  const input = root.querySelector('#cc-palette-input');
  if (input) { input.value = ''; input.focus(); }
  renderPaletteResults([], '');
}

function closePalette() {
  const root = document.getElementById(PALETTE_ID);
  if (root) root.classList.remove('open');
  paletteOpen = false;
  setPaletteBackgroundInteractivity(false);
}

function buildModal() {
  if (document.getElementById(MODAL_ID)) return;
  ensureFont();

  const root = document.createElement('div');
  root.id = MODAL_ID;
  root.className = 'cc-modal-root';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="cc-modal-backdrop"></div>
    <div class="cc-modal" role="dialog" aria-modal="true" aria-labelledby="cc-modal-title">
      <header class="cc-modal-header">
        <div class="cc-modal-brand">
          <div class="cc-modal-logo">CC</div>
          <h1 id="cc-modal-title">Custom Canvas</h1>
        </div>
        <button class="cc-modal-close" aria-label="Close customization panel">×</button>
      </header>
      <div class="cc-modal-body">
        <nav class="cc-modal-tabs" role="tablist">
          <div class="cc-tabs-list">
            ${TABS.map(t => `
              <button role="tab" data-tab="${t.id}" class="cc-tab ${t.id === currentTab ? 'active' : ''}">${t.label}</button>
            `).join('')}
          </div>
          <button class="cc-modal-reset" id="cc-reset-btn" type="button">Reset</button>
        </nav>
        <div class="cc-modal-pane" role="tabpanel"></div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // Wire up event handlers
  root.querySelector('.cc-modal-close').addEventListener('click', closeModal);
  root.querySelector('.cc-modal-backdrop').addEventListener('click', closeModal);
  root.querySelectorAll('.cc-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      root.querySelectorAll('.cc-tab').forEach(b => b.classList.toggle('active', b === btn));
      renderTabPane();
    });
  });
  root.querySelector('#cc-reset-btn').addEventListener('click', async () => {
    if (!confirm('Reset all customizations to defaults?')) return;
    await chrome.storage.sync.clear();
    settings = { ...DEFAULTS };
    applySettings(settings);
    renderTabPane();
  });

  // ESC closes the modal (or an open dropdown first)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const openSelect = root.querySelector('.cc-select.open');
    if (openSelect) {
      setSelectState(openSelect, false);
      return;
    }
    if (root.classList.contains('open')) closeModal();
  });

  // Click outside any open dropdown closes it
  root.addEventListener('click', (e) => {
    const openSelects = root.querySelectorAll('.cc-select.open');
    openSelects.forEach(s => {
      if (!s.contains(e.target)) setSelectState(s, false);
    });
  });

  renderTabPane();
}

function openModal() {
  buildModal();
  const root = document.getElementById(MODAL_ID);
  root.classList.add('open');
  root.setAttribute('aria-hidden', 'false');
  document.documentElement.classList.add('cc-modal-locked');
}

function closeModal() {
  const root = document.getElementById(MODAL_ID);
  if (!root) return;
  root.classList.remove('open');
  root.setAttribute('aria-hidden', 'true');
  document.documentElement.classList.remove('cc-modal-locked');
}

function toggleModal() {
  const root = document.getElementById(MODAL_ID);
  if (root && root.classList.contains('open')) closeModal();
  else openModal();
}

// ---------- tab content ----------

function row(label, control, hint = '', extraAttrs = '') {
  return `
    <div class="cc-row" ${extraAttrs}>
      <div class="cc-row-label">
        <div class="cc-row-title">${label}</div>
        ${hint ? `<div class="cc-row-hint">${hint}</div>` : ''}
      </div>
      <div class="cc-row-control">${control}</div>
    </div>
  `;
}

function rangeControl(key, min, max, step, suffix = '') {
  const v = settings[key];
  return `<input type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${v}"><span class="cc-range-value">${v}${suffix}</span>`;
}

function selectControl(key, options) {
  const v = settings[key];
  const current = options.find(o => String(o.value) === String(v)) || options[0];
  const chevron = `<svg class="cc-select-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7.5l5 5 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `
    <div class="cc-select" data-setting="${key}" data-value="${escapeHtml(String(current.value))}">
      <button type="button" class="cc-select-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span class="cc-select-label">${escapeHtml(current.label)}</span>
        ${chevron}
      </button>
      <div class="cc-select-menu-wrap">
        <div class="cc-select-menu" role="listbox">
          ${options.map(o => `
            <button type="button" role="option" class="cc-select-option ${String(o.value) === String(current.value) ? 'selected' : ''}" data-value="${escapeHtml(String(o.value))}">${escapeHtml(o.label)}</button>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function toggleControl(key) {
  return `<label class="cc-toggle"><input type="checkbox" data-setting="${key}" ${settings[key] ? 'checked' : ''}><span class="cc-toggle-track"><span class="cc-toggle-thumb"></span></span></label>`;
}

function colorControl(key, fallback = '#000000') {
  return `<input type="color" data-setting="${key}" value="${settings[key] || fallback}">`;
}

const TAB_CONTROL_GATES = {
  sidebar: {
    masterKey: 'sidebarRestyle',
    exemptKeys: new Set(['sidebarRestyle']),
  },
  widget: {
    masterKey: 'widgetEnabled',
    exemptKeys: new Set(['widgetEnabled']),
  },
  recentfeedback: {
    masterKey: 'recentFeedbackEnabled',
    exemptKeys: new Set(['recentFeedbackEnabled']),
  },
};

function syncControlAvailability(root = document.getElementById(MODAL_ID)) {
  if (!root) return;
  const pane = root.querySelector('.cc-modal-pane');
  if (!pane) return;

  const gate = TAB_CONTROL_GATES[currentTab];
  const gateEnabled = !gate || !!settings[gate.masterKey];

  pane.querySelectorAll('.cc-row').forEach(rowEl => {
    const settingKeys = Array.from(rowEl.querySelectorAll('[data-setting]'))
      .map(el => el.dataset.setting)
      .filter(Boolean);

    const shouldDisable = !gateEnabled &&
      settingKeys.length > 0 &&
      settingKeys.some(key => !gate.exemptKeys.has(key));

    rowEl.classList.toggle('cc-row--disabled', shouldDisable);
    rowEl.setAttribute('aria-disabled', shouldDisable ? 'true' : 'false');

    rowEl.querySelectorAll('input').forEach(input => {
      input.disabled = shouldDisable;
    });

    rowEl.querySelectorAll('.cc-select').forEach(select => {
      const trigger = select.querySelector('.cc-select-trigger');
      const options = select.querySelectorAll('.cc-select-option');
      select.classList.toggle('cc-select--disabled', shouldDisable);
      if (shouldDisable) setSelectState(select, false);
      if (trigger) trigger.disabled = shouldDisable;
      options.forEach(option => {
        option.disabled = shouldDisable;
      });
    });
  });
}

// ---------- Color detection utilities for picker fallbacks ----------
// When a color setting is empty, the picker needs a prefilled value that
// reflects the ACTUAL current rendered color, not a guess. We read from the
// live DOM at render time.

function parseRgbString(s) {
  if (!s) return null;
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (!m) return null;
  return [+m[1], +m[2], +m[3], m[4] != null ? +m[4] : 1];
}

function rgbToHex(input) {
  const p = parseRgbString(input);
  if (!p) return null;
  const [r, g, b] = p;
  const toHex = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

// Blend a translucent rgba over an opaque backdrop rgb to get the visible color.
function flattenColor(fg, bg) {
  const f = parseRgbString(fg);
  const b = parseRgbString(bg);
  if (!f) return bg || fg;
  if (!b) return fg;
  if (f[3] >= 1) return fg;
  const a = f[3];
  const r = a * f[0] + (1 - a) * b[0];
  const g = a * f[1] + (1 - a) * b[1];
  const bl = a * f[2] + (1 - a) * b[2];
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(bl)})`;
}

// Walk up the DOM to find the first ancestor with an opaque background.
function findOpaqueAncestorBg(el) {
  let cur = el;
  while (cur && cur !== document.documentElement) {
    const cs = getComputedStyle(cur);
    const p = parseRgbString(cs.backgroundColor);
    if (p && p[3] >= 1) return cs.backgroundColor;
    cur = cur.parentElement;
  }
  return 'rgb(255, 255, 255)';
}

// Canvas frequently paints the visible nav-link color onto a child span
// (e.g. `.menu-item__text`) rather than the <a> itself. Reading
// getComputedStyle(link).color therefore returns a stale value that doesn't
// match what the user sees. Walk the link's text-bearing descendants and
// prefer the deepest element that actually holds the label.
function readLinkTextColor(link) {
  if (!link) return null;
  const candidates = [
    link.querySelector('.menu-item__text'),
    link.querySelector('[class*="menu-item__text"]'),
    link.querySelector('.menu-item__badge-container + div'),
    // Fallback: last element child that contains non-whitespace text.
    ...Array.from(link.querySelectorAll('div, span')).reverse(),
  ].filter(Boolean);
  for (const el of candidates) {
    const txt = (el.textContent || '').trim();
    if (!txt) continue;
    const hex = rgbToHex(getComputedStyle(el).color);
    if (hex) return hex;
  }
  return rgbToHex(getComputedStyle(link).color);
}

// Walk from the link outward (the <a>, its <li>, and any wrapping container)
// and return the first non-transparent background encountered, flattened over
// the nearest opaque ancestor. This catches Canvas variants that style the
// active state on the <li> instead of the <a>.
function readActiveBgColor(activeLink) {
  if (!activeLink) return null;
  const chain = [activeLink, activeLink.parentElement, activeLink.parentElement?.parentElement].filter(Boolean);
  const backdrop = findOpaqueAncestorBg(activeLink.parentElement);
  for (const el of chain) {
    const bg = getComputedStyle(el).backgroundColor;
    const parsed = parseRgbString(bg);
    if (!parsed) continue;
    if (parsed[3] === 0) continue; // fully transparent — keep walking
    const flat = flattenColor(bg, backdrop);
    const hex = rgbToHex(flat);
    if (hex) return hex;
  }
  return null;
}

// Read each sidebar color from the live DOM. Returns hex strings or null.
function detectSidebarColors() {
  const header = document.querySelector('#header.ic-app-header, .ic-app-header');
  const bgColor = header ? rgbToHex(getComputedStyle(header).backgroundColor) : null;

  // Prefer an inactive link for the base text color so an `--active` override
  // doesn't pollute the reading.
  const inactiveLink = document.querySelector(
    '.ic-app-header__menu-list-item:not(.ic-app-header__menu-list-item--active) .ic-app-header__menu-list-link'
  ) || document.querySelector('.ic-app-header__menu-list-link');
  const textColor = readLinkTextColor(inactiveLink);

  const activeLink = document.querySelector(
    '.ic-app-header__menu-list-item--active .ic-app-header__menu-list-link, ' +
    '.ic-app-header__menu-list-link[aria-current="page"]'
  );
  const activeBgColor = readActiveBgColor(activeLink);
  const activeTextColor = readLinkTextColor(activeLink);

  return {
    bg: bgColor || '#2d3b45',
    text: textColor || '#ffffff',
    activeBg: activeBgColor || '#ffffff',
    activeText: activeTextColor || textColor || '#ffffff',
  };
}

function syncGlobalNavToggleControls(forceHide = settings.extensionEnabled && settings.sidebarRestyle && settings.sidebarLabelPosition === 'right') {
  const header = document.querySelector('#header.ic-app-header, .ic-app-header');
  if (!header) return;

  header.querySelectorAll('button, a, [role="button"]').forEach(el => {
    const label = [
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
      el.textContent || '',
    ].join(' ').toLowerCase().replace(/\s+/g, ' ').trim();

    const isGlobalNavToggle =
      label.includes('exit global navigation') ||
      label.includes('minimize global navigation') ||
      label.includes('collapse global navigation');

    if (!isGlobalNavToggle) return;

    if (forceHide) {
      if (!el.dataset.ccPrevDisplay) el.dataset.ccPrevDisplay = el.style.display || '';
      if (!el.dataset.ccPrevTabindex) el.dataset.ccPrevTabindex = el.getAttribute('tabindex') ?? '';
      el.style.display = 'none';
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('tabindex', '-1');
      el.dataset.ccGlobalNavToggleHidden = 'true';
      return;
    }

    if (el.dataset.ccGlobalNavToggleHidden !== 'true') return;
    el.style.display = el.dataset.ccPrevDisplay || '';
    if (el.dataset.ccPrevTabindex === '') el.removeAttribute('tabindex');
    else el.setAttribute('tabindex', el.dataset.ccPrevTabindex);
    el.removeAttribute('aria-hidden');
    delete el.dataset.ccGlobalNavToggleHidden;
    delete el.dataset.ccPrevDisplay;
    delete el.dataset.ccPrevTabindex;
  });
}

function textControl(key, placeholder = '') {
  return `<input type="text" data-setting="${key}" value="${escapeHtml(settings[key] || '')}" placeholder="${escapeHtml(placeholder)}">`;
}

function tabGeneral() {
  return {
    title: 'General',
    desc: 'Page-level appearance for the whole Canvas interface.',
    preview: null,
    groups: [
      { title: 'Extension', rows: [
        row('Enable Custom Canvas', toggleControl('extensionEnabled'), 'Master switch. Turn off to restore Canvas defaults everywhere.'),
        row('Dark Mode', toggleControl('darkMode'), 'Force a dark theme across all Canvas pages.'),
      ]},
      { title: 'Productivity', rows: [
        row('Command Palette', toggleControl('commandPaletteEnabled'), 'Press Ctrl+K (or ⌘K) to search active courses and assignments from this week through the next 8 weeks.'),
      ]},
      { title: 'Scroll Bars', rows: [
        row('Minimal Scroll Bars', toggleControl('minimalScrollbars'), 'Replaces all scroll bars with a slim rounded thumb — no arrows, no background track. Applies to the whole page.'),
        row('Hide Scroll Bars', toggleControl('hideScrollBars'), 'Hides nested vertical and horizontal scroll bars while keeping the main page scroll bar visible.'),
      ]},
      { title: 'Background', rows: [
        row('Color', colorControl('bgColor', '#ffffff'), 'Leave default to keep Canvas\'s background.'),
        row('Image URL', textControl('bgImage', 'https://...'), 'Paste a direct image URL.'),
        row('Image Blur', rangeControl('bgBlur', 0, 20, 1, 'px')),
      ]},
      { title: 'Text', rows: [
        row('Color', colorControl('textColor', '#2d3b45'), 'Override Canvas\'s body text color.'),
      ]},
      { title: 'Font', rows: [
        row('Family', selectControl('fontFamily', [
          { value: 'default', label: 'Default' },
          { value: 'system', label: 'System UI' },
          { value: 'Inter', label: 'Inter' },
          { value: 'Sora', label: 'Sora' },
          { value: 'Roboto', label: 'Roboto' },
          { value: 'Lato', label: 'Lato' },
          { value: 'Poppins', label: 'Poppins' },
          { value: 'Open Sans', label: 'Open Sans' },
          { value: 'Nunito', label: 'Nunito' },
          { value: 'Source Sans 3', label: 'Source Sans' },
          { value: 'Merriweather', label: 'Merriweather (serif)' },
        ]), 'Loaded from Google Fonts on first use.'),
      ]},
      { title: 'Modal', rows: [
        row('Accent Color', colorControl('modalAccentColor', '#fc5050'), 'Used for active tab text, selected dropdown options, toggles, and sliders inside this modal.'),
      ]},
    ],
  };
}

function previewCards() {
  // Each card: course color, image gradient, full name (colored), short code (gray), term, action icons
  const assignIcon = `<svg viewBox="0 0 1920 1920" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M1807 1920H113C50.9 1920 0 1869.1 0 1807V113C0 50.9 50.9 0 113 0h1694c62.1 0 113 50.9 113 113v1694c0 62.1-50.9 113-113 113zm-56.5-169.5v-1581H169.5v1581h1581zM338 1468.5h1244v169.5H338v-169.5zm0-338h1244v169.5H338V1130zm0-338h1244v169.5H338V792zm0-338h1244v169.5H338V454z"/></svg>`;
  const discIcon  = `<svg viewBox="0 0 1920 1920" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M1920 1468.5c0 62-50.9 112.9-113 112.9h-338v225.8c0 62.1-50.9 113-113 113-30 0-58.6-11.9-79.7-33L831.6 1581.4H113C50.9 1581.4 0 1530.5 0 1468.5V113C0 50.9 50.9 0 113 0h1694c62.1 0 113 50.9 113 113v1355.5z"/></svg>`;
  const cards = [
    { name: 'Linear Algebra',    code: 'MATH 314',  term: 'Spring 2026', color: '#0084c7', img: 'linear-gradient(160deg,#0084c7 0%,#00c389 100%)', grade: '97%', icons: [assignIcon, discIcon] },
    { name: 'Database Design',   code: 'CSCE 451',  term: 'Spring 2026', color: '#9c27b0', img: 'linear-gradient(160deg,#9c27b0 0%,#ff5722 100%)', grade: '91%', icons: [assignIcon] },
    { name: 'Business Strategy', code: 'MGMT 411',  term: 'Spring 2026', color: '#e67e22', img: 'linear-gradient(160deg,#e67e22 0%,#f1c40f 100%)', grade: '95%', icons: [assignIcon, discIcon] },
    { name: 'Discrete Math',     code: 'MATH 208',  term: 'Spring 2026', color: '#16a085', img: 'linear-gradient(160deg,#16a085 0%,#2ecc71 100%)', grade: '89%', icons: [assignIcon] },
    { name: 'Operating Systems', code: 'CSCE 351',  term: 'Spring 2026', color: '#c0392b', img: 'linear-gradient(160deg,#c0392b 0%,#d35400 100%)', grade: '93%', icons: [assignIcon, discIcon] },
    { name: 'World History',     code: 'HIST 201',  term: 'Spring 2026', color: '#2c3e50', img: 'linear-gradient(160deg,#2c3e50 0%,#7f8c8d 100%)', grade: '98%', icons: [assignIcon] },
  ];
  return `
    <div class="cc-preview-card-grid">
      ${cards.map(c => `
        <div class="cc-preview-card">
          <div class="cc-preview-card-header" style="background:${c.color};">
            <div class="cc-preview-card-grade">${c.grade}</div>
            <div class="cc-preview-card-image" style="background-image:${c.img};"></div>
          </div>
          <div class="cc-preview-card-body">
            <div class="cc-preview-card-name" style="color:${c.color};">${c.name}</div>
            <div class="cc-preview-card-code">${c.code}</div>
            <div class="cc-preview-card-term">${c.term}</div>
          </div>
          <div class="cc-preview-card-footer">
            ${c.icons.map(ic => `<span class="cc-preview-card-icon" style="color:#6b7780;">${ic}</span>`).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function tabCards() {
  return {
    title: 'Card View',
    desc: 'Customize how course cards look on the Card View dashboard.',
    preview: previewCards(),
    groups: [
      { title: 'Colors', rows: [
        row('Background', colorControl('cardBgColor', '#ffffff'), 'Background of each card body. Leave unset to use Canvas\'s default.'),
        row('Text Color', colorControl('cardTextColor', '#2d3b45'), 'Text on each card. Leave unset to use Canvas\'s default.'),
        row('Accent Color', colorControl('accentColor', '#008ee2'), 'Used for links, buttons, and progress bars.'),
      ]},
      { title: 'Shape', rows: [
        row('Corner Radius', rangeControl('cardRadius', 0, 24, 1, 'px'), 'Applies to cards and planner items.'),
        row('Shadow', selectControl('cardShadow', [
          { value: 'none', label: 'None' },
          { value: 'soft', label: 'Soft' },
          { value: 'strong', label: 'Strong' },
        ]), 'Applies to cards and planner items.'),
      ]},
      { title: 'Image', rows: [
        row('Show Card Image', toggleControl('cardShowImage'), 'Card View only. Hide to show only the course color block.'),
        row('Image Opacity', rangeControl('cardImageOpacity', 0, 1, 0.05), 'Card View only.'),
      ]},
      { title: 'Layout', rows: [
        row('Header Height', rangeControl('cardHeaderHeight', 60, 200, 5, 'px'), 'Card View only.'),
      ]},
    ],
  };
}

function previewListView() {
  const assignSvg = `<svg viewBox="0 0 1920 1920" width="13" height="13" fill="currentColor"><path d="M1807 1920H113C50.9 1920 0 1869.1 0 1807V113C0 50.9 50.9 0 113 0h1694c62.1 0 113 50.9 113 113v1694c0 62.1-50.9 113-113 113zm-56.5-169.5v-1581H169.5v1581h1581zM338 1468.5h1244v169.5H338v-169.5zm0-338h1244v169.5H338V1130zm0-338h1244v169.5H338V792zm0-338h1244v169.5H338V454z"/></svg>`;
  const discSvg   = `<svg viewBox="0 0 1920 1920" width="13" height="13" fill="currentColor"><path d="M1920 1468.5c0 62-50.9 112.9-113 112.9h-338v225.8c0 62.1-50.9 113-113 113-30 0-58.6-11.9-79.7-33L831.6 1581.4H113C50.9 1581.4 0 1530.5 0 1468.5V113C0 50.9 50.9 0 113 0h1694c62.1 0 113 50.9 113 113v1355.5z"/></svg>`;

  const layout     = settings.plannerLayout || 'cards';
  const doneStyle  = settings.plannerDoneStyle || 'fade';
  const emphToday  = !!settings.plannerEmphasizeToday;
  const hideActivity = !!settings.plannerHideActivity;

  const days = [
    {
      label: 'YESTERDAY', date: 'Monday, July 30', today: false,
      items: [
        { badge: 'INTRO TO PSYCH',  color: '#c0392b', typeLabel: 'INTRODUCTION TO PSYCHOLOGY ASSIGNMENT', title: 'Paper #2: Brains and Behavior',   icon: assignSvg, status: 'MISSING', due: 'DUE: 9:59 PM',  done: false, points: '' },
        { badge: 'ACCOUNTING',      color: '#8e63ad', typeLabel: 'ACCOUNTING ASSIGNMENT',                 title: 'Homework Ch 14 [myBusinessCourse]', icon: assignSvg, status: 'GRADED', auxTags: ['Feedback'], due: 'DUE: 11:59 PM', done: false, points: '8 pts' },
      ],
    },
    {
      label: 'TODAY', date: 'Tuesday, July 31', today: true,
      items: [
        { badge: 'INTRO TO PSYCH',  color: '#c0392b', typeLabel: 'INTRODUCTION TO PSYCHOLOGY READING',    title: 'Chapter 3: Memory',              icon: assignSvg, status: '',        due: 'DUE: 11:59 PM', done: false },
        { badge: 'HNRS: SOFTWARE DEVEL RAIK184H SEC 150 SPRING 2026', color: '#1f6fb2', typeLabel: 'HNRS: SOFTWARE DEVEL RAIK184H SEC 150 SPRING 2026 ASSIGNMENT', title: 'Induction Lab',   icon: assignSvg, status: '',          due: 'DUE: 11:59 PM', done: false, points: '' },
        { badge: 'HNRS: SOFTWARE DEVEL RAIK184H SEC 150 SPRING 2026', color: '#1f6fb2', typeLabel: 'HNRS: SOFTWARE DEVEL RAIK184H SEC 150 SPRING 2026 ASSIGNMENT', title: 'Proofs Reading', icon: assignSvg, status: 'SUBMITTED', due: 'DUE: 11:59 PM', done: false, points: '' },
        { badge: 'CHEMISTRY',       color: '#1a5276', typeLabel: 'CHEMISTRY PAGE',                        title: 'Day 13 skills review',           icon: assignSvg, status: '',        due: 'DUE: 11:59 PM', done: true  },
      ],
    },
  ];

  const chk = (done) => `<div class="cc-preview-lv-chk${done ? ' cc-preview-lv-chk--done' : ''}"></div>`;

  const renderDay = (day) => {
    const items = day.items
      .filter(it => !(it.done && doneStyle === 'hide'))
      .map(it => {
        const classes = [
          'cc-preview-lv-row',
          it.done ? 'cc-preview-lv-row--done' : '',
          it.done && doneStyle === 'strikethrough' ? 'cc-preview-lv-row--strike' : '',
        ].filter(Boolean).join(' ');
        // Compact layout collapses type-label + status into the title row.
        if (layout === 'compact') {
          return `
            <div class="${classes}" style="border-left-color:${it.color};">
              <div class="cc-preview-lv-dot" style="background:${it.color};"></div>
              ${chk(it.done)}
              <span class="cc-preview-lv-type-icon" style="color:${it.color};">${it.icon}</span>
              <div class="cc-preview-lv-title cc-preview-lv-title--compact">${it.title}</div>
              ${it.status ? `<span class="cc-preview-lv-status">${it.status}</span>` : ''}
              <span class="cc-preview-lv-due cc-preview-lv-due--compact">${it.due.replace(/^DUE:\s*/, '')}</span>
            </div>
          `;
        }
        return `
          <div class="${classes}" style="border-left-color:${it.color};">
            <div class="cc-preview-lv-dot" style="background:${it.color};"></div>
            <div class="cc-preview-lv-badge" style="background:${it.color};">${it.badge}</div>
            ${chk(it.done)}
            <span class="cc-preview-lv-type-icon" style="color:${it.color};">${it.icon}</span>
            <div class="cc-preview-lv-text">
              <div class="cc-preview-lv-type-lbl">${it.typeLabel}</div>
              <div class="cc-preview-lv-title">${it.title}</div>
            </div>
            <div class="cc-preview-lv-right">
              ${it.status ? `<span class="cc-preview-lv-status">${it.status}</span>` : ''}
              <span class="cc-preview-lv-due">${it.due}</span>
            </div>
          </div>
        `;
      }).join('');

    const hdrClass = [
      'cc-preview-lv-day-hdr',
      day.today && emphToday ? 'cc-preview-lv-day-hdr--today' : '',
    ].filter(Boolean).join(' ');

    return `
      <div class="cc-preview-lv-day">
        <div class="${hdrClass}">
          <span class="cc-preview-lv-day-name">${day.label}</span>
          <span class="cc-preview-lv-day-date">${day.date}</span>
        </div>
        ${items}
      </div>
    `;
  };

  const activity = hideActivity ? '' : `
    <div class="cc-preview-lv-activity">
      <div class="cc-preview-lv-activity-hdr">Recent Activity</div>
      <div class="cc-preview-lv-activity-item">
        <span class="cc-preview-lv-activity-dot" style="background:#9c27b0;"></span>
        <span class="cc-preview-lv-activity-text">New announcement in <strong>Database Design</strong></span>
      </div>
      <div class="cc-preview-lv-activity-item">
        <span class="cc-preview-lv-activity-dot" style="background:#16a085;"></span>
        <span class="cc-preview-lv-activity-text">Grade posted for <strong>Discrete Math HW 5</strong></span>
      </div>
    </div>
  `;

  if (layout === 'grouped') {
    const SMALL_WORDS = new Set(['to', 'of', 'and', 'the', 'in', 'on', 'a', 'an', 'for']);
    const titleCase = s => s.toLowerCase().split(' ').map((w, i) =>
      i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
    ).join(' ');
    const formatCourseName = s => s.includes(':')
      ? s.split(':').map((part, i) => i === 0 ? part.trim().toUpperCase() : titleCase(part.trim())).join(': ')
      : titleCase(s);
    const prettyDay = s => s.charAt(0) + s.slice(1).toLowerCase();

    const allItems = days.flatMap(d => d.items.map(it => ({ ...it, day: d })));
    const byCourse = new Map();
    for (const it of allItems) {
      if (it.done && doneStyle === 'hide') continue;
      if (!byCourse.has(it.badge)) byCourse.set(it.badge, { color: it.color, name: formatCourseName(it.badge), items: [] });
      byCourse.get(it.badge).items.push(it);
    }
    const collapsedCounts = new Map([
      ['HNRS: SOFTWARE DEVEL RAIK184H SEC 150 SPRING 2026', 2],
      ['CHEMISTRY', 1],
    ]);

    const groups = Array.from(byCourse.entries(), ([rawName, g]) => {
      const minis = g.items.map(it => {
        const classes = [
          'cc-preview-lv-mini',
          it.done ? 'cc-preview-lv-mini--done' : '',
          it.done && doneStyle === 'strikethrough' ? 'cc-preview-lv-mini--strike' : '',
        ].filter(Boolean).join(' ');
        const tags = [];
        if (it.status) tags.push({ label: it.status, tone: it.status === 'MISSING' ? 'danger' : 'neutral' });
        (it.auxTags || []).forEach(tag => tags.push({ label: tag, tone: 'neutral' }));
        return `
          <div class="${classes}">
            ${chk(it.done)}
            <div class="cc-preview-lv-mini-main">
              <div class="cc-preview-lv-mini-eyebrow">
                <span class="cc-preview-lv-mini-icon">${it.icon}</span>
                <span class="cc-preview-lv-mini-day">${prettyDay(it.day.label)}</span>
                <span class="cc-preview-lv-mini-sep">&middot;</span>
                <span class="cc-preview-lv-mini-type" title="${it.typeLabel}">${it.typeLabel}</span>
              </div>
              <div class="cc-preview-lv-mini-title">${it.title}</div>
            </div>
            <div class="cc-preview-lv-mini-side">
              ${tags.length ? `
                <div class="cc-preview-lv-mini-tags">
                  ${tags.map(tag => `<span class="cc-preview-lv-pill cc-preview-lv-pill--${tag.tone}">${tag.label}</span>`).join('')}
                </div>
              ` : '<div class="cc-preview-lv-mini-tags"></div>'}
              ${it.points ? `<div class="cc-preview-lv-mini-points">${it.points}</div>` : '<div class="cc-preview-lv-mini-points cc-preview-lv-mini-points--empty"></div>'}
              <div class="cc-preview-lv-mini-due">${it.due.replace(/^DUE:\s*/i, '')}</div>
            </div>
          </div>
        `;
      }).join('');
      const collapsedCount = collapsedCounts.get(rawName) || 0;
      const moreRow = collapsedCount && doneStyle !== 'hide' ? `
        <button class="cc-preview-lv-mini-more" type="button">
          <span class="cc-preview-lv-mini-more-chevron">&rsaquo;</span>
          <span>Show ${collapsedCount} completed item${collapsedCount === 1 ? '' : 's'}</span>
        </button>
      ` : '';

      return `
        <div class="cc-preview-lv-group" style="--cc-group-color:${g.color};">
          <div class="cc-preview-lv-group-hdr">
            <span class="cc-preview-lv-group-accent"></span>
            <span class="cc-preview-lv-group-name" title="${g.name}">${g.name}</span>
            <span class="cc-preview-lv-group-count">${g.items.length}</span>
          </div>
          <div class="cc-preview-lv-group-body">
            ${minis}
            ${moreRow}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="cc-preview-listview" data-layout="grouped">
        ${groups}
        ${activity}
      </div>
    `;
  }

  // Grouped layout: regroup items by course and render one clean card per
  // class with a vertical stack of mini-cards for each assignment.
  if (layout === '__grouped_legacy__') {
    // Normalize "INTRO TO PSYCH" → "Intro to Psych" (small words stay lower).
    const SMALL_WORDS = new Set(['to', 'of', 'and', 'the', 'in', 'on', 'a', 'an', 'for']);
    const titleCase = s => s.toLowerCase().split(' ').map((w, i) =>
      i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
    ).join(' ');
    const prettyDay = s => s.charAt(0) + s.slice(1).toLowerCase();

    const allItems = days.flatMap(d => d.items.map(it => ({ ...it, day: d })));
    const byCourse = new Map();
    for (const it of allItems) {
      if (it.done && doneStyle === 'hide') continue;
      if (!byCourse.has(it.badge)) byCourse.set(it.badge, { color: it.color, name: titleCase(it.badge), items: [] });
      byCourse.get(it.badge).items.push(it);
    }

    const groups = Array.from(byCourse.values(), g => {
      const minis = g.items.map(it => {
        const classes = [
          'cc-preview-lv-mini',
          it.done ? 'cc-preview-lv-mini--done' : '',
          it.done && doneStyle === 'strikethrough' ? 'cc-preview-lv-mini--strike' : '',
        ].filter(Boolean).join(' ');
        return `
          <div class="${classes}">
            ${chk(it.done)}
            <div class="cc-preview-lv-mini-body">
              <div class="cc-preview-lv-mini-title">${it.title}</div>
              <div class="cc-preview-lv-mini-meta">
                <span class="cc-preview-lv-mini-icon">${it.icon}</span>
                <span class="cc-preview-lv-mini-day">${prettyDay(it.day.label)}</span>
                <span class="cc-preview-lv-mini-sep">·</span>
                <span class="cc-preview-lv-mini-due">${it.due.replace(/^DUE:\s*/i, '')}</span>
                ${it.status ? `<span class="cc-preview-lv-status cc-preview-lv-status--inline">${it.status}</span>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="cc-preview-lv-group" style="--cc-group-color:${g.color};">
          <div class="cc-preview-lv-group-hdr">
            <span class="cc-preview-lv-group-accent"></span>
            <span class="cc-preview-lv-group-name">${g.name}</span>
            <span class="cc-preview-lv-group-count">${g.items.length}</span>
          </div>
          <div class="cc-preview-lv-group-body">${minis}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="cc-preview-listview" data-layout="grouped">
        ${groups}
        ${activity}
      </div>
    `;
  }

  return `
    <div class="cc-preview-listview" data-layout="${layout}">
      ${days.map(renderDay).join('')}
      ${activity}
    </div>
  `;
}

function tabListView() {
  return {
    title: 'List View',
    desc: 'Customize the Planner (List View) and Recent Activity dashboard views.',
    preview: previewListView(),
    groups: [
      { title: 'Layout', rows: [
        row('Style', selectControl('plannerLayout', [
          { value: 'cards',   label: 'Cards' },
          { value: 'rows',    label: 'Rows' },
          { value: 'compact', label: 'Compact' },
          { value: 'grouped', label: 'Grouped' },
        ]), 'Cards: default boxy look. Rows: flat inbox-style. Compact: dense single-line. Grouped: one big card per class with mini-cards inside for each assignment (in the live Canvas view, groups are by day since that\'s how Canvas organizes the planner).'),
        row('Accent Bar Width', rangeControl('plannerBarWidth', 0, 12, 1, 'px'), 'Width of the colored left stripe showing the course color.'),
        row('Item Spacing', rangeControl('plannerItemSpacing', 0, 24, 2, 'px'), 'Gap between items in the list.'),
      ]},
      { title: 'Day Headers', rows: [
        row('Emphasize Today', toggleControl('plannerEmphasizeToday'), 'Make today\'s day header larger and accent-colored so it stands out.'),
        row('Hide Empty Days', toggleControl('plannerHideEmptyDays'), 'Skip day headers that have no items, so the list only shows days with work.'),
        row('Background', colorControl('plannerDayBg', '#f5f5f5'), 'Background of each day\'s header strip.'),
        row('Text Color', colorControl('plannerDayTextColor', '#2d3b45'), 'Color of the date label in each day header.'),
      ]},
      { title: 'Item Style', rows: [
        row('Background', colorControl('plannerItemBg', '#ffffff'), 'Background of each planner item row. Leave unset to use Canvas\'s default.'),
        row('Text Color', colorControl('plannerItemTextColor', '#2d3b45'), 'Title and meta text on each item.'),
      ]},
      { title: 'Completed Items', rows: [
        row('Style', selectControl('plannerDoneStyle', [
          { value: 'fade',          label: 'Fade' },
          { value: 'strikethrough', label: 'Strikethrough' },
          { value: 'hide',          label: 'Hide' },
        ]), 'Fade: dim the whole row. Strikethrough: line through the title. Hide: remove from the list entirely.'),
        row('Fade Opacity', rangeControl('plannerDoneOpacity', 20, 100, 5, '%'), 'Only applies when Style is Fade. Lower = more muted.'),
      ]},
      { title: 'Recent Activity', rows: [
        row('Hide Activity Feed', toggleControl('plannerHideActivity'), 'Remove the Recent Activity feed from the List view so only planner items are shown.'),
        row('Item Background', colorControl('activityItemBg', '#ffffff'), 'Background of each activity feed item.'),
      ]},
    ],
  };
}

function previewListViewV2() {
  const assignSvg = `<svg viewBox="0 0 1920 1920" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M1807 1920H113C50.9 1920 0 1869.1 0 1807V113C0 50.9 50.9 0 113 0h1694c62.1 0 113 50.9 113 113v1694c0 62.1-50.9 113-113 113zm-56.5-169.5v-1581H169.5v1581h1581zM338 1468.5h1244v169.5H338v-169.5zm0-338h1244v169.5H338V1130zm0-338h1244v169.5H338V792zm0-338h1244v169.5H338V454z"/></svg>`;
  const speakerSvg = `<svg viewBox="0 0 1920 1920" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M1117 0v1920l-597-480H0V480h520L1117 0zm360 960c0-186-73-361-205-493l120-120c164 164 255 382 255 613 0 232-91 449-255 614l-120-120c132-132 205-307 205-494zm-240 0c0-122-48-236-134-322l120-120c118 118 184 275 184 442 0 168-66 324-184 443l-120-120c86-86 134-200 134-323z"/></svg>`;
  const doneStyle = settings.plannerDoneStyle || 'fade';
  const doneOpacity = Math.max(0.2, (settings.plannerDoneOpacity || 50) / 100);
  const emphToday = !!settings.plannerEmphasizeToday;
  const hideActivity = !!settings.plannerHideActivity;
  const hideEmptyDays = false;
  const structuredRows = settings.plannerTaskRowRedesignEnabled !== false;
  const animateCompleted = false;

  const taskCheck = (done) => `<span class="cc-preview-lv-task-check${done ? ' cc-preview-lv-task-check--done' : ''}"></span>`;
  const taskStateClass = (done) => [
    'cc-preview-lv-task',
    done ? 'cc-preview-lv-task--done' : '',
    done && doneStyle === 'strikethrough' ? 'cc-preview-lv-task--strike' : '',
  ].filter(Boolean).join(' ');

  const renderTask = (task) => {
    if (task.done && doneStyle === 'hide') return '';
    const note = task.note && structuredRows ? `
      <div class="cc-preview-lv-task-note">
        <span class="cc-preview-lv-task-avatar"></span>
        <span>${task.note}</span>
      </div>
    ` : (task.note ? `<div class="cc-preview-lv-task-note cc-preview-lv-task-note--inline">${task.note}</div>` : '');

    return `
      <div class="${taskStateClass(task.done)}" ${task.done && doneStyle === 'fade' ? `style="--cc-preview-done-opacity:${doneOpacity};"` : ''}>
        <div class="cc-preview-lv-task-leading">
          ${taskCheck(task.done)}
          <span class="cc-preview-lv-task-icon">${task.icon}</span>
        </div>
        <div class="cc-preview-lv-task-layout${structuredRows ? ' cc-preview-lv-task-layout--structured' : ''}">
          <div class="cc-preview-lv-task-mainline">
            <div class="cc-preview-lv-task-primary">
              <div class="cc-preview-lv-task-type">${task.type}</div>
              <div class="cc-preview-lv-task-title">${task.title}</div>
            </div>
            <div class="cc-preview-lv-task-meta">
              ${task.tags?.length ? `<div class="cc-preview-lv-task-tags">${task.tags.map(tag => `<span class="cc-preview-lv-task-pill">${tag}</span>`).join('')}</div>` : ''}
              ${task.points ? `<div class="cc-preview-lv-task-points">${task.points}</div>` : ''}
              <div class="cc-preview-lv-task-due">${task.due}</div>
            </div>
          </div>
          ${note}
        </div>
      </div>
    `;
  };

  const renderCourseCard = (course) => `
    <div class="cc-preview-lv-course-card" style="--cc-preview-course:${course.color};">
      ${course.alert ? '<span class="cc-preview-lv-course-alert"></span>' : ''}
      <div class="cc-preview-lv-course-hero">
        <div class="cc-preview-lv-course-label">${course.label}</div>
        <div class="cc-preview-lv-course-art" style="${course.heroStyle}"></div>
      </div>
      <div class="cc-preview-lv-course-tray">
        ${course.tasks.map(renderTask).filter(Boolean).join('')}
        ${course.completedCount && doneStyle !== 'hide' ? `
          <button class="cc-preview-lv-completed-link${animateCompleted ? ' cc-preview-lv-completed-link--animated' : ''}" type="button">
            <span class="cc-preview-lv-completed-chevron">&rsaquo;</span>
            <span>Show ${course.completedCount} Completed Item${course.completedCount === 1 ? '' : 's'}</span>
          </button>
        ` : ''}
      </div>
    </div>
  `;

  const days = [
    {
      label: 'Tomorrow, April 24',
      today: true,
      cards: [
        {
          label: 'Accounting',
          color: '#8f3e97',
          alert: true,
          heroStyle: 'background: linear-gradient(180deg, rgba(143, 62, 151, 0.72), rgba(143, 62, 151, 0.82)), linear-gradient(135deg, #cab4de, #8f63ad);',
          tasks: [
            {
              icon: assignSvg,
              type: 'Assignment',
              title: 'Homework Ch 14 [myBusinessCourse]',
              tags: ['Graded', 'Feedback'],
              points: '8 pts',
              due: 'Due: 11:59 PM',
              note: 'This assignment was attempted and submitted.',
            },
          ],
          completedCount: 0,
        },
        {
          label: 'HNRS: Software Devel R...',
          color: '#2478b5',
          alert: false,
          heroStyle: 'background: linear-gradient(180deg, rgba(36, 120, 181, 0.78), rgba(36, 120, 181, 0.86));',
          tasks: [
            { icon: assignSvg, type: 'Assignment', title: 'Induction Lab', due: 'Due: 11:59 PM' },
            { icon: assignSvg, type: 'Assignment', title: 'Proofs Reading', due: 'Due: 11:59 PM' },
            { icon: assignSvg, type: 'Assignment', title: 'Module Reflection', due: 'Due: 11:59 PM', done: true },
          ],
          completedCount: 2,
        },
      ],
    },
    {
      label: 'Sunday, April 26',
      today: false,
      cards: [],
    },
    {
      label: 'Monday, April 27',
      today: false,
      cards: [
        {
          label: 'Leadership',
          color: '#d14d3f',
          alert: false,
          heroStyle: 'background: linear-gradient(180deg, rgba(209, 77, 63, 0.72), rgba(209, 77, 63, 0.82));',
          tasks: [
            {
              icon: speakerSvg,
              type: 'Announcement',
              title: 'TA Hours Today',
              due: 'Posted 8:42 AM',
              note: 'Bring your draft if you want line-by-line feedback.',
            },
          ],
          completedCount: 0,
        },
      ],
    },
  ];

  const renderedDays = days
    .filter(day => !hideEmptyDays || day.cards.length)
    .map(day => `
      <section class="cc-preview-lv-day-card">
        <div class="cc-preview-lv-day-title${day.today && emphToday ? ' cc-preview-lv-day-title--today' : ''}">${day.label}</div>
        ${day.cards.length
          ? `<div class="cc-preview-lv-day-stack">${day.cards.map(renderCourseCard).join('')}</div>`
          : '<div class="cc-preview-lv-day-empty">No planner items for this day.</div>'}
      </section>
    `).join('');

  const activity = hideActivity ? '' : `
    <section class="cc-preview-lv-activity-block">
      <div class="cc-preview-lv-activity-head">Recent Activity</div>
      <div class="cc-preview-lv-activity-row">
        <span class="cc-preview-lv-activity-bullet" style="background:#9c27b0;"></span>
        <span>Feedback posted for <strong>Case Analysis 4</strong></span>
      </div>
      <div class="cc-preview-lv-activity-row">
        <span class="cc-preview-lv-activity-bullet" style="background:#16a085;"></span>
        <span>New announcement in <strong>Database Design</strong></span>
      </div>
    </section>
  `;

  return `
    <div class="cc-preview-listview cc-preview-listview--daily-cards">
      ${renderedDays}
      ${activity}
    </div>
  `;
}

function tabListViewV2() {
  return {
    title: 'List View',
    desc: 'Controls for the redesigned Daily Course Cards and Recent Activity in Dashboard List view.',
    preview: previewListViewV2(),
    groups: [
      { title: 'Daily Course Cards', rows: [
        row('Enhanced Task Rows', toggleControl('plannerTaskRowRedesignEnabled'), 'Align metadata into a consistent right rail and show feedback as a compact note row inside each Daily Course Card.'),
      ]},
      { title: 'Day Headers', rows: [
        row('Emphasize Today', toggleControl('plannerEmphasizeToday'), 'Make today\'s day header larger and accent-colored so it stands out.'),
      ]},
      { title: 'Completed Items', rows: [
        row('Completed Style', selectControl('plannerDoneStyle', [
          { value: 'fade',          label: 'Fade' },
          { value: 'strikethrough', label: 'Strikethrough' },
          { value: 'hide',          label: 'Hide' },
        ]), 'Choose how finished work appears inside each Daily Course Card.'),
        row('Fade Opacity', rangeControl('plannerDoneOpacity', 20, 100, 5, '%'), 'Used when Completed Style is Fade. Lower = more muted.'),
      ]},
      { title: 'Recent Activity', rows: [
        row('Hide Activity Feed', toggleControl('plannerHideActivity'), 'Remove the Recent Activity feed so the List view focuses only on planner items.'),
      ]},
    ],
  };
}

function previewSidebar() {
  const items = [
    { label: 'Account', avatar: true },
    { label: 'Dashboard', icon: 'M3 3h8v8H3V3zm10 0h8v5h-8V3zm0 7h8v11h-8V10zM3 13h8v8H3v-8z' },
    { label: 'Courses', icon: 'M4 4h16v3H4V4zm0 5h16v3H4V9zm0 5h16v3H4v-3zm0 5h16v2H4v-2z', badge: '3' },
    { label: 'Calendar', icon: 'M19 4h-2V2h-2v2H9V2H7v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z' },
    { label: 'Inbox', icon: 'M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z', badge: '2' },
  ];
  return `
    <div class="cc-preview-sidebar-frame">
      ${items.map((it, i) => `
        <div class="cc-preview-sidebar-item ${i === 1 ? 'active' : ''}">
          <div class="cc-preview-sidebar-icon-slot${it.avatar ? ' cc-preview-sidebar-icon-slot--avatar' : ''}">
            ${it.avatar
              ? '<div class="cc-preview-sidebar-avatar" aria-hidden="true"></div>'
              : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${it.icon}" fill="currentColor"/></svg>`}
            ${it.badge ? `<span class="cc-preview-sidebar-badge">${it.badge}</span>` : ''}
          </div>
          <div class="cc-preview-sidebar-label">${it.label}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function tabSidebar() {
  const detected = detectSidebarColors();
  return {
    title: 'Left Sidebar',
    desc: 'The global Canvas navigation column.',
    preview: previewSidebar(),
    groups: [
      { title: 'Visibility', rows: [
        row('Enable Sidebar Restyle', toggleControl('sidebarRestyle'), 'Tighter spacing, rounded active state.'),
        row('Show Labels', toggleControl('sidebarShowLabels'), 'Turn off to show icons only.'),
        row('Label Position', selectControl('sidebarLabelPosition', [
          { value: 'bottom', label: 'Below icon' },
          { value: 'right', label: 'Right of icon' },
        ]), 'Below icon keeps the standard stacked layout. Right of icon keeps the native sidebar width and fits labels beside icons without expanding the rail.'),
      ]},
      { title: 'Colors', rows: [
        row('Background', colorControl('sidebarBgColor', detected.bg), 'The sidebar\'s main fill color.'),
        row('Text & Icons', colorControl('sidebarTextColor', detected.text), 'Color of labels and SVG icons.'),
        row('Active Item Background', colorControl('sidebarActiveColor', detected.activeBg), 'Background of the currently selected nav item.'),
        row('Active Item Text', colorControl('sidebarActiveTextColor', detected.activeText), 'Text and icon color of the currently selected nav item.'),
      ]},
      { title: 'Sizing', rows: [
        row('Icon Size', rangeControl('sidebarIconSize', 14, 32, 1, 'px')),
        row('Label Size', rangeControl('sidebarLabelSize', 8, 14, 1, 'px')),
      ]},
    ],
  };
}

function previewWidget() {
  const now = Date.now();
  const sample = [
    { title: 'Linear Algebra HW 8', type: 'assignment',       course: 'MATH 314', contextName: 'MATH 314', complete: false, dueAt: new Date(now + 6 * 60 * 60 * 1000).toISOString() },
    { title: 'Database Lab 4',      type: 'assignment',       course: 'CSCE 451', contextName: 'CSCE 451', complete: false, dueAt: new Date(now + 54 * 60 * 60 * 1000).toISOString() },
    { title: 'Weekly Announcement', type: 'announcement',     course: 'BSAD 411', contextName: 'BSAD 411', complete: false, dueAt: new Date(now + 18 * 60 * 60 * 1000).toISOString() },
    { title: 'Discussion: Ch. 16',  type: 'discussion_topic', course: 'MGMT 311', contextName: 'MGMT 311', complete: false, dueAt: new Date(now - 3 * 60 * 60 * 1000).toISOString() },
    { title: 'Quiz 11',             type: 'quiz',             course: 'MATH 314', contextName: 'MATH 314', complete: true,  dueAt: new Date(now - 12 * 60 * 60 * 1000).toISOString() },
    { title: 'Case Study 3',        type: 'assignment',       course: 'BSAD 411', contextName: 'BSAD 411', complete: true,  dueAt: new Date(now + 20 * 60 * 60 * 1000).toISOString() },
  ];
  let items = sample.slice();
  if (settings.widgetHideAnnouncements) items = items.filter(i => i.type !== 'announcement');
  if (settings.widgetHideDiscussions) items = items.filter(i => i.type !== 'discussion_topic');
  if (!settings.widgetShowCompleted) items = items.filter(i => !i.complete);
  items.sort((a, b) => {
    switch (settings.widgetSortBy) {
      case 'course': return a.course.localeCompare(b.course);
      case 'type': return a.type.localeCompare(b.type);
      case 'status':
      case 'dueDate':
      default:
        if (a.complete !== b.complete) return a.complete ? 1 : -1;
        return 0;
    }
  });

  const total = items.length;
  const done = items.filter(i => i.complete).length;
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  const style = settings.widgetProgressStyle || 'bar';

  let progress;
  if (style === 'ring') {
    // Group sample items by course
    const groupMap = new Map();
    for (const it of items) {
      if (!groupMap.has(it.course)) groupMap.set(it.course, { name: it.course, total: 0, done: 0 });
      const g = groupMap.get(it.course);
      g.total++;
      if (it.complete) g.done++;
    }
    const groups = Array.from(groupMap.values());
    const size = 124;
    const cx = size / 2;
    const strokeW = 9;
    const gap = 2;
    const maxR = (size / 2) - (strokeW / 2) - 3;
    // gap 2 → slight separation. r1=54.5, r2=43.5, r3=32.5. Inner diameter ~56px.
    const palette = ['#fc5050', '#008ee2', '#00c389', '#f59e0b', '#9333ea'];
    const MAX_PREVIEW_RINGS = 3;
    const rings = groups.slice(0, MAX_PREVIEW_RINGS).map((g, i) => {
      const r = maxR - i * (strokeW + gap);
      if (r < strokeW) return '';
      const c = 2 * Math.PI * r;
      const pct2 = g.total === 0 ? 0 : Math.min(1, g.done / g.total);
      const offset = c * (1 - pct2);
      const color = palette[i % palette.length];
      const trackStroke = hexToRgba(color, 0.18);
      return `
        <circle cx="${cx}" cy="${cx}" r="${r.toFixed(2)}" fill="none" stroke="${trackStroke}" stroke-width="${strokeW}"/>
        <circle cx="${cx}" cy="${cx}" r="${r.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cx})"/>
      `;
    }).join('');
    const legend = groups.slice(0, 4).map((g, i) => `
      <div class="cc-preview-ring-legend-item">
        <span class="cc-preview-ring-legend-dot" style="background:${palette[i % palette.length]}"></span>
        <span class="cc-preview-ring-legend-name">${g.name}</span>
        <span class="cc-preview-ring-legend-count">${g.done}/${g.total}</span>
      </div>
    `).join('');
    progress = `
      <div class="cc-preview-widget-rings">
        <div class="cc-preview-widget-rings-svg" style="width:${size}px;height:${size}px;">
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${rings}</svg>
          <div class="cc-preview-widget-rings-center">
            <div class="cc-preview-widget-rings-pct">${pct}%</div>
          </div>
        </div>
        <div class="cc-preview-widget-rings-legend">${legend}</div>
      </div>
    `;
  } else if (style === 'circle') {
    progress = circleProgressMarkup(pct, done, total, !!settings.widgetShowFraction);
  } else if (style === 'segments') {
    const previewBarColor = settings.widgetProgressColor || '#6366f1';
    const n = Math.max(total, 1);
    const segs = Array.from({ length: n }, (_, i) => `<div class="cc-preview-widget-seg${i < done ? ' done' : ''}"${i < done ? ` style="background:${previewBarColor}"` : ''}></div>`).join('');
    progress = `<div class="cc-preview-widget-segments">${segs}</div>`;
  } else {
    const previewBarColor = settings.widgetProgressColor || '#6366f1';
    progress = `<div class="cc-preview-widget-bar"><div class="cc-preview-widget-fill" style="width:${pct}%;background:${previewBarColor}"></div></div>`;
  }

  const sections = widgetSections(items).map(section => ({
    ...section,
    open: false,
  }));
  const sectionRows = sections.map(section => {
    const rows = section.tasks.length === 0
      ? `<div class="cc-preview-widget-empty">${section.empty}</div>`
      : section.tasks.slice(0, 2).map(i => `
          <div class="cc-preview-widget-item ${i.complete ? 'done' : ''}" data-section="${section.key}">
            <div class="cc-preview-widget-check ${i.complete ? 'checked' : ''}">${i.complete ? '✓' : ''}</div>
            <div class="cc-preview-widget-item-body">
              <div class="cc-preview-widget-item-title">${i.title}</div>
              <div class="cc-preview-widget-item-meta">${i.course}</div>
            </div>
          </div>
        `).join('');
    const style = widgetSectionStyle(section);
    return `
      <div class="cc-preview-widget-section${section.open ? ' is-open' : ' is-collapsed'}" data-section="${section.key}"${section.color ? ' data-course-colorized="true"' : ''}${style ? ` style="${style}"` : ''}>
        <div class="cc-preview-widget-section-toggle">
          <span class="cc-preview-widget-section-label">${section.label}</span>
          <span class="cc-preview-widget-section-right">
            <span class="cc-preview-widget-section-count">${section.tasks.length}</span>
            <span class="cc-preview-widget-section-chevron" aria-hidden="true">
              <svg viewBox="0 0 20 20" focusable="false"><path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
          </span>
        </div>
        <div class="cc-preview-widget-section-panel-wrap">
          <div class="cc-preview-widget-list">${rows}</div>
        </div>
      </div>
    `;
  }).join('');

  const hideHeaderCount = style === 'ring' || style === 'circle';
  return `
    <div class="cc-preview-widget-frame" data-style="${style}">
      <div class="cc-preview-widget-header">
        <div class="cc-preview-widget-title">This Week</div>
        ${hideHeaderCount ? '' : `<div class="cc-preview-widget-count">${done}/${total}</div>`}
      </div>
      ${progress}
      <div class="cc-preview-widget-sections">${sectionRows}</div>
    </div>
  `;
}

function tabWidget() {
  return {
    title: 'Tasks Widget',
    desc: 'The custom "This Week" sidebar widget that replaces Canvas\'s built-in To Do list.',
    preview: previewWidget(),
    groups: [
      { title: 'Behavior', rows: [
        row('Enable Widget', toggleControl('widgetEnabled'), 'Turn off to keep Canvas\'s default To Do list.'),
        row('Group By', selectControl('widgetGroupBy', [
          { value: 'priority', label: 'Priority' },
          { value: 'course',   label: 'Classes' },
        ]), 'Priority groups tasks into Overdue / Due Soon / This Week / All. Classes creates one section per course.'),
      ]},
      { title: 'Progress', rows: [
        row('Style', selectControl('widgetProgressStyle', [
          { value: 'bar',        label: 'Bar' },
          { value: 'segments',   label: 'Segments' },
          { value: 'circle',     label: 'Circle' },
          { value: 'ring',       label: 'Ring' },
        ])),
        ...(settings.widgetProgressStyle !== 'ring' ? [row('Color', colorControl('widgetProgressColor', '#6366f1'))] : []),
        row('Show Fraction', toggleControl('widgetShowFraction'), 'Display "done / total tasks" below the progress indicator.'),
      ]},
      { title: 'Sort', rows: [
        row('Sort By', selectControl('widgetSortBy', [
          { value: 'dueDate', label: 'Due Date' },
          { value: 'status',  label: 'Status' },
          { value: 'course',  label: 'Course' },
          { value: 'type',    label: 'Type' },
        ])),
      ]},
      { title: 'Content', rows: [
        row('Show Completed', toggleControl('widgetShowCompleted')),
        row('Hide Announcements', toggleControl('widgetHideAnnouncements')),
        row('Hide Discussions', toggleControl('widgetHideDiscussions')),
      ]},
      { title: 'Previews', rows: [
        row('Task Previews', toggleControl('assignmentPreviewsEnabled'), 'Hover a task to see its description and point value when preview data is available.'),
      ]},
    ],
  };
}

function previewRecentFeedback() {
  const items = [
    { title: 'Paper 2 feedback available', detail: 'Introduction to Psychology - Rubric updated with inline comments', href: '#', iconHtml: '' },
    { title: 'Lab 4 grade posted', detail: 'Database Design - 18/20 points with note from instructor', href: '#', iconHtml: '' },
    { title: 'Discussion response reviewed', detail: 'Business Strategy - "Strong synthesis of the case study"', href: '#', iconHtml: '' },
    { title: 'Quiz 11 comments added', detail: 'Linear Algebra - Re-check question 5 explanation', href: '#', iconHtml: '' },
    { title: 'Case Study 3 feedback available', detail: 'MGMT 311 - Suggestions posted in SpeedGrader notes', href: '#', iconHtml: '' },
    { title: 'Short reflection reviewed', detail: 'World History - Instructor left a summary comment', href: '#', iconHtml: '' },
  ];
  return `<div class="cc-preview-feedback-frame">${recentFeedbackWidgetMarkup(items)}</div>`;
}

function tabRecentFeedback() {
  return {
    title: 'Recent Feedback',
    desc: 'Re-skins Canvas\'s native Recent Feedback sidebar list as a custom card.',
    preview: previewRecentFeedback(),
    groups: [
      { title: 'Behavior', rows: [
        row('Enable Widget', toggleControl('recentFeedbackEnabled'), 'Turn off to keep Canvas\'s default Recent Feedback list.'),
      ]},
      { title: 'Display', rows: [
        row('Show Details', toggleControl('recentFeedbackShowDetails'), 'Display the secondary feedback text under each title.'),
      ]},
    ],
  };
}

function tabIntegrations() {
  const calIcon = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="16" height="16" rx="2.5"/><path d="M2 8h16M7 1v4M13 1v4"/></svg>`;
  return {
    title: 'Integrations',
    desc: 'Connect Canvas to external services.',
    preview: null,
    html: `
      <div class="cc-section">
        <div class="cc-section-title">Google Calendar</div>
        <div class="cc-integ-card">
          <div class="cc-integ-card-foot">
            <span data-gcal-status>
              <div class="cc-integ-foot-left">
                <div class="cc-integ-account cc-integ-account--off">Not connected</div>
                <div class="cc-last-synced"></div>
              </div>
              <div class="cc-integ-foot-right">
                <button class="cc-btn" data-action="gcal-connect">Connect Google Calendar</button>
              </div>
            </span>
          </div>
        </div>
      </div>

      <div class="cc-section">
        <div class="cc-section-title">Sync Settings</div>
        <div class="cc-section-rows">
          ${row('Auto-sync on page load', toggleControl('gcalAutoSync'), 'Automatically sync every time you open Canvas.', 'data-gcal-gated')}
          ${row('Sync window', rangeControl('gcalDaysAhead', 14, 180, 7, ' days'), 'How many days ahead to look for items to sync.', 'data-gcal-gated')}
        </div>
      </div>

      <div class="cc-section">
        <div class="cc-section-title">What to Sync</div>
        <div class="cc-section-rows">
          ${row('Assignments',   toggleControl('gcalSyncAssignments'),   '', 'data-gcal-gated')}
          ${row('Quizzes',       toggleControl('gcalSyncQuizzes'),       '', 'data-gcal-gated')}
          ${row('Discussions',   toggleControl('gcalSyncDiscussions'),   '', 'data-gcal-gated')}
          ${row('Announcements', toggleControl('gcalSyncAnnouncements'), '', 'data-gcal-gated')}
        </div>
      </div>
    `,
  };
}

const TAB_RENDERERS = {
  general:      tabGeneral,
  cards:        tabCards,
  listview:     tabListViewV2,
  sidebar:      tabSidebar,
  widget:       tabWidget,
  recentfeedback: tabRecentFeedback,
  integrations: tabIntegrations,
};

// After the Left Sidebar tab renders, re-read the live sidebar colors
// (Canvas may not have applied the active-item styles yet when tabSidebar()
// first runs) and update any picker whose setting is unset. This guarantees
// the picker thumb always matches what the user actually sees in the sidebar.
function syncSidebarPickerFallbacks() {
  if (currentTab !== 'sidebar') return;
  const root = document.getElementById(MODAL_ID);
  if (!root) return;
  const detected = detectSidebarColors();
  const mapping = {
    sidebarBgColor: detected.bg,
    sidebarTextColor: detected.text,
    sidebarActiveColor: detected.activeBg,
    sidebarActiveTextColor: detected.activeText,
  };
  for (const [key, val] of Object.entries(mapping)) {
    if (settings[key]) continue; // user already set a value — leave alone
    if (!val) continue;
    const picker = root.querySelector(`input[data-setting="${key}"]`);
    if (picker && picker.value !== val) {
      picker.value = val;
      picker.setAttribute('value', val);
    }
  }
}

function renderTabPane() {
  const root = document.getElementById(MODAL_ID);
  if (!root) return;
  const pane = root.querySelector('.cc-modal-pane');
  const cfg = TAB_RENDERERS[currentTab]();
  const hasPreview = cfg.preview != null;

  const previewCol = hasPreview
    ? `<aside class="cc-preview-col">
         <div class="cc-preview-content">${cfg.preview}</div>
       </aside>`
    : '';

  const controlsBody = cfg.html
    ? cfg.html
    : cfg.groups.map(g => `
        <div class="cc-section">
          <div class="cc-section-title">${g.title}</div>
          <div class="cc-section-rows">
            ${g.rows.join('')}
          </div>
        </div>
      `).join('');

  pane.innerHTML = `
    <div class="cc-pane-layout${hasPreview ? '' : ' cc-pane-layout--full'}">
      ${previewCol}
      <section class="cc-controls-col">
        <h2 class="cc-pane-title">${cfg.title}</h2>
        ${controlsBody}
      </section>
    </div>
  `;

  // Wire up live-updating controls
  pane.querySelectorAll('[data-setting]').forEach(el => {
    // Custom dropdown: wire trigger + options
    if (el.classList.contains('cc-select')) {
      const trigger = el.querySelector('.cc-select-trigger');
      const menu = el.querySelector('.cc-select-menu');
      const label = el.querySelector('.cc-select-label');

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = el.classList.contains('open');
        // Close any other open selects
        document.querySelectorAll('.cc-select.open').forEach(s => {
          if (s !== el) setSelectState(s, false);
        });
        setSelectState(el, !wasOpen);
      });

      menu.querySelectorAll('.cc-select-option').forEach(opt => {
        opt.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (opt.disabled) return;
          const key = el.dataset.setting;
          const value = opt.dataset.value;
          el.dataset.value = value;
          label.textContent = opt.textContent.trim();
          menu.querySelectorAll('.cc-select-option').forEach(o => o.classList.toggle('selected', o === opt));
          setSelectState(el, false);
          await saveSettings({ [key]: value });
          applySettings(settings);
          syncControlAvailability(root);
          if (PLANNER_RERENDER_KEYS.has(key)) tick();
          if (PREVIEW_REACTIVE_KEYS.has(key)) refreshPreview();
          if (WIDGET_RERENDER_KEYS.has(key)) rerenderWidget();
          if (RECENT_FEEDBACK_RERENDER_KEYS.has(key)) rerenderRecentFeedback();
        });
      });
      return;
    }

    el.addEventListener('input', async () => {
      const key = el.dataset.setting;
      let value;
      if (el.type === 'checkbox') value = el.checked;
      else if (el.type === 'range') value = parseFloat(el.value);
      else value = el.value;

      // Update displayed range value if any
      if (el.type === 'range') {
        const out = el.parentElement.querySelector('.cc-range-value');
        if (out) {
          const suffix = (out.textContent.match(/[a-z%]+$/) || [''])[0];
          out.textContent = value + suffix;
        }
      }

      await saveSettings({ [key]: value });
      applySettings(settings);
      syncControlAvailability(root);
      if (PLANNER_RERENDER_KEYS.has(key)) tick();

      // Special: if widget toggle changed, inject or remove
      if (key === 'widgetEnabled') {
        if (value) injectWidget();
        else {
          const w = document.getElementById(WIDGET_ID);
          if (w) w.remove();
          removeGradesWidgetHost(true);
        }
      }

      if (key === 'recentFeedbackEnabled' && !value) {
        restoreNativeRecentFeedback();
      }

      // Re-render the preview when it needs to reflect the new setting
      // (progress style, filters, sort, card theme — things CSS vars can't fix on their own)
      if (PREVIEW_REACTIVE_KEYS.has(key)) refreshPreview();

      // Re-render the real widget to pick up progress / sort / filter changes
      if (WIDGET_RERENDER_KEYS.has(key)) rerenderWidget();
      if (RECENT_FEEDBACK_RERENDER_KEYS.has(key)) rerenderRecentFeedback();
    });
  });

  // Wire data-action buttons via delegation (covers dynamically injected buttons too).
  // Use .onclick assignment so tab switches replace the handler rather than stack duplicates.
  pane.onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'gcal-connect')    gcalSyncNow(true);
    if (action === 'gcal-disconnect') gcalDisconnect();
    if (action === 'gcal-sync')       gcalSyncNow(false);
  };

  postRenderTabPane();
}

// Called after renderTabPane finishes wiring controls. Runs post-render
// side-effects like re-syncing sidebar picker fallbacks once Canvas's
// active-item styles are applied.
function postRenderTabPane() {
  syncControlAvailability();
  if (currentTab === 'sidebar') {
    syncSidebarPickerFallbacks();
    // Canvas sometimes delays applying --active styles — re-run once
    // after a frame and once after 120ms to catch late updates.
    requestAnimationFrame(syncSidebarPickerFallbacks);
    setTimeout(syncSidebarPickerFallbacks, 120);
  }
  if (currentTab === 'integrations') {
    refreshIntegrationsStatus();
  }
}

const PREVIEW_REACTIVE_KEYS = new Set([
  'widgetProgressStyle', 'widgetProgressColor', 'widgetSortBy', 'widgetGroupBy',
  'widgetShowCompleted', 'widgetHideAnnouncements', 'widgetHideDiscussions',
  'widgetShowFraction',
  'recentFeedbackShowDetails',
  'plannerLayout', 'plannerDoneStyle', 'plannerDoneOpacity',
  'plannerEmphasizeToday', 'plannerHideActivity',
  'plannerTaskRowRedesignEnabled',
]);

const PLANNER_RERENDER_KEYS = new Set([
  'plannerTaskRowRedesignEnabled',
]);

const WIDGET_RERENDER_KEYS = new Set([
  'widgetProgressStyle', 'widgetProgressColor', 'widgetSortBy', 'widgetGroupBy',
  'widgetShowCompleted', 'widgetHideAnnouncements', 'widgetHideDiscussions',
  'widgetShowFraction',
]);

const RECENT_FEEDBACK_RERENDER_KEYS = new Set([
  'recentFeedbackEnabled',
  'recentFeedbackShowDetails',
]);

function refreshPreview() {
  const wrap = document.querySelector(`#${MODAL_ID} .cc-preview-content`);
  if (!wrap) return;
  const cfg = TAB_RENDERERS[currentTab]();
  if (cfg.preview == null) return;
  wrap.innerHTML = cfg.preview;
}

async function rerenderWidget() {
  const existing = document.getElementById(WIDGET_ID);
  if (!existing) return;
  if (lastWidgetRaw) {
    // Fast re-render from cache — re-runs normalize() so sort/filter/completed settings apply
    const tasks = normalize(lastWidgetRaw.items);
    renderWidget(existing, tasks, lastWidgetRaw.colors);
    return;
  }
  existing.remove();
  await injectWidget();
}

function rerenderRecentFeedback() {
  syncRecentFeedbackWidget();
}

// ---------- routing & observation ----------

function isDashboard() {
  const p = location.pathname;
  return p === '/' || p === '' || p === '/dashboard' || p.startsWith('/?');
}

function isCourseGradesPage() {
  return /^\/courses\/\d+\/grades\b/.test(location.pathname);
}

// Detect which of the three dashboard views is currently visible.
// Returns 'card' | 'activity' | 'list' | null (null = not on dashboard / no match).
function detectDashboardView() {
  const views = [
    ['card',     '#DashboardCard_Container'],
    ['activity', '#dashboard-activity'],
    ['list',     '.PlannerApp'],
  ];
  for (const [view, sel] of views) {
    const el = document.querySelector(sel);
    if (el && getComputedStyle(el).display !== 'none') return view;
  }
  return null;
}

let lastView = null;
function applyDashboardView() {
  const view = detectDashboardView();
  if (view === lastView) return;
  lastView = view;
  document.documentElement.dataset.ccDashboardView = view ?? 'none';
}

function ensureGradesWidgetHost(sidebar) {
  const wrapper = sidebar.closest('#right-side-wrapper') || sidebar.parentElement;
  if (!wrapper) return null;
  let host = document.getElementById(GRADES_WIDGET_HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = GRADES_WIDGET_HOST_ID;
  }
  if (host.parentElement !== wrapper || host.previousElementSibling !== sidebar) {
    sidebar.after(host);
  }
  return host;
}

function removeGradesWidgetHost(force = false) {
  const host = document.getElementById(GRADES_WIDGET_HOST_ID);
  if (!host) return;
  if (force || !host.querySelector(`#${WIDGET_ID}`)) host.remove();
}

function completedToggleLabel(count, hidden) {
  return `${hidden ? 'Show' : 'Hide'} ${count} Completed Item${count === 1 ? '' : 's'}`;
}

function extractCompletedToggleCount(text) {
  const normalized = (text || '')
    .replace(/[\u203a\u25b8\u25b6\u25ba\u276f>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const match = normalized.match(/\b(?:show|hide)\s+(\d+)\s+completed\s+items?\b/i);
  return match ? Number(match[1]) : 0;
}

function simplifyPlannerTypeLabel(text) {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const replacements = [
    [/discussion\s+topic$/i, 'Discussion'],
    [/planner\s+note$/i, 'Note'],
    [/wiki\s+page$/i, 'Page'],
    [/calendar\s+event$/i, 'Event'],
    [/assignment$/i, 'Assignment'],
    [/announcement$/i, 'Announcement'],
    [/reading$/i, 'Reading'],
    [/quiz$/i, 'Quiz'],
    [/page$/i, 'Page'],
    [/event$/i, 'Event'],
  ];

  for (const [pattern, label] of replacements) {
    if (pattern.test(normalized)) return label;
  }

  return normalized;
}

function syncCompletedToggleButton(button, count, hidden) {
  if (!button) return;

  button.classList.add('cc-completed-toggle-btn');
  button.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  if (!button.hasAttribute('type')) button.setAttribute('type', 'button');

  let chevron = button.querySelector('.cc-completed-toggle-chevron');
  let label = button.querySelector('.cc-completed-toggle-label');
  if (!chevron || !label) {
    chevron = document.createElement('span');
    chevron.className = 'cc-completed-toggle-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = '<svg viewBox="0 0 20 20" focusable="false" aria-hidden="true"><path d="M7 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    label = document.createElement('span');
    label.className = 'cc-completed-toggle-label';

    button.replaceChildren(chevron, label);
  }

  label.textContent = completedToggleLabel(count, hidden);
}

function skinPlannerGroupings() {
  if (!isDashboard() || lastView !== 'list') return;

  document.querySelectorAll('[class*="Grouping-styles__root"]').forEach(group => {
    group.style.setProperty('border', 'none', 'important');
    group.style.setProperty('border-top', 'none', 'important');
    group.style.setProperty('overflow', 'visible', 'important');
    group.style.setProperty('border-radius', '8px', 'important');
    group.style.setProperty('margin-bottom', '10px', 'important');
    group.style.setProperty('box-shadow', 'var(--cc-planner-group-shadow, 0 1px 3px rgba(0, 0, 0, 0.1))', 'important');

    const title = group.querySelector('[class*="Grouping-styles__title"]');
    if (title) {
      title.style.setProperty('white-space', 'nowrap', 'important');
      title.style.setProperty('overflow', 'hidden', 'important');
      title.style.setProperty('text-overflow', 'ellipsis', 'important');
      title.style.setProperty('word-wrap', 'normal', 'important');
      title.style.setProperty('overflow-wrap', 'normal', 'important');
      title.style.setProperty('hyphens', 'none', 'important');
      title.style.setProperty('max-height', 'none', 'important');
      title.style.setProperty('border-top-left-radius', '8px', 'important');
      title.style.setProperty('border-bottom-left-radius', '8px', 'important');
      title.style.setProperty('border-top-right-radius', '0', 'important');
      title.style.setProperty('border-bottom-right-radius', '0', 'important');
    }

    const hero = group.querySelector('[class*="Grouping-styles__hero"]');
    if (hero) {
      hero.style.setProperty('overflow', 'hidden', 'important');
      hero.style.setProperty('border-top-left-radius', '8px', 'important');
      hero.style.setProperty('border-bottom-left-radius', '8px', 'important');
      hero.style.setProperty('border-top-right-radius', '0', 'important');
      hero.style.setProperty('border-bottom-right-radius', '0', 'important');
    }

    group.querySelectorAll('[class*="Grouping-styles__overlay"]').forEach(overlay => {
      overlay.style.setProperty('height', '100%', 'important');
      overlay.style.setProperty('border-top-left-radius', '8px', 'important');
      overlay.style.setProperty('border-bottom-left-radius', '8px', 'important');
      overlay.style.setProperty('border-top-right-radius', '0', 'important');
      overlay.style.setProperty('border-bottom-right-radius', '0', 'important');
    });

    Array.from(group.children)
      .filter(child => /\b(activityIndicator|NotificationBadge-styles__activityIndicator)\b/.test(child.className || ''))
      .forEach(indicator => {
        indicator.style.setProperty('position', 'absolute', 'important');
        indicator.style.setProperty('left', '-18px', 'important');
        indicator.style.setProperty('top', '50%', 'important');
        indicator.style.setProperty('transform', 'translateY(-50%)', 'important');
        indicator.style.setProperty('margin', '0', 'important');
        indicator.style.setProperty('padding', '0', 'important');
        indicator.style.setProperty('background', 'transparent', 'important');
        indicator.style.setProperty('box-shadow', 'none', 'important');
        indicator.style.setProperty('flex', 'none', 'important');
        indicator.style.setProperty('z-index', '2', 'important');
      });

    const items = group.querySelector('[class*="Grouping-styles__items"]');
    const wrappers = items
      ? Array.from(items.children).filter(child => !child.matches('.cc-completed-toggle-row'))
      : [];
    if (items) {
      items.style.setProperty('border-top', 'none', 'important');
      items.style.setProperty('background', 'var(--cc-planner-group-items-bg, #ffffff)', 'important');
      items.style.setProperty('padding', '8px', 'important');
      items.style.setProperty('display', 'block', 'important');
      items.style.setProperty('min-height', '0', 'important');
      items.style.setProperty('height', 'auto', 'important');
      items.style.setProperty('border-top-right-radius', '8px', 'important');
      items.style.setProperty('border-bottom-right-radius', '8px', 'important');
      items.style.setProperty('border-top-left-radius', '0', 'important');
      items.style.setProperty('border-bottom-left-radius', '0', 'important');

      Array.from(items.children).forEach((child, index) => {
        if (child.matches('.cc-completed-toggle-row')) return;
        // Skip Canvas's native completed-items toggle row too. Its margin is
        // managed exclusively by the nativeRow block below — letting this
        // loop set `6px` here creates a transient incorrect value that
        // sometimes survives to the rendered frame when React's re-commit
        // races with our tick (the conditional below would not always fire
        // before the next paint, so the loop's 6 px would stick after
        // expand → collapse cycles, producing the "margin shrinks after
        // toggling" symptom).
        if (child.matches('.planner-completed-items, [class*="CompletedItemsFacade-styles__root"]')) return;
        if (child.querySelector('[data-testid="completed-items-toggle"]')) return;
        child.style.setProperty('display', 'block', 'important');
        child.style.setProperty('margin-top', index === 0 ? '0' : '6px', 'important');
        child.style.setProperty('margin-bottom', '0', 'important');
      });
    }

    const nativeCompletedToggle = group.querySelector('[data-testid="completed-items-toggle"]');
    if (nativeCompletedToggle) {
      const rawLabel = nativeCompletedToggle.innerText || nativeCompletedToggle.textContent || '';
      const count = extractCompletedToggleCount(rawLabel);
      const hidden = nativeCompletedToggle.getAttribute('aria-expanded') === 'false';
      if (count > 0) syncCompletedToggleButton(nativeCompletedToggle, count, hidden);
      const matchedLabel = rawLabel.match(/(?:Show|Hide)\s+\d+\s+completed\s+items?/i);
      const cleanLabel = matchedLabel
        ? matchedLabel[0].replace(/\s+/g, ' ').trim()
        : rawLabel.replace(/^\s*[>›▸]+\s*/, '').split('\n')[0].trim();

      if (cleanLabel) {
        if (!nativeCompletedToggle.querySelector('.cc-completed-toggle-label')) {
          nativeCompletedToggle.textContent = cleanLabel;
        }
      }

      // Layout-only inline styles. Visual chrome (padding, border, border-radius,
      // color, background) is owned by the stylesheet rules on
      // `button[data-testid="completed-items-toggle"]` and `.cc-completed-toggle-btn`
      // — writing those inline here would clobber the CSS every tick (inline
      // !important beats stylesheet !important), which is why the pill chrome
      // wasn't appearing despite the CSS rule existing.
      nativeCompletedToggle.style.setProperty('display', 'inline-flex', 'important');
      nativeCompletedToggle.style.setProperty('align-items', 'center', 'important');
      nativeCompletedToggle.style.setProperty('justify-content', 'flex-start', 'important');
      nativeCompletedToggle.style.setProperty('gap', '6px', 'important');
      nativeCompletedToggle.style.setProperty('width', 'auto', 'important');
      nativeCompletedToggle.style.setProperty('font-size', '12px', 'important');
      nativeCompletedToggle.style.setProperty('font-weight', '600', 'important');
      nativeCompletedToggle.style.setProperty('line-height', '1.2', 'important');
      nativeCompletedToggle.style.setProperty('box-shadow', 'none', 'important');
      nativeCompletedToggle.style.setProperty('margin', '0', 'important');
      nativeCompletedToggle.style.setProperty('white-space', 'nowrap', 'important');
      nativeCompletedToggle.style.setProperty('text-indent', '0', 'important');
      // Clear any leftover overrides from previous builds that conflict with
      // the stylesheet — needed for users upgrading from the no-pill version.
      nativeCompletedToggle.style.removeProperty('padding');
      nativeCompletedToggle.style.removeProperty('border');
      nativeCompletedToggle.style.removeProperty('border-radius');
      nativeCompletedToggle.style.removeProperty('background');
      nativeCompletedToggle.style.removeProperty('color');
      nativeCompletedToggle.style.removeProperty('text-decoration');

      const nativeRow = nativeCompletedToggle.closest('li');
      if (nativeRow) {
        // `isOnlyItem` is true when the native completed-items row is the
        // only child of the items container — i.e. a Daily Course Card whose
        // only entry is the "Show N Completed Items" facade. In that case
        // we centre the toggle vertically against the group's hero (the
        // course-card image / day header on the left) instead of pinning
        // it at the top of an empty card.
        //
        // This branch was removed two changes back to fix a different bug
        // (margin variance during React re-renders), but its loss broke the
        // only-item layout. Reintroducing it carefully: the margin stays
        // case-stable (always 14 px when not isOnlyItem, always 0 when it
        // is — within either case the margin doesn't fluctuate across
        // expand → collapse cycles, which was the original concern).
        const isOnlyItem = wrappers.length === 1 && wrappers[0] === nativeRow;

        nativeRow.style.setProperty('display', 'block', 'important');
        nativeRow.style.setProperty('list-style', 'none', 'important');
        nativeRow.style.setProperty('margin', '0', 'important');
        nativeRow.style.setProperty('margin-top', isOnlyItem ? '0' : '14px', 'important');
        nativeRow.style.setProperty('margin-bottom', '0', 'important');
        nativeRow.style.setProperty('margin-left', '0', 'important');
        nativeRow.style.setProperty('border', 'none', 'important');
        nativeRow.style.setProperty('border-bottom', 'none', 'important');
        nativeRow.style.setProperty('background', 'transparent', 'important');
        nativeRow.style.setProperty('padding', '0', 'important');
        nativeRow.style.setProperty('padding-left', '0', 'important');

        if (items) {
          if (isOnlyItem) {
            // Force items to the hero's height so flex-centre has free
            // space to distribute. Without setting `height` (not just
            // `min-height`), the earlier `items.height = 'auto' !important`
            // line at 3660 stays in effect and the flex container collapses
            // to the toggle row's intrinsic height — making `justify-content:
            // center` a visual no-op. We mirror `min-height` for safety in
            // case the parent flex-row doesn't stretch.
            const heroEl = group.querySelector('[class*="Grouping-styles__hero"], [class*="Grouping-styles__title"]');
            const heroH = heroEl ? heroEl.offsetHeight : group.offsetHeight;
            if (heroH > 0) {
              items.style.setProperty('height', `${heroH}px`, 'important');
              items.style.setProperty('min-height', `${heroH}px`, 'important');
            }
            items.style.setProperty('display', 'flex', 'important');
            items.style.setProperty('flex-direction', 'column', 'important');
            items.style.setProperty('justify-content', 'center', 'important');
            items.style.setProperty('align-items', 'flex-start', 'important');
            group.dataset.ccCompletedOnlyToggle = 'true';
          } else {
            // Items above the toggle — plain block flow, drop the height
            // override + flex props so this group renders normally.
            items.style.removeProperty('height');
            items.style.removeProperty('min-height');
            items.style.setProperty('display', 'block', 'important');
            items.style.removeProperty('flex-direction');
            items.style.removeProperty('justify-content');
            items.style.removeProperty('align-items');
            delete group.dataset.ccCompletedOnlyToggle;
          }
        }
      }

      const nativeFacade = nativeCompletedToggle.closest('.planner-completed-items, [class*="CompletedItemsFacade-styles__root"]');
      if (nativeFacade) {
        nativeFacade.style.setProperty('display', 'flex', 'important');
        nativeFacade.style.setProperty('align-items', 'center', 'important');
        nativeFacade.style.setProperty('justify-content', 'flex-start', 'important');
        nativeFacade.style.setProperty('gap', '0', 'important');
        nativeFacade.style.setProperty('padding', '0', 'important');
        nativeFacade.style.setProperty('padding-left', '0', 'important');
        nativeFacade.style.setProperty('padding-right', '0', 'important');
        nativeFacade.style.setProperty('margin', '0', 'important');
        nativeFacade.style.setProperty('border', 'none', 'important');
        nativeFacade.style.setProperty('border-bottom', 'none', 'important');
        nativeFacade.style.setProperty('background', 'transparent', 'important');
        nativeFacade.style.setProperty('box-shadow', 'none', 'important');
      }

      const activityIndicator = nativeFacade?.querySelector('[class*="CompletedItemsFacade-styles__activityIndicator"]');
      if (activityIndicator) {
        activityIndicator.style.setProperty('display', 'none', 'important');
        activityIndicator.style.setProperty('width', '0', 'important');
        activityIndicator.style.setProperty('margin', '0', 'important');
        activityIndicator.style.setProperty('padding', '0', 'important');
      }

      const badgeSpacer = nativeFacade?.querySelector('[class*="NotificationBadge-styles__activityIndicator"]');
      if (badgeSpacer) {
        badgeSpacer.style.setProperty('display', 'none', 'important');
        badgeSpacer.style.setProperty('width', '0', 'important');
        badgeSpacer.style.setProperty('min-width', '0', 'important');
        badgeSpacer.style.setProperty('margin', '0', 'important');
        badgeSpacer.style.setProperty('padding', '0', 'important');
      }

      const contentPrimary = nativeFacade?.querySelector('[class*="CompletedItemsFacade-styles__contentPrimary"]');
      if (contentPrimary) {
        contentPrimary.style.setProperty('margin', '0', 'important');
        contentPrimary.style.setProperty('margin-left', '0', 'important');
        contentPrimary.style.setProperty('margin-inline-start', '0', 'important');
        contentPrimary.style.setProperty('padding', '0', 'important');
        contentPrimary.style.setProperty('flex', '0 0 auto', 'important');
      }

      const secondary = nativeFacade?.querySelector('[class*="CompletedItemsFacade-styles__contentSecondary"]');
      if (secondary) {
        secondary.style.setProperty('display', 'none', 'important');
      }
    }

    group.querySelectorAll('[class*="Grouping-styles__items"] [class*="PlannerItem-styles__root"]').forEach(row => {
      // Layout-only inline styles — visual chrome (background, border-radius,
      // box-shadow, padding) is owned by the stylesheet so the no-card
      // treatment isn't clobbered every tick. removeProperty calls below
      // clear any leftover values from prior builds.
      row.style.setProperty('border', 'none', 'important');
      row.style.setProperty('display', 'flex', 'important');
      row.style.setProperty('align-items', 'flex-start', 'important');
      row.style.setProperty('gap', '12px', 'important');
      row.style.setProperty('min-height', '0', 'important');
      row.style.removeProperty('background');
      row.style.removeProperty('border-radius');
      row.style.removeProperty('box-shadow');
      row.style.removeProperty('padding');

      const completed = row.querySelector('[class*="PlannerItem-styles__completed"]');
      if (completed) {
        completed.style.setProperty('flex', '0 0 auto', 'important');
        completed.style.setProperty('margin', '4px 0 0', 'important');
      }

      const icon = row.querySelector('[class*="PlannerItem-styles__icon"]');
      if (icon) {
        icon.style.setProperty('flex', '0 0 auto', 'important');
        icon.style.setProperty('margin-top', '4px', 'important');
      }

      const layout = row.querySelector('[class*="PlannerItem-styles__layout"]');
      if (layout) {
        layout.style.setProperty('display', 'flex', 'important');
        layout.style.setProperty('flex', '1 1 auto', 'important');
        layout.style.setProperty('flex-direction', 'column', 'important');
        layout.style.setProperty('align-items', 'stretch', 'important');
        layout.style.setProperty('justify-content', 'flex-start', 'important');
        layout.style.setProperty('min-width', '0', 'important');
        layout.style.setProperty('min-height', '0', 'important');
      }

      const innerLayout = row.querySelector('[class*="PlannerItem-styles__innerLayout"]');
      if (innerLayout) {
        innerLayout.style.setProperty('display', 'flex', 'important');
        innerLayout.style.setProperty('align-items', 'flex-start', 'important');
        innerLayout.style.setProperty('justify-content', 'flex-start', 'important');
        innerLayout.style.setProperty('min-width', '0', 'important');
        innerLayout.style.setProperty('min-height', '0', 'important');
        innerLayout.style.setProperty('height', 'auto', 'important');
      }

      const type = row.querySelector('[class*="PlannerItem-styles__type"]');
      if (type) {
        const label = simplifyPlannerTypeLabel(type.textContent);
        if (label) type.textContent = label;
      }

      // Strict variant fingerprinting — additive, opt-in, self-healing.
      // Only two exact direct-child shapes (ignoring <style> nodes) are
      // tagged; anything else clears prior tags and is left untouched.
      const layoutEl = row.querySelector('[class*="PlannerItem-styles__layout"]');
      const innerLayoutEl = layoutEl?.querySelector('[class*="PlannerItem-styles__innerLayout"]');
      let rowVariant = null;
      let primaryEl = null;
      let metaEl = null;
      let noteEl = null;
      if (settings.plannerTaskRowRedesignEnabled !== false && layoutEl && innerLayoutEl) {
        const layoutChildren = Array.from(layoutEl.children).filter(c => c.tagName !== 'STYLE');
        const innerChildren = Array.from(innerLayoutEl.children).filter(c => c.tagName !== 'STYLE');
        const hasCls = (el, token) => typeof el?.className === 'string' && el.className.includes(token);
        const okInner = innerChildren.length === 2
          && hasCls(innerChildren[0], 'PlannerItem-styles__details')
          && hasCls(innerChildren[1], 'PlannerItem-styles__secondary');
        if (okInner && layoutChildren.length === 1 && layoutChildren[0] === innerLayoutEl) {
          rowVariant = 'standard';
          primaryEl = innerChildren[0];
          metaEl = innerChildren[1];
        } else if (
          okInner &&
          layoutChildren.length === 2 &&
          layoutChildren[0] === innerLayoutEl &&
          hasCls(layoutChildren[1], 'PlannerItem-styles__feedback')
        ) {
          rowVariant = 'with-feedback';
          primaryEl = innerChildren[0];
          metaEl = innerChildren[1];
          noteEl = layoutChildren[1];
        }
      }

      if (rowVariant) {
        row.dataset.ccPlannerRowVariant = rowVariant;
        if (primaryEl) primaryEl.dataset.ccPlannerRole = 'primary';
        if (metaEl) metaEl.dataset.ccPlannerRole = 'meta';
        if (noteEl) {
          noteEl.dataset.ccPlannerRole = 'note';
        } else {
          row.querySelectorAll('[data-cc-planner-role="note"]').forEach(el => {
            delete el.dataset.ccPlannerRole;
          });
        }
        // Card-center via browser flexbox for both variants. For
        // with-feedback cards this places the checkbox/icon near the
        // divider between the title row and the note; user preference
        // is visual consistency across variants over semantic coupling
        // to the title line.
        row.style.setProperty('align-items', 'center', 'important');
        if (completed) completed.style.setProperty('margin', '0', 'important');
        if (icon) icon.style.setProperty('margin-top', '0', 'important');
        // Center the secondary (meta) rail vertically with the title row
        // inside innerLayout. For with-feedback variants this means the
        // tags/metrics align with the top part (title), not the whole
        // card, since the feedback note is a sibling of innerLayout.
        if (innerLayout) {
          innerLayout.style.setProperty('align-items', 'center', 'important');
        }
      } else {
        delete row.dataset.ccPlannerRowVariant;
        row.querySelectorAll('[data-cc-planner-role]').forEach(el => {
          delete el.dataset.ccPlannerRole;
        });
        // Restore the stable-shell defaults for unmatched rows.
        row.style.setProperty('align-items', 'flex-start', 'important');
        if (completed) completed.style.setProperty('margin', '4px 0 0', 'important');
        if (icon) icon.style.setProperty('margin-top', '4px', 'important');
      }
    });
  });
}

function isCompletedPlannerWrapper(child) {
  const text = (child.innerText || child.textContent || '').trim();
  return /is marked as done\./i.test(text) || /complete(?:d)?/i.test(child.getAttribute('aria-label') || '');
}

function syncPlannerCompletedCollapseControls() {
  if (!isDashboard() || lastView !== 'list') return;

  document.querySelectorAll('[class*="Grouping-styles__root"]').forEach(group => {
    const items = group.querySelector('[class*="Grouping-styles__items"]');
    if (!items) return;

    const nativeFacade = items.querySelector('[data-testid="completed-items-toggle"]');
    const wrappers = Array.from(items.children).filter(child => !child.matches('.cc-completed-toggle-row'));
    const completedWrappers = nativeFacade ? [] : wrappers.filter(isCompletedPlannerWrapper);
    const expandedCount = completedWrappers.length;

    const existingToggleRow = items.querySelector('.cc-completed-toggle-row');

    if (nativeFacade || !expandedCount || !completedWrappers.length) {
      existingToggleRow?.remove();
      delete group.dataset.ccCompletedCollapsed;
      delete group.dataset.ccCompletedOnlyToggle;
      wrappers.forEach(child => child.style.removeProperty('display'));
      return;
    }

    let toggleRow = existingToggleRow;
    if (!toggleRow) {
      toggleRow = document.createElement('li');
      toggleRow.className = 'cc-completed-toggle-row';
      toggleRow.innerHTML = '<button type="button" class="cc-completed-toggle-btn"></button>';
      items.append(toggleRow);
      toggleRow.querySelector('button')?.addEventListener('click', () => {
        const nextHidden = group.dataset.ccCompletedCollapsed !== 'true';
        group.dataset.ccCompletedCollapsed = nextHidden ? 'true' : 'false';
        syncPlannerCompletedCollapseControls();
      });
    } else if (toggleRow.parentElement !== items) {
      items.append(toggleRow);
    }

    const hidden = group.dataset.ccCompletedCollapsed === 'true';
    completedWrappers.forEach(child => {
      if (hidden) child.style.setProperty('display', 'none', 'important');
      else child.style.removeProperty('display');
    });

    // Count visible NON-TOGGLE children (active items + currently-visible
    // completed items). The previous logic used `visibleTaskCount` which
    // counted only completed items — wrong, because when active items exist
    // above + completed items collapsed, `visibleTaskCount` is 0 (no visible
    // completed) and the code wrongly took the "only toggle visible" branch
    // and zeroed the margin. The right test is "is anything besides the
    // toggle currently visible in this group?".
    const visibleNonToggleCount = wrappers.filter(w =>
      w.style.getPropertyValue('display') !== 'none'
    ).length;
    group.dataset.ccCompletedOnlyToggle = visibleNonToggleCount === 0 ? 'true' : 'false';

    if (visibleNonToggleCount === 0) {
      // Truly only the toggle is visible (Daily Course Card with no active
      // items, all completed items collapsed). Vertically centre the toggle
      // against the group's hero/title block.
      //
      // skinPlannerGroupings() runs first in the tick and sets items.height
      // = 'auto' !important. Without overriding that here, flex-centring has
      // no free space to distribute (container collapses to toggle height)
      // and the centring is visually a no-op. We measure the hero's
      // offsetHeight and force BOTH height and min-height to that value so
      // the items column reliably has the same height as the hero on every
      // tick — even though skin's auto resets it for a microsecond before
      // sync re-applies the explicit value, the rendered frame after each
      // tick is the explicit value (sync runs second).
      const hero = group.querySelector('[class*="Grouping-styles__hero"], [class*="Grouping-styles__title"]');
      const heroHeight = hero ? hero.offsetHeight : 0;
      const targetHeight = heroHeight > 0 ? heroHeight : group.offsetHeight;
      if (targetHeight > 0) {
        items.style.setProperty('height', `${targetHeight}px`, 'important');
        items.style.setProperty('min-height', `${targetHeight}px`, 'important');
      }
      items.style.setProperty('display', 'flex', 'important');
      items.style.setProperty('flex-direction', 'column', 'important');
      items.style.setProperty('justify-content', 'center', 'important');
      items.style.setProperty('align-items', 'flex-start', 'important');
      // Centring handles vertical spacing; an extra 14 px would shift the
      // toggle off-centre. Use 0 here — the centred toggle is the visual
      // anchor, not the row margin.
      toggleRow.style.setProperty('margin-top', '0', 'important');
    } else {
      // Visible non-toggle items above the toggle. Stable 14 px top margin
      // regardless of expanded/collapsed state. Items container in plain
      // block flow.
      items.style.removeProperty('height');
      items.style.removeProperty('min-height');
      items.style.setProperty('display', 'block', 'important');
      items.style.removeProperty('flex-direction');
      items.style.removeProperty('justify-content');
      items.style.removeProperty('align-items');
      toggleRow.style.setProperty('margin-top', '14px', 'important');
    }
    toggleRow.style.setProperty('margin-bottom', '0', 'important');

    const button = toggleRow.querySelector('.cc-completed-toggle-btn');
    if (button) {
      syncCompletedToggleButton(button, expandedCount, hidden);
    }
  });
}

// Mark the course-grades page so CSS can make page-local placement tweaks
// without repeatedly matching the URL in selectors.
let lastPage = null;
function applyPageType() {
  const p = location.pathname;
  let page = null;
  if (isCourseGradesPage()) page = 'course-grades';
  if (page === lastPage) return;
  lastPage = page;
  if (page) document.documentElement.dataset.ccPage = page;
  else delete document.documentElement.dataset.ccPage;
}

function tick() {
  if (!settings.extensionEnabled) return;
  applyDashboardView();
  applyPageType();
  if (!settings.sidebarBgColor || !settings.sidebarTextColor || !settings.sidebarActiveColor || !settings.sidebarActiveTextColor) {
    applySettings(settings);
  } else {
    syncGlobalNavToggleControls();
  }
  injectWidget();
  if (isDashboard() && lastView === 'card') injectCardGrades();
  skinPlannerGroupings();
  syncPlannerCompletedCollapseControls();
  syncRecentFeedbackWidget();
  if (settings.bgColor) applyBgInline();
}

let hydrationPassesScheduled = false;
function scheduleHydrationPasses() {
  if (hydrationPassesScheduled) return;
  hydrationPassesScheduled = true;
  const delays = [0, 50, 150, 300, 600, 1000, 1500, 2500, 4000];
  delays.forEach(delay => {
    setTimeout(tick, delay);
  });
  setTimeout(() => { hydrationPassesScheduled = false; }, Math.max(...delays) + 50);
}

let plannerSkinWatchId = null;
function ensurePlannerSkinWatch() {
  if (plannerSkinWatchId !== null) return;
  let attempts = 0;
  plannerSkinWatchId = window.setInterval(() => {
    attempts += 1;
    tick();
    if (attempts >= 60) {
      window.clearInterval(plannerSkinWatchId);
      plannerSkinWatchId = null;
    }
  }, 250);
}

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    tick();
  });
});

// ---------- message bridge ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'cc-toggle-modal') {
    toggleModal();
    sendResponse({ ok: true });
  }
});

// React to setting changes from any tab/window
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  for (const [k, { newValue }] of Object.entries(changes)) {
    settings[k] = newValue;
  }
  applySettings(settings);
  const keys = Object.keys(changes);
  if (keys.some(key => WIDGET_RERENDER_KEYS.has(key))) {
    rerenderWidget();
  }
  if (keys.some(key => RECENT_FEEDBACK_RERENDER_KEYS.has(key))) {
    rerenderRecentFeedback();
  }
});

// ---------- bootstrap ----------

// Mark <html> as ready so the CSS FOUC guard reveals body with a fade.
function markReady() {
  document.documentElement.classList.add('cc-ready');
}

// Phase 1 — runs at document_start. Loads settings and applies the parts
// that only touch <html> (CSS vars, data attrs). Body/head-dependent steps
// are deferred to phase 2. Always marks ready at the end so Canvas can't
// get stuck invisible.
async function earlyInit() {
  try {
    await loadSettings();
    applySettings(settings);
  } catch (e) {
    console.warn('[CustomCanvas] early init failed', e);
  } finally {
    markReady();
  }
}

// Canvas feature-detect — true when the page exposes Canvas's identifying
// chrome. The extension may be granted on arbitrary domains via
// `optional_host_permissions`, but should only modify pages that are actually
// Canvas. Checked at DOMContentLoaded since `body.ic-app` isn't yet present
// at document_start. Falls back to a `window.ENV` probe (Canvas exposes
// `ENV.current_user_id`/`ENV.DOMAIN_ROOT_ACCOUNT_ID` globally) for cases
// where the body class is missing but the JS context is Canvas's.
function isCanvasPage() {
  if (document.body?.classList?.contains('ic-app')) return true;
  if (document.querySelector('.ic-app, #application.ic-app, body.ic-app')) return true;
  try {
    if (window.ENV && (window.ENV.current_user_id != null || window.ENV.DOMAIN_ROOT_ACCOUNT_ID != null)) {
      return true;
    }
  } catch {}
  return false;
}

// Phase 2 — runs once DOM is parsed. Observer, widget, inline bg sweep.
function domInit() {
  if (!isCanvasPage()) {
    // Non-Canvas page (extension granted via optional host permission but the
    // user navigated somewhere unrelated). Clear our html-level data attrs so
    // CSS rules keyed on `[data-cc-dark-mode="on"]` etc. don't fire here.
    const root = document.documentElement;
    ['ccDarkMode', 'ccPlannerLayout', 'ccCardShadow', 'ccTextColor',
     'ccPlannerItemBg', 'ccPlannerItemText', 'ccPlannerDayBg', 'ccPlannerDayText',
     'ccPlannerDoneStyle', 'ccPlannerEmphasizeToday', 'ccPlannerHideEmptyDays',
     'ccPlannerHideActivity', 'ccSidebarRestyle', 'ccSidebarLabelPos']
       .forEach(k => { delete root.dataset[k]; });
    markReady();
    return;
  }
  if (settings.extensionEnabled) applyBgInline();
  observer.observe(document.documentElement, { childList: true, subtree: true });
  tick();
  scheduleHydrationPasses();
  ensurePlannerSkinWatch();

  window.addEventListener('load', scheduleHydrationPasses, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      scheduleHydrationPasses();
      ensurePlannerSkinWatch();
    }
  });

  // Tooltip listeners — delegated on document, attached once
  attachTooltipListeners();

  // Command palette — pre-fetch data and register Ctrl+K / ⌘K shortcut
  if (settings.commandPaletteEnabled) fetchPaletteData();
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      if (!settings.commandPaletteEnabled) return;
      e.preventDefault();
      paletteOpen ? closePalette() : openPalette();
    }
  });

  // Google Calendar auto-sync (non-interactive — silently skips if not connected)
  if (settings.gcalAutoSync) gcalSyncNow(false);
}

// Safety net — if anything above throws before markReady() runs, force-reveal
// after 3 seconds so Canvas isn't left invisible forever.
setTimeout(markReady, 3000);

earlyInit();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', domInit, { once: true });
} else {
  domInit();
}
