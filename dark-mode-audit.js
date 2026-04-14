// ─── Dark Mode Diagnostic ─────────────────────────────────────────────────────
// Paste in DevTools console on canvas.unl.edu with dark mode ON.
// Reports: light backgrounds, dark text, dark links, iframes, and broken regions.
// ──────────────────────────────────────────────────────────────────────────────
(function darkModeAudit() {

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function parseRGBA(str) {
    const m = str.match(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
  }
  function luma({ r, g, b }) { return 0.299 * r + 0.587 * g + 0.114 * b; }
  function isTransparent(c) { return !c || c.a < 0.05; }
  function isLightBg(c)     { return c && !isTransparent(c) && luma(c) > 190; }
  function isDarkColor(c)   { return c && luma(c) < 80; }
  function isDarkLink(c)    { return c && luma(c) < 130; }

  function isVisible(el) {
    try {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    } catch { return false; }
  }

  function shortSel(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = typeof el.className === 'string'
      ? el.className.trim().split(/\s+/).slice(0, 4).join('.')
      : '';
    if (cls) s += '.' + cls;
    return s;
  }

  function region(el) {
    if (el.closest('#header, .ic-app-header')) return 'sidebar/nav';
    if (el.closest('#nav-tray-portal'))         return 'nav-tray';
    if (el.closest('[role="dialog"]'))           return 'dialog/modal';
    if (el.closest('[role="menu"]'))             return 'dropdown-menu';
    if (el.closest('#DashboardCard_Container'))  return 'dashboard-cards';
    if (el.closest('#right-side'))               return 'right-side';
    if (el.closest('#content'))                  return 'main-content';
    if (el.closest('.ic-app-nav-toggle-and-crumbs, #breadcrumbs')) return 'breadcrumbs';
    if (el.closest('.PlannerApp, .PlannerHeader')) return 'planner';
    if (el.closest('#flash_message_holder'))     return 'flash-messages';
    return 'other';
  }

  function groupBy(arr, fn) {
    return arr.reduce((acc, x) => {
      const k = fn(x);
      (acc[k] = acc[k] || []).push(x);
      return acc;
    }, {});
  }

  // ── Collect all relevant visible elements ───────────────────────────────────
  const SKIP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT', 'HEAD']);
  const all = Array.from(document.querySelectorAll('*')).filter(el => {
    if (SKIP.has(el.tagName)) return false;
    if (el.closest('.cc-modal-root')) return false; // our widget — intentionally separate
    if (el.closest('iframe')) return false;         // cross-origin, can't inspect
    return isVisible(el);
  });

  const lightBgs = [], darkTexts = [], darkLinks = [], iframeList = [];

  all.forEach(el => {
    const cs = getComputedStyle(el);

    // ── 1. Light / white backgrounds ──────────────────────────────────────────
    const bgC = parseRGBA(cs.backgroundColor);
    if (isLightBg(bgC)) {
      // Intentional exceptions: course card hero (inline bg-image), avatars, imgs
      if (el.classList.contains('ic-DashboardCard__header_hero')) return;
      if (el.classList.contains('ic-avatar') || el.tagName === 'IMG') return;
      if (el.tagName === 'CIRCLE' || el.tagName === 'circle') return;

      lightBgs.push({
        el,
        sel: shortSel(el),
        bg: cs.backgroundColor,
        inline: !!(el.style?.backgroundColor || el.style?.background),
        region: region(el),
        luma: Math.round(luma(bgC))
      });
    }

    // ── 2. Dark text on dark page ──────────────────────────────────────────────
    if (!el.closest('svg') && el.tagName !== 'SVG') {
      const textC = parseRGBA(cs.color);
      if (textC && isDarkColor(textC)) {
        const txt = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
          ? el.textContent.trim().slice(0, 80)
          : '';
        darkTexts.push({
          el,
          sel: shortSel(el),
          color: cs.color,
          region: region(el),
          text: txt,
          luma: Math.round(luma(textC))
        });
      }
    }

    // ── 3. Dark / un-adjusted links ────────────────────────────────────────────
    if (el.tagName === 'A') {
      const linkC = parseRGBA(cs.color);
      if (linkC && isDarkLink(linkC)) {
        darkLinks.push({
          el,
          sel: shortSel(el),
          color: cs.color,
          text: el.textContent.trim().slice(0, 80),
          href: el.getAttribute('href') || '',
          region: region(el),
          luma: Math.round(luma(linkC))
        });
      }
    }
  });

  // ── 4. Iframes (LTI tools / embedded content — can't paint inside them) ─────
  document.querySelectorAll('iframe').forEach(f => {
    iframeList.push({
      el: f,
      sel: shortSel(f),
      src: f.getAttribute('src') || f.getAttribute('data-src') || '(dynamic)',
      region: region(f),
      hasDarkBg: (() => {
        const c = parseRGBA(getComputedStyle(f).backgroundColor);
        return c && luma(c) < 100;
      })()
    });
  });

  // ── 5. Inline-style background overrides (won't be caught by our CSS) ───────
  const inlineOverrides = lightBgs.filter(x => x.inline);

  // ── Print report ─────────────────────────────────────────────────────────────
  const HDR = 'font-size:15px;font-weight:bold;color:#e0e0e0;background:#1a1a1a;padding:2px 6px;border-radius:3px';

  console.group('%c🌑  Dark Mode Audit', HDR);
  console.log(`%cPage: ${location.href}`, 'color:#888;font-size:11px');
  console.log(`%cDark mode attr: ${document.documentElement.dataset.ccDarkMode}`, 'color:#888;font-size:11px');

  // — Light Backgrounds —
  console.group(`%c⬜  Light/White Backgrounds  (${lightBgs.length})`, 'color:#ff9800;font-weight:bold');
  if (!lightBgs.length) {
    console.log('%c✓ None found', 'color:#4caf50');
  } else {
    const g = groupBy(lightBgs, x => x.region);
    Object.entries(g).sort((a, b) => b[1].length - a[1].length).forEach(([rgn, items]) => {
      console.group(`${rgn}  (${items.length})`);
      items.forEach(({ el, sel, bg, inline, luma }) => {
        console.log(
          `%c${sel}%c  bg=${bg}  luma=${luma}${inline ? '  ⚠ INLINE-STYLE' : ''}`,
          'color:#ff9800', 'color:#aaa', el
        );
      });
      console.groupEnd();
    });
    if (inlineOverrides.length) {
      console.warn(`⚠ ${inlineOverrides.length} element(s) use INLINE background styles — CSS cannot override without targeting them directly.`);
    }
  }
  console.groupEnd();

  // — Dark Text —
  console.group(`%c⬛  Dark Text on Dark Page  (${darkTexts.length})`, 'color:#f44336;font-weight:bold');
  if (!darkTexts.length) {
    console.log('%c✓ None found', 'color:#4caf50');
  } else {
    const g = groupBy(darkTexts, x => x.region);
    Object.entries(g).sort((a, b) => b[1].length - a[1].length).forEach(([rgn, items]) => {
      console.group(`${rgn}  (${items.length})`);
      items.slice(0, 30).forEach(({ el, sel, color, luma, text }) => {
        console.log(
          `%c${sel}%c  color=${color}  luma=${luma}${text ? `  "${text}"` : ''}`,
          'color:#f44336', 'color:#aaa', el
        );
      });
      if (items.length > 30) console.log(`  … ${items.length - 30} more`);
      console.groupEnd();
    });
  }
  console.groupEnd();

  // — Dark Links —
  console.group(`%c🔗  Dark / Unadjusted Links  (${darkLinks.length})`, 'color:#e91e63;font-weight:bold');
  if (!darkLinks.length) {
    console.log('%c✓ None found', 'color:#4caf50');
  } else {
    const g = groupBy(darkLinks, x => x.region);
    Object.entries(g).sort((a, b) => b[1].length - a[1].length).forEach(([rgn, items]) => {
      console.group(`${rgn}  (${items.length})`);
      items.slice(0, 30).forEach(({ el, sel, color, luma, text, href }) => {
        console.log(
          `%c${sel}%c  color=${color}  luma=${luma}  href=${href}  "${text}"`,
          'color:#e91e63', 'color:#aaa', el
        );
      });
      if (items.length > 30) console.log(`  … ${items.length - 30} more`);
      console.groupEnd();
    });
  }
  console.groupEnd();

  // — Iframes —
  console.group(`%c🖼  Iframes (${iframeList.length})  — cannot paint inside cross-origin frames`, 'color:#9c27b0;font-weight:bold');
  if (!iframeList.length) {
    console.log('%c✓ No iframes', 'color:#4caf50');
  } else {
    iframeList.forEach(({ el, sel, src, region, hasDarkBg }) => {
      console.log(
        `%c${sel}%c  region=${region}  darkBg=${hasDarkBg}  src=${src.slice(0, 100)}`,
        'color:#ce93d8', 'color:#aaa', el
      );
    });
  }
  console.groupEnd();

  // — Summary —
  console.group('%c📊  Summary', 'font-weight:bold;color:#e0e0e0');
  console.table({
    'Light backgrounds':  { count: lightBgs.length,  'inline-style overrides': inlineOverrides.length },
    'Dark text nodes':    { count: darkTexts.length,  'inline-style overrides': '—' },
    'Dark links':         { count: darkLinks.length,  'inline-style overrides': '—' },
    'Iframes (no dark)':  { count: iframeList.filter(x => !x.hasDarkBg).length, 'inline-style overrides': '—' },
  });
  console.groupEnd();

  console.groupEnd(); // root group

  // Return raw data for further inspection in the console
  return { lightBgs, darkTexts, darkLinks, iframeList };

})();
