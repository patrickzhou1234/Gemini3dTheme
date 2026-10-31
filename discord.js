// ==UserScript==
// @name         Gemini · Discord
// @namespace    gemini-discord-blurple
// @version      1.0.0
// @description  Makes Gemini look and work like Discord (2025 look): a server rail, your chats as #channels (or DMs), the channel header with pins, search and the member list, Discord messages with avatars, timestamps, reactions and replies, the hover toolbar and right-click menus, Discord's message box, user panel, Ctrl+K quick switcher and full-screen User Settings.
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
    accent:     '#5865f2', // Discord blurple: buttons, unread pills, mentions
    theme:      'sync',    // 'sync' (follows Gemini), 'light', 'ash', 'dark' or 'onyx'
    sideWidth:  240,       // channel list width in px (you can also drag its edge)
    channelNames: true,    // show chats as discord-style-channel-names
    memberList: true,      // show the member list on wide windows
    notify: true,          // notification when an answer finishes while the tab is in the background
    translateTo: (navigator.language || 'en').split('-')[0], // language for "Translate"
  };
  /* ========================================================================= */

  const VERSION = '1.0.0';
  const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
  const hasGM = typeof GM_getValue === 'function';
  const gmGet = (k, d) => {
    try { if (hasGM) return GM_getValue(k, d); } catch (e) { /* fall through */ }
    try { const v = localStorage.getItem('dc:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  };
  const gmSet = (k, v) => {
    try { if (typeof GM_setValue === 'function') { GM_setValue(k, v); return; } } catch (e) { /* fall through */ }
    try { localStorage.setItem('dc:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ }
  };

  const ON_KEY = 'dc_on';
  const enabled = gmGet(ON_KEY, true) !== false;
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand(enabled ? 'Switch to Gemini version' : 'Switch to Discord version', () => { gmSet(ON_KEY, !enabled); location.reload(); });
  }
  if (!enabled) return;

  // A newer copy loaded into the same page (an update being tried out) retires this one:
  // everything below listens with `L`/`LC`, so one abort() removes it all.
  const life = new AbortController();
  const L = { signal: life.signal }, LC = { capture: true, signal: life.signal };
  let disposed = false;
  try { W.dispatchEvent(new CustomEvent('dc-takeover')); } catch (e) { /* ignore */ }
  W.addEventListener('dc-takeover', () => dispose(), L);

  /* ---------- storage ---------- */
  const STORE = 'dc_gemini_data_v1';
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
    theme: CONFIG.theme, accent: CONFIG.accent, fontSize: 16, groupSpacing: 16, sideWidth: CONFIG.sideWidth,
    chanNames: CONFIG.channelNames, members: CONFIG.memberList, view: 'server', notify: CONFIG.notify, sound: true,
    titleCount: true, motion: true, previews: true, geminiButtons: false, sendBtn: false, devMode: false, quick: '',
    recent: ['👍', '❤️', '😂', '🔥'], status: 'online', notes: {}, collapsed: {},
  }, DB.set);
  function setS(k, v) { S[k] = v; DB.set[k] = v; save(); applyVars(); }
  const isLight = () => document.body.classList.contains('light-theme') && !document.body.classList.contains('dark-theme');
  const themeName = () => S.theme === 'sync' ? (isLight() ? 'light' : 'dark') : S.theme;
  function applyVars() {
    const r = document.documentElement;
    if (!r) return;
    r.style.setProperty('--dc-brand', S.accent);
    r.style.setProperty('--dc-msg', S.fontSize + 'px');
    r.style.setProperty('--dc-gap', S.groupSpacing + 'px');
    r.style.setProperty('--dc-side-w', Math.round(S.sideWidth) + 'px');
    const b = document.body;
    if (!b) return;
    const t = themeName();
    for (const n of ['light', 'ash', 'onyx']) b.classList.toggle('dc-' + n, t === n);
    b.classList.toggle('dc-still', !S.motion);
    b.classList.toggle('dc-hide-gemini-actions', !S.geminiButtons);
    b.classList.toggle('dc-send-btn', !!S.sendBtn);
    b.classList.toggle('dc-dm', S.view === 'dm');
    b.classList.toggle('dc-plain-names', !S.chanNames);
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
  W.__dcOnRpc = onRpcText;
  const toCurrent = text => { const fn = W.__dcOnRpc; if (typeof fn === 'function') fn(text); };
  (function hookNetwork() {
    try {
      const f = W.fetch;
      origFetch = (f && f.__dcOrig) || f;
      if (f && !f.__dcHook) {
        const wrapped = function (input) {
          const p = f.apply(W, arguments);
          try {
            const url = typeof input === 'string' ? input : (input && input.url) || String(input);
            if (url.indexOf('batchexecute') > -1 && RPC_RE.test(url)) p.then(r => r.clone().text()).then(toCurrent).catch(() => {});
          } catch (e) { /* ignore */ }
          return p;
        };
        wrapped.__dcHook = 1;
        wrapped.__dcOrig = f;
        W.fetch = wrapped;
      }
      const XP = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
      if (XP && !XP.__dcHook) {
        const open = XP.open, send = XP.send;
        XP.open = function (m, u) { try { this.__dcu = String(u); } catch (e) { /* ignore */ } return open.apply(this, arguments); };
        XP.send = function () {
          try { if (this.__dcu && this.__dcu.indexOf('batchexecute') > -1 && RPC_RE.test(this.__dcu)) this.addEventListener('load', () => { try { toCurrent(this.responseText); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }
          return send.apply(this, arguments);
        };
        XP.__dcHook = 1;
      }
    } catch (e) { /* page blocks it: times fall back to live capture */ }
  })();

  /* ===================== Styles ===================== */
  const svgUrl = (body, vb = '0 0 24 24', extra = 'fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"') =>
    `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" ${extra}>${body}</svg>`)}")`;
  const M_PLUSC = svgUrl('<path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1.1 5.3v3.6H7.3v2.2h3.6v3.6h2.2v-3.6h3.6v-2.2h-3.6V7.3z"/>', '0 0 24 24', 'fill="black"');
  const M_HASH = svgUrl('<path d="M10 3.5L8 20.5M16 3.5l-2 17M4.5 8.5h16M3.5 15.5h16"/>');
  const M_CHEV = svgUrl('<path d="M6 9l6 6 6-6"/>', '0 0 24 24', 'fill="none" stroke="black" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"');
  const M_CHEVR = svgUrl('<path d="M9 6l6 6-6 6"/>', '0 0 24 24', 'fill="none" stroke="black" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"');
  const M_SEND = svgUrl('<path d="M3.4 20.4l17.4-7.5a1 1 0 0 0 0-1.8L3.4 3.6a.9.9 0 0 0-1.3 1L4 11l9 1-9 1-1.9 6.4a.9.9 0 0 0 1.3 1z"/>', '0 0 24 24', 'fill="black"');
  const M_STOP = svgUrl('<rect x="6" y="6" width="12" height="12" rx="2"/>', '0 0 24 24', 'fill="black"');
  const M_MIC = svgUrl('<path d="M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>');
  const M_CHECK = svgUrl('<path d="M5 12.5l4.5 4.5L19 7"/>', '0 0 24 24', 'fill="none" stroke="black" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"');
  const M_EYE = svgUrl('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
  const M_LOCK = svgUrl('<path d="M7 11V8a5 5 0 0 1 10 0v3"/><rect x="5" y="11" width="14" height="10" rx="2.5" fill="black" stroke="none"/>');

  const CSS = `
:root {
  --dc-font: "Noto Sans", "gg sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --dc-mono: "Source Code Pro", Consolas, "Andale Mono WT", "Andale Mono", "Lucida Console", monospace;
  --dc-emoji: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  --dc-brand: ${CONFIG.accent};
  --dc-brand-h: color-mix(in srgb, var(--dc-brand) 85%, #000);
  --dc-brand-10: color-mix(in srgb, var(--dc-brand) 10%, transparent);
  --dc-brand-15: color-mix(in srgb, var(--dc-brand) 15%, transparent);
  --dc-brand-30: color-mix(in srgb, var(--dc-brand) 30%, transparent);
  --dc-brand-text: color-mix(in srgb, var(--dc-brand) 70%, #fff);
  --dc-green: #23a55a; --dc-idle: #f0b232; --dc-dnd: #f23f43; --dc-red: #da3e44;
  --dc-rail-w: 72px; --dc-bar-h: 32px; --dc-head-h: 48px; --dc-side-w: ${CONFIG.sideWidth}px; --dc-right-w: 0px;
  --dc-msg: 16px; --dc-gap: 16px;
  --dc-ease: cubic-bezier(.4, 0, .2, 1);
}

/* ---------- 1. Discord's colours (Dark), mapped onto Gemini's own tokens ---------- */
body.dc-on {
  --dc-frame: #121214; --dc-chat: #1a1a1e; --dc-low: #202024; --dc-high: #242429; --dc-higher: #28282d; --dc-highest: #2c2d32;
  --dc-input: #222327; --dc-float: #242429; --dc-tip: #2c2d32; --dc-msg-hover: #1e1e22;
  --dc-text: #efeff1; --dc-strong: #fbfbfb; --dc-muted: #96979e; --dc-subtle: #abacb2; --dc-chan: #81828a; --dc-link: #4d96ee;
  --dc-mod-1: rgba(151, 151, 159, .12); --dc-mod-2: rgba(151, 151, 159, .16); --dc-mod-3: rgba(151, 151, 159, .24);
  --dc-line: rgba(151, 151, 159, .12); --dc-line-2: rgba(151, 151, 159, .2); --dc-line-3: rgba(151, 151, 159, .36);
  --dc-shadow: 0 12px 24px rgba(0, 0, 0, .24); --dc-scroll: #4f505a; --dc-red-text: #f57979; --dc-bot: #8fb7ff;
  --gem-sys-color--surface: var(--dc-chat) !important;
  --gem-sys-color--surface-dim: var(--dc-chat) !important;
  --gem-sys-color--surface-bright: var(--dc-high) !important;
  --gem-sys-color--surface-container-lowest: var(--dc-frame) !important;
  --gem-sys-color--surface-container-low: var(--dc-low) !important;
  --gem-sys-color--surface-container: var(--dc-high) !important;
  --gem-sys-color--surface-container-high: var(--dc-higher) !important;
  --gem-sys-color--surface-container-highest: var(--dc-highest) !important;
  --gem-sys-color--surface-variant: var(--dc-higher) !important;
  --gem-sys-color--on-surface: var(--dc-text) !important;
  --gem-sys-color--on-surface-variant: var(--dc-subtle) !important;
  --gem-sys-color--on-surface-low: var(--dc-muted) !important;
  --gem-sys-color--outline: var(--dc-line-3) !important;
  --gem-sys-color--outline-variant: var(--dc-line-2) !important;
  --gem-sys-color--outline-low: var(--dc-line) !important;
  --gem-sys-color--primary: var(--dc-link) !important;
  --gem-sys-color--on-primary: #fff !important;
  --gem-sys-color--primary-container: var(--dc-brand) !important;
  --gem-sys-color--on-primary-container: #fff !important;
  --gem-sys-color--secondary: var(--dc-link) !important;
  --gem-sys-color--secondary-container: var(--dc-brand-30) !important;
  --gem-sys-color--on-secondary-container: var(--dc-strong) !important;
  --gem-sys-color--inverse-primary: var(--dc-brand) !important;
  --gem-sys-color--brand-blue: var(--dc-brand) !important;
  --gem-sys-color--brand-floaty-blue: var(--dc-brand) !important;
  --gem-sys-color--blue-primary: var(--dc-brand) !important;
  --lumi-sys-color--surface: var(--dc-chat) !important;
  --lumi-sys-color--surface-dim: var(--dc-high) !important;
  --lumi-sys-color--surface-bright: var(--dc-high) !important;
  --lumi-sys-color--on-surface: var(--dc-text) !important;
  --lumi-sys-color--on-surface-variant: var(--dc-subtle) !important;
  --lumi-sys-color-acc-color--accent: var(--dc-brand) !important;
  --lumi-sys-color-acc-color--accent-container: var(--dc-brand) !important;
  --lumi-sys-color--code-background: var(--dc-low) !important;
  --gm3-sys-color-primary: var(--dc-link) !important;
  --gm3-sys-color-surface: var(--dc-high) !important;
  --gm3-sys-color-background: var(--dc-chat) !important;
  --mat-app-background-color: var(--dc-chat) !important;
  --mat-app-text-color: var(--dc-text) !important;
  --mat-sys-primary: var(--dc-link) !important;
  --mat-sys-surface: var(--dc-high) !important;
  --mat-sys-surface-container: var(--dc-high) !important;
  --bard-color-sidenav-background-desktop: var(--dc-frame) !important;
  --bard-color-sidenav-background-mobile: var(--dc-frame) !important;
  --bard-color-synthetic--chat-window-surface: transparent !important;
  --bard-color-response-container-flipped-background: transparent !important;
  --top-gradient-color: transparent !important;
  --bottom-gradient-color: transparent !important;
  background: var(--dc-frame) !important;
  color: var(--dc-text);
}
body.dc-on.dc-ash {
  --dc-frame: #2c2d32; --dc-chat: #323339; --dc-low: #36373e; --dc-high: #393a41; --dc-higher: #3c3d45; --dc-highest: #3f4048;
  --dc-input: #393a41; --dc-float: #393a41; --dc-tip: #3f4048; --dc-msg-hover: #2f3035;
  --dc-text: #f3f3f4; --dc-strong: #ffffff; --dc-muted: #abacb2; --dc-subtle: #c5c6ca; --dc-chan: #999aa1; --dc-link: #76aff6; --dc-scroll: #5d5e68;
}
body.dc-on.dc-onyx {
  --dc-frame: #000000; --dc-chat: #0a0a0c; --dc-low: #121214; --dc-high: #121214; --dc-higher: #17181b; --dc-highest: #1e1f22;
  --dc-input: #131416; --dc-float: #121214; --dc-tip: #17181b; --dc-msg-hover: #0f0f12;
  --dc-text: #d4d5d8; --dc-strong: #dcdcdf; --dc-muted: #81828a; --dc-subtle: #96979e; --dc-chan: #7a7b83; --dc-link: #2781e7;
  --dc-mod-2: rgba(151, 151, 159, .2); --dc-line: rgba(151, 151, 159, .2); --dc-line-2: rgba(151, 151, 159, .24); --dc-scroll: #3a3b42;
}
body.dc-on.dc-light {
  --dc-frame: #f3f3f4; --dc-chat: #ffffff; --dc-low: #f2f2f3; --dc-high: #ffffff; --dc-higher: #ffffff; --dc-highest: #ffffff;
  --dc-input: #ebeced; --dc-float: #ffffff; --dc-tip: #ffffff; --dc-msg-hover: #f6f6f7;
  --dc-text: #2e2e34; --dc-strong: #28282d; --dc-muted: #6c6d76; --dc-subtle: #595a63; --dc-chan: #666770; --dc-link: #006dd4;
  --dc-line: rgba(151, 151, 159, .28); --dc-line-2: rgba(151, 151, 159, .4); --dc-line-3: rgba(151, 151, 159, .52);
  --dc-shadow: 0 12px 24px rgba(0, 0, 0, .12); --dc-scroll: #c9cace; --dc-red-text: #d6363f; --dc-bot: #3e70dd;
  --dc-brand-text: color-mix(in srgb, var(--dc-brand) 85%, #000);
}

/* ---------- 2. Discord's font (icons, code and maths keep theirs) ---------- */
body.dc-on { font-family: var(--dc-font) !important; }
body.dc-on :is(div, p, a, li, button, input, textarea, label, h1, h2, h3, h4, h5, h6, td, th, blockquote, summary, [class*="gds-"], .mdc-button__label, .mat-mdc-menu-item-text, .gem-menu-item-label, .label, .sublabel, .title-text)
  :not(mat-icon, .mat-icon, [class*="symbols"], [class*="icon"], [class^="x"], code, pre, .katex, .katex *, [class*="code"] *) {
  font-family: var(--dc-font) !important;
  font-variation-settings: normal !important;
  letter-spacing: normal !important;
}
body.dc-on:has(bard-sidenav:hover) .mat-mdc-tooltip-panel { display: none !important; }
.dc-ui svg, svg.dc-i { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }

/* ---------- 3. The frame: title bar on top, server rail on the left, Gemini moved into the rest ---------- */
body.dc-on chat-app {
  position: fixed !important; top: var(--dc-bar-h) !important; left: var(--dc-rail-w) !important; right: 0 !important; bottom: 0 !important;
  width: auto !important; height: auto !important; background: transparent !important;
}
body.dc-on :is(main.chat-app, bard-sidenav-container, .mat-drawer-content, chat-window, .chat-container, input-container, .lm-canvas-styling, .content-wrapper, .main-content, .content-container) {
  background: transparent !important;
}
body.dc-on bard-sidenav-content {
  background: var(--dc-chat) !important; margin-right: var(--dc-right-w) !important; border-top: 1px solid var(--dc-line) !important;
  transition: margin-right .2s var(--dc-ease);
}
body.dc-on.dc-side-closed bard-sidenav-content { border-left: 1px solid var(--dc-line) !important; border-top-left-radius: 12px; }
body.dc-on :is(.lm-glow, chat-loading-animation, .blur-bg, .input-gradient::before, .autosuggest-scrim) { display: none !important; }
body.dc-on input-container.input-gradient { background: none !important; }
body.dc-on input-container::before, body.dc-on input-container::after { display: none !important; }
body.dc-on top-bar-actions { opacity: 0 !important; pointer-events: none !important; }
body.dc-on .side-nav-menu-button { visibility: hidden !important; pointer-events: none !important; }
body.dc-on .main-content > .content-container { padding-top: var(--dc-head-h) !important; box-sizing: border-box !important; }
body.dc-on :is(hallucination-disclaimer, .hallucination-disclaimer, condensed-tos-disclaimer, back-to-bottom-fab, .human-review-disclosure-container, sidenav-mavatar-footer) { display: none !important; }
body.dc-ghost .cdk-overlay-pane:has(.mat-mdc-menu-panel),
body.dc-ghost .cdk-overlay-backdrop,
body.dc-ghost .cdk-overlay-popover { opacity: 0 !important; transition: none !important; pointer-events: none !important; }

#dc-titlebar {
  position: fixed; top: 0; left: 0; right: 0; height: var(--dc-bar-h); z-index: 960; display: flex; align-items: center; justify-content: center;
  background: var(--dc-frame); color: var(--dc-text); font-size: 14px; font-weight: 500; user-select: none;
}
#dc-titlebar .dc-tb-title { display: flex; align-items: center; gap: 8px; max-width: 50%; min-width: 0; }
#dc-titlebar .dc-tb-title span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#dc-titlebar .dc-tb-ic { width: 18px; height: 18px; border-radius: 6px; flex: none; display: inline-flex; align-items: center; justify-content: center; color: #fff; }
#dc-titlebar .dc-tb-ic svg { width: 12px; height: 12px; }
#dc-titlebar .dc-tb-right { position: absolute; right: 6px; top: 0; height: 100%; display: flex; align-items: center; gap: 2px; }
.dc-tb-btn { width: 32px; height: 26px; border: 0; border-radius: 6px; background: transparent; color: var(--dc-subtle); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
.dc-tb-btn:hover, .dc-tb-btn.dc-on { background: var(--dc-mod-1); color: var(--dc-strong); }
.dc-tb-btn svg { width: 20px; height: 20px; }

/* server rail */
#dc-rail {
  position: fixed; top: var(--dc-bar-h); left: 0; bottom: 0; width: var(--dc-rail-w); z-index: 955; display: flex; flex-direction: column; align-items: center;
  gap: 8px; padding: 4px 0 80px; box-sizing: border-box; overflow-y: auto; overflow-x: hidden; scrollbar-width: none; background: var(--dc-frame);
}
#dc-rail::-webkit-scrollbar { display: none; }
.dc-g { position: relative; width: 100%; display: flex; justify-content: center; flex: none; }
.dc-g-icon {
  width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; overflow: hidden; cursor: pointer; border: 0; padding: 0;
  background: var(--dc-high); color: var(--dc-text); font-size: 14px; font-weight: 500; transition: background-color .15s, color .15s, transform .1s; user-select: none;
}
.dc-g-icon:active { transform: translateY(1px); }
.dc-g-icon svg { width: 22px; height: 22px; }
.dc-g-pill { position: absolute; left: 0; top: 50%; width: 4px; height: 0; border-radius: 0 4px 4px 0; background: var(--dc-strong); transform: translateY(-50%); transition: height .2s var(--dc-ease); }
.dc-g:hover .dc-g-pill { height: 20px; }
.dc-g.dc-unread .dc-g-pill { height: 8px; }
.dc-g.dc-on .dc-g-pill { height: 40px; }
.dc-g-home .dc-g-icon { color: var(--dc-strong); }
.dc-g-home:hover .dc-g-icon, .dc-g-home.dc-on .dc-g-icon { background: var(--dc-brand); color: #fff; }
.dc-g-gem .dc-g-icon { background: linear-gradient(135deg, #4c8df6, #8e6cf1 60%, #d96570); color: #fff; }
.dc-g-gem .dc-g-icon svg { width: 24px; height: 24px; }
.dc-g:not(.dc-g-home):not(.dc-g-gem):not(.dc-g-add):hover .dc-g-icon, .dc-g.dc-nb.dc-on .dc-g-icon { background: var(--dc-brand); color: #fff; }
.dc-g-add .dc-g-icon { color: var(--dc-green); }
.dc-g-add:hover .dc-g-icon { background: var(--dc-green); color: #fff; }
.dc-g-sep { width: 32px; height: 1px; background: var(--dc-line-2); flex: none; }
.dc-g-badge {
  position: absolute; right: 12px; bottom: -3px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 8px; background: var(--dc-dnd);
  color: #fff; font-size: 12px; font-weight: 700; line-height: 16px; text-align: center; box-shadow: 0 0 0 3px var(--dc-frame); pointer-events: none;
}

/* ---------- 4. Channel list (Gemini's chat list) ---------- */
body.dc-on bard-sidenav:has(.sidenav-with-history-container.expanded) {
  width: var(--dc-side-w) !important; min-width: var(--dc-side-w) !important; max-width: var(--dc-side-w) !important;
}
body.dc-on bard-sidenav:not(:has(.sidenav-with-history-container.expanded)) { width: 0 !important; min-width: 0 !important; overflow: hidden !important; border: 0 !important; }
body.dc-on bard-sidenav {
  background: var(--dc-frame) !important; border: 0 !important; border-top: 1px solid var(--dc-line) !important; border-left: 1px solid var(--dc-line) !important;
  border-top-left-radius: 12px !important; box-shadow: none !important; overflow: hidden !important; box-sizing: border-box !important;
}
body.dc-on bard-sidenav :is(side-navigation-content, .sidenav-with-history-container) { width: 100% !important; background: transparent !important; }
body.dc-on .sidenav-header-buttons {
  position: absolute !important; inset: 0 0 auto 0 !important; width: auto !important; height: 48px !important; padding: 0 !important; margin: 0 !important;
  display: flex !important; align-items: stretch !important; background: var(--dc-frame) !important; border-bottom: 1px solid var(--dc-line) !important;
  z-index: 4 !important; box-sizing: border-box !important;
}
body.dc-on .sidenav-header-buttons > :not(.dc-side-head) { display: none !important; }
body.dc-on bard-sidenav .overflow-container { padding-top: 48px !important; box-sizing: border-box !important; }
body.dc-on bard-sidenav :is(.top-action-list, .top-action-list-scrollable, .top-action-list-pinned, .section-divider,
  .top-gradient-container, .bottom-gradient-container, .hovered-trailing-content, .desktop-controls, .loading-content-spinner-container),
body.dc-on bard-sidenav expandable-section:not([data-test-id="chats-expandable-section"]),
body.dc-on bard-sidenav [data-test-id="chats-expandable-section"] > .expandable-section-header-row { display: none !important; }
body.dc-on bard-sidenav infinite-scroller { padding: 0 0 80px !important; box-sizing: border-box !important; }
body.dc-on bard-sidenav :is(.chat-history, .chat-history-list, conversations-list, conversations-list mat-nav-list, .expandable-section-content, .expandable-section-content-inner) {
  padding: 0 !important; margin: 0 !important; width: auto !important;
}
body.dc-on gem-nav-list-item[data-test-id="conversation"] { display: block !important; margin: 0 !important; padding: 0 !important; height: auto !important; }
body.dc-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item {
  display: flex !important; align-items: center !important; gap: 6px; position: relative !important; box-sizing: border-box !important;
  width: auto !important; height: 32px !important; min-height: 32px !important; margin: 2px 8px !important; padding: 0 8px !important;
  border-radius: 8px !important; background: transparent !important; color: var(--dc-chan) !important; overflow: visible !important; text-decoration: none !important;
  --mat-list-list-item-one-line-container-height: 32px; --mat-list-list-item-hover-state-layer-opacity: 0; --mat-list-list-item-focus-state-layer-opacity: 0;
}
body.dc-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item::before,
body.dc-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item::after,
body.dc-on gem-nav-list-item[data-test-id="conversation"] .mat-focus-indicator,
body.dc-on gem-nav-list-item[data-test-id="conversation"] .mdc-list-item__start,
body.dc-on gem-nav-list-item[data-test-id="conversation"] .mdc-list-item__end { display: none !important; }
body.dc-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item:is(:hover, .dc-row-ctx) { background: var(--dc-mod-1) !important; color: var(--dc-text) !important; }
body.dc-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item.dc-row-on { background: var(--dc-mod-2) !important; color: var(--dc-strong) !important; }
body.dc-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item.dc-row-unread { color: var(--dc-strong) !important; }
body.dc-on gem-nav-list-item[data-test-id="conversation"] .mdc-list-item__content { display: none !important; }
body.dc-on gem-nav-list-item[data-test-id="conversation"] a:has(.mdc-list-item__content input) .mdc-list-item__content { display: flex !important; flex: 1; min-width: 0; }
body.dc-on gem-nav-list-item[data-test-id="conversation"] a:has(.mdc-list-item__content input) .dc-row-txt { display: none !important; }
body.dc-on gem-nav-list-item[data-test-id="conversation"] input { color: var(--dc-text) !important; font-size: 16px !important; }
svg.dc-row-ic { width: 20px; height: 20px; flex: none; color: var(--dc-chan); }
a.dc-row-on .dc-row-ic, a.dc-row-unread .dc-row-ic, a.gem-nav-list-item:hover .dc-row-ic { color: inherit; }
.dc-row-av { display: none !important; }
.dc-row-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.dc-row-name { display: block; font-size: 16px; font-weight: 500; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: inherit; }
a.dc-row-unread .dc-row-name { font-weight: 600; }
.dc-row-sub { display: none; font-size: 12px; font-weight: 500; line-height: 16px; color: var(--dc-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-row-sub.dc-typing { color: var(--dc-strong); }
.dc-row-acts { display: none; align-items: center; gap: 4px; flex: none; }
a.gem-nav-list-item:is(:hover, .dc-row-on) .dc-row-acts { display: flex; }
.dc-row-acts button { width: 18px; height: 18px; padding: 0; border: 0; background: none; color: var(--dc-subtle); cursor: pointer; display: inline-flex; }
.dc-row-acts button:hover { color: var(--dc-strong); }
.dc-row-acts svg { width: 16px; height: 16px; }
.dc-row-pill { display: none; position: absolute; left: -8px; top: 50%; width: 4px; height: 8px; margin-top: -4px; border-radius: 0 4px 4px 0; background: var(--dc-strong); }
a.dc-row-unread:not(.dc-row-on) .dc-row-pill { display: block; }
.dc-row-badge { flex: none; min-width: 16px; height: 16px; padding: 0 5px; box-sizing: border-box; border-radius: 8px; background: var(--dc-dnd); color: #fff; font-size: 12px; font-weight: 700; line-height: 16px; text-align: center; }
.dc-cat {
  display: flex; align-items: center; gap: 2px; height: 24px; margin: 16px 8px 2px 0; padding: 0 0 0 8px; cursor: pointer; user-select: none;
  color: var(--dc-chan); font-size: 14px; font-weight: 500; line-height: 18px;
}
.dc-cat:hover { color: var(--dc-text); }
.dc-cat > svg { width: 12px; height: 12px; stroke-width: 3; transition: transform .2s var(--dc-ease); }
.dc-cat.dc-closed > svg { transform: rotate(-90deg); }
.dc-cat span { flex: 1; }
.dc-cat button { width: 18px; height: 18px; padding: 0; border: 0; background: none; color: inherit; cursor: pointer; display: inline-flex; opacity: .8; }
.dc-cat button:hover { opacity: 1; color: var(--dc-strong); }
.dc-cat button svg { width: 18px; height: 18px; }
.dc-collapsed-row { display: none !important; }
/* DMs view: the same chats as direct messages */
body.dc-dm .dc-cat { display: none !important; }
body.dc-dm gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item { height: 42px !important; min-height: 42px !important; gap: 12px; margin: 1px 8px !important; }
body.dc-dm .dc-row-ic { display: none !important; }
body.dc-dm .dc-row-av { display: inline-flex !important; }
body.dc-dm .dc-row-sub { display: block; }
body.dc-dm .dc-row-acts { display: none !important; }
body.dc-dm a.dc-row-on .dc-row-sub, body.dc-dm a.gem-nav-list-item:hover .dc-row-sub { color: var(--dc-subtle); }
body:not(.dc-dm) .dc-dm-only, body.dc-dm .dc-srv-only { display: none !important; }

.dc-side-head { display: flex; flex: 1; min-width: 0; height: 100%; }
.dc-srv-btn {
  display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; height: 100%; padding: 0 12px 0 16px; border: 0; background: none; cursor: pointer;
  color: var(--dc-strong); font: 600 16px/20px var(--dc-font); text-align: left; transition: background-color .1s;
}
.dc-srv-btn:hover, .dc-srv-btn.dc-on { background: var(--dc-mod-1); }
.dc-srv-btn span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-srv-btn svg { width: 18px; height: 18px; transition: transform .2s; }
.dc-srv-btn.dc-on svg { transform: rotate(180deg); }
.dc-side-head .dc-invite { width: 48px; flex: none; border: 0; background: none; color: var(--dc-subtle); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.dc-side-head .dc-invite:hover { color: var(--dc-strong); }
.dc-side-head .dc-invite svg { width: 20px; height: 20px; }
.dc-find {
  display: flex; align-items: center; flex: 1; height: 30px; margin: auto 10px; padding: 0 8px; border: 0; border-radius: 8px; cursor: pointer;
  background: var(--dc-low); color: var(--dc-muted); font: 500 14px/18px var(--dc-font); text-align: left; white-space: nowrap; overflow: hidden;
  box-shadow: inset 0 0 0 1px var(--dc-line);
}
body.dc-light .dc-find { background: var(--dc-input); }
#dc-side-top { padding: 8px 0 0; }
.dc-side-item {
  display: flex; align-items: center; gap: 8px; height: 32px; margin: 2px 8px; padding: 0 8px; border-radius: 8px; cursor: pointer;
  color: var(--dc-chan); font-size: 16px; font-weight: 500; line-height: 20px; white-space: nowrap; transition: background-color .1s;
}
.dc-side-item:hover { background: var(--dc-mod-1); color: var(--dc-text); }
.dc-side-item.dc-on { background: var(--dc-mod-2); color: var(--dc-strong); }
.dc-side-item svg { width: 20px; height: 20px; flex: none; }
.dc-side-item .dc-new { margin-left: auto; padding: 0 6px; border-radius: 8px; background: var(--dc-brand); color: #fff; font-size: 12px; font-weight: 700; line-height: 16px; }
body.dc-dm .dc-side-item { height: 42px; gap: 12px; }
body.dc-dm .dc-side-item svg { width: 24px; height: 24px; }
.dc-side-sep { height: 1px; margin: 8px 16px 0; background: var(--dc-line); }
.dc-dm-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 16px 4px 18px; color: var(--dc-chan); font-size: 14px; font-weight: 500; }
.dc-dm-head:hover { color: var(--dc-text); }
.dc-dm-head button { width: 18px; height: 18px; padding: 0; border: 0; background: none; color: inherit; cursor: pointer; display: inline-flex; }
.dc-dm-head button svg { width: 16px; height: 16px; stroke-width: 2.4; }
#dc-resizer { position: absolute; top: 0; right: 0; width: 6px; height: 100%; cursor: ew-resize; z-index: 7; }
#dc-resizer:hover, #dc-resizer.dc-drag { background: linear-gradient(90deg, transparent 4px, var(--dc-brand) 4px); }
body.dc-resizing, body.dc-resizing * { cursor: ew-resize !important; user-select: none !important; }

/* user panel */
#dc-user {
  position: fixed; left: 8px; bottom: 8px; z-index: 956; width: calc(var(--dc-rail-w) + var(--dc-side-w) - 16px); height: 56px; box-sizing: border-box;
  display: flex; align-items: center; gap: 2px; padding: 0 8px 0 8px; border-radius: 8px; background: var(--dc-high); border: 1px solid var(--dc-line-2);
  box-shadow: 0 2px 8px rgba(0, 0, 0, .12);
}
body.dc-side-closed #dc-user { width: 56px; padding: 0 6px; }
body.dc-side-closed #dc-user :is(.dc-up-text, .dc-up-btns) { display: none; }
.dc-up-me { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; height: 42px; padding: 0 4px 0 2px; margin-left: -2px; border-radius: 8px; cursor: pointer; }
.dc-up-me:hover { background: var(--dc-mod-2); }
.dc-up-text { min-width: 0; flex: 1; }
.dc-up-name { font-size: 14px; font-weight: 600; line-height: 18px; color: var(--dc-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-up-sub { position: relative; height: 15px; font-size: 12px; line-height: 15px; color: var(--dc-muted); overflow: hidden; }
.dc-up-sub span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: transform .2s var(--dc-ease); }
.dc-up-me:hover .dc-up-sub span { transform: translateY(-100%); }
.dc-up-btns { display: flex; flex: none; }
.dc-up-btn { width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--dc-subtle); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
.dc-up-btn:hover { background: var(--dc-mod-2); color: var(--dc-strong); }
.dc-up-btn.dc-off { color: var(--dc-dnd); }
.dc-up-btn.dc-live { color: var(--dc-green); }
.dc-up-btn svg { width: 20px; height: 20px; }

/* ---------- 5. Channel header, member list, search results ---------- */
#dc-header {
  position: fixed; top: var(--dc-bar-h); z-index: 900; height: var(--dc-head-h); display: flex; align-items: center; gap: 8px; box-sizing: border-box;
  padding: 0 8px 0 16px; background: var(--dc-chat); color: var(--dc-text); border-top: 1px solid var(--dc-line); border-bottom: 1px solid var(--dc-line);
}
body.dc-side-closed #dc-header { border-left: 1px solid var(--dc-line); border-top-left-radius: 12px; }
#dc-header .dc-h-burger { display: none; margin-left: -8px; }
body.dc-side-closed #dc-header .dc-h-burger { display: inline-flex; }
#dc-header .dc-h-ic { width: 24px; height: 24px; flex: none; color: var(--dc-chan); display: inline-flex; align-items: center; justify-content: center; }
#dc-header .dc-h-ic svg { width: 24px; height: 24px; }
#dc-header .dc-h-ic .dc-av { width: 24px; height: 24px; font-size: 10px; }
#dc-header .dc-h-title { flex: 0 1 auto; min-width: 0; max-width: 45%; font-size: 16px; font-weight: 600; line-height: 20px; color: var(--dc-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: default; }
#dc-header .dc-h-dot { width: 4px; height: 4px; flex: none; border-radius: 50%; background: var(--dc-muted); opacity: .6; margin: 0 4px; }
#dc-header .dc-h-topic { flex: 1 1 auto; min-width: 0; font-size: 14px; line-height: 18px; color: var(--dc-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
#dc-header .dc-h-topic:hover { color: var(--dc-subtle); }
#dc-header .dc-h-tools { display: flex; align-items: center; gap: 8px; flex: none; margin-left: auto; }
.dc-h-btn { position: relative; width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--dc-subtle); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; flex: none; }
.dc-h-btn:hover, .dc-h-btn.dc-on { color: var(--dc-strong); }
.dc-h-btn svg { width: 24px; height: 24px; }
.dc-h-btn b { position: absolute; right: 0; bottom: 2px; min-width: 14px; height: 14px; padding: 0 3px; box-sizing: border-box; border-radius: 7px; background: var(--dc-dnd); color: #fff; font-size: 10px; font-weight: 700; line-height: 14px; text-align: center; box-shadow: 0 0 0 2px var(--dc-chat); }
.dc-h-search {
  position: relative; display: flex; align-items: center; width: 244px; height: 32px; flex: none; box-sizing: border-box; border-radius: 8px;
  background: var(--dc-frame); border: 1px solid var(--dc-line-2); transition: width .25s var(--dc-ease); cursor: text;
}
body.dc-light .dc-h-search { background: var(--dc-input); }
.dc-h-search:focus-within { border-color: var(--dc-brand); }
.dc-h-search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--dc-text); font: 400 14px/18px var(--dc-font); padding: 0 30px 0 10px; }
.dc-h-search input::placeholder { color: var(--dc-muted); }
.dc-h-search > svg { position: absolute; right: 8px; width: 18px; height: 18px; color: var(--dc-muted); pointer-events: none; }
.dc-h-search .dc-h-clear { position: absolute; right: 4px; width: 24px; height: 24px; border: 0; background: none; color: var(--dc-muted); cursor: pointer; display: none; padding: 0; }
.dc-h-search.dc-has > svg { display: none; }
.dc-h-search.dc-has .dc-h-clear { display: inline-flex; align-items: center; justify-content: center; }
.dc-h-search .dc-h-clear svg { width: 18px; height: 18px; }
@media (max-width: 980px) { .dc-h-search { width: 160px; } #dc-header .dc-h-topic { display: none; } #dc-header .dc-h-dot { display: none; } }

#dc-right {
  position: fixed; top: calc(var(--dc-bar-h) + var(--dc-head-h)); right: 0; bottom: 0; z-index: 890; width: 264px; display: none; flex-direction: column;
  box-sizing: border-box; background: var(--dc-chat); border-left: 1px solid var(--dc-line); overflow-y: auto; overflow-x: hidden;
}
#dc-right.dc-show { display: flex; }
#dc-right.dc-wide { width: 420px; }
.dc-mem-group { padding: 20px 8px 6px 16px; font-size: 14px; font-weight: 500; line-height: 18px; color: var(--dc-chan); }
.dc-mem { display: flex; align-items: center; gap: 12px; height: 44px; margin: 0 8px 2px; padding: 0 8px; border-radius: 8px; cursor: pointer; flex: none; }
.dc-mem:hover, .dc-mem.dc-on { background: var(--dc-mod-1); }
.dc-mem .dc-mem-t { min-width: 0; flex: 1; }
.dc-mem-name { display: flex; align-items: center; min-width: 0; font-size: 16px; font-weight: 500; line-height: 20px; color: var(--dc-subtle); }
.dc-mem-name span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-mem:hover .dc-mem-name, .dc-mem.dc-on .dc-mem-name { color: var(--dc-strong); }
.dc-mem-name.dc-bot span:first-child { color: var(--dc-bot); }
.dc-mem-act { font-size: 12px; line-height: 16px; color: var(--dc-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-mem-act b { font-weight: 600; }
.dc-sr-head { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 8px; min-height: 56px; padding: 0 8px 0 16px; background: var(--dc-chat); border-bottom: 1px solid var(--dc-line); }
.dc-sr-count { flex: 1; font-size: 16px; font-weight: 600; color: var(--dc-strong); }
.dc-sr-tabs { display: flex; gap: 2px; }
.dc-sr-tabs button { height: 26px; padding: 0 8px; border: 0; border-radius: 6px; background: none; color: var(--dc-subtle); font: 500 14px/18px var(--dc-font); cursor: pointer; }
.dc-sr-tabs button:hover { background: var(--dc-mod-1); }
.dc-sr-tabs button.dc-on { background: var(--dc-mod-2); color: var(--dc-strong); }
.dc-sr-chan { display: flex; align-items: center; gap: 4px; padding: 14px 16px 6px; font-size: 14px; font-weight: 600; color: var(--dc-subtle); }
.dc-sr-chan svg { width: 16px; height: 16px; }
.dc-card {
  position: relative; display: block; margin: 0 12px 8px; padding: 8px 12px 10px 64px; min-height: 44px; border-radius: 8px; cursor: pointer;
  background: var(--dc-low); border: 1px solid var(--dc-line); transition: background-color .1s;
}
.dc-card:hover { background: var(--dc-high); }
.dc-card > .dc-avw { position: absolute; left: 12px; top: 10px; }
.dc-card .dc-mh { margin-bottom: 2px; }
.dc-card-text { font-size: 14px; line-height: 20px; color: var(--dc-text); word-break: break-word; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.dc-card-text mark { background: color-mix(in srgb, var(--dc-idle) 30%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
.dc-card-jump { position: absolute; top: 8px; right: 8px; display: none; height: 24px; padding: 0 8px; border: 0; border-radius: 6px; background: var(--dc-mod-2); color: var(--dc-strong); font: 600 12px/24px var(--dc-font); cursor: pointer; }
.dc-card-x { right: 70px; }
.dc-card:hover .dc-card-jump { display: block; }
.dc-card-jump:hover { background: var(--dc-mod-3); }
.dc-sr-more { margin: 8px 12px 16px; }

/* ---------- 6. Messages ---------- */
body.dc-on infinite-scroller.chat-history { padding: 0 0 8px !important; gap: 0 !important; }
body.dc-on .conversation-container { max-width: none !important; width: 100% !important; margin: 0 !important; padding: 0 !important; gap: 0 !important; position: relative; display: block !important; }
body.dc-on .conversation-container:last-of-type { padding-bottom: 16px !important; }
body.dc-on :is(user-query, model-response) {
  display: block !important; position: relative !important; box-sizing: border-box !important; width: 100% !important; max-width: none !important;
  margin: var(--dc-gap) 0 0 !important; padding: 2px 48px 2px 72px !important; min-height: 44px; background: transparent !important;
}
body.dc-on :is(user-query, model-response):is(:hover, .dc-msg-active) { background: var(--dc-msg-hover) !important; }
body.dc-on user-query :is(.user-query-container, user-query-content, .query-content, .query-bubble-with-status) {
  max-width: 100% !important; width: auto !important; margin: 0 !important; padding: 0 !important; background: transparent !important;
}
body.dc-on user-query div.user-query-container { display: flex !important; flex-direction: column !important; align-items: stretch !important; gap: 4px !important; }
body.dc-on user-query .user-query-bubble-with-background {
  display: block !important; width: auto !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; box-sizing: border-box !important;
  background: transparent !important; color: var(--dc-text) !important; border-radius: 0 !important; box-shadow: none !important;
}
body.dc-on user-query :is(.query-text, .query-text-line, .horizontal-container) {
  color: var(--dc-text) !important; font-size: var(--dc-msg) !important; line-height: 1.375 !important; padding: 0 !important; margin: 0 !important; text-align: left !important;
}
body.dc-on user-query .query-text-line { min-height: 0 !important; }
body.dc-on user-query a { color: var(--dc-link) !important; }
body.dc-on user-query :is(.luminous-actions-container, .query-action-buttons, .luminous-toggle-container) { display: none !important; }
body.dc-on user-query :is(.luminous-collapsed, .luminous-collapsed .query-text, .luminous-collapsed .horizontal-container, .query-text.collapsed) {
  max-height: none !important; -webkit-line-clamp: unset !important; overflow: visible !important; -webkit-mask-image: none !important; mask-image: none !important;
}
body.dc-on user-query .file-preview-container { margin: 0 !important; padding: 0 !important; width: auto !important; }
body.dc-on user-query user-query-file-carousel { display: block !important; width: auto !important; max-width: 550px; height: auto !important; margin: 0 !important; padding: 0 !important; }
body.dc-on user-query user-query-file-carousel .scrollable-area {
  display: grid !important; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)) !important; gap: 4px !important;
  width: 100% !important; height: auto !important; overflow: visible !important; margin: 0 !important; padding: 0 !important;
}
body.dc-on user-query user-query-file-carousel .scrollable-area > div { width: auto !important; height: auto !important; min-width: 0; margin: 0 !important; }
body.dc-on.dc-on user-query user-query-file-carousel :is(.file-preview-container, .preview-image-button):is(div, button):not(#dc-x) {
  display: block !important; width: 100% !important; max-width: 100% !important; height: 100% !important; padding: 0 !important; margin: 0 !important; border-radius: 8px !important;
}
body.dc-on.dc-on user-query user-query-file-carousel img.preview-image:not(#dc-x) {
  display: block !important; width: 100% !important; max-width: 100% !important; height: auto !important; aspect-ratio: 1; max-height: none !important; object-fit: cover !important; border-radius: 8px !important;
}
body.dc-on.dc-on user-query user-query-file-carousel .scrollable-area > div:only-child img.preview-image:not(#dc-x) { aspect-ratio: auto; max-height: 350px !important; width: auto !important; max-width: 400px !important; }
body.dc-on user-query user-query-file-carousel .scrollable-area:has(> div:only-child) { display: block !important; }

body.dc-on model-response :is(response-container, .response-container, .presented-response-container) {
  max-width: 100% !important; margin: 0 !important; padding: 0 !important; background: transparent !important;
}
body.dc-on model-response .presented-response-container { justify-content: flex-start !important; }
body.dc-on model-response .response-container-content {
  width: auto !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; background: transparent !important; border-radius: 0 !important; box-shadow: none !important;
}
body.dc-on model-response :is(.response-content, model-response-content, structured-content-container, structured-content-container > .container, message-content, .markdown) {
  max-width: none !important; width: auto !important; margin: 0 !important; padding: 0 !important; background: transparent !important;
}
body.dc-on model-response message-content { display: block !important; }
body.dc-on model-response :is(bard-avatar, .avatar-gutter) { display: none !important; }
body.dc-on model-response .markdown > * { max-width: none !important; margin-inline: 0 !important; }
body.dc-on model-response .markdown { font-size: var(--dc-msg) !important; line-height: 1.375 !important; color: var(--dc-text) !important; }
body.dc-on model-response .markdown :is(p, li) { font-size: var(--dc-msg) !important; line-height: 1.375 !important; }
body.dc-on model-response .markdown > :first-child { margin-top: 0 !important; }
body.dc-on model-response .markdown > :last-child { margin-bottom: 0 !important; }
body.dc-on model-response .markdown p { margin: 0 0 6px !important; }
body.dc-on model-response .markdown :is(h1, h2, h3, h4) { margin: 10px 0 4px !important; line-height: 1.375 !important; font-weight: 700 !important; color: var(--dc-strong) !important; }
body.dc-on model-response .markdown h1 { font-size: 1.5em !important; }
body.dc-on model-response .markdown h2 { font-size: 1.25em !important; }
body.dc-on model-response .markdown :is(h3, h4) { font-size: 1em !important; }
body.dc-on model-response .markdown :is(ul, ol) { margin: 2px 0 6px !important; padding-left: 1.5em !important; }
body.dc-on model-response .markdown li { margin: 2px 0 !important; }
body.dc-on model-response .markdown hr { border: 0 !important; border-top: 1px solid var(--dc-line-2) !important; margin: 10px 0 !important; }
body.dc-on model-response .markdown a, body.dc-on message-content a { color: var(--dc-link) !important; text-decoration: none !important; }
body.dc-on model-response .markdown a:hover { text-decoration: underline !important; }
body.dc-on model-response .markdown strong { color: var(--dc-strong); font-weight: 700; }
body.dc-on model-response .markdown blockquote {
  margin: 4px 0 6px !important; padding: 0 8px 0 12px !important; border: 0 !important; border-left: 4px solid var(--dc-mod-3) !important; border-radius: 4px !important; background: none !important;
}
body.dc-on model-response :is(code-block, .code-block) {
  display: block; margin: 6px 0 8px !important; border-radius: 8px !important; overflow: hidden; border: 1px solid var(--dc-line-2) !important; background: var(--dc-low) !important;
}
body.dc-on model-response .code-block-decoration { background: var(--dc-high) !important; color: var(--dc-muted) !important; font-size: 12px !important; font-weight: 600 !important; padding: 4px 12px !important; }
body.dc-on model-response :is(code-block pre, .code-block pre) { background: transparent !important; margin: 0 !important; }
body.dc-on model-response :is(pre, pre code, code-block code) { font-family: var(--dc-mono) !important; font-size: 14px !important; line-height: 18px !important; }
body.dc-on model-response :not(pre) > code { background: var(--dc-low) !important; border: 1px solid var(--dc-line-2) !important; border-radius: 4px !important; padding: .1em .3em !important; font-family: var(--dc-mono) !important; font-size: .85em !important; color: var(--dc-text) !important; }
body.dc-on model-response table { border-collapse: collapse !important; }
body.dc-on model-response :is(th, td) { border-color: var(--dc-line-2) !important; }
body.dc-on model-response th { background: var(--dc-low) !important; }
body.dc-on model-response :is(.table-block, table-block) { border-radius: 8px !important; border-color: var(--dc-line-2) !important; }
body.dc-on model-response .markdown img { border-radius: 8px !important; }
body.dc-on model-response :is(.response-container-footer, message-actions, .actions-container-v2) { margin: 0 !important; }
body.dc-on.dc-hide-gemini-actions model-response :is(.response-container-footer, message-actions, .actions-container-v2) { display: none !important; }
body.dc-on model-response :is(model-thoughts, .thoughts-container) { margin: 0 0 6px !important; }
body.dc-on model-response model-thoughts :is(button, .thoughts-header-button) {
  border-radius: 8px !important; background: var(--dc-low) !important; border: 1px solid var(--dc-line-2) !important; color: var(--dc-subtle) !important; padding: 2px 10px !important; font-size: 14px !important;
}
body.dc-on model-response :is(sources-list, .sources-list) { margin-top: 0 !important; }
body.dc-on model-response :is(sources-list, .sources-list):has(a, button, img) { margin-top: 6px !important; }
body.dc-on model-response :is(election-info-disclaimer, finance-info-disclaimer):empty { display: none !important; }
body.dc-on :is(.source-inline-chip, .inline-source-chip, source-inline-chip, .attachment-container .chip) { background: var(--dc-mod-2) !important; color: var(--dc-link) !important; border-radius: 4px !important; }
body.dc-on model-response .response-container-header { margin: 0 0 4px !important; }

/* avatar, name, APP tag and time on every message */
.dc-mav { position: absolute !important; left: 16px; top: 4px; z-index: 1; cursor: pointer; user-select: none; }
.dc-mav:active { transform: translateY(1px); }
.dc-has-reply > .dc-mav { top: 26px; }
.dc-mh { display: block; margin: 0; min-height: 22px; line-height: 22px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; position: relative; user-select: text; }
.dc-mh-name { font-size: 16px; font-weight: 500; color: var(--dc-strong); cursor: pointer; }
.dc-mh-name:hover { text-decoration: underline; }
.dc-mh-name.dc-bot { color: var(--dc-bot); }
.dc-mh-time { margin-left: 4px; font-size: 12px; font-weight: 500; color: var(--dc-muted); cursor: default; }
.dc-tag {
  display: inline-flex; align-items: center; gap: 2px; height: 15px; padding: 0 4px 0 2px; margin-left: 4px; border-radius: 4px; vertical-align: 2px;
  background: var(--dc-brand); color: #fff; font-size: 10px; font-weight: 600; line-height: 15px; text-transform: uppercase; letter-spacing: .02em;
}
.dc-tag::before { content: ""; width: 12px; height: 12px; background: #fff; -webkit-mask: ${M_CHECK} center/9px no-repeat; mask: ${M_CHECK} center/9px no-repeat; }
.dc-reply { position: relative; display: flex; align-items: center; gap: 4px; height: 18px; margin: 0 0 4px; font-size: 14px; line-height: 18px; color: var(--dc-subtle); cursor: pointer; min-width: 0; user-select: none; }
.dc-reply::before {
  content: ""; position: absolute; left: -38px; top: 8px; width: 32px; height: 12px; box-sizing: border-box;
  border-left: 2px solid var(--dc-line-3); border-top: 2px solid var(--dc-line-3); border-top-left-radius: 6px;
}
.dc-reply .dc-av { width: 16px; height: 16px; font-size: 8px; }
.dc-reply .dc-reply-name { flex: none; font-weight: 500; color: var(--dc-strong); }
.dc-reply .dc-reply-name.dc-bot { color: var(--dc-bot); }
.dc-reply .dc-reply-text { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-reply:hover .dc-reply-text { color: var(--dc-strong); }
.dc-fwd { display: block; margin: 2px 0 4px; padding: 0 0 0 12px; border-left: 4px solid var(--dc-mod-3); border-radius: 4px; }
.dc-fwd-head { display: flex; align-items: center; gap: 4px; margin: 0 0 2px; font-size: 14px; font-style: italic; color: var(--dc-muted); }
.dc-fwd-head svg { width: 16px; height: 16px; }
.dc-fwd-body { display: block; white-space: pre-wrap; color: var(--dc-text); }
.dc-fwd-comment { margin-top: 6px !important; }
.dc-hidden { display: none !important; }
.dc-divider { display: flex; align-items: center; justify-content: center; height: 0; margin: 24px 16px 8px; border-top: 1px solid var(--dc-line-2); pointer-events: none; }
.dc-divider span { padding: 2px 4px; margin-top: -1px; background: var(--dc-chat); color: var(--dc-muted); font-size: 12px; font-weight: 600; line-height: 13px; border-radius: 8px; }
.dc-divider.dc-new-div { border-top-color: var(--dc-dnd); justify-content: flex-end; }
.dc-divider.dc-new-div span { background: var(--dc-dnd); color: #fff; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 0 4px 4px 0; margin-right: -16px; text-transform: uppercase; }
.dc-reacts { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 4px 0 2px; }
.dc-react {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px; box-sizing: border-box; border-radius: 8px; border: 1px solid transparent;
  background: var(--dc-mod-1); cursor: pointer; font: 16px/1 var(--dc-emoji); color: var(--dc-subtle); transition: border-color .1s, background-color .1s;
}
.dc-react:hover { border-color: var(--dc-line-3); }
.dc-react.dc-me { background: var(--dc-brand-15); border-color: var(--dc-brand); color: var(--dc-brand-text); }
.dc-react b { font: 600 14px/1 var(--dc-font); }
.dc-react.dc-popin { animation: dc-pop .3s ease; }
@keyframes dc-pop { 0% { transform: scale(.6) } 60% { transform: scale(1.12) } 100% { transform: scale(1) } }
.dc-react-add { width: 34px; justify-content: center; padding: 0; opacity: 0; color: var(--dc-subtle); }
.dc-react-add svg { width: 18px; height: 18px; }
:is(user-query, model-response):hover .dc-react-add { opacity: 1; }
.dc-flash { animation: dc-flash 2s ease forwards; }
@keyframes dc-flash { 0%, 50% { box-shadow: inset 2px 0 0 var(--dc-brand); background: var(--dc-brand-10) !important; } 100% { box-shadow: inset 2px 0 0 transparent; } }
.dc-found { background: color-mix(in srgb, var(--dc-idle) 10%, transparent) !important; box-shadow: inset 2px 0 0 var(--dc-idle); }
.dc-deleted { display: none !important; }
body.dc-show-deleted .dc-deleted { display: block !important; opacity: .35; }
#dc-msgbar {
  position: absolute; top: -16px; right: 14px; z-index: 5; display: flex; align-items: center; padding: 2px; gap: 0; border-radius: 8px;
  background: var(--dc-high); border: 1px solid var(--dc-line-2); box-shadow: 0 1px 4px rgba(0, 0, 0, .14);
}
#dc-msgbar button { width: 32px; height: 32px; border: 0; border-radius: 6px; background: transparent; color: var(--dc-subtle); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
#dc-msgbar button:hover { background: var(--dc-mod-2); color: var(--dc-strong); }
#dc-msgbar button svg { width: 20px; height: 20px; }
#dc-msgbar .dc-mb-emo { font: 18px/1 var(--dc-emoji); }
#dc-msgbar .dc-mb-sep { width: 1px; height: 20px; margin: 0 4px; background: var(--dc-line-2); }

/* ---------- 7. New chat = the start of a channel ---------- */
body.dc-on .modular-zero-state-container { justify-content: flex-end !important; align-items: stretch !important; padding: 16px 16px 8px !important; box-sizing: border-box !important; }
body.dc-on modular-zero-state .top-section-container { height: auto !important; min-height: 0 !important; flex: none !important; padding: 0 !important; margin: 0 !important; width: 100% !important; }
body.dc-on modular-zero-state .modular-zero-state-container > div:not(.top-section-container, .scroll-container, .blur-bg) { display: none !important; }
body.dc-on modular-zero-state :is(.scroll-container, .bottom-section-container) { flex: none !important; height: auto !important; overflow: visible !important; padding: 0 !important; margin: 0 !important; width: 100% !important; }
body.dc-on modular-zero-state :is(zero-state-block-picker, .zero-state-block-container) { width: 100% !important; max-width: 100% !important; padding: 0 !important; margin: 0 !important; display: block !important; }
body.dc-on assistant-messages-primary { display: block; position: relative; width: 100% !important; max-width: none; margin: 0 0 12px !important; padding: 84px 0 0 !important; box-sizing: border-box; }
body.dc-on assistant-messages-primary::before { content: ""; position: absolute; left: 0; top: 0; width: 68px; height: 68px; border-radius: 50%; background: var(--dc-high); }
body.dc-on assistant-messages-primary::after { content: ""; position: absolute; left: 16px; top: 16px; width: 36px; height: 36px; background: var(--dc-strong); -webkit-mask: ${M_HASH} center/36px no-repeat; mask: ${M_HASH} center/36px no-repeat; }
body.dc-on assistant-messages-primary :is(.assistant-messages-primary-container, .content-container, .lm-mobile-sparkle-and-text, .content-wrapper) {
  width: 100% !important; max-width: 100% !important; padding: 0 !important; margin: 0 !important; display: block !important; text-align: left !important;
}
body.dc-on assistant-messages-primary h1 { margin: 0 !important; padding: 0 !important; font-size: 16px !important; line-height: 22px !important; font-weight: 400 !important; color: var(--dc-muted) !important; text-align: left !important; }
body.dc-on assistant-messages-primary h1::before { content: "Welcome to #new-chat!"; display: block; margin: 0 0 8px; font-size: 32px; line-height: 40px; font-weight: 800; color: var(--dc-strong); }
body.dc-on assistant-messages-primary h1 .message-text { color: var(--dc-muted) !important; -webkit-text-fill-color: currentColor !important; background: none !important; font-size: 16px !important; font-weight: 400 !important; }
body.dc-on assistant-messages-primary h1 .message-text::before { content: "This is the start of the #new-chat channel. "; }
body.dc-on suggestion-block { display: block; width: 100% !important; max-width: 440px; margin: 8px 0 0 !important; }
body.dc-on suggestion-block .suggestion-block-container { display: flex !important; flex-direction: column !important; gap: 8px !important; padding: 0 !important; margin: 0 !important; width: 100% !important; align-items: stretch !important; }
body.dc-on suggestion { display: block !important; width: 100% !important; margin: 0 !important; }
body.dc-on suggestion .suggestion-container { width: 100% !important; margin: 0 !important; position: relative; }
body.dc-on suggestion .card-button {
  width: 100% !important; min-height: 56px !important; height: auto !important; padding: 10px 44px 10px 12px !important; justify-content: flex-start !important; gap: 12px !important;
  border: 0 !important; border-radius: 8px !important; color: var(--dc-strong) !important; background: var(--dc-low) !important; box-shadow: none !important; position: relative;
  transition: background-color .1s !important;
}
body.dc-on suggestion .card-button:hover { background: var(--dc-high) !important; }
body.dc-on suggestion .card-button::after { content: ""; position: absolute; right: 16px; top: 50%; width: 20px; height: 20px; margin-top: -10px; background: var(--dc-subtle); -webkit-mask: ${M_CHEVR} center/20px no-repeat; mask: ${M_CHEVR} center/20px no-repeat; }
body.dc-on suggestion .card-text { color: var(--dc-strong) !important; font-size: 16px !important; font-weight: 600 !important; text-align: left !important; white-space: normal !important; }
body.dc-on suggestion .suggestion-icon { display: inline-flex !important; align-items: center; justify-content: center; width: 36px !important; height: 36px !important; flex: none; border-radius: 50%; background: var(--dc-brand) !important; color: #fff !important; }
body.dc-on suggestion .dismiss-suggestion-button { display: none !important; }
/* temporary chat = a message only you can see */
body.dc-on zero-state-v2 { display: flex !important; align-items: flex-end !important; justify-content: flex-start !important; min-height: 100% !important; padding: 16px !important; box-sizing: border-box; }
body.dc-on zero-state-v2 > div { display: block !important; height: auto !important; transform: none !important; position: static !important; margin: 0 !important; width: 100%; }
body.dc-on .temporary-chat-card-container { margin: 0 !important; padding: 0 !important; width: auto !important; position: static !important; display: flex !important; justify-content: flex-start !important; }
body.dc-on .temporary-chat-header { display: none !important; }
body.dc-on .temporary-chat-card {
  max-width: 520px; margin: 0; padding: 12px 16px 12px 16px !important; gap: 6px !important; border-radius: 8px; box-sizing: border-box; display: flex !important; flex-direction: column !important;
  align-items: flex-start !important; text-align: left !important; background: var(--dc-low) !important; border-left: 4px solid var(--dc-brand); color: var(--dc-text) !important;
  animation: none !important; opacity: 1 !important; transform: none !important;
}
body.dc-on .temporary-chat-card gem-icon { display: none !important; }
body.dc-on .temporary-chat-card .gds-display-m { font-size: 0 !important; line-height: 0 !important; margin: 0 !important; }
body.dc-on .temporary-chat-card .gds-display-m::before { content: "Temporary chat"; font-size: 16px; line-height: 20px; font-weight: 700; color: var(--dc-strong); }
body.dc-on .temporary-chat-card .description { font-size: 14px !important; line-height: 20px !important; color: var(--dc-text) !important; margin: 0 !important; text-align: left !important; }
body.dc-on .temporary-chat-card::after { content: "Only you can see this • Gone when you leave"; font-size: 12px; line-height: 16px; color: var(--dc-muted); }
body.dc-on .zero-state-container { max-width: none !important; width: 100% !important; align-self: stretch !important; }

/* ---------- 8. Message box = Discord's chat input ---------- */
body.dc-on input-container { padding: 0 8px 24px !important; position: relative !important; }
body.dc-on .input-area-container, body.dc-on .input-area-container.is-zero-state {
  position: relative !important; inset: auto !important; transform: none !important; width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; box-sizing: border-box !important;
}
body.dc-on :is(input-area-v2, input-area-v2 .input-area, input-area-v2 .input-area-fieldset) {
  background: transparent !important; box-shadow: none !important; border: 0 !important; width: 100% !important; max-width: 100% !important;
}
body.dc-on input-area-v2 .input-area-fieldset { position: relative !important; padding: 0 !important; margin: 0 !important; box-sizing: border-box !important; }
body.dc-on input-area-v2 .text-input-field {
  position: relative !important; display: grid !important; overflow: visible !important;
  grid-template-areas: "fp fp fp fp fp" "lead text model trail send" !important;
  grid-template-columns: auto minmax(0, 1fr) auto auto auto !important; grid-template-rows: auto auto !important;
  align-items: start !important; column-gap: 0 !important; row-gap: 0 !important;
  min-height: 56px !important; padding: 0 8px 0 0 !important; box-sizing: border-box !important;
  background: var(--dc-input) !important; border: 1px solid var(--dc-line) !important; border-radius: 8px !important; box-shadow: none !important; outline: none !important;
}
body.dc-on input-area-v2 :is(.single-line-format, .text-input-field_textarea-wrapper) { grid-area: text !important; align-self: stretch !important; padding: 0 !important; margin: 0 !important; min-width: 0 !important; }
body.dc-on input-area-v2 .text-input-field-main-area { padding: 0 !important; margin: 0 !important; }
body.dc-on input-area-v2 .leading-actions-wrapper { grid-area: lead !important; margin: 12px 4px 0 12px !important; align-self: start !important; }
body.dc-on input-area-v2 .trailing-actions-wrapper { display: contents !important; }
body.dc-on input-area-v2 .model-picker-container { grid-area: model !important; margin: 12px 4px 0 0 !important; align-self: start !important; }
body.dc-on input-area-v2 .dc-cbtns { grid-area: trail !important; display: flex; align-items: center; gap: 2px; margin: 12px 0 0; }
body.dc-on input-area-v2 .input-buttons-wrapper-top { display: none !important; }
body.dc-on input-area-v2 :is(simplified-input-menu, .simplified-input-menu-container) { width: auto !important; min-width: 32px !important; }
body.dc-on .ql-editor, body.dc-on rich-textarea { color: var(--dc-text) !important; caret-color: var(--dc-text); }
body.dc-on input-area-v2 .ql-editor { font-size: var(--dc-msg) !important; line-height: 22px !important; padding: 16px 8px 16px 4px !important; min-height: 54px !important; box-sizing: border-box !important; max-height: 50vh !important; }
body.dc-on input-area-v2 .ql-editor.ql-blank::before { content: var(--dc-ph, "Message #new-chat") !important; color: var(--dc-muted) !important; font-style: normal !important; left: 4px !important; right: 8px !important; font-size: var(--dc-msg) !important; line-height: 22px !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
body.dc-on input-area-v2 file-preview-container, body.dc-on input-area-v2 .file-preview-wrapper { grid-area: fp !important; padding: 12px 12px 0 !important; }
body.dc-on input-area-v2 .leading-actions-wrapper :is(.menu-button button, button.mat-mdc-icon-button) { width: 32px !important; height: 32px !important; padding: 4px !important; color: var(--dc-subtle) !important; background: none !important; }
body.dc-on input-area-v2 .leading-actions-wrapper .menu-button gem-icon {
  width: 24px !important; height: 24px !important; background: currentColor; -webkit-mask: ${M_PLUSC} center/24px no-repeat; mask: ${M_PLUSC} center/24px no-repeat;
}
body.dc-on input-area-v2 .leading-actions-wrapper .menu-button gem-icon mat-icon { opacity: 0 !important; }
body.dc-on input-area-v2 .leading-actions-wrapper button:hover { color: var(--dc-strong) !important; }
body.dc-on input-area-v2 .model-picker-container :is(bard-mode-switcher, .pill-ui-logo-container) { display: block !important; margin: 0 !important; padding: 0 !important; background: none !important; }
body.dc-on input-area-v2 .model-picker-container button.input-area-switch {
  height: 32px !important; min-width: 0 !important; padding: 0 6px 0 8px !important; border-radius: 8px !important; border: 0 !important;
  background: transparent !important; color: var(--dc-subtle) !important; box-shadow: none !important;
}
body.dc-on input-area-v2 .model-picker-container button.input-area-switch:hover { background: var(--dc-mod-1) !important; color: var(--dc-strong) !important; }
body.dc-on input-area-v2 .model-picker-container .mdc-button__label { display: flex !important; align-items: center !important; gap: 2px; }
body.dc-on input-area-v2 .model-picker-container .mdc-button__label::after {
  content: ""; width: 16px; height: 16px; flex: none; background: currentColor; -webkit-mask: ${M_CHEV} center/14px no-repeat; mask: ${M_CHEV} center/14px no-repeat;
}
body.dc-on input-area-v2 .model-picker-container :is(.picker-primary-text, .picker-secondary-text) { color: inherit !important; font-size: 14px !important; font-weight: 500 !important; margin: 0 !important; }
body.dc-on input-area-v2 .model-picker-container .logo-pill-label-container:has(.picker-secondary-text:not(:empty)) .picker-primary-text { display: none !important; }
body.dc-on input-area-v2 .model-picker-container :is(.dropdown-icon, .mat-mdc-button-persistent-ripple, .mat-focus-indicator) { display: none !important; }
body.dc-on input-area-v2 .input-buttons-wrapper-bottom {
  grid-area: send !important; position: static !important; display: flex !important; align-items: center !important; justify-content: center !important;
  width: auto !important; height: auto !important; margin: 12px 0 0 2px !important; padding: 0 !important; background: none !important; box-shadow: none !important; border-radius: 0 !important;
}
body.dc-on input-area-v2 .input-buttons-wrapper-bottom > * { margin: 0 !important; }
body.dc-on input-area-v2 .input-buttons-wrapper-bottom .mic-button-container { position: absolute !important; width: 1px !important; height: 1px !important; overflow: hidden !important; opacity: 0 !important; pointer-events: none !important; }
body.dc-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container { display: none !important; }
body.dc-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container:has(.stop, [class*="stop"], [aria-label*="Stop" i]),
body.dc-on.dc-send-btn input-area-v2 .input-buttons-wrapper-bottom .send-button-container.visible { display: flex !important; }
body.dc-on input-area-v2 .input-buttons-wrapper-bottom :is(.send-button-container, gem-icon-button) { width: 32px !important; height: 32px !important; align-items: center !important; justify-content: center !important; position: static !important; background: transparent !important; box-shadow: none !important; border: 0 !important; }
body.dc-on input-area-v2 .input-buttons-wrapper-bottom button { width: 32px !important; height: 32px !important; padding: 4px !important; border-radius: 8px !important; background: transparent !important; color: var(--dc-subtle) !important; }
body.dc-on input-area-v2 .input-buttons-wrapper-bottom button:hover { background: var(--dc-mod-1) !important; color: var(--dc-strong) !important; }
body.dc-on input-area-v2 .input-buttons-wrapper-bottom gem-icon { width: 24px !important; height: 24px !important; background: currentColor; -webkit-mask: ${M_SEND} center/22px no-repeat; mask: ${M_SEND} center/22px no-repeat; }
body.dc-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container :is(.stop, [class*="stop"], [aria-label*="Stop" i]) { color: var(--dc-dnd) !important; }
body.dc-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container :is(.stop, [class*="stop"]) gem-icon,
body.dc-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container [aria-label*="Stop" i] gem-icon { -webkit-mask-image: ${M_STOP}; mask-image: ${M_STOP}; }
body.dc-on input-area-v2 .input-buttons-wrapper-bottom mat-icon { opacity: 0 !important; }
body.dc-on input-area-v2 :is(.mat-mdc-button-persistent-ripple, .mdc-icon-button__ripple) { display: none !important; }
body.dc-on prompt-flow-bar, body.dc-on .inline-upgrade-banner { max-width: none !important; margin-inline: 0 !important; }
.dc-cbtn { width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--dc-subtle); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; flex: none; }
.dc-cbtn:hover { color: var(--dc-strong); }
.dc-cbtn svg { width: 24px; height: 24px; }
.dc-cbtn.dc-emo { font: 22px/1 var(--dc-emoji); filter: grayscale(1); opacity: .65; transition: transform .1s, filter .1s, opacity .1s; }
.dc-cbtn.dc-emo:hover, .dc-cbtn.dc-emo.dc-on { filter: none; opacity: 1; transform: scale(1.14); }
#dc-replybar {
  display: none; align-items: center; gap: 8px; height: 34px; padding: 0 6px 0 16px; box-sizing: border-box; text-align: left;
  background: var(--dc-high); border: 1px solid var(--dc-line); border-bottom: 0; border-radius: 8px 8px 0 0; font-size: 14px; color: var(--dc-muted);
}
#dc-replybar.dc-show { display: flex; }
#dc-replybar .dc-rb-text { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#dc-replybar .dc-rb-text b { color: var(--dc-text); font-weight: 600; }
#dc-replybar .dc-rb-ping { border: 0; background: none; cursor: pointer; display: inline-flex; align-items: center; gap: 2px; font: 700 12px/16px var(--dc-font); color: var(--dc-brand-text); text-transform: uppercase; padding: 0 8px; }
#dc-replybar .dc-rb-ping.dc-off { color: var(--dc-muted); }
#dc-replybar .dc-rb-ping svg { width: 16px; height: 16px; }
#dc-replybar .dc-rb-x { width: 24px; height: 24px; border: 0; border-radius: 50%; background: none; color: var(--dc-subtle); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
#dc-replybar .dc-rb-x:hover { color: var(--dc-strong); }
#dc-replybar .dc-rb-x svg { width: 18px; height: 18px; }
body.dc-on #dc-replybar.dc-show + input-area-v2 .text-input-field { border-top-left-radius: 0 !important; border-top-right-radius: 0 !important; }
#dc-typing { position: absolute; left: 24px; right: 16px; bottom: 3px; height: 18px; display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 18px; color: var(--dc-subtle); pointer-events: none; opacity: 0; transition: opacity .15s; }
#dc-typing.dc-show { opacity: 1; }
#dc-typing b { font-weight: 700; color: var(--dc-strong); }
.dc-dots { display: inline-flex; gap: 3px; align-items: center; }
.dc-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--dc-strong); opacity: .3; animation: dc-dot 1.2s infinite; }
.dc-dots i:nth-child(2) { animation-delay: .2s; } .dc-dots i:nth-child(3) { animation-delay: .4s; }
@keyframes dc-dot { 0%, 60%, 100% { opacity: .3; transform: scale(.85); } 30% { opacity: 1; transform: scale(1); } }
#dc-jump {
  position: absolute; left: 24px; right: 24px; bottom: calc(100% - 4px); height: 32px; display: none; align-items: center; justify-content: space-between; padding: 0 12px 4px;
  box-sizing: border-box; border-radius: 8px 8px 0 0; background: var(--dc-highest); color: var(--dc-text); font-size: 14px; font-weight: 500; cursor: pointer;
}
body.dc-light #dc-jump { background: var(--dc-low); box-shadow: 0 0 0 1px var(--dc-line); }
#dc-jump.dc-show { display: flex; }
#dc-jump b { display: flex; align-items: center; gap: 4px; font-weight: 600; color: var(--dc-strong); }
#dc-jump b svg { width: 16px; height: 16px; }
#dc-newbar {
  position: fixed; z-index: 899; height: 26px; display: none; align-items: center; justify-content: space-between; padding: 0 12px; box-sizing: border-box;
  border-radius: 0 0 8px 8px; background: var(--dc-brand); color: #fff; font-size: 14px; font-weight: 500; cursor: pointer;
}
#dc-newbar.dc-show { display: flex; }
#dc-newbar b { display: flex; align-items: center; gap: 4px; font-weight: 700; }
#dc-newbar b svg { width: 16px; height: 16px; }

/* ---------- 9. Menus, popouts, tooltips (ours and Gemini's) ---------- */
.dc-ui, .dc-ui * { box-sizing: border-box; }
.dc-ui { color: var(--dc-text); font-family: var(--dc-font); }
.dc-iconbtn { width: 32px; height: 32px; border-radius: 8px; border: 0; background: transparent; color: var(--dc-subtle); flex: none; padding: 0; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.dc-iconbtn:hover { background: var(--dc-mod-1); color: var(--dc-strong); }
.dc-backdrop { position: fixed; inset: 0; z-index: 2147483000; }
.dc-menu-wrap { position: fixed; z-index: 2147483001; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.dc-menu {
  position: relative; min-width: 188px; max-width: 340px; padding: 8px; border-radius: 8px; background: var(--dc-float); border: 1px solid var(--dc-line-3);
  box-shadow: var(--dc-shadow); color: var(--dc-subtle); user-select: none; transform-origin: var(--dc-origin, top left); animation: dc-menu-in .1s ease-out;
}
@keyframes dc-menu-in { from { opacity: 0; transform: scale(.96); } }
.dc-menu.dc-sub { position: fixed; z-index: 2147483002; }
.dc-mi {
  display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; margin: 0; padding: 8px; border: 0; border-radius: 4px; background: none;
  color: inherit; font: 500 14px/18px var(--dc-font); text-align: left; cursor: pointer; white-space: nowrap;
}
.dc-mi svg { width: 20px; height: 20px; }
.dc-mi:hover, .dc-mi.dc-hl { background: var(--dc-mod-1); color: var(--dc-strong); }
.dc-mi.dc-danger { color: var(--dc-red-text); }
.dc-mi.dc-danger:hover { background: color-mix(in srgb, var(--dc-red) 12%, transparent); color: var(--dc-red-text); }
.dc-mi.dc-brandi { color: var(--dc-brand-text); }
.dc-mi .dc-mi-end { margin-left: auto; padding-left: 16px; color: var(--dc-muted); display: inline-flex; font-size: 12px; }
.dc-mi .dc-mi-end svg { width: 16px; height: 16px; }
.dc-mi img.dc-photo, .dc-mi .dc-av { width: 20px; height: 20px; font-size: 9px; }
.dc-mi.dc-acc { color: var(--dc-strong); }
.dc-menu hr { height: 0; border: 0; border-top: 1px solid var(--dc-line-2); margin: 8px 0; }
.dc-menu-foot { padding: 4px 8px 2px; color: var(--dc-muted); font-size: 12px; font-weight: 500; white-space: normal; }
.dc-reactbar { display: flex; gap: 6px; padding: 0 0 8px; margin: 0 0 8px; border-bottom: 1px solid var(--dc-line-2); }
.dc-reactbar button {
  width: 40px; height: 40px; border: 0; border-radius: 8px; background: var(--dc-mod-1); font: 22px/1 var(--dc-emoji); cursor: pointer; padding: 0;
  display: inline-flex; align-items: center; justify-content: center; transition: background-color .1s, transform .1s;
}
.dc-reactbar button:hover { background: var(--dc-mod-3); transform: scale(1.06); }
.dc-reactbar button.dc-on { background: var(--dc-brand-15); box-shadow: inset 0 0 0 1px var(--dc-brand); }
.dc-pop { position: fixed; z-index: 2147483001; display: flex; flex-direction: column; border-radius: 8px; background: var(--dc-float); border: 1px solid var(--dc-line-2); box-shadow: var(--dc-shadow); overflow: hidden; animation: dc-menu-in .1s ease-out; }
.dc-pop-head { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 0 12px 0 16px; border-bottom: 1px solid var(--dc-line); font-size: 16px; font-weight: 600; color: var(--dc-strong); flex: none; }
.dc-pop-head > svg { width: 22px; height: 22px; color: var(--dc-subtle); }
.dc-pop-head span { flex: 1; }
.dc-pop-body { overflow-y: auto; padding: 12px 0 4px; }
.dc-empty { padding: 28px 24px 32px; text-align: center; color: var(--dc-muted); font-size: 14px; line-height: 20px; }
.dc-empty .dc-empty-art { display: flex; align-items: center; justify-content: center; width: 72px; height: 72px; margin: 0 auto 14px; border-radius: 50%; background: var(--dc-mod-1); color: var(--dc-subtle); }
.dc-empty .dc-empty-art svg { width: 36px; height: 36px; }
.dc-empty b { display: block; margin-bottom: 4px; font-size: 16px; color: var(--dc-strong); font-weight: 600; }
.dc-tabs { display: flex; gap: 6px; padding: 0 16px 10px; border-bottom: 1px solid var(--dc-line); }
.dc-ib-item { display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; cursor: pointer; border-bottom: 1px solid var(--dc-line); }
.dc-ib-item:hover { background: var(--dc-mod-1); }
.dc-ib-t { flex: 1; min-width: 0; }
.dc-ib-chan { display: flex; align-items: center; gap: 4px; margin-bottom: 2px; font-size: 12px; font-weight: 600; line-height: 16px; color: var(--dc-muted); }
.dc-ib-chan svg { width: 14px; height: 14px; }
.dc-ib-chan span:first-of-type { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-ib-item .dc-card-text { -webkit-line-clamp: 2; }
.dc-tab { height: 26px; padding: 0 8px; border: 0; border-radius: 6px; background: none; color: var(--dc-subtle); font: 500 14px/26px var(--dc-font); cursor: pointer; }
.dc-tab:hover { background: var(--dc-mod-1); color: var(--dc-text); }
.dc-tab.dc-on { background: var(--dc-mod-2); color: var(--dc-strong); }
#dc-tip {
  position: fixed; z-index: 2147483100; pointer-events: none; max-width: 260px; padding: 8px 12px; border-radius: 8px; background: var(--dc-tip); border: 1px solid var(--dc-line-3);
  box-shadow: var(--dc-shadow); color: var(--dc-strong); font: 600 14px/18px var(--dc-font); opacity: 0; transform: scale(.96); transition: opacity .08s, transform .08s; white-space: pre-line;
}
#dc-tip.dc-show { opacity: 1; transform: none; }
#dc-tip .dc-tip-sub { display: block; font-size: 12px; font-weight: 500; color: var(--dc-muted); }

body.dc-on .cdk-overlay-pane :is(.mat-mdc-menu-panel, .mat-mdc-select-panel),
body.dc-on .cdk-overlay-popover .cdk-overlay-pane > .container,
body.dc-on .cdk-overlay-popover gem-menu:not(.cdk-overlay-popover .container gem-menu) {
  background: var(--dc-float) !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; border: 1px solid var(--dc-line-3) !important;
  border-radius: 8px !important; box-shadow: var(--dc-shadow) !important; padding: 8px !important; min-width: 188px !important; overflow: hidden;
}
body.dc-on .cdk-overlay-popover .cdk-overlay-pane > .container :is(gem-menu, .popover-menu) { background: transparent !important; box-shadow: none !important; padding: 0 !important; min-width: 0 !important; border: 0 !important; }
body.dc-on .mat-mdc-menu-content { padding: 0 !important; }
body.dc-on .cdk-overlay-pane .mat-mdc-menu-item, body.dc-on .cdk-overlay-popover gem-menu-item {
  min-height: 36px !important; margin: 0 !important; width: 100% !important; padding: 0 8px !important; border-radius: 4px !important; box-sizing: border-box !important;
  background: transparent !important; color: var(--dc-subtle) !important;
}
body.dc-on .cdk-overlay-popover gem-menu-item { padding: 0 !important; }
body.dc-on .cdk-overlay-popover gem-menu-item-content { min-height: 36px !important; padding: 6px 8px !important; border-radius: 4px !important; gap: 8px !important; background: transparent !important; }
body.dc-on .cdk-overlay-pane .mat-mdc-menu-item:hover, body.dc-on .cdk-overlay-popover gem-menu-item-content:hover, body.dc-on .cdk-overlay-popover gem-menu-item-content.active {
  background: var(--dc-mod-1) !important; color: var(--dc-strong) !important;
}
body.dc-on :is(.cdk-overlay-pane .mat-mdc-menu-item, .cdk-overlay-popover gem-menu-item) :is(.mat-mdc-menu-item-text, .gem-menu-item-label, .label, span) { font-size: 14px !important; font-weight: 500 !important; color: inherit !important; }
body.dc-on .cdk-overlay-popover gem-menu-item .sublabel { font-size: 12px !important; font-weight: 400 !important; color: var(--dc-muted) !important; }
body.dc-on :is(.cdk-overlay-pane .mat-mdc-menu-item, .cdk-overlay-popover gem-menu-item) mat-icon { color: inherit !important; font-size: 20px !important; width: 20px !important; height: 20px !important; }
body.dc-on :is(.cdk-overlay-pane .mat-mdc-menu-item, .cdk-overlay-popover gem-menu-item) :is(.gem-menu-item-icon, .leading-container) { margin-right: 4px !important; }
body.dc-on .cdk-overlay-pane .mat-mdc-menu-item .mat-mdc-menu-ripple, body.dc-on .cdk-overlay-pane .mat-mdc-menu-item::before { display: none !important; }
body.dc-on .cdk-overlay-pane .settings-menu-section-header { padding: 8px 8px 4px !important; color: var(--dc-muted) !important; font-size: 12px !important; font-weight: 700 !important; text-transform: uppercase; }
body.dc-on .cdk-overlay-pane :is(.mat-mdc-menu-item[data-test-id="delete-button"], [data-test-id="delete-button"]),
body.dc-on .cdk-overlay-popover gem-menu-item[data-test-id="delete-button"] * { color: var(--dc-red-text) !important; }
body.dc-on :is(.mat-divider, mat-divider) { border-top-color: var(--dc-line-2) !important; margin: 8px 0 !important; }
body.dc-on .mat-mdc-dialog-surface, body.dc-on .mdc-dialog__surface {
  background: var(--dc-high) !important; border: 1px solid var(--dc-line-2) !important; border-radius: 12px !important; box-shadow: var(--dc-shadow) !important; color: var(--dc-text) !important;
}
body.dc-on .mat-mdc-dialog-container .mdc-dialog__title { font-size: 20px !important; font-weight: 600 !important; color: var(--dc-strong) !important; }
body.dc-on .mat-mdc-dialog-actions button { border-radius: 8px !important; font-weight: 500 !important; }
body.dc-on .cdk-overlay-dark-backdrop.cdk-overlay-backdrop-showing { background: rgba(0, 0, 0, .7) !important; }
body.dc-on .mdc-tooltip__surface { background: var(--dc-tip) !important; color: var(--dc-strong) !important; border: 1px solid var(--dc-line-3); border-radius: 8px !important; font-size: 14px !important; font-weight: 600 !important; }
body.dc-on :is(g1-dynamic-upsell-button button, .gem-button-type-filled button, button.mdc-button--unelevated) { background: var(--dc-brand) !important; color: #fff !important; border-radius: 8px !important; }
body.dc-on .gem-button-type-tonal button { background: var(--dc-mod-2) !important; color: var(--dc-strong) !important; }

/* ---------- 10. Modals, buttons, form rows ---------- */
.dc-modal-back { position: fixed; inset: 0; z-index: 2147483002; background: rgba(0, 0, 0, .7); display: flex; align-items: center; justify-content: center; animation: dc-fade .15s; }
@keyframes dc-fade { from { opacity: 0 } }
.dc-modal {
  position: relative; width: min(440px, calc(100vw - 32px)); max-height: 82vh; display: flex; flex-direction: column; background: var(--dc-high); color: var(--dc-text);
  border: 1px solid var(--dc-line-2); border-radius: 12px; box-shadow: var(--dc-shadow); overflow: hidden; animation: dc-modal-in .2s cubic-bezier(.2, 1.2, .4, 1);
}
@keyframes dc-modal-in { from { opacity: 0; transform: scale(.9); } }
.dc-modal > h3 { margin: 0; padding: 24px 56px 8px 24px; font-size: 20px; font-weight: 600; line-height: 24px; color: var(--dc-strong); }
.dc-modal p { margin: 0; padding: 0 24px 12px; font-size: 16px; line-height: 22px; color: var(--dc-text); }
.dc-modal p.dc-note { font-size: 14px; line-height: 20px; color: var(--dc-muted); }
.dc-modal .dc-modal-x { position: absolute; top: 16px; right: 16px; }
.dc-modal .dc-modal-body { overflow-y: auto; padding: 0 16px 8px; }
.dc-modal .dc-quote { margin: 4px 24px 16px; padding: 12px 12px 12px 64px; position: relative; border-radius: 8px; background: var(--dc-chat); border: 1px solid var(--dc-line); box-shadow: 0 0 0 1px rgba(0,0,0,.04); }
.dc-modal .dc-quote > .dc-avw { position: absolute; left: 12px; top: 12px; }
.dc-modal .dc-quote .dc-card-text { -webkit-line-clamp: 3; }
.dc-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding: 16px; margin-top: 8px; background: var(--dc-low); border-top: 1px solid var(--dc-line); }
body.dc-light .dc-actions { background: var(--dc-frame); }
.dc-btn { height: 38px; min-width: 96px; padding: 0 16px; border: 0; border-radius: 8px; font: 500 14px/16px var(--dc-font); cursor: pointer; background: var(--dc-brand); color: #fff; transition: background-color .15s, color .15s; white-space: nowrap; }
.dc-btn:hover { background: var(--dc-brand-h); }
.dc-btn.dc-sec { background: var(--dc-mod-2); color: var(--dc-strong); }
.dc-btn.dc-sec:hover { background: var(--dc-mod-3); }
.dc-btn.dc-red { background: var(--dc-red); color: #fff; }
.dc-btn.dc-red:hover { background: color-mix(in srgb, var(--dc-red) 85%, #000); }
.dc-btn.dc-outline-red { background: none; box-shadow: inset 0 0 0 1px var(--dc-red); color: var(--dc-red-text); }
.dc-btn.dc-outline-red:hover { background: var(--dc-red); color: #fff; }
.dc-btn.dc-linkbtn { background: none; min-width: 0; color: var(--dc-strong); }
.dc-btn.dc-linkbtn:hover { text-decoration: underline; background: none; }
.dc-btn.dc-sm { height: 32px; min-width: 60px; padding: 0 12px; }
.dc-btn.dc-green { background: #248046; }
.dc-btn.dc-green:hover { background: #1a6334; }
.dc-btn:disabled { opacity: .5; cursor: not-allowed; }
.dc-switch { position: relative; flex: none; width: 40px; height: 24px; border-radius: 12px; background: #80848e; cursor: pointer; transition: background-color .2s; }
.dc-switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .2s var(--dc-ease); box-shadow: 0 1px 2px rgba(0,0,0,.2); }
.dc-switch.dc-on { background: var(--dc-brand); }
.dc-switch.dc-on::after { transform: translateX(16px); }
.dc-input { width: 100%; height: 40px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--dc-line-2); background: var(--dc-input); color: var(--dc-text); font: 400 16px/20px var(--dc-font); outline: 0; }
.dc-input:focus { border-color: var(--dc-brand); }
.dc-pick { display: flex; align-items: center; gap: 12px; height: 48px; padding: 0 10px; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 500; color: var(--dc-text); }
.dc-pick:hover { background: var(--dc-mod-1); }
.dc-pick span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-pick-check { margin-left: auto; width: 24px; height: 24px; flex: none; border-radius: 6px; border: 2px solid var(--dc-line-3); }
.dc-pick.dc-on .dc-pick-check { background: var(--dc-brand); border-color: var(--dc-brand); }

/* user settings, full screen like Discord */
#dc-settings { position: fixed; inset: 0; z-index: 2147482000; display: flex; background: var(--dc-chat); color: var(--dc-text); font-family: var(--dc-font); animation: dc-set-in .22s var(--dc-ease); }
@keyframes dc-set-in { from { opacity: 0; transform: scale(1.06); } }
#dc-settings.dc-closing { animation: dc-set-out .16s var(--dc-ease) forwards; pointer-events: none; }
@keyframes dc-set-out { to { opacity: 0; transform: scale(1.06); } }
.dc-set-side { flex: 1 0 218px; display: flex; justify-content: flex-end; background: var(--dc-frame); overflow-y: auto; scrollbar-width: thin; }
.dc-set-nav { width: 218px; padding: 60px 6px 60px 20px; box-sizing: content-box; }
.dc-set-find { display: flex; align-items: center; gap: 6px; height: 32px; margin: 0 0 14px; padding: 0 8px; border-radius: 8px; background: var(--dc-low); border: 1px solid var(--dc-line); color: var(--dc-muted); }
.dc-set-find input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; color: var(--dc-text); font: 400 14px/18px var(--dc-font); }
.dc-set-find svg { width: 16px; height: 16px; }
.dc-set-h { padding: 12px 10px 6px; font-size: 12px; font-weight: 700; line-height: 16px; text-transform: uppercase; color: var(--dc-muted); letter-spacing: .02em; }
.dc-set-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 32px; padding: 6px 10px; margin: 0 0 2px; border-radius: 6px; font-size: 16px; font-weight: 500; line-height: 20px; color: var(--dc-subtle); cursor: pointer; }
.dc-set-item:hover { background: var(--dc-mod-1); color: var(--dc-text); }
.dc-set-item.dc-on { background: var(--dc-mod-2); color: var(--dc-strong); }
.dc-set-item.dc-danger { color: var(--dc-red-text); }
.dc-set-item svg { width: 16px; height: 16px; }
.dc-set-sep { height: 1px; margin: 8px 10px; background: var(--dc-line-2); }
.dc-set-ver { padding: 8px 10px; font-size: 12px; line-height: 16px; color: var(--dc-muted); }
.dc-set-main { flex: 1 1 800px; display: flex; min-width: 0; background: var(--dc-chat); }
.dc-set-scroll { flex: 1; overflow-y: auto; }
.dc-set-content { max-width: 740px; min-width: 0; padding: 60px 40px 80px; }
.dc-set-close { flex: none; width: 72px; padding-top: 60px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.dc-set-close button { width: 36px; height: 36px; border-radius: 50%; border: 2px solid var(--dc-subtle); background: transparent; color: var(--dc-subtle); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.dc-set-close button:hover { background: var(--dc-mod-2); color: var(--dc-strong); border-color: var(--dc-strong); }
.dc-set-close button svg { width: 18px; height: 18px; stroke-width: 2.4; }
.dc-set-close span { font-size: 13px; font-weight: 600; color: var(--dc-muted); }
.dc-set-content h2 { margin: 0 0 20px; font-size: 20px; font-weight: 600; line-height: 24px; color: var(--dc-strong); }
.dc-set-content h3 { margin: 0 0 8px; font-size: 16px; font-weight: 600; line-height: 20px; color: var(--dc-strong); }
.dc-set-label { margin: 0 0 8px; font-size: 12px; font-weight: 700; line-height: 16px; text-transform: uppercase; color: var(--dc-subtle); letter-spacing: .02em; }
.dc-set-desc { margin: 0 0 16px; font-size: 14px; line-height: 20px; color: var(--dc-muted); }
.dc-set-div { height: 1px; margin: 32px 0; background: var(--dc-line-2); }
.dc-field { display: flex; align-items: center; gap: 16px; padding: 0 0 20px; margin: 0 0 20px; border-bottom: 1px solid var(--dc-line); }
.dc-field.dc-click { cursor: pointer; }
.dc-field-t { flex: 1; min-width: 0; }
.dc-field-l { font-size: 16px; font-weight: 500; line-height: 22px; color: var(--dc-strong); }
.dc-field-d { margin-top: 4px; font-size: 14px; line-height: 20px; color: var(--dc-muted); }
.dc-field-v { flex: none; max-width: 40%; font-size: 14px; color: var(--dc-subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-field > svg { width: 20px; height: 20px; color: var(--dc-muted); flex: none; }
.dc-radio-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; margin: 0 0 8px; border-radius: 8px; background: var(--dc-low); cursor: pointer; font-size: 16px; font-weight: 500; color: var(--dc-text); }
.dc-radio-row:hover { background: var(--dc-high); }
body.dc-light .dc-radio-row:hover { background: var(--dc-mod-1); }
.dc-radio-row.dc-on { background: var(--dc-mod-2); color: var(--dc-strong); }
.dc-radio { position: relative; width: 20px; height: 20px; flex: none; border-radius: 50%; border: 2px solid var(--dc-subtle); }
.dc-radio-row.dc-on .dc-radio { border-color: var(--dc-brand); }
.dc-radio-row.dc-on .dc-radio::after { content: ""; position: absolute; inset: 3px; border-radius: 50%; background: var(--dc-brand); }
.dc-radio-row small { display: block; font-size: 14px; font-weight: 400; color: var(--dc-muted); margin-top: 2px; }
.dc-swatches { display: flex; flex-wrap: wrap; gap: 16px; margin: 0 0 28px; }
.dc-swatch { display: flex; flex-direction: column; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; font-weight: 500; color: var(--dc-muted); }
.dc-swatch i { position: relative; width: 60px; height: 60px; border-radius: 50%; box-shadow: inset 0 0 0 1px var(--dc-line-3); background: var(--c); }
.dc-swatch.dc-on i { box-shadow: 0 0 0 2px var(--dc-chat), 0 0 0 4px var(--dc-brand); }
.dc-swatch.dc-on i::after { content: ""; position: absolute; top: -2px; right: -2px; width: 20px; height: 20px; border-radius: 50%; background: var(--dc-brand) ${M_CHECK} center/12px no-repeat; background-image: none; }
.dc-swatch.dc-on i::before { content: ""; position: absolute; top: 1px; right: 1px; z-index: 1; width: 14px; height: 14px; background: #fff; -webkit-mask: ${M_CHECK} center/10px no-repeat; mask: ${M_CHECK} center/10px no-repeat; }
.dc-swatch.dc-on { color: var(--dc-strong); }
.dc-dots-c { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 28px; }
.dc-dots-c button { width: 36px; height: 36px; border-radius: 50%; border: 0; cursor: pointer; background: var(--c); }
.dc-dots-c button.dc-on { box-shadow: 0 0 0 2px var(--dc-chat), 0 0 0 4px var(--c); }
.dc-range { margin: 0 0 28px; }
.dc-range input { width: 100%; accent-color: var(--dc-brand); }
.dc-range-ticks { display: flex; justify-content: space-between; font-size: 12px; color: var(--dc-muted); margin-top: 2px; }
.dc-acc { border-radius: 8px; overflow: hidden; background: var(--dc-frame); margin: 0 0 32px; }
.dc-acc-banner { height: 100px; background: var(--b); }
.dc-acc-row { display: flex; align-items: flex-end; gap: 16px; padding: 0 16px; margin-top: -40px; }
.dc-acc-row .dc-avw .dc-av { width: 80px; height: 80px; font-size: 32px; box-shadow: 0 0 0 7px var(--dc-frame); }
.dc-acc-name { flex: 1; min-width: 0; padding-bottom: 6px; font-size: 20px; font-weight: 700; color: var(--dc-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-acc-fields { margin: 16px; padding: 16px; border-radius: 8px; background: var(--dc-low); }
.dc-acc-field { display: flex; align-items: center; gap: 12px; }
.dc-acc-field + .dc-acc-field { margin-top: 24px; }
.dc-acc-field > div { flex: 1; min-width: 0; }
.dc-acc-field .dc-set-label { margin: 0 0 4px; }
.dc-acc-field .dc-acc-v { font-size: 16px; color: var(--dc-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-acc-field .dc-acc-v a { color: var(--dc-link); cursor: pointer; margin-left: 4px; font-size: 14px; }
.dc-nitro { position: relative; overflow: hidden; border-radius: 12px; padding: 28px 28px 24px; margin: 0 0 24px; color: #fff; background: linear-gradient(135deg, #2f4ad8, #8a3ff0 55%, #d0429e); }
.dc-nitro h3 { color: #fff !important; font-size: 26px !important; line-height: 32px !important; font-weight: 800 !important; margin: 0 0 8px !important; }
.dc-nitro p { margin: 0 0 18px; font-size: 16px; line-height: 22px; opacity: .92; max-width: 420px; }
.dc-nitro .dc-btn { background: #fff; color: #4b3be0; }
.dc-nitro .dc-btn:hover { background: #f0eeff; }
.dc-nitro svg.dc-i { position: absolute; right: -10px; top: -14px; width: 180px; height: 180px; opacity: .18; stroke-width: 1.2; }
.dc-kbd-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--dc-line); font-size: 16px; color: var(--dc-text); }
.dc-kbd { display: inline-block; min-width: 22px; padding: 2px 6px; margin-left: 4px; border-radius: 4px; background: var(--dc-low); border: 1px solid var(--dc-line-2); box-shadow: 0 2px 0 var(--dc-line-2); font: 600 12px/16px var(--dc-font); color: var(--dc-text); text-align: center; }

/* quick switcher (Ctrl+K) */
.dc-modal.dc-qs { width: min(570px, calc(100vw - 32px)); padding: 20px 0 0; }
.dc-qs input { display: block; width: calc(100% - 40px); height: 70px; margin: 0 20px 12px; padding: 0 16px; border: 0; border-radius: 8px; background: var(--dc-frame); color: var(--dc-text); font: 500 20px/24px var(--dc-font); outline: 0; }
body.dc-light .dc-qs input { background: var(--dc-input); }
.dc-qs-list { max-height: 300px; overflow-y: auto; padding: 0 12px 8px; }
.dc-qs-head { padding: 8px 8px 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--dc-muted); }
.dc-qs-row { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 8px; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: 500; color: var(--dc-subtle); }
.dc-qs-row.dc-sel { background: var(--dc-mod-2); color: var(--dc-strong); }
.dc-qs-row svg { width: 18px; height: 18px; color: var(--dc-chan); }
.dc-qs-row .dc-qs-name { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-qs-row .dc-qs-cat { margin-left: auto; padding-left: 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--dc-muted); white-space: nowrap; }
.dc-qs-foot { padding: 14px 20px; background: var(--dc-low); font-size: 12px; line-height: 16px; color: var(--dc-muted); border-top: 1px solid var(--dc-line); }
.dc-qs-foot b { color: var(--dc-green); font-weight: 700; }

/* emoji picker */
.dc-epick { width: 408px; height: 432px; }
.dc-epick-head { padding: 12px; border-bottom: 1px solid var(--dc-line); flex: none; }
.dc-epick-head input { width: 100%; height: 32px; border-radius: 8px; border: 0; background: var(--dc-frame); color: var(--dc-text); padding: 0 10px; font: 400 14px/18px var(--dc-font); outline: 0; }
body.dc-light .dc-epick-head input { background: var(--dc-input); }
.dc-epick-body { flex: 1; overflow-y: auto; padding: 0 8px 8px; }
.dc-epick-cat { position: sticky; top: 0; z-index: 1; padding: 12px 4px 6px; background: var(--dc-float); font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--dc-muted); }
.dc-epick-grid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 2px; }
.dc-epick-grid button { height: 40px; border: 0; border-radius: 6px; background: none; font: 28px/1 var(--dc-emoji); cursor: pointer; padding: 0; }
.dc-epick-grid button:hover { background: var(--dc-mod-2); }
.dc-epick-foot { display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 16px; background: var(--dc-low); border-top: 1px solid var(--dc-line); font-size: 16px; font-weight: 600; color: var(--dc-strong); flex: none; }
.dc-epick-foot span:first-child { font: 26px/1 var(--dc-emoji); }

/* profile popout */
.dc-prof { width: 300px; }
.dc-prof-banner { height: 60px; background: var(--b); flex: none; }
.dc-prof-av { position: absolute; left: 16px; top: 16px; }
.dc-prof-av .dc-av { width: 80px; height: 80px; font-size: 32px; box-shadow: 0 0 0 6px var(--dc-float); }
.dc-prof-av .dc-st { width: 16px; height: 16px; border-width: 5px; right: -3px; bottom: -3px; --ring: var(--dc-float); }
.dc-prof-body { padding: 52px 16px 16px; overflow-y: auto; }
.dc-prof-name { display: flex; align-items: center; font-size: 20px; font-weight: 700; line-height: 24px; color: var(--dc-strong); }
.dc-prof-user { margin-top: 2px; font-size: 14px; line-height: 18px; color: var(--dc-text); }
.dc-prof-card { margin-top: 12px; padding: 12px; border-radius: 8px; background: var(--dc-low); border: 1px solid var(--dc-line); }
body.dc-light .dc-prof-card { background: var(--dc-frame); }
.dc-prof-sec + .dc-prof-sec { margin-top: 12px; }
.dc-prof-sec h4 { margin: 0 0 4px; font-size: 12px; font-weight: 700; line-height: 16px; color: var(--dc-strong); }
.dc-prof-sec div { font-size: 14px; line-height: 18px; color: var(--dc-text); }
.dc-roles { display: flex; flex-wrap: wrap; gap: 4px; }
.dc-role { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 6px; border-radius: 4px; background: var(--dc-mod-1); font-size: 12px; font-weight: 500; color: var(--dc-text); }
.dc-role i { width: 12px; height: 12px; border-radius: 50%; background: var(--rc); }
.dc-prof-note { width: 100%; min-height: 36px; padding: 4px; border: 0; border-radius: 4px; background: transparent; color: var(--dc-text); font: 400 12px/16px var(--dc-font); resize: none; outline: 0; }
.dc-prof-note:focus { background: var(--dc-frame); }
.dc-prof-msg { margin-top: 12px; }
.dc-prof-msg input { height: 40px; font-size: 14px; }

/* status dots and avatars */
.dc-av { width: 40px; height: 40px; border-radius: 50%; flex: none; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; color: #fff; font-weight: 600; font-size: 15px; user-select: none; background: var(--avc, var(--dc-brand)); }
.dc-av img { width: 100%; height: 100%; object-fit: cover; display: block; }
img.dc-av { object-fit: cover; }
.dc-av.dc-bot { background: linear-gradient(135deg, #4c8df6, #8e6cf1 60%, #d96570); }
.dc-av svg { width: 58%; height: 58%; }
.dc-avw { position: relative; flex: none; display: inline-flex; }
.dc-st { position: absolute; right: -2px; bottom: -2px; width: 10px; height: 10px; border-radius: 50%; border: 3px solid var(--ring, var(--dc-frame)); background: var(--dc-green); box-sizing: content-box; }
.dc-st.dc-idle { background: var(--dc-idle); }
.dc-st.dc-dnd { background: var(--dc-dnd); }
.dc-st.dc-invisible { background: #80848e; box-shadow: inset 0 0 0 3px var(--ring, var(--dc-frame)); }
.dc-st.dc-typing { background: var(--dc-green); animation: dc-blink 1s infinite; }
@keyframes dc-blink { 50% { opacity: .45; } }
#dc-user .dc-st { --ring: var(--dc-high); }
.dc-mem .dc-st, #dc-right .dc-st { --ring: var(--dc-chat); }
.dc-rowav .dc-st { --ring: var(--dc-frame); }

/* toast */
#dc-toast {
  position: fixed; left: 50%; bottom: 96px; z-index: 2147483003; transform: translateX(-50%) translateY(8px); opacity: 0; pointer-events: none;
  background: var(--dc-tip); border: 1px solid var(--dc-line-3); box-shadow: var(--dc-shadow); color: var(--dc-strong); padding: 10px 14px; border-radius: 8px;
  font: 500 14px/18px var(--dc-font); transition: opacity .15s, transform .15s; display: flex; align-items: center; gap: 10px; max-width: 90vw;
}
#dc-toast.dc-show { opacity: 1; transform: translateX(-50%); }
#dc-toast svg { width: 20px; height: 20px; color: var(--dc-green); }

/* scrollbars */
body.dc-on * { scrollbar-width: thin; scrollbar-color: var(--dc-scroll) transparent; }
body.dc-on ::-webkit-scrollbar { width: 8px; height: 8px; }
body.dc-on ::-webkit-scrollbar-thumb { background: var(--dc-scroll); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
body.dc-on ::-webkit-scrollbar-track { background: transparent; }
body.dc-on ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
body.dc-on bard-sidenav * { scrollbar-color: transparent transparent; }
body.dc-on bard-sidenav:hover * { scrollbar-color: var(--dc-scroll) transparent; }
body.dc-on ::selection { background: var(--dc-brand-30); }

/* reduced motion */
body.dc-still *, body.dc-still *::before, body.dc-still *::after { animation-duration: 0s !important; transition-duration: 0s !important; }
`;

  let styleEl = null;
  function addStyle() {
    if (styleEl && styleEl.isConnected) return;
    if (typeof GM_addStyle === 'function') { try { styleEl = GM_addStyle(CSS); } catch (e) { styleEl = null; } if (styleEl) return; }
    const parent = document.head || document.documentElement;
    if (!parent) return;
    styleEl = document.createElement('style');
    styleEl.id = 'dc-style';
    styleEl.textContent = CSS;
    parent.appendChild(styleEl);
  }
  function addFont() {
    if (document.getElementById('dc-font')) return;
    const parent = document.head || document.documentElement;
    if (!parent) return;
    const l = document.createElement('link');
    l.id = 'dc-font'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600;700;800&family=Source+Code+Pro:wght@400;500&display=swap';
    parent.appendChild(l);
  }
  addStyle(); addFont();
  const styleKeeper = new MutationObserver(() => { addStyle(); addFont(); });
  styleKeeper.observe(document, { childList: true, subtree: true });
  window.addEventListener('load', () => setTimeout(() => styleKeeper.disconnect(), 4000), L);

  /* =====================================================================
     Helpers
     ===================================================================== */
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
  Object.assign(ICONS, {
    hash: 'M10 3.5L8 20.5|M16 3.5l-2 17|M4.5 8.5h16|M3.5 15.5h16',
    hashLock: 'M9 3.5L7 20.5|M14.5 3.5l-.9 7.5|M3.5 8.5h12|M2.5 15.5h9|F14 15h8v6.5h-8z|M15.8 15v-1.6a2.2 2.2 0 0 1 4.4 0V15',
    at: 'c12,12,4|M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
    people: 'c9,8,3.5|M2.5 19c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5|M16 4.5a3.5 3.5 0 0 1 0 7|M17.5 14c2.2.4 3.6 2 4 5',
    threads: 'M4 4h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8l-4 3z|M19 8h1a1 1 0 0 1 1 1v11l-4-3h-7a1 1 0 0 1-1-1v-1',
    inbox: 'M4 13l2-8h12l2 8v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z|M4 13h4.5l1 2h5l1-2H20',
    mic: 'M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z|M5.5 11.5a6.5 6.5 0 0 0 13 0|M12 18v3',
    headphones: 'M4 16v-4a8 8 0 0 1 16 0v4|M4 15h3a1 1 0 0 1 1 1v4H5a1 1 0 0 1-1-1z|M20 15h-3a1 1 0 0 0-1 1v4h3a1 1 0 0 0 1-1z',
    headphonesOff: 'M4 16v-4a8 8 0 0 1 12.5-6.6|M20 12v4|M4 15h3a1 1 0 0 1 1 1v4H5a1 1 0 0 1-1-1z|M20 15h-3a1 1 0 0 0-1 1v4h3a1 1 0 0 0 1-1z|M3 3l18 18',
    gif: 'M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z|M10.2 9.8H8.6a1.4 1.4 0 0 0-1.4 1.4v1.6a1.4 1.4 0 0 0 1.4 1.4h1.6V12H9|M12.6 9.8v4.4|M15 14.2V9.8h2.6|M15 12h2',
    sticker: 'M5 4h14a1 1 0 0 1 1 1v9l-6 6H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z|M20 14h-5a1 1 0 0 0-1 1v5',
    invite: 'c10,8,4|M3 20c1-4 3.8-6 7-6 1.6 0 3 .5 4.2 1.3|M19 14v6|M16 17h6',
    calendar: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z|M4 10h16|M8 3v4|M16 3v4',
    browse: 'M4 6h11|M4 11h7|M4 16h5|c16.5,15,3.5|M19 17.5l2.5 2.5',
    media: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z|M4 16l5-5 4 4 2.5-2.5L20 17|c15.5,8.5,1.5',
    compass: 'c12,12,9|M15.5 8.5l-2 5-5 2 2-5z',
    friends: 'c9,8,3.5|M2.5 19c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5|M18 7.5c1 .8 1.5 1.8 1.5 3s-.5 2.2-1.5 3|M20.5 5c1.6 1.4 2.5 3.4 2.5 5.5s-.9 4.1-2.5 5.5',
    nitro: 'M12 2.5l7.5 9.5-7.5 9.5L4.5 12z|M12 8l3.2 4L12 16l-3.2-4z',
    moreH: 'c5,12,1.8|c12,12,1.8|c19,12,1.8',
    reactAdd: 'c11,13,8|M7.5 15a4.5 4.5 0 0 0 7 0|M8.2 10.5h.01|M13.8 10.5h.01|M19 1.5v6|M16 4.5h6',
    id: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z|M7.5 9v6|M11 9v6h2a3 3 0 0 0 0-6z',
    stop: 'F7 7h10v10H7z',
    send: 'F3.4 20.4l17.4-7.5a1 1 0 0 0 0-1.8L3.4 3.6a.9.9 0 0 0-1.3 1L4 11l9 1-9 1-1.9 6.4a.9.9 0 0 0 1.3 1z',
    home: 'F12 2.5c5.5 0 9.5 3.7 9.5 8.4 0 4.6-4 8.4-9.5 8.4-1 0-2-.1-2.9-.4L5 21v-3.9C3.4 15.6 2.5 13.4 2.5 10.9 2.5 6.2 6.5 2.5 12 2.5z',
    gemSpark: 'F12 2c.6 5 3.4 8.8 10 10-6.6 1.2-9.4 5-10 10-.6-5-3.4-8.8-10-10C8.6 10.8 11.4 7 12 2z',
    plusCircle: 'E12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1.1 5.3v3.6H7.3v2.2h3.6v3.6h2.2v-3.6h3.6v-2.2h-3.6V7.3z',
    accessibility: 'c12,4.5,1.8|M5 8.5l7 1.5 7-1.5|M12 10v4.5l-3 6|M12 14.5l3 6',
    bookmarkMsg: 'M7 3.5h10a1 1 0 0 1 1 1V20l-6-4-6 4V4.5a1 1 0 0 1 1-1z',
    reminder: 'c12,13,8|M12 9v4l2.5 1.5|M5 3L2.5 5.5|M19 3l2.5 2.5',
    apps: 'F4 4h6.5v6.5H4z|F13.5 4H20v6.5h-6.5z|F4 13.5h6.5V20H4z|M16.75 13.5V20|M13.5 16.75H20',
    music: 'M9 18V5l11-2v13|c6,18,3|c17,16,3',
    canvas: 'M4 4h16v16H4z|M4 9h16|M9 9v11',
    research: 'c10.5,10.5,6.5|M15.5 15.5L20 20|M8 10.5h5|M10.5 8v5',
    drive: 'M8.5 4h7l5.5 9.5-3.5 6h-11L3 13.5z|M8.5 4l6 10.5|M3 13.5h11|M15.5 4L9.5 14.5',
    logout: 'M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5|M15 8l4 4-4 4|M19 12H9',
    pinMsg: 'M15 4l5 5-3 1-3.5 3.5.5 4-1.5 1.5L4 11.5 5.5 10l4 .5L13 7z|M8.5 15.5L4 20',
    xCircle: 'c12,12,9|M9 9l6 6|M15 9l-6 6',
    quote: 'M7 7h4v4H8.5L7 15V7z|M14 7h4v4h-2.5L14 15V7z',
  });
  const NS = 'http://www.w3.org/2000/svg';
  // 'c' = circle, 'F' = filled path, 'E' = filled path with holes, '!' = viewBox, anything else = stroked path
  function icon(name) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', 'dc-i');
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
      } else if (p.startsWith('F') || p.startsWith('E')) {
        el = document.createElementNS(NS, 'path');
        const d = p.slice(1);
        el.setAttribute('d', /^[a-z]/i.test(d) ? d : 'M' + d); el.setAttribute('fill', 'currentColor'); el.setAttribute('stroke', 'none');
        if (p[0] === 'E') el.setAttribute('fill-rule', 'evenodd');
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

  // Discord's own formats: "Today at 2:46 PM", "Yesterday at 2:46 PM", "10/17/2026 2:46 PM"
  function dayDiff(ts) {
    const d = new Date(ts), now = new Date();
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    return Math.round((day(now) - day(d)) / 864e5);
  }
  function fmtStamp(ts) {
    const diff = dayDiff(ts), t = fmtTime(ts);
    if (diff === 0) return 'Today at ' + t;
    if (diff === 1) return 'Yesterday at ' + t;
    return new Date(ts).toLocaleDateString([], { month: '2-digit', day: '2-digit', year: 'numeric' }) + ' ' + t;
  }
  const fmtFull = ts => new Date(ts).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ' at ' + fmtTime(ts);
  const fmtDivider = ts => new Date(ts).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  const fmtShortDate = ts => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

  /* ---------- avatars: Discord's default colours, Gemini's spark for the bot ---------- */
  const AV = ['#5865f2', '#757e8a', '#3ba55c', '#faa61a', '#ed4245', '#eb459e'];
  const colorFor = seed => AV[parseInt(hash(String(seed)), 36) % AV.length];
  function initials(title) {
    const words = (title || '?').replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/).filter(Boolean);
    return ((words[0] || '?')[0] + (words[1] ? words[1][0] : '')).toUpperCase();
  }
  const sizeStyle = s => `width:${s}px;height:${s}px;font-size:${Math.max(8, Math.round(s * 0.38))}px`;
  function avatar(title, seed, size = 40) {
    return h('span', { class: 'dc-av', style: `${sizeStyle(size)};--avc:${colorFor(seed || title)}`, text: initials(title) });
  }
  function botAvatar(size = 40) { return h('span', { class: 'dc-av dc-bot', style: sizeStyle(size) }, icon('gemSpark')); }
  function userAvatar(size = 40) {
    const src = G.photo();
    if (src) return h('img', { class: 'dc-av', src, alt: '', style: sizeStyle(size) });
    return avatar(G.name(), 'me', size);
  }
  const STATUS = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible', typing: 'Typing' };
  const statusDot = st => h('span', { class: 'dc-st dc-' + (st || 'online') });
  const withStatus = (av, st) => h('span', { class: 'dc-avw' }, av, st ? statusDot(st) : null);
  const emptyState = (ic, title, sub) => h('div', { class: 'dc-empty' }, h('div', { class: 'dc-empty-art' }, icon(ic)), h('b', { text: title }), sub || null);

  // Discord's text channel names: lowercase-words-with-dashes
  function chanName(t) {
    if (!S.chanNames) return t || 'chat';
    const s = String(t || '').toLowerCase().replace(/['’"“”`]/g, '').replace(/[^\p{L}\p{N}\p{Extended_Pictographic}_-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return s || 'chat';
  }

  /* ---------- clipboard / toast / sound ---------- */
  function copy(text) {
    try { if (typeof GM_setClipboard === 'function') { GM_setClipboard(text, 'text'); return; } } catch (e) { /* fall through */ }
    navigator.clipboard && navigator.clipboard.writeText(text).catch(() => {});
  }
  let toastTimer = 0;
  function toast(msg, ic = 'info') {
    let t = $('#dc-toast');
    if (!t) { t = h('div', { id: 'dc-toast', class: 'dc-ui' }); document.body.append(t); }
    t.replaceChildren(icon(ic), h('span', { text: msg }));
    t.classList.add('dc-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('dc-show'), 2400);
  }
  let audioCtx = null;
  // a soft two-note "bloop", like Discord's message sound
  function ding() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      [[740, 0], [1108, 0.075]].forEach(([f, t0]) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + t0); g.gain.exponentialRampToValueAtTime(0.16, now + t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, now + t0 + 0.2);
        o.connect(g).connect(audioCtx.destination); o.start(now + t0); o.stop(now + t0 + 0.25);
      });
    } catch (e) { /* no audio */ }
  }
  function speak(text) {
    try {
      const sy = window.speechSynthesis;
      if (!sy) { toast("Your browser can't read messages aloud", 'speaker'); return; }
      sy.cancel();
      const u = new SpeechSynthesisUtterance(String(text).slice(0, 4000));
      sy.speak(u);
      toast('Speaking message… press Esc to stop', 'speaker');
    } catch (e) { /* ignore */ }
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
      if (b.closest('.dc-ui')) continue;
      if (re.test(labelOf(b))) return b;
    }
    return null;
  }
  // Open one of Gemini's menus invisibly and click an item in it.
  let ghostDepth = 0;
  async function ghost(fn) {
    ghostDepth++;
    document.body.classList.add('dc-ghost');
    try { return await fn(); } finally {
      setTimeout(() => { if (--ghostDepth <= 0) { ghostDepth = 0; document.body.classList.remove('dc-ghost'); } }, 450);
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
  // the "Upload & tools" (+) button in Gemini's message box, and the tools inside it
  G.toolsBtn = () => $('input-area-v2 .simplified-input-menu-container button') || findBtn($('input-area-v2'), /upload|tools/i);
  async function toolAction(re) {
    const b = G.toolsBtn();
    if (!b) return false;
    return ghost(async () => {
      b.click();
      const it = await waitFor(() => $$('.cdk-overlay-container button, .cdk-overlay-popover button, [popover] button, .cdk-overlay-container [role="menuitem"]')
        .find(x => !x.closest('.dc-ui') && re.test((x.innerText || x.textContent || '').trim())), 1500);
      if (!it) { closeOverlays(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })); return false; }
      it.click();
      await sleep(120);
      closeOverlays();
      return true;
    });
  }
  G.mic = () => {
    const b = $('input-area-v2 speech-dictation-mic-button button') || findBtn($('input-area-v2'), /dictat|microphone|voice/i);
    if (b) { b.click(); return true; }
    toast('Dictation is not available here', 'mic');
    return false;
  };
  // Gemini only offers temporary chats from a new chat, so open one first
  G.tempChat = async () => {
    let b = G.topBtn(/temporary|temp chat/i);
    if (!b) { G.newChat(); b = await waitFor(() => G.topBtn(/temporary|temp chat/i), 4000, 100); }
    if (b) { b.click(); return true; }
    toast('Temporary chat is available from a new chat', 'hashLock');
    return false;
  };
  G.micOn = () => !!$('input-area-v2 speech-dictation-mic-button :is(.recording, .listening, .active, [aria-pressed="true"])');
  function modelLabel() {
    const b = G.modelBtn();
    if (!b) return '';
    const m = (b.getAttribute('aria-label') || '').match(/currently\s+(.+)$/i);
    return (m ? m[1] : (b.innerText || '')).trim().replace(/\s+/g, ' ');
  }
  function shareChat() {
    if (pageKind() === 'chat' && convId() !== '_new') G.convMenu('share-button');
    else toast('Open a chat to invite people to it', 'invite');
  }
  const nameOf = role => role === 'u' ? G.name() : 'Gemini';

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
      if (el.closest('.dc-ui')) continue;
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
  // Gemini's other pages, shown like Discord's special channels
  const PAGES = [
    [/^\/(library|mystuff)/, 'library', 'media', 'Files, images and videos you made with Gemini'],
    [/^\/images/, 'images', 'media', 'Pictures you made with Gemini'],
    [/^\/scheduled/, 'events', 'calendar', 'Actions Gemini runs for you on a schedule'],
    [/^\/(customize|gems)/, 'gems', 'gem', 'Gems and personal context'],
    [/^\/notebooks?/, 'notebooks', 'notebook', 'Chats and files grouped by topic'],
    [/^\/search/, 'search', 'browse', 'Search through your chats'],
    [/^\/(settings|saved-info|apps|extensions|personal|activity)/, 'settings', 'settings', 'Gemini settings'],
  ];
  const pageInfo = () => { const p = PAGES.find(x => x[0].test(location.pathname)); return p ? { title: p[1], icon: p[2], status: p[3] } : null; };
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
     Pop-up menus (Discord style, with sub-menus) and modals
     ===================================================================== */
  let closePopup = null;
  function popup(build, x, y, opts = {}) {
    if (closePopup) closePopup();
    const back = h('div', { class: 'dc-backdrop dc-ui' });
    const wrap = h('div', { class: 'dc-menu-wrap dc-ui' });
    const close = () => {
      back.remove(); wrap.remove(); $$('.dc-menu.dc-sub').forEach(s => s.remove());
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
      for (const b of $$('.dc-mi, .dc-reactbar button', wrap)) {
        let x = 0, y = 0, n = b;
        while (n && n !== wrap) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
        if (cx >= wr.left + x && cx <= wr.left + x + b.offsetWidth && cy >= wr.top + y && cy <= wr.top + y + b.offsetHeight) return b;
      }
      return null;
    };
    wrap.addEventListener('click', e => {
      if (forwarding || e.target.closest('input, .dc-emojigrid')) return;
      const early = performance.now() - openedAt < 300;
      if (!early && e.target.closest('.dc-mi, .dc-reactbar button')) return;
      const b = itemAt(e.clientX, e.clientY);
      if (!b || b === e.target.closest('.dc-mi, .dc-reactbar button')) return;
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
    $$('.dc-menu, .dc-reactbar', wrap).forEach(m => m.style.setProperty('--dc-origin', `${oy} ${ox}`));
    closePopup = close;
    return close;
  }
  function menuList(items, close, extraClass = '') {
    const m = h('div', { class: 'dc-menu ' + extraClass });
    let subEl = null, subFor = null, subTimer = 0;
    const closeSub = () => { if (subEl) { subEl.remove(); subEl = null; subFor = null; } };
    const openSub = (btn, it) => {
      if (subFor === btn || !m.isConnected) return; // a hover timer can fire after the menu has closed
      closeSub();
      const list = typeof it.sub === 'function' ? it.sub() : it.sub;
      subEl = menuList(list, close, 'dc-sub');
      subFor = btn;
      subEl.addEventListener('mouseenter', () => clearTimeout(subTimer));
      document.body.append(subEl);
      const br = btn.getBoundingClientRect(), mr = m.getBoundingClientRect(), sr = subEl.getBoundingClientRect();
      let left = mr.right + 6, top = br.top - 6;
      if (left + sr.width > innerWidth - 8) left = mr.left - sr.width - 6;
      top = Math.max(8, Math.min(top, innerHeight - sr.height - 8));
      subEl.style.left = left + 'px'; subEl.style.top = top + 'px';
      $$('.dc-mi', m).forEach(b => b.classList.toggle('dc-hl', b === btn));
    };
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { m.append(h('hr')); continue; }
      if (it.foot) { m.append(h('div', { class: 'dc-menu-foot', text: it.foot })); continue; }
      const lead = it.photo ? it.photo : icon(it.icon || 'dot');
      const btn = h('button', { class: 'dc-mi' + (it.danger ? ' dc-danger' : '') + (it.cls ? ' ' + it.cls : '') }, lead, h('span', { text: it.label }),
        it.sub ? h('span', { class: 'dc-mi-end' }, icon('chevRight')) : (it.end ? h('span', { class: 'dc-mi-end', text: it.end }) : null));
      if (it.sub) {
        btn.addEventListener('mouseenter', () => { clearTimeout(subTimer); subTimer = setTimeout(() => openSub(btn, it), 90); });
        btn.addEventListener('click', e => { e.stopPropagation(); openSub(btn, it); });
      } else {
        btn.addEventListener('mouseenter', () => { clearTimeout(subTimer); subTimer = setTimeout(() => { closeSub(); $$('.dc-mi', m).forEach(b => b.classList.remove('dc-hl')); }, 120); });
        btn.addEventListener('click', e => { e.stopPropagation(); close(); it.run && it.run(); });
      }
      m.append(btn);
    }
    return m;
  }
  let closeModal = null;
  function modal(build) {
    if (closePopup) closePopup();
    const back = h('div', { class: 'dc-modal-back dc-ui' });
    const box = h('div', { class: 'dc-modal' });
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
     Tooltips (Discord's black bubbles)
     ===================================================================== */
  let tipEl = null, tipFor = null, tipTimer = 0;
  function hideTip() { clearTimeout(tipTimer); tipFor = null; if (tipEl) tipEl.classList.remove('dc-show'); }
  function showTip(t) {
    if (!t.isConnected) return;
    const text = t.getAttribute('data-tip');
    if (!text) return;
    if (!tipEl || !tipEl.isConnected) { tipEl = h('div', { id: 'dc-tip', class: 'dc-ui' }); document.body.append(tipEl); }
    const [main, sub] = text.split('\n');
    tipEl.replaceChildren(main, ...(sub ? [h('span', { class: 'dc-tip-sub', text: sub })] : []));
    tipEl.style.left = '0px'; tipEl.style.top = '0px';
    const r = t.getBoundingClientRect(), tr = tipEl.getBoundingClientRect();
    const side = t.getAttribute('data-tip-side') || 'top';
    let x, y;
    if (side === 'right') { x = r.right + 12; y = r.top + r.height / 2 - tr.height / 2; }
    else if (side === 'left') { x = r.left - tr.width - 12; y = r.top + r.height / 2 - tr.height / 2; }
    else if (side === 'bottom') { x = r.left + r.width / 2 - tr.width / 2; y = r.bottom + 8; }
    else { x = r.left + r.width / 2 - tr.width / 2; y = r.top - tr.height - 8; }
    tipEl.style.left = Math.round(Math.max(8, Math.min(x, innerWidth - tr.width - 8))) + 'px';
    tipEl.style.top = Math.round(Math.max(8, Math.min(y, innerHeight - tr.height - 8))) + 'px';
    tipEl.classList.add('dc-show');
  }
  document.addEventListener('mouseover', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t === tipFor) return;
    hideTip();
    if (!t || !t.getAttribute('data-tip')) return;
    tipFor = t;
    tipTimer = setTimeout(() => showTip(t), 120);
  }, LC);
  document.addEventListener('mousedown', hideTip, LC);

  /* =====================================================================
     Title bar, server rail, user panel
     ===================================================================== */
  let titleBar = null, rail = null, userPanel = null;
  function buildFrame() {
    $$('#dc-titlebar, #dc-rail, #dc-user').forEach(e => e.remove());
    titleBar = h('div', { id: 'dc-titlebar', class: 'dc-ui' },
      h('div', { class: 'dc-tb-title' }, h('span', { class: 'dc-tb-ic' }), h('span', { class: 'dc-tb-text', text: 'Gemini' })),
      h('div', { class: 'dc-tb-right' },
        h('button', { class: 'dc-tb-btn dc-tb-inbox', 'data-tip': 'Inbox', 'data-tip-side': 'bottom', onclick: e => openInbox(e.currentTarget) }, icon('inbox')),
        h('button', { class: 'dc-tb-btn', 'data-tip': 'Help', 'data-tip-side': 'bottom', onclick: () => G.settings('help-button', /help center/i) }, icon('help'))));
    rail = h('nav', { id: 'dc-rail', class: 'dc-ui' });
    userPanel = buildUserPanel();
    document.body.append(titleBar, rail, userPanel);
  }
  function renderTitleBar() {
    if (!titleBar) return;
    const dm = S.view === 'dm';
    const ic = $('.dc-tb-ic', titleBar);
    const k = dm ? 'dm' : 'gem';
    if (ic.dataset.k !== k) {
      ic.dataset.k = k;
      ic.style.background = dm ? 'var(--dc-brand)' : 'linear-gradient(135deg,#4c8df6,#8e6cf1 60%,#d96570)';
      ic.replaceChildren(icon(dm ? 'home' : 'gemSpark'));
    }
    setText($('.dc-tb-text', titleBar), dm ? 'Direct Messages' : 'Gemini');
  }
  function railItem(cls, tip, content, run) {
    return h('div', { class: 'dc-g ' + cls }, h('span', { class: 'dc-g-pill' }),
      h('button', { class: 'dc-g-icon', 'data-tip': tip, 'data-tip-side': 'right', onclick: run }, content));
  }
  function setView(v) { if (S.view !== v) { setS('view', v); scan(); } }
  function renderRail() {
    if (!rail) return;
    const nbs = G.notebooks();
    const sig = nbs.map(n => n.title).join('|');
    if (rail.dataset.sig !== sig || !rail.firstChild) {
      rail.dataset.sig = sig;
      rail.replaceChildren(
        railItem('dc-g-home', 'Direct Messages', icon('home'), () => setView('dm')),
        h('div', { class: 'dc-g-sep' }),
        railItem('dc-g-gem', 'Gemini', icon('gemSpark'), () => setView('server')),
        ...nbs.map(n => {
          const it = railItem('dc-nb', n.title + '\nNotebook', document.createTextNode(initials(n.title)), () => { const x = G.notebooks().find(z => z.title === n.title); x && x.el.click(); });
          it.dataset.nb = n.title;
          return it;
        }),
        railItem('dc-g-add', 'Add a Server\nCreates a new notebook', icon('add'), G.newNotebook),
        railItem('dc-g-add', 'Discover\nExplore Gems', icon('compass'), G.customize),
        h('div', { class: 'dc-g-sep' }),
        railItem('dc-g-add', 'Download Apps', icon('download'), G.getApp));
    }
    const dm = S.view === 'dm';
    $('.dc-g-home', rail).classList.toggle('dc-on', dm);
    const gem = $('.dc-g-gem', rail);
    gem.classList.toggle('dc-on', !dm);
    const n = Object.keys(DB.unread).filter(k => DB.unread[k] && k !== convId()).length;
    gem.classList.toggle('dc-unread', n > 0);
    let badge = $('.dc-g-badge', gem);
    if (n && dm) { if (!badge) { badge = h('span', { class: 'dc-g-badge' }); gem.append(badge); } setText(badge, String(n)); } else if (badge) badge.remove();
    const inbox = $('.dc-tb-inbox', titleBar);
    if (inbox) inbox.classList.toggle('dc-unread', n > 0);
  }
  function buildUserPanel() {
    const me = h('div', { class: 'dc-up-me', onclick: e => openAccountMenu(e.currentTarget) },
      h('span', { class: 'dc-avw dc-up-av' }),
      h('div', { class: 'dc-up-text' }, h('div', { class: 'dc-up-name' }), h('div', { class: 'dc-up-sub' }, h('span', { class: 'dc-up-status' }), h('span', { class: 'dc-up-user' }))));
    const mic = h('button', { class: 'dc-up-btn dc-up-mic', 'data-tip': 'Dictate\nTalk instead of typing', onclick: () => { G.mic(); setTimeout(renderUserPanel, 400); } }, icon('mic'));
    const deaf = h('button', { class: 'dc-up-btn dc-up-deaf', onclick: () => { setS('sound', !S.sound); toast(S.sound ? 'Sounds are back on' : 'Deafened: no more message sounds', S.sound ? 'headphones' : 'headphonesOff'); renderUserPanel(); } });
    const gear = h('button', { class: 'dc-up-btn', 'data-tip': 'User Settings', onclick: () => openSettings() }, icon('settings'));
    return h('section', { id: 'dc-user', class: 'dc-ui' }, me, h('div', { class: 'dc-up-btns' }, mic, deaf, gear));
  }
  function renderUserPanel() {
    if (!userPanel) return;
    const name = G.name(), email = G.email();
    const sig = [name, G.photo(), S.status, S.sound, email, G.micOn()].join('|');
    if (userPanel.dataset.sig === sig) return;
    userPanel.dataset.sig = sig;
    $('.dc-up-av', userPanel).replaceChildren(userAvatar(32), statusDot(S.status));
    setText($('.dc-up-name', userPanel), name);
    setText($('.dc-up-status', userPanel), STATUS[S.status] || 'Online');
    setText($('.dc-up-user', userPanel), email ? email.split('@')[0] : name.toLowerCase().replace(/\s+/g, ''));
    const deaf = $('.dc-up-deaf', userPanel);
    deaf.replaceChildren(icon(S.sound ? 'headphones' : 'headphonesOff'));
    deaf.classList.toggle('dc-off', !S.sound);
    deaf.setAttribute('data-tip', S.sound ? 'Deafen\nMute message sounds' : 'Undeafen');
    $('.dc-up-mic', userPanel).classList.toggle('dc-live', G.micOn());
  }
  function openAccountMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const dot = st => h('span', { class: 'dc-avw', style: 'width:20px;height:20px;align-items:center;justify-content:center' }, h('span', { class: 'dc-st dc-' + st, style: 'position:static;border-width:0;width:12px;height:12px' }));
    const statuses = () => ['online', 'idle', 'dnd', 'invisible'].map(st => ({ photo: dot(st), label: STATUS[st] + (S.status === st ? '  ✓' : ''), run: () => { setS('status', st); renderUserPanel(); scan(); } }));
    popup((wrap, close) => wrap.append(menuList([
      { photo: userAvatar(20), label: G.name(), cls: 'dc-acc', run: () => openProfile('me', anchor, 'top') },
      '-',
      { icon: 'edit', label: 'Edit Profile', run: () => openSettings('account') },
      { photo: dot(S.status), label: STATUS[S.status] || 'Online', sub: statuses },
      { icon: 'switchG', label: 'Switch Accounts', sub: () => [
        { icon: 'add', label: 'Add an Account', run: G.addAccount },
        { icon: 'user', label: 'Manage Google Account', run: G.account }] },
      '-',
      { icon: 'id', label: 'Copy User ID', run: () => { copy(G.email() || G.name()); toast('Copied user ID', 'id'); } },
    ], close)), r.left, r.top - 8, { above: true });
  }

  /* =====================================================================
     Channel list: header, top items, categories, channels / DMs
     ===================================================================== */
  let sideHead = null, sideTop = null;
  function buildSideHead() {
    const head = $('.sidenav-header-buttons');
    if (!head) return;
    if (sideHead && sideHead.isConnected && sideHead.parentElement === head) return;
    const srv = h('button', { class: 'dc-srv-btn dc-srv-only', onclick: e => openServerMenu(e.currentTarget) }, h('span', { text: 'Gemini' }), icon('chevDown'));
    const inv = h('button', { class: 'dc-invite dc-srv-only', 'data-tip': 'Invite People\nShare this chat', 'data-tip-side': 'bottom', onclick: shareChat }, icon('invite'));
    const find = h('button', { class: 'dc-find dc-dm-only', onclick: () => openQuickSwitcher(), text: 'Find or start a conversation' });
    sideHead = h('div', { class: 'dc-side-head dc-ui' }, srv, inv, find);
    head.prepend(sideHead);
  }
  function renderSideTop() {
    const list = $('bard-sidenav conversations-list');
    if (!list || !list.parentElement) return;
    if (!sideTop || !sideTop.isConnected || sideTop.nextElementSibling !== list) {
      sideTop && sideTop.remove();
      sideTop = h('div', { id: 'dc-side-top', class: 'dc-ui' });
      list.parentElement.insertBefore(sideTop, list);
    }
    const p = location.pathname;
    const sig = S.view + '|' + p;
    if (sideTop.dataset.v === sig) return;
    sideTop.dataset.v = sig;
    const item = (ic, label, run, on, extra) => h('div', { class: 'dc-side-item' + (on ? ' dc-on' : ''), onclick: run }, icon(ic), h('span', { text: label }), extra || null);
    if (S.view === 'dm') sideTop.replaceChildren(
      item('friends', 'Friends', G.customize, /^\/(customize|gems)/.test(p)),
      item('nitro', 'Nitro', G.upgrade, false),
      item('store', 'Shop', () => G.settings('shopping-cart-button'), false),
      item('media', 'Library', G.library, /^\/(library|mystuff)/.test(p)),
      h('div', { class: 'dc-dm-head' }, h('span', { text: 'Direct Messages' }),
        h('button', { 'data-tip': 'Create DM\nStarts a new chat', onclick: e => { e.stopPropagation(); G.newChat(); } }, icon('add'))));
    else sideTop.replaceChildren(
      item('calendar', 'Events', G.scheduled, /^\/scheduled/.test(p)),
      item('browse', 'Browse Channels', () => { if (!G.searchChats()) openQuickSwitcher(); }, /^\/search/.test(p)),
      item('media', 'Library', G.library, /^\/(library|mystuff|images)/.test(p)),
      item('gem', 'Gems', G.customize, /^\/(customize|gems)/.test(p), h('span', { class: 'dc-new', text: 'NEW' })),
      h('div', { class: 'dc-side-sep' }));
  }
  function buildResizer() {
    const side = $('bard-sidenav');
    if (!side || $('#dc-resizer', side)) return;
    const rz = h('div', { id: 'dc-resizer', class: 'dc-ui', 'data-tip': 'Drag to resize', 'data-tip-side': 'right' });
    rz.addEventListener('mousedown', e => {
      e.preventDefault();
      rz.classList.add('dc-drag'); document.body.classList.add('dc-resizing');
      const left = side.getBoundingClientRect().left;
      const move = ev => { S.sideWidth = Math.max(200, Math.min(440, ev.clientX - left)); applyVars(); schedule(); };
      const up = () => { rz.classList.remove('dc-drag'); document.body.classList.remove('dc-resizing'); setS('sideWidth', S.sideWidth); removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    });
    rz.addEventListener('dblclick', () => setS('sideWidth', CONFIG.sideWidth));
    side.append(rz);
  }
  function isRowPinned(r) {
    return !!(r.item.closest('[data-test-id*="pinned" i], .pinned-conversations') ||
      $$('mat-icon, gem-icon', r.item).some(i => /keep|push_pin|pinned/i.test((i.getAttribute('fonticon') || '') + ' ' + (i.textContent || '') + ' ' + (i.getAttribute('data-mat-icon-name') || ''))));
  }
  function decorateSidebar(gen) {
    buildSideHead();
    renderSideTop();
    buildResizer();
    const cur = convId();
    const dm = S.view === 'dm';
    let firstPinned = null, firstChat = null;
    for (const r of sidebarRows()) safe('row', () => {
      const a = r.a;
      let txt = $(':scope > .dc-row-txt', a);
      if (!txt) {
        $$(':scope > .dc-ui', a).forEach(x => x.remove());
        const ic = icon('hash'); ic.classList.add('dc-row-ic', 'dc-ui');
        const av = h('span', { class: 'dc-row-av dc-avw dc-rowav dc-ui' });
        txt = h('span', { class: 'dc-row-txt dc-ui' }, h('span', { class: 'dc-row-name' }), h('span', { class: 'dc-row-sub' }));
        const rowOf = () => sidebarRows().find(x => x.a === a);
        const acts = h('span', { class: 'dc-row-acts dc-ui' },
          h('button', { 'data-tip': 'Create Invite', onclick: ev => { ev.preventDefault(); ev.stopPropagation(); G.rowMenu(rowOf(), 'share-button'); } }, icon('invite')),
          h('button', { 'data-tip': 'Edit Channel', onclick: ev => { ev.preventDefault(); ev.stopPropagation(); const rr = ev.currentTarget.getBoundingClientRect(); const row = rowOf(); row && openRowMenu(row, rr.left, rr.bottom + 6); } }, icon('settings')));
        a.prepend(ic, av, txt);
        a.append(acts, h('span', { class: 'dc-row-pill dc-ui' }));
      }
      const on = isActiveRow(r);
      a.classList.toggle('dc-row-on', on);
      const n = (r.id && DB.unread[r.id]) || 0;
      a.classList.toggle('dc-row-unread', !!n && !on);
      setText($('.dc-row-name', txt), dm ? r.title : chanName(r.title));
      const typing = gen && r.id && r.id === cur;
      if (dm) {
        const av = $(':scope > .dc-row-av', a);
        const ak = r.title + '|' + r.id + '|' + !!typing;
        if (av.dataset.k !== ak) { av.dataset.k = ak; av.replaceChildren(avatar(r.title, r.id || r.title, 32), statusDot(typing ? 'typing' : 'online')); }
        const p = r.id && DB.prev[r.id];
        const sub = $('.dc-row-sub', txt);
        setText(sub, typing ? 'Gemini is typing…' : p ? (p.r === 'u' ? 'You: ' : '') + p.t : '');
        sub.classList.toggle('dc-typing', !!typing);
        if (!p && r.id) wantPreview(r.id);
      }
      const pinned = isRowPinned(r);
      if (pinned && !firstPinned) firstPinned = r;
      if (!pinned && !firstChat) firstChat = r;
      r.item.classList.toggle('dc-collapsed-row', !dm && !on && !!S.collapsed[pinned ? 'pinned' : 'chats']);
    });
    placeCat('pinned', 'Pinned', firstPinned);
    placeCat('chats', 'Text Channels', firstChat);
  }
  function placeCat(key, label, row) {
    let el = $('.dc-cat[data-cat="' + key + '"]');
    if (!row) { if (el) el.remove(); return; }
    if (!el) {
      el = h('div', { class: 'dc-cat dc-ui', 'data-cat': key, onclick: () => { S.collapsed[key] = !S.collapsed[key]; setS('collapsed', S.collapsed); scan(); } },
        icon('chevDown'), h('span', { text: label }),
        h('button', { 'data-tip': 'Create Channel', onclick: e => { e.stopPropagation(); G.newChat(); } }, icon('add')));
    }
    el.classList.toggle('dc-closed', !!S.collapsed[key]);
    if (el.nextElementSibling !== row.item) row.item.parentElement.insertBefore(el, row.item);
  }
  function openRowMenu(row, x, y) {
    const pinned = isRowPinned(row);
    const n = (row.id && DB.unread[row.id]) || 0;
    const here = row.id && row.id === convId();
    const c = here ? C() : null;
    const hidden = c ? Object.keys(c.h).length : 0;
    const showing = document.body.classList.contains('dc-show-deleted');
    row.a.classList.add('dc-row-ctx');
    popup((wrap, close) => wrap.append(menuList([
      row.id && (n ? { icon: 'check', label: 'Mark As Read', run: () => { delete DB.unread[row.id]; save(); scan(); } }
        : { icon: 'unread', label: 'Mark As Unread', run: () => { DB.unread[row.id] = 1; save(); scan(); } }),
      '-',
      { icon: 'invite', label: 'Invite People', cls: 'dc-brandi', run: () => G.rowMenu(row, 'share-button') },
      { icon: 'link', label: 'Copy Link', run: () => { copy(row.a.href); toast('Link copied!', 'link'); } },
      { icon: 'newtab', label: 'Open in New Tab', run: () => window.open(row.a.href, '_blank') },
      '-',
      { icon: S.notify ? 'bellOff' : 'bell', label: S.notify ? 'Mute Channel' : 'Unmute Channel', run: toggleMute },
      { icon: pinned ? 'unpin' : 'pin', label: pinned ? 'Unpin Channel' : 'Pin Channel', run: () => G.rowMenu(row, 'pin-button') },
      hidden && { icon: 'eye', label: showing ? 'Hide Deleted Messages' : `Show Deleted Messages (${hidden})`, run: () => document.body.classList.toggle('dc-show-deleted') },
      hidden && { icon: 'redo', label: 'Restore Deleted Messages', run: () => { c.h = {}; save(); scan(); toast('Messages restored', 'redo'); } },
      c && (Object.keys(c.r).length || c.p.length) && { icon: 'broom', label: 'Clear Reactions and Pins', run: () => { c.r = {}; c.p = []; save(); scan(); toast('Cleared for this channel', 'broom'); } },
      '-',
      { icon: 'edit', label: 'Edit Channel', run: () => G.rowMenu(row, 'rename-button') },
      { icon: 'add', label: 'Create Text Channel', run: G.newChat },
      { icon: 'trash', label: 'Delete Channel', danger: true, run: () => G.rowMenu(row, 'delete-button') },
      S.devMode && '-',
      S.devMode && { icon: 'id', label: 'Copy Channel ID', run: () => { copy(row.id || ''); toast('Copied channel ID', 'id'); } },
    ], close)), x, y, { onClose: () => row.a.classList.remove('dc-row-ctx') });
  }
  function openServerMenu(btn) {
    const r = btn.getBoundingClientRect();
    btn.classList.add('dc-on');
    popup((wrap, close) => wrap.append(menuList([
      { icon: 'nitro', label: 'Server Boost', run: G.upgrade },
      '-',
      { icon: 'invite', label: 'Invite People', cls: 'dc-brandi', run: shareChat },
      { icon: 'settings', label: 'Server Settings', run: () => openSettings() },
      { icon: 'add', label: 'Create Channel', run: G.newChat },
      { icon: 'hashLock', label: 'Create Private Channel', run: G.tempChat },
      { icon: 'folder', label: 'Create Category', run: G.newNotebook },
      { icon: 'calendar', label: 'Create Event', run: G.scheduled },
      { icon: 'apps', label: 'App Directory', run: G.customize },
      '-',
      { icon: 'bell', label: 'Notification Settings', run: () => openSettings('notifications') },
      { icon: 'shield', label: 'Privacy Settings', run: () => openSettings('privacy') },
      '-',
      { icon: 'edit', label: 'Edit Server Profile', run: () => G.settings('personal-intelligence-button') },
      { icon: S.collapsed.chats ? 'eye' : 'chevDown', label: S.collapsed.chats ? 'Show All Channels' : 'Collapse Channels', run: () => { S.collapsed.chats = !S.collapsed.chats; setS('collapsed', S.collapsed); scan(); } },
      '-',
      { icon: 'logout', label: 'Leave Server', danger: true, run: confirmLogout },
    ], close)), r.left + 8, r.bottom + 6, { onClose: () => btn.classList.remove('dc-on') });
  }
  function confirmLogout() {
    modal((box, close) => box.append(
      h('h3', { text: 'Leave ‘Gemini’' }),
      h('p', { text: 'Are you sure you want to leave? This switches the page back to the normal Gemini look. Your chats stay right where they are, and you can come back from the Tampermonkey menu.' }),
      h('div', { class: 'dc-actions' },
        h('button', { class: 'dc-btn dc-linkbtn', text: 'Cancel', onclick: close }),
        h('button', { class: 'dc-btn dc-red', text: 'Leave Server', onclick: () => { close(); turnOff(); } }))));
  }
  function turnOff() {
    gmSet(ON_KEY, false);
    toast('Switching to the Gemini version…', 'logout');
    setTimeout(() => location.reload(), 500);
  }
  async function setGeminiTheme(re) {
    const ok = await G.settings('desktop-theme-menu-button', re);
    if (!ok) toast("Couldn't change Gemini's theme", 'moon');
    geminiState = null;
    setTimeout(applyVars, 300);
  }
  function toggleMute() {
    setS('notify', !S.notify);
    toast(S.notify ? 'Channel unmuted' : 'Channel muted: no desktop notifications', S.notify ? 'bell' : 'bellOff');
    scan();
  }

  /* =====================================================================
     Channel header, member list / profile, search results, pins, inbox
     ===================================================================== */
  let header = null, searchInput = null, searchOpen = false, searchQ = '', searchSort = 'new';
  function buildHeader() {
    $$('#dc-header').forEach(e => e.remove());
    searchInput = h('input', { placeholder: 'Search', spellcheck: 'false', autocomplete: 'off' });
    const box = h('label', { class: 'dc-h-search' }, searchInput,
      h('button', { class: 'dc-h-clear', type: 'button', onclick: e => { e.preventDefault(); closeSearch(); } }, icon('close')), icon('search'));
    searchInput.addEventListener('input', () => { box.classList.toggle('dc-has', !!searchInput.value); if (!searchInput.value.trim() && searchOpen) closeSearch(); });
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); runSearch(searchInput.value); }
      if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); searchInput.blur(); }
    });
    header = h('div', { id: 'dc-header', class: 'dc-ui' },
      h('button', { class: 'dc-h-btn dc-h-burger', 'data-tip': 'Channels', 'data-tip-side': 'bottom', onclick: () => { const b = $('.side-nav-menu-button button') || findBtn(document, /open sidebar|main menu|expand menu/i, '.dc-ui'); b && b.click(); } }, icon('menu')),
      h('span', { class: 'dc-h-ic' }),
      h('span', { class: 'dc-h-title' }),
      h('span', { class: 'dc-h-dot' }),
      h('span', { class: 'dc-h-topic', onclick: openTopic }),
      h('div', { class: 'dc-h-tools' },
        h('button', { class: 'dc-h-btn', 'data-tip': 'Threads\nFiles in this chat', 'data-tip-side': 'bottom', onclick: () => G.convMenu('studio-sidebar-button') }, icon('threads')),
        h('button', { class: 'dc-h-btn dc-hb-bell', 'data-tip-side': 'bottom', onclick: toggleMute }),
        h('button', { class: 'dc-h-btn dc-hb-pins', 'data-tip': 'Pinned Messages', 'data-tip-side': 'bottom', onclick: e => openPins(e.currentTarget) }, icon('pin')),
        h('button', { class: 'dc-h-btn dc-hb-members', 'data-tip-side': 'bottom', onclick: () => { setS('members', !S.members); scan(); } }),
        box));
    document.body.append(header);
  }
  function renderHeader(title, kind, id) {
    const temp = !!$('chat-window.is-temporary-chat');
    const pi = kind !== 'chat' ? pageInfo() : null;
    const dm = S.view === 'dm';
    let ic, t, topic;
    if (pi) { ic = 'i:' + pi.icon; t = pi.title; topic = pi.status; }
    else if (temp) { ic = 'i:hashLock'; t = dm ? 'Temporary Chat' : 'temporary-chat'; topic = "Only you can see this. It won't be saved to your history."; }
    else if (id === '_new') { ic = dm ? 'bot' : 'i:hash'; t = dm ? 'Gemini' : 'new-chat'; topic = 'Ask Gemini anything'; }
    else {
      ic = dm ? 'av:' + title + '|' + id : 'i:hash'; t = dm ? title : chanName(title);
      const fu = MSGS.find(m => m.role === 'u' && !C().h[m.key]);
      topic = fu ? snip(fu.text, 220) : '';
    }
    const icEl = $('.dc-h-ic', header);
    if (icEl.dataset.k !== ic) { icEl.dataset.k = ic; icEl.replaceChildren(ic.startsWith('i:') ? icon(ic.slice(2)) : ic === 'bot' ? botAvatar(24) : avatar(title, id, 24)); }
    setText($('.dc-h-title', header), t);
    header.dataset.titleText = (ic.startsWith('i:hash') ? '#' : '') + t;
    header.dataset.topic = topic || '';
    setText($('.dc-h-topic', header), topic || '');
    setStyle($('.dc-h-dot', header), 'display', topic ? '' : 'none');
    const bell = $('.dc-hb-bell', header), bk = S.notify ? 'bell' : 'bellOff';
    if (bell.dataset.k !== bk) { bell.dataset.k = bk; bell.replaceChildren(icon(bk)); bell.setAttribute('data-tip', S.notify ? 'Mute Channel\nNo desktop notifications from it' : 'Unmute Channel'); }
    const mem = $('.dc-hb-members', header), mk = dm ? 'user' : 'people';
    if (mem.dataset.k !== mk) { mem.dataset.k = mk; mem.replaceChildren(icon(mk)); }
    mem.setAttribute('data-tip', (S.members ? 'Hide ' : 'Show ') + (dm ? 'User Profile' : 'Member List'));
    mem.classList.toggle('dc-on', !!S.members);
    const pins = $('.dc-hb-pins', header), np = C().p.length;
    let pb = $('b', pins);
    if (np) { if (!pb) { pb = h('b'); pins.append(pb); } setText(pb, String(np)); } else if (pb) pb.remove();
    setStyle($('.dc-h-tools', header), 'visibility', kind === 'chat' ? '' : 'hidden');
    searchInput.placeholder = dm ? 'Search' : 'Search Gemini';
  }
  function openTopic() {
    const t = header && header.dataset.topic;
    if (!t) return;
    modal((box, close) => box.append(h('h3', { text: header.dataset.titleText || '' }),
      h('p', { style: 'white-space:pre-wrap;max-height:50vh;overflow:auto', text: t }),
      h('div', { class: 'dc-actions' }, h('button', { class: 'dc-btn', text: 'Close', onclick: close }))));
  }

  let rightEl = null;
  function renderRight() {
    if (!rightEl || !rightEl.isConnected) { rightEl = h('aside', { id: 'dc-right', class: 'dc-ui' }); document.body.append(rightEl); }
    const chat = pageKind() === 'chat';
    const mode = searchOpen && chat ? 'search' : (S.members && chat && innerWidth > 1100) ? 'members' : null;
    rightEl.classList.toggle('dc-show', !!mode);
    rightEl.classList.toggle('dc-wide', mode === 'search');
    const w = mode === 'search' ? (innerWidth > 1100 ? 420 : 0) : mode === 'members' ? 264 : 0;
    document.documentElement.style.setProperty('--dc-right-w', w + 'px');
    if (mode === 'members') (S.view === 'dm' ? renderDmProfile : renderMembers)();
    else if (mode === 'search') renderSearchResults();
  }
  const memberSince = bot => {
    if (bot) return fmtShortDate(new Date(2023, 11, 6).getTime());
    const ts = Object.values(DB.chats).map(c => c.ts).filter(Boolean);
    return ts.length ? fmtShortDate(Math.min(...ts)) : fmtShortDate(Date.now());
  };
  function renderMembers() {
    const gen = isGenerating(), model = modelLabel();
    const sig = ['m', gen, model, G.name(), G.photo(), S.status].join('|');
    if (rightEl.dataset.sig === sig) return;
    rightEl.dataset.sig = sig;
    const mem = (who, av, name, act, bot) => h('div', { class: 'dc-mem', onclick: e => openProfile(who, e.currentTarget, 'left') }, av,
      h('div', { class: 'dc-mem-t' },
        h('div', { class: 'dc-mem-name' + (bot ? ' dc-bot' : '') }, h('span', { text: name }), bot ? h('span', { class: 'dc-tag', text: 'App' }) : null),
        act ? h('div', { class: 'dc-mem-act' }, act) : null));
    const gem = mem('gemini', withStatus(botAvatar(32), gen ? 'typing' : 'online'), 'Gemini',
      gen ? h('span', {}, h('b', { text: 'Typing' }), '…') : h('span', {}, 'Playing ', h('b', { text: model || 'Gemini' })), true);
    const me = mem('me', withStatus(userAvatar(32), S.status), G.name(), S.status === 'online' ? null : h('span', { text: STATUS[S.status] }));
    const invisible = S.status === 'invisible';
    rightEl.replaceChildren(...[
      h('div', { class: 'dc-mem-group', text: `Online — ${invisible ? 1 : 2}` }), gem, invisible ? null : me,
      invisible ? h('div', { class: 'dc-mem-group', text: 'Offline — 1' }) : null, invisible ? me : null].filter(Boolean));
  }
  function profileNodes(who, close) {
    const bot = who === 'gemini';
    const name = bot ? 'Gemini' : G.name();
    const roles = bot ? [['App', '#5865f2'], ['Gemini', '#8e6cf1'], ['Helpful', '#3ba55c']] : [['Owner', '#f0b232'], ['Human', '#3ba55c']];
    const note = h('textarea', { class: 'dc-prof-note', placeholder: 'Click to add a note', rows: '2' });
    note.value = (S.notes && S.notes[who]) || '';
    note.addEventListener('input', () => { S.notes[who] = note.value; setS('notes', S.notes); });
    const msg = h('input', { class: 'dc-input', placeholder: 'Message @Gemini' });
    msg.addEventListener('keydown', e => { if (e.key === 'Enter' && msg.value.trim()) { e.preventDefault(); const t = msg.value.trim(); close && close(); sendText(t); } });
    return [
      h('div', { class: 'dc-prof-banner', style: '--b:' + (bot ? 'linear-gradient(135deg,#4c8df6,#8e6cf1 60%,#d96570)' : colorFor('me')) }),
      h('div', { class: 'dc-prof-av' }, withStatus(bot ? botAvatar(80) : userAvatar(80), bot ? (isGenerating() ? 'typing' : 'online') : S.status)),
      h('div', { class: 'dc-prof-body' },
        h('div', { class: 'dc-prof-name' }, name, bot ? h('span', { class: 'dc-tag', text: 'App' }) : null),
        h('div', { class: 'dc-prof-user', text: bot ? 'gemini' : ((G.email() || '').split('@')[0] || name.toLowerCase().replace(/\s+/g, '')) }),
        h('div', { class: 'dc-prof-card' },
          h('div', { class: 'dc-prof-sec' }, h('h4', { text: 'About Me' }),
            h('div', { text: bot ? "Google's AI. Ask me anything, send photos and files, or try the tools in the + menu. I reply fast, I never sleep, I have no idea what 'touch grass' means." : 'Chatting with Gemini, Discord style.' })),
          h('div', { class: 'dc-prof-sec' }, h('h4', { text: 'Member Since' }), h('div', { text: memberSince(bot) })),
          h('div', { class: 'dc-prof-sec' }, h('h4', { text: 'Roles' }), h('div', { class: 'dc-roles' }, roles.map(([l, c]) => h('span', { class: 'dc-role', style: '--rc:' + c }, h('i'), l)))),
          h('div', { class: 'dc-prof-sec' }, h('h4', { text: 'Note' }), note)),
        bot ? h('div', { class: 'dc-prof-msg' }, msg)
          : h('div', { class: 'dc-prof-msg' }, h('button', { class: 'dc-btn', style: 'width:100%', text: 'Edit Profile', onclick: () => { close && close(); openSettings('account'); } }))),
    ];
  }
  function openProfile(who, anchor, side = 'right') {
    const r = anchor.getBoundingClientRect();
    popup((wrap, close) => wrap.append(h('div', { class: 'dc-pop dc-prof', style: 'position:relative;max-height:calc(100vh - 16px)' }, ...profileNodes(who, close))),
      side === 'left' ? r.left - 8 : side === 'top' ? r.left : r.right + 8, side === 'top' ? r.top - 8 : r.top, { alignRight: side === 'left', above: side === 'top' });
  }
  function renderDmProfile() {
    const sig = ['p', isGenerating(), S.notes.gemini || ''].join('|');
    if (rightEl.dataset.sig === sig) return;
    rightEl.dataset.sig = sig;
    rightEl.replaceChildren(h('div', { class: 'dc-prof', style: 'position:relative;width:100%' }, ...profileNodes('gemini')));
  }

  function runSearch(q) {
    searchQ = String(q || '').trim();
    searchOpen = !!searchQ;
    if (rightEl) rightEl.dataset.sig = '';
    $$('.dc-found').forEach(e => e.classList.remove('dc-found'));
    renderRight();
  }
  function closeSearch() {
    searchOpen = false; searchQ = '';
    if (searchInput) { searchInput.value = ''; searchInput.parentElement.classList.remove('dc-has'); }
    $$('.dc-found').forEach(e => e.classList.remove('dc-found'));
    if (rightEl) rightEl.dataset.sig = '';
    renderRight();
  }
  function highlightInto(el, text, q) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    const at = q ? text.toLowerCase().indexOf(q) : -1;
    if (at > 70) text = '…' + text.slice(at - 50);
    text = snip(text, 420);
    if (!q) { el.textContent = text; return el; }
    const lo = text.toLowerCase();
    let i = 0;
    for (;;) {
      const j = lo.indexOf(q, i);
      if (j < 0) { el.append(text.slice(i)); break; }
      el.append(text.slice(i, j), h('mark', { text: text.slice(j, j + q.length) }));
      i = j + q.length;
    }
    return el;
  }
  function msgHead(role, ts) {
    const bot = role === 'm';
    return h('h3', { class: 'dc-mh' },
      h('span', { class: 'dc-mh-name' + (bot ? ' dc-bot' : ''), text: bot ? 'Gemini' : G.name() }),
      bot ? h('span', { class: 'dc-tag', text: 'App' }) : null,
      ts ? h('time', { class: 'dc-mh-time', text: fmtStamp(ts), 'data-tip': fmtFull(ts) }) : null);
  }
  function msgCard(role, ts, text, onJump, q) {
    return h('div', { class: 'dc-card', onclick: onJump },
      h('span', { class: 'dc-avw' }, role === 'm' ? botAvatar(40) : userAvatar(40)),
      msgHead(role, ts), highlightInto(h('div', { class: 'dc-card-text' }), text, q),
      h('button', { class: 'dc-card-jump', text: 'Jump', onclick: e => { e.stopPropagation(); onJump(); } }));
  }
  const roleOfKey = k => k.includes(':') ? k.split(':').pop() : k[0];
  function renderSearchResults() {
    const q = searchQ.toLowerCase();
    const c = C();
    const res = MSGS.filter(m => !c.h[m.key] && m.text.toLowerCase().includes(q));
    if (searchSort === 'new') res.reverse();
    const sig = ['s', q, searchSort, res.length, convId()].join('|');
    if (rightEl.dataset.sig === sig) return;
    rightEl.dataset.sig = sig;
    const head = h('div', { class: 'dc-sr-head' },
      h('span', { class: 'dc-sr-count', text: res.length ? plural(res.length, 'Result', 'Results') : 'No Results' }),
      h('div', { class: 'dc-sr-tabs' }, [['new', 'New'], ['old', 'Old']].map(([k, l]) => h('button', { class: searchSort === k ? 'dc-on' : '', text: l, onclick: () => { searchSort = k; rightEl.dataset.sig = ''; renderSearchResults(); } }))),
      h('button', { class: 'dc-iconbtn', 'data-tip': 'Close', onclick: closeSearch }, icon('close')));
    const chan = h('div', { class: 'dc-sr-chan' }, icon(S.view === 'dm' ? 'at' : 'hash'), h('span', { text: S.view === 'dm' ? currentTitle() : chanName(currentTitle()) }));
    const cards = res.slice(0, 60).map(m => msgCard(m.role, msgTime(m), m.text, () => {
      $$('.dc-found').forEach(e => e.classList.remove('dc-found'));
      m.el.classList.add('dc-found'); m.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, q));
    const more = h('div', { class: 'dc-sr-more' }, h('button', { class: 'dc-btn dc-sec', style: 'width:100%', text: `Search all chats for “${snip(searchQ, 30)}”`, onclick: () => searchAll(searchQ) }));
    rightEl.replaceChildren(head, ...(res.length ? [chan, ...cards] : [emptyState('search', 'We searched far and wide.', 'No messages in this channel match. Try another word, or search all your chats.')]), more);
  }
  async function searchAll(q) {
    if (!G.searchChats()) { toast('Gemini search is not available here', 'search'); return; }
    const input = await waitFor(() => $$('input[type="text"], input[type="search"], textarea').find(i => visible(i) && !i.closest('.dc-ui')), 1500);
    if (input) { input.focus(); input.value = q; input.dispatchEvent(new Event('input', { bubbles: true })); }
    closeSearch();
  }
  function openPins(btn) {
    const r = btn.getBoundingClientRect();
    btn.classList.add('dc-on');
    popup((wrap, close) => {
      const c = C();
      const body = h('div', { class: 'dc-pop-body' });
      const render = () => {
        if (!c.p.length) { body.replaceChildren(emptyState('pin', "This channel doesn't have any pinned messages… yet.", 'Right-click a message and pick Pin Message to keep it here.')); return; }
        body.replaceChildren(...[...c.p].reverse().map(k => {
          const m = byKey(k);
          const card = msgCard(m ? m.role : roleOfKey(k), m ? msgTime(m) : 0, m ? m.text : (c.s[k] || ''), () => { close(); jumpTo(k, c.s[k]); });
          card.append(h('button', { class: 'dc-card-jump dc-card-x', text: 'Unpin', onclick: e => { e.stopPropagation(); c.p.splice(c.p.indexOf(k), 1); save(); scan(); render(); } }));
          return card;
        }));
      };
      render();
      wrap.append(h('div', { class: 'dc-pop', style: 'position:relative;width:420px;max-height:min(70vh,640px)' },
        h('div', { class: 'dc-pop-head' }, icon('pin'), h('span', { text: 'Pinned Messages' })), body));
    }, r.right, r.bottom + 8, { alignRight: true, onClose: () => btn.classList.remove('dc-on') });
  }
  let inboxTab = 'foryou';
  function openInbox(btn) {
    const r = btn.getBoundingClientRect();
    btn.classList.add('dc-on');
    popup((wrap, close) => {
      const body = h('div', { class: 'dc-pop-body', style: 'padding:0' });
      const tabs = h('div', { class: 'dc-tabs' });
      const render = () => {
        tabs.replaceChildren(...[['foryou', 'For You'], ['unreads', 'Unreads'], ['mentions', 'Mentions']].map(([k, l]) =>
          h('button', { class: 'dc-tab' + (inboxTab === k ? ' dc-on' : ''), text: l, onclick: () => { inboxTab = k; render(); } })));
        const rows = sidebarRows();
        let list = [];
        if (inboxTab === 'unreads') list = rows.filter(x => x.id && DB.unread[x.id]);
        else if (inboxTab === 'foryou') list = rows.filter(x => x.id && DB.prev[x.id] && DB.prev[x.id].r === 'm')
          .sort((a, b) => ((DB.chats[b.id] || {}).ts || 0) - ((DB.chats[a.id] || {}).ts || 0)).slice(0, 15);
        if (!list.length) {
          body.replaceChildren(inboxTab === 'mentions' ? emptyState('at', 'Nobody has @mentioned you… yet', 'Gemini only talks when you talk to it.')
            : inboxTab === 'unreads' ? emptyState('check', "You're all caught up!", 'Answers that land while you are away show up here.')
            : emptyState('inbox', 'Nothing here yet', 'Recent answers from Gemini show up here.'));
          return;
        }
        body.replaceChildren(...list.map(x => {
          const p = DB.prev[x.id] || {}, ts = (DB.chats[x.id] || {}).ts || p.ts;
          const n = DB.unread[x.id] || 0;
          return h('div', { class: 'dc-ib-item', onclick: () => { close(); x.a.click(); } },
            h('span', { class: 'dc-avw' }, p.r === 'u' ? userAvatar(40) : botAvatar(40)),
            h('div', { class: 'dc-ib-t' },
              h('div', { class: 'dc-ib-chan' }, icon('hash'), h('span', { text: chanName(x.title) }), n ? h('span', { class: 'dc-row-badge', text: String(n) }) : null),
              msgHead(p.r === 'u' ? 'u' : 'm', ts),
              h('div', { class: 'dc-card-text', text: p.t || '' })));
        }));
      };
      render();
      wrap.append(h('div', { class: 'dc-pop', style: 'position:relative;width:480px;max-height:min(80vh,600px)' },
        h('div', { class: 'dc-pop-head', style: 'border:0' }, icon('inbox'), h('span', { text: 'Inbox' }),
          h('button', { class: 'dc-iconbtn', 'data-tip': 'Mark all as read', onclick: () => { DB.unread = {}; save(); scan(); render(); } }, icon('check'))),
        tabs, body));
    }, r.right, r.bottom + 6, { alignRight: true, onClose: () => btn.classList.remove('dc-on') });
  }

  /* =====================================================================
     Quick switcher (Ctrl+K)
     ===================================================================== */
  function openQuickSwitcher() {
    if (closeModal) closeModal();
    modal((box, close) => {
      box.classList.add('dc-qs');
      const input = h('input', { placeholder: 'Where would you like to go?', spellcheck: 'false', autocomplete: 'off' });
      const list = h('div', { class: 'dc-qs-list' });
      let sel = 0, items = [];
      const pages = [['library', 'media', G.library], ['events', 'calendar', G.scheduled], ['gems', 'gem', G.customize], ['images', 'images', G.images],
        ['new-chat', 'add', G.newChat], ['temporary-chat', 'hashLock', G.tempChat], ['settings', 'settings', () => openSettings()]];
      const mark = () => items.forEach((it, i) => it.el.classList.toggle('dc-sel', i === sel));
      const add = (ic, name, cat, go) => {
        const el = h('div', { class: 'dc-qs-row' }, icon(ic), h('span', { class: 'dc-qs-name', text: name }), h('span', { class: 'dc-qs-cat', text: cat }));
        const it = { el, go };
        el.addEventListener('mousemove', () => { if (items[sel] !== it) { sel = items.indexOf(it); mark(); } });
        el.addEventListener('click', () => { close(); go(); });
        items.push(it);
        list.append(el);
      };
      const render = () => {
        const q = input.value.trim().toLowerCase().replace(/^[#@*!]\s*/, '');
        items = []; list.replaceChildren();
        const rows = sidebarRows().filter(r => !q || r.title.toLowerCase().includes(q) || chanName(r.title).includes(q)).slice(0, q ? 40 : 12);
        if (rows.length) list.append(h('div', { class: 'dc-qs-head', text: q ? 'Text Channels' : 'Previous Channels' }));
        rows.forEach(r => add('hash', chanName(r.title), 'Gemini', () => r.a.click()));
        const pg = pages.filter(p => !q || p[0].includes(q));
        if (pg.length) { list.append(h('div', { class: 'dc-qs-head', text: 'Gemini' })); pg.forEach(p => add(p[1], p[0], 'Page', p[2])); }
        if (!items.length) list.append(h('div', { class: 'dc-empty', style: 'padding:16px' }, h('b', { text: "Can't find what you're looking for?" }), 'Try another word.'));
        sel = Math.min(sel, Math.max(0, items.length - 1));
        mark();
      };
      input.addEventListener('input', () => { sel = 0; render(); });
      input.addEventListener('keydown', e => {
        if (!items.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; mark(); items[sel].el.scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + items.length - 1) % items.length; mark(); items[sel].el.scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'Enter') { e.preventDefault(); const it = items[sel]; if (it) { close(); it.go(); } }
      });
      box.append(input, list, h('div', { class: 'dc-qs-foot' }, h('b', { text: 'PROTIP: ' }), 'Type part of a chat name, or a page like library or settings. Ctrl+K opens this from anywhere.'));
      render();
    });
  }

  /* =====================================================================
     User Settings (full screen, like Discord)
     ===================================================================== */
  let settingsEl = null, setSection = 'account', geminiState = null;
  const SECTIONS = [
    ['h', 'User Settings'], ['account', 'My Account'], ['privacy', 'Data & Privacy'], ['apps', 'Authorized Apps'],
    ['h', 'Billing Settings'], ['nitro', 'Nitro'],
    ['h', 'App Settings'], ['appearance', 'Appearance'], ['accessibility', 'Accessibility'], ['chat', 'Chat'], ['notifications', 'Notifications'],
    ['keybinds', 'Keybinds'], ['language', 'Language'], ['advanced', 'Advanced'],
    ['h', 'Gemini'], ['gems', 'Gems & Skills'], ['help', 'Help & Feedback'],
  ];
  // Gemini's own pages and dialogs open under this layer, so close it first
  const go = fn => () => { closeSettings(); setTimeout(fn, 180); };
  function openSettings(section) {
    if (closePopup) closePopup();
    if (section) setSection = section;
    if (settingsEl && settingsEl.isConnected) { renderSettings(true); return; }
    settingsEl = h('div', { id: 'dc-settings', class: 'dc-ui', role: 'dialog' },
      h('div', { class: 'dc-set-side' }, h('nav', { class: 'dc-set-nav' })),
      h('div', { class: 'dc-set-main' }, h('div', { class: 'dc-set-scroll' }, h('div', { class: 'dc-set-content' })),
        h('div', { class: 'dc-set-close' }, h('button', { 'data-tip': 'Close', onclick: closeSettings }, icon('close')), h('span', { text: 'ESC' }))));
    document.body.append(settingsEl);
    renderSettings(true);
    G.readState().then(s => { if (s) { geminiState = s; if (settingsEl && ['privacy', 'appearance'].includes(setSection)) renderSettings(); } });
  }
  function closeSettings() {
    if (!settingsEl) return;
    const el = settingsEl;
    settingsEl = null;
    el.classList.add('dc-closing');
    setTimeout(() => el.remove(), 170);
  }
  function platformName() {
    const ua = navigator.userAgent;
    const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Web';
    const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
    return `${br} on ${os}`;
  }
  function renderSettings(top) {
    if (!settingsEl) return;
    const nav = $('.dc-set-nav', settingsEl), content = $('.dc-set-content', settingsEl);
    const find = h('input', { placeholder: 'Search', spellcheck: 'false' });
    find.addEventListener('input', () => {
      const q = find.value.trim().toLowerCase();
      $$('.dc-set-item[data-k]', nav).forEach(i => { i.style.display = !q || i.textContent.toLowerCase().includes(q) ? '' : 'none'; });
      $$('.dc-set-h', nav).forEach(x => { x.style.display = q ? 'none' : ''; });
    });
    nav.replaceChildren(
      h('label', { class: 'dc-set-find' }, find, icon('search')),
      ...SECTIONS.map(([k, l]) => k === 'h' ? h('div', { class: 'dc-set-h', text: l })
        : h('div', { class: 'dc-set-item' + (k === setSection ? ' dc-on' : ''), 'data-k': k, onclick: () => { setSection = k; renderSettings(true); } }, h('span', { text: l }))),
      h('div', { class: 'dc-set-sep' }),
      h('div', { class: 'dc-set-item dc-danger', onclick: confirmLogout }, h('span', { text: 'Log Out' }), icon('logout')),
      h('div', { class: 'dc-set-sep' }),
      h('div', { class: 'dc-set-ver' }, `Gemini · Discord ${VERSION}`, h('br'), 'Stable · Gemini web', h('br'), platformName()));
    content.replaceChildren(...(SETTINGS[setSection] || SETTINGS.account)());
    if (top) $('.dc-set-scroll', settingsEl).scrollTop = 0;
  }
  function field(o) {
    const sw = o.toggle != null ? h('span', { class: 'dc-switch' + (o.toggle ? ' dc-on' : '') }) : null;
    const el = h('div', { class: 'dc-field' + (o.run || sw ? ' dc-click' : '') },
      h('div', { class: 'dc-field-t' }, h('div', { class: 'dc-field-l', text: o.label }), o.desc ? h('div', { class: 'dc-field-d', text: o.desc }) : null),
      o.value ? h('span', { class: 'dc-field-v', text: o.value }) : null,
      o.button ? h('button', { class: 'dc-btn dc-sm ' + (o.buttonCls || 'dc-sec'), text: o.button, onclick: e => { e.stopPropagation(); o.run(); } }) : null,
      sw, !sw && !o.button && o.run ? icon('chevRight') : null);
    if (sw) el.addEventListener('click', () => { const on = !sw.classList.contains('dc-on'); sw.classList.toggle('dc-on', on); o.run && o.run(on); });
    else if (o.run && !o.button) el.addEventListener('click', o.run);
    return el;
  }
  const radioRow = (label, sub, on, run) => h('div', { class: 'dc-radio-row' + (on ? ' dc-on' : ''), onclick: run }, h('span', { class: 'dc-radio' }), h('div', {}, label, sub ? h('small', { text: sub }) : null));
  const label = (t, style) => h('div', { class: 'dc-set-label', style: style || null, text: t });
  const desc = t => h('p', { class: 'dc-set-desc', text: t });
  function rangeRow(title, min, max, val, unit, set, ticks) {
    const v = h('span', { text: val + unit });
    const inp = h('input', { type: 'range', min: String(min), max: String(max), step: '1', value: String(val) });
    inp.addEventListener('input', () => { setText(v, inp.value + unit); set(+inp.value); });
    return h('div', { class: 'dc-range' }, h('div', { class: 'dc-set-label', style: 'display:flex;justify-content:space-between' }, h('span', { text: title }), v), inp,
      h('div', { class: 'dc-range-ticks' }, ticks.map(t => h('span', { text: t + unit }))));
  }
  function setTheme(k) {
    setS('theme', k);
    if (k === 'light') setGeminiTheme(/^light$/i);
    else if (k === 'sync') setGeminiTheme(/^system$/i);
    else if (isLight()) setGeminiTheme(/^dark$/i);
    renderSettings();
  }
  async function setWatermark(v) {
    await G.settings('watermark-button', new RegExp('^' + v + '$', 'i'));
    toast('Media watermark: ' + v, 'watermark');
    geminiState = null;
    G.readState().then(s => { if (s) { geminiState = s; renderSettings(); } });
  }
  function confirmClear() {
    modal((box, close) => box.append(h('h3', { text: 'Clear local data' }),
      h('p', { text: 'Remove reactions, pinned messages and hidden messages from every channel on this browser?' }),
      h('div', { class: 'dc-actions' }, h('button', { class: 'dc-btn dc-linkbtn', text: 'Cancel', onclick: close }),
        h('button', { class: 'dc-btn dc-red', text: 'Clear', onclick: () => { DB.c = {}; save(); close(); scan(); toast('Cleared', 'broom'); } }))));
  }
  const langLabel = () => { try { const l = (document.documentElement.lang || navigator.language || 'en'); return new Intl.DisplayNames([l], { type: 'language' }).of(l.split('-')[0]); } catch (e) { return 'English'; } };
  const SETTINGS = {
    account() {
      const name = G.name(), email = G.email();
      const user = email ? email.split('@')[0] : name.toLowerCase().replace(/\s+/g, '');
      const masked = email ? '•'.repeat(Math.min(10, user.length)) + '@' + email.split('@')[1] : '—';
      const emailV = h('span', { text: masked });
      const reveal = h('a', { text: 'Reveal', onclick: () => { const shown = reveal.textContent === 'Hide'; setText(emailV, shown ? masked : email); setText(reveal, shown ? 'Reveal' : 'Hide'); } });
      const accField = (l, v) => h('div', { class: 'dc-acc-field' }, h('div', {}, label(l), h('div', { class: 'dc-acc-v' }, v)), h('button', { class: 'dc-btn dc-sec dc-sm', text: 'Edit', onclick: G.account }));
      return [
        h('h2', { text: 'My Account' }),
        h('div', { class: 'dc-acc' },
          h('div', { class: 'dc-acc-banner', style: '--b:' + colorFor('me') }),
          h('div', { class: 'dc-acc-row' }, withStatus(userAvatar(80), S.status), h('div', { class: 'dc-acc-name', text: name }),
            h('button', { class: 'dc-btn', style: 'margin-bottom:8px', text: 'Edit User Profile', onclick: G.account })),
          h('div', { class: 'dc-acc-fields' }, accField('Display Name', name), accField('Username', user), accField('Email', [emailV, email ? reveal : null]))),
        h('h3', { text: 'Password and Authentication' }),
        desc('Your Gemini account is your Google Account, so passwords, 2-Step Verification and passkeys live there.'),
        h('button', { class: 'dc-btn', text: 'Manage Google Account', onclick: G.account }),
        h('div', { class: 'dc-set-div' }),
        label('Account Removal'),
        desc("Logging out here only switches this page back to the normal Gemini look. Your chats stay where they are, and you can switch back from Tampermonkey's menu."),
        h('button', { class: 'dc-btn dc-outline-red', text: 'Switch to Gemini', onclick: confirmLogout }),
      ];
    },
    privacy() {
      const st = geminiState || {};
      const val = x => Array.isArray(x) ? x[0] : (x || '');
      const wm = String(val(st.watermark));
      return [
        h('h2', { text: 'Data & Privacy' }),
        label('How Gemini uses your data'),
        field({ label: 'Gemini Apps Activity', desc: 'Your chat history and what Google keeps to improve Gemini.', run: go(() => G.settings('desktop-bard-activity-control')) }),
        field({ label: 'Personal Intelligence', desc: 'What Gemini remembers about you across chats.', run: go(() => G.settings('personal-intelligence-button')) }),
        field({ label: 'Your Public Links', desc: 'Chats you shared with a link.', run: go(() => G.settings('toggle-shared-links-button')) }),
        field({ label: 'Import Memory to Gemini', desc: 'Bring over what other assistants know about you.', run: go(() => G.settings('import-hub-settings-button')) }),
        field({ label: 'Location', desc: 'Used for local answers.', value: val(st.location), button: 'Update', run: go(() => G.settings('location-menu-button', /update location/i)) }),
        label('Media Watermark', 'margin-top:28px'),
        desc('Adds a visible watermark to images and videos Gemini makes.'),
        radioRow('On', '', /^on$/i.test(wm), () => setWatermark('On')),
        radioRow('Off', '', /^off$/i.test(wm), () => setWatermark('Off')),
        h('div', { class: 'dc-set-div' }),
        label('On this device'),
        field({ label: 'Load Chat Previews', desc: 'Fetch the last message of each chat for the DM list and the Inbox.', toggle: S.previews, run: on => setS('previews', on) }),
        field({ label: 'Clear Reactions, Pins and Hidden Messages', desc: 'They only live in this browser.', button: 'Clear', buttonCls: 'dc-outline-red', run: confirmClear }),
      ];
    },
    apps: () => [
      h('h2', { text: 'Authorized Apps' }),
      desc('Apps Gemini can use for you, like Gmail, Drive, Maps and YouTube. Type @ in the message box to mention one.'),
      field({ label: 'Connected Apps', desc: 'See and manage what Gemini can reach.', run: go(() => G.settings(/^(apps|connected apps|extensions)/i).then(ok => { if (!ok) location.href = '/apps'; })) }),
      field({ label: 'Developer Mode', desc: "Gemini's own developer options.", run: go(() => G.settings(/developer mode/i)) }),
    ],
    nitro: () => [
      h('div', { class: 'dc-nitro' }, icon('nitro'), h('h3', { text: 'Unleash more fun with Google AI Plus' }),
        h('p', { text: 'Bigger limits, the best models, Deep Research, video and more. Basically Nitro, but for Gemini.' }),
        h('button', { class: 'dc-btn', text: 'Subscribe', onclick: go(G.upgrade) })),
      label('Your plan'),
      field({ label: 'Usage Limits', desc: 'How much of each model you have left.', run: go(() => G.settings('desktop-usage-metrics-button')) }),
      field({ label: 'Cart and Orders', desc: 'Things you bought through Gemini.', run: go(() => G.settings('shopping-cart-button')) }),
    ],
    appearance() {
      const sw = (k, l, color) => h('div', { class: 'dc-swatch' + (S.theme === k ? ' dc-on' : ''), onclick: () => setTheme(k) }, h('i', { style: '--c:' + color }), h('span', { text: l }));
      const accents = ['#5865f2', '#3ba55c', '#eb459e', '#f0b232', '#ed4245', '#00a8fc', '#9b84ec', '#e67e22'];
      const dots = h('div', { class: 'dc-dots-c' }, accents.map(c => h('button', { class: S.accent === c ? 'dc-on' : '', style: '--c:' + c, 'data-tip': c,
        onclick: e => { setS('accent', c); $$('button', dots).forEach(b => b.classList.toggle('dc-on', b === e.currentTarget)); } })));
      return [
        h('h2', { text: 'Appearance' }),
        label('Theme'),
        h('div', { class: 'dc-swatches' }, sw('light', 'Light', '#ffffff'), sw('ash', 'Ash', '#323339'), sw('dark', 'Dark', '#1a1a1e'), sw('onyx', 'Onyx', '#000000'),
          sw('sync', 'Sync', 'linear-gradient(135deg, #ffffff 50%, #1a1a1e 50%)')),
        label('Color'), dots,
        rangeRow('Chat Font Scaling', 12, 24, S.fontSize, 'px', v => setS('fontSize', v), [12, 14, 16, 18, 20, 24]),
        rangeRow('Space Between Message Groups', 0, 24, S.groupSpacing, 'px', v => setS('groupSpacing', v), [0, 4, 8, 16, 24]),
        label('Channel List'),
        field({ label: 'Discord-style Channel Names', desc: "Show chats as lowercase-names-with-dashes. Turn it off to keep Gemini's titles.", toggle: S.chanNames, run: on => { setS('chanNames', on); scan(); } }),
      ];
    },
    accessibility: () => [
      h('h2', { text: 'Accessibility' }),
      label('Motion'),
      field({ label: 'Enable Reduced Motion', desc: 'Turns off animations like popping menus and typing dots.', toggle: !S.motion, run: on => setS('motion', !on) }),
      label('Chat Input', 'margin-top:28px'),
      field({ label: 'Show Send Message Button', desc: "A send button in the message box, for when Enter isn't your thing.", toggle: S.sendBtn, run: on => setS('sendBtn', on) }),
    ],
    chat() {
      const picks = ['', '👍', '❤️', '😂', '🔥', '💯', '😭', '🙏'];
      const grid = h('div', { class: 'dc-dots-c' }, picks.map(e => h('button', { class: S.quick === e ? 'dc-on' : '', style: '--c:var(--dc-mod-2);font:20px/1 var(--dc-emoji);color:var(--dc-text)', text: e || '✕',
        'data-tip': e ? 'Double-click reacts with ' + e : 'Off', onclick: ev => { setS('quick', e); $$('button', grid).forEach(b => b.classList.toggle('dc-on', b === ev.currentTarget)); } })));
      return [
        h('h2', { text: 'Chat' }),
        label('Display'),
        field({ label: 'Show Member List', desc: 'Gemini and you, on the right side of wide windows.', toggle: S.members, run: on => { setS('members', on); scan(); } }),
        field({ label: "Show Gemini's Buttons Under Answers", desc: 'Thumbs, share and copy under each reply. Everything is also in the hover bar and the right-click menu.', toggle: S.geminiButtons, run: on => setS('geminiButtons', on) }),
        label('Double-click to react', 'margin-top:28px'),
        grid,
      ];
    },
    notifications: () => [
      h('h2', { text: 'Notifications' }),
      field({ label: 'Enable Desktop Notifications', desc: "Get notified when Gemini finishes an answer while you're in another tab.", toggle: S.notify, run: on => {
        setS('notify', on);
        if (on && typeof GM_notification !== 'function' && window.Notification && Notification.permission === 'default') Notification.requestPermission();
      } }),
      field({ label: 'Message Sound', desc: 'Plays when an answer lands in the background.', toggle: S.sound, run: on => { setS('sound', on); if (on) ding(); renderUserPanel(); } }),
      field({ label: 'Enable Unread Message Badge', desc: 'Shows the unread count in the tab title.', toggle: S.titleCount, run: on => setS('titleCount', on) }),
      desc('Setting your status to Do Not Disturb silences notifications and sounds.'),
    ],
    keybinds() {
      const k = (...keys) => h('span', {}, keys.map(x => h('span', { class: 'dc-kbd', text: x })));
      const r = (l, keys) => h('div', { class: 'dc-kbd-row' }, h('span', { text: l }), keys);
      return [h('h2', { text: 'Keybinds' }),
        r('Quick Switcher', k('Ctrl', 'K')), r('Search this channel', k('Ctrl', 'F')), r('Previous / next channel', k('Alt', '↑ / ↓')), r('User Settings', k('Ctrl', ',')),
        r('Edit your last message', k('↑')), r('Close menus, cancel reply', k('Esc')), r('New chat', k('Ctrl', 'Shift', 'O')), r('Dictate', k('Ctrl', 'Shift', 'D')),
        r('Message menu', k('Right-click')), r('Browser menu', k('Shift', 'Right-click'))];
    },
    language: () => [
      h('h2', { text: 'Language' }),
      label('Select a language'),
      radioRow(langLabel(), 'From your Google Account', true, () => {}),
      field({ label: 'Change Language', desc: 'Gemini uses the language of your Google Account.', run: () => window.open('https://myaccount.google.com/language', '_blank', 'noopener') }),
      field({ label: 'Translate Into', desc: 'Used by Translate in the message menu.', value: langName(CONFIG.translateTo) }),
    ],
    advanced: () => [
      h('h2', { text: 'Advanced' }),
      field({ label: 'Developer Mode', desc: 'Adds Copy Message ID and Copy Channel ID to the menus.', toggle: S.devMode, run: on => setS('devMode', on) }),
      field({ label: 'Switch to Gemini Version', desc: "Go back to the normal Gemini look. Switch back from Tampermonkey's menu.", button: 'Switch', buttonCls: 'dc-outline-red', run: turnOff }),
    ],
    gems: () => [
      h('h2', { text: 'Gems & Skills' }),
      field({ label: 'Gems', desc: 'Custom versions of Gemini for specific jobs.', run: go(() => G.settings('desktop-gems-manager-settings-button')) }),
      field({ label: 'Skills', desc: 'Things you taught Gemini to do for you.', run: go(() => G.settings(/^skills$/i)) }),
      field({ label: 'Avatar', desc: 'How Gemini looks to you.', run: go(() => G.settings('likeness-button')) }),
      field({ label: 'Personal Context', desc: 'Saved info and instructions for Gemini.', run: go(G.customize) }),
    ],
    help: () => [
      h('h2', { text: 'Help & Feedback' }),
      field({ label: 'Send Feedback', run: go(() => G.settings('send-feedback-button')) }),
      field({ label: 'Gemini Help Center', run: go(() => G.settings('help-button', /help center/i)) }),
      field({ label: 'Privacy Policy', run: go(() => G.settings('help-button', /privacy/i)) }),
      field({ label: 'Install App', run: go(G.getApp) }),
    ],
  };

  /* =====================================================================
     Messages: hover bar, right-click menu, reactions, reply, forward, pins
     ===================================================================== */
  let MSGS = [];
  const byKey = k => MSGS.find(m => m.key === k);
  const RE_EDIT = /edit/i, RE_REDO = /redo|regenerate|try again|retry/i, RE_TTS = /listen|read aloud|text.?to.?speech|tts/i, RE_SHARE = /share|export/i;
  const clickMsg = (msg, re) => { const b = msgBtn(msg, re); if (b) b.click(); };
  const replyTo = msg => setContext({ type: 'reply', name: nameOf(msg.role), role: msg.role, text: msg.text, key: msg.key });

  const EMOJI_DATA = {
    People: 'grinning 😀|smiley 😃|smile 😄|grin 😁|laughing 😆|sweat_smile 😅|joy 😂|rofl 🤣|blush 😊|innocent 😇|slight_smile 🙂|upside_down 🙃|wink 😉|relieved 😌|heart_eyes 😍|smiling_face_with_hearts 🥰|kissing_heart 😘|yum 😋|stuck_out_tongue 😛|zany_face 🤪|sunglasses 😎|nerd 🤓|star_struck 🤩|partying_face 🥳|smirk 😏|unamused 😒|pensive 😔|worried 😟|confused 😕|pleading_face 🥺|face_holding_back_tears 🥹|cry 😢|sob 😭|triumph 😤|angry 😠|rage 😡|exploding_head 🤯|flushed 😳|scream 😱|thinking 🤔|shushing_face 🤫|rolling_eyes 🙄|grimacing 😬|melting_face 🫠|saluting_face 🫡|sleeping 😴|drooling_face 🤤|nauseated_face 🤢|face_vomiting 🤮|mask 😷|cowboy 🤠|clown 🤡|skull 💀|ghost 👻|alien 👽|robot 🤖|jack_o_lantern 🎃|smiley_cat 😺|see_no_evil 🙈|hear_no_evil 🙉|speak_no_evil 🙊',
    Gestures: 'thumbsup 👍|thumbsdown 👎|ok_hand 👌|v ✌️|crossed_fingers 🤞|love_you_gesture 🤟|metal 🤘|call_me 🤙|wave 👋|point_up ☝️|point_right 👉|clap 👏|raised_hands 🙌|heart_hands 🫶|pray 🙏|handshake 🤝|muscle 💪|writing_hand ✍️|nail_care 💅|eyes 👀|brain 🧠',
    Symbols: 'heart ❤️|orange_heart 🧡|yellow_heart 💛|green_heart 💚|blue_heart 💙|purple_heart 💜|black_heart 🖤|white_heart 🤍|broken_heart 💔|heart_on_fire ❤️‍🔥|sparkling_heart 💖|100 💯|anger 💢|boom 💥|dizzy 💫|sweat_drops 💦|fire 🔥|sparkles ✨|star ⭐|star2 🌟|zap ⚡|white_check_mark ✅|x ❌|question ❓|exclamation ❗|warning ⚠️|no_entry ⛔|speech_balloon 💬|thought_balloon 💭',
    Nature: 'dog 🐶|cat 🐱|mouse 🐭|fox 🦊|bear 🐻|panda_face 🐼|koala 🐨|tiger 🐯|lion_face 🦁|frog 🐸|monkey_face 🐵|chicken 🐔|penguin 🐧|unicorn 🦄|dragon 🐉|butterfly 🦋|cherry_blossom 🌸|rose 🌹|rainbow 🌈|sunny ☀️|crescent_moon 🌙|snowflake ❄️|cactus 🌵|four_leaf_clover 🍀',
    Food: 'coffee ☕|pizza 🍕|hamburger 🍔|fries 🍟|taco 🌮|sushi 🍣|doughnut 🍩|cookie 🍪|cake 🍰|popcorn 🍿|apple 🍎|avocado 🥑|beer 🍺|wine_glass 🍷',
    Activities: 'tada 🎉|confetti_ball 🎊|gift 🎁|trophy 🏆|first_place 🥇|video_game 🎮|headphones 🎧|musical_note 🎵|art 🎨|soccer ⚽|basketball 🏀',
    Objects: 'computer 💻|iphone 📱|bulb 💡|pushpin 📌|books 📚|rocket 🚀|gem 💎|moneybag 💰|crown 👑|hourglass ⌛|alarm_clock ⏰|lock 🔒|key 🔑|hammer 🔨|bell 🔔|camera 📷|tv 📺',
  };
  const EMOJIS = [], CATS = [], EMO_NAME = {};
  for (const [cat, list] of Object.entries(EMOJI_DATA)) {
    const items = list.split('|').map(x => { const i = x.indexOf(' '); return { n: x.slice(0, i), e: x.slice(i + 1) }; });
    items.forEach(it => { EMOJIS.push(it); if (!EMO_NAME[it.e]) EMO_NAME[it.e] = it.n; });
    CATS.push([cat, items]);
  }
  const emojiName = e => EMO_NAME[e] || 'emoji';
  const FACES = ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😋', '😛', '🤪', '😎', '🤓', '🥳', '😏'];
  function openEmojiPicker(x, y, pick, opts = {}) {
    popup((wrap, close) => {
      const input = h('input', { placeholder: 'Find the perfect emoji', spellcheck: 'false' });
      const body = h('div', { class: 'dc-epick-body' });
      const prevE = h('span', { text: '😀' }), prevN = h('span', { text: ':grinning:' });
      const render = () => {
        const q = input.value.trim().toLowerCase().replace(/:/g, '');
        body.replaceChildren();
        const groups = q ? [['Search Results', EMOJIS.filter(e => e.n.includes(q))]] : [['Frequently Used', S.recent.map(e => ({ e, n: emojiName(e) }))], ...CATS];
        for (const [title, list] of groups) {
          if (!list.length) continue;
          body.append(h('div', { class: 'dc-epick-cat', text: title }), h('div', { class: 'dc-epick-grid' }, list.map(it => {
            const b = h('button', { text: it.e });
            b.addEventListener('mouseenter', () => { setText(prevE, it.e); setText(prevN, ':' + it.n + ':'); });
            b.addEventListener('mousedown', ev => ev.preventDefault());
            b.addEventListener('click', ev => { ev.stopPropagation(); if (!ev.shiftKey) close(); pick(it.e); });
            return b;
          })));
        }
        if (!body.children.length) body.append(emptyState('smile', 'No emoji found', 'Try another word, like heart or fire.'));
      };
      input.addEventListener('input', render);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { const b = $('.dc-epick-grid button', body); if (b) b.click(); } });
      render();
      wrap.append(h('div', { class: 'dc-pop dc-epick', style: 'position:relative' }, h('div', { class: 'dc-epick-head' }, input), body, h('div', { class: 'dc-epick-foot' }, prevE, prevN)));
      setTimeout(() => input.focus(), 30);
    }, x, y, opts);
  }

  const reactsOf = key => { const v = C().r[key]; return Array.isArray(v) ? v : v ? [v] : []; };
  function bumpRecent(e) { setS('recent', [e, ...S.recent.filter(x => x !== e)].slice(0, 6)); }
  function react(msg, emoji, fromUser = true) {
    const c = C();
    const list = reactsOf(msg.key).slice();
    const i = list.indexOf(emoji);
    if (i >= 0) list.splice(i, 1); else list.push(emoji);
    if (list.length) c.r[msg.key] = list; else delete c.r[msg.key];
    save();
    if (i < 0) bumpRecent(emoji);
    if (fromUser && i < 0 && msg.role === 'm' && (emoji === '👍' || emoji === '👎')) {
      const b = msgBtn(msg, emoji === '👍' ? /good response|thumb.?up|like/i : /bad response|thumb.?down|dislike/i);
      if (b) b.click();
    }
    decorate(msg, i < 0 ? emoji : null);
  }

  let msgBar = null, msgBarFor = null;
  function showMsgBar(msg) {
    if (!msgBar) { msgBar = h('div', { id: 'dc-msgbar', class: 'dc-ui' }); msgBar.addEventListener('mousedown', e => e.preventDefault()); }
    if (msgBarFor === msg.el && msgBar.parentElement === msg.el) return;
    msgBarFor = msg.el;
    const btn = (tip, content, run, cls) => h('button', { class: cls || null, 'data-tip': tip, onclick: e => { e.stopPropagation(); run(e.currentTarget); } }, content);
    msgBar.replaceChildren(...[
      ...S.recent.slice(0, 3).map(e => btn(':' + emojiName(e) + ':', e, () => react(msg, e), 'dc-mb-emo')),
      h('span', { class: 'dc-mb-sep' }),
      btn('Add Reaction', icon('reactAdd'), b => { const r = b.getBoundingClientRect(); openEmojiPicker(r.right, r.bottom + 6, e => react(msg, e), { alignRight: true }); }),
      msg.role === 'u' && msgBtn(msg, RE_EDIT) ? btn('Edit', icon('edit'), () => clickMsg(msg, RE_EDIT)) : null,
      btn('Reply', icon('reply'), () => replyTo(msg)),
      btn('Forward', icon('forward'), () => openForward([msg])),
      btn('More', icon('moreH'), b => { const r = b.getBoundingClientRect(); openMessageMenu(msg, r.right, r.bottom + 6, { alignRight: true }); })].filter(Boolean));
    msg.el.append(msgBar);
  }
  function hideMsgBar() { if (msgBar && msgBar.isConnected) msgBar.remove(); msgBarFor = null; }
  document.addEventListener('mouseover', e => {
    if (!document.body.classList.contains('dc-on')) return;
    const t = e.target;
    if (!t.closest || t.closest('#dc-msgbar')) return;
    const el = t.closest('user-query, model-response');
    if (!el || el.closest('.dc-ui')) { if (!t.closest('.dc-menu-wrap, .dc-backdrop')) hideMsgBar(); return; }
    const msg = MSGS.find(m => m.el === el);
    if (msg && !el.classList.contains('dc-deleted')) showMsgBar(msg);
  }, LC);

  function openMessageMenu(msg, x, y, extra = {}) {
    const c = C();
    const pinned = c.p.includes(msg.key);
    const has = re => !!msgBtn(msg, re);
    msg.el.classList.add('dc-msg-active');
    popup((wrap, close) => {
      const mine = reactsOf(msg.key);
      const bar = h('div', { class: 'dc-reactbar' }, S.recent.slice(0, 4).map(e =>
        h('button', { class: mine.includes(e) ? 'dc-on' : '', 'data-tip': ':' + emojiName(e) + ':', onclick: ev => { ev.stopPropagation(); close(); react(msg, e); } }, e)));
      const apps = () => [
        msg.role === 'm' && has(RE_REDO) && { icon: 'redo', label: 'Regenerate', run: () => clickMsg(msg, RE_REDO) },
        msg.role === 'm' && has(RE_TTS) && { icon: 'speaker', label: 'Listen (Gemini)', run: () => clickMsg(msg, RE_TTS) },
        msg.role === 'm' && has(RE_SHARE) && { icon: 'share', label: 'Share & Export', run: () => clickMsg(msg, RE_SHARE) },
        { icon: 'translate', label: 'Translate', run: () => openTranslate(msg) },
      ].filter(Boolean);
      const items = [];
      if (extra.selection) items.push({ icon: 'copy', label: 'Copy', run: () => { copy(extra.selection); toast('Copied!', 'copy'); } });
      if (extra.link) items.push({ icon: 'newtab', label: 'Open Link', run: () => window.open(extra.link, '_blank', 'noopener') }, { icon: 'link', label: 'Copy Link', run: () => { copy(extra.link); toast('Link copied!', 'link'); } });
      if (items.length) items.push('-');
      items.push({ icon: 'reactAdd', label: 'Add Reaction', end: '', run: () => openEmojiPicker(x, y, e => react(msg, e)) });
      if (msg.role === 'u' && has(RE_EDIT)) items.push({ icon: 'edit', label: 'Edit Message', run: () => clickMsg(msg, RE_EDIT) });
      items.push({ icon: 'reply', label: 'Reply', run: () => replyTo(msg) });
      items.push({ icon: 'forward', label: 'Forward', run: () => openForward([msg]) });
      items.push({ icon: 'copy', label: 'Copy Text', run: () => { copy(msg.text); toast('Copied!', 'copy'); } });
      items.push({ icon: pinned ? 'unpin' : 'pin', label: pinned ? 'Unpin Message' : 'Pin Message', run: () => togglePin(msg) });
      items.push({ icon: 'apps', label: 'Apps', sub: apps });
      items.push({ icon: 'unread', label: 'Mark Unread', run: () => { const id = convId(); if (id !== '_new') { DB.unread[id] = 1; save(); scan(); toast('Marked as unread', 'unread'); } } });
      items.push({ icon: 'link', label: 'Copy Message Link', run: () => { copy(location.origin + location.pathname + (msg.rid ? '#' + msg.rid : '')); toast('Link copied!', 'link'); } });
      items.push({ icon: 'speaker', label: 'Speak Message', run: () => speak(msg.text) });
      items.push('-');
      items.push({ icon: 'trash', label: 'Delete Message', danger: true, run: () => confirmDelete(msg) });
      if (S.devMode) items.push('-', { icon: 'id', label: 'Copy Message ID', run: () => { copy(msg.rid || msg.key); toast('Copied message ID', 'id'); } });
      const menuEl = menuList(items, close);
      menuEl.prepend(bar);
      wrap.append(menuEl);
    }, x, y, { alignRight: !!extra.alignRight, onClose: () => msg.el.classList.remove('dc-msg-active') });
  }
  function quoteCard(msg) {
    return h('div', { class: 'dc-quote' }, h('span', { class: 'dc-avw' }, msg.role === 'm' ? botAvatar(40) : userAvatar(40)), msgHead(msg.role, msgTime(msg)),
      h('div', { class: 'dc-card-text', text: snip(msg.text, 300) }));
  }
  function togglePin(msg) {
    const c = C();
    const i = c.p.indexOf(msg.key);
    const where = header ? (header.dataset.titleText || '') : '';
    modal((box, close) => {
      const doIt = () => {
        if (i >= 0) { c.p.splice(i, 1); toast('Message unpinned', 'unpin'); }
        else { c.p.push(msg.key); c.s[msg.key] = snip(msg.text, 140); toast('Message pinned', 'pin'); }
        save(); close(); scan();
      };
      box.append(
        h('h3', { text: i >= 0 ? 'Unpin Message' : 'Pin It. Pin It Good.' }),
        h('p', { text: i >= 0 ? 'You sure you want to remove this pinned message?' : `Hey, just double checking that you want to pin this message to ${where} for posterity and greatness?` }),
        quoteCard(msg),
        h('div', { class: 'dc-actions' }, h('button', { class: 'dc-btn dc-linkbtn', text: i >= 0 ? 'Cancel' : 'No, thanks', onclick: close }),
          h('button', { class: 'dc-btn' + (i >= 0 ? ' dc-red' : ''), text: i >= 0 ? 'Remove Pin' : 'Oh yeah. Pin it', onclick: doIt })));
    });
  }
  function confirmDelete(msg) {
    modal((box, close) => box.append(
      h('h3', { text: 'Delete Message' }),
      h('p', { text: 'Are you sure you want to delete this message?' }),
      quoteCard(msg),
      h('p', { class: 'dc-note', text: "Gemini can't remove single messages from its history, so this one is hidden on this device. Right-click the channel to show or restore deleted messages." }),
      h('div', { class: 'dc-actions' }, h('button', { class: 'dc-btn dc-linkbtn', text: 'Cancel', onclick: close }),
        h('button', { class: 'dc-btn dc-red', text: 'Delete', onclick: () => { C().h[msg.key] = 1; save(); close(); hideMsgBar(); scan(); toast('Message deleted', 'trash'); } }))));
  }
  function openTranslate(msg) {
    const text = msg.text;
    modal((box, close) => {
      const out = h('div', { class: 'dc-card-text', style: 'display:block;-webkit-line-clamp:unset;max-height:30vh;overflow:auto;white-space:pre-wrap', text: 'Translating…' });
      const lab = h('div', { class: 'dc-set-label', style: 'padding:0 24px', text: langName(CONFIG.translateTo) });
      const actions = h('div', { class: 'dc-actions' }, h('button', { class: 'dc-btn', text: 'Close', onclick: close }));
      box.append(h('h3', { text: 'Translate Message' }),
        h('div', { class: 'dc-set-label', style: 'padding:0 24px', text: 'Original' }), quoteCard(msg),
        lab, h('div', { class: 'dc-quote', style: 'padding-left:12px' }, out), actions);
      translateText(text).then(r => {
        if (r) {
          setText(out, r.text);
          setText(lab, r.same ? `Already in ${langName(r.src)}` : `${langName(r.src)} → ${langName(CONFIG.translateTo)}`);
          actions.prepend(h('button', { class: 'dc-btn dc-sec', text: 'Copy', onclick: () => { copy(r.text); toast('Copied!', 'copy'); } }));
        } else {
          setText(out, "Your browser doesn't have built-in translation here. Pick another way:");
          actions.prepend(
            h('button', { class: 'dc-btn dc-sec', text: 'Google Translate', onclick: () => window.open('https://translate.google.com/?sl=auto&tl=' + CONFIG.translateTo + '&op=translate&text=' + encodeURIComponent(text.slice(0, 4500)), '_blank', 'noopener') }),
            h('button', { class: 'dc-btn dc-sec', text: 'Ask Gemini', onclick: () => {
              close();
              replyTo(msg);
              insertText('Translate this message into ' + langName(CONFIG.translateTo) + '.', false);
              sendWithContext();
            } }));
        }
      });
    });
  }

  /* reply / forward context + sending */
  let ctx = null, bypass = false, ping = true;
  function setContext(c) { ctx = c; renderReplyBar(); const e = editor(); if (e) e.focus(); }
  function clearContext() { ctx = null; renderReplyBar(); }
  function renderReplyBar() {
    let bar = $('#dc-replybar');
    const host = $('input-area-v2');
    if (!ctx) { if (bar) { bar.classList.remove('dc-show'); bar.dataset.v = ''; } return; }
    if (!host) return;
    if (!bar || !bar.isConnected || bar.nextElementSibling !== host) {
      if (bar) bar.remove();
      bar = h('div', { id: 'dc-replybar', class: 'dc-ui' });
      host.parentElement.insertBefore(bar, host);
    }
    const fwd = ctx.type === 'forward';
    const sig = JSON.stringify(ctx) + ping;
    if (bar.dataset.v === sig && bar.classList.contains('dc-show')) return;
    bar.dataset.v = sig;
    bar.replaceChildren(...[
      h('span', { class: 'dc-rb-text' }, ...(fwd
        ? ['Forwarding ', h('b', { text: ctx.items.length > 1 ? ctx.items.length + ' messages' : 'a message from ' + ctx.items[0].name })]
        : ['Replying to ', h('b', { text: ctx.name })])),
      fwd ? null : h('button', { class: 'dc-rb-ping' + (ping ? '' : ' dc-off'), 'data-tip': ping ? 'Click to stop pinging the original author' : 'Click to ping the original author', onclick: () => { ping = !ping; renderReplyBar(); } }, icon('at'), ping ? 'On' : 'Off'),
      h('button', { class: 'dc-rb-x', 'data-tip': 'Cancel', onclick: clearContext }, icon('xCircle'))].filter(Boolean));
    bar.classList.add('dc-show');
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
  function sendText(text) {
    if (!text || !editor()) return;
    insertText(text, false);
    noteSend();
    let tries = 0;
    const go = () => {
      const b = sendButton();
      if (b) { bypass = true; try { b.click(); } finally { bypass = false; } return; }
      if (++tries < 20) setTimeout(go, 80);
    };
    setTimeout(go, 120);
  }
  function openForward(msgs) {
    const items = msgs.map(m => ({ name: nameOf(m.role), text: m.text }));
    modal((box, close) => {
      const list = h('div', { class: 'dc-modal-body', style: 'max-height:240px;margin:0 8px' });
      const input = h('input', { class: 'dc-input', placeholder: 'Search', spellcheck: 'false', style: 'margin:0 24px 8px;width:calc(100% - 48px)' });
      const note = h('input', { class: 'dc-input', placeholder: 'Add an optional message...', style: 'margin:4px 24px 0;width:calc(100% - 48px)' });
      let pick = null;
      const send = h('button', { class: 'dc-btn', text: 'Send', disabled: true, onclick: () => {
        if (!pick) return;
        const extraText = note.value.trim();
        close();
        ctx = { type: 'forward', items };
        pick.go();
        setTimeout(() => { renderReplyBar(); if (extraText) insertText(extraText, false); }, 500);
      } });
      const render = () => {
        const q = input.value.toLowerCase();
        const rows = [{ title: 'new-chat', id: '_new', go: () => G.newChat() }]
          .concat(sidebarRows().map(r => ({ title: r.title, id: r.id, go: () => { if (r.id !== convId()) r.a.click(); } })));
        list.replaceChildren(...rows.filter(r => !q || r.title.toLowerCase().includes(q) || chanName(r.title).includes(q)).slice(0, 40).map(r =>
          h('div', { class: 'dc-pick' + (pick && pick.id === r.id ? ' dc-on' : ''), onclick: () => { pick = r; send.disabled = false; render(); } },
            icon('hash'), h('span', { text: r.id === '_new' ? 'new-chat' : chanName(r.title) }), h('span', { class: 'dc-pick-check' }))));
      };
      input.addEventListener('input', render);
      const first = msgs[0];
      box.append(h('h3', { text: 'Forward To' }), h('p', { class: 'dc-note', text: 'Pick the channel this message should go to.' }), input, list,
        first ? quoteCard(first) : null, note,
        h('div', { class: 'dc-actions' }, h('button', { class: 'dc-btn dc-linkbtn', text: 'Cancel', onclick: close }), send));
      render();
    });
  }

  /* the message box: + menu, model picker, gift / GIF / emoji, placeholder, typing and jump bars */
  let savedRange = null;
  document.addEventListener('selectionchange', () => {
    const s = getSelection();
    if (s.rangeCount && s.anchorNode && s.anchorNode.parentElement && s.anchorNode.parentElement.closest('.ql-editor')) savedRange = s.getRangeAt(0).cloneRange();
  }, L);
  function focusEditor() { const ed = editor(); if (ed) placeCaret(false); }
  function insertEmoji(e) {
    const ed = editor();
    if (!ed) return;
    ed.focus();
    const s = getSelection();
    if (savedRange && ed.contains(savedRange.startContainer)) { s.removeAllRanges(); s.addRange(savedRange); } else placeCaret(false);
    document.execCommand('insertText', false, e);
    savedRange = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
    bumpRecent(e);
  }
  const chanTitle = () => $('chat-window.is-temporary-chat') ? 'temporary-chat' : convId() === '_new' ? 'new-chat' : chanName(currentTitle());
  function decorateComposer() {
    const field = $('input-area-v2 .text-input-field');
    if (field && !$(':scope > .dc-cbtns', field)) {
      $$('.dc-cbtns', field).forEach(b => b.remove());
      const gift = h('button', { class: 'dc-cbtn', type: 'button', 'data-tip': 'Upgrade to Google AI Plus\nIt is basically Nitro', onclick: G.upgrade }, icon('gift'));
      const gif = h('button', { class: 'dc-cbtn', type: 'button', 'data-tip': 'Create image', onclick: () => toolAction(/^create image/i).then(ok => { if (ok) focusEditor(); else toast("Couldn't find Create image in Gemini's tools", 'images'); }) }, icon('gif'));
      const emo = h('button', { class: 'dc-cbtn dc-emo', type: 'button', 'data-tip': 'Select emoji', text: '😀' });
      emo.addEventListener('mouseenter', () => setText(emo, FACES[Math.floor(Math.random() * FACES.length)]));
      emo.addEventListener('mousedown', e => e.preventDefault());
      emo.addEventListener('click', e => {
        e.stopPropagation();
        const r = emo.getBoundingClientRect();
        emo.classList.add('dc-on');
        openEmojiPicker(r.right, r.top - 8, insertEmoji, { above: true, alignRight: true, onClose: () => emo.classList.remove('dc-on') });
      });
      field.append(h('div', { class: 'dc-cbtns dc-ui' }, gift, gif, emo));
    }
    const area = $('input-area-v2');
    if (area) {
      const ph = 'Message ' + (S.view === 'dm' ? '@' + (convId() === '_new' ? 'Gemini' : currentTitle()) : '#' + chanTitle());
      if (area.dataset.ph !== ph) { area.dataset.ph = ph; area.style.setProperty('--dc-ph', JSON.stringify(ph)); }
    }
    if (ctx) renderReplyBar();
  }
  let typingEl = null, jumpEl = null, newBar = null, unread = 0, unreadSince = 0;
  function renderBars(kind, gen) {
    const host = $('input-container');
    if (host) {
      if (!typingEl || typingEl.parentElement !== host) {
        if (typingEl) typingEl.remove();
        typingEl = h('div', { id: 'dc-typing', class: 'dc-ui' }, h('span', { class: 'dc-dots' }, h('i'), h('i'), h('i')), h('span', {}, h('b', { text: 'Gemini' }), ' is typing…'));
        host.append(typingEl);
      }
      typingEl.classList.toggle('dc-show', gen && kind === 'chat');
    }
    const s = scroller();
    if (s && !s.dataset.dcScroll) { s.dataset.dcScroll = '1'; s.addEventListener('scroll', schedule, { passive: true, signal: life.signal }); }
    const far = s ? s.scrollHeight - s.scrollTop - s.clientHeight > 400 : false;
    if (!far) unread = 0;
    if (host) {
      if (!jumpEl || jumpEl.parentElement !== host) {
        if (jumpEl) jumpEl.remove();
        jumpEl = h('div', { id: 'dc-jump', class: 'dc-ui', onclick: () => { const sc = scroller(); if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); unread = 0; } },
          h('span', { text: "You're Viewing Older Messages" }), h('b', {}, 'Jump To Present', icon('arrowDown')));
        host.prepend(jumpEl);
      }
      jumpEl.classList.toggle('dc-show', far && kind === 'chat');
    }
    if (!newBar || !newBar.isConnected) {
      newBar = h('div', { id: 'dc-newbar', class: 'dc-ui', onclick: () => { unread = 0; schedule(); } }, h('span'), h('b', {}, 'Mark As Read', icon('check')));
      document.body.append(newBar);
    }
    const show = unread > 0 && far && kind === 'chat';
    newBar.classList.toggle('dc-show', show);
    if (show) {
      setText(newBar.firstChild, `${unread === 1 ? '1 new message' : unread + ' new messages'} since ${fmtTime(unreadSince || Date.now())}`);
      const cr = ($('bard-sidenav-content') || document.body).getBoundingClientRect();
      const rw = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--dc-right-w'), 10) || 0;
      setStyle(newBar, 'left', Math.round(cr.left + 16) + 'px');
      setStyle(newBar, 'width', Math.max(200, Math.round(cr.width - 32)) + 'px');
      setStyle(newBar, 'top', Math.round(header.getBoundingClientRect().bottom) + 'px');
      if (rw && cr.right > innerWidth - rw) setStyle(newBar, 'width', Math.max(200, Math.round(innerWidth - rw - cr.left - 32)) + 'px');
    }
  }
  function jumpTo(key, quoteText) {
    let m = byKey(key);
    if (!m && quoteText) { const q = quoteText.replace(/…$/, '').slice(0, 60).toLowerCase(); m = MSGS.find(x => x.text.replace(/\s+/g, ' ').toLowerCase().includes(q)); }
    if (!m) { toast('Message not loaded — scroll up to load older messages', 'info'); return; }
    m.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    m.el.classList.remove('dc-flash'); void m.el.offsetWidth; m.el.classList.add('dc-flash');
    setTimeout(() => m.el.classList.remove('dc-flash'), 1700);
  }
  // live send times, keyed by the prompt text (Gemini swaps the message elements once the reply lands)
  const liveBySig = {}, firstSeen = new WeakMap();
  let lastSent = null, lastConv = null;
  function normSig(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 400); }
  function noteSend() { lastSent = { t: Date.now(), sig: normSig(editorText()) }; }
  function msgTime(msg) {
    const live = liveBySig[msg.usig];
    return (msg.rid && DB.ts[msg.rid]) || (live && (msg.role === 'u' ? live.u : live.m)) || C().t[msg.key] || 0;
  }
  // every message gets Discord's avatar, name (+ APP tag), timestamp, reply line and reactions
  function decorate(msg, popEmoji) {
    const c = C();
    const { el, role, key } = msg;
    el.classList.toggle('dc-deleted', !!c.h[key]);
    const bot = role === 'm';
    const who = bot ? 'gemini' : 'me';
    let av = $(':scope > .dc-mav', el);
    const avKey = bot ? 'bot' : 'me:' + G.photo();
    if (!av || av.dataset.k !== avKey) {
      if (av) av.remove();
      av = bot ? botAvatar(40) : userAvatar(40);
      av.classList.add('dc-mav', 'dc-ui');
      av.dataset.k = avKey;
      av.addEventListener('click', e => { e.stopPropagation(); openProfile(who, av, 'right'); });
      el.prepend(av);
    }
    let head = $(':scope > .dc-mh', el);
    if (!head) {
      head = h('h3', { class: 'dc-mh dc-ui' }, h('span', { class: 'dc-mh-name' + (bot ? ' dc-bot' : '') }), bot ? h('span', { class: 'dc-tag', text: 'App' }) : null, h('time', { class: 'dc-mh-time' }));
      $('.dc-mh-name', head).addEventListener('click', e => { e.stopPropagation(); openProfile(who, e.currentTarget, 'right'); });
      av.after(head);
    }
    setText($('.dc-mh-name', head), bot ? 'Gemini' : G.name());
    const ts = msgTime(msg);
    const tEl = $('.dc-mh-time', head), tstr = ts ? fmtStamp(ts) : '';
    if (tEl.dataset.v !== tstr) { tEl.dataset.v = tstr; setText(tEl, tstr); tEl.setAttribute('data-tip', ts ? fmtFull(ts) : ''); }

    if (role === 'u') {
      const u = userText(el), p = u.parsed;
      let ref = $(':scope > .dc-reply', el);
      if (p.kind === 'reply') {
        if (!ref || ref.dataset.sig !== u.sig) {
          if (ref) ref.remove();
          const rb = /^gemini$/i.test(p.name);
          ref = h('div', { class: 'dc-reply dc-ui', 'data-sig': u.sig, onclick: ev => { ev.stopPropagation(); jumpTo(null, p.quote.join(' ')); } },
            rb ? botAvatar(16) : userAvatar(16), h('span', { class: 'dc-reply-name' + (rb ? ' dc-bot' : ''), text: '@' + p.name }), h('span', { class: 'dc-reply-text', text: p.quote.join(' ') }));
          head.before(ref);
        }
      } else if (ref) ref.remove();
      el.classList.toggle('dc-has-reply', p.kind === 'reply');
      const q = $('.query-text', el) || msg.bubble;
      let fwd = $(':scope > .dc-fwd', q);
      if (p.kind === 'forward') {
        if (!fwd || fwd.dataset.sig !== u.sig) {
          if (fwd) fwd.remove();
          fwd = h('span', { class: 'dc-fwd dc-ui', 'data-sig': u.sig },
            h('span', { class: 'dc-fwd-head' }, icon('forward'), 'Forwarded' + (p.name && !/messages$/.test(p.name) ? ' from ' + p.name : '')),
            h('span', { class: 'dc-fwd-body', text: p.quote.join('\n') }));
          q.prepend(fwd);
        }
      } else if (fwd) fwd.remove();
      if (p.kind) {
        u.raw.forEach((r, i) => r.el && r.el.classList.toggle('dc-hidden', i < p.used));
        const firstBody = u.raw[p.used];
        u.raw.forEach(r => r.el && r.el.classList.toggle('dc-fwd-comment', p.kind === 'forward' && r === firstBody));
      }
    }

    const list = reactsOf(key);
    let reacts = $(':scope > .dc-reacts', el);
    if (list.length) {
      if (!reacts) reacts = h('div', { class: 'dc-reacts dc-ui' });
      if (reacts.parentElement !== el) el.append(reacts);
      const sig = list.join(',');
      if (reacts.dataset.e !== sig || popEmoji) {
        reacts.dataset.e = sig;
        const add = h('button', { class: 'dc-react dc-react-add', 'data-tip': 'Add Reaction', onclick: ev => { ev.stopPropagation(); const r = ev.currentTarget.getBoundingClientRect(); openEmojiPicker(r.left, r.bottom + 6, e => react(msg, e)); } }, icon('reactAdd'));
        reacts.replaceChildren(...list.map(e => h('button', { class: 'dc-react dc-me' + (e === popEmoji ? ' dc-popin' : ''), 'data-tip': 'You reacted with :' + emojiName(e) + ':',
          onclick: ev => { ev.stopPropagation(); react(msg, e, false); } }, e, h('b', { text: '1' }))), add);
      }
    } else if (reacts) reacts.remove();
  }
  // a line with the date before the first message of each day
  function decorateDates() {
    let lastDay = null;
    const c = C();
    for (const m of MSGS) {
      if (m.role !== 'u') continue;
      const turn = m.turn || m.el;
      const ts = msgTime(m);
      let div = $(':scope > .dc-divider', turn);
      const day = ts ? new Date(ts).toDateString() : null;
      if (day && day !== lastDay && !c.h[m.key]) {
        if (!div) { div = h('div', { class: 'dc-divider dc-ui' }, h('span')); turn.prepend(div); }
        setText(div.firstChild, fmtDivider(ts));
      } else if (div) div.remove();
      if (day) lastDay = day;
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
    try { return fn(); } catch (e) { if (!warned[name]) { warned[name] = 1; console.warn('[Gemini·Discord] ' + name + ':', e); } return undefined; }
  }
  function scan() {
    if (disposed) return;
    lastScan = Date.now();
    if (!document.body) return;
    document.body.classList.add('dc-on');
    applyVars();
    if (!titleBar || !titleBar.isConnected) safe('frame', buildFrame);
    if (!header || !header.isConnected) safe('header0', buildHeader);

    const id = convId();
    if (lastConv !== id) safe('switch', () => {
      if (lastConv === '_new' && id !== '_new' && DB.c._new) {
        const n = DB.c._new, t = C(id);
        Object.assign(t.r, n.r); Object.assign(t.h, n.h); Object.assign(t.t, n.t); Object.assign(t.s, n.s); t.p.push(...n.p);
        delete DB.c._new; save();
      }
      if (lastConv && id !== lastConv) { closeSearch(); unread = 0; hideMsgBar(); }
      if (DB.unread[id]) { delete DB.unread[id]; save(); }
    });
    if (lastConv !== id) lastConv = id;
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
            if (s && s.scrollHeight - s.scrollTop - s.clientHeight > 400) { if (!unread) unreadSince = now; unread++; }
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
    if (msgBarFor && (!msgBarFor.isConnected || !MSGS.some(m => m.el === msgBarFor))) hideMsgBar();

    // last message of this chat, for the DM list and the Inbox
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
    document.body.classList.toggle('dc-page', kind !== 'chat');
    const title = safe('title', currentTitle) || 'Gemini';
    safe('layout', () => {
      const side = $('bard-sidenav');
      const sr = side ? side.getBoundingClientRect() : null;
      const open = !!(sr && sr.width > 120);
      document.body.classList.toggle('dc-side-closed', !open);
      setStyle(header, 'left', (open ? Math.round(sr.right) : 72) + 'px');
      setStyle(header, 'right', '0px');
    });
    safe('header', () => renderHeader(title, kind, id));
    safe('right', renderRight);
    safe('bars', () => renderBars(kind, gen));
    if (wasGenerating && !gen) safe('done', () => answerDone(title, id));
    wasGenerating = gen;
    safe('sidebar', () => decorateSidebar(gen));
    safe('rail', renderRail);
    safe('user', renderUserPanel);
    safe('titlebar', renderTitleBar);
    safe('composer', decorateComposer);
  }
  function answerDone(title, id) {
    if (!document.hidden) return;
    const last = MSGS[MSGS.length - 1];
    const text = last ? snip(last.text, 140) : 'New message';
    if (id && id !== '_new') { DB.unread[id] = (DB.unread[id] || 0) + 1; save(); }
    hiddenUnread++;
    if (S.titleCount) document.title = `(${hiddenUnread}) ` + document.title.replace(/^\(\d+\)\s*/, '');
    if (S.status === 'dnd') return;
    if (S.sound) ding();
    if (!S.notify) return;
    const where = S.view === 'dm' ? 'Gemini' : 'Gemini (#' + chanName(title) + ')';
    try {
      if (typeof GM_notification === 'function') GM_notification({ title: where, text, timeout: 6000, onclick: () => window.focus() });
      else if (window.Notification && Notification.permission === 'granted') new Notification(where, { body: text });
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
    if (!el || e.target.closest('#dc-msgbar, .dc-menu-wrap, .dc-pop')) return null;
    return MSGS.find(m => m.el === el) || (scan(), MSGS.find(m => m.el === el));
  }
  document.addEventListener('contextmenu', e => {
    if (e.shiftKey || !document.body.classList.contains('dc-on')) return;
    const rowEl = e.target.closest && e.target.closest('gem-nav-list-item[data-test-id="conversation"]');
    if (rowEl) {
      const r = sidebarRows().find(x => x.item === rowEl);
      if (r) { e.preventDefault(); openRowMenu(r, e.clientX, e.clientY); }
      return;
    }
    if (e.target.closest('#dc-header .dc-h-title, #dc-header .dc-h-ic')) {
      const r = currentRow();
      if (r) { e.preventDefault(); openRowMenu(r, e.clientX, e.clientY); }
      return;
    }
    if (e.target.closest('img, video, canvas, .ql-editor, input, textarea')) return;
    const msg = msgFromEvent(e);
    if (!msg) return;
    e.preventDefault();
    const sel = String(getSelection() || '').trim();
    const inMsg = sel && msg.el.contains(getSelection().anchorNode);
    const a = e.target.closest('a[href]');
    openMessageMenu(msg, e.clientX, e.clientY, { selection: inMsg ? sel : '', link: a ? a.href : '' });
  }, LC);
  document.addEventListener('click', e => {
    if (bypass) return;
    const b = e.target.closest && e.target.closest('button');
    if (b && b === sendButton() && !b.closest('.dc-ui')) {
      if (!ctx) noteSend();
      if (ctx) { e.preventDefault(); e.stopImmediatePropagation(); sendWithContext(); }
    }
  }, LC);
  document.addEventListener('dblclick', e => {
    if (!S.quick) return;
    if (e.target.closest('a, pre, code, button, .dc-ui, .ql-editor')) return;
    const msg = msgFromEvent(e);
    if (!msg) return;
    getSelection().removeAllRanges();
    react(msg, S.quick);
  }, LC);
  function stepChannel(dir) {
    const rows = sidebarRows().filter(r => visible(r.a));
    if (!rows.length) return;
    const i = rows.findIndex(isActiveRow);
    const next = rows[i < 0 ? 0 : (i + dir + rows.length) % rows.length];
    if (next) next.a.click();
  }
  window.addEventListener('keydown', e => {
    const inEditor = e.target.closest && e.target.closest('.ql-editor');
    const key = (e.key || '').toLowerCase();
    if (e.key === 'Escape' && e.isTrusted) {
      if (closePopup) { closePopup(); return; }
      if (closeModal) { closeModal(); return; }
      if (settingsEl) { closeSettings(); return; }
      if (window.speechSynthesis && speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
      if (searchOpen) { closeSearch(); return; }
      if (ctx) { clearContext(); return; }
      if (unread) { unread = 0; schedule(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'k') { e.preventDefault(); e.stopPropagation(); openQuickSwitcher(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === ',') { e.preventDefault(); openSettings(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'f' && pageKind() === 'chat' && convId() !== '_new' && searchInput) { e.preventDefault(); searchInput.focus(); searchInput.select(); return; }
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); stepChannel(e.key === 'ArrowUp' ? -1 : 1); return; }
    if (!inEditor) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      if (!ctx) noteSend();
      if (ctx) { e.preventDefault(); e.stopImmediatePropagation(); sendWithContext(); }
    }
    if (e.key === 'ArrowUp' && !e.altKey && !editorText().trim() && !ctx) {
      const last = [...MSGS].reverse().find(m => m.role === 'u');
      const b = last && msgBtn(last, RE_EDIT);
      if (b) { e.preventDefault(); b.click(); }
    }
  }, LC);
  window.addEventListener('resize', schedule, L);

  let mainObserver = null, mainTimer = 0;
  const ours = n => n.nodeType === 1 && (n.classList.contains('dc-ui') || n.id === 'dc-toast' || n.id === 'dc-tip');
  function start() {
    if (disposed) return;
    mainObserver = new MutationObserver(muts => {
      for (const m of muts) {
        const t = m.target;
        if (t && t.nodeType === 1 && (t.closest('.dc-ui') || t.id === 'dc-toast')) continue;
        if (m.type === 'childList' && (m.addedNodes.length + m.removedNodes.length) && [...m.addedNodes, ...m.removedNodes].every(ours)) continue;
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
    clearInterval(mainTimer); clearTimeout(scanTimer); clearTimeout(saveTimer); clearTimeout(tipTimer);
    try { if (closePopup) closePopup(); if (closeModal) closeModal(); } catch (e) { /* ignore */ }
    if (W.__dcOnRpc === onRpcText) W.__dcOnRpc = null;
    $$('#dc-titlebar, #dc-rail, #dc-user, #dc-header, #dc-right, #dc-settings, #dc-tip, #dc-toast, #dc-replybar, #dc-typing, #dc-jump, #dc-newbar, #dc-msgbar, #dc-side-top, #dc-resizer, ' +
       '.dc-side-head, .dc-cbtns, .dc-menu.dc-sub, .dc-row-ic, .dc-row-av, .dc-row-txt, .dc-row-acts, .dc-row-pill, .dc-cat, .dc-mav, .dc-mh, .dc-reply, .dc-fwd, .dc-reacts, .dc-divider').forEach(e => e.remove());
    const marks = ['dc-row-on', 'dc-row-ctx', 'dc-row-unread', 'dc-collapsed-row', 'dc-deleted', 'dc-found', 'dc-msg-active', 'dc-flash', 'dc-hidden', 'dc-fwd-comment', 'dc-has-reply'];
    $$(marks.map(m => '.' + m).join(',')).forEach(e => e.classList.remove(...marks));
    $$('[data-dc-scroll]').forEach(s => delete s.dataset.dcScroll);
    const area = $('input-area-v2'); if (area) { area.style.removeProperty('--dc-ph'); delete area.dataset.ph; }
    for (const v of ['--dc-brand', '--dc-msg', '--dc-gap', '--dc-side-w', '--dc-right-w']) document.documentElement.style.removeProperty(v);
    if (styleEl) styleEl.remove();
    if (document.body) document.body.classList.remove('dc-on', 'dc-light', 'dc-ash', 'dc-onyx', 'dc-page', 'dc-still', 'dc-hide-gemini-actions', 'dc-send-btn', 'dc-dm', 'dc-plain-names',
      'dc-side-closed', 'dc-ghost', 'dc-show-deleted', 'dc-resizing');
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, L);
})();
