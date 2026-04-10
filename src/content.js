// Custom Canvas — content script
// Two responsibilities:
//   1. Replace the dashboard's native "To Do" sidebar with a weekly task list.
//   2. Render an in-page customization modal (opened from the toolbar icon)
//      that lets the user tweak Canvas's appearance via CSS variables and
//      data attributes on <html>.

const WIDGET_ID = 'cc-weekly-tasks';
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
  borderRadius: 8,            // global radius for buttons/inputs/panels

  // Background
  bgColor: '',
  bgImage: '',
  bgBlur: 0,

  // Page-level text + font
  textColor: '',
  fontFamily: 'default',

  // Modal accent (used by active tab, selected dropdown option, toggle on, slider)
  modalAccentColor: '#fc5050',

  // Weekly Tasks widget
  widgetEnabled: true,
  widgetProgressStyle: 'bar', // 'bar' | 'ring' | 'segments'
  widgetSortBy: 'dueDate',    // 'dueDate' | 'status' | 'course' | 'type'
  widgetShowCompleted: true,
  widgetHideAnnouncements: false,
  widgetHideDiscussions: false,

  // List View (Planner) & Recent Activity
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
  sidebarLabelPosition: 'right', // 'right' | 'left'
  iconSet: 'default',            // 'default' | 'fontawesome'

  // Tasks widget — extended
  widgetShowFraction: true,
  widgetFilter: 'all',           // 'all' | 'overdue' | 'due_soon' | 'this_week'
  assignmentPreviewsEnabled: true,

  // Command palette
  commandPaletteEnabled: true,
};

let settings = { ...DEFAULTS };

async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    settings = { ...DEFAULTS, ...stored };
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

function clearBgInline() {
  const all = [...BG_TARGETS, ...FEEDBACK_TARGETS];
  for (const sel of all) {
    try {
      document.querySelectorAll(sel).forEach(el => {
        el.style.removeProperty('background-color');
        el.style.removeProperty('background-image');
      });
    } catch {}
  }
}

function applyBgInline() {
  if (!document.body) return; // document_start — body not parsed yet
  if (!settings.extensionEnabled) {
    if (lastAppliedBg) {
      clearBgInline();
      lastAppliedBg = null;
    }
    return;
  }
  const color = settings.bgColor;
  if (!color) {
    if (lastAppliedBg) {
      clearBgInline();
      lastAppliedBg = null;
    }
    return;
  }
  for (const sel of BG_TARGETS) {
    try {
      document.querySelectorAll(sel).forEach(el => {
        el.style.setProperty('background-color', color, 'important');
      });
    } catch {}
  }
  for (const sel of FEEDBACK_TARGETS) {
    try {
      document.querySelectorAll(sel).forEach(el => {
        el.style.setProperty('background-image', 'none', 'important');
        el.style.setProperty('background-color', color, 'important');
      });
    } catch {}
  }
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
  'ccPlannerItemBg', 'ccPlannerItemText',
  'ccPlannerDayBg', 'ccPlannerDayText',
  'ccActivityItemBg',
];
const CC_CSS_VARS = [
  '--cc-card-radius', '--cc-card-image-opacity', '--cc-card-header-height',
  '--cc-card-bg', '--cc-card-text',
  '--cc-sidebar-icon-size', '--cc-sidebar-label-size',
  '--cc-accent', '--cc-radius',
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
  const w = document.getElementById(WIDGET_ID);
  if (w) w.remove();
}

function applySettings(s) {
  const root = document.documentElement;

  // Master kill switch — tear everything down and bail.
  if (!s.extensionEnabled) {
    tearDownOverrides();
    return;
  }

  const set = (k, v) => root.style.setProperty(k, v);

  set('--cc-card-radius', s.cardRadius + 'px');
  set('--cc-card-image-opacity', String(s.cardImageOpacity));
  set('--cc-card-header-height', s.cardHeaderHeight + 'px');

  set('--cc-sidebar-icon-size', s.sidebarIconSize + 'px');
  set('--cc-sidebar-label-size', s.sidebarLabelSize + 'px');
  set('--cc-sidebar-bg', s.sidebarBgColor || '#2d3b45');
  set('--cc-sidebar-text', s.sidebarTextColor || '#ffffff');
  set('--cc-sidebar-active', s.sidebarActiveColor || 'rgba(255, 255, 255, 0.18)');
  set('--cc-sidebar-active-text', s.sidebarActiveTextColor || 'var(--cc-sidebar-text, #ffffff)');

  set('--cc-accent', s.accentColor);
  set('--cc-radius', s.borderRadius + 'px');

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

  root.dataset.ccCardShadow = s.cardShadow;
  root.dataset.ccCardImage = s.cardShowImage ? 'shown' : 'hidden';

  if (s.cardBgColor) {
    set('--cc-card-bg', s.cardBgColor);
    root.dataset.ccCardBg = 'on';
  } else {
    root.style.removeProperty('--cc-card-bg');
    root.dataset.ccCardBg = 'off';
  }
  if (s.cardTextColor) {
    set('--cc-card-text', s.cardTextColor);
    root.dataset.ccCardText = 'on';
  } else {
    root.style.removeProperty('--cc-card-text');
    root.dataset.ccCardText = 'off';
  }
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

  if (s.plannerItemBg) {
    set('--cc-planner-item-bg', s.plannerItemBg);
    root.dataset.ccPlannerItemBg = 'on';
  } else {
    root.style.removeProperty('--cc-planner-item-bg');
    root.dataset.ccPlannerItemBg = 'off';
  }
  if (s.plannerItemTextColor) {
    set('--cc-planner-item-text', s.plannerItemTextColor);
    root.dataset.ccPlannerItemText = 'on';
  } else {
    root.style.removeProperty('--cc-planner-item-text');
    root.dataset.ccPlannerItemText = 'off';
  }
  if (s.plannerDayBg) {
    set('--cc-planner-day-bg', s.plannerDayBg);
    root.dataset.ccPlannerDayBg = 'on';
  } else {
    root.style.removeProperty('--cc-planner-day-bg');
    root.dataset.ccPlannerDayBg = 'off';
  }
  if (s.plannerDayTextColor) {
    set('--cc-planner-day-text', s.plannerDayTextColor);
    root.dataset.ccPlannerDayText = 'on';
  } else {
    root.style.removeProperty('--cc-planner-day-text');
    root.dataset.ccPlannerDayText = 'off';
  }
  if (s.activityItemBg) {
    set('--cc-activity-item-bg', s.activityItemBg);
    root.dataset.ccActivityItemBg = 'on';
  } else {
    root.style.removeProperty('--cc-activity-item-bg');
    root.dataset.ccActivityItemBg = 'off';
  }

  root.dataset.ccDarkMode = s.darkMode ? 'on' : 'off';
  root.dataset.ccSidebarLabelPos = s.sidebarLabelPosition || 'right';

  // Belt-and-suspenders: also paint backgrounds via inline styles, which
  // bypass Canvas's CSS cascade entirely.
  applyBgInline();
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

function normalize(items, s = settings) {
  let mapped = items
    .filter(it => RELEVANT_TYPES.has(it.plannable_type))
    .filter(it => !(s.widgetHideAnnouncements && it.plannable_type === 'announcement'))
    .filter(it => !(s.widgetHideDiscussions && it.plannable_type === 'discussion_topic'))
    .map(it => ({
      id: `${it.plannable_type}-${it.plannable_id}`,
      plannableId: it.plannable_id,
      courseId: it.course_id || it.context_id || null,
      title: it.plannable?.title || it.plannable?.name || 'Untitled',
      dueAt: it.plannable?.due_at || it.plannable?.todo_date || it.plannable_date,
      url: it.html_url || '#',
      contextName: it.context_name || '',
      contextCode: it.context_type && it.course_id ? `course_${it.course_id}` : (it.context_type === 'Course' && it.context_id ? `course_${it.context_id}` : ''),
      complete: isComplete(it),
      type: it.plannable_type,
    }));

  if (!s.widgetShowCompleted) mapped = mapped.filter(t => !t.complete);

  mapped.sort((a, b) => {
    switch (s.widgetSortBy) {
      case 'course':
        return (a.contextName || '').localeCompare(b.contextName || '');
      case 'type':
        return (a.type || '').localeCompare(b.type || '');
      case 'status':
        if (a.complete !== b.complete) return a.complete ? 1 : -1;
        return new Date(a.dueAt || 0) - new Date(b.dueAt || 0);
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
  switch (filter) {
    case 'overdue':
      return tasks.filter(t => !t.complete && t.dueAt && new Date(t.dueAt).getTime() < now);
    case 'due_soon':
      return tasks.filter(t => !t.complete && t.dueAt && new Date(t.dueAt).getTime() >= now && new Date(t.dueAt).getTime() <= h24);
    case 'this_week':
    case 'all':
    default:
      return tasks;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function groupByCourse(tasks) {
  const map = new Map();
  for (const t of tasks) {
    const key = t.contextCode || t.contextName || 'other';
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: t.contextName || 'Other',
        contextCode: t.contextCode,
        total: 0,
        done: 0,
      });
    }
    const g = map.get(key);
    g.total++;
    if (t.complete) g.done++;
  }
  return Array.from(map.values());
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
    return `
      <circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="none" stroke="${trackStroke}" stroke-width="${strokeW}"/>
      <circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/>
    `;
  }).join('');

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${rings}</svg>`;
}

function activityRingsMarkup(groups, colors, totalPct) {
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
  return `
    <div class="cc-progress-rings">
      <div class="cc-progress-rings-svg">
        ${activityRingsSvg(groups, colors)}
        <div class="cc-progress-rings-center">
          <div class="cc-progress-rings-pct">${totalPct}%</div>
        </div>
      </div>
      <div class="cc-progress-rings-legend">${legend}</div>
    </div>
  `;
}

function progressMarkup(style, done, total, pct, tasks, colors) {
  if (style === 'ring') {
    const groups = groupByCourse(tasks);
    return activityRingsMarkup(groups, colors || {}, pct);
  }
  if (style === 'segments') {
    const n = total || 1;
    const segs = Array.from({ length: n }, (_, i) => `<div class="cc-progress-seg${i < done ? ' done' : ''}"></div>`).join('');
    return `
      <div class="cc-progress-segments">${segs}</div>
      <div class="cc-progress-label">${pct}% complete</div>
    `;
  }
  return `
    <div class="cc-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
      <div class="cc-progress-bar" style="width:${pct}%"></div>
    </div>
    <div class="cc-progress-label">${pct}% complete</div>
  `;
}

function renderWidget(container, tasks, colors) {
  const total = tasks.length;
  const done = tasks.filter(t => t.complete).length;
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  const style = settings.widgetProgressStyle || 'bar';

  // Smart Folders: compute counts for each filter, apply active filter to list
  const now = Date.now();
  const h24 = now + 24 * 60 * 60 * 1000;
  const overdueCount = tasks.filter(t => !t.complete && t.dueAt && new Date(t.dueAt).getTime() < now).length;
  const dueSoonCount = tasks.filter(t => !t.complete && t.dueAt && new Date(t.dueAt).getTime() >= now && new Date(t.dueAt).getTime() <= h24).length;
  const activeFilter = settings.widgetFilter || 'all';
  const filtered = applyFilter(tasks, activeFilter);

  const filterPills = [
    { key: 'all',      label: 'All',      count: tasks.length },
    { key: 'overdue',  label: 'Overdue',  count: overdueCount },
    { key: 'due_soon', label: 'Due Soon', count: dueSoonCount },
  ].map(f => `
    <button class="cc-filter-pill${activeFilter === f.key ? ' active' : ''}" data-filter="${f.key}" type="button">
      ${f.label}${f.count > 0 ? `<span class="cc-filter-count">${f.count}</span>` : ''}
    </button>
  `).join('');

  const fractionHtml = settings.widgetShowFraction
    ? `<div class="cc-fraction">${done} / ${total} tasks</div>`
    : '';

  const listHtml = filtered.length === 0
    ? `<li class="cc-empty">${activeFilter === 'all' ? 'Nothing due this week. 🎉' : 'No tasks in this filter.'}</li>`
    : filtered.map(t => `
        <li class="cc-task ${t.complete ? 'cc-done' : ''}"
            data-plannable-id="${t.plannableId != null ? t.plannableId : ''}"
            data-course-id="${t.courseId != null ? escapeHtml(String(t.courseId)) : ''}"
            data-plannable-type="${escapeHtml(t.type)}">
          <a href="${escapeHtml(t.url)}" class="cc-task-link">
            <div class="cc-task-row">
              <span class="cc-check" aria-hidden="true">${t.complete ? '✓' : ''}</span>
              <div class="cc-task-body">
                <div class="cc-task-title">${escapeHtml(t.title)}</div>
                <div class="cc-task-meta">
                  <span class="cc-task-course">${escapeHtml(t.contextName)}</span>
                  <span class="cc-task-sep">•</span>
                  <span class="cc-task-type">${TYPE_LABEL[t.type] || t.type}</span>
                  ${t.dueAt ? `<span class="cc-task-sep">•</span><span class="cc-task-due">${escapeHtml(formatDue(t.dueAt))}</span>` : ''}
                </div>
              </div>
            </div>
          </a>
        </li>
      `).join('');

  const hideHeaderCount = style === 'ring';
  container.innerHTML = `
    <div class="cc-widget" data-style="${style}">
      <div class="cc-header">
        <h2 class="cc-title">This Week</h2>
        ${hideHeaderCount ? '' : `<span class="cc-count">${done}/${total}</span>`}
      </div>
      ${progressMarkup(style, done, total, pct, tasks, colors)}
      ${fractionHtml}
      <div class="cc-filters">${filterPills}</div>
      <ul class="cc-list">${listHtml}</ul>
    </div>
  `;
}

let inFlight = false;
let lastWidgetRaw = null; // { items, colors } — cached for instant re-renders

async function injectWidget() {
  if (!settings.extensionEnabled) return;
  if (!settings.widgetEnabled) return;
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);
  if (!sidebar) return;
  if (sidebar.querySelector(`#${WIDGET_ID}`)) return;

  const container = document.createElement('div');
  container.id = WIDGET_ID;
  container.innerHTML = `<div class="cc-widget"><div class="cc-header"><h2 class="cc-title">This Week</h2></div><div class="cc-loading">Loading tasks…</div></div>`;

  // Filter pill clicks — delegate on container so innerHTML re-renders don't lose the listener
  container.addEventListener('click', (e) => {
    const pill = e.target.closest('.cc-filter-pill');
    if (!pill) return;
    saveSettings({ widgetFilter: pill.dataset.filter }).then(() => rerenderWidget());
  });

  const native = sidebar.querySelector(NATIVE_SELECTOR);
  if (native) native.replaceWith(container);
  else sidebar.prepend(container);

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

// ---------- modal ----------

const TABS = [
  { id: 'general',      label: 'General' },
  { id: 'cards',        label: 'Card View' },
  { id: 'listview',     label: 'List View' },
  { id: 'sidebar',      label: 'Left Sidebar' },
  { id: 'widget',       label: 'Tasks Widget' },
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

// ---------- icon set ----------

const ICON_MAP = {
  'Dashboard':     'fa-home',
  'Courses':       'fa-graduation-cap',
  'Groups':        'fa-users',
  'Calendar':      'fa-calendar-alt',
  'Inbox':         'fa-envelope',
  'History':       'fa-history',
  'Studio':        'fa-play-circle',
  'Commons':       'fa-layer-group',
  'Notifications': 'fa-bell',
  'Help':          'fa-question-circle',
  'Account':       'fa-user-circle',
  'Settings':      'fa-cog',
  'Logout':        'fa-sign-out-alt',
  'Grades':        'fa-chart-bar',
  'Files':         'fa-folder',
};

function ensureIconSet() {
  if (document.getElementById('cc-icons-fa')) return;
  const pre = document.createElement('link');
  pre.rel = 'preconnect';
  pre.href = 'https://cdnjs.cloudflare.com';
  const link = document.createElement('link');
  link.id = 'cc-icons-fa';
  link.rel = 'stylesheet';
  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
  document.head.append(pre, link);
}

function applyIconSet() {
  if (!document.body) return;
  ensureIconSet();
  document.querySelectorAll('.ic-app-header__menu-list-item').forEach(li => {
    const link = li.querySelector('.ic-app-header__menu-list-link');
    if (!link) return;
    const labelEl = link.querySelector('.menu-item__text, [class*="menu-item__text"]');
    const label = labelEl ? labelEl.textContent.trim() : '';
    const faClass = ICON_MAP[label];
    if (!faClass) return;
    // Hide original SVGs
    link.querySelectorAll('svg, .ic-icon-svg').forEach(svg => svg.classList.add('cc-icon-hidden'));
    // Inject FA icon only once
    if (!link.querySelector('.cc-nav-icon')) {
      const icon = document.createElement('i');
      icon.className = `fas ${faClass} cc-nav-icon`;
      icon.setAttribute('aria-hidden', 'true');
      if (labelEl) link.insertBefore(icon, labelEl);
      else link.prepend(icon);
    }
  });
}

function removeIconSet() {
  document.querySelectorAll('.cc-nav-icon').forEach(el => el.remove());
  document.querySelectorAll('.cc-icon-hidden').forEach(el => el.classList.remove('cc-icon-hidden'));
}

// ---------- assignment previews (hover tooltip) ----------

const previewCache = new Map();
let previewTimer = null;
let tooltipEl = null;
let currentHoverTask = null;

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function buildTooltip(data) {
  const desc = data.description ? stripHtml(data.description) : '';
  const pts = data.points_possible != null ? `${data.points_possible} pts` : '';
  return `
    <div class="cc-tooltip-title">${escapeHtml(data.name || data.title || 'Assignment')}</div>
    ${desc ? `<div class="cc-tooltip-desc">${escapeHtml(desc)}${data.description && data.description.length > 200 ? '…' : ''}</div>` : ''}
    ${pts ? `<div class="cc-tooltip-pts">${escapeHtml(pts)}</div>` : ''}
  `;
}

function showTooltip(taskEl, html) {
  hideTooltip();
  tooltipEl = document.createElement('div');
  tooltipEl.id = 'cc-preview-tooltip';
  tooltipEl.innerHTML = html;
  document.body.appendChild(tooltipEl);
  const rect = taskEl.getBoundingClientRect();
  const ttW = 320;
  const ttH = tooltipEl.offsetHeight || 80;
  let top = rect.top - ttH - 8 + window.scrollY;
  if (rect.top - ttH - 8 < 8) top = rect.bottom + 8 + window.scrollY;
  let left = rect.left + window.scrollX;
  if (left + ttW > window.innerWidth - 8) left = window.innerWidth - ttW - 8 + window.scrollX;
  if (left < 8) left = 8;
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
  document.addEventListener('mouseover', async (e) => {
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
    if (!courseId || !plannableId || (type !== 'assignment' && type !== 'quiz')) return;
    previewTimer = setTimeout(async () => {
      const key = `${courseId}_${plannableId}`;
      let data = previewCache.get(key);
      if (!data) {
        try {
          const ep = type === 'quiz'
            ? `/api/v1/courses/${courseId}/quizzes/${plannableId}`
            : `/api/v1/courses/${courseId}/assignments/${plannableId}`;
          const res = await fetch(ep, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
          if (res.ok) { data = await res.json(); previewCache.set(key, data); }
        } catch {}
      }
      if (data && currentHoverTask === taskEl) showTooltip(taskEl, buildTooltip(data));
    }, 400);
  });
}

// ---------- command palette ----------

const PALETTE_ID = 'cc-palette-root';
let paletteData = null;
let paletteOpen = false;
let paletteSearchDebounce = null;

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
    if (score > 0) results.push({ type: 'assignment', name: a.title, subtitle: a.courseName, url: a.url, score, atype: a.type });
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
    list.innerHTML = `<div class="cc-pal-empty">${query ? 'No results.' : 'Type to search courses and assignments…'}</div>`;
    return;
  }
  const courseIcon = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`;
  const taskIcon  = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>`;
  let html = '';
  let lastType = null;
  results.forEach((r, i) => {
    if (r.type !== lastType) {
      lastType = r.type;
      html += `<div class="cc-pal-section-header">${r.type === 'course' ? 'Courses' : 'Assignments'}</div>`;
    }
    html += `
      <button class="cc-pal-item${i === 0 ? ' cc-pal-active' : ''}" data-url="${escapeHtml(r.url)}" data-idx="${i}" type="button">
        <span class="cc-pal-icon">${r.type === 'course' ? courseIcon : taskIcon}</span>
        <div class="cc-pal-text">
          <div class="cc-pal-name">${highlightMatch(r.name, query)}</div>
          ${r.subtitle ? `<div class="cc-pal-sub">${escapeHtml(r.subtitle)}</div>` : ''}
        </div>
        <span class="cc-pal-badge">${r.type === 'course' ? 'Course' : (TYPE_LABEL[r.atype] || 'Task')}</span>
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
        <input id="cc-palette-input" type="text" placeholder="Search courses and assignments…" autocomplete="off" spellcheck="false">
      </div>
      <div id="cc-palette-list"><div class="cc-pal-empty">Type to search courses and assignments…</div></div>
      <div class="cc-pal-footer"><span>↑↓ Navigate</span><span>↵ Open</span><span>Esc Close</span></div>
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
      if (active) { location.href = active.dataset.url; closePalette(); }
      return;
    } else if (e.key === 'Escape') {
      closePalette(); return;
    } else { return; }
    items.forEach(item => item.classList.toggle('cc-pal-active', parseInt(item.dataset.idx, 10) === idx));
    items[idx]?.scrollIntoView({ block: 'nearest' });
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
  const input = root.querySelector('#cc-palette-input');
  if (input) { input.value = ''; input.focus(); }
  renderPaletteResults([], '');
}

function closePalette() {
  const root = document.getElementById(PALETTE_ID);
  if (root) root.classList.remove('open');
  paletteOpen = false;
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

function row(label, control, hint = '') {
  return `
    <div class="cc-row">
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
        row('Dark mode', toggleControl('darkMode'), 'Force a dark theme across all Canvas pages.'),
      ]},
      { title: 'Productivity', rows: [
        row('Command palette', toggleControl('commandPaletteEnabled'), 'Press Ctrl+K (or ⌘K) to instantly search courses and assignments.'),
      ]},
      { title: 'Background', rows: [
        row('Color', colorControl('bgColor', '#ffffff'), 'Leave default to keep Canvas\'s background.'),
        row('Image URL', textControl('bgImage', 'https://...'), 'Paste a direct image URL.'),
        row('Image blur', rangeControl('bgBlur', 0, 20, 1, 'px')),
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
        row('Accent color', colorControl('modalAccentColor', '#fc5050'), 'Used for active tab text, selected dropdown options, toggles, and sliders inside this modal.'),
      ]},
    ],
  };
}

function previewCards() {
  // Each card: course color, image gradient, full name (colored), short code (gray), term, action icons
  const assignIcon = `<svg viewBox="0 0 1920 1920" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M1807 1920H113C50.9 1920 0 1869.1 0 1807V113C0 50.9 50.9 0 113 0h1694c62.1 0 113 50.9 113 113v1694c0 62.1-50.9 113-113 113zm-56.5-169.5v-1581H169.5v1581h1581zM338 1468.5h1244v169.5H338v-169.5zm0-338h1244v169.5H338V1130zm0-338h1244v169.5H338V792zm0-338h1244v169.5H338V454z"/></svg>`;
  const discIcon  = `<svg viewBox="0 0 1920 1920" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M1920 1468.5c0 62-50.9 112.9-113 112.9h-338v225.8c0 62.1-50.9 113-113 113-30 0-58.6-11.9-79.7-33L831.6 1581.4H113C50.9 1581.4 0 1530.5 0 1468.5V113C0 50.9 50.9 0 113 0h1694c62.1 0 113 50.9 113 113v1355.5z"/></svg>`;
  const cards = [
    { name: 'Linear Algebra',    code: 'MATH 314',  term: 'Spring 2026', color: '#0084c7', img: 'linear-gradient(160deg,#0084c7 0%,#00c389 100%)', icons: [assignIcon, discIcon] },
    { name: 'Database Design',   code: 'CSCE 451',  term: 'Spring 2026', color: '#9c27b0', img: 'linear-gradient(160deg,#9c27b0 0%,#ff5722 100%)', icons: [assignIcon] },
    { name: 'Business Strategy', code: 'MGMT 411',  term: 'Spring 2026', color: '#e67e22', img: 'linear-gradient(160deg,#e67e22 0%,#f1c40f 100%)', icons: [assignIcon, discIcon] },
    { name: 'Discrete Math',     code: 'MATH 208',  term: 'Spring 2026', color: '#16a085', img: 'linear-gradient(160deg,#16a085 0%,#2ecc71 100%)', icons: [assignIcon] },
    { name: 'Operating Systems', code: 'CSCE 351',  term: 'Spring 2026', color: '#c0392b', img: 'linear-gradient(160deg,#c0392b 0%,#d35400 100%)', icons: [assignIcon, discIcon] },
    { name: 'World History',     code: 'HIST 201',  term: 'Spring 2026', color: '#2c3e50', img: 'linear-gradient(160deg,#2c3e50 0%,#7f8c8d 100%)', icons: [assignIcon] },
  ];
  return `
    <div class="cc-preview-card-grid">
      ${cards.map(c => `
        <div class="cc-preview-card">
          <div class="cc-preview-card-header" style="background:${c.color};">
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
        row('Text color', colorControl('cardTextColor', '#2d3b45'), 'Text on each card. Leave unset to use Canvas\'s default.'),
        row('Accent color', colorControl('accentColor', '#008ee2'), 'Used for links, buttons, and progress bars.'),
      ]},
      { title: 'Style', rows: [
        row('Density', selectControl('density', [
          { value: 'compact', label: 'Compact' },
          { value: 'cozy', label: 'Cozy' },
          { value: 'comfortable', label: 'Comfortable' },
        ]), 'Card View only.'),
        row('Border radius', rangeControl('borderRadius', 0, 20, 1, 'px'), 'Global roundness for buttons and inputs.'),
      ]},
      { title: 'Shape', rows: [
        row('Corner radius', rangeControl('cardRadius', 0, 24, 1, 'px'), 'Applies to cards and planner items.'),
        row('Shadow', selectControl('cardShadow', [
          { value: 'none', label: 'None' },
          { value: 'soft', label: 'Soft' },
          { value: 'strong', label: 'Strong' },
        ]), 'Applies to cards and planner items.'),
      ]},
      { title: 'Image', rows: [
        row('Show card image', toggleControl('cardShowImage'), 'Card View only. Hide to show only the course color block.'),
        row('Image opacity', rangeControl('cardImageOpacity', 0, 1, 0.05), 'Card View only.'),
      ]},
      { title: 'Layout', rows: [
        row('Header height', rangeControl('cardHeaderHeight', 60, 200, 5, 'px'), 'Card View only.'),
      ]},
    ],
  };
}

function previewListView() {
  const assignSvg = `<svg viewBox="0 0 1920 1920" width="13" height="13" fill="currentColor"><path d="M1807 1920H113C50.9 1920 0 1869.1 0 1807V113C0 50.9 50.9 0 113 0h1694c62.1 0 113 50.9 113 113v1694c0 62.1-50.9 113-113 113zm-56.5-169.5v-1581H169.5v1581h1581zM338 1468.5h1244v169.5H338v-169.5zm0-338h1244v169.5H338V1130zm0-338h1244v169.5H338V792zm0-338h1244v169.5H338V454z"/></svg>`;
  const discSvg   = `<svg viewBox="0 0 1920 1920" width="13" height="13" fill="currentColor"><path d="M1920 1468.5c0 62-50.9 112.9-113 112.9h-338v225.8c0 62.1-50.9 113-113 113-30 0-58.6-11.9-79.7-33L831.6 1581.4H113C50.9 1581.4 0 1530.5 0 1468.5V113C0 50.9 50.9 0 113 0h1694c62.1 0 113 50.9 113 113v1355.5z"/></svg>`;

  const days = [
    {
      label: 'YESTERDAY', date: 'Monday, July 30',
      items: [
        { badge: 'INTRO TO PSYCH',  color: '#c0392b', typeLabel: 'INTRODUCTION TO PSYCHOLOGY ASSIGNMENT', title: 'Paper #2: Brains and Behavior',  icon: assignSvg, status: 'MISSING', due: 'DUE: 9:59 PM',  done: false },
        { badge: 'MUSIC THEORY',    color: '#2980b9', typeLabel: 'MUSIC THEORY DISCUSSION',               title: 'Pitch yourself!',                icon: discSvg,   status: 'MISSING', due: 'DUE: 9:59 PM',  done: false },
      ],
    },
    {
      label: 'TODAY', date: 'Tuesday, July 31',
      items: [
        { badge: 'AMERICAN HISTORY',color: '#27ae60', typeLabel: 'AMERICAN HISTORY ASSIGNMENT',           title: 'Position Paper',                 icon: assignSvg, status: '',        due: 'DUE: 11:00 PM', done: false },
        { badge: 'CHEMISTRY',       color: '#1a5276', typeLabel: 'CHEMISTRY PAGE',                        title: 'Day 13 skills review',           icon: assignSvg, status: '',        due: 'DUE: 11:59 PM', done: true  },
      ],
    },
  ];

  const chk = (done) => `<div class="cc-preview-lv-chk${done ? ' cc-preview-lv-chk--done' : ''}"></div>`;

  return `
    <div class="cc-preview-listview">
      ${days.map(day => `
        <div class="cc-preview-lv-day">
          <div class="cc-preview-lv-day-hdr">
            <span class="cc-preview-lv-day-name">${day.label}</span>
            <span class="cc-preview-lv-day-date">${day.date}</span>
          </div>
          ${day.items.map(it => `
            <div class="cc-preview-lv-row${it.done ? ' cc-preview-lv-row--done' : ''}" style="border-left-color:${it.color};">
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
          `).join('')}
        </div>
      `).join('')}
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
    </div>
  `;
}

function tabListView() {
  return {
    title: 'List View',
    desc: 'Customize the Planner (List View) and Recent Activity dashboard views.',
    preview: previewListView(),
    groups: [
      { title: 'Item Style', rows: [
        row('Background', colorControl('plannerItemBg', '#ffffff'), 'Background of each planner item row. Leave unset to use Canvas\'s default.'),
        row('Text color', colorControl('plannerItemTextColor', '#2d3b45'), 'Title and meta text on each item.'),
        row('Accent bar width', rangeControl('plannerBarWidth', 0, 12, 1, 'px'), 'Width of the colored left stripe showing the course color.'),
        row('Item spacing', rangeControl('plannerItemSpacing', 4, 24, 2, 'px'), 'Gap between items in the list.'),
      ]},
      { title: 'Day Headers', rows: [
        row('Background', colorControl('plannerDayBg', '#f5f5f5'), 'Background of each day\'s header strip.'),
        row('Text color', colorControl('plannerDayTextColor', '#2d3b45'), 'Color of the date label in each day header.'),
      ]},
      { title: 'Completed Items', rows: [
        row('Opacity', rangeControl('plannerDoneOpacity', 20, 100, 5, '%'), 'How faded completed items appear. Lower = more muted.'),
      ]},
      { title: 'Recent Activity', rows: [
        row('Item background', colorControl('activityItemBg', '#ffffff'), 'Background of each activity feed item.'),
      ]},
    ],
  };
}

function previewSidebar() {
  const items = [
    { label: 'Account', icon: 'M12 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 12c4 0 8 2 8 6v2H4v-2c0-4 4-6 8-6z' },
    { label: 'Dashboard', icon: 'M3 3h8v8H3V3zm10 0h8v5h-8V3zm0 7h8v11h-8V10zM3 13h8v8H3v-8z' },
    { label: 'Courses', icon: 'M4 4h16v3H4V4zm0 5h16v3H4V9zm0 5h16v3H4v-3zm0 5h16v2H4v-2z' },
    { label: 'Calendar', icon: 'M19 4h-2V2h-2v2H9V2H7v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z' },
    { label: 'Inbox', icon: 'M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z' },
  ];
  return `
    <div class="cc-preview-sidebar-frame">
      ${items.map((it, i) => `
        <div class="cc-preview-sidebar-item ${i === 1 ? 'active' : ''}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${it.icon}" fill="currentColor"/></svg>
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
        row('Enable sidebar restyle', toggleControl('sidebarRestyle'), 'Tighter spacing, rounded active state.'),
        row('Show labels', toggleControl('sidebarShowLabels'), 'Turn off to show icons only.'),
        row('Label position', selectControl('sidebarLabelPosition', [
          { value: 'right', label: 'Right of icon' },
          { value: 'left',  label: 'Left of icon' },
        ]), 'Move labels left for a compact layout — auto-shrinks icons 20%.'),
      ]},
      { title: 'Icons', rows: [
        row('Icon set', selectControl('iconSet', [
          { value: 'default',     label: 'Default (Canvas)' },
          { value: 'fontawesome', label: 'FontAwesome' },
        ]), 'Swap nav icons. FontAwesome is loaded from a CDN.'),
      ]},
      { title: 'Colors', rows: [
        row('Background', colorControl('sidebarBgColor', detected.bg), 'The sidebar\'s main fill color.'),
        row('Text & icons', colorControl('sidebarTextColor', detected.text), 'Color of labels and SVG icons.'),
        row('Active item background', colorControl('sidebarActiveColor', detected.activeBg), 'Background of the currently selected nav item.'),
        row('Active item text', colorControl('sidebarActiveTextColor', detected.activeText), 'Text and icon color of the currently selected nav item.'),
      ]},
      { title: 'Sizing', rows: [
        row('Icon size', rangeControl('sidebarIconSize', 14, 32, 1, 'px')),
        row('Label size', rangeControl('sidebarLabelSize', 8, 14, 1, 'px')),
      ]},
    ],
  };
}

function previewWidget() {
  const sample = [
    { title: 'Linear Algebra HW 8', type: 'assignment', course: 'MATH 314', complete: false },
    { title: 'Database Lab 4',      type: 'assignment', course: 'CSCE 451', complete: false },
    { title: 'Weekly Announcement', type: 'announcement', course: 'BSAD 411', complete: false },
    { title: 'Discussion: Ch. 16',  type: 'discussion_topic', course: 'MGMT 311', complete: false },
    { title: 'Quiz 11',              type: 'quiz', course: 'MATH 314', complete: true },
    { title: 'Case Study 3',         type: 'assignment', course: 'BSAD 411', complete: true },
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
  } else if (style === 'segments') {
    const n = Math.max(total, 1);
    const segs = Array.from({ length: n }, (_, i) => `<div class="cc-preview-widget-seg${i < done ? ' done' : ''}"></div>`).join('');
    progress = `<div class="cc-preview-widget-segments">${segs}</div>`;
  } else {
    progress = `<div class="cc-preview-widget-bar"><div class="cc-preview-widget-fill" style="width:${pct}%"></div></div>`;
  }

  // Cap the preview list so the card always fits in the preview column,
  // even with ring mode + legend taking extra vertical space.
  const maxListItems = style === 'ring' ? 3 : 4;
  const rows = items.length === 0
    ? `<div class="cc-preview-widget-empty">Nothing to show. 🎉</div>`
    : items.slice(0, maxListItems).map(i => `
        <div class="cc-preview-widget-item ${i.complete ? 'done' : ''}">
          <div class="cc-preview-widget-check ${i.complete ? 'checked' : ''}">${i.complete ? '✓' : ''}</div>
          <div>${i.title}</div>
        </div>
      `).join('');

  const hideHeaderCount = style === 'ring';
  return `
    <div class="cc-preview-widget-frame" data-style="${style}">
      <div class="cc-preview-widget-header">
        <div class="cc-preview-widget-title">This Week</div>
        ${hideHeaderCount ? '' : `<div class="cc-preview-widget-count">${done}/${total}</div>`}
      </div>
      ${progress}
      <div class="cc-preview-widget-list">${rows}</div>
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
        row('Enable widget', toggleControl('widgetEnabled'), 'Turn off to keep Canvas\'s default To Do list.'),
      ]},
      { title: 'Progress', rows: [
        row('Style', selectControl('widgetProgressStyle', [
          { value: 'bar',      label: 'Bar' },
          { value: 'ring',     label: 'Ring' },
          { value: 'segments', label: 'Segments' },
        ])),
        row('Show fraction', toggleControl('widgetShowFraction'), 'Display "done / total tasks" below the progress indicator.'),
      ]},
      { title: 'Sort', rows: [
        row('Sort by', selectControl('widgetSortBy', [
          { value: 'dueDate', label: 'Due date' },
          { value: 'status',  label: 'Status' },
          { value: 'course',  label: 'Course' },
          { value: 'type',    label: 'Type' },
        ])),
      ]},
      { title: 'Filters', rows: [
        row('Default view', selectControl('widgetFilter', [
          { value: 'all',       label: 'All tasks' },
          { value: 'overdue',   label: 'Overdue' },
          { value: 'due_soon',  label: 'Due in 24h' },
          { value: 'this_week', label: 'This week' },
        ]), 'Which smart folder is active when the dashboard loads.'),
        row('Show completed', toggleControl('widgetShowCompleted')),
        row('Hide announcements', toggleControl('widgetHideAnnouncements')),
        row('Hide discussions', toggleControl('widgetHideDiscussions')),
      ]},
      { title: 'Previews', rows: [
        row('Assignment previews', toggleControl('assignmentPreviewsEnabled'), 'Hover a task to see its description and point value.'),
      ]},
    ],
  };
}

function tabIntegrations() {
  return {
    title: 'Integrations',
    desc: 'Connect Canvas Enhancer to external services.',
    preview: null,
    groups: [
      { title: 'Google Calendar', rows: [
        row('Sync to Google Calendar',
          `<button class="cc-btn-disabled" disabled>Sync now <span class="cc-soon-badge">Coming soon</span></button>`,
          'Push Canvas assignments to your Google Calendar. OAuth2 setup coming in a future update.'),
        row('Auto-sync new assignments',
          `<label class="cc-toggle cc-disabled" aria-disabled="true"><input type="checkbox" disabled tabindex="-1"><span class="cc-toggle-track"><span class="cc-toggle-thumb"></span></span></label>`,
          'Automatically add new due dates. Requires sync to be configured first.'),
      ]},
    ],
  };
}

const TAB_RENDERERS = {
  general:      tabGeneral,
  cards:        tabCards,
  listview:     tabListView,
  sidebar:      tabSidebar,
  widget:       tabWidget,
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

  pane.innerHTML = `
    <div class="cc-pane-layout${hasPreview ? '' : ' cc-pane-layout--full'}">
      ${previewCol}
      <section class="cc-controls-col">
        <h2 class="cc-pane-title">${cfg.title}</h2>
        ${cfg.groups.map(g => `
          <div class="cc-section">
            <div class="cc-section-title">${g.title}</div>
            <div class="cc-section-rows">
              ${g.rows.join('')}
            </div>
          </div>
        `).join('')}
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
          const key = el.dataset.setting;
          const value = opt.dataset.value;
          el.dataset.value = value;
          label.textContent = opt.textContent.trim();
          menu.querySelectorAll('.cc-select-option').forEach(o => o.classList.toggle('selected', o === opt));
          setSelectState(el, false);
          await saveSettings({ [key]: value });
          applySettings(settings);
          if (PREVIEW_REACTIVE_KEYS.has(key)) refreshPreview();
          if (WIDGET_RERENDER_KEYS.has(key)) rerenderWidget();
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

      // Special: if widget toggle changed, inject or remove
      if (key === 'widgetEnabled') {
        if (value) injectWidget();
        else {
          const w = document.getElementById(WIDGET_ID);
          if (w) w.remove();
        }
      }

      // Re-render the preview when it needs to reflect the new setting
      // (progress style, filters, sort, card theme — things CSS vars can't fix on their own)
      if (PREVIEW_REACTIVE_KEYS.has(key)) refreshPreview();

      // Re-render the real widget to pick up progress / sort / filter changes
      if (WIDGET_RERENDER_KEYS.has(key)) rerenderWidget();
    });
  });

  postRenderTabPane();
}

// Called after renderTabPane finishes wiring controls. Runs post-render
// side-effects like re-syncing sidebar picker fallbacks once Canvas's
// active-item styles are applied.
function postRenderTabPane() {
  if (currentTab === 'sidebar') {
    syncSidebarPickerFallbacks();
    // Canvas sometimes delays applying --active styles — re-run once
    // after a frame and once after 120ms to catch late updates.
    requestAnimationFrame(syncSidebarPickerFallbacks);
    setTimeout(syncSidebarPickerFallbacks, 120);
  }
}

const PREVIEW_REACTIVE_KEYS = new Set([
  'widgetProgressStyle', 'widgetSortBy', 'widgetShowCompleted',
  'widgetHideAnnouncements', 'widgetHideDiscussions',
  'widgetShowFraction', 'widgetFilter',
]);

const WIDGET_RERENDER_KEYS = new Set([
  'widgetProgressStyle', 'widgetSortBy', 'widgetShowCompleted',
  'widgetHideAnnouncements', 'widgetHideDiscussions',
  'widgetShowFraction', 'widgetFilter',
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

// ---------- routing & observation ----------

function isDashboard() {
  const p = location.pathname;
  return p === '/' || p === '' || p === '/dashboard' || p.startsWith('/?');
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

function tick() {
  if (!settings.extensionEnabled) return;
  applyDashboardView();
  if (isDashboard()) injectWidget();
  if (settings.bgColor) applyBgInline();
  if (settings.iconSet && settings.iconSet !== 'default') applyIconSet();
  else if (document.querySelector('.cc-nav-icon')) removeIconSet();
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

// Phase 2 — runs once DOM is parsed. Observer, widget, inline bg sweep.
function domInit() {
  if (settings.extensionEnabled) applyBgInline();
  observer.observe(document.documentElement, { childList: true, subtree: true });
  tick();

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
