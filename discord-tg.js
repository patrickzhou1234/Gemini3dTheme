// ==UserScript==
// @name         Discord · Telegram
// @namespace    discord-telegram-violet
// @version      1.0.0
// @description  Makes discord.com look and work like Telegram Web (Night): a Telegram chat list with big avatars and last-message times, the ☰ menu and Settings, a Telegram chat header with "online" and "typing…", message bubbles with tails, times and ticks, date chips, Telegram's message box with a round send button, and Telegram-style menus.
// @author       Patrick
// @match        https://discord.com/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  /* ===================== Settings: change these freely ===================== */
  const CONFIG = {
    accent:      '#8774e1', // Telegram Night violet: your bubbles, buttons, selected chat
    wall1:       '#5d34b0', // doodle wallpaper gradient: violet
    wall2:       '#9a2f86', // magenta
    wall3:       '#2f3a9e', // indigo
    wall4:       '#c2477f', // sunset pink
    wallOpacity: 0.45,      // doodle strength, 0.1 to 1
    listWidth:   380,       // chat list width in px (you can also drag its edge)

    namesInPrivateChats: false, // Telegram hides names and avatars in one-on-one chats
    keepListOpen: true,         // reopen the chat list if something collapses it
    hideOtherThemes: true,      // switch off BetterDiscord-style themes (like SoftX) while this one is on
  };
  /* ========================================================================= */

  const VERSION = '1.0.0';
  const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
  const hasGM = typeof GM_getValue === 'function';
  const gmGet = (k, d) => {
    try { if (hasGM) return GM_getValue(k, d); } catch (e) { /* fall through */ }
    try { const v = localStorage.getItem('tg:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  };
  const gmSet = (k, v) => {
    try { if (typeof GM_setValue === 'function') { GM_setValue(k, v); return; } } catch (e) { /* fall through */ }
    try { localStorage.setItem('tg:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ }
  };

  const ON_KEY = 'tg_on';
  const enabled = gmGet(ON_KEY, true) !== false;
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand(enabled ? 'Switch to Discord version' : 'Switch to Telegram version', () => { gmSet(ON_KEY, !enabled); location.reload(); });
  }
  if (!enabled) return;

  // A newer copy loaded into the same page (an update being tried out) retires this one.
  const life = new AbortController();
  const L = { signal: life.signal }, LC = { capture: true, signal: life.signal };
  let disposed = false;
  try { W.dispatchEvent(new CustomEvent('tg-takeover')); } catch (e) { /* ignore */ }
  W.addEventListener('tg-takeover', () => dispose(), L);

  /* ---------- storage ---------- */
  const STORE = 'tg_discord_data_v1';
  function load() {
    try {
      const v = hasGM ? GM_getValue(STORE, null) : localStorage.getItem(STORE);
      const d = typeof v === 'string' ? JSON.parse(v) : v;
      if (d && d.set) return d;
    } catch (e) { /* ignore */ }
    return { set: {} };
  }
  const DB = load();
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const s = JSON.stringify(DB);
        if (typeof GM_setValue === 'function') GM_setValue(STORE, s); else localStorage.setItem(STORE, s);
      } catch (e) { /* ignore */ }
    }, 400);
  }
  const S = Object.assign({
    accent: CONFIG.accent, textSize: 16, listWidth: CONFIG.listWidth, wall: CONFIG.wallOpacity, motion: true,
    names: CONFIG.namesInPrivateChats, keepList: CONFIG.keepListOpen, otherThemes: !CONFIG.hideOtherThemes,
  }, DB.set);
  function setS(k, v) { S[k] = v; DB.set[k] = v; save(); applyVars(); schedule(); }
  const isDay = () => document.documentElement.classList.contains('theme-light');
  function applyVars() {
    const r = document.documentElement;
    if (!r) return;
    r.style.setProperty('--tg-primary', S.accent);
    r.style.setProperty('--tg-msg', S.textSize + 'px');
    r.style.setProperty('--tg-list-w', Math.round(S.listWidth) + 'px');
    r.style.setProperty('--tg-wall-opacity', String(S.wall));
    if (!document.body) return;
    document.body.classList.toggle('tg-still', !S.motion);
    document.body.classList.toggle('tg-day', isDay());
  }
  applyVars();

  /* ---------- Discord's own data: read from the React props on its DOM nodes ---------- */
  function fiberOf(el) {
    if (!el) return null;
    const k = Object.keys(el).find(x => x.startsWith('__reactFiber$'));
    return k ? el[k] : null;
  }
  function propOf(el, name, depth = 30) {
    for (let f = fiberOf(el), i = 0; f && i < depth; f = f.return, i++) {
      const p = f.memoizedProps;
      if (p && typeof p === 'object' && p[name] != null) return p[name];
    }
    return null;
  }
  // a Discord id (snowflake) carries the time it was made
  const snowMs = id => { try { return id ? Number((BigInt(id) >> 22n) + 1420070400000n) : 0; } catch (e) { return 0; } };

  /* ===================== Styles ===================== */
  const DOODLE = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22360%22 height=%22360%22 viewBox=%220 0 360 360%22 fill=%22none%22 stroke=%22%23fff%22 stroke-width=%221.7%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M40 22l5.3 10.8 11.9 1.7-8.6 8.4 2 11.8L40 49.1l-10.6 5.6 2-11.8-8.6-8.4 11.9-1.7z%22/%3E%3Cpath d=%22M118 40c-6-9-20-5-17 6 2 7 17 17 17 17s15-10 17-17c3-11-11-15-17-6z%22/%3E%3Cpath d=%22M200 18a17 17 0 1 0 15 25 13 13 0 1 1-15-25z%22/%3E%3Ccircle cx=%22285%22 cy=%2240%22 r=%2213%22/%3E%3Cellipse cx=%22285%22 cy=%2240%22 rx=%2226%22 ry=%227%22 transform=%22rotate(-20 285 40)%22/%3E%3Cpath d=%22M30 120h34a12 12 0 0 0-3-23.6A16 16 0 0 0 31 98a11 11 0 0 0-1 22z%22/%3E%3Ccircle cx=%22120%22 cy=%22112%22 r=%2214%22/%3E%3Cpath d=%22M120 112m-7 0a7 7 0 1 1 7 7M120 126v28%22/%3E%3Cpath d=%22M188 104l46-18-14 46-10-16zM210 116l24-30%22/%3E%3Cpath d=%22M296 92v28M296 92l18-5v24%22/%3E%3Ccircle cx=%22291%22 cy=%22121%22 r=%225%22/%3E%3Ccircle cx=%22309%22 cy=%22112%22 r=%225%22/%3E%3Cpath d=%22M22 200a26 26 0 0 1 52 0zM48 200v24a6 6 0 0 1-12 0M48 174v-4%22/%3E%3Cpath d=%22M112 186l12 34 12-34zM108 186a16 12 0 0 1 32 0z%22/%3E%3Ccircle cx=%22118%22 cy=%22178%22 r=%221.5%22/%3E%3Cpath d=%22M200 230v-12M200 218c-12-4-14-26 0-48 14 22 12 44 0 48zM190 214l-8 10M210 214l8 10%22/%3E%3Ccircle cx=%22200%22 cy=%22190%22 r=%224%22/%3E%3Ccircle cx=%22290%22 cy=%22198%22 r=%2218%22/%3E%3Ccircle cx=%22290%22 cy=%22198%22 r=%226%22/%3E%3Cpath d=%22M280 188l2 2M297 186l-1 3M300 204l-2-1M281 207l2-2%22/%3E%3Cpath d=%22M40 282c0-10 8-18 18-18-2 6 0 12 6 14-6 2-8 8-6 14-10 0-18-4-18-10zM50 274v0%22/%3E%3Cpath d=%22M22 300c8-12 26-12 34 0-8 12-26 12-34 0zM56 300l10-7v14z%22/%3E%3Ccircle cx=%2232%22 cy=%22298%22 r=%221.5%22/%3E%3Cpath d=%22M118 262l3 9 9 3-9 3-3 9-3-9-9-3 9-3z%22/%3E%3Cpath d=%22M128 316a14 18 0 1 0 0.1 0M128 352l-4 6h8z%22/%3E%3Cpath d=%22M128 334c-3 8 4 10 0 18%22/%3E%3Cpath d=%22M196 290h30M200 290l4 26h14l4-26M204 290c0-12 18-12 18 0%22/%3E%3Cpath d=%22M288 270c8 0 14 6 14 14 0 10-14 22-14 22s-14-12-14-22c0-8 6-14 14-14z%22/%3E%3Ccircle cx=%22288%22 cy=%22284%22 r=%224%22/%3E%3Cpath d=%22M330 150l2 6 6 2-6 2-2 6-2-6-6-2 6-2z%22/%3E%3Cpath d=%22M160 60l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z%22/%3E%3Ccircle cx=%2280%22 cy=%2260%22 r=%222%22/%3E%3Ccircle cx=%22250%22 cy=%22150%22 r=%222%22/%3E%3Ccircle cx=%22160%22 cy=%22250%22 r=%222%22/%3E%3Ccircle cx=%22340%22 cy=%22320%22 r=%222%22/%3E%3Ccircle cx=%2280%22 cy=%22340%22 r=%222%22/%3E%3Ccircle cx=%22340%22 cy=%22230%22 r=%222%22/%3E%3Cpath d=%22M330 40c4 4 4 10 0 14M240 330c6 2 10-2 12-6%22/%3E%3C/svg%3E';
  const svgUrl = (body, vb = '0 0 24 24', extra = 'fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"') =>
    `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" ${extra}>${body}</svg>`)}")`;
  const TAIL = svgUrl('<path d="M3 19h6V2c-.2 2.8-.9 5.8-2 8.8-.9 2.3-2.5 4.5-4.7 6.5A1 1 0 0 0 3 19z"/>', '0 0 11 20', 'fill="black"');
  const M_SEND = svgUrl('<path d="M3.4 20.4l17.4-7.5a1 1 0 0 0 0-1.8L3.4 3.6a.9.9 0 0 0-1.3 1L4 11l9 1-9 1-1.9 6.4a.9.9 0 0 0 1.3 1z"/>', '0 0 24 24', 'fill="black"');
  const M_MIC = svgUrl('<path d="M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>');
  const M_ATTACH = svgUrl('<path d="M20.5 11.5l-8.2 8.2a5 5 0 0 1-7-7l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/>');
  const M_MENU = svgUrl('<path d="M4 7h16M4 12h16M4 17h16"/>', '0 0 24 24', 'fill="none" stroke="black" stroke-width="2.2" stroke-linecap="round"');
  const M_STOP = svgUrl('<rect x="6" y="6" width="12" height="12" rx="2.5"/>', '0 0 24 24', 'fill="black"');
  const M_CHECK1 = svgUrl('<path d="M3.5 7.5l3.5 3.5 7.5-8.5"/>', '0 0 20 14', 'fill="none" stroke="black" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"');
  const M_CHECK2 = svgUrl('<path d="M1.5 7.5l3.5 3.5 7.5-8.5M9.5 10.5l.5.5 7.5-8.5"/>', '0 0 20 14', 'fill="none" stroke="black" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"');
  const M_SEARCH = svgUrl('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/>');
  const M_CHEV = svgUrl('<path d="M6 9l6 6 6-6"/>');


  const CSS = `
:root {
  --tg-font: Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --tg-primary: ${CONFIG.accent};
  --tg-link: color-mix(in srgb, var(--tg-primary) 62%, #fff);
  --tg-p08: color-mix(in srgb, var(--tg-primary) 8%, transparent);
  --tg-p15: color-mix(in srgb, var(--tg-primary) 15%, transparent);
  --tg-p25: color-mix(in srgb, var(--tg-primary) 25%, transparent);
  --tg-p40: color-mix(in srgb, var(--tg-primary) 40%, transparent);
  --tg-surface: #212121;
  --tg-bg: #181818;
  --tg-hover: #2c2c2c;
  --tg-border: #0f0f0f;
  --tg-text: #ffffff;
  --tg-text-2: #aaaaaa;
  --tg-danger: #ff595a;
  --tg-menu-bg: rgba(33, 33, 33, .82);
  --tg-menu-blur: blur(24px) saturate(160%);
  --tg-menu-shadow: 0 .25rem .5rem .125rem rgba(0, 0, 0, .28);
  --tg-out: var(--tg-primary);
  --tg-out-text: #ffffff;
  --tg-out-meta: rgba(255, 255, 255, .62);
  --tg-in: var(--tg-surface);
  --tg-in-meta: rgba(255, 255, 255, .45);
  --tg-chip: rgba(30, 14, 52, .55);
  --tg-input: #181818;
  --tg-wall-1: ${CONFIG.wall1}; --tg-wall-2: ${CONFIG.wall2}; --tg-wall-3: ${CONFIG.wall3}; --tg-wall-4: ${CONFIG.wall4};
  --tg-wall-opacity: ${CONFIG.wallOpacity};
  --tg-list-w: ${CONFIG.listWidth}px;
  --tg-col: 728px;
  --tg-msg: 16px;
  --tg-head: 56px;
  --tg-right-w: 0px;
  --tg-ease: cubic-bezier(.4, 0, .2, 1);
}


/* ---------- 1. Discord's colour tokens -> Telegram Night ---------- */
:is(html:has(> body.tg-on), body.tg-on :is(.theme-dark, .theme-darker, .theme-midnight)) {
  --background-base-lowest: #0f0f0f !important; --background-base-lower: #181818 !important; --background-base-low: #212121 !important;
  --background-surface-high: #2c2c2c !important; --background-surface-higher: #303030 !important; --background-surface-highest: #363636 !important;
  --background-secondary-alt: #212121 !important; --bg-surface-raised: #2c2c2c !important;
  --chat-background: transparent !important; --chat-background-default: transparent !important; --chat-border: transparent !important;
  --channeltextarea-background: #212121 !important; --input-background-default: #181818 !important; --modal-background: #212121 !important;
  --app-frame-background: #181818 !important; --app-frame-border: #0f0f0f !important;
  --background-mod-muted: rgba(255, 255, 255, .04) !important; --background-mod-subtle: rgba(255, 255, 255, .06) !important;
  --background-mod-normal: rgba(255, 255, 255, .08) !important; --background-mod-strong: rgba(255, 255, 255, .12) !important;
  --border-subtle: rgba(255, 255, 255, .06) !important; --border-normal: rgba(255, 255, 255, .1) !important; --border-strong: rgba(255, 255, 255, .14) !important;
  --text-default: #ffffff !important; --text-strong: #ffffff !important; --text-muted: #aaaaaa !important; --text-subtle: #aaaaaa !important; --chat-text-muted: #aaaaaa !important;
  --channels-default: #aaaaaa !important; --interactive-muted: #6f6f6f !important;
  --text-link: var(--tg-link) !important; --brand-500: var(--tg-primary) !important; --control-brand-foreground: var(--tg-link) !important; --control-brand-foreground-new: var(--tg-link) !important;
  --message-background-hover: transparent !important;
  --message-mentioned-background-default: transparent !important; --message-mentioned-background-hover: transparent !important;
  --message-highlight-background-default: transparent !important; --message-highlight-background-hover: transparent !important;
  --scrollbar-auto-thumb: rgba(255, 255, 255, .16) !important; --scrollbar-auto-track: transparent !important;
  --scrollbar-thin-thumb: rgba(255, 255, 255, .16) !important; --scrollbar-thin-track: transparent !important;
  --font-primary: var(--tg-font) !important; --font-display: var(--tg-font) !important; --font-headline: var(--tg-font) !important;
}
:is(html:has(> body.tg-on.tg-day), body.tg-on.tg-day :is(.theme-light)) {
  --background-base-lowest: #f4f4f5 !important; --background-base-lower: #ffffff !important; --background-base-low: #ffffff !important;
  --background-surface-high: #ffffff !important; --background-surface-higher: #f4f4f5 !important; --background-surface-highest: #f1f1f2 !important;
  --chat-background: transparent !important; --chat-background-default: transparent !important; --channeltextarea-background: #ffffff !important;
  --text-default: #000000 !important; --text-strong: #000000 !important; --text-muted: #707579 !important; --channels-default: #707579 !important;
  --text-link: var(--tg-link) !important; --brand-500: var(--tg-primary) !important; --message-background-hover: transparent !important;
  --font-primary: var(--tg-font) !important; --font-display: var(--tg-font) !important; --font-headline: var(--tg-font) !important;
}
body.tg-on { --tg-page-bg: #0b0b0b; --custom-guild-sidebar-width: calc(var(--tg-list-w) + 73px) !important; background: var(--tg-page-bg) !important; font-family: var(--tg-font) !important; }
body.tg-on.tg-day {
  --tg-surface: #ffffff; --tg-bg: #f4f4f5; --tg-hover: #f1f1f2; --tg-border: #dadce0; --tg-text: #000000; --tg-text-2: #707579;
  --tg-link: color-mix(in srgb, var(--tg-primary) 88%, #000); --tg-menu-bg: rgba(255, 255, 255, .86); --tg-menu-shadow: 0 .25rem .5rem .125rem rgba(0, 0, 0, .14);
  --tg-out: color-mix(in srgb, var(--tg-primary) 16%, #fff); --tg-out-text: #000000; --tg-out-meta: var(--tg-primary); --tg-in: #ffffff; --tg-in-meta: #9aa1a8;
  --tg-chip: rgba(70, 50, 120, .38); --tg-input: #f1f1f2;
  --tg-page-bg: linear-gradient(135deg, #d9d0f5 0%, #ecd5ee 35%, #d5dbf6 70%, #f2d6e4 100%) fixed;
}
body.tg-on.tg-day::before { background: #3a2470 !important; opacity: calc(var(--tg-wall-opacity) * .3) !important; }
body.tg-on.tg-day :is(.tg-iconbtn:hover, .tg-mi:hover, .tg-mi.tg-hl) { background: rgba(0, 0, 0, .06) !important; }
body.tg-on.tg-day .tg-menu hr { background: rgba(0, 0, 0, .08); }

/* ---------- 2. Wallpaper behind the chat ---------- */
body.tg-on::before {
  content: ""; position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: var(--tg-wall-opacity);
  background:
    radial-gradient(circle at 15% 20%, var(--tg-wall-1), transparent 55%),
    radial-gradient(circle at 85% 25%, var(--tg-wall-2), transparent 55%),
    radial-gradient(circle at 20% 85%, var(--tg-wall-3), transparent 55%),
    radial-gradient(circle at 80% 80%, var(--tg-wall-4), transparent 55%),
    var(--tg-wall-1);
  -webkit-mask-image: url("${DOODLE}"); mask-image: url("${DOODLE}");
  -webkit-mask-size: 360px 360px; mask-size: 360px 360px;
}
/* lift the app above the wallpaper (only the app: Discord keeps a bare iframe on the page that must stay underneath) */
:where(body.tg-on) > :where(#app-mount) { position: relative; z-index: 1; }
/* the boxes between the chat and the page are cleared so the wallpaper shows through (only while a chat is open) */
body.tg-on.tg-chat .tg-clear { background: transparent !important; }
body.tg-on .tg-hide { display: none !important; }

/* ---------- 3. Server rail = Telegram's folder column ---------- */
body.tg-on nav[aria-label="Servers sidebar"], body.tg-on .tg-rail { background: var(--tg-border) !important; }
body.tg-on .tg-rail [class*="pill_"] [class*="item_"] { background: var(--tg-primary) !important; }

/* ---------- 4. Left column = Telegram chat list ---------- */
body.tg-on .tg-side { width: var(--tg-list-w) !important; min-width: var(--tg-list-w) !important; position: relative !important; display: flex !important; flex-direction: column !important;
  background: var(--tg-surface) !important; border: 0 !important; border-right: 1px solid var(--tg-border) !important; border-radius: 0 !important; overflow: hidden; }
body.tg-on .tg-side > nav { flex: 1 1 auto !important; min-height: 0 !important; background: transparent !important; width: auto !important; }
body.tg-on .tg-side > :not(.tg-ui) { display: flex !important; }
body.tg-on [class*="sidebarResizeHandle_"] { display: none !important; }
#tg-side-top { position: relative; z-index: 4; flex: none; height: 56px; display: flex; align-items: center; padding: 0 12px 0 8px; box-sizing: border-box; background: var(--tg-surface); }
body.tg-on .tg-side [class*="privateChannels_"] :is([class*="searchBar_"], [class*="privateChannelsHeaderContainer_"]) { display: none !important; }
body.tg-on .tg-side [class*="privateChannels_"] [class*="scroller_"] { background: transparent !important; }
/* private chats: Telegram rows with big avatars */
body.tg-on .tg-crow { height: 72px !important; max-height: none !important; margin: 0 !important; padding: 0 8px !important; box-sizing: border-box !important; }
body.tg-on .tg-crow-hit { position: relative !important; height: 72px !important; border-radius: 12px !important; background: transparent !important; transition: background-color .15s; }
body.tg-on .tg-crow-hit:hover { background: var(--tg-hover) !important; }
body.tg-on .tg-crow-hit[class*="interactiveSelected_"], body.tg-on .tg-crow-hit[class*="interactiveSelected_"]:hover { background: var(--tg-primary) !important; }
body.tg-on .tg-crow-a { height: 72px !important; padding: 0 !important; color: var(--tg-text) !important; text-decoration: none !important; }
body.tg-on .tg-crow-a [class*="layout_"] { height: 72px !important; padding: 0 12px 0 9px !important; gap: 0 !important; border-radius: 12px !important; }
/* Discord's 32px avatar (an SVG with a status cut-out) scaled as a whole to Telegram's 54px */
body.tg-on .tg-crow-a [class*="layout_"] > [class*="avatar_"] { zoom: 1.6875; flex: none !important; margin: 0 6px 0 0 !important; }
body.tg-on .tg-crow-a [class*="content_"] { min-width: 0 !important; flex: 1 1 auto !important; display: flex !important; flex-direction: column !important; justify-content: center !important; padding-right: 50px !important; }
body.tg-on .tg-crow-a [class*="name_"] { font-size: 16px !important; font-weight: 500 !important; line-height: 22px !important; color: var(--tg-text) !important; }
body.tg-on .tg-crow-a [class*="subText_"] { font-size: 15px !important; line-height: 20px !important; color: var(--tg-text-2) !important; margin-top: 2px !important; }
body.tg-on .tg-crow-hit[class*="interactiveSelected_"] :is([class*="name_"], [class*="subText_"], [class*="subText_"] *, .tg-row-date) { color: #fff !important; }
body.tg-on .tg-crow-hit [class*="iconsContainer_"] { position: absolute !important; right: 8px !important; bottom: 12px !important; }
body.tg-on .tg-crow [class*="numberBadge_"] { min-width: 22px !important; height: 22px !important; padding: 0 7px !important; border-radius: 11px !important; background: var(--tg-primary) !important; color: #fff !important;
  font-size: 14px !important; font-weight: 500 !important; line-height: 22px !important; box-sizing: border-box !important; }
.tg-row-date { position: absolute; top: 14px; right: 12px; font-size: 12px; line-height: 16px; color: var(--tg-text-2); pointer-events: none; }
/* server channels: compact Telegram rows */
body.tg-on .tg-side nav[aria-label$="(server)"] { background: transparent !important; }
body.tg-on .tg-chrow [class*="link_"] { border-radius: 10px !important; padding: 0 8px !important; }
body.tg-on .tg-chrow [class*="name_"] { font-size: 15px !important; font-weight: 500 !important; color: var(--tg-text-2) !important; }
body.tg-on .tg-chrow [class*="modeUnread_"] [class*="name_"] { color: var(--tg-text) !important; }
body.tg-on .tg-chrow [class*="modeSelected_"] [class*="link_"] { background: var(--tg-primary) !important; }
body.tg-on .tg-chrow [class*="modeSelected_"] :is([class*="name_"], [class*="iconContainer_"], svg) { color: #fff !important; }
body.tg-on .tg-chrow [class*="link_"]:hover { background: var(--tg-hover) !important; }
body.tg-on .tg-chrow [class*="iconContainer_"] { color: var(--tg-text-2) !important; }
body.tg-on .tg-side [aria-label$="(category)"] h3 { font-size: 14px !important; font-weight: 500 !important; text-transform: none !important; color: var(--tg-link) !important; }
body.tg-on .tg-filtered { display: none !important; }
/* the user panel at the bottom */
body.tg-on section[aria-label="User status and settings"] { background: var(--tg-hover) !important; border-radius: 12px !important; border: 0 !important; box-shadow: 0 1px 4px rgba(0, 0, 0, .35) !important; }
body.tg-on #tg-fab { bottom: 84px; }

/* ---------- 5. Chat header ---------- */
body.tg-on .tg-chead { height: 56px !important; min-height: 56px !important; background: var(--tg-surface) !important; border: 0 !important; box-shadow: 0 1px 2px rgba(0, 0, 0, .25) !important; z-index: 5; }
body.tg-on .tg-chead [class*="upperContainer_"] { height: 56px !important; align-items: center !important; }
body.tg-on .tg-chead [class*="children_"] { position: relative !important; align-items: center !important; }
body.tg-on .tg-chead [class*="children_"] > :is([class*="avatar_"], [class*="iconWrapper_"], [class*="divider_"], [class*="topic_"]) { display: none !important; }
body.tg-on .tg-chead [class*="children_"] > [class*="iconWrapper_"] + :is(h1, [class*="title_"]) { margin-left: 0 !important; }
body.tg-on .tg-chead :is(h1, [class*="titleWrapper_"] h1, [class*="title_"]) { font-size: 16px !important; font-weight: 500 !important; line-height: 22px !important; color: var(--tg-text) !important; }
body.tg-on .tg-chead [class*="titleWrapper_"] { position: relative !important; padding-bottom: 16px !important; margin-left: 0 !important; }
body.tg-on .tg-chead [class*="toolbar_"] :is([class*="iconWrapper_"], [role="button"]) { color: var(--tg-text-2) !important; }
body.tg-on .tg-chead [class*="toolbar_"] [class*="selected_"] { color: var(--tg-primary) !important; }
.tg-h-av { width: 42px !important; height: 42px !important; font-size: 17px !important; margin-right: 10px; flex: none; border-radius: 50%; object-fit: cover; }
.tg-h-status { position: absolute; left: 0; bottom: -2px; font-size: 14px; line-height: 18px; color: var(--tg-text-2); white-space: nowrap; pointer-events: none; max-width: 420px; overflow: hidden; text-overflow: ellipsis; }
.tg-h-status.tg-typing { color: var(--tg-link); }
.tg-dots::after { content: ""; display: inline-block; width: 14px; text-align: left; animation: tg-dots 1.2s steps(1) infinite; }
@keyframes tg-dots { 0% { content: "" } 25% { content: "." } 50% { content: ".." } 75% { content: "..." } }

/* ---------- 6. Messages = bubbles ---------- */
body.tg-on .tg-msg { padding: 0 !important; margin: 0 !important; background: transparent !important; }
body.tg-on .tg-bubble {
  position: relative !important; width: fit-content !important; min-width: 64px; max-width: min(560px, calc(100% - 140px)) !important; box-sizing: border-box !important; min-height: 0 !important;
  margin: 2px auto 0 62px !important; padding: 6px 10px 7px 11px !important; border-radius: 15px !important; background: var(--tg-in) !important; color: var(--tg-text) !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .3) !important; overflow: visible !important;
}
body.tg-on .tg-start .tg-bubble { margin-top: 10px !important; }
body.tg-on .tg-m:not(.tg-start) .tg-bubble { border-top-left-radius: 6px !important; }
body.tg-on .tg-m:not(.tg-end) .tg-bubble { border-bottom-left-radius: 6px !important; }
body.tg-on .tg-m.tg-end .tg-bubble { border-bottom-left-radius: 0 !important; }
body.tg-on .tg-m.tg-end .tg-bubble::after {
  content: ""; position: absolute; left: -8.4px; right: auto; bottom: 0; top: auto; width: 11px; height: 20px; background: var(--tg-in); border: 0; border-radius: 0;
  -webkit-mask: ${TAIL} no-repeat; mask: ${TAIL} no-repeat; display: block;
}
body.tg-on .tg-u .tg-bubble { margin: 2px 12px 0 auto !important; background: var(--tg-out) !important; color: var(--tg-out-text) !important; }
body.tg-on .tg-u.tg-start .tg-bubble { margin-top: 10px !important; }
body.tg-on .tg-u:not(.tg-start) .tg-bubble { border-top-right-radius: 6px !important; }
body.tg-on .tg-u:not(.tg-end) .tg-bubble { border-bottom-right-radius: 6px !important; }
body.tg-on .tg-u.tg-end .tg-bubble { border-bottom-right-radius: 0 !important; }
body.tg-on .tg-u.tg-end .tg-bubble::after {
  content: ""; position: absolute; right: -8.4px; left: auto; bottom: 0; top: auto; width: 11px; height: 20px; background: var(--tg-out); border: 0; border-radius: 0;
  -webkit-mask: ${TAIL} no-repeat; mask: ${TAIL} no-repeat; transform: scaleX(-1); display: block;
}
body.tg-on.tg-solo .tg-m .tg-bubble { margin-left: 12px !important; }
body.tg-on .tg-bubble::before { display: none !important; }
body.tg-on .tg-bubble :is([class*="contents_"], [id^="message-content-"], [class*="messageContent_"], [class*="container_"][id^="message-accessories-"]) {
  position: static !important; margin: 0 !important; padding: 0 !important; text-indent: 0 !important;
}
body.tg-on .tg-bubble [id^="message-content-"] { font-size: var(--tg-msg) !important; line-height: 1.3125 !important; color: inherit !important; white-space: pre-wrap; overflow-wrap: anywhere; }
body.tg-on .tg-bubble [id^="message-content-"]:empty { display: none !important; }
body.tg-on .tg-u .tg-bubble :is([id^="message-content-"], [id^="message-content-"] *):not(code, pre, pre *, a) { color: var(--tg-out-text) !important; }
body.tg-on .tg-u .tg-bubble a { color: inherit !important; text-decoration: underline !important; }
body.tg-on .tg-bubble a { color: var(--tg-link) !important; }
/* avatar outside the bubble (groups and servers only), name inside it */
body.tg-on .tg-bubble > [class*="contents_"] > img[class*="avatar_"] { position: absolute !important; left: -52px !important; top: 0 !important; width: 40px !important; height: 40px !important; margin: 0 !important; }
body.tg-on .tg-bubble > [class*="contents_"] > img[class*="avatarDecoration_"] { position: absolute !important; left: -56px !important; top: -4px !important; }
body.tg-on :is(.tg-u, body.tg-solo .tg-m) .tg-bubble > [class*="contents_"] > img:is([class*="avatar_"], [class*="avatarDecoration_"]) { display: none !important; }
body.tg-on .tg-bubble h3[class*="header_"] { display: block !important; margin: 0 0 2px !important; min-height: 0 !important; line-height: 20px !important; font-size: 15px !important; }
body.tg-on .tg-bubble h3[class*="header_"] [class*="username_"] { font-size: 15px !important; font-weight: 500 !important; color: var(--tg-name, var(--tg-link)); }
body.tg-on .tg-bubble h3[class*="header_"] [class*="timestamp_"] { display: none !important; }
body.tg-on :is(.tg-u, body.tg-solo .tg-m) .tg-bubble h3[class*="header_"] { display: none !important; }
body.tg-on .tg-bubble [class*="timestampVisibleOnHover_"], body.tg-on .tg-bubble [class*="edited_"] { display: none !important; }
body.tg-on .tg-bubble [class*="repliedMessage_"] {
  position: relative !important; display: flex !important; align-items: center; gap: 4px; margin: 0 0 4px !important; padding: 3px 8px 4px 10px !important; border-radius: 4px !important;
  background: var(--tg-p15) !important; overflow: hidden; height: auto !important; font-size: 14px !important;
}
body.tg-on .tg-u .tg-bubble [class*="repliedMessage_"] { background: rgba(255, 255, 255, .14) !important; }
body.tg-on .tg-bubble [class*="repliedMessage_"]::before { content: "" !important; position: absolute !important; left: 0 !important; top: 0 !important; bottom: 0 !important; width: 3px !important; height: auto !important;
  margin: 0 !important; border: 0 !important; border-radius: 0 !important; background: currentColor !important; color: var(--tg-link); }
body.tg-on .tg-u .tg-bubble [class*="repliedMessage_"]::before { color: #fff; }
body.tg-on .tg-bubble [class*="repliedMessage_"] img[class*="replyAvatar_"] { display: none !important; }
body.tg-on .tg-bubble [class*="repliedMessage_"] [class*="username_"] { color: var(--tg-link) !important; font-weight: 500 !important; }
body.tg-on .tg-u .tg-bubble [class*="repliedMessage_"] :is([class*="username_"], [class*="repliedTextContent_"], *) { color: #fff !important; }
body.tg-on .tg-bubble [id^="message-accessories-"] { margin-top: 4px !important; }
body.tg-on .tg-bubble [id^="message-accessories-"]:empty { display: none !important; }
body.tg-on .tg-bubble :is([class*="imageWrapper_"], [class*="imageContainer_"], video, [class*="mosaicItem_"]) { border-radius: 10px !important; overflow: hidden; }
body.tg-on .tg-bubble article[class*="embed"] { background: rgba(0, 0, 0, .22) !important; border-radius: 8px !important; }
body.tg-on .tg-bubble [class*="reactions_"] { margin-top: 4px !important; }
body.tg-on .tg-bubble [class*="reaction_"] { height: 30px !important; border-radius: 15px !important; border: 0 !important; background: var(--tg-p25) !important; }
body.tg-on .tg-bubble [class*="reaction_"]:is([class*="reactionMe_"]) { background: var(--tg-primary) !important; }
body.tg-on .tg-bubble [class*="reaction_"] [class*="reactionCount_"] { color: var(--tg-link) !important; font-weight: 500 !important; font-size: 14px !important; }
body.tg-on .tg-bubble [class*="reactionMe_"] [class*="reactionCount_"] { color: #fff !important; }
body.tg-on .tg-u .tg-bubble [class*="reaction_"] { background: rgba(255, 255, 255, .22) !important; }
body.tg-on .tg-u .tg-bubble [class*="reaction_"] [class*="reactionCount_"] { color: #fff !important; }
body.tg-on .tg-bubble :is(pre, code) { border-radius: 6px !important; }
body.tg-on .tg-bubble [class*="buttonContainer_"] { top: -18px !important; right: 0 !important; }
body.tg-on .tg-bubble[class*="mentioned_"] { box-shadow: 0 1px 2px rgba(0, 0, 0, .3), inset 3px 0 0 var(--tg-primary) !important; }
/* service messages (joins, pins, calls, …) as Telegram's grey pills */
body.tg-on .tg-sys .tg-bubble, body.tg-on .tg-sysmsg {
  width: fit-content !important; max-width: 80% !important; min-width: 0 !important; margin: 8px auto 4px !important; padding: 3px 10px !important; border-radius: 13px !important;
  background: var(--tg-chip) !important; -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); box-shadow: none !important; color: #fff !important; font-size: 14px !important;
}
body.tg-on .tg-sys .tg-bubble::after { display: none !important; }
body.tg-on .tg-sys .tg-bubble * { color: #fff !important; font-size: 14px !important; }
/* date dividers become date chips */
body.tg-on ol[data-list-id="chat-messages"] [role="separator"][class*="divider_"] {
  display: flex !important; justify-content: center !important; height: auto !important; margin: 10px 0 4px !important; border: 0 !important; background: none !important; pointer-events: none;
}
body.tg-on ol[data-list-id="chat-messages"] [role="separator"][class*="divider_"]::before, body.tg-on ol[data-list-id="chat-messages"] [role="separator"][class*="divider_"]::after { display: none !important; }
body.tg-on ol[data-list-id="chat-messages"] [role="separator"][class*="divider_"] > span {
  position: static !important; margin: 0 !important; padding: 3px 9px !important; border-radius: 13px !important; background: var(--tg-chip) !important; -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  color: #fff !important; font-size: 15px !important; font-weight: 500 !important; line-height: 20px !important; text-transform: none !important;
}
body.tg-on ol[data-list-id="chat-messages"] [role="separator"][class*="isUnread_"] > span { background: var(--tg-surface) !important; color: var(--tg-link) !important; }
body.tg-on ol[data-list-id="chat-messages"] [role="separator"] [class*="unreadPill_"] { display: none !important; }

/* ---------- 7. Message box = Telegram composer ---------- */
body.tg-on .tg-cbox { position: relative !important; overflow: visible !important; margin-right: 64px !important; border: 0 !important; border-radius: 15px 15px 0 15px !important;
  background: var(--tg-surface) !important; box-shadow: 0 1px 2px rgba(0, 0, 0, .3) !important; }
body.tg-on .tg-cbox::after { content: ""; position: absolute; right: -8.4px; bottom: 0; width: 11px; height: 20px; background: var(--tg-surface);
  -webkit-mask: ${TAIL} no-repeat; mask: ${TAIL} no-repeat; transform: scaleX(-1); pointer-events: none; }
body.tg-on .tg-cbox [class*="scrollableContainer_"] { background: transparent !important; border-radius: 15px 15px 0 15px !important; }
body.tg-on .tg-cbox [class*="inner_"] { display: flex !important; align-items: flex-end !important; min-height: 56px !important; padding: 0 !important; }
body.tg-on .tg-cbox [class*="inner_"] > [class*="buttons_"] { display: contents !important; }
body.tg-on .tg-cbox [class*="inner_"] > [class*="textArea_"] { order: 2; flex: 1 1 auto !important; min-width: 0 !important; padding: 0 !important; }
body.tg-on .tg-cbox [role="textbox"], body.tg-on .tg-cbox [class*="placeholder_"] { font-size: 16px !important; line-height: 21px !important; padding: 17px 6px 17px 2px !important; min-height: 56px !important; box-sizing: border-box !important; }
body.tg-on .tg-cbox [role="textbox"] { color: var(--tg-text) !important; caret-color: var(--tg-primary); }
body.tg-on .tg-cbox [class*="placeholder_"] { color: var(--tg-text-2) !important; }
body.tg-on .tg-cbox .expression-picker-chat-input-button { order: 3; height: 56px !important; display: flex !important; align-items: center !important; margin: 0 !important; }
body.tg-on .tg-cbox .expression-picker-chat-input-button:has([class*="emojiButton_"]) { order: 1; margin-left: 8px !important; }
body.tg-on .tg-cbox :is(.app-launcher-entrypoint, [class*="container_"]:has(> [aria-label="Send a gift"])) { display: none !important; }
body.tg-on .tg-cbox [class*="attachWrapper_"] { order: 4; height: 56px !important; display: flex !important; align-items: center !important; padding: 0 8px 0 2px !important; margin: 0 !important; }
body.tg-on .tg-cbox [class*="attachButton_"] { color: var(--tg-text-2) !important; padding: 0 !important; }
body.tg-on .tg-cbox [class*="attachButton_"] svg { display: none !important; }
body.tg-on .tg-cbox [class*="attachButton_"] > * { display: none !important; }
body.tg-on .tg-cbox [class*="attachButton_"]::before { content: ""; display: block; width: 24px; height: 24px; margin: 4px; background: currentColor; -webkit-mask: ${M_ATTACH} center/24px no-repeat; mask: ${M_ATTACH} center/24px no-repeat; }
body.tg-on .tg-cbox :is([class*="attachButton_"], .expression-picker-chat-input-button [role="button"]):hover { color: var(--tg-primary) !important; }
body.tg-on .tg-cbox .expression-picker-chat-input-button [role="button"] { color: var(--tg-text-2) !important; }
body.tg-on form .tg-cbox ~ *, body.tg-on form [class*="typing_"] { color: var(--tg-text-2) !important; }
#tg-send {
  position: absolute; right: -64px; bottom: 0; width: 56px; height: 56px; border-radius: 50%; border: 0; padding: 0; cursor: pointer; z-index: 3;
  display: flex; align-items: center; justify-content: center; background: var(--tg-surface); color: var(--tg-primary); box-shadow: 0 1px 2px rgba(0, 0, 0, .3);
}
#tg-send::before { content: ""; width: 24px; height: 24px; background: currentColor; -webkit-mask: ${M_SEND} center/24px no-repeat; mask: ${M_SEND} center/24px no-repeat; }
#tg-send.tg-empty { color: var(--tg-text-2); cursor: default; }
body.tg-on form [class*="channelBottomBarArea_"] { padding-bottom: 6px !important; }

/* ---------- 8. Discord's menus, popouts and tooltips ---------- */
body.tg-on [role="menu"] {
  background: var(--tg-menu-bg) !important; -webkit-backdrop-filter: var(--tg-menu-blur) !important; backdrop-filter: var(--tg-menu-blur) !important;
  border: 0 !important; border-radius: 12px !important; box-shadow: var(--tg-menu-shadow) !important; padding: 4px !important;
}
body.tg-on [role="menu"] :is([role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]) {
  min-height: 32px !important; margin: 1px 0 !important; border-radius: 6px !important; font-size: 14px !important; font-weight: 500 !important;
}
body.tg-on [role="menu"] :is([role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]):not([class*="colorDanger_"]) { color: var(--tg-text) !important; }
body.tg-on [role="menu"] :is([role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"])[class*="focused_"] { background: rgba(255, 255, 255, .08) !important; }
body.tg-on.tg-day [role="menu"] :is([role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"])[class*="focused_"] { background: rgba(0, 0, 0, .06) !important; }
body.tg-on [role="menu"] [class*="separator_"] { background: rgba(255, 255, 255, .08) !important; }
body.tg-on [role="dialog"] { border-radius: 12px !important; }
body.tg-on [class*="tooltip_"][role="tooltip"], body.tg-on [class*="tooltipPrimary_"] { background: rgba(0, 0, 0, .75) !important; color: #fff !important; border-radius: 8px !important; -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
body.tg-on :is([class*="membersWrap_"], [class*="profilePanel_"], [class*="userPanelOuter_"]) { background: var(--tg-surface) !important; }

/* header of the chat list */
.tg-side-head { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; height: 56px; }
.tg-burger { flex: none; color: var(--tg-text-2) !important; }
.tg-burger.tg-active { background: rgba(255, 255, 255, .08) !important; }
.tg-search {
  position: relative; flex: 1; min-width: 0; height: 40px; display: flex; align-items: center; border-radius: 22px; box-sizing: border-box;
  background: var(--tg-input); border: 2px solid var(--tg-input); transition: border-color .2s, background-color .2s; cursor: text;
}
.tg-search:hover { border-color: #2f2f2f; }
.tg-search:focus-within { border-color: var(--tg-primary); background: transparent; }
.tg-search > svg { position: absolute; left: 10px; width: 22px; height: 22px; color: var(--tg-text-2); pointer-events: none; transition: color .2s; }
.tg-search:focus-within > svg { color: var(--tg-primary); }
.tg-search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--tg-text); font-size: 16px; padding: 0 36px 0 42px; }
.tg-search input::placeholder { color: var(--tg-text-2); }
.tg-search .tg-clear-q { position: absolute; right: 2px; width: 32px; height: 32px; display: none; }
.tg-search.tg-has .tg-clear-q { display: inline-flex; }
.tg-search .tg-clear-q svg { width: 20px; height: 20px; }
.tg-search-row { display: flex; align-items: center; gap: 14px; height: 56px; margin: 0 0 4px; padding: 0 12px; border-radius: 12px; cursor: pointer; color: var(--tg-text); font-size: 15px; }
.tg-search-row:hover { background: var(--tg-hover); }
.tg-search-row .tg-ri { width: 40px; height: 40px; border-radius: 50%; margin: 0; }
.tg-search-head { padding: 8px 14px 6px; color: var(--tg-text-2); font-size: 14px; font-weight: 500; }

/* pencil button */
#tg-fab {
  position: absolute; right: 20px; bottom: 20px; z-index: 6; width: 54px; height: 54px; border-radius: 50%; border: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center; color: #fff; background: var(--tg-primary);
  box-shadow: 0 1px 6px rgba(0, 0, 0, .35); transform: translateY(96px); transition: transform .25s var(--tg-ease), background-color .2s;
}
.tg-side:hover #tg-fab, #tg-fab.tg-open { transform: none; }
#tg-fab:hover { background: color-mix(in srgb, var(--tg-primary) 88%, #000); }
#tg-fab svg { width: 24px; height: 24px; transition: transform .25s var(--tg-ease); }
#tg-fab.tg-open svg { transform: rotate(90deg); }
#tg-resizer { position: absolute; top: 0; right: 0; width: 6px; height: 100%; cursor: ew-resize; z-index: 7; }
#tg-resizer:hover, #tg-resizer.tg-drag { background: linear-gradient(90deg, transparent 4px, var(--tg-primary) 4px); }
body.tg-resizing, body.tg-resizing * { cursor: ew-resize !important; user-select: none !important; }

/* ---------- 6. Panels that slide over the chat list (Settings etc.) ---------- */
#tg-left { position: absolute; inset: 0; z-index: 8; pointer-events: none; overflow: hidden; }
/* while a panel slides in, this layer sits under it and soaks up clicks that would hit the chat list */
#tg-left.tg-busy::before { content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: auto; }
.tg-panel {
  position: absolute; inset: 0; z-index: 1; display: flex; flex-direction: column; background: var(--tg-bg); color: var(--tg-text);
  transform: translateX(100%); transition: transform .3s var(--tg-ease); pointer-events: auto;
}
.tg-panel.tg-open { transform: none; }
.tg-panel.tg-under { transform: translateX(-25%); }
.tg-panel-head { flex: none; height: 56px; display: flex; align-items: center; gap: 4px; padding: 0 8px; box-sizing: border-box; background: var(--tg-bg); }
.tg-panel-head h2 { flex: 1; min-width: 0; margin: 0 0 0 18px; font-size: 20px; font-weight: 500; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--tg-text); }
.tg-panel-head input { flex: 1; min-width: 0; height: 40px; margin-left: 8px; border: 0; outline: 0; background: transparent; color: var(--tg-text); font-size: 18px; }
.tg-panel-body { flex: 1; overflow-y: auto; padding: 0 0 24px; }
.tg-prof { display: flex; flex-direction: column; align-items: center; padding: 6px 16px 22px; text-align: center; }
.tg-prof .tg-avatar, .tg-prof img.tg-photo { width: 120px; height: 120px; font-size: 48px; }
.tg-prof .tg-prof-name { margin-top: 16px; font-size: 20px; font-weight: 500; line-height: 1.25; word-break: break-word; }
.tg-prof .tg-prof-status { margin-top: 4px; font-size: 14px; color: var(--tg-text-2); }
.tg-prof .tg-prof-status.tg-typing { color: var(--tg-link); }
img.tg-photo { border-radius: 50%; object-fit: cover; display: block; }
.tg-card { margin: 0 8px 16px; padding: 4px 0; background: var(--tg-surface); border-radius: 16px; overflow: hidden; }
.tg-card-title { padding: 10px 16px 6px; color: var(--tg-link); font-size: 15px; font-weight: 500; }
.tg-caption { margin: -8px 20px 16px; color: var(--tg-text-2); font-size: 14px; line-height: 1.35; }
.tg-row {
  display: flex; align-items: center; min-height: 54px; margin: 0 4px; padding: 6px 14px 6px 12px; box-sizing: border-box;
  border-radius: 12px; cursor: pointer; color: var(--tg-text); transition: background-color .15s;
}
.tg-row:hover { background: var(--tg-hover); }
.tg-row.tg-static { cursor: default; }
.tg-row.tg-static:hover { background: transparent; }
.tg-ri { width: 30px; height: 30px; border-radius: 8px; flex: none; display: flex; align-items: center; justify-content: center; color: #fff; background: var(--c, #8d96a1); margin-right: 26px; }
.tg-ri svg { width: 20px; height: 20px; stroke-width: 2; }
.tg-ri.tg-plain { background: none; color: var(--tg-text-2); }
.tg-ri.tg-plain svg { width: 24px; height: 24px; stroke-width: 1.8; }
.tg-rt { flex: 1; min-width: 0; }
.tg-rl { font-size: 16px; line-height: 21px; overflow: hidden; text-overflow: ellipsis; }
.tg-rs { font-size: 14px; line-height: 18px; color: var(--tg-text-2); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; }
.tg-rv { flex: none; margin-left: 12px; color: var(--tg-text-2); font-size: 15px; max-width: 45%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tg-row.tg-danger { color: var(--tg-danger); }
.tg-row.tg-danger .tg-ri.tg-plain { color: var(--tg-danger); }
.tg-row.tg-accent { color: var(--tg-link); }
.tg-row.tg-accent .tg-ri.tg-plain { color: var(--tg-link); }
.tg-version { padding: 4px 16px 8px; text-align: center; color: var(--tg-text-2); font-size: 14px; }
.tg-switch { position: relative; flex: none; width: 34px; height: 14px; margin-left: 12px; border-radius: 7px; background: #5c5c5c; transition: background-color .2s; }
.tg-switch::after {
  content: ""; position: absolute; top: -3px; left: -2px; width: 20px; height: 20px; box-sizing: border-box; border-radius: 50%;
  background: var(--tg-surface); border: 2px solid #5c5c5c; transition: transform .2s var(--tg-ease), border-color .2s;
}
.tg-switch.tg-on { background: var(--tg-primary); }
.tg-switch.tg-on::after { transform: translateX(18px); border-color: var(--tg-primary); }
.tg-radio { flex: none; width: 20px; height: 20px; box-sizing: border-box; border-radius: 50%; border: 2px solid #707579; margin-right: 30px; margin-left: 5px; position: relative; transition: border-color .2s; }
.tg-radio.tg-on { border-color: var(--tg-primary); }
.tg-radio.tg-on::after { content: ""; position: absolute; inset: 3px; border-radius: 50%; background: var(--tg-primary); }
.tg-range { display: flex; align-items: center; gap: 14px; padding: 4px 16px 14px; }
.tg-range input { flex: 1; accent-color: var(--tg-primary); }
.tg-range-head { display: flex; justify-content: space-between; padding: 12px 16px 0; font-size: 16px; }
.tg-range-head span { color: var(--tg-text-2); }
.tg-colors { display: flex; flex-wrap: wrap; gap: 12px; padding: 10px 16px 16px; }
.tg-colors button { width: 36px; height: 36px; border-radius: 50%; border: 0; cursor: pointer; background: var(--c); position: relative; transition: transform .15s; }
.tg-colors button:hover { transform: scale(1.08); }
.tg-colors button.tg-on::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid var(--c); }
.tg-kbd { display: inline-block; min-width: 18px; padding: 2px 6px; margin-left: 4px; border-radius: 6px; background: #2f2f2f; color: var(--tg-text); font-size: 13px; text-align: center; }
.tg-media { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; padding: 0 0 8px; }
.tg-media img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; cursor: pointer; background: #111; }
.tg-tabs { position: sticky; top: 0; z-index: 2; display: flex; background: var(--tg-surface); border-bottom: 1px solid #2a2a2a; }
.tg-tabs button { flex: 1; height: 48px; border: 0; background: none; color: var(--tg-text-2); font-size: 15px; font-weight: 500; cursor: pointer; position: relative; }
.tg-tabs button:hover { background: rgba(255, 255, 255, .04); }
.tg-tabs button.tg-on { color: var(--tg-link); }
.tg-tabs button.tg-on::after { content: ""; position: absolute; left: 50%; bottom: 0; width: 40%; height: 3px; transform: translateX(-50%); border-radius: 3px 3px 0 0; background: var(--tg-primary); }
.tg-empty-note { padding: 32px 16px; text-align: center; color: var(--tg-text-2); font-size: 15px; }

/* ---------- 7. Right column: chat info ---------- */
#tg-right {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 950; width: 400px; max-width: 100vw; display: flex; flex-direction: column;
  background: var(--tg-bg); border-left: 1px solid var(--tg-border); transform: translateX(100%); transition: transform .3s var(--tg-ease);
}
#tg-right.tg-open { transform: none; }
#tg-right .tg-panel-body { padding-top: 0; }

/* ---------- 8. Chat header ---------- */
#tg-header {
  position: fixed; top: 0; z-index: 900; height: var(--tg-head); display: flex; align-items: center; gap: 4px; box-sizing: border-box;
  padding: 0 8px 0 16px; background: var(--tg-surface); color: var(--tg-text); box-shadow: 0 1px 2px rgba(0, 0, 0, .25);
  transition: right .3s var(--tg-ease);
}
#tg-header .tg-h-side { margin-left: -8px; margin-right: 4px; }
#tg-header .tg-h-main { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; height: 100%; cursor: pointer; }
#tg-header .tg-h-av { width: 42px; height: 42px; font-size: 17px; }
#tg-header .tg-h-text { min-width: 0; }
#tg-header .tg-h-title { font-size: 16px; font-weight: 500; line-height: 22px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#tg-header .tg-h-status { font-size: 14px; line-height: 18px; color: var(--tg-text-2); white-space: nowrap; }
#tg-header .tg-h-status.tg-typing { color: var(--tg-link); }
#tg-header .tg-h-actions { display: flex; gap: 2px; flex: none; }
#tg-header .tg-iconbtn { color: var(--tg-text-2); }
#tg-header .tg-h-search { display: none; flex: 1; align-items: center; gap: 8px; min-width: 0; }
#tg-header.tg-searching :is(.tg-h-main, .tg-h-actions, .tg-h-pin) { display: none !important; }
#tg-header.tg-searching .tg-h-search { display: flex; }
#tg-header .tg-h-search .tg-search { max-width: 520px; }
.tg-h-pin { display: none; align-items: center; gap: 10px; flex: 0 1 320px; min-width: 0; height: 42px; padding: 0 8px 0 10px; border-radius: 8px; cursor: pointer; }
.tg-h-pin.tg-show { display: flex; }
.tg-h-pin:hover { background: rgba(255, 255, 255, .05); }
.tg-h-pin .tg-pin-bars { width: 2px; align-self: stretch; margin: 4px 0; border-radius: 1px; background: var(--tg-primary); flex: none; }
.tg-h-pin .tg-pin-text { min-width: 0; flex: 1; }
.tg-h-pin .tg-pin-title { color: var(--tg-link); font-size: 14px; font-weight: 500; line-height: 18px; }
.tg-h-pin .tg-pin-snip { font-size: 14px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tg-h-pin .tg-iconbtn { width: 32px; height: 32px; }
.tg-h-pin .tg-iconbtn svg { width: 20px; height: 20px; }
.tg-dots::after { content: ""; display: inline-block; width: 14px; text-align: left; animation: tg-dots 1.2s steps(1) infinite; }
@keyframes tg-dots { 0% { content: "" } 25% { content: "." } 50% { content: ".." } 75% { content: "..." } }

/* bottom bars that replace the message box (search results, selection) */
#tg-bottombar {
  position: fixed; z-index: 905; display: none; align-items: center; gap: 8px; height: 56px; padding: 0 8px 0 12px; box-sizing: border-box;
  background: var(--tg-surface); border-radius: 15px; box-shadow: 0 1px 2px rgba(0, 0, 0, .3); color: var(--tg-text);
}
#tg-bottombar.tg-show { display: flex; }
#tg-bottombar .tg-bb-text { flex: 1; font-size: 16px; font-weight: 500; white-space: nowrap; }
body.tg-bar-open input-container .input-area-container { visibility: hidden !important; }
.tg-textbtn2 { height: 40px; padding: 0 14px; border: 0; border-radius: 10px; background: none; color: var(--tg-link); font-size: 15px; font-weight: 500; text-transform: uppercase; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.tg-textbtn2:hover { background: var(--tg-p08); }
.tg-textbtn2.tg-danger { color: var(--tg-danger); }
.tg-textbtn2.tg-danger:hover { background: rgba(255, 89, 90, .08); }
.tg-textbtn2 svg { width: 22px; height: 22px; }


/* time, ticks and reactions inside bubbles */
/* Telegram's trick: an invisible copy of the time reserves room at the end of the last line,
   the visible time sits in the bubble's bottom-right corner */
.tg-meta {
  display: inline-block; position: static; visibility: hidden; height: 12px; margin-left: 10px; vertical-align: -1px;
  font-size: 12px; line-height: 12px; white-space: nowrap; user-select: none; pointer-events: none; font-style: normal; font-weight: 400;
}
.tg-meta::before { content: attr(data-time); }
.tg-u .tg-meta { padding-right: 17px; }
.tg-meta.tg-pinned { padding-left: 14px; }
.tg-meta.tg-block { display: block; height: 8px; margin: 0; }
.tg-meta-in {
  visibility: visible; position: absolute; right: 9px; bottom: 5px; display: inline-flex; align-items: center; gap: 2px; height: 16px;
  font-size: 12px; line-height: 16px; white-space: nowrap; color: var(--tg-in-meta); pointer-events: none;
}
.tg-meta-in::before { content: attr(data-time); }
.tg-u .tg-meta-in { color: var(--tg-out-meta); right: 7px; }
.tg-meta-in i { display: none; width: 19px; height: 14px; margin-right: -3px; background: currentColor; }
.tg-u .tg-meta-in i { display: inline-block; -webkit-mask: ${M_CHECK1} center/contain no-repeat; mask: ${M_CHECK1} center/contain no-repeat; }
.tg-u .tg-meta.tg-read .tg-meta-in i { -webkit-mask-image: ${M_CHECK2}; mask-image: ${M_CHECK2}; }
.tg-meta-in b { display: none; width: 12px; height: 12px; margin-right: 2px; background: currentColor; -webkit-mask: var(--tg-pin-mask) center/contain no-repeat; mask: var(--tg-pin-mask) center/contain no-repeat; }
.tg-meta.tg-pinned .tg-meta-in b { display: inline-block; }
body.tg-on :is(.tg-u .query-text, .tg-u .query-text-line, .tg-u .horizontal-container, .tg-m .markdown, .tg-m .markdown > p,
  .tg-m .response-content, .tg-m .tg-m-content, .tg-m structured-content-container, .tg-m structured-content-container > .container, .tg-m message-content) { position: static !important; }
.tg-reacts { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 2px; clear: both; }
.tg-react {
  display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 9px 0 6px; border-radius: 15px; border: 0; cursor: pointer;
  font-size: 18px; line-height: 1; color: var(--tg-link); background: var(--tg-p25); transition: transform .15s;
}
.tg-u .tg-react { background: rgba(255, 255, 255, .22); color: #fff; }
.tg-react:hover { transform: scale(1.04); }
.tg-react b { font-size: 14px; font-weight: 500; font-family: var(--tg-font); }
.tg-react.tg-pop { animation: tg-pop .35s ease; }
@keyframes tg-pop { 0% { transform: scale(.4) } 60% { transform: scale(1.15) } 100% { transform: scale(1) } }
.tg-row-active, .tg-flash, .tg-selected { background: var(--tg-p25); box-shadow: 0 0 0 100vmax var(--tg-p25); clip-path: inset(-3px -100vmax); }
.tg-flash { animation: tg-flash 1.6s ease forwards; }
@keyframes tg-flash { 0%, 40% { background: var(--tg-p40); box-shadow: 0 0 0 100vmax var(--tg-p40); } 100% { background: transparent; box-shadow: 0 0 0 100vmax transparent; } }
.tg-found :is(..tg-u-bubble-with-background, .response-container-content) { outline: 2px solid var(--tg-link); outline-offset: 2px; }
body.tg-selecting :is(.tg-u, .tg-m) { cursor: pointer; position: relative; }
body.tg-selecting :is(.tg-u, .tg-m)::before {
  content: ""; position: absolute; left: -36px; bottom: 6px; width: 22px; height: 22px; box-sizing: border-box; border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, .7); background: rgba(0, 0, 0, .15); z-index: 2;
}
body.tg-selecting .tg-selected::before {
  background: var(--tg-primary) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12l5 5 9-10'/%3E%3C/svg%3E") center/14px no-repeat !important;
  border-color: var(--tg-primary) !important;
}
body.tg-selecting :is(.tg-m, .tg-u) * { pointer-events: none; }
.tg-deleted { display: none !important; }
body.tg-show-deleted .tg-deleted { display: revert !important; opacity: .35; }
.tg-quote {
  display: block; position: relative; margin: 2px 0 6px; padding: 3px 8px 4px 10px; border-radius: 4px; overflow: hidden; cursor: pointer; max-width: 100%;
  background: rgba(255, 255, 255, .14);
}
.tg-quote::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: currentColor; }
.tg-quote .tg-q-name { display: block; font-size: 14px; font-weight: 500; line-height: 18px; }
.tg-quote .tg-q-text { display: block; font-size: 14px; line-height: 18px; opacity: .9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tg-fwd-head { display: block; font-size: 14px; font-weight: 500; opacity: .95; margin: 0 0 2px; }
.tg-fwd-head i { font-style: normal; font-weight: 600; }
.tg-fwd-body { display: block; white-space: pre-wrap; }
.tg-fwd-comment { display: block; border-top: 1px solid rgba(255, 255, 255, .25); margin-top: 6px; padding-top: 6px; }
.tg-date { display: flex; justify-content: center; width: 100%; margin: 6px 0; pointer-events: none; }
#tg-float-date { position: fixed; z-index: 899; top: calc(var(--tg-head) + 8px); transform: translateX(-50%); opacity: 0; transition: opacity .35s; pointer-events: none; }
#tg-float-date.tg-show { opacity: 1; transition-duration: .15s; }
.tg-date span, .tg-service, #tg-float-date {
  background: var(--tg-chip); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); color: #fff;
  font-size: 15px; font-weight: 500; line-height: 20px; padding: 3px 9px; border-radius: 13px;
}


/* reply / forward bar above the box */
#tg-replybar { display: none; align-items: center; gap: 12px; margin: 0 64px 0 0; padding: 0 4px 8px 14px; box-sizing: border-box; text-align: left;
  background: var(--tg-surface); border-radius: 15px 15px 0 0; position: relative; top: 8px; height: 56px; }
#tg-replybar.tg-show { display: flex; }
#tg-replybar > svg { color: var(--tg-primary); flex: none; }
#tg-replybar .tg-rb-text { flex: 1; min-width: 0; position: relative; padding-left: 10px; cursor: pointer; }
#tg-replybar .tg-rb-text::before { content: ""; position: absolute; left: 0; top: 2px; bottom: 2px; width: 2px; border-radius: 1px; background: var(--tg-primary); }
#tg-replybar .tg-rb-title { color: var(--tg-link); font-size: 14px; font-weight: 500; line-height: 18px; }
#tg-replybar .tg-rb-snip { font-size: 14px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
body.tg-on input-area-v2:has(+ #tg-replybar.tg-show) .text-input-field, #tg-replybar.tg-show + * .text-input-field { border-top-left-radius: 0 !important; border-top-right-radius: 0 !important; }

/* scroll to bottom */
#tg-down {
  position: fixed; z-index: 898; width: 54px; height: 54px; border-radius: 50%; border: 0; cursor: pointer; display: flex;
  align-items: center; justify-content: center; color: var(--tg-text-2); background: var(--tg-surface); box-shadow: 0 1px 3px rgba(0, 0, 0, .4);
  opacity: 0; transform: translateY(20px) scale(.9); pointer-events: none; transition: opacity .2s, transform .2s var(--tg-ease);
}
#tg-down.tg-show { opacity: 1; transform: none; pointer-events: auto; }
#tg-down:hover { color: var(--tg-text); }
#tg-down b {
  position: absolute; top: -6px; right: -2px; min-width: 22px; height: 22px; padding: 0 6px; box-sizing: border-box; border-radius: 11px;
  background: var(--tg-primary); color: #fff; font-size: 13px; font-weight: 500; display: none; align-items: center; justify-content: center;
}
#tg-down b.tg-show { display: flex; }


/* ---------- 12. Menus (ours and Gemini's) ---------- */
.tg-ui, .tg-ui * { box-sizing: border-box; }
.tg-ui { color: var(--tg-text); font-family: var(--tg-font); }
.tg-ui svg, svg.tg-i { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.tg-iconbtn {
  width: 40px; height: 40px; border-radius: 50%; border: 0; background: transparent; color: var(--tg-text-2); flex: none; padding: 0;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background-color .15s, color .15s;
}
.tg-iconbtn:hover { background: rgba(255, 255, 255, .08); }
.tg-hidden { display: none !important; }
.tg-backdrop { position: fixed; inset: 0; z-index: 2147483000; }
.tg-menu-wrap { position: fixed; z-index: 2147483001; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.tg-menu {
  position: relative; min-width: 210px; padding: 4px 0; border-radius: 12px; background: var(--tg-menu-bg);
  -webkit-backdrop-filter: var(--tg-menu-blur); backdrop-filter: var(--tg-menu-blur); box-shadow: var(--tg-menu-shadow); color: var(--tg-text);
  user-select: none; transform-origin: var(--tg-origin, top left); animation: tg-menu-in .2s var(--tg-ease);
}
@keyframes tg-menu-in { from { opacity: 0; transform: scale(.88); } }
.tg-menu.tg-sub { position: fixed; z-index: 2147483002; }
.tg-mi {
  display: flex; align-items: center; gap: 18px; width: calc(100% - 8px); height: 32px; margin: 2px 4px; padding: 0 12px 0 12px;
  border: 0; border-radius: 6px; background: none; color: inherit; font-size: 14px; font-weight: 500; line-height: 1; text-align: left; cursor: pointer; white-space: nowrap;
}
.tg-mi svg { width: 20px; height: 20px; }
.tg-mi:hover, .tg-mi.tg-hl { background: rgba(255, 255, 255, .08); }
.tg-mi.tg-danger { color: var(--tg-danger); }
.tg-mi .tg-mi-end { margin-left: auto; padding-left: 12px; color: var(--tg-text-2); display: inline-flex; }
.tg-mi .tg-mi-end svg { width: 18px; height: 18px; }
.tg-mi img.tg-photo, .tg-mi .tg-avatar { width: 22px; height: 22px; font-size: 10px; box-shadow: 0 0 0 2px var(--tg-menu-bg), 0 0 0 3.5px var(--tg-primary); }
.tg-mi.tg-acc { font-weight: 500; }
.tg-menu hr { height: 1px; border: 0; margin: 4px 0; background: rgba(255, 255, 255, .08); }
.tg-menu .tg-menu-foot { padding: 8px 12px 6px; text-align: center; color: var(--tg-text-2); font-size: 12px; font-weight: 400; }
.tg-reactbar {
  display: flex; align-items: center; gap: 0; padding: 4px; border-radius: 24px; background: var(--tg-menu-bg);
  -webkit-backdrop-filter: var(--tg-menu-blur); backdrop-filter: var(--tg-menu-blur); box-shadow: var(--tg-menu-shadow); animation: tg-menu-in .2s var(--tg-ease);
}
.tg-reactbar button, .tg-emojigrid button {
  width: 40px; height: 40px; border: 0; border-radius: 50%; background: transparent; font-size: 26px; line-height: 1; cursor: pointer; padding: 0;
  display: inline-flex; align-items: center; justify-content: center; transition: transform .12s, background-color .12s;
  font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif !important;
}
.tg-reactbar button:hover { transform: scale(1.2); }
.tg-reactbar button.tg-on { background: var(--tg-p40); }
.tg-reactbar .tg-more { width: 32px; height: 32px; margin-left: 2px; color: var(--tg-text); background: rgba(255, 255, 255, .1); font-size: 0; }
.tg-reactbar .tg-more svg { width: 20px; height: 20px; }
.tg-reactbar .tg-more:hover { transform: none; background: rgba(255, 255, 255, .16); }
.tg-emojigrid {
  display: grid; grid-template-columns: repeat(8, 40px); gap: 2px; padding: 8px; max-height: 280px; overflow-y: auto; border-radius: 14px;
  background: var(--tg-menu-bg); -webkit-backdrop-filter: var(--tg-menu-blur); backdrop-filter: var(--tg-menu-blur); box-shadow: var(--tg-menu-shadow);
  animation: tg-menu-in .2s var(--tg-ease);
}
.tg-emojigrid button:hover { background: rgba(255, 255, 255, .1); }
.tg-emojipanel-head { display: flex; gap: 2px; padding: 0 0 6px; grid-column: 1 / -1; color: var(--tg-text-2); font-size: 13px; font-weight: 500; }


/* ---------- 13. Pop-ups and toast ---------- */
.tg-modal-back { position: fixed; inset: 0; z-index: 2147483002; background: rgba(0, 0, 0, .5); display: flex; align-items: center; justify-content: center; animation: tg-fade .15s; }
@keyframes tg-fade { from { opacity: 0 } }
.tg-modal {
  width: min(420px, calc(100vw - 32px)); max-height: 80vh; display: flex; flex-direction: column; padding: 4px 0 0; background: var(--tg-surface);
  border-radius: 12px; box-shadow: 0 8px 32px rgba(0, 0, 0, .6); overflow: hidden; animation: tg-pop-in .2s var(--tg-ease);
}
@keyframes tg-pop-in { from { opacity: 0; transform: scale(.92); } }
.tg-modal h3 { margin: 0; padding: 16px 20px 8px; font-size: 20px; font-weight: 500; display: flex; align-items: center; gap: 14px; }
.tg-modal p { margin: 0; padding: 4px 20px 8px; font-size: 16px; line-height: 1.4; color: var(--tg-text); }
.tg-modal .tg-modal-body { overflow-y: auto; padding: 0 8px; }
.tg-modal .tg-actions { display: flex; justify-content: flex-end; gap: 4px; padding: 8px 10px 10px; }
.tg-modal .tg-textbtn { border: 0; background: transparent; color: var(--tg-link); font-size: 15px; font-weight: 500; text-transform: uppercase; padding: 10px 14px; border-radius: 8px; cursor: pointer; }
.tg-modal .tg-textbtn:hover { background: var(--tg-p08); }
.tg-modal .tg-textbtn.tg-danger { color: var(--tg-danger); }
.tg-modal .tg-textbtn.tg-danger:hover { background: rgba(255, 89, 90, .08); }
.tg-modal .tg-search { margin: 4px 16px 8px; flex: none; }
.tg-chatpick { display: flex; align-items: center; gap: 14px; height: 56px; padding: 0 12px; border-radius: 12px; cursor: pointer; }
.tg-chatpick:hover { background: var(--tg-hover); }
.tg-chatpick .tg-avatar { width: 42px; height: 42px; font-size: 17px; }
.tg-chatpick span:last-child { font-size: 16px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tg-translate .tg-tr-block { margin: 6px 16px; padding: 10px 12px; border-radius: 10px; background: var(--tg-bg); font-size: 15px; line-height: 1.45; white-space: pre-wrap; max-height: 30vh; overflow-y: auto; }
.tg-translate .tg-tr-label { padding: 6px 20px 0; color: var(--tg-link); font-size: 14px; font-weight: 500; }
#tg-toast {
  position: fixed; left: 50%; top: 72px; z-index: 2147483003; transform: translateX(-50%) translateY(-10px); opacity: 0; pointer-events: none;
  background: rgba(0, 0, 0, .78); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); color: #fff; padding: 10px 16px; border-radius: 12px;
  font-size: 14px; transition: opacity .2s, transform .2s; display: flex; align-items: center; gap: 12px; max-width: 90vw;
}
#tg-toast.tg-show { opacity: 1; transform: translateX(-50%); }
#tg-toast svg { width: 22px; height: 22px; color: var(--tg-link); }

/* avatars */
.tg-avatar {
  width: 42px; height: 42px; border-radius: 50%; flex: none; display: inline-flex; align-items: center; justify-content: center; overflow: hidden;
  color: #fff; font-weight: 500; font-size: 17px; text-transform: uppercase; user-select: none; letter-spacing: 0;
  background: linear-gradient(180deg, var(--av1, #82b1ff), var(--av2, #665fff));
}
.tg-avatar svg { width: 55%; height: 55%; stroke-width: 1.6; }
.tg-avatar.tg-bot { background: linear-gradient(180deg, #a99bf0, #6c5ce0); }

/* scrollbars */
body.tg-on * { scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, .18) transparent; }
body.tg-on ::-webkit-scrollbar { width: 6px; height: 6px; }
body.tg-on ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, .18); border-radius: 3px; }
body.tg-on ::-webkit-scrollbar-track { background: transparent; }
body.tg-on ::selection { background: var(--tg-p40); }

/* reduced motion */
body.tg-still *, body.tg-still *::before, body.tg-still *::after { animation-duration: 0s !important; transition-duration: 0s !important; }

`;

  let styleEl = null;
  function addStyle() {
    if (styleEl && styleEl.isConnected) return;
    if (typeof GM_addStyle === 'function') { try { styleEl = GM_addStyle(CSS); } catch (e) { styleEl = null; } if (styleEl) return; }
    const parent = document.head || document.documentElement;
    if (!parent) return;
    styleEl = document.createElement('style');
    styleEl.id = 'tg-style';
    styleEl.textContent = CSS;
    parent.appendChild(styleEl);
  }
  function addFont() {
    if (document.getElementById('tg-font')) return;
    const parent = document.head || document.documentElement;
    if (!parent) return;
    const l = document.createElement('link');
    l.id = 'tg-font'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,400;0,500;0,700;1,400&display=swap';
    parent.appendChild(l);
  }
  addStyle(); addFont();
  const styleKeeper = new MutationObserver(() => { addStyle(); addFont(); });
  styleKeeper.observe(document, { childList: true, subtree: true });
  window.addEventListener('load', () => setTimeout(() => styleKeeper.disconnect(), 4000), L);
  document.documentElement.style.setProperty('--tg-pin-mask', svgUrl('<path d="M15 4l5 5-3 1-3.5 3.5.5 4-1.5 1.5L4 11.5 5.5 10l4 .5L13 7zM8.5 15.5L4 20"/>'));

  /* =====================================================================
     Helpers
     ===================================================================== */
  const QUICK = ['❤️', '👍', '👎', '🔥', '🥰', '👏', '😁'];
  const EMOJI = ('😀 😁 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😎 🤓 🤩 🥳 😏 😒 😔 😢 😭 😤 😡 🤯 😳 🥺 😱 🤔 🤫 🙄 😬 😴 🤤 🤢 🤮 🤧 😷 🤠 🤡 💀 👻 👽 🤖 🎃 😺 🙈 🙉 🙊 ' +
    '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❤️‍🔥 💯 💢 💥 💫 💦 🔥 ✨ ⭐ 🌟 ⚡ 🎉 🎊 🎁 🏆 🥇 👍 👎 👌 ✌️ 🤞 🤟 🤘 👏 🙌 🙏 💪 👀 🫡 🤝 ✍️ 💅 ' +
    '🐶 🐱 🐭 🦊 🐻 🐼 🐨 🐯 🦁 🐸 🐵 🐔 🐧 🦄 🐉 🦋 🌸 🌹 🌈 ☀️ 🌙 ☕ 🍕 🍔 🍟 🍣 🍩 🍪 🍺 🍷 🎮 🎧 🎵 💻 📱 💡 📌 ✅ ❌ ❓ ❗').split(' ');
  const AV = [['#ff885e', '#ff516a'], ['#ffcd6a', '#ffa85c'], ['#82b1ff', '#665fff'], ['#a0de7e', '#54cb68'],
              ['#53edd6', '#28c9b7'], ['#72d5fd', '#2a9ef1'], ['#e0a2f3', '#d669ed']];
  const ACCENTS = ['#8774e1', '#3390ec', '#2ea6d8', '#4fae4e', '#e5a03a', '#e5534b', '#d4589b', '#7c8b99'];

  // tiny DOM builder (no innerHTML: Gemini enforces Trusted Types)
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }
  const ICONS = {
    menu: 'M4 7h16|M4 12h16|M4 17h16',
    back: 'M19 12H5|M11 6l-6 6 6 6',
    search: 'c10.5,10.5,6.5|M15.5 15.5L20 20',
    more: 'c12,5,1.7|c12,12,1.7|c12,19,1.7',
    close: 'M6 6l12 12|M18 6L6 18',
    edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z|M13.5 6.5l4 4',
    add: 'M12 5v14|M5 12h14',
    check: 'M5 12.5l4.5 4.5L19 7',
    chevRight: 'M9 6l6 6-6 6',
    chevDown: 'M6 9l6 6 6-6', up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6',
    arrowDown: 'M12 5v14|M6 13l6 6 6-6',
    bookmark: 'M7 3.5h10a1 1 0 0 1 1 1V20l-6-4-6 4V4.5a1 1 0 0 1 1-1z',
    images: 'M4 5h16v14H4z|M4 16l5-5 4 4 3-3 4 4|c15,9,1.5',
    clock: 'c12,12,9|M12 7v5l3 2',
    user: 'c12,8,4|M4.5 20c1.2-4 4.2-6 7.5-6s6.3 2 7.5 6',
    notebook: 'M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z|M9 3v18|M12 8h4|M12 12h4',
    settings: 'c12,12,3|M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
    moon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z',
    sun: 'c12,12,4|M12 2.5v2|M12 19.5v2|M4.9 4.9l1.4 1.4|M17.7 17.7l1.4 1.4|M2.5 12h2|M19.5 12h2|M4.9 19.1l1.4-1.4|M17.7 6.3l1.4-1.4',
    bolt: 'M13 3L5 13.5h6L10 21l8-10.5h-6z',
    switchG: 'M3 12h8|M8 9l3 3-3 3|M21 9.5a5 5 0 1 0 .4 4.5H17',
    help: 'c12,12,9|M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.5|M12 17h.01',
    bug: 'M9 7.5a3 3 0 0 1 6 0|M7 10h10v4.5a5 5 0 0 1-10 0z|M12 10v9.5|M3.5 13H7|M17 13h3.5|M5 7.5l2.2 1.8|M19 7.5l-2.2 1.8|M5 19.5l2.3-2|M19 19.5l-2.3-2',
    install: 'c12,12,9|M12 8v8|M8 12h8',
    reply: 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
    forward: 'M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z',
    copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z|M16 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3',
    translate: 'M3 5h9|M7.5 3v2|M5 5c.5 4 3 7 6.5 8.5|M10 5c-.5 4.5-3.5 8-7 9.5|M13 21l4-10 4 10|M14.5 17.5h5',
    pin: 'M15 4l5 5-3 1-3.5 3.5.5 4-1.5 1.5L4 11.5 5.5 10l4 .5L13 7z|M8.5 15.5L4 20',
    unpin: 'M15 4l5 5-3 1-3.5 3.5.5 4-1.5 1.5L4 11.5 5.5 10l4 .5L13 7z|M8.5 15.5L4 20|M3 3l18 18',
    select: 'c12,12,9|M8 12.5l3 3 5-6',
    trash: 'M4 7h16|M10 11v6|M14 11v6|M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12|M9 7V4h6v3',
    redo: 'M20 12a8 8 0 1 1-2.3-5.7|M20 4v5h-5',
    speaker: 'M4 9v6h4l5 4V5L8 9H4z|M16 9a4 4 0 0 1 0 6|M18.5 6.5a8 8 0 0 1 0 11',
    link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1|M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
    newtab: 'M14 4h6v6|M20 4l-9 9|M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7|M12 3v12|M7 8l5-5 5 5',
    timer: 'c12,13,8|M12 9v4l2.5 1.5|M9.5 2.5h5',
    smile: 'c12,12,9|M8.5 14.5a4.5 4.5 0 0 0 7 0|M9 9.5h.01|M15 9.5h.01',
    info: 'c12,12,9|M12 11v5|M12 8h.01',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z|c12,12,3',
    broom: 'M14 4l6 6|M17 7l-7 7|M4 20l3-8 5 5-8 3z',
    palette: 'M12 3a9 9 0 0 0 0 18c1 0 1.5-.8 1.5-1.5 0-1-.7-1.3-.7-2.2 0-.8.7-1.3 1.5-1.3H17a4 4 0 0 0 4-4c0-5-4-9-9-9z|c7.5,11,1|c10,7,1|c15,7,1',
    bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z|M10 20.5a2 2 0 0 0 4 0',
    bellOff: 'M6 16v-5a6 6 0 0 1 9.5-4.9|M18 11v5l1.5 2H8|M10 20.5a2 2 0 0 0 4 0|M3 3l18 18',
    data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z|M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6|M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    key: 'c8,15,4|M11 12l9-9|M16 7l3 3|M14 9l2 2',
    lock: 'M6 11h12v9H6z|M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    globe: 'c12,12,9|M3 12h18|M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9s1.3-6.5 3.8-9z',
    keyboard: 'M3 6h18v12H3z|M7 10h.01|M11 10h.01|M15 10h.01|M7 14h10',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    heart: 'M12 20s-7-4.4-9-9a4.5 4.5 0 0 1 9-3 4.5 4.5 0 0 1 9 3c-2 4.6-9 9-9 9z',
    star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
    store: 'M4 9l1.5-5h13L20 9|M4 9v11h16V9|M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0|M10 20v-5h4v5',
    gift: 'M4 9h16v4H4z|M5 13v7h14v-7|M12 9v11|M12 9C9.5 9 7.5 8 7.5 6.3a1.8 1.8 0 0 1 1.8-1.8C11 4.5 12 7 12 9z|M12 9c2.5 0 4.5-1 4.5-2.7a1.8 1.8 0 0 0-1.8-1.8C13 4.5 12 7 12 9z',
    pace: 'M4.5 17a8 8 0 1 1 15 0|M12 15l4-5',
    person: 'c10,8,4|M3 20c1-4 3.8-6 7-6 1.5 0 2.8.4 4 1.2|M18 13l1 2.2 2.3.4-1.7 1.6.4 2.3L18 18.4 16 19.5l.4-2.3-1.7-1.6 2.3-.4z',
    doc: 'M7 3h7l5 5v13H7z|M14 3v5h5|M10 13h6|M10 17h6',
    avatar: 'c12,9,4|M5 20c1.2-3.6 3.9-5.5 7-5.5s5.8 1.9 7 5.5',
    gem: 'M6 4h12l3 5-9 11L3 9z|M3 9h18|M12 20L9 9l3-5 3 5z',
    watermark: 'M4 5h16v14H4z|M8 15l3-4 2 2.5 1.5-2L17 15z|c9,9,1.3',
    code: 'M8 7l-5 5 5 5|M16 7l5 5-5 5|M14 4l-4 16',
    upload: 'M12 16V4|M7 9l5-5 5 5|M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
    feedback: 'M4 5h16v11H9l-5 4z|M12 8.5v3|M12 13.5h.01',
    location: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z|c12,10,2.5',
    history: 'M3 12a9 9 0 1 0 3-6.7L3 8|M3 3v5h5|M12 7v5l3 2',
    chat: 'M4 5h16v11H9l-5 4z',
    shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z|M9 12l2 2 4-4',
    mail: 'M3 6h18v12H3z|M3 7l9 6 9-6',
    download: 'M12 4v12|M7 11l5 5 5-5|M5 20h14',
    files: 'M7 3h7l5 5v13H7z|M14 3v5h5',
    group: 'c9,8,3.5|M2.5 19c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5|M16 4.5a3.5 3.5 0 0 1 0 7|M17.5 14c2.2.4 3.6 2 4 5',
    unread: 'M4 5h11|M4 5v11h5l-5 4V5|M20 10v6H9|c19,5,2.5',
    textsize: 'M4 18l4.5-12h1L14 18|M5.7 14h6.6|M15 18l2.8-7.5h.4L21 18|M16 15.5h4.4',
    spark: 'M12 3c.5 4.5 2.5 6.5 9 9-6.5 2.5-8.5 4.5-9 9-.5-4.5-2.5-6.5-9-9 6.5-2.5 8.5-4.5 9-9z',
    signout: 'M10 4H5v16h5|M14 8l4 4-4 4|M18 12H9',
    dot: 'c12,12,2',
    ticks: '!0 0 20 14|M1.5 7.5l3.5 3.5 7.5-8.5|M9.5 10.5l.5.5 7.5-8.5',
    tick: '!0 0 20 14|M3.5 7.5l3.5 3.5 7.5-8.5',
  };
  const NS = 'http://www.w3.org/2000/svg';
  function icon(name) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', 'tg-i');
    let parts = (ICONS[name] || ICONS.dot).split('|');
    let vb = '0 0 24 24';
    if (parts[0].startsWith('!')) { vb = parts[0].slice(1); parts = parts.slice(1); }
    s.setAttribute('viewBox', vb);
    for (const p of parts) {
      let el;
      if (p.startsWith('c')) {
        const [cx, cy, r] = p.slice(1).split(',');
        el = document.createElementNS(NS, 'circle');
        el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
        if (+r <= 2) { el.setAttribute('fill', 'currentColor'); el.setAttribute('stroke', 'none'); }
      } else { el = document.createElementNS(NS, 'path'); el.setAttribute('d', p); }
      s.append(el);
    }
    return s;
  }
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
  const setStyle = (el, k, v) => { if (el && el.style[k] !== v) el.style[k] = v; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitFor(fn, timeout = 1500, step = 30) {
    const end = Date.now() + timeout;
    for (;;) { let v = null; try { v = fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() > end) return null; await sleep(step); }
  }
  const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  function hash(str) { let x = 5381; for (let i = 0; i < str.length; i++) x = ((x << 5) + x + str.charCodeAt(i)) | 0; return (x >>> 0).toString(36); }
  function snip(t, n = 90) { t = (t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function fmtDay(ts) {
    const d = new Date(ts), now = new Date();
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 864e5);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString([], d.getFullYear() === now.getFullYear() ? { month: 'long', day: 'numeric' } : { month: 'long', day: 'numeric', year: 'numeric' });
  }
  function fmtListDate(ts) {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return fmtTime(ts);
    const days = (new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5;
    if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  function avatar(title, seed, cls = '') {
    const words = (title || '?').replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/).filter(Boolean);
    const letters = ((words[0] || '?')[0] + (words[1] ? words[1][0] : '')).toUpperCase();
    const [a1, a2] = AV[parseInt(hash(String(seed || title)), 36) % AV.length];
    return h('span', { class: 'tg-avatar ' + cls, style: `--av1:${a1};--av2:${a2}`, 'data-l': letters, text: letters });
  }
  function updateAvatar(av, title, seed) {
    const fresh = avatar(title, seed);
    if (av.dataset.l !== fresh.dataset.l || av.style.cssText !== fresh.style.cssText) {
      av.dataset.l = fresh.dataset.l; av.style.cssText = fresh.style.cssText; setText(av, fresh.textContent);
    }
  }
  function botAvatar(cls = '') { return h('span', { class: 'tg-avatar tg-bot ' + cls, 'data-l': '✦' }, icon('spark')); }
  function userPhoto(size) {
    const src = G.photo();
    if (src) return h('img', { class: 'tg-photo', src, alt: '', style: `width:${size}px;height:${size}px` });
    const a = avatar(G.name(), 'me'); a.style.width = a.style.height = size + 'px'; a.style.fontSize = Math.round(size * 0.4) + 'px'; return a;
  }

  /* ---------- clipboard / toast / sound ---------- */
  function copy(text) {
    try { if (typeof GM_setClipboard === 'function') { GM_setClipboard(text, 'text'); return; } } catch (e) { /* fall through */ }
    navigator.clipboard && navigator.clipboard.writeText(text).catch(() => {});
  }
  let toastTimer = 0;
  function toast(msg, ic = 'info') {
    let t = $('#tg-toast');
    if (!t) { t = h('div', { id: 'tg-toast', class: 'tg-ui' }); document.body.append(t); }
    t.replaceChildren(icon(ic), h('span', { text: msg }));
    t.classList.add('tg-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('tg-show'), 2400);
  }
  let audioCtx = null;
  function ding() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      [[880, 0], [1320, 0.09]].forEach(([f, t0]) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + t0); g.gain.exponentialRampToValueAtTime(0.18, now + t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + t0 + 0.25);
        o.connect(g).connect(audioCtx.destination); o.start(now + t0); o.stop(now + t0 + 0.3);
      });
    } catch (e) { /* no audio */ }
  }


  /* =====================================================================
     Discord adapter: everything we read from or click in Discord's own UI
     ===================================================================== */
  function labelOf(b) { return [b.getAttribute('aria-label'), b.getAttribute('title'), (b.textContent || '').trim().slice(0, 60)].filter(Boolean).join(' '); }
  function findBtn(root, re, notInside) {
    if (!root) return null;
    for (const b of $$('button, [role="button"], [role="tab"], a[href]', root)) {
      if (b.closest('.tg-ui') || (notInside && b.closest(notInside))) continue;
      if (re.test(labelOf(b))) return b;
    }
    return null;
  }
  const userArea = () => $('section[aria-label="User status and settings"]') || $('[class*="panels_"]');
  let me = null;
  function meUser() {
    if (me) return me;
    const area = userArea();
    if (!area) return null;
    for (const el of [area, ...$$('*', area)].slice(0, 100)) {
      const u = propOf(el, 'currentUser', 25);
      if (u && u.id) { me = u; break; }
    }
    return me;
  }
  function myId() {
    const u = meUser();
    if (u) return String(u.id);
    const img = $('img[src*="/avatars/"]', userArea() || document.createElement('i'));
    const m = img && img.src.match(/\/avatars\/(\d+)\//);
    return m ? m[1] : null;
  }
  const G = {
    name() { const u = meUser(); return (u && (u.globalName || u.global_name || u.username)) || 'You'; },
    username() { const u = meUser(); return u ? u.username : ''; },
    photo() { const i = $('img[src*="/avatars/"]', userArea() || document.createElement('i')); return i ? i.src.replace(/([?&]size=)\d+/, '$1256') : ''; },
    email() { const u = meUser(); return u && u.email ? u.email : ''; },
    // Discord's router follows history changes; clicking its links from code does a full page load instead
    go(href) {
      if (location.pathname === href) return;
      W.history.pushState(null, '', href);
      W.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    },
    friends() { G.go('/channels/@me'); },
    requests() { G.go('/message-requests'); },
    nitro() { G.go('/store'); },
    shop() { G.go('/shop'); },
    quests() { G.go('/quest-home'); },
    discover() { const b = findBtn($('nav[aria-label="Servers sidebar"]'), /^discover/i); if (b) b.click(); else G.go('/discovery'); },
    newGroup() {
      const b = findBtn(document, /^create dm$|^new (group )?dm|^start a (new )?(group )?dm/i, '.tg-ui');
      if (b) { b.click(); return; }
      G.friends();
      waitFor(() => findBtn(document, /^create dm$|^new (group )?dm/i, '.tg-ui'), 3000, 100).then(x => { if (x) x.click(); else toast('Open Direct Messages to start a group', 'group'); });
    },
    addFriend() {
      G.friends();
      waitFor(() => findBtn($('main') || document, /^add friend$/i, '.tg-ui'), 3000, 100).then(b => { if (b) b.click(); });
    },
    addServer() { const b = findBtn($('nav[aria-label="Servers sidebar"]') || document, /^add a server/i); if (b) b.click(); else toast("Couldn't find Add a Server", 'add'); },
    async settings(re) {
      const gear = findBtn(userArea() || document, /^user settings$/i);
      if (!gear) { toast("Couldn't open Discord's settings", 'settings'); return; }
      gear.click();
      if (!re) return;
      const tab = await waitFor(() => $$('[data-list-item-id^="settings-sidebar"], [role="tab"], [role="link"]').find(t => !t.closest('.tg-ui') && re.test((t.textContent || '').trim())), 3000, 60);
      if (tab) tab.click();
    },
    status() { const b = findBtn(userArea() || document, /^set status|avatar|^user status/i) || $('[class*="avatarWrapper_"]', userArea() || document); if (b) b.click(); },
    inbox() { const b = findBtn(document, /^inbox$/i, '.tg-ui'); if (b) b.click(); },
    help() { window.open('https://support.discord.com/', '_blank', 'noopener'); },
    getApp() { window.open('https://discord.com/download', '_blank', 'noopener'); },
  };

  /* =====================================================================
     Reading Discord's page
     ===================================================================== */
  function route() { const m = location.pathname.match(/^\/channels\/(@me|\d+)(?:\/(\d+))?/); return m ? { guild: m[1], channel: m[2] || null } : { guild: null, channel: null }; }
  const sideList = () => $('[class*="sidebarList_"]');
  // the box at the bottom of the chat (an edit box inside a message is a second one)
  const composerBox = () => $('[class*="channelBottomBarArea_"] [class*="channelTextArea_"]') || $$('form [class*="channelTextArea_"]').pop() || null;
  const editor = () => { const b = composerBox(); return b ? $('[role="textbox"][data-slate-editor="true"]', b) : null; };
  // Discord's message types that are normal messages; everything else (joins, pins, calls…) is a service message
  const NORMAL_TYPES = new Set([0, 19, 20, 23]);
  const msgCache = new WeakMap();
  function msgInfo(li, art) {
    const c = msgCache.get(li);
    if (c && c.id === li.id) return c;
    const m = propOf(art, 'message', 40);
    const t = $('time[datetime]', art);
    const info = {
      id: li.id,
      author: m && m.author ? String(m.author.id) : ((($('img[class*="avatar_"]', art) || {}).src || '').match(/\/avatars\/(\d+)\//) || [])[1] || null,
      ts: (m && m.timestamp && +m.timestamp) || (t ? Date.parse(t.dateTime) : 0) || 0,
      edited: !!(m && m.editedTimestamp) || !!$('[class*="edited_"]', art),
      type: m && typeof m.type === 'number' ? m.type : 0,
      channel: m && m.channel_id ? String(m.channel_id) : null,
    };
    if (m) msgCache.set(li, info);
    return info;
  }
  function getMessages() {
    const ol = $('ol[data-list-id="chat-messages"]');
    if (!ol) return [];
    const mine = myId();
    const list = [];
    let prev = null;
    for (const li of ol.children) {
      if (!li.matches('li[id^="chat-messages-"]')) { if (prev) prev.end = true; prev = null; continue; }
      const art = $('[role="article"]', li);
      if (!art) continue;
      const info = msgInfo(li, art);
      const start = /\bgroupStart_/.test(art.className) || !prev || prev.author !== info.author;
      if (start && prev) prev.end = true;
      const msg = { li, art, ...info, own: !!mine && info.author === mine, start, end: false, sys: !NORMAL_TYPES.has(info.type) };
      list.push(msg);
      prev = msg;
    }
    if (prev) prev.end = true;
    return list;
  }
  function chatInfo() {
    const r = route();
    const art = $('ol[data-list-id="chat-messages"] [role="article"]');
    const ch = (art && propOf(art, 'channel', 40)) || null;
    const head = $('section[aria-label="Channel header"]');
    const title = head ? ($('h1', head) || $('[class*="title_"]', head)) : null;
    return { ...r, ch, type: ch ? ch.type : (r.guild === '@me' ? 1 : 0), name: title ? (title.textContent || '').trim() : document.title.replace(/^\(\d+\)\s*|\s*\|\s*Discord.*$/g, '') };
  }

  let closePopup = null;
  function popup(build, x, y, opts = {}) {
    if (closePopup) closePopup();
    const back = h('div', { class: 'tg-backdrop tg-ui' });
    const wrap = h('div', { class: 'tg-menu-wrap tg-ui' });
    const close = () => {
      back.remove(); wrap.remove(); $$('.tg-menu.tg-sub').forEach(s => s.remove());
      if (closePopup === close) closePopup = null;
      opts.onClose && opts.onClose();
    };
    back.addEventListener('mousedown', e => { e.preventDefault(); close(); });
    back.addEventListener('contextmenu', e => { e.preventDefault(); close(); });
    // While the menu is still growing in, the item under the pointer isn't the one that will end up there:
    // match quick clicks (and clicks on the gaps) to the item at its final position instead.
    const openedAt = performance.now();
    let forwarding = false;
    const itemAt = (cx, cy) => {
      const wr = wrap.getBoundingClientRect();
      for (const b of $$('.tg-mi, .tg-reactbar button', wrap)) {
        let x = 0, y = 0, n = b;
        while (n && n !== wrap) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
        if (cx >= wr.left + x && cx <= wr.left + x + b.offsetWidth && cy >= wr.top + y && cy <= wr.top + y + b.offsetHeight) return b;
      }
      return null;
    };
    wrap.addEventListener('click', e => {
      if (forwarding || e.target.closest('input, .tg-emojigrid')) return;
      const early = performance.now() - openedAt < 300;
      if (!early && e.target.closest('.tg-mi, .tg-reactbar button')) return;
      const b = itemAt(e.clientX, e.clientY);
      if (!b || b === e.target.closest('.tg-mi, .tg-reactbar button')) return;
      e.stopPropagation(); e.preventDefault();
      forwarding = true;
      try { b.click(); } finally { forwarding = false; }
    }, true);
    build(wrap, close);
    document.body.append(back, wrap);
    const r = wrap.getBoundingClientRect();
    let left = opts.alignRight ? x - r.width : x, top = opts.above ? y - r.height : y;
    left = Math.max(8, Math.min(left, innerWidth - r.width - 8));
    top = Math.max(8, Math.min(top, innerHeight - r.height - 8));
    wrap.style.left = left + 'px'; wrap.style.top = top + 'px';
    const ox = opts.alignRight ? 'right' : 'left', oy = opts.above ? 'bottom' : 'top';
    $$('.tg-menu, .tg-reactbar', wrap).forEach(m => m.style.setProperty('--tg-origin', `${oy} ${ox}`));
    closePopup = close;
    return close;
  }
  function menuList(items, close, extraClass = '') {
    const m = h('div', { class: 'tg-menu ' + extraClass });
    let subEl = null, subFor = null, subTimer = 0;
    const closeSub = () => { if (subEl) { subEl.remove(); subEl = null; subFor = null; } };
    const openSub = (btn, it) => {
      if (subFor === btn || !m.isConnected) return; // a hover timer can fire after the menu has closed
      closeSub();
      const list = typeof it.sub === 'function' ? it.sub() : it.sub;
      subEl = menuList(list, close, 'tg-sub');
      subFor = btn;
      subEl.addEventListener('mouseenter', () => clearTimeout(subTimer));
      document.body.append(subEl);
      const br = btn.getBoundingClientRect(), mr = m.getBoundingClientRect(), sr = subEl.getBoundingClientRect();
      let left = mr.right + 6, top = br.top - 6;
      if (left + sr.width > innerWidth - 8) left = mr.left - sr.width - 6;
      top = Math.max(8, Math.min(top, innerHeight - sr.height - 8));
      subEl.style.left = left + 'px'; subEl.style.top = top + 'px';
      $$('.tg-mi', m).forEach(b => b.classList.toggle('tg-hl', b === btn));
    };
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { m.append(h('hr')); continue; }
      if (it.foot) { m.append(h('div', { class: 'tg-menu-foot', text: it.foot })); continue; }
      const lead = it.photo ? it.photo : icon(it.icon || 'dot');
      const btn = h('button', { class: 'tg-mi' + (it.danger ? ' tg-danger' : '') + (it.cls ? ' ' + it.cls : '') }, lead, h('span', { text: it.label }),
        it.sub ? h('span', { class: 'tg-mi-end' }, icon('chevRight')) : (it.end ? h('span', { class: 'tg-mi-end', text: it.end }) : null));
      if (it.sub) {
        btn.addEventListener('mouseenter', () => { clearTimeout(subTimer); subTimer = setTimeout(() => openSub(btn, it), 90); });
        btn.addEventListener('click', e => { e.stopPropagation(); openSub(btn, it); });
      } else {
        btn.addEventListener('mouseenter', () => { clearTimeout(subTimer); subTimer = setTimeout(() => { closeSub(); $$('.tg-mi', m).forEach(b => b.classList.remove('tg-hl')); }, 120); });
        btn.addEventListener('click', e => { e.stopPropagation(); close(); it.run && it.run(); });
      }
      m.append(btn);
    }
    return m;
  }
  let closeModal = null;
  function modal(build) {
    if (closePopup) closePopup();
    const back = h('div', { class: 'tg-modal-back tg-ui' });
    const box = h('div', { class: 'tg-modal' });
    const close = () => { back.remove(); if (closeModal === close) closeModal = null; };
    back.addEventListener('mousedown', e => { if (e.target === back) close(); });
    build(box, close);
    back.append(box);
    document.body.append(back);
    closeModal = close;
    const f = $('input', box); f && setTimeout(() => f.focus(), 30);
    return close;
  }


  /* =====================================================================
     Left column: header, ☰ menu, pencil button, resizing, search
     ===================================================================== */
  let sideQuery = '', sideInput = null, sideTop = null, fab = null;
  function buildSideHead(side) {
    if (!sideTop) {
      const burger = h('button', { class: 'tg-iconbtn tg-burger', title: 'Menu' }, icon('menu'));
      burger.addEventListener('click', e => { if (sideQuery || document.activeElement === sideInput) { clearSideSearch(); return; } openMainMenu(e.currentTarget); });
      sideInput = h('input', { placeholder: 'Search', type: 'text', spellcheck: 'false', autocomplete: 'off' });
      const clearBtn = h('button', { class: 'tg-iconbtn tg-clear-q', title: 'Clear', type: 'button' }, icon('close'));
      clearBtn.addEventListener('mousedown', e => e.preventDefault());
      clearBtn.addEventListener('click', () => { sideInput.value = ''; sideQuery = ''; syncSearch(); sideInput.focus(); });
      sideInput.addEventListener('input', () => { sideQuery = sideInput.value.trim().toLowerCase(); syncSearch(); });
      sideInput.addEventListener('focus', syncSearch);
      sideInput.addEventListener('blur', () => setTimeout(syncSearch, 150));
      sideInput.addEventListener('keydown', e => {
        e.stopPropagation(); // Discord's own shortcuts would grab the keys
        if (e.key === 'Escape') clearSideSearch();
        if (e.key === 'Enter') {
          const first = $$('.tg-side :is(.tg-crow, .tg-chrow)').find(r => !r.classList.contains('tg-filtered') && visible(r));
          const a = first && $('a[href]', first);
          if (a) { a.click(); clearSideSearch(); }
        }
      });
      sideTop = h('div', { id: 'tg-side-top', class: 'tg-ui' }, h('div', { class: 'tg-side-head' }, burger, h('label', { class: 'tg-search' }, icon('search'), sideInput, clearBtn)));
    }
    if (sideTop.parentElement !== side || side.firstElementChild !== sideTop) side.prepend(sideTop);
  }
  function clearSideSearch() { if (!sideInput) return; sideInput.value = ''; sideQuery = ''; sideInput.blur(); syncSearch(); }
  function syncSearch() {
    if (!sideTop) return;
    const active = !!sideQuery || document.activeElement === sideInput;
    const b = $('.tg-burger', sideTop), want = active ? 'back' : 'menu';
    if (b && b.dataset.ic !== want) { b.dataset.ic = want; b.replaceChildren(icon(want)); }
    $('.tg-search', sideTop).classList.toggle('tg-has', !!sideQuery);
    schedule();
  }
  function openMainMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    anchor.classList.add('tg-active');
    const more = () => [
      { icon: 'moon', label: isDay() ? 'Enable Dark Mode' : 'Disable Dark Mode', run: () => G.settings(/^appearance$/i) },
      { icon: 'bolt', label: S.motion ? 'Reduce Animations' : 'Enable Animations', run: () => { setS('motion', !S.motion); toast(S.motion ? 'Animations on' : 'Animations reduced', 'bolt'); } },
      '-',
      { icon: 'gem', label: 'Nitro', run: G.nitro },
      { icon: 'store', label: 'Shop', run: G.shop },
      { icon: 'star', label: 'Quests', run: G.quests },
      { icon: 'globe', label: 'Discover', run: G.discover },
      '-',
      { icon: 'switchG', label: 'Switch to Discord version', run: turnOff },
      { icon: 'help', label: 'Discord Support', run: G.help },
      { icon: 'install', label: 'Install App', run: G.getApp },
      { foot: `Discord · Telegram ${VERSION}` },
    ];
    popup((wrap, close) => wrap.append(menuList([
      { photo: userPhoto(22), label: G.name(), cls: 'tg-acc', run: () => openSettings() },
      { icon: 'unread', label: 'Inbox', run: G.inbox },
      '-',
      { icon: 'person', label: 'Contacts', run: G.friends },
      { icon: 'mail', label: 'Message Requests', run: G.requests },
      { icon: 'group', label: 'New Group', run: G.newGroup },
      '-',
      { icon: 'settings', label: 'Settings', run: () => openSettings() },
      { icon: 'more', label: 'More', sub: more },
    ], close)), r.left, r.bottom + 4, { onClose: () => anchor.classList.remove('tg-active') });
  }
  function buildFab(side) {
    if (!fab) {
      fab = h('button', { id: 'tg-fab', class: 'tg-ui', title: 'New Message' }, icon('edit'));
      fab.addEventListener('click', e => {
        e.stopPropagation();
        const r = fab.getBoundingClientRect();
        fab.classList.add('tg-open'); fab.replaceChildren(icon('close'));
        popup((wrap, close) => wrap.append(menuList([
          { icon: 'group', label: 'New Group', run: G.newGroup },
          { icon: 'person', label: 'Add Friend', run: G.addFriend },
          { icon: 'add', label: 'New Server', run: G.addServer },
        ], close)), r.right, r.top - 8, { alignRight: true, above: true, onClose: () => { fab.classList.remove('tg-open'); fab.replaceChildren(icon('edit')); } });
      });
    }
    if (fab.parentElement !== side) side.append(fab);
    let rz = $('#tg-resizer', side);
    if (!rz) {
      rz = h('div', { id: 'tg-resizer', class: 'tg-ui', title: 'Drag to resize' });
      rz.addEventListener('mousedown', e => {
        e.preventDefault();
        rz.classList.add('tg-drag'); document.body.classList.add('tg-resizing');
        const left = side.getBoundingClientRect().left;
        const move = ev => { S.listWidth = Math.max(280, Math.min(560, ev.clientX - left)); applyVars(); };
        const up = () => { rz.classList.remove('tg-drag'); document.body.classList.remove('tg-resizing'); setS('listWidth', S.listWidth); removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
        addEventListener('mousemove', move); addEventListener('mouseup', up);
      });
      rz.addEventListener('dblclick', () => setS('listWidth', CONFIG.listWidth));
      side.append(rz);
    }
    if (!$('#tg-left', side)) side.append(h('div', { id: 'tg-left', class: 'tg-ui' }));
  }
  function turnOff() {
    gmSet(ON_KEY, false);
    toast('Switching to the Discord version…', 'switchG');
    setTimeout(() => location.reload(), 500);
  }

  const panels = [];
  function panel(title, opts = {}) {
    const host = $('#tg-left');
    if (!host) return null;
    const body = h('div', { class: 'tg-panel-body' });
    const back = h('button', { class: 'tg-iconbtn', title: 'Back' }, icon(opts.close ? 'close' : 'back'));
    const head = h('div', { class: 'tg-panel-head' }, back, h('h2', { text: title }), ...(opts.actions || []).map(a => {
      const b = h('button', { class: 'tg-iconbtn', title: a.title || '' }, icon(a.icon));
      b.addEventListener('click', e => a.run(e.currentTarget, body, head));
      return b;
    }));
    const el = h('section', { class: 'tg-panel' }, head, body);
    host.append(el);
    // while it slides in, clicks must not fall through to the chat list underneath
    host.classList.add('tg-busy');
    const onEnd = e => { if (e.target === el) unbusy(); };
    const unbusy = () => { clearTimeout(host.__busy); host.classList.remove('tg-busy'); el.removeEventListener('transitionend', onEnd); };
    clearTimeout(host.__busy);
    host.__busy = setTimeout(unbusy, 4000); // safety net only: the layer sits under the panel, so it's harmless
    el.addEventListener('transitionend', onEnd);
    const prev = panels[panels.length - 1];
    const p = { el, body, head, title, close: () => closePanel(p), refresh: opts.refresh };
    panels.push(p);
    void el.offsetWidth; // commit the off-screen start so the slide animates, without waiting for a frame
    el.classList.add('tg-open');
    if (prev) prev.el.classList.add('tg-under');
    back.addEventListener('click', () => p.close());
    return p;
  }
  function closePanel(p) {
    const i = panels.indexOf(p);
    if (i < 0) return;
    panels.splice(i, 1);
    p.el.classList.remove('tg-open');
    const host = $('#tg-left');
    if (host && !panels.length) { clearTimeout(host.__busy); host.classList.remove('tg-busy'); }
    const prev = panels[panels.length - 1];
    if (prev) { prev.el.classList.remove('tg-under'); prev.refresh && prev.refresh(); }
    setTimeout(() => p.el.remove(), 320);
  }
  function closeAllPanels() { while (panels.length) closePanel(panels[panels.length - 1]); }
  function row(o) {
    const ic = o.icon ? h('span', { class: 'tg-ri' + (o.color ? '' : ' tg-plain'), style: o.color ? `--c:${o.color}` : null }, icon(o.icon)) : (o.lead || null);
    const sw = o.toggle != null ? h('span', { class: 'tg-switch' + (o.toggle ? ' tg-on' : '') }) : null;
    const r = h('div', { class: 'tg-row' + (o.danger ? ' tg-danger' : '') + (o.accent ? ' tg-accent' : '') + (o.run || sw ? '' : ' tg-static') + (o.cls ? ' ' + o.cls : '') },
      o.radio != null ? h('span', { class: 'tg-radio' + (o.radio ? ' tg-on' : '') }) : null,
      ic,
      h('div', { class: 'tg-rt' }, h('div', { class: 'tg-rl', text: o.label }), o.sub ? h('div', { class: 'tg-rs', text: o.sub }) : null),
      o.value != null ? h('span', { class: 'tg-rv', text: o.value }) : null,
      sw);
    if (o.key) r.dataset.key = o.key;
    r.dataset.label = (o.label + ' ' + (o.sub || '')).toLowerCase();
    if (o.run || sw) r.addEventListener('click', () => {
      if (sw) { const on = !sw.classList.contains('tg-on'); sw.classList.toggle('tg-on', on); o.run && o.run(on); } else o.run();
    });
    return r;
  }
  const card = (...rows) => h('div', { class: 'tg-card' }, ...rows.flat().filter(Boolean));
  const cardTitle = t => h('div', { class: 'tg-card-title', text: t });
  const caption = t => h('div', { class: 'tg-caption', text: t });

  const COLORS = { red: '#fe5c5b', green: '#5ec35b', blue: '#3c9df9', gray: '#8e97a1', slate: '#7d8ea3', pink: '#f6467b', purple: '#9a68ef', orange: '#f99c2a', cyan: '#30b8d4', teal: '#3fb495' };
  function openSettings() {
    if (closePopup) closePopup();
    closeAllPanels();
    const p = panel('Settings', { actions: [{ icon: 'more', title: 'More', run: btn => {
      const r = btn.getBoundingClientRect();
      popup((wrap, close) => wrap.append(menuList([
        { icon: 'user', label: 'Set a Status', run: G.status },
        { icon: 'switchG', label: 'Switch to Discord version', run: turnOff },
      ], close)), r.right, r.bottom + 4, { alignRight: true });
    } }] });
    if (!p) return;
    const go = re => () => { closeAllPanels(); G.settings(re); };
    p.refresh = () => p.body.replaceChildren(
      h('div', { class: 'tg-prof' }, userPhoto(120), h('div', { class: 'tg-prof-name', text: G.name() }), h('div', { class: 'tg-prof-status', text: 'online' })),
      card(
        G.email() ? row({ icon: 'mail', label: G.email(), sub: 'Email', run: go(/^(my )?account( info)?$/i) }) : null,
        G.username() ? row({ icon: 'user', label: '@' + G.username(), sub: 'Username', run: go(/^profiles?$/i) }) : null),
      card(
        row({ icon: 'bell', color: COLORS.red, label: 'Notifications and Sounds', run: go(/^notifications$/i) }),
        row({ icon: 'key', color: COLORS.slate, label: 'Privacy and Security', run: go(/privacy/i) }),
        row({ icon: 'settings', color: COLORS.gray, label: 'General Settings', run: openGeneralSettings }),
        row({ icon: 'palette', color: COLORS.cyan, label: 'Appearance', run: go(/^appearance$/i) }),
        row({ icon: 'speaker', color: COLORS.green, label: 'Voice and Video', run: go(/^voice/i) }),
        row({ icon: 'keyboard', color: COLORS.orange, label: 'Keybinds', run: go(/^keybinds$/i) }),
        row({ icon: 'globe', color: COLORS.purple, label: 'Language', run: go(/^language$/i) }),
        row({ icon: 'data', color: COLORS.teal, label: 'Devices', run: go(/^devices$/i) })),
      card(
        row({ icon: 'gem', color: 'linear-gradient(135deg,#6b93ff,#976fff 50%,#e46ace)', label: 'Discord Nitro', run: () => { closeAllPanels(); G.nitro(); } }),
        row({ icon: 'gift', color: COLORS.pink, label: 'Gift Inventory', run: go(/^gift inventory$/i) })),
      card(
        row({ icon: 'feedback', color: COLORS.orange, label: 'Discord Support', run: G.help }),
        row({ icon: 'install', color: COLORS.green, label: 'Download the App', run: G.getApp })),
      h('div', { class: 'tg-version', text: `Discord · Telegram ${VERSION} (${isDay() ? 'Day' : 'Night'})` }));
    p.refresh();
  }
  function openGeneralSettings() {
    const p = panel('General Settings');
    if (!p) return;
    const sizeVal = h('span', { text: S.textSize });
    const size = h('input', { type: 'range', min: '12', max: '20', step: '1', value: String(S.textSize) });
    size.addEventListener('input', () => { setText(sizeVal, size.value); setS('textSize', +size.value); });
    const wallVal = h('span', { text: Math.round(S.wall * 100) + '%' });
    const wall = h('input', { type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(S.wall * 100)) });
    wall.addEventListener('input', () => { setText(wallVal, wall.value + '%'); setS('wall', +wall.value / 100); });
    const colors = h('div', { class: 'tg-colors' }, ACCENTS.map(c => {
      const b = h('button', { class: S.accent === c ? 'tg-on' : '', style: `--c:${c}`, title: c });
      b.addEventListener('click', () => { setS('accent', c); $$('button', colors).forEach(x => x.classList.toggle('tg-on', x === b)); });
      return b;
    }));
    p.body.append(
      card(cardTitle('Settings'),
        h('div', { class: 'tg-range-head' }, h('div', { text: 'Message Text Size' }), sizeVal), h('div', { class: 'tg-range' }, size),
        h('div', { class: 'tg-range-head' }, h('div', { text: 'Wallpaper Pattern' }), wallVal), h('div', { class: 'tg-range' }, wall)),
      card(cardTitle('Accent Color'), colors),
      card(cardTitle('Night Mode'), row({ icon: 'moon', label: 'Day, Night or System', sub: "Uses Discord's own theme setting", run: () => { closeAllPanels(); G.settings(/^appearance$/i); } })),
      card(cardTitle('Chats'),
        row({ icon: 'chat', label: 'Names in Private Chats', sub: 'Telegram only shows them in groups', toggle: S.names, run: on => setS('names', on) }),
        row({ icon: 'eye', label: 'Keep the Chat List Open', toggle: S.keepList, run: on => setS('keepList', on) }),
        row({ icon: 'palette', label: 'Allow Other Themes', sub: 'BetterDiscord-style themes like SoftX', toggle: S.otherThemes, run: on => setS('otherThemes', on) }),
        row({ icon: 'bolt', label: 'Animations', toggle: S.motion, run: on => setS('motion', on) })),
      caption('Text size, wallpaper and colours change this theme only. Night Mode follows Discord.'));
  }

  /* =====================================================================
     Other themes and the collapsed chat list
     ===================================================================== */
  const offThemes = new Set();
  function syncOtherThemes() {
    const want = !S.otherThemes && !disposed;
    for (const st of $$('style')) {
      if (st === styleEl || offThemes.has(st)) continue;
      if (/^\s*\/\*\*[\s\S]{0,300}?@name\s/.test((st.textContent || '').slice(0, 400))) offThemes.add(st);
    }
    for (const st of offThemes) {
      if (!st.isConnected) { offThemes.delete(st); continue; }
      if (want && st.media !== 'not all') { st.dataset.tgMedia = st.media || ''; st.media = 'not all'; }
      if (!want && st.media === 'not all' && 'tgMedia' in st.dataset) { st.media = st.dataset.tgMedia; delete st.dataset.tgMedia; }
    }
  }
  let listWidthBefore = null;
  function keepListOpen(side) {
    if (!side) return;
    const w = side.style.getPropertyValue('width');
    if (S.keepList && w && parseFloat(w) < 100) { listWidthBefore = { el: side, w, prio: side.style.getPropertyPriority('width') }; side.style.removeProperty('width'); }
  }

  /* =====================================================================
     Chat list rows
     ===================================================================== */
  function decorateSide() {
    const side = sideList();
    if (!side) return;
    keepListOpen(side);
    side.classList.add('tg-side');
    const rail = $('nav[aria-label="Servers sidebar"]');
    if (rail) rail.classList.add('tg-rail');
    buildSideHead(side);
    buildFab(side);
    // Friends, Message Requests, Nitro, Shop and Quests live in the ☰ menu
    for (const a of $$('[class*="privateChannels_"] a[href]', side)) {
      const href = a.getAttribute('href') || '';
      if (/^\/channels\/@me\/\d/.test(href)) continue;
      if (href === '/channels/@me' || /^\/(store|shop|quest|message-requests|discovery|library)/.test(href)) (a.closest('li') || a).classList.add('tg-hide');
    }
    for (const a of $$('a[data-list-item-id^="private-channels-uid_"][href^="/channels/@me/"]', side)) safe('dmrow', () => decorateDmRow(a));
    for (const a of $$('a[data-list-item-id^="channels___"]', side)) safe('chrow', () => {
      const li = a.closest('li');
      if (!li) return;
      li.classList.add('tg-chrow');
      const name = (a.getAttribute('aria-label') || a.textContent || '').replace(/\s*\([^)]*\)\s*$/, '').toLowerCase();
      li.classList.toggle('tg-filtered', !!sideQuery && !name.includes(sideQuery));
    });
  }
  function decorateDmRow(a) {
    const li = a.closest('li') || a.parentElement;
    const hit = a.closest('[class*="interactive_"]') || a.parentElement;
    li.classList.add('tg-crow'); hit.classList.add('tg-crow-hit'); a.classList.add('tg-crow-a');
    const ch = propOf(a, 'channel', 20);
    const ts = ch ? snowMs(ch.lastMessageId || ch.last_message_id) : 0;
    let dt = $(':scope > .tg-row-date', hit);
    if (!dt) { dt = h('span', { class: 'tg-row-date tg-ui' }); hit.append(dt); }
    const d = ts ? fmtListDate(ts) : '';
    if (dt.dataset.v !== d) { dt.dataset.v = d; setText(dt, d); }
    const name = (a.getAttribute('aria-label') || a.textContent || '').split(/\s*\(/)[0].toLowerCase();
    li.classList.toggle('tg-filtered', !!sideQuery && !name.includes(sideQuery));
  }

  /* =====================================================================
     Chat header: Discord's bar with a Telegram avatar and status line
     ===================================================================== */
  function presenceText(head, info) {
    const typing = $('form [class*="typing_"]');
    const tt = typing ? (typing.textContent || '').trim() : '';
    if (tt && /typing/i.test(tt)) return { text: info.type === 1 ? 'typing' : tt.replace(/[.…]+$/, ''), typing: true };
    if (info.type === 1) {
      const a = $$('[role="img"][aria-label]', head).map(x => x.getAttribute('aria-label')).find(l => /,\s*\w/.test(l || ''));
      const st = a ? a.split(',').pop().trim() : '';
      return { text: /online|idle|do not disturb|streaming/i.test(st) ? 'online' : 'last seen recently' };
    }
    if (info.type === 3) { const n = info.ch && info.ch.recipients ? info.ch.recipients.length + 1 : 0; return { text: n ? plural(n, 'member', 'members') : 'group' }; }
    const topic = $('[class*="topic_"]', head);
    const tp = topic ? (topic.textContent || '').trim() : '';
    if (tp) return { text: tp };
    const nav = $('nav[aria-label$="(server)"]');
    return { text: nav ? nav.getAttribute('aria-label').replace(/\s*\(server\)$/, '') : '' };
  }
  function decorateHeader(info) {
    const head = $('section[aria-label="Channel header"]');
    $$('.tg-chead').forEach(x => { if (x !== head) { x.classList.remove('tg-chead'); $$('.tg-h-av, .tg-h-status', x).forEach(e => e.remove()); } });
    if (!head || !info.channel) return;
    head.classList.add('tg-chead');
    const kids = $('[class*="children_"]', head);
    if (!kids) return;
    const titleBox = $('[class*="titleWrapper_"]', kids) || $('h1', kids);
    let av = $(':scope > .tg-h-av', kids);
    const src = info.type === 1 || info.type === 3 ? (($('[class*="avatar_"] img, img[class*="avatar"]', kids) || {}).src || '') : '';
    const avKind = (src || 'gen:' + info.name + info.channel);
    if (!av || av.dataset.kind !== avKind) {
      if (av) av.remove();
      av = src ? h('img', { class: 'tg-h-av tg-ui', src: src.replace(/([?&]size=)\d+/, '$1128'), alt: '' }) : avatar(info.name.replace(/^[#@]/, ''), info.channel, 'tg-h-av tg-ui');
      av.dataset.kind = avKind;
      kids.prepend(av);
    }
    if (!titleBox) return;
    let st = $('.tg-h-status', titleBox);
    if (!st) { st = h('span', { class: 'tg-h-status tg-ui' }); titleBox.append(st); }
    const p = presenceText(head, info);
    setText(st, p.text);
    st.classList.toggle('tg-typing', !!p.typing); st.classList.toggle('tg-dots', !!p.typing);
  }

  /* =====================================================================
     Messages: bubbles, times, ticks
     ===================================================================== */
  let MSGS = [];
  const NAME_COLORS = ['#ff8e86', '#ffb36b', '#cc98ff', '#6fd47e', '#5fd1d9', '#76c1ff', '#ff86c6'];
  function decorate(msg, solo) {
    const { li, art } = msg;
    li.classList.add('tg-msg');
    li.classList.toggle('tg-u', msg.own && !msg.sys);
    li.classList.toggle('tg-m', !msg.own && !msg.sys);
    li.classList.toggle('tg-sys', msg.sys);
    li.classList.toggle('tg-start', msg.start);
    li.classList.toggle('tg-end', msg.end);
    art.classList.add('tg-bubble');
    if (msg.sys) { $$('.tg-meta', art).forEach(m => m.remove()); return; }
    if (!msg.own && msg.author && !solo) art.style.setProperty('--tg-name', NAME_COLORS[parseInt(hash(msg.author), 36) % NAME_COLORS.length]);
    let meta = $('.tg-meta', art);
    if (!meta) meta = h('span', { class: 'tg-meta' }, h('span', { class: 'tg-meta-in' }, h('b'), h('i')));
    const content = $('[id^="message-content-"]', art);
    const host = content && (content.textContent || '').trim() && !$(':scope > :is(pre, blockquote, ul, ol, h1, h2, h3)', content) && !$('[id^="message-accessories-"] > *', art) ? content : null;
    meta.classList.toggle('tg-block', !host);
    const target = host || art;
    if (meta.parentElement !== target || target.lastChild !== meta) target.append(meta);
    $$('.tg-meta', art).forEach(m => { if (m !== meta) m.remove(); });
    const tstr = msg.ts ? (msg.edited ? 'edited ' : '') + fmtTime(msg.ts) : '';
    if (meta.dataset.time !== tstr) { meta.dataset.time = tstr; meta.firstChild.dataset.time = tstr; }
    meta.classList.toggle('tg-read', msg.own && !!msg.answered);
    meta.style.display = tstr ? '' : 'none';
    fitTime(meta, art);
  }
  // Chrome sizes Gemini's prompt bubble a few px too small for the time at the end of a one-line message,
  // so it wraps; widen the bubble just enough, like Telegram keeps short messages on one line
  function fitTime(meta, bubble) {
    if (!bubble) return;
    const sig = meta.dataset.time + '|' + meta.className + '|' + (meta.parentElement && meta.parentElement.textContent.length) + '|' + innerWidth;
    if (bubble.dataset.tgFit === sig) return;
    bubble.dataset.tgFit = sig;
    bubble.style.minWidth = '';
    if (meta.classList.contains('tg-block') || meta.style.display === 'none' || !meta.parentElement) return;
    const r = document.createRange();
    r.setStart(meta.parentElement, 0); r.setEndBefore(meta);
    const rects = [...r.getClientRects()].filter(x => x.width > 0);
    if (!rects.length) return;
    const top = Math.min(...rects.map(x => x.top)), bottom = Math.max(...rects.map(x => x.top));
    const mr = meta.getBoundingClientRect();
    if (mr.top <= bottom + 4 || bottom - top > 4) return;
    const br = bubble.getBoundingClientRect();
    const need = Math.max(...rects.map(x => x.right)) - br.left + parseFloat(getComputedStyle(meta).marginLeft) + mr.width + 7 + parseFloat(getComputedStyle(bubble).paddingRight);
    bubble.style.minWidth = Math.ceil(need) + 'px';
  }


  /* =====================================================================
     Message box: Telegram's box and round send button
     ===================================================================== */
  let sendBtn = null;
  function sendNow() {
    const ed = editor();
    if (!ed || !(ed.textContent || '').trim()) return;
    const own = findBtn($('form') || document, /^send message$/i);
    if (own) { own.click(); return; }
    ed.focus();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      const ev = new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'keyCode', { get: () => 13 });
      Object.defineProperty(ev, 'which', { get: () => 13 });
      ed.dispatchEvent(ev);
    }
  }
  function decorateComposer() {
    const box = composerBox();
    $$('.tg-cbox').forEach(b => { if (b !== box) b.classList.remove('tg-cbox'); });
    if (!box) return;
    box.classList.add('tg-cbox');
    if (!sendBtn) {
      sendBtn = h('button', { id: 'tg-send', class: 'tg-ui', type: 'button', title: 'Send Message' });
      sendBtn.addEventListener('mousedown', e => e.preventDefault());
      sendBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); sendNow(); });
    }
    if (sendBtn.parentElement !== box) box.append(sendBtn);
    const ed = editor();
    sendBtn.classList.toggle('tg-empty', !ed || !(ed.textContent || '').trim());
  }

  /* =====================================================================
     Main loop
     ===================================================================== */
  let scanTimer = 0, lastScan = 0;
  function schedule() {
    if (scanTimer || disposed) return;
    const wait = Math.max(0, 160 - (Date.now() - lastScan));
    scanTimer = setTimeout(() => { scanTimer = 0; scan(); }, wait);
  }
  const warned = {};
  function safe(name, fn) {
    try { return fn(); } catch (e) { if (!warned[name]) { warned[name] = 1; console.warn('[Discord·Telegram] ' + name + ':', e); } return undefined; }
  }
  // the boxes between the chat and the page paint Discord's background: clear them so the wallpaper shows
  function clearChain() {
    const chat = $('main[class*="chatContent_"]') || ($('ol[data-list-id="chat-messages"]') || {}).parentElement;
    if (!chat) return;
    const paints = e => { const bg = getComputedStyle(e).backgroundColor; return !!bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'; };
    for (let e = chat; e && e !== document.body; e = e.parentElement) {
      // Discord's full-window backdrop (".bg_…") sits next to the app layers, not around them
      for (const sib of (e.parentElement ? e.parentElement.children : [])) if (sib !== e && /(^|\s)bg_/.test(sib.className) && !sib.classList.contains('tg-clear') && paints(sib)) sib.classList.add('tg-clear');
      if (e.classList.contains('tg-clear') || e.classList.contains('tg-side')) continue;
      if (paints(e)) e.classList.add('tg-clear');
    }
    for (const e of $$('[class*="chat_"] > [class*="content_"], [class*="messagesWrapper_"], [class*="chatContent_"] > *')) {
      if (e.classList.contains('tg-clear') || e.closest('.tg-ui')) continue;
      const bg = getComputedStyle(e).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && !e.matches('form')) e.classList.add('tg-clear');
    }
  }
  function scan() {
    if (disposed) return;
    lastScan = Date.now();
    if (!document.body) return;
    document.body.classList.add('tg-on');
    applyVars();
    safe('themes', syncOtherThemes);
    safe('side', decorateSide);
    const info = safe('info', chatInfo) || {};
    const solo = info.type === 1 && !S.names;
    document.body.classList.toggle('tg-solo', solo);
    MSGS = safe('read', getMessages) || [];
    document.body.classList.toggle('tg-chat', !!$('ol[data-list-id="chat-messages"]'));
    safe('clear', clearChain);
    MSGS.forEach((m, i) => { m.answered = MSGS.slice(i + 1).some(n => !n.own && !n.sys); });
    for (const m of MSGS) safe('message', () => decorate(m, solo));
    safe('header', () => decorateHeader(info));
    safe('composer', decorateComposer);
  }

  /* ---------- global listeners ---------- */
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && e.isTrusted) {
      if ($$('[role="dialog"]').some(d => !d.closest('.tg-ui') && visible(d))) return; // Discord's own dialog closes first
      if (closePopup) { closePopup(); e.stopPropagation(); return; }
      if (closeModal) { closeModal(); e.stopPropagation(); return; }
      if (panels.length) { closePanel(panels[panels.length - 1]); e.stopPropagation(); }
    }
  }, LC);
  document.addEventListener('input', e => { if (e.target.closest && e.target.closest('form [role="textbox"]')) schedule(); }, LC);
  window.addEventListener('resize', schedule, L);

  let mainObserver = null, mainTimer = 0;
  function start() {
    if (disposed) return;
    mainObserver = new MutationObserver(muts => {
      for (const m of muts) {
        const t = m.target;
        if (t && t.nodeType === 1 && (t.closest('.tg-ui') || t.id === 'tg-toast')) continue;
        schedule(); return;
      }
    });
    mainObserver.observe(document.documentElement, { childList: true, subtree: true });
    mainTimer = setInterval(schedule, 1500);
    scan();
  }
  // Remove everything this copy added, so a newer copy (or plain Discord) can take over the page.
  function dispose() {
    if (disposed) return;
    disposed = true;
    life.abort();
    try { styleKeeper.disconnect(); } catch (e) { /* ignore */ }
    if (mainObserver) mainObserver.disconnect();
    clearInterval(mainTimer); clearTimeout(scanTimer); clearTimeout(saveTimer);
    try { if (closePopup) closePopup(); if (closeModal) closeModal(); } catch (e) { /* ignore */ }
    try { syncOtherThemes(); } catch (e) { /* ignore */ }
    if (listWidthBefore && listWidthBefore.el.isConnected && !listWidthBefore.el.style.getPropertyValue('width')) listWidthBefore.el.style.setProperty('width', listWidthBefore.w, listWidthBefore.prio);
    $$('#tg-side-top, #tg-fab, #tg-resizer, #tg-left, #tg-toast, #tg-send, .tg-menu.tg-sub, .tg-row-date, .tg-meta, .tg-h-av, .tg-h-status').forEach(e => e.remove());
    const marks = ['tg-side', 'tg-rail', 'tg-crow', 'tg-crow-hit', 'tg-crow-a', 'tg-chrow', 'tg-filtered', 'tg-hide', 'tg-chead', 'tg-msg', 'tg-u', 'tg-m', 'tg-sys', 'tg-start', 'tg-end', 'tg-bubble', 'tg-cbox', 'tg-clear'];
    $$(marks.map(m => '.' + m).join(',')).forEach(e => e.classList.remove(...marks));
    $$('[data-tg-fit]').forEach(b => { b.style.minWidth = ''; delete b.dataset.tgFit; });
    $$('.tg-bubble, [style*="--tg-name"]').forEach(b => b.style.removeProperty('--tg-name'));
    if (styleEl) styleEl.remove();
    const f = document.getElementById('tg-font'); if (f) f.remove();
    for (const v of ['--tg-primary', '--tg-msg', '--tg-list-w', '--tg-wall-opacity', '--tg-pin-mask']) document.documentElement.style.removeProperty(v);
    if (document.body) document.body.classList.remove('tg-on', 'tg-day', 'tg-still', 'tg-resizing', 'tg-chat', 'tg-solo');
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, L);
})();
