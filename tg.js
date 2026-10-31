// ==UserScript==
// @name         Gemini · Telegram
// @namespace    gemini-telegram-violet
// @version      3.0.2
// @description  Makes Gemini look and work like Telegram Web (Night): Telegram chat list with avatars, last messages and real dates, the ☰ menu and Settings, a solid chat header with "typing…", bubbles with real send times, Telegram's message box, right-click menus with reactions, reply, forward, pin, select and delete, chat info panel, in-chat search and more.
// @author       Patrick
// @match        https://gemini.google.com/*
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
    accent:      '#8774e1', // Telegram Night violet: sent bubbles, buttons, selected chat
    wall1:       '#5d34b0', // doodle wallpaper gradient: violet
    wall2:       '#9a2f86', // magenta
    wall3:       '#2f3a9e', // indigo
    wall4:       '#c2477f', // sunset pink
    wallOpacity: 0.45,      // doodle strength, 0.1 to 1
    listWidth:   360,       // chat list width in px (you can also drag its edge)

    doubleClickReaction: '❤️',  // double-click a message to react; '' turns it off
    fetchPreviews: true,         // load each chat's last message for the chat list
    notify: true,                // notification when an answer finishes while the tab is in the background
    translateTo: (navigator.language || 'en').split('-')[0], // language for "Translate"
  };
  /* ========================================================================= */

  const VERSION = '3.0.2';
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
    GM_registerMenuCommand(enabled ? 'Switch to Gemini version' : 'Switch to Telegram version', () => { gmSet(ON_KEY, !enabled); location.reload(); });
  }
  if (!enabled) return;

  // A newer copy loaded into the same page (an update being tried out) retires this one:
  // everything below listens with `L`/`LC`, so one abort() removes it all.
  const life = new AbortController();
  const L = { signal: life.signal }, LC = { capture: true, signal: life.signal };
  let disposed = false;
  try { W.dispatchEvent(new CustomEvent('tg-takeover')); } catch (e) { /* ignore */ }
  W.addEventListener('tg-takeover', () => dispose(), L);

  /* ---------- storage ---------- */
  const STORE = 'tg_gemini_data_v1';
  function load() {
    try {
      const v = hasGM ? GM_getValue(STORE, null) : localStorage.getItem(STORE);
      const d = typeof v === 'string' ? JSON.parse(v) : v;
      if (d && d.c) return d;
    } catch (e) { /* ignore */ }
    return { c: {} };
  }
  const DB = load();
  for (const k of ['c', 'prev', 'ts', 'chats', 'set', 'unread']) DB[k] = DB[k] || {};
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
    accent: CONFIG.accent, textSize: 16, listWidth: CONFIG.listWidth, wall: CONFIG.wallOpacity,
    notify: CONFIG.notify, sound: true, titleCount: true, motion: true,
    previews: CONFIG.fetchPreviews, geminiButtons: false, quick: CONFIG.doubleClickReaction,
  }, DB.set);
  function setS(k, v) { S[k] = v; DB.set[k] = v; save(); applyVars(); }
  function applyVars() {
    const r = document.documentElement;
    if (!r) return;
    r.style.setProperty('--tg-primary', S.accent);
    r.style.setProperty('--tg-msg', S.textSize + 'px');
    r.style.setProperty('--tg-list-w', Math.round(S.listWidth) + 'px');
    r.style.setProperty('--tg-wall-opacity', String(S.wall));
    if (document.body) {
      document.body.classList.toggle('tg-still', !S.motion);
      document.body.classList.toggle('tg-hide-gemini-actions', !S.geminiButtons);
      const b = document.body.classList;
      b.toggle('tg-day', b.contains('light-theme') && !b.contains('dark-theme'));
    }
  }
  applyVars();

  /* ---------- Gemini's own data: real times and chat dates (read from its network replies) ---------- */
  let origFetch = null;
  function parseBx(text) {
    const out = [];
    for (const ln of String(text).replace(/^\)\]\}'\s*/, '').split('\n')) {
      const s = ln.trim();
      if (!s.startsWith('[[')) continue;
      try {
        for (const e of JSON.parse(s)) if (e && e[0] === 'wrb.fr' && e[2]) out.push({ rpc: e[1], data: JSON.parse(e[2]) });
      } catch (e) { /* partial chunk */ }
    }
    return out;
  }
  const deep = (o, path) => path.reduce((a, k) => (a == null ? a : a[k]), o);
  const tsMs = ts => (Array.isArray(ts) && typeof ts[0] === 'number') ? ts[0] * 1000 + Math.round((ts[1] || 0) / 1e6) : 0;
  function cleanMd(t) {
    return String(t || '')
      .replace(/```[\s\S]*?```/g, ' [code] ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '🖼 Photo ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/googleusercontent\.com\/\S+/g, '🖼 Photo')
      .replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*+]\s+/gm, '').replace(/^\s*>\s?/gm, '')
      .replace(/(\*\*|__|\*|_|`|~~)/g, '').replace(/\$\$?([^$]+)\$\$?/g, '$1')
      .replace(/\s+/g, ' ').trim();
  }
  function readTurns(d) {
    const turns = d && d[0];
    if (!Array.isArray(turns) || !turns.length) return;
    let changed = false, cid = null, newest = null;
    for (const t of turns) {
      if (!Array.isArray(t) || !Array.isArray(t[0])) continue;
      const rid = t[0][1], ms = tsMs(t[4]);
      if (typeof rid !== 'string' || !ms) continue;
      const k = rid.replace(/^r_/, '');
      if (DB.ts[k] !== ms) { DB.ts[k] = ms; changed = true; }
      if (!cid && typeof t[0][0] === 'string') cid = t[0][0].replace(/^c_/, '');
      if (!newest || ms > newest.ms) newest = { ms, t };
    }
    if (cid && newest) {
      const p = DB.prev[cid];
      if (!p || !p.ts || newest.ms >= p.ts) {
        const resp = deep(newest.t, [3, 0, 0, 1, 0]), ask = deep(newest.t, [2, 0, 0]);
        const isResp = typeof resp === 'string' && resp.trim();
        const text = cleanMd(isResp ? resp : (typeof ask === 'string' ? ask : ''));
        if (text && (!p || p.t !== snip(text, 90) || p.ts !== newest.ms)) { DB.prev[cid] = { t: snip(text, 90), r: isResp ? 'm' : 'u', ts: newest.ms }; changed = true; }
      }
      const c = DB.chats[cid] || (DB.chats[cid] = {});
      if (!c.ts || newest.ms > c.ts) { c.ts = newest.ms; changed = true; }
    }
    if (changed) { pruneTs(); save(); try { schedule(); } catch (e) { /* not ready yet */ } }
  }
  function readChats(d) {
    const list = d && d[2];
    if (!Array.isArray(list)) return;
    let changed = false;
    for (const c of list) {
      if (!Array.isArray(c) || typeof c[0] !== 'string') continue;
      const id = c[0].replace(/^c_/, ''), rec = DB.chats[id] || (DB.chats[id] = {}), ms = tsMs(c[5]);
      if (ms && rec.ts !== ms && (!rec.ts || ms > rec.ts)) { rec.ts = ms; changed = true; }
      if (typeof c[1] === 'string' && rec.t !== c[1]) { rec.t = c[1]; changed = true; }
    }
    if (changed) { save(); try { schedule(); } catch (e) { /* not ready yet */ } }
  }
  function pruneTs() {
    const keys = Object.keys(DB.ts);
    if (keys.length < 8000) return;
    keys.sort((a, b) => DB.ts[a] - DB.ts[b]).slice(0, 2000).forEach(k => delete DB.ts[k]);
  }
  function onRpcText(text) {
    if (disposed) return;
    for (const e of parseBx(text)) {
      try {
        if (e.rpc === 'hNvQHb') readTurns(e.data);
        else if (e.rpc === 'MaZiqc') readChats(e.data);
      } catch (err) { /* unknown shape */ }
    }
  }
  const RPC_RE = /rpcids=[^&]*(hNvQHb|MaZiqc)/;
  // The hooks are installed once per page and hand replies to whichever copy is current.
  W.__tgOnRpc = onRpcText;
  const toCurrent = text => { const fn = W.__tgOnRpc; if (typeof fn === 'function') fn(text); };
  (function hookNetwork() {
    try {
      const f = W.fetch;
      origFetch = (f && f.__tgOrig) || f;
      if (f && !f.__tgHook) {
        const wrapped = function (input) {
          const p = f.apply(W, arguments);
          try {
            const url = typeof input === 'string' ? input : (input && input.url) || String(input);
            if (url.indexOf('batchexecute') > -1 && RPC_RE.test(url)) p.then(r => r.clone().text()).then(toCurrent).catch(() => {});
          } catch (e) { /* ignore */ }
          return p;
        };
        wrapped.__tgHook = 1;
        wrapped.__tgOrig = f;
        W.fetch = wrapped;
      }
      const XP = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
      if (XP && !XP.__tgHook) {
        const open = XP.open, send = XP.send;
        XP.open = function (m, u) { try { this.__tgu = String(u); } catch (e) { /* ignore */ } return open.apply(this, arguments); };
        XP.send = function () {
          try { if (this.__tgu && this.__tgu.indexOf('batchexecute') > -1 && RPC_RE.test(this.__tgu)) this.addEventListener('load', () => { try { toCurrent(this.responseText); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }
          return send.apply(this, arguments);
        };
        XP.__tgHook = 1;
      }
    } catch (e) { /* page blocks it: times fall back to live capture */ }
  })();

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

/* ---------- 1. Gemini's colour tokens -> Telegram Night ---------- */
body.tg-on {
  --gem-sys-color--surface: #000 !important;
  --gem-sys-color--surface-dim: #000 !important;
  --gem-sys-color--surface-bright: var(--tg-surface) !important;
  --gem-sys-color--surface-container-lowest: #0b0b0b !important;
  --gem-sys-color--surface-container-low: var(--tg-bg) !important;
  --gem-sys-color--surface-container: var(--tg-surface) !important;
  --gem-sys-color--surface-container-high: var(--tg-hover) !important;
  --gem-sys-color--surface-container-highest: #363636 !important;
  --gem-sys-color--surface-variant: #2f2f2f !important;
  --gem-sys-color--on-surface: var(--tg-text) !important;
  --gem-sys-color--on-surface-variant: var(--tg-text-2) !important;
  --gem-sys-color--on-surface-low: #8a8a8a !important;
  --gem-sys-color--outline: #5f5f5f !important;
  --gem-sys-color--outline-variant: #2f2f2f !important;
  --gem-sys-color--outline-low: #2f2f2f !important;
  --gem-sys-color--primary: var(--tg-link) !important;
  --gem-sys-color--on-primary: #fff !important;
  --gem-sys-color--primary-container: var(--tg-primary) !important;
  --gem-sys-color--on-primary-container: #fff !important;
  --gem-sys-color--secondary: var(--tg-link) !important;
  --gem-sys-color--secondary-container: var(--tg-p25) !important;
  --gem-sys-color--on-secondary-container: #fff !important;
  --gem-sys-color--inverse-primary: var(--tg-primary) !important;
  --gem-sys-color--brand-blue: var(--tg-primary) !important;
  --gem-sys-color--brand-floaty-blue: var(--tg-primary) !important;
  --gem-sys-color--blue-primary: var(--tg-primary) !important;
  --lumi-sys-color--surface: #000 !important;
  --lumi-sys-color--surface-dim: var(--tg-hover) !important;
  --lumi-sys-color--surface-bright: var(--tg-surface) !important;
  --lumi-sys-color--on-surface: var(--tg-text) !important;
  --lumi-sys-color--on-surface-variant: var(--tg-text-2) !important;
  --lumi-sys-color-acc-color--accent: var(--tg-primary) !important;
  --lumi-sys-color-acc-color--accent-container: var(--tg-primary) !important;
  --lumi-sys-color--code-background: rgba(0, 0, 0, .28) !important;
  --gm3-sys-color-primary: var(--tg-link) !important;
  --gm3-sys-color-surface: var(--tg-surface) !important;
  --gm3-sys-color-background: #000 !important;
  --mat-app-background-color: #000 !important;
  --mat-app-text-color: var(--tg-text) !important;
  --mat-sys-primary: var(--tg-link) !important;
  --mat-sys-surface: var(--tg-surface) !important;
  --mat-sys-surface-container: var(--tg-surface) !important;
  --bard-color-sidenav-background-desktop: var(--tg-surface) !important;
  --bard-color-sidenav-background-mobile: var(--tg-surface) !important;
  --bard-color-synthetic--chat-window-surface: transparent !important;
  --bard-color-response-container-flipped-background: var(--tg-surface) !important;
  --top-gradient-color: transparent !important;
  --bottom-gradient-color: transparent !important;
  background: #000 !important;
  color: var(--tg-text);
}

/* ---------- 1b. Telegram Day (when Gemini is set to Light) ---------- */
body.tg-on.tg-day {
  --tg-surface: #ffffff;
  --tg-bg: #f4f4f5;
  --tg-hover: #f1f1f2;
  --tg-border: #dadce0;
  --tg-text: #000000;
  --tg-text-2: #707579;
  --tg-link: color-mix(in srgb, var(--tg-primary) 88%, #000);
  --tg-menu-bg: rgba(255, 255, 255, .86);
  --tg-menu-shadow: 0 .25rem .5rem .125rem rgba(0, 0, 0, .14);
  --tg-out: color-mix(in srgb, var(--tg-primary) 16%, #fff);
  --tg-out-text: #000000;
  --tg-out-meta: var(--tg-primary);
  --tg-in: #ffffff;
  --tg-in-meta: #9aa1a8;
  --tg-chip: rgba(70, 50, 120, .38);
  --tg-input: #f1f1f2;
  --gem-sys-color--surface: var(--tg-bg) !important;
  --gem-sys-color--surface-dim: var(--tg-bg) !important;
  --gem-sys-color--surface-container-lowest: #fff !important;
  --gem-sys-color--surface-container-highest: #e6e6e8 !important;
  --gem-sys-color--surface-variant: #ececee !important;
  --gem-sys-color--on-surface-low: #8a8f94 !important;
  --gem-sys-color--outline: #b8bcc0 !important;
  --gem-sys-color--outline-variant: #e1e3e6 !important;
  --gem-sys-color--outline-low: #e1e3e6 !important;
  --gem-sys-color--on-secondary-container: #000 !important;
  --lumi-sys-color--surface: var(--tg-bg) !important;
  --lumi-sys-color--code-background: rgba(0, 0, 0, .05) !important;
  --gm3-sys-color-background: var(--tg-bg) !important;
  --mat-app-background-color: var(--tg-bg) !important;
  background: linear-gradient(135deg, #d9d0f5 0%, #ecd5ee 35%, #d5dbf6 70%, #f2d6e4 100%) fixed !important;
}
body.tg-on.tg-day::before { background: #3a2470 !important; opacity: calc(var(--tg-wall-opacity) * .3) !important; }
body.tg-on.tg-day .tg-iconbtn:hover, body.tg-on.tg-day .tg-mi:hover, body.tg-on.tg-day .tg-mi.tg-hl,
body.tg-on.tg-day .cdk-overlay-pane .mat-mdc-menu-item:hover, body.tg-on.tg-day .cdk-overlay-popover gem-menu-item-content:hover { background: rgba(0, 0, 0, .06) !important; }
body.tg-on.tg-day .tg-menu hr { background: rgba(0, 0, 0, .08); }
body.tg-on.tg-day user-query :is(.query-text, .query-text-line, .horizontal-container) { color: #000 !important; }
body.tg-on.tg-day user-query a { color: var(--tg-link) !important; }
body.tg-on.tg-day user-query .tg-react { background: var(--tg-p25); color: var(--tg-link); }
body.tg-on.tg-day .tg-quote { background: var(--tg-p08); color: var(--tg-link); }
body.tg-on.tg-day * { scrollbar-color: rgba(0, 0, 0, .2) transparent; }
body.tg-on.tg-day ::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, .2); }
body.tg-on.tg-day .tg-switch, body.tg-on.tg-day .tg-switch::after { border-color: #c4c9cc; }
body.tg-on.tg-day .tg-switch { background: #c4c9cc; }
body.tg-on.tg-day .tg-switch.tg-on { background: var(--tg-primary); }
body.tg-on.tg-day .tg-switch::after { background: #fff; }
body.tg-on.tg-day .tg-switch.tg-on::after { border-color: var(--tg-primary); }
body.tg-on.tg-day .tg-kbd { background: #e9e9eb; }
body.tg-on.tg-day #tg-header, body.tg-on.tg-day #tg-bottombar, body.tg-on.tg-day input-area-v2 .text-input-field,
body.tg-on.tg-day input-area-v2 .input-buttons-wrapper-bottom, body.tg-on.tg-day #tg-down { box-shadow: 0 1px 2px rgba(0, 0, 0, .12) !important; }
body.tg-on.tg-day :is(user-query .user-query-bubble-with-background, model-response .response-container-content) { box-shadow: 0 1px 2px rgba(0, 0, 0, .15) !important; }

/* ---------- 2. Telegram's font everywhere (icons, code and maths keep theirs) ---------- */
body.tg-on { font-family: var(--tg-font) !important; }
body.tg-on :is(div, p, a, li, button, input, textarea, label, h1, h2, h3, h4, h5, h6, td, th, blockquote, summary, [class*="gds-"], .mdc-button__label, .mat-mdc-menu-item-text, .gem-menu-item-label, .label, .sublabel, .title-text)
  :not(mat-icon, .mat-icon, [class*="symbols"], [class*="icon"], [class^="x"], code, pre, .katex, .katex *, [class*="code"] *) {
  font-family: var(--tg-font) !important;
  font-variation-settings: normal !important;
  letter-spacing: normal !important;
}
body.tg-on:has(bard-sidenav:hover) .mat-mdc-tooltip-panel { display: none !important; }

/* ---------- 3. Wallpaper ---------- */
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
body.tg-on :is(chat-app, main.chat-app, bard-sidenav-container, bard-sidenav-content, .mat-drawer-content, chat-window, .chat-container, input-container, .lm-canvas-styling, .content-wrapper, .main-content, .content-container) {
  background: transparent !important;
}
body.tg-on chat-app { position: relative; z-index: 1; }
body.tg-on.tg-page bard-sidenav-content { background: var(--tg-bg) !important; }
body.tg-on :is(.lm-glow, chat-loading-animation, .blur-bg, .input-gradient::before, .autosuggest-scrim) { display: none !important; }
body.tg-on input-container.input-gradient { background: none !important; }
body.tg-on input-container::before, body.tg-on input-container::after { display: none !important; }

/* ---------- 4. Gemini chrome we replace ---------- */
body.tg-on top-bar-actions { opacity: 0 !important; pointer-events: none !important; }
body.tg-on .side-nav-menu-button { visibility: hidden !important; pointer-events: none !important; }
body.tg-on .main-content > .content-container { padding-top: var(--tg-head) !important; box-sizing: border-box !important; }
body.tg-on bard-sidenav-content { margin-right: var(--tg-right-w) !important; transition: margin-right .3s var(--tg-ease); }
body.tg-on :is(hallucination-disclaimer, .hallucination-disclaimer, condensed-tos-disclaimer, back-to-bottom-fab, .human-review-disclosure-container) { display: none !important; }
body.tg-ghost .cdk-overlay-pane:has(.mat-mdc-menu-panel),
body.tg-ghost .cdk-overlay-backdrop,
body.tg-ghost .cdk-overlay-popover { opacity: 0 !important; transition: none !important; pointer-events: none !important; }

/* ---------- 5. Left column = Telegram chat list ---------- */
body.tg-on bard-sidenav:has(.sidenav-with-history-container.expanded) {
  width: var(--tg-list-w) !important; min-width: var(--tg-list-w) !important; max-width: var(--tg-list-w) !important;
}
body.tg-on bard-sidenav {
  background: var(--tg-surface) !important; border-right: 1px solid var(--tg-border) !important; box-shadow: none !important; overflow: hidden !important;
}
body.tg-on bard-sidenav :is(side-navigation-content, .sidenav-with-history-container) { width: 100% !important; background: transparent !important; }
body.tg-on .sidenav-header-buttons {
  position: absolute !important; inset: 0 0 auto 0 !important; width: auto !important; height: 56px !important;
  padding: 0 12px 0 8px !important; margin: 0 !important; display: flex !important; align-items: center !important;
  background: var(--tg-surface) !important; z-index: 4 !important; box-sizing: border-box !important;
}
body.tg-on .sidenav-header-buttons > :not(.tg-side-head) { display: none !important; }
body.tg-on bard-sidenav .overflow-container { padding-top: 56px !important; box-sizing: border-box !important; }
body.tg-on bard-sidenav :is(.top-action-list, .top-action-list-scrollable, .top-action-list-pinned, .section-divider,
  .top-gradient-container, .bottom-gradient-container, .hovered-trailing-content, .desktop-controls, .loading-content-spinner-container),
body.tg-on bard-sidenav expandable-section:not([data-test-id="chats-expandable-section"]),
body.tg-on bard-sidenav [data-test-id="chats-expandable-section"] > .expandable-section-header-row { display: none !important; }
body.tg-on bard-sidenav infinite-scroller { padding: 0 8px 96px !important; box-sizing: border-box !important; scrollbar-gutter: auto; }
body.tg-on bard-sidenav :is(.chat-history, .chat-history-list, conversations-list, conversations-list mat-nav-list, .expandable-section-content, .expandable-section-content-inner) {
  padding: 0 !important; margin: 0 !important; width: auto !important;
}
body.tg-on gem-nav-list-item[data-test-id="conversation"] { display: block !important; margin: 0 !important; padding: 0 !important; height: 72px !important; }
body.tg-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item {
  display: flex !important; align-items: center !important; position: relative !important; box-sizing: border-box !important;
  width: 100% !important; height: 72px !important; min-height: 72px !important; margin: 0 !important; padding: 0 12px 0 9px !important;
  border-radius: 12px !important; background: transparent !important; color: var(--tg-text) !important; overflow: hidden !important;
  --mat-list-list-item-one-line-container-height: 72px; --mat-list-list-item-hover-state-layer-opacity: 0; --mat-list-list-item-focus-state-layer-opacity: 0;
  transition: background-color .15s ease;
}
body.tg-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item::before,
body.tg-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item::after,
body.tg-on gem-nav-list-item[data-test-id="conversation"] .mat-focus-indicator,
body.tg-on gem-nav-list-item[data-test-id="conversation"] .mdc-list-item__start,
body.tg-on gem-nav-list-item[data-test-id="conversation"] .mdc-list-item__end { display: none !important; }
body.tg-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item:is(:hover, .tg-row-ctx) { background: var(--tg-hover) !important; }
body.tg-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item.tg-row-on,
body.tg-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item.tg-row-on:is(:hover, .tg-row-ctx) { background: var(--tg-primary) !important; }
body.tg-on gem-nav-list-item[data-test-id="conversation"] .mdc-list-item__content {
  flex: 1 1 auto !important; min-width: 0 !important; height: auto !important; align-self: center !important;
  display: flex !important; flex-direction: column !important; justify-content: center !important; padding: 0 !important; margin: 0 !important;
}
body.tg-on gem-nav-list-item[data-test-id="conversation"] .mdc-list-item__primary-text {
  display: block !important; height: auto !important; margin: 0 !important; padding: 0 64px 0 0 !important; line-height: 22px !important;
}
body.tg-on gem-nav-list-item[data-test-id="conversation"] .mdc-list-item__primary-text::before,
body.tg-on gem-nav-list-item[data-test-id="conversation"] .mdc-list-item__primary-text::after { display: none !important; }
body.tg-on gem-nav-list-item[data-test-id="conversation"] :is(.title-text, .label-and-badge, .mdc-list-item__primary-text) {
  font-size: 16px !important; font-weight: 500 !important; line-height: 22px !important; color: var(--tg-text) !important;
  white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; display: block !important;
}
body.tg-on gem-nav-list-item[data-test-id="conversation"] input { color: var(--tg-text) !important; font-size: 16px !important; }
.tg-row-av { width: 54px !important; height: 54px !important; font-size: 21px !important; margin-right: 10px !important; }
.tg-row-sub { display: flex; align-items: center; gap: 6px; height: 20px; margin-top: 2px; padding-right: 2px; }
.tg-row-preview { flex: 1; min-width: 0; font-size: 15px; line-height: 20px; color: var(--tg-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tg-row-preview b { color: var(--tg-text); font-weight: 400; }
.tg-row-preview.tg-typing { color: var(--tg-link); }
.tg-row-date { position: absolute; top: 14px; right: 12px; display: flex; align-items: center; gap: 2px; font-size: 12px; line-height: 16px; color: var(--tg-text-2); }
.tg-row-date svg { width: 18px; height: 13px; color: var(--tg-primary); }
.tg-row-badge { flex: none; min-width: 22px; height: 22px; padding: 0 7px; border-radius: 11px; box-sizing: border-box; background: var(--tg-primary); color: #fff; font-size: 14px; font-weight: 500; line-height: 22px; text-align: center; }
.tg-row-pin { flex: none; width: 20px; height: 20px; color: var(--tg-text-2); }
a.tg-row-on :is(.tg-row-preview, .tg-row-preview b, .tg-row-date, .tg-row-date svg, .tg-row-pin, .title-text, .mdc-list-item__primary-text) { color: #fff !important; }
a.tg-row-on .tg-row-badge { background: #fff; color: var(--tg-primary); }
.tg-filtered, body.tg-on gem-nav-list-item[data-test-id="conversation"].tg-filtered { display: none !important; }

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
bard-sidenav:hover #tg-fab, #tg-fab.tg-open { transform: none; }
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

/* ---------- 9. Messages ---------- */
body.tg-on infinite-scroller.chat-history { padding-top: 8px !important; }
body.tg-on .conversation-container {
  max-width: var(--tg-col) !important; width: 100% !important; margin: 0 auto !important; padding: 0 16px 6px !important; box-sizing: border-box !important;
  gap: 6px !important; position: relative;
}
body.tg-on .conversation-container:last-of-type { padding-bottom: 12px !important; }
body.tg-on user-query { max-width: 100% !important; width: 100% !important; margin: 0 !important; padding: 0 !important; }
body.tg-on user-query :is(.user-query-container, user-query-content) { max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
body.tg-on user-query div.user-query-container { align-items: flex-end !important; margin-left: auto !important; }
body.tg-on user-query .query-content { width: fit-content !important; max-width: min(560px, 85%) !important; margin: 0 0 0 auto !important; padding: 0 !important; }
body.tg-on user-query .query-bubble-with-status { width: fit-content !important; max-width: 100% !important; margin: 0 !important; }
body.tg-on user-query .user-query-bubble-with-background {
  position: relative !important; display: block !important; width: fit-content !important; max-width: 100% !important; box-sizing: border-box !important;
  background: var(--tg-out) !important; color: var(--tg-out-text) !important;
  border-radius: 15px 15px 0 15px !important; padding: 6px 9px 7px 11px !important; margin: 0 9px 0 0 !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .3) !important;
}
body.tg-on user-query .user-query-bubble-with-background::after {
  content: ""; position: absolute; right: -8.4px; bottom: 0; width: 11px; height: 20px; background: var(--tg-out);
  -webkit-mask: ${TAIL} no-repeat; mask: ${TAIL} no-repeat; transform: scaleX(-1);
}
body.tg-on user-query :is(.query-text, .query-text-line, .horizontal-container) {
  color: var(--tg-out-text) !important; font-size: var(--tg-msg) !important; line-height: 1.3125 !important; padding: 0 !important; margin: 0 !important;
}
body.tg-on user-query .query-text-line { min-height: 0 !important; }
body.tg-on user-query .query-text { flex: 1 1 auto !important; min-width: 0 !important; }
body.tg-on user-query a { color: #fff !important; text-decoration: underline; }
/* a photo album with a caption, like Telegram */
body.tg-on user-query div.user-query-container:has(user-query-file-preview) {
  position: relative; width: min(400px, 85%) !important; max-width: min(400px, 85%) !important; margin-right: 9px !important; padding: 3px !important; gap: 0 !important;
  background: var(--tg-out); border-radius: 15px 15px 0 15px; box-shadow: 0 1px 2px rgba(0, 0, 0, .3); align-items: stretch !important;
}
body.tg-on user-query div.user-query-container:has(user-query-file-preview)::after {
  content: ""; position: absolute; right: -8.4px; bottom: 0; width: 11px; height: 20px; background: var(--tg-out);
  -webkit-mask: ${TAIL} no-repeat; mask: ${TAIL} no-repeat; transform: scaleX(-1);
}
body.tg-on user-query div.user-query-container:has(user-query-file-preview) .user-query-bubble-with-background {
  background: transparent !important; box-shadow: none !important; margin: 0 !important; padding: 4px 8px 4px !important;
}
body.tg-on user-query div.user-query-container:has(user-query-file-preview) .user-query-bubble-with-background::after { display: none; }
body.tg-on user-query div.user-query-container:has(user-query-file-preview) :is(.query-content, .query-bubble-with-status, .user-query-bubble-with-background) { width: 100% !important; max-width: 100% !important; margin: 0 !important; }
body.tg-on user-query .file-preview-container { margin: 0 !important; padding: 0 !important; width: 100% !important; }
body.tg-on user-query user-query-file-carousel { display: block !important; width: 100% !important; height: auto !important; margin: 0 !important; padding: 0 !important; }
body.tg-on user-query user-query-file-carousel .scrollable-area {
  display: grid !important; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)) !important; gap: 2px !important;
  width: 100% !important; height: auto !important; overflow: visible !important; margin: 0 !important; padding: 0 !important;
}
body.tg-on user-query user-query-file-carousel .scrollable-area > div { width: auto !important; height: auto !important; min-width: 0; margin: 0 !important; }
body.tg-on.tg-on user-query user-query-file-carousel :is(.file-preview-container, .preview-image-button):is(div, button):not(#tg-x) {
  display: block !important; width: 100% !important; max-width: 100% !important; height: 100% !important; padding: 0 !important; margin: 0 !important; border-radius: 0 !important;
}
body.tg-on.tg-on user-query user-query-file-carousel img.preview-image:not(#tg-x) {
  display: block !important; width: 100% !important; max-width: 100% !important; height: auto !important; aspect-ratio: 1; max-height: none !important; object-fit: cover !important; border-radius: 4px !important;
}
body.tg-on.tg-on user-query user-query-file-carousel .scrollable-area > div:only-child img.preview-image:not(#tg-x) { aspect-ratio: auto; max-height: 360px !important; }
body.tg-on.tg-on user-query user-query-file-carousel .scrollable-area > div:only-child :is(.file-preview-container, .preview-image-button):is(div, button):not(#tg-x),
body.tg-on.tg-on user-query user-query-file-carousel .scrollable-area > div:only-child { height: auto !important; max-height: none !important; }
body.tg-on.tg-on user-query user-query-file-carousel .scrollable-area > div:first-child img.preview-image:not(#tg-x) { border-top-left-radius: 12px !important; }
body.tg-on.tg-on user-query user-query-file-carousel .scrollable-area > div:is(:nth-child(2), :only-child) img.preview-image:not(#tg-x) { border-top-right-radius: 12px !important; }
/* a single photo: the bubble hugs the picture, like Telegram */
body.tg-on user-query div.user-query-container:has(user-query-file-preview):not(:has(.scrollable-area > div:nth-child(2))) { width: fit-content !important; max-width: min(360px, 85%) !important; }
body.tg-on user-query div.user-query-container:has(user-query-file-preview):not(:has(.scrollable-area > div:nth-child(2))) .scrollable-area { grid-template-columns: 1fr !important; }
body.tg-on user-query :is(.luminous-actions-container, .query-action-buttons, .luminous-toggle-container) { display: none !important; }
body.tg-on user-query :is(.luminous-collapsed, .luminous-collapsed .query-text, .luminous-collapsed .horizontal-container, .query-text.collapsed) {
  max-height: none !important; -webkit-line-clamp: unset !important; overflow: visible !important; -webkit-mask-image: none !important; mask-image: none !important;
}
body.tg-on.tg-show-gem-actions user-query .luminous-actions-container { display: flex !important; }

/* Gemini's reply = incoming bubble */
body.tg-on model-response, body.tg-on model-response :is(response-container, .response-container, .presented-response-container) {
  max-width: 100% !important; margin: 0 !important; padding: 0 !important; background: transparent !important;
}
body.tg-on model-response .presented-response-container { justify-content: flex-start !important; }
body.tg-on model-response .response-container-content {
  position: relative !important; width: fit-content !important; max-width: calc(100% - 9px) !important; min-width: 64px; box-sizing: border-box !important; flex: 0 1 auto !important;
  margin: 0 0 0 9px !important; padding: 6px 11px 7px 11px !important; border-radius: 15px 15px 15px 0 !important;
  background: var(--tg-in) !important; color: var(--tg-text) !important; box-shadow: 0 1px 2px rgba(0, 0, 0, .3) !important;
}
body.tg-on model-response .response-container-content::before {
  content: ""; position: absolute; left: -8.4px; bottom: 0; width: 11px; height: 20px; background: var(--tg-in);
  -webkit-mask: ${TAIL} no-repeat; mask: ${TAIL} no-repeat;
}
body.tg-on model-response :is(.response-content, model-response-content, structured-content-container, structured-content-container > .container, message-content, .markdown) {
  max-width: none !important; width: auto !important; margin: 0 !important; padding: 0 !important; background: transparent !important;
}
body.tg-on model-response message-content { display: block !important; }
body.tg-on model-response .markdown > * { max-width: none !important; margin-inline: 0 !important; }
body.tg-on model-response .markdown { font-size: var(--tg-msg) !important; line-height: 1.3125 !important; color: var(--tg-text) !important; }
body.tg-on model-response .markdown :is(p, li) { font-size: var(--tg-msg) !important; line-height: 1.3125 !important; }
body.tg-on model-response .markdown > :first-child { margin-top: 0 !important; }
body.tg-on model-response .markdown > :last-child { margin-bottom: 0 !important; }
body.tg-on model-response .markdown p { margin: 0 0 8px !important; }
body.tg-on model-response .markdown :is(h1, h2, h3, h4) { margin: 12px 0 6px !important; line-height: 1.3 !important; font-weight: 500 !important; }
body.tg-on model-response .markdown h1 { font-size: 1.3em !important; }
body.tg-on model-response .markdown h2 { font-size: 1.2em !important; }
body.tg-on model-response .markdown h3 { font-size: 1.1em !important; }
body.tg-on model-response .markdown :is(ul, ol) { margin: 0 0 8px !important; padding-left: 22px !important; }
body.tg-on model-response .markdown li { margin: 2px 0 !important; }
body.tg-on model-response .markdown hr { border-color: rgba(255, 255, 255, .1) !important; margin: 10px 0 !important; }
body.tg-on model-response .markdown a, body.tg-on message-content a { color: var(--tg-link) !important; text-decoration: none !important; }
body.tg-on model-response .markdown a:hover { text-decoration: underline !important; }
body.tg-on model-response .markdown blockquote {
  margin: 4px 0 8px !important; padding: 3px 10px 4px 10px !important; border: 0 !important; border-left: 3px solid var(--tg-primary) !important;
  border-radius: 4px !important; background: var(--tg-p15) !important;
}
body.tg-on model-response :is(code-block, .code-block) {
  display: block; margin: 6px 0 8px !important; border-radius: 6px !important; overflow: hidden; border-left: 3px solid var(--tg-primary) !important;
  background: var(--tg-p08) !important;
}
body.tg-on model-response .code-block-decoration { background: transparent !important; color: var(--tg-link) !important; font-weight: 500 !important; padding: 6px 10px 0 !important; }
body.tg-on model-response :is(code-block pre, .code-block pre) { background: transparent !important; margin: 0 !important; }
body.tg-on model-response :not(pre) > code { background: rgba(0, 0, 0, .25) !important; border-radius: 4px !important; padding: 1px 4px !important; color: var(--tg-link) !important; }
body.tg-on model-response table { border-collapse: collapse !important; }
body.tg-on model-response :is(th, td) { border-color: rgba(255, 255, 255, .1) !important; }
body.tg-on model-response th { background: rgba(255, 255, 255, .06) !important; }
body.tg-on model-response :is(.table-block, table-block) { border-radius: 8px !important; border-color: rgba(255, 255, 255, .1) !important; }
body.tg-on model-response :is(.response-container-footer, message-actions, .actions-container-v2) { margin: 0 !important; }
body.tg-on.tg-hide-gemini-actions model-response :is(.response-container-footer, message-actions, .actions-container-v2, bard-avatar, .avatar-gutter) { display: none !important; }
body.tg-on model-response :is(model-thoughts, .thoughts-container) { margin: 0 0 6px !important; }
body.tg-on model-response model-thoughts :is(button, .thoughts-header-button) {
  border-radius: 8px !important; background: var(--tg-p15) !important; color: var(--tg-link) !important; padding: 2px 8px !important; font-size: 14px !important;
}
body.tg-on model-response :is(sources-list, .sources-list) { margin-top: 0 !important; }
body.tg-on model-response :is(sources-list, .sources-list):has(a, button, img) { margin-top: 6px !important; }
body.tg-on model-response :is(election-info-disclaimer, finance-info-disclaimer):empty { display: none !important; }
body.tg-on :is(.source-inline-chip, .inline-source-chip, source-inline-chip, .attachment-container .chip) {
  background: var(--tg-p15) !important; color: var(--tg-link) !important; border-radius: 6px !important;
}
body.tg-on model-response .response-container-header { margin: 0 0 4px 9px !important; }

/* time, ticks and reactions inside bubbles */
/* Telegram's trick: an invisible copy of the time reserves room at the end of the last line,
   the visible time sits in the bubble's bottom-right corner */
.tg-meta {
  display: inline-block; position: static; visibility: hidden; height: 12px; margin-left: 10px; vertical-align: -1px;
  font-size: 12px; line-height: 12px; white-space: nowrap; user-select: none; pointer-events: none; font-style: normal; font-weight: 400;
}
.tg-meta::before { content: attr(data-time); }
user-query .tg-meta { padding-right: 17px; }
.tg-meta.tg-pinned { padding-left: 14px; }
.tg-meta.tg-block { display: block; height: 8px; margin: 0; }
.tg-meta-in {
  visibility: visible; position: absolute; right: 9px; bottom: 5px; display: inline-flex; align-items: center; gap: 2px; height: 16px;
  font-size: 12px; line-height: 16px; white-space: nowrap; color: var(--tg-in-meta); pointer-events: none;
}
.tg-meta-in::before { content: attr(data-time); }
user-query .tg-meta-in { color: var(--tg-out-meta); right: 7px; }
.tg-meta-in i { display: none; width: 19px; height: 14px; margin-right: -3px; background: currentColor; }
user-query .tg-meta-in i { display: inline-block; -webkit-mask: ${M_CHECK1} center/contain no-repeat; mask: ${M_CHECK1} center/contain no-repeat; }
user-query .tg-meta.tg-read .tg-meta-in i { -webkit-mask-image: ${M_CHECK2}; mask-image: ${M_CHECK2}; }
.tg-meta-in b { display: none; width: 12px; height: 12px; margin-right: 2px; background: currentColor; -webkit-mask: var(--tg-pin-mask) center/contain no-repeat; mask: var(--tg-pin-mask) center/contain no-repeat; }
.tg-meta.tg-pinned .tg-meta-in b { display: inline-block; }
body.tg-on :is(user-query .query-text, user-query .query-text-line, user-query .horizontal-container, model-response .markdown, model-response .markdown > p,
  model-response .response-content, model-response model-response-content, model-response structured-content-container, model-response structured-content-container > .container, model-response message-content) { position: static !important; }
.tg-reacts { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 2px; clear: both; }
.tg-react {
  display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 9px 0 6px; border-radius: 15px; border: 0; cursor: pointer;
  font-size: 18px; line-height: 1; color: var(--tg-link); background: var(--tg-p25); transition: transform .15s;
}
user-query .tg-react { background: rgba(255, 255, 255, .22); color: #fff; }
.tg-react:hover { transform: scale(1.04); }
.tg-react b { font-size: 14px; font-weight: 500; font-family: var(--tg-font); }
.tg-react.tg-pop { animation: tg-pop .35s ease; }
@keyframes tg-pop { 0% { transform: scale(.4) } 60% { transform: scale(1.15) } 100% { transform: scale(1) } }
.tg-row-active, .tg-flash, .tg-selected { background: var(--tg-p25); box-shadow: 0 0 0 100vmax var(--tg-p25); clip-path: inset(-3px -100vmax); }
.tg-flash { animation: tg-flash 1.6s ease forwards; }
@keyframes tg-flash { 0%, 40% { background: var(--tg-p40); box-shadow: 0 0 0 100vmax var(--tg-p40); } 100% { background: transparent; box-shadow: 0 0 0 100vmax transparent; } }
.tg-found :is(.user-query-bubble-with-background, .response-container-content) { outline: 2px solid var(--tg-link); outline-offset: 2px; }
body.tg-selecting :is(user-query, model-response) { cursor: pointer; position: relative; }
body.tg-selecting :is(user-query, model-response)::before {
  content: ""; position: absolute; left: -36px; bottom: 6px; width: 22px; height: 22px; box-sizing: border-box; border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, .7); background: rgba(0, 0, 0, .15); z-index: 2;
}
body.tg-selecting .tg-selected::before {
  background: var(--tg-primary) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12l5 5 9-10'/%3E%3C/svg%3E") center/14px no-repeat !important;
  border-color: var(--tg-primary) !important;
}
body.tg-selecting :is(model-response, user-query) * { pointer-events: none; }
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

/* ---------- 10. Empty chat = bot info card + inline buttons ---------- */
body.tg-on .modular-zero-state-container { justify-content: center !important; align-items: center !important; padding: 16px !important; box-sizing: border-box !important; }
body.tg-on modular-zero-state .top-section-container { height: auto !important; min-height: 0 !important; flex: none !important; padding: 0 !important; margin: 0 !important; width: 100% !important; }
body.tg-on modular-zero-state .modular-zero-state-container > div:not(.top-section-container, .scroll-container, .blur-bg) { display: none !important; }
body.tg-on modular-zero-state :is(.scroll-container, .bottom-section-container) { flex: none !important; height: auto !important; overflow: visible !important; padding: 0 !important; margin: 0 !important; width: 100% !important; }
body.tg-on modular-zero-state :is(zero-state-block-picker, .zero-state-block-container) { width: 100% !important; max-width: 100% !important; padding: 0 !important; margin: 0 !important; display: flex !important; justify-content: center !important; }
body.tg-on assistant-messages-primary { display: block; width: 340px !important; max-width: calc(100vw - 32px); }
body.tg-on assistant-messages-primary :is(.assistant-messages-primary-container, .content-container, .lm-mobile-sparkle-and-text, .content-wrapper) {
  width: 100% !important; max-width: 100% !important; padding: 0 !important; margin: 0 !important; display: block !important; text-align: left !important;
}
body.tg-on assistant-messages-primary h1 {
  position: relative; box-sizing: border-box; width: 100% !important; margin: 0 !important; padding: 10px 14px 12px !important;
  background: var(--tg-surface) !important; border-radius: 15px !important; box-shadow: 0 1px 2px rgba(0, 0, 0, .3);
  font-size: 15px !important; line-height: 1.4 !important; font-weight: 400 !important; color: var(--tg-text) !important; text-align: left !important;
}
body.tg-on assistant-messages-primary h1::before { content: "What can this bot do?"; display: block; margin-bottom: 4px; font-weight: 500; font-size: 15px; }
body.tg-on assistant-messages-primary h1 .message-text { color: var(--tg-text) !important; -webkit-text-fill-color: currentColor !important; background: none !important; font-size: 15px !important; font-weight: 400 !important; }
body.tg-on suggestion-block { display: block; width: 340px !important; max-width: calc(100vw - 32px); margin: 4px auto 0 !important; }
body.tg-on suggestion-block .suggestion-block-container { display: flex !important; flex-direction: column !important; gap: 4px !important; padding: 0 !important; margin: 0 !important; width: 100% !important; align-items: stretch !important; }
body.tg-on suggestion { display: block !important; width: 100% !important; margin: 0 !important; }
body.tg-on suggestion .suggestion-container { width: 100% !important; margin: 0 !important; position: relative; }
body.tg-on suggestion .card-button {
  width: 100% !important; min-height: 40px !important; height: auto !important; padding: 8px 12px !important; justify-content: center !important;
  border: 0 !important; border-radius: 8px !important; color: #fff !important; background: var(--tg-chip) !important;
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); box-shadow: none !important; transition: background-color .15s !important;
}
body.tg-on suggestion .card-button:hover { background: color-mix(in srgb, var(--tg-chip) 70%, #fff 8%) !important; }
body.tg-on suggestion .card-text { color: #fff !important; font-size: 14px !important; font-weight: 500 !important; text-align: center !important; white-space: normal !important; }
body.tg-on suggestion :is(.suggestion-icon, .dismiss-suggestion-button) { display: none !important; }

/* temporary chat = Telegram secret chat */
body.tg-on zero-state-v2 { display: flex !important; align-items: center !important; justify-content: center !important; min-height: 100% !important; }
body.tg-on zero-state-v2 > div { display: flex !important; align-items: center !important; justify-content: center !important; height: auto !important; transform: none !important; position: static !important; margin: 0 !important; }
body.tg-on .temporary-chat-card-container { margin: 0 auto !important; padding: 0 !important; width: auto !important; position: static !important; }
body.tg-on .temporary-chat-card {
  max-width: 320px; margin: 0 auto; padding: 16px 20px 18px !important; gap: 8px !important; border-radius: 16px; box-sizing: border-box;
  display: flex !important; flex-direction: column !important; align-items: center !important; text-align: center !important;
  background: var(--tg-chip) !important; -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); color: #fff !important;
  animation: none !important; opacity: 1 !important; transform: none !important;
}
body.tg-on .temporary-chat-card gem-icon { width: 48px !important; height: 48px !important; background: #fff; -webkit-mask: var(--tg-lock-mask) center/48px no-repeat; mask: var(--tg-lock-mask) center/48px no-repeat; }
body.tg-on .temporary-chat-card gem-icon mat-icon { opacity: 0 !important; }
body.tg-on .temporary-chat-card .gds-display-m { font-size: 0 !important; line-height: 0 !important; margin: 0 !important; }
body.tg-on .temporary-chat-card .gds-display-m::before { content: "You started a temporary chat"; font-size: 16px; line-height: 22px; font-weight: 500; }
body.tg-on .temporary-chat-card .description { font-size: 14px !important; line-height: 19px !important; color: rgba(255, 255, 255, .85) !important; margin: 0 !important; }
body.tg-on .temporary-chat-card .description a { color: #fff !important; text-decoration: underline !important; }
#tg-header.tg-secret .tg-h-title { color: #5cc85e; display: flex; align-items: center; gap: 4px; }
#tg-header.tg-secret .tg-h-title::before { content: ""; width: 16px; height: 16px; flex: none; background: currentColor; -webkit-mask: var(--tg-lock-mask) center/16px no-repeat; mask: var(--tg-lock-mask) center/16px no-repeat; }

/* ---------- 11. Message box = Telegram composer ---------- */
body.tg-on input-container { padding: 0 0 16px !important; }
body.tg-on .input-area-container, body.tg-on .input-area-container.is-zero-state {
  position: relative !important; inset: auto !important; transform: none !important; width: 100% !important;
  max-width: var(--tg-col) !important; margin: 0 auto !important; padding: 0 16px !important; box-sizing: border-box !important;
}
body.tg-on :is(input-area-v2, input-area-v2 .input-area, input-area-v2 .input-area-fieldset) {
  background: transparent !important; box-shadow: none !important; border: 0 !important; width: 100% !important; max-width: 100% !important;
}
body.tg-on input-area-v2 .input-area-fieldset { position: relative !important; padding: 0 64px 0 0 !important; margin: 0 !important; box-sizing: border-box !important; }
body.tg-on input-area-v2 .text-input-field {
  position: relative !important; display: grid !important; overflow: visible !important;
  grid-template-areas: "file-preview file-preview file-preview file-preview file-preview" "tgmenu tgemoji text-input fsbtn leading-actions" !important;
  grid-template-columns: auto auto minmax(0, 1fr) auto auto !important; grid-template-rows: auto auto !important;
  align-items: end !important; column-gap: 0 !important; row-gap: 0 !important;
  min-height: 56px !important; padding: 0 6px !important; box-sizing: border-box !important;
  background: var(--tg-surface) !important; border: 0 !important; border-radius: 15px 15px 0 15px !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .3) !important; outline: none !important;
}
body.tg-on input-area-v2 .text-input-field::after {
  content: ""; position: absolute; right: -8.4px; bottom: 0; width: 11px; height: 20px; background: var(--tg-surface);
  -webkit-mask: ${TAIL} no-repeat; mask: ${TAIL} no-repeat; transform: scaleX(-1); pointer-events: none;
}
body.tg-on input-area-v2 :is(.single-line-format, .text-input-field_textarea-wrapper) { grid-area: text-input !important; align-self: center !important; padding: 0 !important; margin: 0 !important; min-width: 0 !important; }
body.tg-on input-area-v2 .text-input-field-main-area { padding: 0 !important; margin: 0 !important; }
body.tg-on input-area-v2 .leading-actions-wrapper { grid-area: leading-actions !important; margin: 0 0 8px !important; }
body.tg-on input-area-v2 .trailing-actions-wrapper { display: contents !important; }
body.tg-on input-area-v2 .model-picker-container { grid-area: tgmenu !important; margin: 0 2px 12px 4px !important; align-self: end !important; }
body.tg-on input-area-v2 .tg-emoji-btn { grid-area: tgemoji !important; margin: 0 0 8px !important; }
body.tg-on input-area-v2 .input-buttons-wrapper-top { display: none !important; }
body.tg-on input-area-v2 :is(simplified-input-menu, .simplified-input-menu-container) { width: auto !important; min-width: 40px !important; }
body.tg-on .ql-editor, body.tg-on rich-textarea { color: var(--tg-text) !important; caret-color: var(--tg-primary); }
body.tg-on input-area-v2 .ql-editor { font-size: 16px !important; line-height: 21px !important; padding: 17px 8px 18px 6px !important; min-height: 56px !important; box-sizing: border-box !important; max-height: 50vh !important; }
body.tg-on input-area-v2 .ql-editor.ql-blank::before { content: "Message" !important; color: var(--tg-text-2) !important; font-style: normal !important; left: 6px !important; right: 8px !important; font-size: 16px !important; line-height: 21px !important; }
body.tg-on input-area-v2 file-preview-container, body.tg-on input-area-v2 .file-preview-wrapper { grid-area: file-preview !important; padding: 8px 8px 0 !important; }
/* attach (Gemini's + menu) */
body.tg-on input-area-v2 .leading-actions-wrapper :is(.menu-button button, button.mat-mdc-icon-button) { width: 40px !important; height: 40px !important; padding: 8px !important; color: var(--tg-text-2) !important; }
body.tg-on input-area-v2 .leading-actions-wrapper .menu-button gem-icon {
  width: 24px !important; height: 24px !important; background: currentColor; -webkit-mask: ${M_ATTACH} center/24px no-repeat; mask: ${M_ATTACH} center/24px no-repeat;
}
body.tg-on input-area-v2 .leading-actions-wrapper .menu-button gem-icon mat-icon { opacity: 0 !important; }
body.tg-on input-area-v2 .leading-actions-wrapper button:hover { color: var(--tg-primary) !important; background: none !important; }
/* the bot "Menu" button = model picker */
body.tg-on input-area-v2 .model-picker-container :is(bard-mode-switcher, .pill-ui-logo-container) { display: block !important; margin: 0 !important; padding: 0 !important; background: none !important; }
body.tg-on input-area-v2 .model-picker-container button.input-area-switch {
  height: 32px !important; min-width: 0 !important; padding: 0 12px 0 8px !important; border-radius: 16px !important; border: 0 !important;
  background: var(--tg-primary) !important; color: #fff !important; box-shadow: none !important;
}
body.tg-on input-area-v2 .model-picker-container button.input-area-switch:hover { background: color-mix(in srgb, var(--tg-primary) 88%, #000) !important; }
body.tg-on input-area-v2 .model-picker-container .mdc-button__label { display: flex !important; align-items: center !important; gap: 4px; }
body.tg-on input-area-v2 .model-picker-container .mdc-button__label::before {
  content: ""; width: 20px; height: 20px; flex: none; background: currentColor; -webkit-mask: ${M_MENU} center/20px no-repeat; mask: ${M_MENU} center/20px no-repeat;
}
body.tg-on input-area-v2 .model-picker-container :is(.picker-primary-text, .picker-secondary-text) { color: #fff !important; font-size: 14px !important; font-weight: 500 !important; margin: 0 !important; }
body.tg-on input-area-v2 .model-picker-container .logo-pill-label-container:has(.picker-secondary-text:not(:empty)) .picker-primary-text { display: none !important; }
body.tg-on input-area-v2 .model-picker-container :is(.dropdown-icon, .mat-mdc-button-persistent-ripple, .mat-focus-indicator) { display: none !important; }
/* the round mic / send button outside the box */
body.tg-on input-area-v2 .input-buttons-wrapper-bottom {
  position: absolute !important; left: auto !important; top: auto !important; right: -64px !important; bottom: 0 !important;
  width: 56px !important; height: 56px !important; margin: 0 !important; padding: 0 !important;
  display: flex !important; align-items: center !important; justify-content: center !important;
  border-radius: 50% !important; background: var(--tg-surface) !important; box-shadow: 0 1px 2px rgba(0, 0, 0, .3) !important;
}
body.tg-on input-area-v2 .input-buttons-wrapper-bottom > * { margin: 0 !important; }
body.tg-on input-area-v2 .input-buttons-wrapper-bottom:has(.send-button-container.visible) .mic-button-container { display: none !important; }
body.tg-on input-area-v2 .input-buttons-wrapper-bottom :is(.mic-button-container, .send-button-container, speech-dictation-mic-button, .gem-mic-button-wrapper, gem-icon-button) {
  width: 56px !important; height: 56px !important; display: flex !important; align-items: center !important; justify-content: center !important; margin: 0 !important; position: static !important;
}
body.tg-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container:not(.visible) { display: none !important; }
body.tg-on input-area-v2 .input-buttons-wrapper-bottom button { width: 56px !important; height: 56px !important; padding: 16px !important; border-radius: 50% !important; background: transparent !important; color: var(--tg-text-2) !important; }
body.tg-on input-area-v2 .input-buttons-wrapper-bottom :is(gem-icon-button, .send-button, .send-button-container) { background: transparent !important; box-shadow: none !important; border: 0 !important; }
body.tg-on input-area-v2 .input-buttons-wrapper-bottom button:hover { background: rgba(255, 255, 255, .04) !important; }
body.tg-on input-area-v2 .input-buttons-wrapper-bottom gem-icon { width: 24px !important; height: 24px !important; background: currentColor; -webkit-mask: ${M_MIC} center/24px no-repeat; mask: ${M_MIC} center/24px no-repeat; }
body.tg-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container button { color: var(--tg-primary) !important; }
body.tg-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container gem-icon { -webkit-mask-image: ${M_SEND}; mask-image: ${M_SEND}; }
body.tg-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container :is(.stop, [class*="stop"]) gem-icon { -webkit-mask-image: ${M_STOP}; mask-image: ${M_STOP}; }
body.tg-on input-area-v2 .input-buttons-wrapper-bottom mat-icon { opacity: 0 !important; }
body.tg-on input-area-v2 .input-buttons-wrapper-bottom .circle-overlay { border-radius: 50% !important; }
body.tg-on input-area-v2 :is(.mat-mdc-button-persistent-ripple, .mdc-icon-button__ripple) { display: none !important; }
body.tg-on prompt-flow-bar, body.tg-on .inline-upgrade-banner { max-width: var(--tg-col) !important; margin-inline: auto !important; }
.tg-composer-btn { width: 40px !important; height: 40px !important; color: var(--tg-text-2) !important; }
.tg-composer-btn:hover { color: var(--tg-primary) !important; background: none !important; }

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

body.tg-on .cdk-overlay-pane :is(.mat-mdc-menu-panel, .mat-mdc-select-panel),
body.tg-on .cdk-overlay-popover .cdk-overlay-pane > .container,
body.tg-on .cdk-overlay-popover gem-menu:not(.cdk-overlay-popover .container gem-menu) {
  background: var(--tg-menu-bg) !important; -webkit-backdrop-filter: var(--tg-menu-blur) !important; backdrop-filter: var(--tg-menu-blur) !important;
  border-radius: 12px !important; box-shadow: var(--tg-menu-shadow) !important; border: 0 !important; padding: 4px 0 !important; min-width: 210px !important; overflow: hidden;
}
body.tg-on .cdk-overlay-popover .cdk-overlay-pane > .container :is(gem-menu, .popover-menu) { background: transparent !important; box-shadow: none !important; padding: 0 !important; min-width: 0 !important; border: 0 !important; }
body.tg-on .mat-mdc-menu-content { padding: 0 !important; }
body.tg-on .cdk-overlay-pane .mat-mdc-menu-item, body.tg-on .cdk-overlay-popover gem-menu-item {
  min-height: 32px !important; margin: 2px 4px !important; width: calc(100% - 8px) !important; padding: 0 12px !important; border-radius: 6px !important; box-sizing: border-box !important;
  background: transparent !important; color: var(--tg-text) !important;
}
body.tg-on .cdk-overlay-popover gem-menu-item { padding: 0 !important; }
body.tg-on .cdk-overlay-popover gem-menu-item-content { min-height: 32px !important; padding: 4px 12px !important; border-radius: 6px !important; gap: 18px !important; background: transparent !important; }
body.tg-on .cdk-overlay-pane .mat-mdc-menu-item:hover, body.tg-on .cdk-overlay-popover gem-menu-item-content:hover, body.tg-on .cdk-overlay-popover gem-menu-item-content.active {
  background: rgba(255, 255, 255, .08) !important;
}
body.tg-on :is(.cdk-overlay-pane .mat-mdc-menu-item, .cdk-overlay-popover gem-menu-item) :is(.mat-mdc-menu-item-text, .gem-menu-item-label, .label, span) { font-size: 14px !important; font-weight: 500 !important; color: inherit !important; }
body.tg-on .cdk-overlay-popover gem-menu-item .sublabel { font-size: 13px !important; font-weight: 400 !important; color: var(--tg-text-2) !important; }
body.tg-on :is(.cdk-overlay-pane .mat-mdc-menu-item, .cdk-overlay-popover gem-menu-item) mat-icon { color: var(--tg-text) !important; font-size: 20px !important; width: 20px !important; height: 20px !important; }
body.tg-on :is(.cdk-overlay-pane .mat-mdc-menu-item, .cdk-overlay-popover gem-menu-item) :is(.gem-menu-item-icon, .leading-container) { margin-right: 6px !important; }
body.tg-on .cdk-overlay-pane .mat-mdc-menu-item .mat-mdc-menu-ripple, body.tg-on .cdk-overlay-pane .mat-mdc-menu-item::before { display: none !important; }
body.tg-on .cdk-overlay-pane .settings-menu-section-header { padding: 8px 16px 4px !important; color: var(--tg-link) !important; font-size: 13px !important; font-weight: 500 !important; }
body.tg-on .cdk-overlay-pane :is(.mat-mdc-menu-item[data-test-id="delete-button"], [data-test-id="delete-button"]),
body.tg-on .cdk-overlay-popover gem-menu-item[data-test-id="delete-button"] * { color: var(--tg-danger) !important; }
body.tg-on :is(.mat-divider, mat-divider) { border-top-color: rgba(255, 255, 255, .08) !important; margin: 4px 0 !important; }
body.tg-on .mat-mdc-dialog-surface, body.tg-on .mdc-dialog__surface {
  background: var(--tg-surface) !important; border-radius: 12px !important; box-shadow: 0 8px 32px rgba(0, 0, 0, .5) !important; color: var(--tg-text) !important;
}
body.tg-on .mat-mdc-dialog-container .mdc-dialog__title { font-size: 20px !important; font-weight: 500 !important; color: var(--tg-text) !important; }
body.tg-on .mat-mdc-dialog-actions button:not(.mdc-button--unelevated) { color: var(--tg-link) !important; text-transform: uppercase; font-weight: 500 !important; }
body.tg-on .cdk-overlay-dark-backdrop.cdk-overlay-backdrop-showing { background: rgba(0, 0, 0, .5) !important; }
body.tg-on .mdc-tooltip__surface { background: rgba(0, 0, 0, .75) !important; color: #fff !important; border-radius: 8px !important; font-size: 13px !important; -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
body.tg-on :is(g1-dynamic-upsell-button button, .gem-button-type-filled button, button.mdc-button--unelevated) { background: var(--tg-primary) !important; color: #fff !important; }
body.tg-on .gem-button-type-tonal button { background: var(--tg-hover) !important; color: var(--tg-text) !important; }

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
    const css = CSS;
    if (typeof GM_addStyle === 'function') { try { styleEl = GM_addStyle(css); } catch (e) { styleEl = null; } if (styleEl) return; }
    const parent = document.head || document.documentElement;
    if (!parent) return;
    styleEl = document.createElement('style');
    styleEl.id = 'tg-style';
    styleEl.textContent = css;
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
  document.documentElement.style.setProperty('--tg-lock-mask', svgUrl('<path d="M7 11V8a5 5 0 0 1 10 0v3"/><rect x="5" y="11" width="14" height="10" rx="2.5" fill="black" stroke="none"/>'));

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
     Gemini adapter: everything we read from or click in Gemini's own UI
     ===================================================================== */
  function labelOf(b) {
    const ic = b.querySelector('mat-icon, gem-icon');
    return [b.getAttribute('aria-label'), b.getAttribute('mattooltip'), b.getAttribute('data-tooltip'), b.getAttribute('data-test-id'),
      b.title, ic && ic.getAttribute('fonticon'), ic && ic.getAttribute('data-mat-icon-name'), ic && ic.textContent].filter(Boolean).join(' ');
  }
  function findBtn(root, re, notInside) {
    if (!root) return null;
    for (const b of $$('button, [role="button"]', root)) {
      if (notInside && b.closest(notInside)) continue;
      if (b.closest('.tg-ui')) continue;
      if (re.test(labelOf(b))) return b;
    }
    return null;
  }
  // Open one of Gemini's menus invisibly and click an item in it.
  let ghostDepth = 0;
  async function ghost(fn) {
    ghostDepth++;
    document.body.classList.add('tg-ghost');
    try { return await fn(); } finally {
      setTimeout(() => { if (--ghostDepth <= 0) { ghostDepth = 0; document.body.classList.remove('tg-ghost'); } }, 450);
    }
  }
  const MENU_ITEMS = '.cdk-overlay-container .mat-mdc-menu-item, .cdk-overlay-container [role="menuitem"], .cdk-overlay-container [role="menuitemradio"], .cdk-overlay-popover gem-menu-item';
  function overlayItem(match, scope) {
    const items = $$(MENU_ITEMS, scope || document);
    return items.find(i => typeof match === 'string' ? i.getAttribute('data-test-id') === match : match.test((i.innerText || i.textContent || '').trim())) || null;
  }
  // close Gemini's menus (never its dialogs: those use the dark backdrop)
  function closeOverlays() {
    for (let i = 0; i < 3; i++) {
      const panel = $$('.cdk-overlay-container .mat-mdc-menu-panel, .cdk-overlay-popover gem-menu').pop();
      if (!panel) return;
      const b = $$('.cdk-overlay-transparent-backdrop').pop();
      if (b) b.click();
      else panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    }
  }
  function clickItem(it) { const c = $('gem-menu-item-content', it) || it; c.click(); }
  async function menuAction(trigger, match, sub) {
    if (!trigger) return false;
    return ghost(async () => {
      trigger.click();
      const it = await waitFor(() => overlayItem(match));
      if (!it) { closeOverlays(); return false; }
      clickItem(it);
      if (!sub) return true;
      const panels = () => $$('.cdk-overlay-container .mat-mdc-menu-panel');
      const si = await waitFor(() => { const ps = panels(); return ps.length > 1 ? overlayItem(sub, ps[ps.length - 1]) : null; });
      if (!si) { closeOverlays(); return false; }
      clickItem(si);
      await sleep(150);
      closeOverlays(); // radio items (Theme, Watermark) leave the menu open
      return true;
    });
  }
  const G = {
    settingsBtn: () => $('.mavatar-settings-button button') || findBtn($('sidenav-mavatar-footer'), /setting/i),
    name: () => ((($('.mavatar-user-name') || {}).textContent) || '').trim() || 'You',
    photo: () => { const i = $('img.mavatar-image'); return i && i.src ? i.src : ''; },
    email: () => ((($('meta[name="og-profile-acct"]') || {}).content) || '').trim(),
    nav(testId, re) {
      const items = $$('side-navigation-content gem-nav-list-item:not([data-test-id="conversation"])');
      const it = items.find(g => testId && g.getAttribute('data-test-id') === testId) || items.find(g => re && re.test((g.textContent || '').trim()));
      const a = it && ($('a', it) || $('button', it));
      if (a) { a.click(); return true; }
      return false;
    },
    newChat() {
      if (G.nav('new-chat-button', /^new chat$/i)) return;
      const a = $('a[href="/app"]'); if (a) a.click(); else location.href = '/app';
    },
    library: () => G.nav('library-side-nav-entry-button', /library|my stuff/i) || (location.href = '/mystuff'),
    images: () => G.nav('images-side-nav-entry-button', /^images$/i),
    scheduled: () => G.nav(null, /^scheduled/i),
    customize: () => G.nav(null, /^customi[sz]e/i),
    newNotebook: () => G.nav('new-notebook-button', /new notebook/i),
    notebooks() {
      return $$('project-sidenav-list gem-nav-list-item, project-sidenav-list a').filter(x => !/new notebook/i.test(x.textContent || ''))
        .map(x => ({ title: (x.textContent || '').trim().split('\n')[0], el: $('a', x) || x })).filter(n => n.title);
    },
    topBtn: re => findBtn($('top-bar-actions'), re),
    tempChat() { const b = G.topBtn(/temporary|temp chat/i); if (b) { b.click(); return true; } toast('Temporary chat is available from a new chat', 'timer'); G.newChat(); return false; },
    getApp() { const b = $('desktop-get-app-button button'); if (b) b.click(); else window.open('https://gemini.google.com/download', '_blank', 'noopener'); },
    upgrade() { const b = $('g1-dynamic-upsell-button button'); if (b) b.click(); else G.settings(/upgrade/i); },
    account() { const a = $('a.mavatar-footer-left'); if (a) a.click(); else window.open('https://myaccount.google.com/', '_blank', 'noopener'); },
    addAccount() { window.open('https://accounts.google.com/AddSession?continue=' + encodeURIComponent('https://gemini.google.com/app'), '_blank', 'noopener'); },
    searchChats() { const b = $('.search-button button, [aria-label="Search chats"]'); if (b) { b.click(); return true; } return false; },
    settings: (match, sub) => menuAction(G.settingsBtn(), match, sub),
    convMenu(testId) { const b = $('conversation-actions-icon button') || G.topBtn(/menu for conversation|conversation actions/i); return menuAction(b, testId); },
    rowMenu(row, testId) { const b = row && ($('[data-test-id="actions-menu-button"] button', row.item) || findBtn(row.item, /more options|options|actions/i)); return menuAction(b, testId); },
    modelBtn: () => $('[data-test-id="bard-mode-menu-button"]'),
    async readState() {
      const btn = G.settingsBtn();
      if (!btn) return null;
      return ghost(async () => {
        const out = {};
        btn.click();
        const root = await waitFor(() => overlayItem('desktop-theme-menu-button'));
        if (!root) { closeOverlays(); return null; }
        const readSub = async (id) => {
          const t = overlayItem(id); if (!t) return null;
          t.click();
          const p = await waitFor(() => { const ps = $$('.cdk-overlay-container .mat-mdc-menu-panel'); return ps.length > 1 ? ps[ps.length - 1] : null; }, 800);
          if (!p) return null;
          await sleep(60);
          return $$('[role="menuitemradio"], .mat-mdc-menu-item', p).map(i => ({ label: (i.innerText || '').trim().split('\n'), on: i.getAttribute('aria-checked') === 'true' }));
        };
        const th = await readSub('desktop-theme-menu-button');
        out.theme = th && (th.find(x => x.on) || {}).label;
        const wm = await readSub('watermark-button');
        out.watermark = wm && (wm.find(x => x.on) || {}).label;
        const loc = await readSub('location-menu-button');
        out.location = loc && loc[0] && loc[0].label;
        closeOverlays();
        return out;
      });
    },
    wiz() {
      const g = W.WIZ_global_data;
      if (g && g.SNlM0e) return { at: g.SNlM0e, bl: g.cfb2h, sid: g.FdrFJe };
      const txt = (($('script[data-id="_gd"]') || {}).textContent) || '';
      const pick = k => { const m = txt.match(new RegExp('"' + k + '":"([^"]+)"')); return m ? m[1] : ''; };
      return { at: pick('SNlM0e'), bl: pick('cfb2h'), sid: pick('FdrFJe') };
    },
  };

  /* ---------- reading a chat the way Gemini does (read-only), for previews and send times ---------- */
  async function readChat(id, limit) {
    const g = G.wiz();
    if (!g.at) return;
    const freq = JSON.stringify([[['hNvQHb', JSON.stringify(['c_' + id, limit, null, 1, [1], [4], null, 1]), null, 'generic']]]);
    const qs = new URLSearchParams({ rpcids: 'hNvQHb', 'source-path': location.pathname, bl: g.bl || '', 'f.sid': g.sid || '', hl: document.documentElement.lang || 'en', _reqid: String(100000 + Math.floor(Math.random() * 800000)), rt: 'c' });
    const f = origFetch || W.fetch;
    const res = await f.call(W, '/_/BardChatUi/data/batchexecute?' + qs, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' },
      body: 'f.req=' + encodeURIComponent(freq) + '&at=' + encodeURIComponent(g.at) + '&',
    });
    if (res.ok) onRpcText(await res.text());
  }
  // the last message of each chat in the list
  const previewQueue = [];
  const previewTried = {};
  let previewBusy = false;
  function wantPreview(id) {
    if (!S.previews || !id || previewTried[id]) return;
    const p = DB.prev[id], c = DB.chats[id];
    if (p && (!c || !c.ts || !p.ts || p.ts >= c.ts - 60e3)) return;
    previewTried[id] = 1;
    previewQueue.push(id);
    pumpPreviews();
  }
  async function pumpPreviews() {
    if (previewBusy) return;
    const id = previewQueue.shift();
    if (!id) return;
    previewBusy = true;
    try { await readChat(id, 1); } catch (e) { /* offline or blocked */ }
    previewBusy = false;
    if (previewQueue.length) setTimeout(pumpPreviews, 400);
  }
  // send times for the open chat, if Gemini's own replies weren't caught
  const timesAsked = {};
  function wantTimes(id, turns) {
    const t = timesAsked[id];
    if (t && (t.n >= turns || Date.now() - t.at < 4000)) return;
    timesAsked[id] = { n: turns, at: Date.now() };
    readChat(id, Math.min(100, Math.max(10, turns + 2))).then(schedule, () => {});
  }

  /* =====================================================================
     Reading Gemini's page
     ===================================================================== */
  function convId() {
    const m = location.pathname.match(/\/(?:app|chat|gem\/[^/]+)\/([A-Za-z0-9_-]{6,})/);
    return m ? m[1] : '_new';
  }
  function C(id = convId()) { return (DB.c[id] = DB.c[id] || { r: {}, p: [], h: {}, t: {}, s: {} }); }
  function rawUserLines(el) {
    const lines = $$('.query-text-line', el);
    // textContent, not innerText: hidden lines (our ↩ / ↪ headers) must read back exactly the same
    if (lines.length) return lines.map(l => ({ el: l, text: (l.textContent || '').replace(/ /g, ' ').trim() }));
    const q = $('.query-text', el);
    return (q ? q.innerText : '').split('\n').map(t => ({ el: null, text: t }));
  }
  function parseUser(lines) {
    const out = { kind: null, name: '', quote: [], body: [], used: 0 };
    if (!lines.length) return out;
    const first = lines[0].text.trim();
    let m;
    if ((m = first.match(/^↩\s*(.+)$/))) { out.kind = 'reply'; out.name = m[1].replace(/:$/, ''); }
    else if ((m = first.match(/^↪\s*Forwarded (?:from (.+)|(\d+) messages)$/))) { out.kind = 'forward'; out.name = m[1] || (m[2] + ' messages'); }
    else { out.body = lines.map(l => l.text); return out; }
    let i = 1;
    while (i < lines.length && /^>\s?/.test(lines[i].text)) { out.quote.push(lines[i].text.replace(/^>\s?/, '')); i++; }
    while (i < lines.length && !lines[i].text.trim()) i++;
    out.used = i;
    out.body = lines.slice(i).map(l => l.text);
    return out;
  }
  const textCache = new WeakMap();
  function userText(el) {
    const raw = rawUserLines(el);
    const sig = raw.map(r => r.text).join('\n');
    const c = textCache.get(el);
    if (c && c.sig === sig) return c;
    const p = parseUser(raw);
    const v = { sig, raw, parsed: p, body: (p.kind === 'forward' && !p.body.join('').trim()) ? p.quote.join('\n') : p.body.join('\n') };
    textCache.set(el, v);
    return v;
  }
  const modelCache = new WeakMap();
  function modelText(el) {
    const c = modelCache.get(el);
    if (c && Date.now() - c.at < 1500) return c.t;
    const md = $('message-content .markdown', el) || $('.markdown', el) || $('message-content', el) || el;
    const t = (md.innerText || '').trim();
    modelCache.set(el, { t, at: Date.now() });
    return t;
  }
  function bubbleOf(el, role) {
    if (role === 'u') return $('.user-query-bubble-with-background', el) || $('.query-content', el) || el;
    return $('.response-container-content', el) || $('message-content', el) || el;
  }
  // Keys: Gemini's turn id when it has one (stable), else a hash of the prompt (older data used these)
  function migrateKey(from, to) {
    if (from === to) return;
    const c = C();
    for (const m of ['r', 'h', 't', 's']) if (c[m][from] != null && c[m][to] == null) { c[m][to] = c[m][from]; delete c[m][from]; save(); }
    const i = c.p.indexOf(from);
    if (i >= 0) { c.p[i] = to; save(); }
  }
  function getMessages() {
    const list = [], counts = {};
    let prevUser = '';
    for (const el of $$('user-query, model-response')) {
      if (el.closest('.tg-ui')) continue;
      const role = el.tagName === 'USER-QUERY' ? 'u' : 'm';
      let base;
      if (role === 'u') { const t = userText(el).sig; prevUser = t; base = 'u' + hash(t); } else base = 'm' + hash(prevUser);
      counts[base] = (counts[base] || 0) + 1;
      const legacy = base + '_' + counts[base];
      const turn = el.closest('.conversation-container');
      const rid = turn && /^[a-z0-9_]{8,}$/i.test(turn.id || '') ? turn.id.replace(/^r_/, '') : '';
      const key = rid ? rid + ':' + role : legacy;
      if (rid) migrateKey(legacy, key);
      const msg = { el, role, key, bubble: bubbleOf(el, role), turn, rid, usig: normSig(prevUser) };
      Object.defineProperty(msg, 'text', { get() { return role === 'u' ? userText(el).body : modelText(el); } });
      list.push(msg);
    }
    return list;
  }
  const nameOf = role => role === 'u' ? 'You' : 'Gemini';
  function msgBtn(msg, re) {
    if (msg.role === 'u') return findBtn(msg.el, re) || findBtn(msg.el.closest('.conversation-container'), re, 'model-response');
    return findBtn(msg.el, re) || findBtn(msg.el.closest('.conversation-container'), re, 'user-query');
  }
  function isGenerating() {
    return !!($('input-area-v2 button[aria-label*="Stop" i], .send-button.stop, button.stop[aria-label], [data-test-id="stop-button"]') ||
              $('pending-request, model-response .pending-response'));
  }
  function editor() { return $('rich-textarea .ql-editor, .ql-editor[contenteditable="true"]'); }
  function editorText() { const e = editor(); return e ? e.innerText.replace(/\n+$/, '') : ''; }
  function sendButton() {
    const area = $('input-area-v2') || document;
    for (const b of $$('button', area)) {
      const l = labelOf(b);
      if (/stop/i.test(l)) continue;
      if (/send|submit/i.test(l) || (b.closest('.send-button-container') && b.closest('.send-button'))) {
        if (!b.disabled && b.getAttribute('aria-disabled') !== 'true') return b;
      }
    }
    return null;
  }
  function scroller() {
    const any = $('model-response, user-query');
    let e = any && any.parentElement;
    while (e && e !== document.body) {
      const s = getComputedStyle(e);
      if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 8) return e;
      e = e.parentElement;
    }
    return $('chat-window infinite-scroller.chat-history') || null;
  }
  function sidebarRows() {
    return $$('gem-nav-list-item[data-test-id="conversation"]').map(item => {
      const a = $('a.gem-nav-list-item, a', item);
      if (!a) return null;
      const titleEl = $('.title-text', a) || $('.conversation-title', a) || $('.mdc-list-item__primary-text', a);
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/(?:app|chat|gem\/[^/]+)\/([A-Za-z0-9_-]{6,})/);
      const title = ((titleEl ? titleEl.textContent : a.getAttribute('aria-label')) || '').split('\n')[0].trim() || 'Chat';
      return { item, a, titleEl, title, id: m ? m[1] : null };
    }).filter(Boolean);
  }
  function isActiveRow(r) {
    const cur = convId();
    return (r.id && r.id === cur) || r.a.classList.contains('mdc-list-item--activated') || r.a.getAttribute('aria-current') === 'page';
  }
  function currentRow() { return sidebarRows().find(isActiveRow); }
  function pageKind() {
    const p = location.pathname;
    if (/^\/(app|chat)(\/|$)/.test(p) || /^\/gem\/[^/]+(\/|$)/.test(p)) return 'chat';
    return 'page';
  }
  // Gemini's other pages, shown like Telegram's special chats (Saved Messages, Archived Chats…)
  const PAGES = [
    [/^\/(library|mystuff)/, 'Library', 'bookmark', 'files and media you made', ['#72d5fd', '#2a9ef1']],
    [/^\/images/, 'Images', 'images', 'pictures you made with Gemini', ['#ff885e', '#ff516a']],
    [/^\/scheduled/, 'Scheduled', 'clock', 'actions Gemini runs for you', ['#ffcd6a', '#ffa85c']],
    [/^\/(customize|gems)/, 'Customize', 'user', 'Gems and personal context', ['#a0de7e', '#54cb68']],
    [/^\/notebooks?/, 'Notebooks', 'notebook', 'chats and files by topic', ['#53edd6', '#28c9b7']],
    [/^\/(settings|saved-info|apps|extensions|personal|activity)/, 'Settings', 'settings', 'Gemini settings', ['#9aa3ad', '#6c757d']],
  ];
  const pageInfo = () => { const p = PAGES.find(x => x[0].test(location.pathname)); return p ? { title: p[1], icon: p[2], status: p[3], colors: p[4] } : null; };
  function currentTitle() {
    const r = currentRow();
    if (r) return r.title;
    const id = convId();
    if (id !== '_new' && DB.chats[id] && DB.chats[id].t) return DB.chats[id].t;
    if (pageKind() !== 'chat') {
      const pi = pageInfo();
      if (pi) return pi.title;
      const t = document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*[-|–]\s*(Google\s+)?Gemini.*$/i, '').trim();
      return t && !/^(Google\s+)?Gemini$/i.test(t) ? t : 'Gemini';
    }
    if (id === '_new') return 'Gemini';
    const t = document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*[-|–]\s*(Google\s+)?Gemini.*$/i, '').trim();
    return t && !/^(Google\s+)?Gemini$/i.test(t) ? t : 'Gemini';
  }

  /* =====================================================================
     Pop-up menus (Telegram style, with sub-menus)
     ===================================================================== */
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
  let sideQuery = '', sideInput = null, sideHead = null, fab = null;
  function buildSideHead() {
    const head = $('.sidenav-header-buttons');
    if (!head) return;
    if (sideHead && sideHead.isConnected && sideHead.parentElement === head) return;
    const burger = h('button', { class: 'tg-iconbtn tg-burger', title: 'Menu' }, icon('menu'));
    burger.addEventListener('click', e => {
      if (sideQuery || document.activeElement === sideInput) { clearSideSearch(); return; }
      openMainMenu(e.currentTarget);
    });
    sideInput = h('input', { placeholder: 'Search', type: 'text', spellcheck: 'false', autocomplete: 'off' });
    const clearBtn = h('button', { class: 'tg-iconbtn tg-clear-q', title: 'Clear', type: 'button' }, icon('close'));
    clearBtn.addEventListener('mousedown', e => e.preventDefault());
    clearBtn.addEventListener('click', () => { sideInput.value = ''; sideQuery = ''; syncSearch(); sideInput.focus(); });
    const wrap = h('label', { class: 'tg-search' }, icon('search'), sideInput, clearBtn);
    sideInput.addEventListener('input', () => { sideQuery = sideInput.value.trim().toLowerCase(); syncSearch(); });
    sideInput.addEventListener('focus', syncSearch);
    sideInput.addEventListener('blur', () => setTimeout(syncSearch, 150));
    sideInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') { clearSideSearch(); e.stopPropagation(); }
      if (e.key === 'Enter') { const first = sidebarRows().find(r => !r.item.classList.contains('tg-filtered')); if (first) { first.a.click(); clearSideSearch(); } }
    });
    sideHead = h('div', { class: 'tg-side-head tg-ui' }, burger, wrap);
    head.prepend(sideHead);
  }
  function clearSideSearch() { if (!sideInput) return; sideInput.value = ''; sideQuery = ''; sideInput.blur(); syncSearch(); }
  function syncSearch() {
    if (!sideHead) return;
    const active = !!sideQuery || document.activeElement === sideInput;
    const b = $('.tg-burger', sideHead);
    const want = active ? 'back' : 'menu';
    if (b && b.dataset.ic !== want) { b.dataset.ic = want; b.replaceChildren(icon(want)); }
    $('.tg-search', sideHead).classList.toggle('tg-has', !!sideQuery);
    schedule();
  }
  function renderSearchExtras() {
    const list = $('bard-sidenav conversations-list');
    let box = $('#tg-search-extra');
    if (!sideQuery || !list) { if (box) box.remove(); return; }
    if (!box) { box = h('div', { id: 'tg-search-extra', class: 'tg-ui' }); list.parentElement.insertBefore(box, list); }
    const q = sideInput.value.trim();
    if (box.dataset.q === q) return;
    box.dataset.q = q;
    box.replaceChildren(
      h('div', { class: 'tg-search-row', onclick: () => searchMessages(q) },
        h('span', { class: 'tg-ri', style: '--c:var(--tg-primary)' }, icon('search')), h('span', {}, 'Search messages for “', h('b', { text: q }), '”')),
      h('div', { class: 'tg-search-head', text: 'Chats' }));
  }
  async function searchMessages(q) {
    if (!G.searchChats()) { toast('Gemini search is not available here', 'search'); return; }
    const input = await waitFor(() => $$('input[type="text"], input[type="search"], textarea').find(i => visible(i) && !i.closest('.tg-ui') && !i.closest('bard-sidenav .tg-side-head')), 1500);
    if (input) {
      input.focus();
      input.value = q;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    clearSideSearch();
  }
  function openMainMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    anchor.classList.add('tg-active');
    const more = () => [
      { icon: 'moon', label: isLight() ? 'Enable Dark Mode' : 'Disable Dark Mode', run: () => setGeminiTheme(isLight() ? /^dark$/i : /^light$/i) },
      { icon: 'bolt', label: S.motion ? 'Reduce Animations' : 'Enable Animations', run: () => { setS('motion', !S.motion); toast(S.motion ? 'Animations on' : 'Animations reduced', 'bolt'); } },
      '-',
      { icon: 'switchG', label: 'Switch to Gemini version', run: turnOff },
      { icon: 'help', label: 'Gemini Features', run: () => G.settings('help-button', /help center/i) },
      { icon: 'bug', label: 'Report Bug', run: () => G.settings('send-feedback-button') },
      { icon: 'install', label: 'Install App', run: G.getApp },
      { foot: `Gemini · Telegram ${VERSION}` },
    ];
    const notebooks = () => {
      const nb = G.notebooks();
      return [...nb.map(n => ({ icon: 'notebook', label: n.title, run: () => n.el.click() })), nb.length ? '-' : null,
        { icon: 'add', label: 'New Notebook', run: G.newNotebook }];
    };
    const items = [
      { photo: userPhoto(22), label: G.name(), cls: 'tg-acc', run: () => openSettings() },
      { icon: 'add', label: 'Add Account', run: G.addAccount },
      '-',
      { icon: 'bookmark', label: 'Library', run: G.library },
      { icon: 'images', label: 'Images', run: G.images },
      { icon: 'clock', label: 'Scheduled', run: G.scheduled },
      { icon: 'user', label: 'Customize', run: G.customize },
      { icon: 'folder', label: 'Notebooks', sub: notebooks },
      '-',
      { icon: 'settings', label: 'Settings', run: () => openSettings() },
      { icon: 'more', label: 'More', sub: more },
    ];
    popup((wrap, close) => wrap.append(menuList(items, close)), r.left, r.bottom + 4, { onClose: () => anchor.classList.remove('tg-active') });
  }
  function buildFab() {
    const side = $('bard-sidenav');
    if (!side) return;
    if (!fab) {
      fab = h('button', { id: 'tg-fab', class: 'tg-ui', title: 'New Message' }, icon('edit'));
      fab.addEventListener('click', e => {
        e.stopPropagation();
        const r = fab.getBoundingClientRect();
        fab.classList.add('tg-open');
        fab.replaceChildren(icon('close'));
        popup((wrap, close) => wrap.append(menuList([
          { icon: 'chat', label: 'New Chat', run: G.newChat },
          { icon: 'timer', label: 'Temporary Chat', run: G.tempChat },
          { icon: 'notebook', label: 'New Notebook', run: G.newNotebook },
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
        const move = ev => { S.listWidth = Math.max(260, Math.min(560, ev.clientX)); applyVars(); schedule(); };
        const up = () => { rz.classList.remove('tg-drag'); document.body.classList.remove('tg-resizing'); setS('listWidth', S.listWidth); removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
        addEventListener('mousemove', move); addEventListener('mouseup', up);
      });
      rz.addEventListener('dblclick', () => setS('listWidth', CONFIG.listWidth));
      side.append(rz);
    }
    let left = $('#tg-left', side);
    if (!left) { left = h('div', { id: 'tg-left', class: 'tg-ui' }); side.append(left); }
  }
  function turnOff() {
    gmSet(ON_KEY, false);
    toast('Switching to the Gemini version…', 'switchG');
    setTimeout(() => location.reload(), 500);
  }
  const isLight = () => document.body.classList.contains('light-theme') && !document.body.classList.contains('dark-theme');
  async function setGeminiTheme(re) {
    const ok = await G.settings('desktop-theme-menu-button', re);
    if (!ok) toast("Couldn't change Gemini's theme", 'moon');
    geminiState = null;
  }

  /* =====================================================================
     Panels over the chat list: Settings and its pages
     ===================================================================== */
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
  let geminiState = null;
  const COLORS = { red: '#fe5c5b', green: '#5ec35b', blue: '#3c9df9', gray: '#8e97a1', slate: '#7d8ea3', pink: '#f6467b', purple: '#9a68ef', orange: '#f99c2a', cyan: '#30b8d4', teal: '#3fb495' };
  function openSettings() {
    if (closePopup) closePopup();
    closeAllPanels();
    const searchAction = { icon: 'search', title: 'Search', run: (btn, body, head) => {
      const h2 = $('h2', head);
      let inp = $('input', head);
      if (inp) { inp.remove(); h2.style.display = ''; $$('.tg-row, .tg-card', body).forEach(x => x.style.display = ''); return; }
      inp = h('input', { placeholder: 'Search' });
      h2.style.display = 'none';
      h2.after(inp); inp.focus();
      inp.addEventListener('input', () => {
        const q = inp.value.trim().toLowerCase();
        $$('.tg-card', body).forEach(c => {
          let any = false;
          $$('.tg-row', c).forEach(r => { const ok = !q || (r.dataset.label || '').includes(q); r.style.display = ok ? '' : 'none'; any = any || ok; });
          c.style.display = any ? '' : 'none';
        });
        $$('.tg-prof, .tg-caption', body).forEach(x => x.style.display = q ? 'none' : '');
      });
    } };
    const moreAction = { icon: 'more', title: 'More', run: btn => {
      const r = btn.getBoundingClientRect();
      popup((wrap, close) => wrap.append(menuList([
        { icon: 'user', label: 'Google Account', run: G.account },
        { icon: 'switchG', label: 'Switch to Gemini version', run: turnOff },
      ], close)), r.right, r.bottom + 4, { alignRight: true });
    } };
    const p = panel('Settings', { actions: [searchAction, moreAction] });
    if (!p) return;
    const render = () => {
      const email = G.email();
      const lang = (() => { try { const l = (document.documentElement.lang || navigator.language || 'en'); return new Intl.DisplayNames([l], { type: 'language' }).of(l.split('-')[0]); } catch (e) { return 'English'; } })();
      p.body.replaceChildren(
        h('div', { class: 'tg-prof' }, userPhoto(120), h('div', { class: 'tg-prof-name', text: G.name() }), h('div', { class: 'tg-prof-status', text: 'online' })),
        card(
          email ? row({ icon: 'mail', label: email, sub: 'Email', run: G.account }) : null,
          row({ icon: 'user', label: G.name(), sub: 'Google Account', run: G.account })),
        card(
          row({ icon: 'bell', color: COLORS.red, label: 'Notifications and Sounds', run: openNotifSettings }),
          row({ icon: 'data', color: COLORS.green, label: 'Data and Storage', run: openDataSettings }),
          row({ icon: 'key', color: COLORS.slate, label: 'Privacy and Security', run: openPrivacySettings }),
          row({ icon: 'settings', color: COLORS.gray, label: 'General Settings', run: openGeneralSettings }),
          row({ icon: 'folder', color: COLORS.blue, label: 'Chat Folders', run: openFolders }),
          row({ icon: 'heart', color: COLORS.pink, label: 'Stickers and Emoji', run: openEmojiSettings }),
          row({ icon: 'gem', color: COLORS.teal, label: 'Gems', run: () => G.settings('desktop-gems-manager-settings-button') }),
          row({ icon: 'doc', color: COLORS.cyan, label: 'Skills', run: () => G.settings(/^skills$/i) }),
          row({ icon: 'globe', color: COLORS.purple, label: 'Language', value: lang, run: () => window.open('https://myaccount.google.com/language', '_blank', 'noopener') }),
          row({ icon: 'keyboard', color: COLORS.orange, label: 'Keyboard Shortcuts', run: openShortcuts })),
        card(
          row({ icon: 'star', color: 'linear-gradient(135deg,#6b93ff,#976fff 50%,#e46ace)', label: 'Upgrade to Google AI Plus', run: G.upgrade }),
          row({ icon: 'pace', color: COLORS.blue, label: 'Usage Limits', run: () => G.settings('desktop-usage-metrics-button') }),
          row({ icon: 'store', color: COLORS.green, label: 'Cart and Orders', run: () => G.settings('shopping-cart-button') }),
          row({ icon: 'avatar', color: COLORS.orange, label: 'Avatar', run: () => G.settings('likeness-button') })),
        card(
          row({ icon: 'feedback', color: COLORS.orange, label: 'Send Feedback', run: () => G.settings('send-feedback-button') }),
          row({ icon: 'help', color: COLORS.blue, label: 'Gemini FAQ', run: () => G.settings('help-button', /help center/i) }),
          row({ icon: 'shield', color: COLORS.green, label: 'Privacy Policy', run: () => G.settings('help-button', /privacy/i) })),
        h('div', { class: 'tg-version', text: `Gemini · Telegram ${VERSION} (${isLight() ? 'Day' : 'Night'})` }));
    };
    p.refresh = render;
    render();
    G.readState().then(s => { if (s) { geminiState = s; } });
  }
  function openNotifSettings() {
    const p = panel('Notifications and Sounds');
    if (!p) return;
    p.body.append(
      card(cardTitle('Gemini replies'),
        row({ icon: 'bell', label: 'Desktop Notifications', sub: 'When an answer finishes in a background tab', toggle: S.notify, run: on => {
          setS('notify', on);
          if (on && typeof GM_notification !== 'function' && window.Notification && Notification.permission === 'default') Notification.requestPermission();
        } }),
        row({ icon: 'speaker', label: 'Notification Sound', toggle: S.sound, run: on => { setS('sound', on); if (on) ding(); } }),
        row({ icon: 'unread', label: 'Unread Count in Tab Title', toggle: S.titleCount, run: on => setS('titleCount', on) })),
      caption('Gemini answers in this tab. When you are on another tab, Telegram-style notifications tell you the reply is ready.'));
  }
  function openDataSettings() {
    const p = panel('Data and Storage');
    if (!p) return;
    p.body.append(
      card(cardTitle('Gemini'),
        row({ icon: 'history', label: 'Gemini Apps Activity', sub: 'Your chat history and what Gemini keeps', run: () => G.settings('desktop-bard-activity-control') }),
        row({ icon: 'pace', label: 'Usage Limits', run: () => G.settings('desktop-usage-metrics-button') }),
        row({ icon: 'upload', label: 'Import Memory to Gemini', run: () => G.settings('import-hub-settings-button') })),
      card(cardTitle('On this device'),
        row({ icon: 'chat', label: 'Load Chat Previews', sub: 'Show the last message of every chat in the list', toggle: S.previews, run: on => setS('previews', on) }),
        row({ icon: 'broom', label: 'Clear Reactions, Pins and Hidden Messages', danger: true, run: () => {
          modal((box, close) => box.append(h('h3', { text: 'Clear local data' }), h('p', { text: 'Remove reactions, pinned messages and hidden messages from every chat on this browser?' }),
            h('div', { class: 'tg-actions' }, h('button', { class: 'tg-textbtn', text: 'Cancel', onclick: close }),
              h('button', { class: 'tg-textbtn tg-danger', text: 'Clear', onclick: () => { DB.c = {}; save(); close(); scan(); toast('Cleared', 'broom'); } }))));
        } })),
      caption('Reactions, pins, hidden messages and send times live only in this browser.'));
  }
  function openPrivacySettings() {
    const p = panel('Privacy and Security');
    if (!p) return;
    const st = geminiState || {};
    const val = x => Array.isArray(x) ? x[0] : (x || '');
    p.body.append(
      card(cardTitle('Privacy'),
        row({ icon: 'person', label: 'Personal Intelligence', sub: 'What Gemini remembers about you', run: () => G.settings('personal-intelligence-button') }),
        row({ icon: 'link', label: 'Your Public Links', run: () => G.settings('toggle-shared-links-button') }),
        row({ icon: 'location', label: 'Location', value: val(st.location), run: () => G.settings('location-menu-button', /update location/i) }),
        row({ icon: 'watermark', label: 'Media Watermark', value: val(st.watermark), run: openWatermark })),
      card(cardTitle('Security'),
        row({ icon: 'history', label: 'Gemini Apps Activity', run: () => G.settings('desktop-bard-activity-control') }),
        row({ icon: 'shield', label: 'Privacy Policy', run: () => G.settings('help-button', /privacy/i) }),
        row({ icon: 'code', label: 'Developer Mode', run: () => G.settings(/developer mode/i) })));
  }
  function openWatermark() {
    const p = panel('Media Watermark');
    if (!p) return;
    const cur = geminiState && geminiState.watermark ? String(geminiState.watermark[0] || geminiState.watermark) : '';
    const pick = async v => { await G.settings('watermark-button', new RegExp('^' + v + '$', 'i')); geminiState = null; G.readState().then(s => { if (s) geminiState = s; }); p.close(); toast('Media watermark: ' + v, 'watermark'); };
    p.body.append(card(row({ radio: /^on$/i.test(cur), label: 'On', run: () => pick('On') }), row({ radio: /^off$/i.test(cur), label: 'Off', run: () => pick('Off') })),
      caption('Adds a visible watermark to images and videos Gemini makes.'));
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
    const th = geminiState && geminiState.theme ? String(geminiState.theme[0] || geminiState.theme) : '';
    const themeRow = (label, re) => row({ radio: re.test(th), label, run: async () => { await setGeminiTheme(re); p.close(); } });
    p.body.append(
      card(cardTitle('Settings'),
        h('div', { class: 'tg-range-head' }, h('div', { text: 'Message Text Size' }), sizeVal), h('div', { class: 'tg-range' }, size),
        h('div', { class: 'tg-range-head' }, h('div', { text: 'Wallpaper Pattern' }), wallVal), h('div', { class: 'tg-range' }, wall)),
      card(cardTitle('Accent Color'), colors),
      card(cardTitle('Night Mode'), themeRow('System', /^system$/i), themeRow('Day', /^light$/i), themeRow('Night', /^dark$/i)),
      card(cardTitle('Chats'),
        row({ icon: 'chat', label: "Show Gemini's Buttons Under Answers", toggle: S.geminiButtons, run: on => setS('geminiButtons', on) }),
        row({ icon: 'bolt', label: 'Animations', toggle: S.motion, run: on => setS('motion', on) })),
      caption('Text size and colours change this theme only. Night Mode changes Gemini’s own theme.'));
  }
  function openFolders() {
    const p = panel('Chat Folders');
    if (!p) return;
    const nb = G.notebooks();
    p.body.append(
      h('div', { class: 'tg-prof' }, h('span', { class: 'tg-avatar', style: '--av1:#72d5fd;--av2:#2a9ef1;width:96px;height:96px' }, icon('folder')),
        h('div', { class: 'tg-prof-status', text: 'Notebooks group your chats and files by topic, like Telegram folders.' })),
      card(cardTitle('My Notebooks'),
        row({ icon: 'add', label: 'Create New Notebook', accent: true, run: () => { closeAllPanels(); G.newNotebook(); } }),
        nb.map(n => row({ icon: 'notebook', label: n.title, run: () => { closeAllPanels(); n.el.click(); } }))),
      nb.length ? null : caption('You have no notebooks yet.'));
  }
  function openEmojiSettings() {
    const p = panel('Stickers and Emoji');
    if (!p) return;
    const grid = h('div', { class: 'tg-colors', style: 'gap:6px' }, ['', ...QUICK, '💯', '🤔', '🙏'].map(e => {
      const b = h('button', { class: S.quick === e ? 'tg-on' : '', style: '--c:transparent;font-size:24px;width:42px;height:42px', title: e || 'Off', text: e || '✕' });
      b.addEventListener('click', () => { setS('quick', e); $$('button', grid).forEach(x => x.classList.toggle('tg-on', x === b)); });
      return b;
    }));
    p.body.append(card(cardTitle('Quick Reaction'), grid), caption('Double-click a message to send this reaction. ✕ turns it off.'),
      card(row({ icon: 'avatar', label: 'Gemini Avatar', run: () => G.settings('likeness-button') })));
  }
  function openShortcuts() {
    const p = panel('Keyboard Shortcuts');
    if (!p) return;
    const k = (...keys) => h('span', { class: 'tg-rv' }, keys.map(x => h('span', { class: 'tg-kbd', text: x })));
    const r = (label, keys) => { const el = row({ label }); el.append(keys); return el; };
    p.body.append(
      card(cardTitle('Chats'),
        r('New chat', k('Ctrl', 'Shift', 'O')), r('Search in this chat', k('Ctrl', 'F')), r('Search chats', k('Ctrl', 'K')),
        r('Edit your last message', k('↑')), r('Close menus, cancel reply', k('Esc'))),
      card(cardTitle('Messages'),
        r('Message menu', k('Right-click')), r('Browser menu', k('Shift', 'Right-click')), r('React', k('Double-click')), r('Dictate', k('Ctrl', 'Shift', 'D'))));
  }

  /* =====================================================================
     Chat header, pinned message, search, selection
     ===================================================================== */
  let header = null, downBtn = null, bottomBar = null;
  let pinIndex = 0, unread = 0;
  function buildHeader() {
    header = h('div', { id: 'tg-header', class: 'tg-ui' });
    const sideBtn = h('button', { class: 'tg-iconbtn tg-h-side', title: 'Chats' }, icon('menu'));
    sideBtn.addEventListener('click', () => { const b = findBtn(document, /open sidebar|main menu|expand menu/i, '.tg-ui'); b && b.click(); });
    const main = h('div', { class: 'tg-h-main' },
      h('span', { class: 'tg-avatar tg-h-av', text: 'G' }),
      h('div', { class: 'tg-h-text' }, h('div', { class: 'tg-h-title', text: 'Gemini' }), h('div', { class: 'tg-h-status', text: 'bot' })));
    main.addEventListener('click', () => toggleInfo());
    const pin = h('div', { class: 'tg-h-pin' }, h('div', { class: 'tg-pin-bars' }),
      h('div', { class: 'tg-pin-text' }, h('div', { class: 'tg-pin-title', text: 'Pinned Message' }), h('div', { class: 'tg-pin-snip' })),
      h('button', { class: 'tg-iconbtn tg-pin-x', title: 'Unpin' }, icon('close')));
    pin.addEventListener('click', e => {
      const c = C(); if (!c.p.length) return;
      const key = c.p[Math.min(pinIndex, c.p.length - 1)];
      if (e.target.closest('.tg-pin-x')) { c.p.splice(c.p.indexOf(key), 1); pinIndex = c.p.length - 1; save(); scan(); toast('Message unpinned', 'unpin'); return; }
      jumpTo(key, c.s[key]);
      pinIndex = (pinIndex - 1 + c.p.length) % c.p.length;
      scan();
    });
    const input = h('input', { placeholder: 'Search', spellcheck: 'false' });
    input.addEventListener('input', () => runSearch(input.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && found.length) { foundIdx = (foundIdx + (e.shiftKey ? found.length - 1 : 1)) % found.length; showFound(); }
      if (e.key === 'Escape') { closeSearch(); e.stopPropagation(); }
    });
    const search = h('div', { class: 'tg-h-search' },
      h('button', { class: 'tg-iconbtn', title: 'Close', onclick: closeSearch }, icon('back')),
      h('label', { class: 'tg-search' }, icon('search'), input));
    const actions = h('div', { class: 'tg-h-actions' },
      h('button', { class: 'tg-iconbtn', title: 'Search', onclick: openSearch }, icon('search')),
      h('button', { class: 'tg-iconbtn', title: 'More', onclick: e => openMore(e.currentTarget) }, icon('more')));
    header.append(sideBtn, main, pin, search, actions);
    downBtn = h('button', { id: 'tg-down', class: 'tg-ui', title: 'Scroll to bottom' }, icon('arrowDown'), h('b'));
    downBtn.addEventListener('click', () => { const s = scroller(); s && s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' }); unread = 0; });
    bottomBar = h('div', { id: 'tg-bottombar', class: 'tg-ui' });
    document.body.append(header, downBtn, bottomBar);
  }
  function openSearch() {
    if (pageKind() !== 'chat') return;
    header.classList.add('tg-searching');
    const i = $('.tg-h-search input', header);
    i.value = ''; runSearch('');
    setTimeout(() => i.focus(), 20);
  }
  let found = [], foundIdx = 0;
  function runSearch(q) {
    $$('.tg-found').forEach(e => e.classList.remove('tg-found'));
    q = q.trim().toLowerCase();
    found = q ? MSGS.filter(m => !C().h[m.key] && m.text.toLowerCase().includes(q)).reverse() : [];
    foundIdx = 0;
    showFound();
  }
  function showFound() {
    $$('.tg-found').forEach(e => e.classList.remove('tg-found'));
    renderBottomBar();
    if (!found.length) return;
    const m = found[foundIdx];
    m.el.classList.add('tg-found');
    m.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function closeSearch() {
    if (!header) return;
    header.classList.remove('tg-searching');
    $$('.tg-found').forEach(e => e.classList.remove('tg-found'));
    found = [];
    renderBottomBar();
  }
  function renderBottomBar() {
    if (!bottomBar) return;
    const searching = header && header.classList.contains('tg-searching');
    const selecting = document.body.classList.contains('tg-selecting');
    const mode = selecting ? 'sel' : searching ? 'search' : '';
    bottomBar.classList.toggle('tg-show', !!mode);
    document.body.classList.toggle('tg-bar-open', !!mode);
    if (!mode) { bottomBar.dataset.v = ''; return; }
    const sig = mode + (mode === 'sel' ? selected.size : found.length + ':' + foundIdx + ':' + ($('.tg-h-search input', header) || {}).value);
    if (bottomBar.dataset.v === sig) return;
    bottomBar.dataset.v = sig;
    if (mode === 'sel') {
      const n = selected.size;
      bottomBar.replaceChildren(
        h('button', { class: 'tg-iconbtn', title: 'Cancel', onclick: stopSelect }, icon('close')),
        h('span', { class: 'tg-bb-text', text: plural(n, 'Message', 'Messages') }),
        h('button', { class: 'tg-textbtn2', onclick: () => { const ms = selectedMsgs(); copy(ms.map(m => `${nameOf(m.role)}:\n${m.text}`).join('\n\n')); toast(`Copied ${plural(ms.length, 'message', 'messages')}`, 'copy'); stopSelect(); } }, icon('copy'), 'Copy'),
        h('button', { class: 'tg-textbtn2', onclick: () => openForward(selectedMsgs()) }, icon('forward'), 'Forward'),
        h('button', { class: 'tg-textbtn2 tg-danger', onclick: () => confirmDelete(selectedMsgs()) }, icon('trash'), 'Delete'));
    } else {
      const q = ($('.tg-h-search input', header) || {}).value || '';
      bottomBar.replaceChildren(
        h('span', { class: 'tg-bb-text', style: 'color:var(--tg-text-2);font-weight:400', text: !q.trim() ? 'Type to search this chat' : found.length ? `${foundIdx + 1} of ${found.length}` : 'No results' }),
        h('button', { class: 'tg-iconbtn', title: 'Older', onclick: () => { if (found.length) { foundIdx = (foundIdx + 1) % found.length; showFound(); } } }, icon('up')),
        h('button', { class: 'tg-iconbtn', title: 'Newer', onclick: () => { if (found.length) { foundIdx = (foundIdx + found.length - 1) % found.length; showFound(); } } }, icon('down')));
    }
  }
  function openMore(anchor) {
    const r = anchor.getBoundingClientRect();
    const c = C();
    const chat = pageKind() === 'chat' && convId() !== '_new';
    const showing = document.body.classList.contains('tg-show-deleted');
    const hiddenCount = Object.keys(c.h).length;
    const row0 = currentRow();
    const pinned = row0 && isRowPinned(row0);
    const items = [
      chat && { icon: S.notify ? 'bellOff' : 'bell', label: S.notify ? 'Mute' : 'Unmute', run: () => { setS('notify', !S.notify); toast(S.notify ? 'Notifications on' : 'Notifications muted', S.notify ? 'bell' : 'bellOff'); } },
      chat && { icon: 'select', label: 'Select Messages', run: () => { const m = MSGS[MSGS.length - 1]; m && startSelect(m); } },
      !chat && pageKind() === 'chat' && { icon: 'timer', label: 'Temporary Chat', run: G.tempChat },
      chat && { icon: 'share', label: 'Share Chat', run: () => G.convMenu('share-button') },
      chat && { icon: 'files', label: 'Files in This Chat', run: () => G.convMenu('studio-sidebar-button') },
      chat && { icon: pinned ? 'unpin' : 'pin', label: pinned ? 'Unpin Chat' : 'Pin Chat', run: () => G.convMenu('pin-button') },
      chat && { icon: 'edit', label: 'Rename', run: () => G.convMenu('rename-button') },
      chat && { icon: 'download', label: 'Download PDF', run: () => G.convMenu('download-pdf-button') },
      chat && { icon: 'doc', label: 'Export to Docs', run: () => G.convMenu('export-to-docs-button') },
      hiddenCount && { icon: 'eye', label: showing ? 'Hide Deleted Messages' : `Show Deleted Messages (${hiddenCount})`, run: () => document.body.classList.toggle('tg-show-deleted') },
      hiddenCount && { icon: 'redo', label: 'Restore Deleted Messages', run: () => { c.h = {}; save(); scan(); toast('Messages restored', 'redo'); } },
      (Object.keys(c.r).length || c.p.length) && { icon: 'broom', label: 'Clear Reactions and Pins', run: () => { c.r = {}; c.p = []; save(); scan(); toast('Cleared for this chat', 'broom'); } },
      chat && '-',
      chat && { icon: 'trash', label: 'Delete Chat', danger: true, run: () => G.convMenu('delete-button') },
    ];
    popup((wrap, close) => wrap.append(menuList(items, close)), r.right, r.bottom + 4, { alignRight: true });
  }

  /* =====================================================================
     Right column: chat info
     ===================================================================== */
  let rightPanel = null, rightTab = 'media';
  function toggleInfo(force) {
    const open = force != null ? force : !(rightPanel && rightPanel.classList.contains('tg-open'));
    if (!rightPanel) { rightPanel = h('aside', { id: 'tg-right', class: 'tg-ui' }); document.body.append(rightPanel); }
    if (open) renderInfo();
    rightPanel.classList.toggle('tg-open', open);
    document.documentElement.style.setProperty('--tg-right-w', open && innerWidth > 1100 ? '400px' : '0px');
    schedule();
  }
  function renderInfo() {
    if (!rightPanel) return;
    const id = convId(), title = currentTitle();
    const chat = pageKind() === 'chat' && id !== '_new';
    const row0 = currentRow();
    const head = h('div', { class: 'tg-panel-head' }, h('button', { class: 'tg-iconbtn', title: 'Close', onclick: () => toggleInfo(false) }, icon('close')),
      h('h2', { text: chat ? 'Chat Info' : 'Bot Info' }),
      chat ? h('button', { class: 'tg-iconbtn', title: 'Rename', onclick: () => G.convMenu('rename-button') }, icon('edit')) : null);
    const av = chat ? avatar(title, id) : botAvatar();
    av.style.width = av.style.height = '120px'; av.style.fontSize = '46px';
    const gen = isGenerating();
    const url = chat ? location.origin + location.pathname : 'https://gemini.google.com/app';
    const media = $$('user-query img, model-response img').filter(i => i.naturalWidth > 64 && !i.closest('.tg-ui') && !/avatar|logo|favicon|sparkle/i.test(i.className + i.alt));
    const links = [...new Set($$('model-response .markdown a[href^="http"], user-query a[href^="http"]').map(a => a.href))];
    const files = $$('user-query-file-preview, .file-preview-container [title], .attachment-container').map(f => (f.getAttribute('title') || f.textContent || '').trim()).filter(Boolean);
    const body = h('div', { class: 'tg-panel-body' },
      h('div', { class: 'tg-prof' }, av, h('div', { class: 'tg-prof-name', text: chat ? title : 'Gemini' }),
        h('div', { class: 'tg-prof-status' + (gen ? ' tg-typing tg-dots' : ''), text: gen ? 'typing' : chat ? `bot · ${plural(MSGS.length, 'message', 'messages')}` : 'bot' })),
      card(
        row({ icon: 'info', label: 'Gemini, your AI assistant from Google. Ask anything, share photos and files, or pick a prompt to start.', sub: 'Info' }),
        row({ icon: 'link', label: url.replace(/^https:\/\//, ''), sub: 'Link', run: () => { copy(url); toast('Link copied to clipboard', 'link'); } }),
        chat && DB.chats[id] && DB.chats[id].ts ? row({ icon: 'clock', label: new Date(DB.chats[id].ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }), sub: 'Last message' }) : null,
        row({ icon: 'bell', label: 'Notifications', toggle: S.notify, run: on => setS('notify', on) })),
      chat ? card(
        row({ icon: 'share', label: 'Share Chat', run: () => G.convMenu('share-button') }),
        row({ icon: 'files', label: 'Files in This Chat', run: () => G.convMenu('studio-sidebar-button') }),
        row({ icon: row0 && isRowPinned(row0) ? 'unpin' : 'pin', label: row0 && isRowPinned(row0) ? 'Unpin Chat' : 'Pin Chat', run: () => G.convMenu('pin-button') }),
        row({ icon: 'download', label: 'Download PDF', run: () => G.convMenu('download-pdf-button') }),
        row({ icon: 'doc', label: 'Export to Docs', run: () => G.convMenu('export-to-docs-button') }),
        row({ icon: 'select', label: 'Select Messages', run: () => { toggleInfo(false); const m = MSGS[MSGS.length - 1]; m && startSelect(m); } }),
        row({ icon: 'trash', label: 'Delete Chat', danger: true, run: () => G.convMenu('delete-button') })) : card(
        row({ icon: 'timer', label: 'Temporary Chat', run: G.tempChat })),
      chat ? (() => {
        const tabs = h('div', { class: 'tg-tabs' });
        const pane = h('div');
        const show = t => {
          rightTab = t;
          $$('button', tabs).forEach(b => b.classList.toggle('tg-on', b.dataset.t === t));
          if (t === 'media') pane.replaceChildren(media.length ? h('div', { class: 'tg-media' }, media.map(i => h('img', { src: i.currentSrc || i.src, alt: '', onclick: () => { i.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }))) : h('div', { class: 'tg-empty-note', text: 'No photos in this chat yet' }));
          if (t === 'links') pane.replaceChildren(links.length ? card(links.map(u => row({ icon: 'link', label: u.replace(/^https?:\/\//, '').slice(0, 80), sub: (() => { try { return new URL(u).hostname; } catch (e) { return ''; } })(), run: () => window.open(u, '_blank', 'noopener') }))) : h('div', { class: 'tg-empty-note', text: 'No links in this chat yet' }));
          if (t === 'files') pane.replaceChildren(files.length ? card(files.map(f => row({ icon: 'files', label: f.slice(0, 80) }))) : h('div', { class: 'tg-empty-note', text: 'No files in this chat yet' }));
        };
        for (const [t, l] of [['media', 'Media'], ['files', 'Files'], ['links', 'Links']]) tabs.append(h('button', { 'data-t': t, onclick: () => show(t), text: l }));
        show(rightTab);
        return h('div', { class: 'tg-card', style: 'padding:0' }, tabs, pane);
      })() : null);
    rightPanel.replaceChildren(head, body);
  }

  /* =====================================================================
     Messages: menu, reactions, reply, forward, pin, select, delete, translate
     ===================================================================== */
  let MSGS = [];
  const byKey = k => MSGS.find(m => m.key === k);
  function react(msg, emoji, fromUser = true) {
    const c = C();
    const cur = c.r[msg.key];
    if (cur === emoji) delete c.r[msg.key]; else c.r[msg.key] = emoji;
    save();
    if (fromUser && msg.role === 'm' && c.r[msg.key] && (emoji === '👍' || emoji === '👎')) {
      const b = msgBtn(msg, emoji === '👍' ? /good response|thumb.?up|like/i : /bad response|thumb.?down|dislike/i);
      b && b.click();
    }
    decorate(msg, true);
  }
  function openMessageMenu(msg, x, y, extra) {
    const c = C();
    const pinned = c.p.includes(msg.key);
    const has = re => !!msgBtn(msg, re);
    msg.el.classList.add('tg-row-active');
    popup((wrap, close) => {
      const bar = h('div', { class: 'tg-reactbar' });
      for (const e of QUICK) bar.append(h('button', { class: c.r[msg.key] === e ? 'tg-on' : '', title: e, onclick: ev => { ev.stopPropagation(); close(); react(msg, e); } }, e));
      const more = h('button', { class: 'tg-more', title: 'More reactions' }, icon('chevDown'));
      more.addEventListener('click', ev => {
        ev.stopPropagation();
        const grid = h('div', { class: 'tg-emojigrid' });
        for (const e of EMOJI) grid.append(h('button', { onclick: ev2 => { ev2.stopPropagation(); close(); react(msg, e); } }, e));
        menuEl.replaceWith(grid);
      });
      bar.append(more);
      const items = [];
      if (extra.selection) items.push({ icon: 'copy', label: 'Copy Selected Text', run: () => { copy(extra.selection); toast('Text copied to clipboard', 'copy'); } });
      if (extra.link) {
        items.push({ icon: 'newtab', label: 'Open Link', run: () => window.open(extra.link, '_blank', 'noopener') });
        items.push({ icon: 'link', label: 'Copy Link', run: () => { copy(extra.link); toast('Link copied to clipboard', 'link'); } });
      }
      items.push({ icon: 'reply', label: 'Reply', run: () => setContext({ type: 'reply', name: nameOf(msg.role), text: msg.text, key: msg.key }) });
      if (msg.role === 'u' && has(/edit/i)) items.push({ icon: 'edit', label: 'Edit', run: () => { const b = msgBtn(msg, /edit/i); b && b.click(); } });
      items.push({ icon: 'copy', label: 'Copy Text', run: () => { copy(msg.text); toast('Text copied to clipboard', 'copy'); } });
      items.push({ icon: 'translate', label: 'Translate', run: () => openTranslate(msg) });
      if (msg.role === 'm' && has(/listen|read aloud|text.?to.?speech|tts/i)) items.push({ icon: 'speaker', label: 'Read Aloud', run: () => { const b = msgBtn(msg, /listen|read aloud|text.?to.?speech|tts/i); b && b.click(); } });
      items.push({ icon: pinned ? 'unpin' : 'pin', label: pinned ? 'Unpin' : 'Pin', run: () => togglePin(msg) });
      items.push({ icon: 'forward', label: 'Forward', run: () => openForward([msg]) });
      if (msg.role === 'm' && has(/redo|regenerate|try again|retry/i)) items.push({ icon: 'redo', label: 'Regenerate', run: () => { const b = msgBtn(msg, /redo|regenerate|try again|retry/i); b && b.click(); } });
      if (msg.role === 'm' && has(/share|export/i)) items.push({ icon: 'share', label: 'Share', run: () => { const b = msgBtn(msg, /share|export/i); b && b.click(); } });
      items.push({ icon: 'select', label: 'Select', run: () => startSelect(msg) });
      items.push({ icon: 'trash', label: 'Delete', danger: true, run: () => confirmDelete([msg]) });
      const ts = msgTime(msg);
      if (ts) items.push('-', { foot: (msg.role === 'u' ? 'Sent ' : 'Received ') + new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) });
      const menuEl = menuList(items, close);
      wrap.append(bar, menuEl);
    }, x, y - 56, { onClose: () => msg.el.classList.remove('tg-row-active') });
  }
  function togglePin(msg) {
    const c = C();
    const i = c.p.indexOf(msg.key);
    if (i >= 0) { c.p.splice(i, 1); toast('Message unpinned', 'unpin'); } else { c.p.push(msg.key); c.s[msg.key] = snip(msg.text, 140); pinIndex = c.p.length - 1; toast('Message pinned', 'pin'); }
    save(); scan();
  }
  function confirmDelete(msgs) {
    const n = msgs.length;
    modal((box, close) => {
      box.append(
        h('h3', {}, h('span', { class: 'tg-avatar tg-bot', style: 'width:32px;height:32px' }, icon('spark')), n > 1 ? `Delete ${n} messages` : 'Delete message'),
        h('p', { text: n > 1 ? 'Are you sure you want to delete these messages?' : 'Are you sure you want to delete this message?' }),
        h('p', { style: 'font-size:14px;color:var(--tg-text-2)', text: "Gemini can't remove single messages from its history, so they are hidden on this device. Bring them back from ⋮ → Show Deleted Messages." }),
        h('div', { class: 'tg-actions' },
          h('button', { class: 'tg-textbtn', onclick: close, text: 'Cancel' }),
          h('button', { class: 'tg-textbtn tg-danger', text: 'Delete', onclick: () => {
            const c = C(); msgs.forEach(m => { c.h[m.key] = 1; }); save(); close(); stopSelect(); scan();
            toast(n > 1 ? `${n} messages deleted` : 'Message deleted', 'trash');
          } })));
    });
  }
  async function translateText(text) {
    const target = CONFIG.translateTo;
    const T = W.Translator || window.Translator, LD = W.LanguageDetector || window.LanguageDetector;
    if (!T || !LD) return null;
    try {
      const det = await LD.create();
      const res = await det.detect(text);
      const src = (res && res[0] && res[0].detectedLanguage) || 'en';
      if (src === target) return { text, same: true, src };
      const tr = await T.create({ sourceLanguage: src, targetLanguage: target });
      return { text: await tr.translate(text), src };
    } catch (e) { return null; }
  }
  function langName(code) { try { return new Intl.DisplayNames([CONFIG.translateTo], { type: 'language' }).of(code); } catch (e) { return code; } }
  function openTranslate(msg) {
    const text = msg.text;
    modal((box, close) => {
      box.classList.add('tg-translate');
      const out = h('div', { class: 'tg-tr-block', text: 'Translating…' });
      const label = h('div', { class: 'tg-tr-label', text: langName(CONFIG.translateTo) });
      const actions = h('div', { class: 'tg-actions' }, h('button', { class: 'tg-textbtn', onclick: close, text: 'Close' }));
      box.append(h('h3', {}, icon('translate'), 'Translate'),
        h('div', { class: 'tg-tr-label', style: 'color:var(--tg-text-2)', text: 'Original' }), h('div', { class: 'tg-tr-block', text: snip(text, 1500) }),
        label, out, actions);
      translateText(text).then(r => {
        if (r) {
          setText(out, r.text);
          setText(label, r.same ? `Already in ${langName(r.src)}` : `${langName(r.src)} → ${langName(CONFIG.translateTo)}`);
          actions.prepend(h('button', { class: 'tg-textbtn', text: 'Copy', onclick: () => { copy(r.text); toast('Text copied to clipboard', 'copy'); } }));
        } else {
          setText(out, "Your browser doesn't have built-in translation here. Pick another way:");
          actions.prepend(
            h('button', { class: 'tg-textbtn', text: 'Google Translate', onclick: () => window.open('https://translate.google.com/?sl=auto&tl=' + CONFIG.translateTo + '&op=translate&text=' + encodeURIComponent(text.slice(0, 4500)), '_blank', 'noopener') }),
            h('button', { class: 'tg-textbtn', text: 'Ask Gemini', onclick: () => {
              close();
              setContext({ type: 'reply', name: nameOf(msg.role), text, key: msg.key });
              insertText('Translate this message into ' + langName(CONFIG.translateTo) + '.', false);
              sendWithContext();
            } }));
        }
      });
    });
  }

  /* reply / forward context + sending */
  let ctx = null, bypass = false;
  function setContext(c) { ctx = c; renderReplyBar(); const e = editor(); e && e.focus(); }
  function clearContext() { ctx = null; renderReplyBar(); }
  function renderReplyBar() {
    let bar = $('#tg-replybar');
    const host = $('input-area-v2');
    if (!ctx) { if (bar) { bar.classList.remove('tg-show'); bar.dataset.v = ''; } return; }
    if (!host) return;
    if (!bar || !bar.isConnected || bar.nextElementSibling !== host) {
      bar && bar.remove();
      bar = h('div', { id: 'tg-replybar', class: 'tg-ui' });
      host.parentElement.insertBefore(bar, host);
    }
    const fwd = ctx.type === 'forward';
    const sigv = JSON.stringify(ctx);
    if (bar.dataset.v === sigv && bar.classList.contains('tg-show')) return;
    bar.dataset.v = sigv;
    const title = fwd ? (ctx.items.length > 1 ? `Forward ${ctx.items.length} messages` : `Forward message from ${ctx.items[0].name}`) : `Reply to ${ctx.name}`;
    const text = fwd ? ctx.items.map(i => snip(i.text, 60)).join(' · ') : snip(ctx.text, 120);
    bar.replaceChildren(...[
      icon(fwd ? 'forward' : 'reply'),
      h('div', { class: 'tg-rb-text', onclick: () => { if (!fwd) jumpTo(ctx.key); } }, h('div', { class: 'tg-rb-title', text: title }), h('div', { class: 'tg-rb-snip', text })),
      h('button', { class: 'tg-iconbtn', title: 'Cancel', onclick: clearContext }, icon('close'))]);
    bar.classList.add('tg-show');
  }
  function placeCaret(atStart) {
    const ed = editor(); if (!ed) return null;
    ed.focus();
    const sel = getSelection(), r = document.createRange();
    if (atStart) { const first = ed.firstElementChild || ed; r.setStart(first, 0); r.collapse(true); } else { r.selectNodeContents(ed); r.collapse(false); }
    sel.removeAllRanges(); sel.addRange(r);
    return ed;
  }
  function insertText(text, atStart) {
    if (!placeCaret(atStart)) return false;
    const lines = text.split('\n');
    lines.forEach((ln, i) => {
      if (ln) document.execCommand('insertText', false, ln);
      if (i < lines.length - 1 || atStart) document.execCommand('insertParagraph');
    });
    return true;
  }
  function contextPrefix() {
    if (!ctx) return '';
    if (ctx.type === 'reply') return `↩ ${ctx.name}\n> ${snip(ctx.text, 300)}`;
    if (ctx.items.length === 1) return `↪ Forwarded from ${ctx.items[0].name}\n` + ctx.items[0].text.slice(0, 6000).split('\n').map(l => '> ' + l).join('\n');
    return `↪ Forwarded ${ctx.items.length} messages\n` + ctx.items.map(i => `> ${i.name}: ${snip(i.text, 1200)}`).join('\n');
  }
  function sendWithContext() {
    const prefix = contextPrefix();
    if (prefix) insertText(prefix, true);
    clearContext();
    noteSend();
    let tries = 0;
    const go = () => {
      const b = sendButton();
      if (b) { bypass = true; try { b.click(); } finally { bypass = false; } return; }
      if (++tries < 20) setTimeout(go, 80); else toast('Press Enter to send', 'forward');
    };
    setTimeout(go, 120);
  }
  function openForward(msgs) {
    const items = msgs.map(m => ({ name: nameOf(m.role), text: m.text }));
    modal((box, close) => {
      const list = h('div', { class: 'tg-modal-body' });
      const input = h('input', { placeholder: 'Search', spellcheck: 'false' });
      const render = () => {
        const q = input.value.toLowerCase();
        list.replaceChildren();
        const rows = [{ title: 'New Chat', id: '_new', go: () => G.newChat() }].concat(sidebarRows().map(r => ({ title: r.title, id: r.id, go: () => { if (r.id !== convId()) r.a.click(); } })));
        for (const r of rows) {
          if (q && !r.title.toLowerCase().includes(q)) continue;
          list.append(h('div', { class: 'tg-chatpick', onclick: () => {
            close(); stopSelect();
            ctx = { type: 'forward', items };
            r.go();
            setTimeout(renderReplyBar, 60);
          } }, r.id === '_new' ? botAvatar() : avatar(r.title, r.id), h('span', { text: r.title })));
        }
      };
      input.addEventListener('input', render);
      box.append(h('h3', { text: 'Forward to…' }), h('label', { class: 'tg-search' }, icon('search'), input), list,
        h('div', { class: 'tg-actions' }, h('button', { class: 'tg-textbtn', onclick: close, text: 'Cancel' })));
      render();
    });
  }
  const selected = new Set();
  function startSelect(msg) { selected.clear(); selected.add(msg.key); document.body.classList.add('tg-selecting'); scan(); }
  function stopSelect() { selected.clear(); document.body.classList.remove('tg-selecting'); scan(); }
  const selectedMsgs = () => MSGS.filter(m => selected.has(m.key));
  function jumpTo(key, quoteText) {
    let m = byKey(key);
    if (!m && quoteText) { const q = quoteText.replace(/…$/, '').slice(0, 60).toLowerCase(); m = MSGS.find(x => x.text.replace(/\s+/g, ' ').toLowerCase().includes(q)); }
    if (!m) { toast('Message not loaded — scroll up to load older messages', 'info'); return; }
    m.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    m.el.classList.remove('tg-flash'); void m.el.offsetWidth; m.el.classList.add('tg-flash');
    setTimeout(() => m.el.classList.remove('tg-flash'), 1700);
  }

  /* =====================================================================
     Chat list rows
     ===================================================================== */
  function isRowPinned(r) {
    return !!(r.item.closest('[data-test-id*="pinned" i], .pinned-conversations') ||
      $$('mat-icon, gem-icon', r.item).some(i => /keep|push_pin|pinned/i.test((i.getAttribute('fonticon') || '') + ' ' + (i.textContent || '') + ' ' + (i.getAttribute('data-mat-icon-name') || ''))));
  }
  function decorateSidebar(gen) {
    buildSideHead();
    buildFab();
    renderSearchExtras();
    const cur = convId();
    const rows = sidebarRows();
    for (const r of rows) safe('row', () => {
      let av = $(':scope > .tg-avatar', r.a);
      if (!av) { av = avatar(r.title, r.id || r.title, 'tg-row-av'); r.a.prepend(av); } else updateAvatar(av, r.title, r.id || r.title);
      const content = $('.mdc-list-item__content', r.a) || r.a;
      let sub = $(':scope > .tg-row-sub', content);
      if (!sub) { sub = h('span', { class: 'tg-row-sub tg-ui' }, h('span', { class: 'tg-row-preview' })); content.append(sub); }
      let dt = $(':scope > .tg-row-date', r.a);
      if (!dt) { dt = h('span', { class: 'tg-row-date tg-ui' }); r.a.append(dt); }
      const on = isActiveRow(r);
      r.a.classList.toggle('tg-row-on', on);
      const p = r.id && DB.prev[r.id];
      const chat = r.id && DB.chats[r.id];
      const typing = gen && r.id && r.id === cur;
      const pv = $('.tg-row-preview', sub);
      pv.classList.toggle('tg-typing', !!typing);
      pv.classList.toggle('tg-dots', !!typing);
      const pvText = typing ? 'typing' : p ? p.t : '';
      const pvKey = (typing ? 't' : '') + (p ? p.r + p.t : '');
      if (pv.dataset.v !== pvKey) {
        pv.dataset.v = pvKey;
        if (!typing && p && p.r === 'u') pv.replaceChildren(h('b', { text: 'You: ' }), p.t); else setText(pv, pvText || ' ');
      }
      if (!p && r.id) wantPreview(r.id);
      const ts = Math.max((chat && chat.ts) || 0, (p && p.ts) || 0);
      const dstr = ts ? fmtListDate(ts) : '';
      const sent = p && p.r === 'u';
      if (dt.dataset.v !== dstr + sent) {
        dt.dataset.v = dstr + sent;
        dt.replaceChildren(...(sent && dstr ? [icon('ticks')] : []), dstr);
      }
      const n = (r.id && DB.unread[r.id]) || 0;
      const pinned = isRowPinned(r);
      let badge = $(':scope > .tg-row-badge', sub), pinI = $(':scope > .tg-row-pin', sub);
      if (n && !on) { if (!badge) { badge = h('span', { class: 'tg-row-badge' }); sub.append(badge); } setText(badge, String(n)); } else if (badge) badge.remove();
      if (pinned && !(n && !on)) { if (!pinI) { pinI = icon('pin'); pinI.classList.add('tg-row-pin'); sub.append(pinI); } } else if (pinI) pinI.remove();
      r.item.classList.toggle('tg-filtered', !!sideQuery && !r.title.toLowerCase().includes(sideQuery));
    });
  }
  function openRowMenu(row, x, y) {
    const pinned = isRowPinned(row);
    const n = (row.id && DB.unread[row.id]) || 0;
    row.a.classList.add('tg-row-ctx');
    popup((wrap, close) => wrap.append(menuList([
      { icon: 'newtab', label: 'Open in New Tab', run: () => window.open(row.a.href, '_blank') },
      { icon: pinned ? 'unpin' : 'pin', label: pinned ? 'Unpin' : 'Pin', run: () => G.rowMenu(row, 'pin-button') },
      { icon: 'edit', label: 'Rename', run: () => G.rowMenu(row, 'rename-button') },
      { icon: 'share', label: 'Share', run: () => G.rowMenu(row, 'share-button') },
      row.id && { icon: n ? 'chat' : 'unread', label: n ? 'Mark as Read' : 'Mark as Unread', run: () => { if (n) delete DB.unread[row.id]; else DB.unread[row.id] = 1; save(); scan(); } },
      { icon: 'trash', label: 'Delete Chat', danger: true, run: () => G.rowMenu(row, 'delete-button') },
    ], close)), x, y, { onClose: () => row.a.classList.remove('tg-row-ctx') });
  }

  /* =====================================================================
     Message box additions
     ===================================================================== */
  let savedRange = null;
  document.addEventListener('selectionchange', () => {
    const s = getSelection();
    if (s.rangeCount && s.anchorNode && s.anchorNode.parentElement && s.anchorNode.parentElement.closest('.ql-editor')) savedRange = s.getRangeAt(0).cloneRange();
  }, L);
  function decorateComposer() {
    const field = $('input-area-v2 .text-input-field');
    if (field && !$(':scope > .tg-emoji-btn', field)) {
      $$('.tg-emoji-btn', field).forEach(b => b.remove());
      const btn = h('button', { class: 'tg-iconbtn tg-composer-btn tg-emoji-btn tg-ui', title: 'Emoji', type: 'button' }, icon('smile'));
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', e => { e.stopPropagation(); openEmojiPanel(btn); });
      field.append(btn);
    }
    if (ctx) renderReplyBar();
  }
  function openEmojiPanel(btn) {
    const r = btn.getBoundingClientRect();
    popup(wrap => {
      const grid = h('div', { class: 'tg-emojigrid' });
      for (const e of EMOJI) {
        const b = h('button', { text: e });
        b.addEventListener('mousedown', ev => ev.preventDefault());
        b.addEventListener('click', ev => {
          ev.stopPropagation();
          const ed = editor(); if (!ed) return;
          ed.focus();
          const s = getSelection();
          if (savedRange && ed.contains(savedRange.startContainer)) { s.removeAllRanges(); s.addRange(savedRange); } else placeCaret(false);
          document.execCommand('insertText', false, e);
          savedRange = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
        });
        grid.append(b);
      }
      wrap.append(grid);
    }, r.left, r.top - 8, { above: true });
  }

  /* =====================================================================
     Per-message decoration: time, ticks, reactions, quotes, date chips
     ===================================================================== */
  // live send times, keyed by the prompt text (Gemini swaps the message elements once the reply lands)
  const liveBySig = {}, firstSeen = new WeakMap();
  let lastSent = null, lastConv = null;
  function normSig(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 400); }
  function noteSend() { lastSent = { t: Date.now(), sig: normSig(editorText()) }; }
  function msgTime(msg) {
    const live = liveBySig[msg.usig];
    return (msg.rid && DB.ts[msg.rid]) || (live && (msg.role === 'u' ? live.u : live.m)) || C().t[msg.key] || 0;
  }
  function metaHost(msg, gen) {
    if (msg.role === 'u') {
      const lines = $$('.query-text-line', msg.el).filter(l => !l.classList.contains('tg-hidden') && (l.textContent || '').trim());
      return lines[lines.length - 1] || $('.query-text', msg.el) || msg.bubble;
    }
    if (gen) return null;
    const md = $('.markdown', msg.el);
    if (!md) return null;
    let last = md.lastElementChild;
    while (last && last.classList.contains('tg-meta')) last = last.previousElementSibling;
    if (!last) return null;
    return last.tagName === 'P' ? last : null;
  }
  function decorate(msg, pop) {
    const c = C();
    const { el, bubble, role, key } = msg;
    el.classList.toggle('tg-deleted', !!c.h[key]);
    el.classList.toggle('tg-selected', selected.has(key));
    if (!bubble || (bubble === el && role === 'm' && !$('.markdown', el))) return;

    if (role === 'u') {
      const u = userText(el);
      const p = u.parsed;
      const q = $('.query-text', el) || bubble;
      let block = $(':scope > .tg-quote, :scope > .tg-fwd', q);
      if (p.kind) {
        const sig = u.sig;
        if (!block || block.dataset.sig !== sig) {
          block && block.remove();
          if (p.kind === 'reply') {
            block = h('span', { class: 'tg-quote', 'data-sig': sig, onclick: ev => { ev.stopPropagation(); jumpTo(null, p.quote.join(' ')); } },
              h('span', { class: 'tg-q-name', text: p.name }), h('span', { class: 'tg-q-text', text: p.quote.join(' ') }));
          } else {
            block = h('span', { class: 'tg-fwd', 'data-sig': sig },
              h('span', { class: 'tg-fwd-head' }, 'Forwarded from ', h('i', { text: p.name })),
              h('span', { class: 'tg-fwd-body', text: p.quote.join('\n') }));
          }
          q.prepend(block);
        }
        u.raw.forEach((r, i) => r.el && r.el.classList.toggle('tg-hidden', i < p.used));
        const firstBody = u.raw[p.used];
        u.raw.forEach(r => r.el && r.el.classList.toggle('tg-fwd-comment', p.kind === 'forward' && r === firstBody));
      } else if (block) block.remove();
    }

    // reactions
    let reacts = $(':scope > .tg-reacts', bubble);
    const emo = c.r[key];
    if (emo) {
      if (!reacts) { reacts = h('div', { class: 'tg-reacts tg-ui' }); bubble.append(reacts); }
      if (reacts.dataset.e !== emo) {
        reacts.dataset.e = emo;
        const pill = h('button', { class: 'tg-react' + (pop ? ' tg-pop' : ''), title: 'Remove reaction', onclick: ev => { ev.stopPropagation(); react(msg, emo, false); } }, emo, h('b', { text: '1' }));
        reacts.replaceChildren(pill);
      }
    } else if (reacts) reacts.remove();

    // time, pin and ticks
    const gen = role === 'm' && msg.last && msg.generating;
    let meta = $('.tg-meta', el);
    if (!meta) meta = h('span', { class: 'tg-meta' }, h('span', { class: 'tg-meta-in' }, h('b'), h('i')));
    const host = metaHost(msg, gen);
    const block = !host || !!emo;
    meta.classList.toggle('tg-block', block);
    const target = block ? bubble : host;
    if (meta.parentElement !== target || target.lastChild !== meta) target.append(meta);
    $$('.tg-meta', el).forEach(m => { if (m !== meta) m.remove(); });
    const ts = msgTime(msg);
    const tstr = ts ? fmtTime(ts) : '';
    if (meta.dataset.time !== tstr) { meta.dataset.time = tstr; meta.firstChild.dataset.time = tstr; }
    meta.classList.toggle('tg-pinned', c.p.includes(key));
    meta.classList.toggle('tg-read', role === 'u' && !!msg.answered);
    meta.style.display = (tstr || role === 'u' || c.p.includes(key)) ? '' : 'none';
    fitTime(meta, role === 'u' ? bubble : null);
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
  // Telegram shows the day of the top message in a floating chip while you scroll
  let floatEl = null, floatTimer = 0;
  function floatDate(s) {
    if (!floatEl || !floatEl.isConnected) { floatEl = h('div', { id: 'tg-float-date', class: 'tg-ui' }); document.body.append(floatEl); }
    const sr = s.getBoundingClientRect();
    const m = MSGS.find(x => !x.el.classList.contains('tg-deleted') && x.el.getBoundingClientRect().bottom > sr.top + 30);
    const ts = m && msgTime(m);
    if (!ts) { floatEl.classList.remove('tg-show'); return; }
    const chipAtTop = $$('.tg-date').some(c => { const r = c.getBoundingClientRect(); return r.top >= sr.top - 4 && r.top < sr.top + 44; });
    setText(floatEl, fmtDay(ts));
    floatEl.style.left = Math.round(sr.left + sr.width / 2) + 'px';
    floatEl.classList.toggle('tg-show', !chipAtTop);
    clearTimeout(floatTimer);
    floatTimer = setTimeout(() => floatEl.classList.remove('tg-show'), 1200);
  }
  function decorateDates() {
    let lastDay = null;
    const c = C();
    for (const m of MSGS) {
      if (m.role !== 'u') continue;
      const turn = m.turn || m.el;
      const ts = msgTime(m);
      let chip = $(':scope > .tg-date', turn);
      const label = ts ? fmtDay(ts) : null;
      if (label && label !== lastDay && !c.h[m.key]) {
        if (!chip) { chip = h('div', { class: 'tg-date tg-ui' }, h('span')); turn.prepend(chip); }
        setText(chip.firstChild, label);
      } else if (chip) chip.remove();
      if (label) lastDay = label;
    }
  }

  /* =====================================================================
     Main loop
     ===================================================================== */
  let wasGenerating = false, scanTimer = 0, lastScan = 0, hiddenUnread = 0;
  function schedule() {
    if (scanTimer || disposed) return;
    const wait = Math.max(0, 160 - (Date.now() - lastScan));
    scanTimer = setTimeout(() => { scanTimer = 0; scan(); }, wait);
  }
  // each step runs on its own, so one surprise in Gemini's page can't stop the rest
  const warned = {};
  function safe(name, fn) {
    try { return fn(); } catch (e) { if (!warned[name]) { warned[name] = 1; console.warn('[Gemini·Telegram] ' + name + ':', e); } return undefined; }
  }
  function scan() {
    if (disposed) return;
    lastScan = Date.now();
    if (!document.body) return;
    document.body.classList.add('tg-on');
    applyVars();
    if (!header || !header.isConnected) buildHeader();

    const id = convId();
    if (lastConv !== id) safe('switch', () => {
      if (lastConv === '_new' && id !== '_new' && DB.c._new) {
        const n = DB.c._new, t = C(id);
        Object.assign(t.r, n.r); Object.assign(t.h, n.h); Object.assign(t.t, n.t); Object.assign(t.s, n.s); t.p.push(...n.p);
        delete DB.c._new; save();
      }
      if (lastConv && id !== lastConv) { closeSearch(); if (document.body.classList.contains('tg-selecting')) stopSelect(); unread = 0; if (rightPanel && rightPanel.classList.contains('tg-open')) setTimeout(renderInfo, 400); }
      if (DB.unread[id]) { delete DB.unread[id]; save(); }
    });
    if (lastConv !== id) { lastConv = id; pinIndex = Math.max(0, C().p.length - 1); }
    MSGS = safe('read', getMessages) || [];
    // a fresh new chat starts clean (temporary chats never get an id, so their pins would pile up)
    if (id === '_new' && !MSGS.length && DB.c._new && (DB.c._new.p.length || Object.keys(DB.c._new.r).length || Object.keys(DB.c._new.h).length)) { delete DB.c._new; save(); }
    const c = C();
    const gen = !!safe('gen', isGenerating);
    let dirty = false;

    // send times for messages sent and received while the page is open
    safe('times', () => {
      const now = Date.now();
      const lastU = [...MSGS].reverse().find(m => m.role === 'u');
      if (lastSent && now - lastSent.t > 120e3) lastSent = null;
      MSGS.forEach((m, i) => {
        m.last = i === MSGS.length - 1;
        m.generating = gen;
        m.answered = !!(MSGS[i + 1] && MSGS[i + 1].role === 'm') && !(gen && i === MSGS.length - 2);
        if (!firstSeen.has(m.el)) firstSeen.set(m.el, now);
        if (msgTime(m)) return;
        if (m.role === 'u' && lastSent && m === lastU) {
          const a = m.usig, b = lastSent.sig;
          const match = b ? (a === b || (a.length > 3 && (a.endsWith(b) || b.endsWith(a) || a.includes(b)))) : firstSeen.get(m.el) >= lastSent.t - 1000;
          if (match) (liveBySig[a] = liveBySig[a] || {}).u = lastSent.t;
        } else if (m.role === 'm' && m.last && i > 0) {
          const live = liveBySig[m.usig];
          if (live && live.u && !live.m && now - live.u < 10 * 60e3) {
            live.m = now;
            const s = scroller();
            if (s && s.scrollHeight - s.scrollTop - s.clientHeight > 400) unread++;
          }
        }
      });
      for (const m of MSGS) {
        const live = liveBySig[m.usig], t = live && (m.role === 'u' ? live.u : live.m);
        if (t && m.rid && !DB.ts[m.rid] && c.t[m.key] !== t) { c.t[m.key] = t; dirty = true; }
      }
    });

    safe('fetchTimes', () => {
      if (id === '_new' || gen) return;
      const missing = MSGS.filter(m => m.rid && !DB.ts[m.rid] && !msgTime(m));
      if (missing.length) wantTimes(id, new Set(MSGS.map(m => m.rid)).size);
    });
    for (const m of MSGS) safe('message', () => decorate(m));
    safe('dates', decorateDates);

    // chat-list preview for this chat
    safe('preview', () => {
      if (id === '_new' || !MSGS.length) return;
      const last = [...MSGS].reverse().find(m => !c.h[m.key]);
      if (!last || (gen && last.role !== 'u')) return;
      const t = snip(cleanMd(last.text), 90), ts = msgTime(last) || (DB.prev[id] && DB.prev[id].ts) || null;
      const p = DB.prev[id];
      if (t && (!p || p.t !== t || p.r !== last.role || (ts && p.ts !== ts))) { DB.prev[id] = { t, r: last.role, ts }; dirty = true; }
      if (ts) { const ch = DB.chats[id] || (DB.chats[id] = {}); if (!ch.ts || ts > ch.ts) { ch.ts = ts; dirty = true; } }
    });
    if (dirty) save();

    const kind = pageKind();
    document.body.classList.toggle('tg-page', kind !== 'chat');
    const title = safe('title', currentTitle) || 'Gemini';
    let left = 0, rightW = 0;

    safe('header', () => {
      const side = $('bard-sidenav');
      const sideW = side ? side.getBoundingClientRect() : null;
      const sideOpen = !!(sideW && sideW.width > 120 && sideW.right > 120);
      rightW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tg-right-w'), 10) || 0;
      left = sideOpen ? Math.round(sideW.right) : 0;
      setStyle(header, 'left', left + 'px');
      setStyle(header, 'right', rightW + 'px');
      setText($('.tg-h-title', header), title);
      const av = $('.tg-h-av', header);
      const newChat = kind === 'chat' && id === '_new';
      const pi = kind !== 'chat' ? pageInfo() : null;
      const avKind = pi ? 'page:' + pi.icon : (newChat || kind !== 'chat') ? 'bot' : 'chat';
      if (av.dataset.kind !== avKind) {
        let fresh;
        if (pi) fresh = h('span', { class: 'tg-avatar tg-h-av', style: `--av1:${pi.colors[0]};--av2:${pi.colors[1]}` }, icon(pi.icon));
        else if (avKind === 'bot') fresh = botAvatar('tg-h-av');
        else fresh = avatar(title, id, 'tg-h-av');
        fresh.dataset.kind = avKind;
        av.replaceWith(fresh);
      } else if (avKind === 'chat') updateAvatar(av, title, id);
      header.classList.toggle('tg-secret', !!$('chat-window.is-temporary-chat'));
      const st = $('.tg-h-status', header);
      st.classList.toggle('tg-typing', gen);
      st.classList.toggle('tg-dots', gen);
      setText(st, gen ? 'typing' : kind === 'chat' ? 'bot' : pi ? pi.status : 'Gemini');
      setStyle($('.tg-h-side', header), 'display', sideOpen ? 'none' : '');
      $('.tg-h-actions', header).style.visibility = kind === 'chat' ? '' : 'hidden';
    });

    // pinned message in the header
    safe('pins', () => {
      const pins = c.p;
      const pinEl = $('.tg-h-pin', header);
      pinEl.classList.toggle('tg-show', pins.length > 0 && kind === 'chat' && (innerWidth - left - rightW) > 640);
      if (!pins.length) return;
      pinIndex = Math.min(pinIndex, pins.length - 1);
      const k = pins[pinIndex];
      const live = byKey(k);
      setText($('.tg-pin-title', pinEl), pins.length > 1 ? `Pinned Message #${pinIndex + 1}` : 'Pinned Message');
      setText($('.tg-pin-snip', pinEl), live ? snip(live.text, 140) : (c.s[k] || ''));
    });

    // bottom bars (search results / selection) sit where the message box is; the ↓ button sits above it
    safe('bottom', () => {
      const box = $('input-area-v2 .text-input-field') || $('input-area-v2');
      const br = box ? box.getBoundingClientRect() : null;
      if (br && br.width && bottomBar) {
        setStyle(bottomBar, 'left', Math.round(br.left) + 'px');
        setStyle(bottomBar, 'width', Math.round(br.width + 64) + 'px');
        setStyle(bottomBar, 'top', Math.round(br.bottom - 56) + 'px');
      }
      renderBottomBar();
      const s = scroller();
      if (s && !s.dataset.tgScroll) { s.dataset.tgScroll = '1'; s.addEventListener('scroll', () => { schedule(); floatDate(s); }, { passive: true, signal: life.signal }); }
      const far = s ? s.scrollHeight - s.scrollTop - s.clientHeight > 400 : false;
      if (!far) unread = 0;
      downBtn.classList.toggle('tg-show', far && kind === 'chat');
      if (br && br.width) {
        setStyle(downBtn, 'left', Math.round(br.right + 64 - 54 + 1) + 'px');
        setStyle(downBtn, 'top', Math.round(br.top - 54 - 16) + 'px');
      }
      const badge = $('b', downBtn);
      badge.classList.toggle('tg-show', unread > 0); setText(badge, String(unread));
    });

    if (wasGenerating && !gen) safe('done', () => answerDone(title, id));
    wasGenerating = gen;

    safe('sidebar', () => decorateSidebar(gen));
    safe('composer', decorateComposer);
    safe('info', () => { if (rightPanel && rightPanel.classList.contains('tg-open') && rightPanel.dataset.conv !== id + gen) { rightPanel.dataset.conv = id + gen; renderInfo(); } });
  }
  function answerDone(title, id) {
    if (!document.hidden) return;
    const last = MSGS[MSGS.length - 1];
    const text = last ? snip(last.text, 140) : 'New message';
    if (id && id !== '_new') { DB.unread[id] = (DB.unread[id] || 0) + 1; save(); }
    hiddenUnread++;
    if (S.titleCount) document.title = `(${hiddenUnread}) ` + document.title.replace(/^\(\d+\)\s*/, '');
    if (S.sound) ding();
    if (!S.notify) return;
    try {
      if (typeof GM_notification === 'function') GM_notification({ title, text, timeout: 6000, onclick: () => window.focus() });
      else if (window.Notification && Notification.permission === 'granted') new Notification(title, { body: text });
    } catch (e) { /* ignore */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && hiddenUnread) {
      hiddenUnread = 0; document.title = document.title.replace(/^\(\d+\)\s*/, '');
      const id = convId(); if (DB.unread[id]) { delete DB.unread[id]; save(); schedule(); }
    }
  }, L);

  /* ---------- global listeners ---------- */
  function msgFromEvent(e) {
    const el = e.target.closest && e.target.closest('user-query, model-response');
    if (!el || e.target.closest('.tg-ui:not(.tg-reacts):not(.tg-meta)')) return null;
    return MSGS.find(m => m.el === el) || (scan(), MSGS.find(m => m.el === el));
  }
  document.addEventListener('contextmenu', e => {
    if (e.shiftKey || !document.body.classList.contains('tg-on')) return;
    const rowEl = e.target.closest && e.target.closest('gem-nav-list-item[data-test-id="conversation"]');
    if (rowEl) {
      const r = sidebarRows().find(x => x.item === rowEl);
      if (r) { e.preventDefault(); openRowMenu(r, e.clientX, e.clientY); }
      return;
    }
    if (e.target.closest('img, video, canvas, .ql-editor, input, textarea, .tg-ui')) return;
    const msg = msgFromEvent(e);
    if (!msg) return;
    e.preventDefault();
    const sel = String(getSelection() || '').trim();
    const inMsg = sel && msg.el.contains(getSelection().anchorNode);
    const a = e.target.closest('a[href]');
    openMessageMenu(msg, e.clientX, e.clientY, { selection: inMsg ? sel : '', link: a ? a.href : '' });
  }, LC);
  document.addEventListener('click', e => {
    if (document.body.classList.contains('tg-selecting') && !e.target.closest('.tg-ui')) {
      const msg = msgFromEvent(e);
      if (msg) {
        e.preventDefault(); e.stopPropagation();
        if (selected.has(msg.key)) selected.delete(msg.key); else selected.add(msg.key);
        if (!selected.size) stopSelect(); else scan();
        return;
      }
    }
    if (bypass) return;
    const b = e.target.closest && e.target.closest('button');
    if (b && b === sendButton() && !b.closest('.tg-ui')) {
      if (!ctx) noteSend();
      if (ctx) { e.preventDefault(); e.stopImmediatePropagation(); sendWithContext(); }
    }
    if (e.target.closest && e.target.closest('gem-nav-list-item[data-test-id="conversation"] a') && sideQuery) setTimeout(clearSideSearch, 50);
  }, LC);
  document.addEventListener('dblclick', e => {
    if (!S.quick || document.body.classList.contains('tg-selecting')) return;
    if (e.target.closest('a, pre, code, button, .tg-ui, .ql-editor')) return;
    const msg = msgFromEvent(e);
    if (!msg) return;
    getSelection().removeAllRanges();
    react(msg, S.quick);
  }, LC);
  window.addEventListener('keydown', e => {
    const inEditor = e.target.closest && e.target.closest('.ql-editor');
    if (e.key === 'Escape' && e.isTrusted) {
      if (closePopup) { closePopup(); return; }
      if (closeModal) { closeModal(); return; }
      if (document.body.classList.contains('tg-selecting')) { stopSelect(); return; }
      if (header && header.classList.contains('tg-searching')) { closeSearch(); return; }
      if (ctx) { clearContext(); return; }
      if (rightPanel && rightPanel.classList.contains('tg-open')) { toggleInfo(false); return; }
      if (panels.length) { closePanel(panels[panels.length - 1]); return; }
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && pageKind() === 'chat' && convId() !== '_new') { e.preventDefault(); openSearch(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && sideInput) { e.preventDefault(); sideInput.focus(); return; }
    if (!inEditor) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      if (!ctx) noteSend();
      if (ctx) { e.preventDefault(); e.stopImmediatePropagation(); sendWithContext(); }
    }
    if (e.key === 'ArrowUp' && !editorText().trim() && !ctx) {
      const last = [...MSGS].reverse().find(m => m.role === 'u');
      const b = last && msgBtn(last, /edit/i);
      if (b) { e.preventDefault(); b.click(); }
    }
  }, LC);
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
  // Remove everything this copy added, so a newer copy can take over the page.
  function dispose() {
    if (disposed) return;
    disposed = true;
    life.abort();
    try { styleKeeper.disconnect(); } catch (e) { /* ignore */ }
    if (mainObserver) mainObserver.disconnect();
    clearInterval(mainTimer); clearTimeout(scanTimer); clearTimeout(saveTimer);
    try { if (closePopup) closePopup(); if (closeModal) closeModal(); } catch (e) { /* ignore */ }
    if (W.__tgOnRpc === onRpcText) W.__tgOnRpc = null;
    $$('#tg-header, #tg-down, #tg-bottombar, #tg-right, #tg-fab, #tg-resizer, #tg-left, #tg-float-date, #tg-toast, #tg-replybar, #tg-search-extra, ' +
       '.tg-side-head, .tg-emoji-btn, .tg-menu.tg-sub, .tg-row-av, .tg-row-sub, .tg-row-date, .tg-meta, .tg-reacts, .tg-quote, .tg-fwd, .tg-date').forEach(e => e.remove());
    const marks = ['tg-row-on', 'tg-row-ctx', 'tg-filtered', 'tg-deleted', 'tg-selected', 'tg-found', 'tg-row-active', 'tg-flash', 'tg-hidden', 'tg-fwd-comment'];
    $$(marks.map(m => '.' + m).join(',')).forEach(e => e.classList.remove(...marks));
    $$('[data-tg-fit]').forEach(b => { b.style.minWidth = ''; delete b.dataset.tgFit; });
    $$('[data-tg-scroll]').forEach(s => delete s.dataset.tgScroll);
    if (styleEl) styleEl.remove();
    if (document.body) document.body.classList.remove('tg-on', 'tg-day', 'tg-page', 'tg-still', 'tg-hide-gemini-actions', 'tg-selecting', 'tg-bar-open', 'tg-ghost', 'tg-show-deleted', 'tg-resizing');
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, L);
})();
