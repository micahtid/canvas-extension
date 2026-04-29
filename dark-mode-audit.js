// Dark Mode Diagnostic
// Paste in DevTools on Canvas with dark mode ON.
// Reports:
// - light backgrounds
// - dark text on dark surfaces
// - dark links
// - modal / portal dark text
// - dashboard header icon buttons with unexpected backgrounds
// - dashboard header badges missing the expected red fill
// - iframes we cannot paint inside
(function darkModeAudit() {
  function parseRGBA(str) {
    const m = str && str.match(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
  }

  function luma({ r, g, b }) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function isTransparent(c) {
    return !c || c.a < 0.05;
  }

  function isLightBg(c) {
    return c && !isTransparent(c) && luma(c) > 190;
  }

  function isDarkColor(c) {
    return c && luma(c) < 80;
  }

  function isDarkLink(c) {
    return c && luma(c) < 130;
  }

  function isRedBadgeBg(c) {
    return c && !isTransparent(c) && c.r >= 140 && c.g <= 90 && c.b <= 110;
  }

  function isVisible(el) {
    try {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    } catch {
      return false;
    }
  }

  function shortSel(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = typeof el.className === 'string'
      ? el.className.trim().split(/\s+/).slice(0, 4).join('.')
      : '';
    if (cls) s += `.${cls}`;
    return s;
  }

  function region(el) {
    if (el.closest('#header, .ic-app-header')) return 'sidebar/nav';
    if (el.closest('#nav-tray-portal')) return 'nav-tray';
    if (el.closest('#flash_message_holder')) return 'flash-messages';
    if (el.closest('.ReactModalPortal, [role="dialog"], .ui-dialog')) return 'dialog/modal';
    if (el.closest('[role="menu"]')) return 'dropdown-menu';
    if (el.closest('#dashboard_header_container, .ic-Dashboard-header__layout, [class*="Dashboard-header__layout"], [class*="ic-Dashboard-header"]')) return 'dashboard-header';
    if (el.closest('#DashboardCard_Container')) return 'dashboard-cards';
    if (el.closest('#right-side')) return 'right-side';
    if (el.closest('#content')) return 'main-content';
    if (el.closest('.ic-app-nav-toggle-and-crumbs, #breadcrumbs')) return 'breadcrumbs';
    if (el.closest('.PlannerApp, .PlannerHeader')) return 'planner';
    return 'other';
  }

  function groupBy(arr, fn) {
    return arr.reduce((acc, x) => {
      const key = fn(x);
      (acc[key] = acc[key] || []).push(x);
      return acc;
    }, {});
  }

  const MODAL_ROOT_SEL = '#flash_message_holder, .ReactModalPortal, [role="dialog"], .ui-dialog';
  const DASHBOARD_HEADER_SEL = '#dashboard_header_container, .ic-Dashboard-header__layout, [class*="Dashboard-header__layout"], [class*="ic-Dashboard-header"]';
  const HEADER_BADGE_SEL = '.nav-badge, .unread-count, .ic-unread-badge, .ic-unread-badge__total-count, [class*="badge"], [class*="item_count"], [class*="NotificationBadge"], [class*="notification"]';

  const SKIP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT', 'HEAD']);
  const all = Array.from(document.querySelectorAll('*')).filter(el => {
    if (SKIP.has(el.tagName)) return false;
    if (el.closest('.cc-modal-root')) return false;
    if (el.closest('iframe')) return false;
    return isVisible(el);
  });

  const lightBgs = [];
  const darkTexts = [];
  const darkLinks = [];
  const iframeList = [];

  all.forEach(el => {
    const cs = getComputedStyle(el);

    const bgC = parseRGBA(cs.backgroundColor);
    if (isLightBg(bgC)) {
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

    if (!el.closest('svg') && el.tagName !== 'SVG') {
      const textC = parseRGBA(cs.color);
      if (textC && isDarkColor(textC)) {
        const txt = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
          ? el.textContent.trim().slice(0, 100)
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

    if (el.tagName === 'A') {
      const linkC = parseRGBA(cs.color);
      if (linkC && isDarkLink(linkC)) {
        darkLinks.push({
          el,
          sel: shortSel(el),
          color: cs.color,
          text: el.textContent.trim().slice(0, 100),
          href: el.getAttribute('href') || '',
          region: region(el),
          luma: Math.round(luma(linkC))
        });
      }
    }
  });

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

  const inlineOverrides = lightBgs.filter(x => x.inline);
  const modalDarkTexts = darkTexts.filter(x => x.el.closest(MODAL_ROOT_SEL));

  const headerIconButtons = all
    .filter(el => {
      if (!el.matches('button, a, [role="button"]')) return false;
      if (!el.closest(DASHBOARD_HEADER_SEL)) return false;
      return el.matches('#courseMenuToggle, .ic-app-course-nav-toggle') || !!el.querySelector('svg, i[class*="icon-"]');
    })
    .map(el => {
      const cs = getComputedStyle(el);
      const bg = parseRGBA(cs.backgroundColor);
      return {
        el,
        sel: shortSel(el),
        bg: cs.backgroundColor,
        border: cs.borderColor,
        hasUnexpectedBg: !isTransparent(bg),
        text: (el.textContent || '').trim().slice(0, 40)
      };
    })
    .filter(x => x.hasUnexpectedBg);

  const headerBadgeIssues = all
    .filter(el => el.closest(DASHBOARD_HEADER_SEL) && el.matches(HEADER_BADGE_SEL))
    .map(el => {
      const cs = getComputedStyle(el);
      const bg = parseRGBA(cs.backgroundColor);
      return {
        el,
        sel: shortSel(el),
        bg: cs.backgroundColor,
        color: cs.color,
        text: (el.textContent || '').trim().slice(0, 20),
        looksWrong: !isRedBadgeBg(bg)
      };
    })
    .filter(x => x.looksWrong);

  const HDR = 'font-size:15px;font-weight:bold;color:#e0e0e0;background:#1a1a1a;padding:2px 6px;border-radius:3px';

  console.group('%cDark Mode Audit', HDR);
  console.log(`%cPage: ${location.href}`, 'color:#888;font-size:11px');
  console.log(`%cDark mode attr: ${document.documentElement.dataset.ccDarkMode}`, 'color:#888;font-size:11px');

  console.group(`%cLight / White Backgrounds (${lightBgs.length})`, 'color:#ff9800;font-weight:bold');
  if (!lightBgs.length) {
    console.log('%cNone found', 'color:#4caf50');
  } else {
    const grouped = groupBy(lightBgs, x => x.region);
    Object.entries(grouped).sort((a, b) => b[1].length - a[1].length).forEach(([name, items]) => {
      console.group(`${name} (${items.length})`);
      items.forEach(({ el, sel, bg, inline, luma: bgLuma }) => {
        console.log(
          `%c${sel}%c  bg=${bg}  luma=${bgLuma}${inline ? '  INLINE-STYLE' : ''}`,
          'color:#ff9800',
          'color:#aaa',
          el
        );
      });
      console.groupEnd();
    });
    if (inlineOverrides.length) {
      console.warn(`${inlineOverrides.length} element(s) use inline background styles.`);
    }
  }
  console.groupEnd();

  console.group(`%cDark Text on Dark Page (${darkTexts.length})`, 'color:#f44336;font-weight:bold');
  if (!darkTexts.length) {
    console.log('%cNone found', 'color:#4caf50');
  } else {
    const grouped = groupBy(darkTexts, x => x.region);
    Object.entries(grouped).sort((a, b) => b[1].length - a[1].length).forEach(([name, items]) => {
      console.group(`${name} (${items.length})`);
      items.slice(0, 30).forEach(({ el, sel, color, luma: textLuma, text }) => {
        console.log(
          `%c${sel}%c  color=${color}  luma=${textLuma}${text ? `  "${text}"` : ''}`,
          'color:#f44336',
          'color:#aaa',
          el
        );
      });
      if (items.length > 30) console.log(`... ${items.length - 30} more`);
      console.groupEnd();
    });
  }
  console.groupEnd();

  console.group(`%cModal / Portal Dark Text (${modalDarkTexts.length})`, 'color:#ff7043;font-weight:bold');
  if (!modalDarkTexts.length) {
    console.log('%cNone found', 'color:#4caf50');
  } else {
    modalDarkTexts.slice(0, 40).forEach(({ el, sel, color, luma: textLuma, text, region: area }) => {
      console.log(
        `%c${sel}%c  region=${area}  color=${color}  luma=${textLuma}${text ? `  "${text}"` : ''}`,
        'color:#ff7043',
        'color:#aaa',
        el
      );
    });
    if (modalDarkTexts.length > 40) console.log(`... ${modalDarkTexts.length - 40} more`);
  }
  console.groupEnd();

  console.group(`%cDark / Unadjusted Links (${darkLinks.length})`, 'color:#e91e63;font-weight:bold');
  if (!darkLinks.length) {
    console.log('%cNone found', 'color:#4caf50');
  } else {
    const grouped = groupBy(darkLinks, x => x.region);
    Object.entries(grouped).sort((a, b) => b[1].length - a[1].length).forEach(([name, items]) => {
      console.group(`${name} (${items.length})`);
      items.slice(0, 30).forEach(({ el, sel, color, luma: linkLuma, text, href }) => {
        console.log(
          `%c${sel}%c  color=${color}  luma=${linkLuma}  href=${href}  "${text}"`,
          'color:#e91e63',
          'color:#aaa',
          el
        );
      });
      if (items.length > 30) console.log(`... ${items.length - 30} more`);
      console.groupEnd();
    });
  }
  console.groupEnd();

  console.group(`%cDashboard Header Icon Buttons With Backgrounds (${headerIconButtons.length})`, 'color:#64b5f6;font-weight:bold');
  if (!headerIconButtons.length) {
    console.log('%cNone found', 'color:#4caf50');
  } else {
    headerIconButtons.forEach(({ el, sel, bg, border, text }) => {
      console.log(
        `%c${sel}%c  bg=${bg}  border=${border}${text ? `  "${text}"` : ''}`,
        'color:#64b5f6',
        'color:#aaa',
        el
      );
    });
  }
  console.groupEnd();

  console.group(`%cDashboard Header Badges Missing Red Background (${headerBadgeIssues.length})`, 'color:#ef5350;font-weight:bold');
  if (!headerBadgeIssues.length) {
    console.log('%cNone found', 'color:#4caf50');
  } else {
    headerBadgeIssues.forEach(({ el, sel, bg, color, text }) => {
      console.log(
        `%c${sel}%c  bg=${bg}  color=${color}${text ? `  text=${text}` : ''}`,
        'color:#ef5350',
        'color:#aaa',
        el
      );
    });
  }
  console.groupEnd();

  console.group(`%cIframes (${iframeList.length})`, 'color:#9c27b0;font-weight:bold');
  if (!iframeList.length) {
    console.log('%cNo iframes', 'color:#4caf50');
  } else {
    iframeList.forEach(({ el, sel, src, region: area, hasDarkBg }) => {
      console.log(
        `%c${sel}%c  region=${area}  darkBg=${hasDarkBg}  src=${src.slice(0, 120)}`,
        'color:#ce93d8',
        'color:#aaa',
        el
      );
    });
  }
  console.groupEnd();

  console.group('%cSummary', 'font-weight:bold;color:#e0e0e0');
  console.table({
    'Light backgrounds': { count: lightBgs.length, 'inline-style overrides': inlineOverrides.length },
    'Dark text nodes': { count: darkTexts.length, 'inline-style overrides': '-' },
    'Modal dark text': { count: modalDarkTexts.length, 'inline-style overrides': '-' },
    'Dark links': { count: darkLinks.length, 'inline-style overrides': '-' },
    'Header icon btn bg': { count: headerIconButtons.length, 'inline-style overrides': '-' },
    'Header badge issues': { count: headerBadgeIssues.length, 'inline-style overrides': '-' },
    'Iframes (no dark)': { count: iframeList.filter(x => !x.hasDarkBg).length, 'inline-style overrides': '-' }
  });
  console.groupEnd();

  console.groupEnd();

  return {
    lightBgs,
    darkTexts,
    modalDarkTexts,
    darkLinks,
    headerIconButtons,
    headerBadgeIssues,
    iframeList
  };
})();
