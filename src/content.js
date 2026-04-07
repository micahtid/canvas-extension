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
  // Course cards
  cardRadius: 8,
  cardShadow: 'soft',         // 'none' | 'soft' | 'strong'
  cardShowImage: true,
  cardImageOpacity: 1.0,
  cardHeaderHeight: 110,
  cardColumns: 'auto',        // 'auto' | '2' | '3' | '4' | '5'
  cardGap: 18,
  cardTheme: 'default',       // 'default' | 'pastel' | 'mono' | 'vibrant' | 'dark' | 'warm' | 'cool'

  // Left sidebar (the global Canvas nav)
  sidebarRestyle: true,
  sidebarIconSize: 22,
  sidebarLabelSize: 10,
  sidebarShowLabels: true,

  // Theme
  accentColor: '#008ee2',
  density: 'cozy',            // 'compact' | 'cozy' | 'comfortable'
  borderRadius: 8,            // global radius for buttons/inputs/panels

  // Background
  bgColor: '',
  bgImage: '',
  bgBlur: 0,

  // Weekly Tasks widget
  widgetEnabled: true,
  widgetProgressStyle: 'bar', // 'bar' | 'ring' | 'segments'
  widgetSortBy: 'dueDate',    // 'dueDate' | 'status' | 'course' | 'type'
  widgetShowCompleted: true,
  widgetHideAnnouncements: false,
  widgetHideDiscussions: false,
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

function applySettings(s) {
  const root = document.documentElement;
  const set = (k, v) => root.style.setProperty(k, v);

  set('--cc-card-radius', s.cardRadius + 'px');
  set('--cc-card-image-opacity', String(s.cardImageOpacity));
  set('--cc-card-header-height', s.cardHeaderHeight + 'px');
  set('--cc-card-gap', s.cardGap + 'px');

  set('--cc-sidebar-icon-size', s.sidebarIconSize + 'px');
  set('--cc-sidebar-label-size', s.sidebarLabelSize + 'px');

  set('--cc-accent', s.accentColor);
  set('--cc-radius', s.borderRadius + 'px');

  set('--cc-bg-color', s.bgColor || 'transparent');
  set('--cc-bg-image', s.bgImage ? `url("${s.bgImage.replace(/"/g, '\\"')}")` : 'none');
  set('--cc-bg-blur', s.bgBlur + 'px');

  root.dataset.ccCardShadow = s.cardShadow;
  root.dataset.ccCardImage = s.cardShowImage ? 'shown' : 'hidden';
  root.dataset.ccCardColumns = s.cardColumns;
  root.dataset.ccCardTheme = s.cardTheme;
  root.dataset.ccSidebarRestyle = s.sidebarRestyle ? 'on' : 'off';
  root.dataset.ccSidebarLabels = s.sidebarShowLabels ? 'on' : 'off';
  root.dataset.ccDensity = s.density;
  root.dataset.ccBgImage = s.bgImage ? 'on' : 'off';
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
      title: it.plannable?.title || it.plannable?.name || 'Untitled',
      dueAt: it.plannable?.due_at || it.plannable?.todo_date || it.plannable_date,
      url: it.html_url || '#',
      contextName: it.context_name || '',
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function progressMarkup(style, done, total, pct) {
  if (style === 'ring') {
    const r = 22;
    const c = Math.round(2 * Math.PI * r * 1000) / 1000;
    const offset = Math.round(c * (1 - pct / 100) * 1000) / 1000;
    return `
      <div class="cc-progress-ring">
        <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
          <circle cx="28" cy="28" r="${r}" fill="none" stroke="#eef1f3" stroke-width="5"/>
          <circle cx="28" cy="28" r="${r}" fill="none" stroke="url(#cc-ring-grad)" stroke-width="5" stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(-90 28 28)"/>
          <defs><linearGradient id="cc-ring-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#008ee2"/><stop offset="100%" stop-color="#00c389"/></linearGradient></defs>
        </svg>
        <div class="cc-progress-ring-text">
          <div class="cc-progress-ring-pct">${pct}%</div>
          <div class="cc-progress-ring-count">${done}/${total}</div>
        </div>
      </div>
    `;
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

function renderWidget(container, tasks) {
  const total = tasks.length;
  const done = tasks.filter(t => t.complete).length;
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  const style = settings.widgetProgressStyle || 'bar';

  const listHtml = tasks.length === 0
    ? `<li class="cc-empty">Nothing due this week. 🎉</li>`
    : tasks.map(t => `
        <li class="cc-task ${t.complete ? 'cc-done' : ''}">
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

  container.innerHTML = `
    <div class="cc-widget">
      <div class="cc-header">
        <h2 class="cc-title">This Week</h2>
        <span class="cc-count">${done}/${total}</span>
      </div>
      ${progressMarkup(style, done, total, pct)}
      <ul class="cc-list">${listHtml}</ul>
    </div>
  `;
}

let inFlight = false;
async function injectWidget() {
  if (!settings.widgetEnabled) return;
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);
  if (!sidebar) return;
  if (sidebar.querySelector(`#${WIDGET_ID}`)) return;

  const container = document.createElement('div');
  container.id = WIDGET_ID;
  container.innerHTML = `<div class="cc-widget"><div class="cc-header"><h2 class="cc-title">This Week</h2></div><div class="cc-loading">Loading tasks…</div></div>`;

  const native = sidebar.querySelector(NATIVE_SELECTOR);
  if (native) native.replaceWith(container);
  else sidebar.prepend(container);

  if (inFlight) return;
  inFlight = true;
  try {
    const items = await fetchPlannerItems();
    const tasks = normalize(items);
    const live = document.getElementById(WIDGET_ID);
    if (live) renderWidget(live, tasks);
  } catch (err) {
    const live = document.getElementById(WIDGET_ID);
    if (live) live.querySelector('.cc-widget').innerHTML += `<div class="cc-error">Failed to load: ${escapeHtml(err.message)}</div>`;
  } finally {
    inFlight = false;
  }
}

// ---------- modal ----------

const TABS = [
  { id: 'cards', label: 'Course Cards' },
  { id: 'sidebar', label: 'Left Sidebar' },
  { id: 'theme', label: 'Theme' },
  { id: 'widget', label: 'Tasks Widget' },
];

let currentTab = 'cards';

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
          <div>
            <h1 id="cc-modal-title">Custom Canvas</h1>
            <p class="cc-modal-subtitle">Customize how Canvas looks</p>
          </div>
        </div>
        <button class="cc-modal-close" aria-label="Close customization panel">×</button>
      </header>
      <div class="cc-modal-body">
        <nav class="cc-modal-tabs" role="tablist">
          ${TABS.map(t => `
            <button role="tab" data-tab="${t.id}" class="cc-tab ${t.id === currentTab ? 'active' : ''}">${t.label}</button>
          `).join('')}
        </nav>
        <div class="cc-modal-pane" role="tabpanel"></div>
      </div>
      <footer class="cc-modal-footer">
        <button class="cc-btn cc-btn-ghost" id="cc-reset-btn">Reset all to defaults</button>
        <span class="cc-saved" id="cc-saved-indicator">Changes saved automatically</span>
      </footer>
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
      openSelect.classList.remove('open');
      openSelect.querySelector('.cc-select-trigger')?.setAttribute('aria-expanded', 'false');
      return;
    }
    if (root.classList.contains('open')) closeModal();
  });

  // Click outside any open dropdown closes it
  root.addEventListener('click', (e) => {
    const openSelects = root.querySelectorAll('.cc-select.open');
    openSelects.forEach(s => {
      if (!s.contains(e.target)) {
        s.classList.remove('open');
        s.querySelector('.cc-select-trigger')?.setAttribute('aria-expanded', 'false');
      }
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
      <div class="cc-select-menu" role="listbox">
        ${options.map(o => `
          <button type="button" role="option" class="cc-select-option ${String(o.value) === String(current.value) ? 'selected' : ''}" data-value="${escapeHtml(String(o.value))}">${escapeHtml(o.label)}</button>
        `).join('')}
      </div>
    </div>
  `;
}

function toggleControl(key) {
  return `<label class="cc-toggle"><input type="checkbox" data-setting="${key}" ${settings[key] ? 'checked' : ''}><span class="cc-toggle-track"><span class="cc-toggle-thumb"></span></span></label>`;
}

function colorControl(key) {
  return `<input type="color" data-setting="${key}" value="${settings[key] || '#000000'}">`;
}

function textControl(key, placeholder = '') {
  return `<input type="text" data-setting="${key}" value="${escapeHtml(settings[key] || '')}" placeholder="${escapeHtml(placeholder)}">`;
}

function previewCards() {
  const cards = [
    { title: 'Linear Algebra', code: 'MATH 314', color: '#0084c7', img: 'linear-gradient(135deg, #0084c7 0%, #00c389 100%)' },
    { title: 'Database Design', code: 'CSCE 451', color: '#9c27b0', img: 'linear-gradient(135deg, #9c27b0 0%, #ff5722 100%)' },
    { title: 'Business Strategy', code: 'MGMT 411', color: '#e67e22', img: 'linear-gradient(135deg, #e67e22 0%, #f1c40f 100%)' },
  ];
  return `
    <div class="cc-preview cc-preview-cards">
      <div class="cc-preview-label">Live preview</div>
      <div class="cc-preview-card-grid">
        ${cards.map(c => `
          <div class="cc-preview-card">
            <div class="cc-preview-card-header" style="background: ${c.color};">
              <div class="cc-preview-card-image" style="background-image: ${c.img};"></div>
            </div>
            <div class="cc-preview-card-body">
              <div class="cc-preview-card-code" style="color: ${c.color};">${c.code}</div>
              <div class="cc-preview-card-title">${c.title}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function tabCards() {
  return {
    title: 'Course Cards',
    desc: 'Customize how course cards look on the dashboard.',
    preview: previewCards(),
    groups: [
      { title: 'Theme', rows: [
        row('Color scheme', selectControl('cardTheme', [
          { value: 'default', label: 'Default' },
          { value: 'pastel', label: 'Pastel' },
          { value: 'mono', label: 'Monochrome' },
          { value: 'vibrant', label: 'Vibrant' },
          { value: 'warm', label: 'Warm' },
          { value: 'cool', label: 'Cool' },
          { value: 'dark', label: 'Dark' },
        ]), 'Applies a filter to card images and retints the palette.'),
      ]},
      { title: 'Shape', rows: [
        row('Corner radius', rangeControl('cardRadius', 0, 24, 1, 'px')),
        row('Shadow', selectControl('cardShadow', [
          { value: 'none', label: 'None' },
          { value: 'soft', label: 'Soft' },
          { value: 'strong', label: 'Strong' },
        ])),
      ]},
      { title: 'Image', rows: [
        row('Show card image', toggleControl('cardShowImage'), 'Hide to show only the course color block.'),
        row('Image opacity', rangeControl('cardImageOpacity', 0, 1, 0.05)),
      ]},
      { title: 'Layout', rows: [
        row('Columns', selectControl('cardColumns', [
          { value: 'auto', label: 'Auto' },
          { value: '2', label: '2' },
          { value: '3', label: '3' },
          { value: '4', label: '4' },
          { value: '5', label: '5' },
        ])),
        row('Gap between cards', rangeControl('cardGap', 4, 40, 2, 'px')),
        row('Header height', rangeControl('cardHeaderHeight', 60, 200, 5, 'px')),
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
    <div class="cc-preview cc-preview-sidebar">
      <div class="cc-preview-label">Live preview</div>
      <div class="cc-preview-sidebar-frame">
        ${items.map((it, i) => `
          <div class="cc-preview-sidebar-item ${i === 1 ? 'active' : ''}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${it.icon}" fill="currentColor"/></svg>
            <div class="cc-preview-sidebar-label">${it.label}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function tabSidebar() {
  return {
    title: 'Left Sidebar',
    desc: 'The global Canvas navigation column.',
    preview: previewSidebar(),
    groups: [
      { title: 'Visibility', rows: [
        row('Enable sidebar restyle', toggleControl('sidebarRestyle'), 'Tighter spacing, rounded active state.'),
        row('Show labels', toggleControl('sidebarShowLabels'), 'Turn off to show icons only.'),
      ]},
      { title: 'Sizing', rows: [
        row('Icon size', rangeControl('sidebarIconSize', 14, 32, 1, 'px')),
        row('Label size', rangeControl('sidebarLabelSize', 8, 14, 1, 'px')),
      ]},
    ],
  };
}

function previewTheme() {
  return `
    <div class="cc-preview cc-preview-theme">
      <div class="cc-preview-label">Live preview</div>
      <div class="cc-preview-theme-grid">
        <button class="cc-preview-btn-primary">Primary action</button>
        <button class="cc-preview-btn-secondary">Secondary</button>
        <a class="cc-preview-link" href="#" onclick="return false;">Sample link</a>
        <input class="cc-preview-input" type="text" placeholder="Text input">
      </div>
    </div>
  `;
}

function tabTheme() {
  return {
    title: 'Theme',
    desc: 'Global accent color, density, and roundness.',
    preview: previewTheme(),
    groups: [
      { title: 'Color', rows: [
        row('Accent color', colorControl('accentColor'), 'Used for links, buttons, and progress bars.'),
      ]},
      { title: 'Style', rows: [
        row('Density', selectControl('density', [
          { value: 'compact', label: 'Compact' },
          { value: 'cozy', label: 'Cozy' },
          { value: 'comfortable', label: 'Comfortable' },
        ])),
        row('Border radius', rangeControl('borderRadius', 0, 20, 1, 'px')),
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
    const r = 22;
    const c = Math.round(2 * Math.PI * r * 1000) / 1000;
    const offset = Math.round(c * (1 - pct / 100) * 1000) / 1000;
    progress = `
      <div class="cc-preview-widget-ring">
        <svg width="56" height="56" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="${r}" fill="none" stroke="#eef1f3" stroke-width="5"/>
          <circle cx="28" cy="28" r="${r}" fill="none" stroke="url(#cc-preview-ring-grad)" stroke-width="5" stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(-90 28 28)"/>
          <defs><linearGradient id="cc-preview-ring-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="var(--cc-accent, #008ee2)"/><stop offset="100%" stop-color="#00c389"/></linearGradient></defs>
        </svg>
        <div class="cc-preview-widget-ring-text"><div class="cc-preview-widget-ring-pct">${pct}%</div></div>
      </div>
    `;
  } else if (style === 'segments') {
    const n = Math.max(total, 1);
    const segs = Array.from({ length: n }, (_, i) => `<div class="cc-preview-widget-seg${i < done ? ' done' : ''}"></div>`).join('');
    progress = `<div class="cc-preview-widget-segments">${segs}</div>`;
  } else {
    progress = `<div class="cc-preview-widget-bar"><div class="cc-preview-widget-fill" style="width:${pct}%"></div></div>`;
  }

  const rows = items.length === 0
    ? `<div class="cc-preview-widget-empty">Nothing to show. 🎉</div>`
    : items.map(i => `
        <div class="cc-preview-widget-item ${i.complete ? 'done' : ''}">
          <div class="cc-preview-widget-check ${i.complete ? 'checked' : ''}">${i.complete ? '✓' : ''}</div>
          <div>${i.title}</div>
        </div>
      `).join('');

  return `
    <div class="cc-preview cc-preview-widget">
      <div class="cc-preview-label">Live preview</div>
      <div class="cc-preview-widget-frame">
        <div class="cc-preview-widget-header">
          <div class="cc-preview-widget-title">This Week</div>
          <div class="cc-preview-widget-count">${done}/${total}</div>
        </div>
        ${progress}
        <div class="cc-preview-widget-list">${rows}</div>
      </div>
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
          { value: 'bar', label: 'Bar' },
          { value: 'ring', label: 'Ring' },
          { value: 'segments', label: 'Segments' },
        ])),
      ]},
      { title: 'Sort', rows: [
        row('Sort by', selectControl('widgetSortBy', [
          { value: 'dueDate', label: 'Due date' },
          { value: 'status', label: 'Status' },
          { value: 'course', label: 'Course' },
          { value: 'type', label: 'Type' },
        ])),
      ]},
      { title: 'Filters', rows: [
        row('Show completed', toggleControl('widgetShowCompleted')),
        row('Hide announcements', toggleControl('widgetHideAnnouncements')),
        row('Hide discussions', toggleControl('widgetHideDiscussions')),
      ]},
    ],
  };
}

const TAB_RENDERERS = {
  cards: tabCards,
  sidebar: tabSidebar,
  theme: tabTheme,
  widget: tabWidget,
};

const CHEVRON_SVG = `<svg class="cc-group-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7.5l5 5 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderTabPane() {
  const root = document.getElementById(MODAL_ID);
  if (!root) return;
  const pane = root.querySelector('.cc-modal-pane');
  const cfg = TAB_RENDERERS[currentTab]();

  pane.innerHTML = `
    <div class="cc-pane-layout">
      <aside class="cc-preview-col">
        <div class="cc-preview-wrap">${cfg.preview}</div>
      </aside>
      <section class="cc-controls-col">
        <header class="cc-controls-header">
          <h2 class="cc-pane-title">${cfg.title}</h2>
          <p class="cc-pane-desc">${cfg.desc}</p>
        </header>
        ${cfg.groups.map((g, i) => `
          <details class="cc-group" ${i === 0 ? 'open' : ''}>
            <summary class="cc-group-summary">
              <span class="cc-group-title">${g.title}</span>
              ${CHEVRON_SVG}
            </summary>
            <div class="cc-group-body">
              ${g.rows.join('')}
            </div>
          </details>
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
          s.classList.remove('open');
          s.querySelector('.cc-select-trigger')?.setAttribute('aria-expanded', 'false');
        });
        if (!wasOpen) {
          el.classList.add('open');
          trigger.setAttribute('aria-expanded', 'true');
        }
      });

      menu.querySelectorAll('.cc-select-option').forEach(opt => {
        opt.addEventListener('click', async (e) => {
          e.stopPropagation();
          const value = opt.dataset.value;
          el.dataset.value = value;
          label.textContent = opt.textContent.trim();
          menu.querySelectorAll('.cc-select-option').forEach(o => o.classList.toggle('selected', o === opt));
          el.classList.remove('open');
          trigger.setAttribute('aria-expanded', 'false');
          await saveSettings({ [el.dataset.setting]: value });
          applySettings(settings);
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
}

const PREVIEW_REACTIVE_KEYS = new Set([
  'widgetProgressStyle', 'widgetSortBy', 'widgetShowCompleted',
  'widgetHideAnnouncements', 'widgetHideDiscussions',
]);

const WIDGET_RERENDER_KEYS = new Set([
  'widgetProgressStyle', 'widgetSortBy', 'widgetShowCompleted',
  'widgetHideAnnouncements', 'widgetHideDiscussions',
]);

function refreshPreview() {
  const wrap = document.querySelector(`#${MODAL_ID} .cc-preview-wrap`);
  if (!wrap) return;
  const cfg = TAB_RENDERERS[currentTab]();
  wrap.innerHTML = cfg.preview;
}

async function rerenderWidget() {
  const existing = document.getElementById(WIDGET_ID);
  if (!existing) return;
  existing.remove();
  await injectWidget();
}

// ---------- routing & observation ----------

function isDashboard() {
  const p = location.pathname;
  return p === '/' || p === '' || p === '/dashboard' || p.startsWith('/?');
}

function tick() {
  if (isDashboard()) injectWidget();
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

async function start() {
  await loadSettings();
  applySettings(settings);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  tick();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
