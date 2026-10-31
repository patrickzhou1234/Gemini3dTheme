// ==UserScript==
// @name         Gemini · Claude
// @namespace    gemini-claude-clay
// @version      1.0.0
// @description  Makes Gemini look and work like claude.ai: Claude's sidebar with Starred and Recents, the chat title bar with Share and incognito, right-aligned prompts, serif answers with Claude's copy / retry / thumbs bar, the message box with its controls underneath, Ctrl+K chat search, the account menu and Claude's Settings dialog. Neutral (new) or warm (classic) colours, light and dark.
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
    palette:   'neutral', // 'neutral' (Claude today) or 'warm' (classic cream and clay)
    mode:      'sync',    // 'sync' (follows Gemini), 'light' or 'dark'
    respFont:  'serif',   // answers in 'serif' (Claude's look) or 'sans'
    textSize:  'medium',  // 'small', 'medium' or 'large'
    width:     'narrow',  // chat column: 'narrow' or 'wide'
    sideWidth: 288,       // sidebar width in px (you can also drag its edge)
    notify: true,         // notification when an answer finishes while the tab is in the background
  };
  /* ========================================================================= */

  const VERSION = '1.0.0';
  const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
  const hasGM = typeof GM_getValue === 'function';
  const gmGet = (k, d) => {
    try { if (hasGM) return GM_getValue(k, d); } catch (e) { /* fall through */ }
    try { const v = localStorage.getItem('cl:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  };
  const gmSet = (k, v) => {
    try { if (typeof GM_setValue === 'function') { GM_setValue(k, v); return; } } catch (e) { /* fall through */ }
    try { localStorage.setItem('cl:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ }
  };

  const ON_KEY = 'cl_on';
  const enabled = gmGet(ON_KEY, true) !== false;
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand(enabled ? 'Switch to Gemini version' : 'Switch to Claude version', () => { gmSet(ON_KEY, !enabled); location.reload(); });
  }
  if (!enabled) return;

  // A newer copy loaded into the same page (an update being tried out) retires this one:
  // everything below listens with `L`/`LC`, so one abort() removes it all.
  const life = new AbortController();
  const L = { signal: life.signal }, LC = { capture: true, signal: life.signal };
  let disposed = false;
  try { W.dispatchEvent(new CustomEvent('cl-takeover')); } catch (e) { /* ignore */ }
  W.addEventListener('cl-takeover', () => dispose(), L);

  /* ---------- storage ---------- */
  const STORE = 'cl_gemini_data_v1';
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
    palette: CONFIG.palette, mode: CONFIG.mode, respFont: CONFIG.respFont, textSize: CONFIG.textSize, width: CONFIG.width,
    sideWidth: CONFIG.sideWidth, motion: 'system', notify: CONFIG.notify, sound: true, titleCount: true, geminiButtons: false,
    collapsed: {},
  }, DB.set);
  function setS(k, v) { S[k] = v; DB.set[k] = v; save(); applyVars(); }
  const isLight = () => document.body.classList.contains('light-theme') && !document.body.classList.contains('dark-theme');
  const SIZES = { small: 14, medium: 16, large: 18 };
  function applyVars() {
    const r = document.documentElement;
    if (!r) return;
    r.style.setProperty('--cl-resp-size', (SIZES[S.textSize] || 16) + 'px');
    r.style.setProperty('--cl-col', S.width === 'wide' ? '1040px' : '768px');
    r.style.setProperty('--cl-side-w', Math.round(S.sideWidth) + 'px');
    const b = document.body;
    if (!b) return;
    const light = S.mode === 'light' || (S.mode === 'sync' && isLight());
    b.classList.toggle('cl-light', light);
    b.classList.toggle('cl-warm', S.palette === 'warm');
    b.classList.toggle('cl-sans', S.respFont === 'sans');
    b.classList.toggle('cl-still', S.motion === 'reduce' || (S.motion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches));
    b.classList.toggle('cl-hide-gemini-actions', !S.geminiButtons);
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
  W.__clOnRpc = onRpcText;
  const toCurrent = text => { const fn = W.__clOnRpc; if (typeof fn === 'function') fn(text); };
  (function hookNetwork() {
    try {
      const f = W.fetch;
      origFetch = (f && f.__clOrig) || f;
      if (f && !f.__clHook) {
        const wrapped = function (input) {
          const p = f.apply(W, arguments);
          try {
            const url = typeof input === 'string' ? input : (input && input.url) || String(input);
            if (url.indexOf('batchexecute') > -1 && RPC_RE.test(url)) p.then(r => r.clone().text()).then(toCurrent).catch(() => {});
          } catch (e) { /* ignore */ }
          return p;
        };
        wrapped.__clHook = 1;
        wrapped.__clOrig = f;
        W.fetch = wrapped;
      }
      const XP = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
      if (XP && !XP.__clHook) {
        const open = XP.open, send = XP.send;
        XP.open = function (m, u) { try { this.__clu = String(u); } catch (e) { /* ignore */ } return open.apply(this, arguments); };
        XP.send = function () {
          try { if (this.__clu && this.__clu.indexOf('batchexecute') > -1 && RPC_RE.test(this.__clu)) this.addEventListener('load', () => { try { toCurrent(this.responseText); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }
          return send.apply(this, arguments);
        };
        XP.__clHook = 1;
      }
    } catch (e) { /* page blocks it: times fall back to live capture */ }
  })();

  /* ===================== Styles ===================== */
  const svgUrl = (body, vb = '0 0 24 24', extra = 'fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"') =>
    `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" ${extra}>${body}</svg>`)}")`;
  const M_PLUS = svgUrl('<path d="M12 5v14M5 12h14"/>', '0 0 24 24', 'fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round"');
  const M_UP = svgUrl('<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>', '0 0 24 24', 'fill="none" stroke="black" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"');
  const M_STOP = svgUrl('<rect x="7" y="7" width="10" height="10" rx="1.5"/>', '0 0 24 24', 'fill="black"');
  const M_MIC = svgUrl('<path d="M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>', '0 0 24 24', 'fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"');
  const M_CHEV = svgUrl('<path d="M6 9l6 6 6-6"/>', '0 0 24 24', 'fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"');
  const M_GHOST = svgUrl('<path d="M5 20V10a7 7 0 0 1 14 0v10l-2.3-1.6L14.3 20 12 18.4 9.7 20l-2.4-1.6z"/><circle cx="9.5" cy="10.5" r="1" fill="black"/><circle cx="14.5" cy="10.5" r="1" fill="black"/>', '0 0 24 24', 'fill="none" stroke="black" stroke-width="1.7" stroke-linejoin="round"');

  const CSS = `
:root {
  --cl-sans: "anthropic-sans", system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --cl-serif: "anthropic-serif", Georgia, "Times New Roman", serif;
  --cl-mono: "anthropic-mono", ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace;
  --cl-clay: #d97757; --cl-clay-h: #c6613f; --cl-blue: #2c84db; --cl-danger-bg: #b3261e;
  --cl-side-w: ${CONFIG.sideWidth}px; --cl-col: 768px; --cl-resp-size: 16px; --cl-top-h: 48px;
  --cl-ease: cubic-bezier(.2, 0, 0, 1);
}

/* ---------- 1. Claude's colours (neutral dark), mapped onto Gemini's own tokens ---------- */
body.cl-on {
  --cl-page: #191919; --cl-side: #1f1f1f; --cl-input: #303030; --cl-bubble: #262626; --cl-pop: #262626; --cl-code: #1d1d1d;
  --cl-hover: rgba(255, 255, 255, .05); --cl-active: rgba(255, 255, 255, .085); --cl-line: rgba(255, 255, 255, .08); --cl-line-2: rgba(255, 255, 255, .14);
  --cl-text: #ececec; --cl-strong: #f9f9f9; --cl-text-2: #c2c2c2; --cl-muted: #959595; --cl-icon: #a5a5a5; --cl-inline: rgba(255, 255, 255, .075);
  --cl-shadow: 0 8px 28px rgba(0, 0, 0, .4); --cl-scroll: rgba(255, 255, 255, .16); --cl-danger: #ee6a6c; --cl-tip: #0d0d0d; --cl-tip-text: #f9f9f9;
  --gem-sys-color--surface: var(--cl-page) !important;
  --gem-sys-color--surface-dim: var(--cl-page) !important;
  --gem-sys-color--surface-bright: var(--cl-input) !important;
  --gem-sys-color--surface-container-lowest: var(--cl-page) !important;
  --gem-sys-color--surface-container-low: var(--cl-side) !important;
  --gem-sys-color--surface-container: var(--cl-pop) !important;
  --gem-sys-color--surface-container-high: var(--cl-input) !important;
  --gem-sys-color--surface-container-highest: var(--cl-input) !important;
  --gem-sys-color--surface-variant: var(--cl-input) !important;
  --gem-sys-color--on-surface: var(--cl-text) !important;
  --gem-sys-color--on-surface-variant: var(--cl-text-2) !important;
  --gem-sys-color--on-surface-low: var(--cl-muted) !important;
  --gem-sys-color--outline: var(--cl-line-2) !important;
  --gem-sys-color--outline-variant: var(--cl-line) !important;
  --gem-sys-color--outline-low: var(--cl-line) !important;
  --gem-sys-color--primary: var(--cl-clay) !important;
  --gem-sys-color--on-primary: #fff !important;
  --gem-sys-color--primary-container: var(--cl-clay) !important;
  --gem-sys-color--on-primary-container: #fff !important;
  --gem-sys-color--secondary: var(--cl-text-2) !important;
  --gem-sys-color--secondary-container: var(--cl-active) !important;
  --gem-sys-color--on-secondary-container: var(--cl-strong) !important;
  --gem-sys-color--inverse-primary: var(--cl-clay) !important;
  --gem-sys-color--brand-blue: var(--cl-clay) !important;
  --gem-sys-color--brand-floaty-blue: var(--cl-clay) !important;
  --gem-sys-color--blue-primary: var(--cl-clay) !important;
  --lumi-sys-color--surface: var(--cl-page) !important;
  --lumi-sys-color--surface-dim: var(--cl-input) !important;
  --lumi-sys-color--surface-bright: var(--cl-input) !important;
  --lumi-sys-color--on-surface: var(--cl-text) !important;
  --lumi-sys-color--on-surface-variant: var(--cl-text-2) !important;
  --lumi-sys-color-acc-color--accent: var(--cl-clay) !important;
  --lumi-sys-color-acc-color--accent-container: var(--cl-clay) !important;
  --lumi-sys-color--code-background: var(--cl-code) !important;
  --gm3-sys-color-primary: var(--cl-clay) !important;
  --gm3-sys-color-surface: var(--cl-pop) !important;
  --gm3-sys-color-background: var(--cl-page) !important;
  --mat-app-background-color: var(--cl-page) !important;
  --mat-app-text-color: var(--cl-text) !important;
  --mat-sys-primary: var(--cl-clay) !important;
  --mat-sys-surface: var(--cl-pop) !important;
  --mat-sys-surface-container: var(--cl-pop) !important;
  --bard-color-sidenav-background-desktop: var(--cl-side) !important;
  --bard-color-sidenav-background-mobile: var(--cl-side) !important;
  --bard-color-synthetic--chat-window-surface: transparent !important;
  --bard-color-response-container-flipped-background: transparent !important;
  --top-gradient-color: transparent !important;
  --bottom-gradient-color: transparent !important;
  background: var(--cl-page) !important;
  color: var(--cl-text);
}
body.cl-on.cl-light {
  --cl-page: #ffffff; --cl-side: #f7f7f7; --cl-input: #ffffff; --cl-bubble: #f0f0f0; --cl-pop: #ffffff; --cl-code: #f7f7f7;
  --cl-hover: rgba(0, 0, 0, .04); --cl-active: rgba(0, 0, 0, .07); --cl-line: rgba(0, 0, 0, .08); --cl-line-2: rgba(0, 0, 0, .14);
  --cl-text: #1f1f1f; --cl-strong: #131313; --cl-text-2: #383838; --cl-muted: #797979; --cl-icon: #5f5f5f; --cl-inline: rgba(0, 0, 0, .05);
  --cl-shadow: 0 8px 28px rgba(0, 0, 0, .12); --cl-scroll: rgba(0, 0, 0, .18); --cl-danger: #c93a3c; --cl-tip: #1f1f1f; --cl-tip-text: #f9f9f9;
}
body.cl-on.cl-warm {
  --cl-page: #262624; --cl-side: #1f1e1d; --cl-input: #30302e; --cl-bubble: #141413; --cl-pop: #30302e; --cl-code: #1f1e1d;
  --cl-hover: rgba(222, 220, 209, .06); --cl-active: rgba(222, 220, 209, .1); --cl-line: rgba(222, 220, 209, .12); --cl-line-2: rgba(222, 220, 209, .2);
  --cl-text: #faf9f5; --cl-strong: #faf9f5; --cl-text-2: #c2c0b6; --cl-muted: #9c9a92; --cl-icon: #b0aea5; --cl-inline: rgba(222, 220, 209, .1);
}
body.cl-on.cl-warm.cl-light {
  --cl-page: #faf9f5; --cl-side: #f5f4ed; --cl-input: #ffffff; --cl-bubble: #f0eee6; --cl-pop: #ffffff; --cl-code: #f5f4ed;
  --cl-hover: rgba(31, 30, 29, .05); --cl-active: rgba(31, 30, 29, .08); --cl-line: rgba(31, 30, 29, .1); --cl-line-2: rgba(31, 30, 29, .16);
  --cl-text: #141413; --cl-strong: #141413; --cl-text-2: #3d3d3a; --cl-muted: #73726c; --cl-icon: #5e5d59; --cl-inline: rgba(31, 30, 29, .06);
}

/* ---------- 2. Fonts: Claude's sans for the interface, its serif for answers ---------- */
body.cl-on { font-family: var(--cl-sans) !important; }
body.cl-on :is(div, p, a, li, button, input, textarea, label, h1, h2, h3, h4, h5, h6, td, th, blockquote, summary, [class*="gds-"], .mdc-button__label, .mat-mdc-menu-item-text, .gem-menu-item-label, .label, .sublabel, .title-text)
  :not(mat-icon, .mat-icon, [class*="symbols"], [class*="icon"], [class^="x"], code, pre, .katex, .katex *, [class*="code"] *, .markdown, .markdown *, .cl-mark, .cl-greet, .cl-greet *) {
  font-family: var(--cl-sans) !important;
  font-variation-settings: normal !important;
  letter-spacing: normal !important;
}
.cl-ui svg, svg.cl-i { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; flex: none; }
body.cl-on:has(bard-sidenav:hover) .mat-mdc-tooltip-panel { display: none !important; }

/* ---------- 3. Gemini chrome we replace ---------- */
body.cl-on :is(chat-app, main.chat-app, bard-sidenav-container, .mat-drawer-content, chat-window, .chat-container, input-container, .lm-canvas-styling, .content-wrapper, .main-content, .content-container) {
  background: transparent !important;
}
body.cl-on bard-sidenav-content { background: var(--cl-page) !important; }
body.cl-on :is(.lm-glow, chat-loading-animation, .blur-bg, .input-gradient::before, .autosuggest-scrim) { display: none !important; }
body.cl-on input-container.input-gradient { background: none !important; }
body.cl-on input-container::before, body.cl-on input-container::after { display: none !important; }
body.cl-on top-bar-actions { opacity: 0 !important; pointer-events: none !important; }
body.cl-on .side-nav-menu-button { visibility: hidden !important; pointer-events: none !important; }
body.cl-on .main-content > .content-container { padding-top: var(--cl-top-h) !important; box-sizing: border-box !important; }
body.cl-on :is(hallucination-disclaimer, .hallucination-disclaimer, condensed-tos-disclaimer, back-to-bottom-fab, .human-review-disclosure-container, sidenav-mavatar-footer, .temporary-chat-header) { display: none !important; }
body.cl-ghost .cdk-overlay-pane:has(.mat-mdc-menu-panel),
body.cl-ghost .cdk-overlay-backdrop,
body.cl-ghost .cdk-overlay-popover { opacity: 0 !important; transition: none !important; pointer-events: none !important; }

/* ---------- 4. Sidebar ---------- */
body.cl-on bard-sidenav:has(.sidenav-with-history-container.expanded) {
  width: var(--cl-side-w) !important; min-width: var(--cl-side-w) !important; max-width: var(--cl-side-w) !important;
}
body.cl-on bard-sidenav:not(:has(.sidenav-with-history-container.expanded)) { width: 0 !important; min-width: 0 !important; overflow: hidden !important; }
body.cl-on bard-sidenav { background: var(--cl-side) !important; border: 0 !important; box-shadow: none !important; overflow: hidden !important; box-sizing: border-box !important; }
body.cl-light bard-sidenav { box-shadow: inset -1px 0 0 var(--cl-line) !important; }
body.cl-on bard-sidenav :is(side-navigation-content, .sidenav-with-history-container) { width: 100% !important; background: transparent !important; }
body.cl-on .sidenav-header-buttons {
  position: absolute !important; inset: 0 0 auto 0 !important; width: auto !important; height: 52px !important; padding: 0 !important; margin: 0 !important;
  display: flex !important; align-items: center !important; background: var(--cl-side) !important; z-index: 4 !important; box-sizing: border-box !important;
}
body.cl-on .sidenav-header-buttons > :not(.cl-side-head) { display: none !important; }
body.cl-on bard-sidenav .overflow-container { padding-top: 52px !important; box-sizing: border-box !important; }
body.cl-on bard-sidenav :is(.top-action-list, .top-action-list-scrollable, .top-action-list-pinned, .section-divider,
  .top-gradient-container, .bottom-gradient-container, .hovered-trailing-content, .desktop-controls, .loading-content-spinner-container),
body.cl-on bard-sidenav expandable-section:not([data-test-id="chats-expandable-section"]),
body.cl-on bard-sidenav [data-test-id="chats-expandable-section"] > .expandable-section-header-row { display: none !important; }
body.cl-on bard-sidenav infinite-scroller { padding: 0 8px 64px !important; box-sizing: border-box !important; }
body.cl-on bard-sidenav :is(.chat-history, .chat-history-list, conversations-list, conversations-list mat-nav-list, .expandable-section-content, .expandable-section-content-inner) {
  padding: 0 !important; margin: 0 !important; width: auto !important;
}
body.cl-on gem-nav-list-item[data-test-id="conversation"] { display: block !important; margin: 0 !important; padding: 0 !important; height: auto !important; }
body.cl-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item {
  display: flex !important; align-items: center !important; position: relative !important; box-sizing: border-box !important;
  width: 100% !important; height: 32px !important; min-height: 32px !important; margin: 0 0 1px !important; padding: 0 4px 0 8px !important;
  border-radius: 8px !important; background: transparent !important; color: var(--cl-text) !important; overflow: hidden !important; text-decoration: none !important;
  --mat-list-list-item-one-line-container-height: 32px; --mat-list-list-item-hover-state-layer-opacity: 0; --mat-list-list-item-focus-state-layer-opacity: 0;
}
body.cl-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item::before,
body.cl-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item::after,
body.cl-on gem-nav-list-item[data-test-id="conversation"] .mat-focus-indicator,
body.cl-on gem-nav-list-item[data-test-id="conversation"] .mdc-list-item__start,
body.cl-on gem-nav-list-item[data-test-id="conversation"] .mdc-list-item__end { display: none !important; }
body.cl-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item:is(:hover, .cl-row-ctx) { background: var(--cl-hover) !important; }
body.cl-on gem-nav-list-item[data-test-id="conversation"] > a.gem-nav-list-item.cl-row-on { background: var(--cl-active) !important; }
body.cl-on gem-nav-list-item[data-test-id="conversation"] .mdc-list-item__content { flex: 1 1 auto !important; min-width: 0 !important; height: auto !important; padding: 0 !important; margin: 0 !important; display: flex !important; align-items: center !important; }
body.cl-on gem-nav-list-item[data-test-id="conversation"] .mdc-list-item__primary-text { display: block !important; height: auto !important; margin: 0 !important; padding: 0 !important; }
body.cl-on gem-nav-list-item[data-test-id="conversation"] .mdc-list-item__primary-text::before,
body.cl-on gem-nav-list-item[data-test-id="conversation"] .mdc-list-item__primary-text::after { display: none !important; }
body.cl-on gem-nav-list-item[data-test-id="conversation"] :is(.title-text, .label-and-badge, .mdc-list-item__primary-text) {
  font-size: 14px !important; font-weight: 400 !important; line-height: 20px !important; color: var(--cl-text) !important;
  white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; display: block !important;
}
body.cl-on gem-nav-list-item[data-test-id="conversation"] mat-icon:not(.cl-ui *) { display: none !important; }
body.cl-on gem-nav-list-item[data-test-id="conversation"] input { color: var(--cl-text) !important; font-size: 14px !important; }
.cl-row-more { display: none; flex: none; width: 24px; height: 24px; margin-left: 2px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--cl-icon); cursor: pointer; align-items: center; justify-content: center; }
a.gem-nav-list-item:is(:hover, .cl-row-ctx) .cl-row-more { display: inline-flex; }
.cl-row-more:hover { color: var(--cl-strong); background: var(--cl-active); }
.cl-row-more svg { width: 16px; height: 16px; }
.cl-row-dot { flex: none; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%; background: var(--cl-clay); }
.cl-collapsed-row { display: none !important; }
.cl-sec { display: flex; align-items: center; gap: 2px; height: 28px; margin: 18px 0 2px; padding: 0 2px 0 8px; color: var(--cl-muted); font-size: 12px; font-weight: 500; cursor: pointer; user-select: none; }
.cl-sec:hover { color: var(--cl-text-2); }
.cl-sec > span { display: inline-flex; align-items: center; gap: 4px; }
.cl-sec > span svg { width: 12px; height: 12px; stroke-width: 2.2; transition: transform .2s var(--cl-ease); }
.cl-sec.cl-closed > span svg { transform: rotate(-90deg); }
.cl-sec-tools { margin-left: auto; display: flex; gap: 2px; opacity: 0; transition: opacity .15s; }
.cl-sec:hover .cl-sec-tools { opacity: 1; }
.cl-sec-tools button { width: 26px; height: 26px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--cl-icon); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.cl-sec-tools button:hover { background: var(--cl-active); color: var(--cl-strong); }
.cl-sec-tools svg { width: 16px; height: 16px; }
.cl-side-head { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; height: 100%; padding: 0 10px 0 8px; }
.cl-mark { flex: 1; min-width: 0; padding-left: 4px; font: 500 20px/1 var(--cl-serif); color: var(--cl-strong); letter-spacing: -.01em !important; user-select: none; cursor: pointer; white-space: nowrap; }
.cl-mode { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--cl-hover); }
.cl-mode button { width: 28px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--cl-icon); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.cl-mode button.cl-on { background: var(--cl-active); color: var(--cl-strong); box-shadow: 0 0 0 .5px var(--cl-line-2); }
.cl-mode button svg { width: 16px; height: 16px; }
.cl-iconbtn { width: 32px; height: 32px; flex: none; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--cl-icon); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background-color .12s, color .12s; }
.cl-iconbtn:hover, .cl-iconbtn.cl-on { background: var(--cl-hover); color: var(--cl-strong); }
.cl-iconbtn svg { width: 18px; height: 18px; }
#cl-nav { padding: 2px 0 0; }
.cl-nav-item { display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 8px; margin: 0 0 1px; border-radius: 8px; cursor: pointer; color: var(--cl-text); font-size: 14px; line-height: 20px; transition: background-color .12s; user-select: none; }
.cl-nav-item:hover { background: var(--cl-hover); }
.cl-nav-item.cl-on { background: var(--cl-active); }
.cl-nav-item svg { width: 18px; height: 18px; color: var(--cl-text-2); }
.cl-nav-item .cl-new-dot { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; margin: 0 -1px; border-radius: 50%; background: var(--cl-clay); color: #fff; }
.cl-nav-item .cl-new-dot svg { width: 14px; height: 14px; color: #fff; stroke-width: 2.4; }
#cl-acct { position: absolute; left: 0; right: 0; bottom: 0; z-index: 5; height: 52px; display: flex; align-items: center; gap: 4px; padding: 0 8px; box-sizing: border-box; background: var(--cl-side); }
.cl-acct-btn { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 8px; border: 0; border-radius: 8px; background: none; color: var(--cl-text); cursor: pointer; text-align: left; font-size: 14px; }
.cl-acct-btn:hover, .cl-acct-btn.cl-on { background: var(--cl-hover); }
.cl-acct-btn .cl-av { width: 24px; height: 24px; font-size: 11px; }
.cl-acct-name { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
.cl-acct-plan { flex: none; color: var(--cl-muted); font-size: 13px; }
.cl-acct-btn > svg { width: 14px; height: 14px; color: var(--cl-muted); }
#cl-resizer { position: absolute; top: 0; right: 0; width: 5px; height: 100%; cursor: ew-resize; z-index: 7; }
#cl-resizer:hover, #cl-resizer.cl-drag { background: linear-gradient(90deg, transparent 3px, var(--cl-line-2) 3px); }
body.cl-resizing, body.cl-resizing * { cursor: ew-resize !important; user-select: none !important; }
.cl-av { width: 32px; height: 32px; border-radius: 50%; flex: none; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; background: #5c5c5c; color: #fff; font-weight: 500; font-size: 13px; user-select: none; }
body.cl-light .cl-av { background: #3d3d3d; }
img.cl-av { object-fit: cover; background: none; }

/* ---------- 5. Title bar ---------- */
#cl-top {
  position: fixed; top: 0; right: 0; z-index: 900; height: var(--cl-top-h); display: flex; align-items: center; gap: 4px; box-sizing: border-box;
  padding: 0 12px 0 10px; background: var(--cl-page); color: var(--cl-text); transition: left .2s var(--cl-ease);
}
#cl-top::after { content: ""; position: absolute; left: 0; right: 0; top: 100%; height: 14px; background: linear-gradient(var(--cl-page), transparent); pointer-events: none; }
#cl-top .cl-top-toggle { display: none; }
body.cl-side-closed #cl-top .cl-top-toggle { display: inline-flex; }
.cl-title-btn { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 50vw; height: 32px; padding: 0 6px 0 10px; border: 0; border-radius: 8px; background: none; color: var(--cl-text); font: 500 14px/20px var(--cl-sans); cursor: pointer; }
.cl-title-btn:hover, .cl-title-btn.cl-on { background: var(--cl-hover); }
.cl-title-btn span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cl-title-btn svg { width: 14px; height: 14px; color: var(--cl-muted); }
.cl-title-btn.cl-ghostly { color: var(--cl-text-2); }
.cl-top-right { margin-left: auto; display: flex; align-items: center; gap: 4px; }
.cl-share { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px 0 10px; border: 0; border-radius: 8px; background: none; color: var(--cl-text); font: 500 14px/20px var(--cl-sans); cursor: pointer; box-shadow: inset 0 0 0 .5px var(--cl-line-2); }
.cl-share:hover { background: var(--cl-hover); }
.cl-share svg { width: 16px; height: 16px; }
.cl-incog.cl-on { color: var(--cl-strong); background: var(--cl-active); }

/* ---------- 6. Messages ---------- */
body.cl-on infinite-scroller.chat-history { padding: 8px 0 32px !important; gap: 0 !important; }
body.cl-on .conversation-container {
  max-width: var(--cl-col) !important; width: 100% !important; margin: 0 auto !important; padding: 0 24px !important; box-sizing: border-box !important; gap: 0 !important; display: block !important;
}
body.cl-on user-query { display: block !important; position: relative !important; width: 100% !important; max-width: 100% !important; margin: 20px 0 0 !important; padding: 0 !important; }
body.cl-on .conversation-container:first-child user-query { margin-top: 12px !important; }
body.cl-on user-query :is(.user-query-container, user-query-content) { max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
body.cl-on user-query div.user-query-container { display: flex !important; flex-direction: column !important; align-items: flex-end !important; gap: 6px !important; flex: 0 1 auto !important; max-width: min(85%, 640px) !important; margin-left: auto !important; }
body.cl-on user-query .query-content { width: auto !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
body.cl-on user-query .query-bubble-with-status { width: fit-content !important; max-width: 100% !important; margin: 0 !important; }
body.cl-on user-query .user-query-bubble-with-background {
  display: block !important; width: fit-content !important; max-width: 100% !important; box-sizing: border-box !important; margin: 0 !important;
  padding: 10px 16px !important; border-radius: 12px !important; background: var(--cl-bubble) !important; color: var(--cl-text) !important; box-shadow: none !important;
}
body.cl-on user-query :is(.query-text, .query-text-line, .horizontal-container) { color: var(--cl-text) !important; font-size: 15.5px !important; line-height: 1.5 !important; padding: 0 !important; margin: 0 !important; }
body.cl-on user-query .query-text-line { min-height: 0 !important; }
body.cl-on user-query a { color: inherit !important; text-decoration: underline !important; }
body.cl-on user-query :is(.luminous-actions-container, .query-action-buttons, .luminous-toggle-container) { display: none !important; }
body.cl-on user-query :is(.luminous-collapsed, .luminous-collapsed .query-text, .luminous-collapsed .horizontal-container, .query-text.collapsed) {
  max-height: none !important; -webkit-line-clamp: unset !important; overflow: visible !important; -webkit-mask-image: none !important; mask-image: none !important;
}
body.cl-on user-query user-query-file-carousel { max-width: 420px; margin-left: auto !important; }
body.cl-on user-query img.preview-image { border-radius: 10px !important; }
.cl-uacts { position: absolute; right: 0; top: 100%; display: flex; align-items: center; justify-content: flex-end; gap: 2px; height: 28px; margin-top: 2px; opacity: 0; transition: opacity .15s; z-index: 1; }
user-query:hover .cl-uacts, .cl-uacts:focus-within { opacity: 1; }
.cl-uacts time { margin-right: 6px; font-size: 12px; color: var(--cl-muted); white-space: nowrap; }
.cl-abtn { width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--cl-icon); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background-color .12s, color .12s; }
.cl-abtn:hover { background: var(--cl-hover); color: var(--cl-strong); }
.cl-abtn.cl-on { color: var(--cl-strong); }
.cl-abtn svg { width: 16px; height: 16px; }

body.cl-on model-response { display: block !important; position: relative !important; margin: 34px 0 0 !important; padding: 0 !important; }
body.cl-on model-response :is(response-container, .response-container, .presented-response-container) { max-width: 100% !important; margin: 0 !important; padding: 0 !important; background: transparent !important; }
body.cl-on model-response .presented-response-container { justify-content: flex-start !important; }
body.cl-on model-response .response-container-content { width: auto !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; background: transparent !important; border-radius: 0 !important; box-shadow: none !important; }
body.cl-on model-response :is(.response-content, model-response-content, structured-content-container, structured-content-container > .container, message-content, .markdown) {
  max-width: none !important; width: auto !important; margin: 0 !important; padding: 0 !important; background: transparent !important;
}
body.cl-on model-response message-content { display: block !important; }
body.cl-on model-response :is(bard-avatar, .avatar-gutter) { display: none !important; }
body.cl-on model-response .markdown > * { max-width: none !important; margin-inline: 0 !important; }
body.cl-on model-response .markdown { font-family: var(--cl-serif) !important; font-size: var(--cl-resp-size) !important; line-height: 1.65 !important; color: var(--cl-text) !important; }
body.cl-on.cl-sans model-response .markdown { font-family: var(--cl-sans) !important; }
body.cl-on model-response .markdown :is(p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, strong, b, em, i, a, span, div):not(code, code *, pre, pre *, .katex, .katex *, mat-icon, [class*="icon"]) {
  font-family: inherit !important;
}
body.cl-on model-response .markdown :is(p, li) { font-size: var(--cl-resp-size) !important; line-height: 1.65 !important; }
body.cl-on model-response .markdown > :first-child { margin-top: 0 !important; }
body.cl-on model-response .markdown > :last-child { margin-bottom: 0 !important; }
body.cl-on model-response .markdown p { margin: 0 0 12px !important; }
body.cl-on model-response .markdown :is(h1, h2, h3, h4) { margin: 22px 0 8px !important; line-height: 1.35 !important; font-weight: 600 !important; color: var(--cl-strong) !important; }
body.cl-on model-response .markdown h1 { font-size: 1.45em !important; }
body.cl-on model-response .markdown h2 { font-size: 1.25em !important; }
body.cl-on model-response .markdown :is(h3, h4) { font-size: 1.08em !important; }
body.cl-on model-response .markdown :is(ul, ol) { margin: 0 0 12px !important; padding-left: 1.6em !important; }
body.cl-on model-response .markdown li { margin: 4px 0 !important; }
body.cl-on model-response .markdown li::marker { color: var(--cl-text-2); }
body.cl-on model-response .markdown hr { border: 0 !important; border-top: 1px solid var(--cl-line-2) !important; margin: 20px 0 !important; }
body.cl-on model-response .markdown a, body.cl-on message-content a { color: inherit !important; text-decoration: underline !important; text-decoration-color: var(--cl-muted) !important; text-underline-offset: 2px; }
body.cl-on model-response .markdown a:hover { text-decoration-color: currentColor !important; }
body.cl-on model-response .markdown strong { font-weight: 600 !important; color: var(--cl-strong); }
body.cl-on model-response .markdown blockquote { margin: 0 0 12px !important; padding: 0 0 0 14px !important; border: 0 !important; border-left: 3px solid var(--cl-line-2) !important; background: none !important; color: var(--cl-text-2) !important; }
body.cl-on model-response :is(code-block, .code-block) { display: block; margin: 4px 0 14px !important; border-radius: 12px !important; overflow: hidden; border: .5px solid var(--cl-line-2) !important; background: var(--cl-code) !important; }
body.cl-on model-response .code-block-decoration { background: transparent !important; color: var(--cl-muted) !important; font-family: var(--cl-sans) !important; font-size: 12px !important; font-weight: 400 !important; padding: 8px 14px 0 !important; }
body.cl-on model-response :is(code-block pre, .code-block pre) { background: transparent !important; margin: 0 !important; }
body.cl-on model-response :is(pre, pre code, code-block code) { font-family: var(--cl-mono) !important; font-size: 13.5px !important; line-height: 1.6 !important; }
body.cl-on model-response :not(pre) > code { background: var(--cl-inline) !important; border: 0 !important; border-radius: 4px !important; padding: 1px 5px !important; font-family: var(--cl-mono) !important; font-size: .86em !important; color: var(--cl-text) !important; }
body.cl-on model-response table { border-collapse: collapse !important; font-family: var(--cl-sans) !important; font-size: 14px !important; }
body.cl-on model-response :is(th, td) { border-color: var(--cl-line-2) !important; padding: 8px 12px !important; }
body.cl-on model-response th { background: var(--cl-hover) !important; font-weight: 600 !important; }
body.cl-on model-response :is(.table-block, table-block) { border-radius: 10px !important; border-color: var(--cl-line-2) !important; }
body.cl-on model-response .markdown img { border-radius: 10px !important; }
body.cl-on model-response :is(.response-container-footer, message-actions, .actions-container-v2) { margin: 0 !important; }
body.cl-on.cl-hide-gemini-actions model-response :is(.response-container-footer, message-actions, .actions-container-v2) { display: none !important; }
body.cl-on model-response :is(model-thoughts, .thoughts-container) { margin: 0 0 12px !important; }
body.cl-on model-response model-thoughts :is(button, .thoughts-header-button) {
  border-radius: 8px !important; background: transparent !important; border: 0 !important; color: var(--cl-muted) !important; padding: 4px 8px 4px 0 !important; font-size: 14px !important; font-family: var(--cl-sans) !important;
}
body.cl-on model-response model-thoughts :is(button, .thoughts-header-button):hover { color: var(--cl-text) !important; }
body.cl-on model-response model-thoughts :is(.thoughts-content, .thoughts-body) { border-left: 2px solid var(--cl-line-2) !important; padding-left: 14px !important; color: var(--cl-text-2) !important; font-family: var(--cl-sans) !important; font-size: 14px !important; }
body.cl-on model-response :is(sources-list, .sources-list) { margin-top: 0 !important; }
body.cl-on model-response :is(sources-list, .sources-list):has(a, button, img) { margin-top: 8px !important; }
body.cl-on model-response :is(election-info-disclaimer, finance-info-disclaimer):empty { display: none !important; }
body.cl-on :is(.source-inline-chip, .inline-source-chip, source-inline-chip, .attachment-container .chip) { background: var(--cl-inline) !important; color: var(--cl-text-2) !important; border-radius: 6px !important; font-family: var(--cl-sans) !important; }
body.cl-on model-response .response-container-header { margin: 0 0 6px !important; }
.cl-acts { display: flex; align-items: center; gap: 2px; height: 28px; margin: 8px 0 0 -6px; opacity: 0; transition: opacity .15s; }
model-response:hover .cl-acts, .cl-acts.cl-last, .cl-acts:focus-within { opacity: 1; }
.cl-acts .cl-acts-sp { flex: 1; }
.cl-acts .cl-acts-note { font-size: 12px; color: var(--cl-muted); padding: 0 6px; white-space: nowrap; }
.cl-retry { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 6px 0 8px; border: 0; border-radius: 6px; background: none; color: var(--cl-icon); font: 500 13px/1 var(--cl-sans); cursor: pointer; }
.cl-retry:hover { background: var(--cl-hover); color: var(--cl-strong); }
.cl-retry svg { width: 16px; height: 16px; }
.cl-flash { animation: cl-flash 1.6s ease; }
@keyframes cl-flash { 0%, 40% { background: color-mix(in srgb, var(--cl-clay) 12%, transparent); } 100% { background: transparent; } }

/* ---------- 7. New chat: greeting, prompt chips, incognito ---------- */
body.cl-on .modular-zero-state-container { justify-content: center !important; align-items: center !important; padding: 16px !important; box-sizing: border-box !important; }
body.cl-on modular-zero-state .top-section-container { height: auto !important; min-height: 0 !important; flex: none !important; padding: 0 !important; margin: 0 !important; width: 100% !important; }
body.cl-on modular-zero-state .modular-zero-state-container > div:not(.top-section-container, .scroll-container, .blur-bg) { display: none !important; }
body.cl-on modular-zero-state :is(.scroll-container, .bottom-section-container) { flex: none !important; height: auto !important; overflow: visible !important; padding: 0 !important; margin: 0 !important; width: 100% !important; }
body.cl-on modular-zero-state :is(zero-state-block-picker, .zero-state-block-container) { width: 100% !important; max-width: 100% !important; padding: 0 !important; margin: 0 !important; display: flex !important; justify-content: center !important; }
body.cl-on assistant-messages-primary { display: block; width: 100% !important; margin: 0 0 8px !important; }
body.cl-on assistant-messages-primary :is(.assistant-messages-primary-container, .content-container, .lm-mobile-sparkle-and-text, .content-wrapper) {
  width: 100% !important; max-width: 100% !important; padding: 0 !important; margin: 0 !important; display: block !important; text-align: center !important;
}
body.cl-on assistant-messages-primary :is(h1, .lm-mobile-sparkle-and-text > :not(.cl-greet)) { display: none !important; }
.cl-greet.cl-ui, .cl-greet { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 0 auto; padding: 0 16px; font: 400 38px/1.2 var(--cl-serif); color: var(--cl-strong); letter-spacing: -.01em !important; text-align: center; }
.cl-greet svg { width: 34px; height: 34px; color: var(--cl-clay); stroke: none; fill: currentColor; flex: none; }
body.cl-on suggestion-block { display: block; width: 100% !important; max-width: var(--cl-col); margin: 18px auto 0 !important; }
body.cl-on suggestion-block .suggestion-block-container { display: flex !important; flex-direction: row !important; flex-wrap: wrap !important; justify-content: center !important; gap: 8px !important; padding: 0 16px !important; margin: 0 !important; width: 100% !important; box-sizing: border-box; }
body.cl-on suggestion { display: block !important; width: auto !important; margin: 0 !important; }
body.cl-on suggestion .suggestion-container { width: auto !important; margin: 0 !important; }
body.cl-on suggestion .card-button {
  width: auto !important; min-height: 32px !important; height: 32px !important; padding: 0 12px 0 10px !important; gap: 6px !important; border: 0 !important; border-radius: 8px !important;
  background: transparent !important; box-shadow: inset 0 0 0 .5px var(--cl-line-2) !important; color: var(--cl-text-2) !important; transition: background-color .12s, color .12s !important;
}
body.cl-on suggestion .card-button:hover { background: var(--cl-hover) !important; color: var(--cl-strong) !important; }
body.cl-on suggestion .card-text { color: inherit !important; font-size: 14px !important; font-weight: 400 !important; white-space: nowrap !important; overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
body.cl-on suggestion .suggestion-icon { display: inline-flex !important; width: 16px !important; height: 16px !important; color: var(--cl-muted) !important; background: none !important; }
body.cl-on suggestion .suggestion-icon mat-icon { font-size: 16px !important; width: 16px !important; height: 16px !important; }
body.cl-on suggestion .dismiss-suggestion-button { display: none !important; }
body.cl-on zero-state-v2 { display: flex !important; align-items: center !important; justify-content: center !important; min-height: 100% !important; }
body.cl-on zero-state-v2 > div { display: flex !important; align-items: center !important; justify-content: center !important; height: auto !important; transform: none !important; position: static !important; margin: 0 !important; }
body.cl-on .zero-state-container { max-width: none !important; width: 100% !important; align-self: stretch !important; }
body.cl-on .temporary-chat-card-container { margin: 0 auto !important; padding: 0 !important; width: auto !important; position: static !important; }
body.cl-on .temporary-chat-card {
  max-width: 420px; margin: 0 auto; padding: 0 16px !important; gap: 10px !important; box-sizing: border-box; display: flex !important; flex-direction: column !important;
  align-items: center !important; text-align: center !important; background: none !important; color: var(--cl-text) !important; animation: none !important; opacity: 1 !important; transform: none !important;
}
body.cl-on .temporary-chat-card gem-icon { width: 40px !important; height: 40px !important; background: var(--cl-strong); -webkit-mask: ${M_GHOST} center/40px no-repeat; mask: ${M_GHOST} center/40px no-repeat; }
body.cl-on .temporary-chat-card gem-icon mat-icon { opacity: 0 !important; }
body.cl-on .temporary-chat-card .gds-display-m { font-size: 0 !important; line-height: 0 !important; margin: 0 !important; }
body.cl-on .temporary-chat-card .gds-display-m::before { content: "Incognito chat"; font: 400 30px/1.2 var(--cl-serif); color: var(--cl-strong); }
body.cl-on .temporary-chat-card .description { font-size: 14px !important; line-height: 20px !important; color: var(--cl-muted) !important; margin: 0 !important; }
body.cl-on .temporary-chat-card .description a { color: inherit !important; text-decoration: underline !important; }

/* ---------- 8. Message box: the box on top, controls underneath ---------- */
body.cl-on input-container { padding: 0 24px 6px !important; }
body.cl-on .input-area-container, body.cl-on .input-area-container.is-zero-state {
  position: relative !important; inset: auto !important; transform: none !important; width: 100% !important; max-width: var(--cl-col) !important; margin: 0 auto !important; padding: 0 !important; box-sizing: border-box !important;
}
body.cl-on :is(input-area-v2, input-area-v2 .input-area, input-area-v2 .input-area-fieldset) { background: transparent !important; box-shadow: none !important; border: 0 !important; width: 100% !important; max-width: 100% !important; }
body.cl-on input-area-v2 .input-area-fieldset { position: relative !important; padding: 0 !important; margin: 0 !important; box-sizing: border-box !important; }
body.cl-on input-area-v2 .text-input-field {
  position: relative !important; display: grid !important; overflow: visible !important;
  grid-template-areas: "fp fp fp fp" "text text text text" "lead mic note model" !important;
  grid-template-columns: auto auto minmax(0, 1fr) auto !important; grid-template-rows: auto auto auto !important;
  align-items: center !important; column-gap: 2px !important; row-gap: 6px !important;
  min-height: 0 !important; padding: 0 !important; box-sizing: border-box !important; background: transparent !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; outline: none !important;
}
body.cl-on input-area-v2 :is(.single-line-format, .text-input-field_textarea-wrapper) {
  grid-area: text !important; align-self: stretch !important; min-width: 0 !important; margin: 0 !important; box-sizing: border-box !important;
  padding: 11px 52px 11px 16px !important; min-height: 46px !important; border-radius: 14px !important; background: var(--cl-input) !important;
  box-shadow: 0 0 0 .5px var(--cl-line-2) !important; display: flex !important; align-items: center !important;
}
body.cl-light input-area-v2 :is(.single-line-format, .text-input-field_textarea-wrapper) { box-shadow: 0 0 0 .5px var(--cl-line-2), 0 2px 8px rgba(0, 0, 0, .04) !important; }
body.cl-on input-area-v2 .input-area-container.is-zero-state :is(.single-line-format, .text-input-field_textarea-wrapper),
body.cl-on .input-area-container.is-zero-state input-area-v2 :is(.single-line-format, .text-input-field_textarea-wrapper) { min-height: 96px !important; align-items: flex-start !important; }
body.cl-on input-area-v2 .text-input-field-main-area { padding: 0 !important; margin: 0 !important; width: 100% !important; }
body.cl-on input-area-v2 :is(rich-textarea, .text-input-field_textarea) { width: 100% !important; }
body.cl-on input-area-v2 .leading-actions-wrapper { grid-area: lead !important; margin: 0 !important; }
body.cl-on input-area-v2 .trailing-actions-wrapper { display: contents !important; }
body.cl-on input-area-v2 .model-picker-container { grid-area: model !important; margin: 0 !important; justify-self: end !important; }
body.cl-on input-area-v2 .cl-note { grid-area: note !important; min-width: 0; text-align: center; font-size: 12px; line-height: 16px; color: var(--cl-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 8px; }
body.cl-on input-area-v2 .input-buttons-wrapper-top { display: none !important; }
body.cl-on input-area-v2 :is(simplified-input-menu, .simplified-input-menu-container) { width: auto !important; min-width: 32px !important; }
body.cl-on .ql-editor, body.cl-on rich-textarea { color: var(--cl-text) !important; caret-color: var(--cl-text); }
body.cl-on input-area-v2 .ql-editor { font-size: 15.5px !important; line-height: 22px !important; padding: 1px 0 !important; min-height: 24px !important; box-sizing: border-box !important; max-height: 40vh !important; }
body.cl-on input-area-v2 .ql-editor.ql-blank::before { content: var(--cl-ph, "Reply…") !important; color: var(--cl-muted) !important; font-style: normal !important; left: 0 !important; right: 0 !important; font-size: 15.5px !important; line-height: 22px !important; }
body.cl-on input-area-v2 file-preview-container, body.cl-on input-area-v2 .file-preview-wrapper { grid-area: fp !important; padding: 0 0 2px !important; }
body.cl-on input-area-v2 .leading-actions-wrapper :is(.menu-button button, button.mat-mdc-icon-button) { width: 32px !important; height: 32px !important; padding: 7px !important; border-radius: 8px !important; color: var(--cl-icon) !important; background: none !important; }
body.cl-on input-area-v2 .leading-actions-wrapper :is(.menu-button button, button.mat-mdc-icon-button):hover { background: var(--cl-hover) !important; color: var(--cl-strong) !important; }
body.cl-on input-area-v2 .leading-actions-wrapper .menu-button gem-icon { width: 18px !important; height: 18px !important; background: currentColor; -webkit-mask: ${M_PLUS} center/18px no-repeat; mask: ${M_PLUS} center/18px no-repeat; }
body.cl-on input-area-v2 .leading-actions-wrapper .menu-button gem-icon mat-icon { opacity: 0 !important; }
body.cl-on input-area-v2 .model-picker-container :is(bard-mode-switcher, .pill-ui-logo-container) { display: block !important; margin: 0 !important; padding: 0 !important; background: none !important; }
body.cl-on input-area-v2 .model-picker-container button.input-area-switch {
  height: 32px !important; min-width: 0 !important; padding: 0 6px 0 10px !important; border-radius: 8px !important; border: 0 !important; background: transparent !important; color: var(--cl-text) !important; box-shadow: none !important;
}
body.cl-on input-area-v2 .model-picker-container button.input-area-switch:hover { background: var(--cl-hover) !important; }
body.cl-on input-area-v2 .model-picker-container .mdc-button__label { display: flex !important; align-items: center !important; gap: 4px; }
body.cl-on input-area-v2 .model-picker-container .mdc-button__label::before { content: "Gemini"; color: var(--cl-text); font-size: 14px; font-weight: 500; }
body.cl-on input-area-v2 .model-picker-container .mdc-button__label::after { content: ""; width: 14px; height: 14px; flex: none; background: var(--cl-muted); -webkit-mask: ${M_CHEV} center/14px no-repeat; mask: ${M_CHEV} center/14px no-repeat; }
body.cl-on input-area-v2 .model-picker-container :is(.picker-primary-text, .picker-secondary-text) { color: var(--cl-muted) !important; font-size: 14px !important; font-weight: 400 !important; margin: 0 !important; }
body.cl-on input-area-v2 .model-picker-container .logo-pill-label-container:has(.picker-secondary-text:not(:empty)) .picker-primary-text { display: none !important; }
body.cl-on input-area-v2 .model-picker-container :is(.dropdown-icon, .mat-mdc-button-persistent-ripple, .mat-focus-indicator) { display: none !important; }
body.cl-on input-area-v2 .input-buttons-wrapper-bottom { display: contents !important; }
body.cl-on input-area-v2 .input-buttons-wrapper-bottom .mic-button-container { grid-area: mic !important; margin: 0 !important; position: static !important; }
body.cl-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container {
  grid-area: text !important; justify-self: end !important; align-self: end !important; z-index: 2; margin: 0 7px 7px 0 !important; position: static !important; width: auto !important; height: auto !important;
}
body.cl-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container:not(.visible):not(:has(.stop, [class*="stop"], [aria-label*="Stop" i])) { display: none !important; }
body.cl-on input-area-v2 .input-buttons-wrapper-bottom :is(gem-icon-button, .send-button) { background: transparent !important; box-shadow: none !important; border: 0 !important; }
body.cl-on input-area-v2 .input-buttons-wrapper-bottom .mic-button-container button { width: 32px !important; height: 32px !important; padding: 7px !important; border-radius: 8px !important; background: transparent !important; color: var(--cl-icon) !important; }
body.cl-on input-area-v2 .input-buttons-wrapper-bottom .mic-button-container button:hover { background: var(--cl-hover) !important; color: var(--cl-strong) !important; }
body.cl-on input-area-v2 .input-buttons-wrapper-bottom .mic-button-container gem-icon { width: 18px !important; height: 18px !important; background: currentColor; -webkit-mask: ${M_MIC} center/18px no-repeat; mask: ${M_MIC} center/18px no-repeat; }
body.cl-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container button { width: 32px !important; height: 32px !important; padding: 7px !important; border-radius: 8px !important; background: var(--cl-clay) !important; color: #fff !important; }
body.cl-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container button:hover { background: var(--cl-clay-h) !important; }
body.cl-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container gem-icon { width: 18px !important; height: 18px !important; background: currentColor; -webkit-mask: ${M_UP} center/18px no-repeat; mask: ${M_UP} center/18px no-repeat; }
body.cl-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container :is(.stop, [class*="stop"]) gem-icon,
body.cl-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container [aria-label*="Stop" i] gem-icon { -webkit-mask-image: ${M_STOP}; mask-image: ${M_STOP}; }
body.cl-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container :is(.stop, [class*="stop"]) button,
body.cl-on input-area-v2 .input-buttons-wrapper-bottom .send-button-container button[aria-label*="Stop" i] { background: var(--cl-strong) !important; color: var(--cl-page) !important; }
body.cl-on input-area-v2 .input-buttons-wrapper-bottom mat-icon { opacity: 0 !important; }
body.cl-on input-area-v2 :is(.mat-mdc-button-persistent-ripple, .mdc-icon-button__ripple) { display: none !important; }
body.cl-on prompt-flow-bar, body.cl-on .inline-upgrade-banner { max-width: var(--cl-col) !important; margin-inline: auto !important; }
/* a new chat puts the box in the middle, under the greeting */
body.cl-zero chat-window .xap-uploader-dropzone { justify-content: center !important; }
body.cl-zero chat-window :is(.chat-history-scroll-container, infinite-scroller.chat-history) { flex: 0 0 auto !important; height: auto !important; min-height: 0 !important; }
body.cl-zero infinite-scroller.chat-history { padding-bottom: 20px !important; }
body.cl-zero zero-state-v2 { min-height: 0 !important; height: auto !important; }
body.cl-zero .zero-state-container { position: static !important; height: auto !important; transform: none !important; left: auto !important; }
body.cl-zero input-container { flex: 0 0 auto !important; padding-bottom: 8vh !important; margin: 0 !important; }
body.cl-zero .chat-history-scroll-container { margin: 0 !important; }

/* ---------- 9. Menus, popovers, tooltips, dialogs ---------- */
.cl-ui, .cl-ui * { box-sizing: border-box; }
.cl-ui { color: var(--cl-text); font-family: var(--cl-sans); }
.cl-backdrop { position: fixed; inset: 0; z-index: 2147483000; }
.cl-menu-wrap { position: fixed; z-index: 2147483001; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.cl-menu {
  position: relative; min-width: 220px; max-width: 320px; padding: 6px; border-radius: 12px; background: var(--cl-pop); border: .5px solid var(--cl-line-2);
  box-shadow: var(--cl-shadow); color: var(--cl-text); user-select: none; transform-origin: var(--cl-origin, top left); animation: cl-menu-in .14s var(--cl-ease);
}
@keyframes cl-menu-in { from { opacity: 0; transform: scale(.97) translateY(-2px); } }
.cl-menu.cl-sub { position: fixed; z-index: 2147483002; }
.cl-mi { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; margin: 0; padding: 0 10px; border: 0; border-radius: 8px; background: none; color: inherit; font: 400 14px/20px var(--cl-sans); text-align: left; cursor: pointer; white-space: nowrap; }
.cl-mi svg { width: 18px; height: 18px; color: var(--cl-text-2); }
.cl-mi:hover, .cl-mi.cl-hl { background: var(--cl-hover); }
.cl-mi.cl-danger, .cl-mi.cl-danger svg { color: var(--cl-danger); }
.cl-mi .cl-mi-end { margin-left: auto; padding-left: 16px; color: var(--cl-muted); display: inline-flex; font-size: 12px; }
.cl-mi .cl-mi-end svg { width: 14px; height: 14px; color: var(--cl-muted); }
.cl-mi img.cl-photo, .cl-mi .cl-av { width: 20px; height: 20px; font-size: 9px; }
.cl-mi.cl-acc { font-weight: 500; }
.cl-mi.cl-unsel > svg { visibility: hidden; }
.cl-mi.cl-head { min-height: 30px; color: var(--cl-muted); font-size: 13px; cursor: default; }
.cl-mi.cl-head:hover { background: none; }
.cl-menu hr { height: 0; border: 0; border-top: .5px solid var(--cl-line-2); margin: 6px 4px; }
.cl-menu-foot { padding: 6px 10px 4px; color: var(--cl-muted); font-size: 12px; white-space: normal; }
#cl-tip {
  position: fixed; z-index: 2147483100; pointer-events: none; max-width: 280px; padding: 5px 8px; border-radius: 6px; background: var(--cl-tip); color: var(--cl-tip-text);
  font: 500 12px/16px var(--cl-sans); opacity: 0; transition: opacity .1s; white-space: pre-line; box-shadow: 0 4px 14px rgba(0, 0, 0, .25);
}
#cl-tip.cl-show { opacity: 1; }
#cl-tip.cl-card { padding: 8px 12px; border-radius: 8px; background: var(--cl-pop); color: var(--cl-text); border: .5px solid var(--cl-line-2); box-shadow: var(--cl-shadow); font-size: 14px; font-weight: 400; line-height: 20px; }
#cl-tip .cl-tip-sub { display: block; font-size: 12px; color: var(--cl-muted); }
#cl-tip:not(.cl-card) .cl-tip-sub { color: rgba(255, 255, 255, .6); }
body.cl-on .cdk-overlay-pane :is(.mat-mdc-menu-panel, .mat-mdc-select-panel),
body.cl-on .cdk-overlay-popover .cdk-overlay-pane > .container,
body.cl-on .cdk-overlay-popover gem-menu:not(.cdk-overlay-popover .container gem-menu) {
  background: var(--cl-pop) !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; border: .5px solid var(--cl-line-2) !important;
  border-radius: 12px !important; box-shadow: var(--cl-shadow) !important; padding: 6px !important; min-width: 220px !important; overflow: hidden;
}
body.cl-on .cdk-overlay-popover .cdk-overlay-pane > .container :is(gem-menu, .popover-menu) { background: transparent !important; box-shadow: none !important; padding: 0 !important; min-width: 0 !important; border: 0 !important; }
body.cl-on .mat-mdc-menu-content { padding: 0 !important; }
body.cl-on .cdk-overlay-pane .mat-mdc-menu-item, body.cl-on .cdk-overlay-popover gem-menu-item {
  min-height: 34px !important; margin: 0 !important; width: 100% !important; padding: 0 10px !important; border-radius: 8px !important; box-sizing: border-box !important; background: transparent !important; color: var(--cl-text) !important;
}
body.cl-on .cdk-overlay-popover gem-menu-item { padding: 0 !important; }
body.cl-on .cdk-overlay-popover gem-menu-item-content { min-height: 34px !important; padding: 6px 10px !important; border-radius: 8px !important; gap: 10px !important; background: transparent !important; }
body.cl-on .cdk-overlay-pane .mat-mdc-menu-item:hover, body.cl-on .cdk-overlay-popover gem-menu-item-content:hover, body.cl-on .cdk-overlay-popover gem-menu-item-content.active { background: var(--cl-hover) !important; }
body.cl-on :is(.cdk-overlay-pane .mat-mdc-menu-item, .cdk-overlay-popover gem-menu-item) :is(.mat-mdc-menu-item-text, .gem-menu-item-label, .label, span) { font-size: 14px !important; font-weight: 400 !important; color: inherit !important; }
body.cl-on .cdk-overlay-popover gem-menu-item .sublabel { font-size: 12px !important; color: var(--cl-muted) !important; }
body.cl-on :is(.cdk-overlay-pane .mat-mdc-menu-item, .cdk-overlay-popover gem-menu-item) mat-icon { color: var(--cl-text-2) !important; font-size: 18px !important; width: 18px !important; height: 18px !important; }
body.cl-on .cdk-overlay-pane .mat-mdc-menu-item .mat-mdc-menu-ripple, body.cl-on .cdk-overlay-pane .mat-mdc-menu-item::before { display: none !important; }
body.cl-on .cdk-overlay-pane .settings-menu-section-header { padding: 8px 10px 4px !important; color: var(--cl-muted) !important; font-size: 12px !important; font-weight: 500 !important; }
body.cl-on .cdk-overlay-pane :is(.mat-mdc-menu-item[data-test-id="delete-button"], [data-test-id="delete-button"]),
body.cl-on .cdk-overlay-popover gem-menu-item[data-test-id="delete-button"] * { color: var(--cl-danger) !important; }
body.cl-on :is(.mat-divider, mat-divider) { border-top-color: var(--cl-line-2) !important; margin: 6px 4px !important; }
body.cl-on .mat-mdc-dialog-surface, body.cl-on .mdc-dialog__surface { background: var(--cl-side) !important; border: .5px solid var(--cl-line-2) !important; border-radius: 16px !important; box-shadow: var(--cl-shadow) !important; color: var(--cl-text) !important; }
body.cl-on .mat-mdc-dialog-container .mdc-dialog__title { font-size: 18px !important; font-weight: 500 !important; color: var(--cl-strong) !important; }
body.cl-on .mat-mdc-dialog-actions button { border-radius: 8px !important; }
body.cl-on .cdk-overlay-dark-backdrop.cdk-overlay-backdrop-showing { background: rgba(0, 0, 0, .55) !important; }
body.cl-on .mdc-tooltip__surface { background: var(--cl-tip) !important; color: var(--cl-tip-text) !important; border-radius: 6px !important; font-size: 12px !important; }
body.cl-on :is(g1-dynamic-upsell-button button, .gem-button-type-filled button, button.mdc-button--unelevated) { background: var(--cl-strong) !important; color: var(--cl-page) !important; border-radius: 8px !important; }
body.cl-on .gem-button-type-tonal button { background: var(--cl-hover) !important; color: var(--cl-strong) !important; }

.cl-modal-back { position: fixed; inset: 0; z-index: 2147483002; background: rgba(0, 0, 0, .55); display: flex; align-items: center; justify-content: center; animation: cl-fade .15s; }
body.cl-light .cl-modal-back { background: rgba(0, 0, 0, .35); }
@keyframes cl-fade { from { opacity: 0 } }
.cl-modal {
  position: relative; width: min(460px, calc(100vw - 32px)); max-height: 84vh; display: flex; flex-direction: column; background: var(--cl-side); color: var(--cl-text);
  border: .5px solid var(--cl-line-2); border-radius: 16px; box-shadow: var(--cl-shadow); overflow: hidden; animation: cl-modal-in .18s var(--cl-ease);
}
@keyframes cl-modal-in { from { opacity: 0; transform: scale(.97); } }
.cl-modal > h3 { margin: 0; padding: 20px 52px 8px 20px; font-size: 18px; font-weight: 500; line-height: 24px; color: var(--cl-strong); }
.cl-modal > p { margin: 0; padding: 0 20px 12px; font-size: 14px; line-height: 21px; color: var(--cl-text-2); }
.cl-modal .cl-modal-x { position: absolute; top: 12px; right: 12px; }
.cl-modal .cl-input { margin: 4px 20px 8px; width: calc(100% - 40px); }
.cl-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding: 12px 20px 20px; }
.cl-btn { height: 34px; padding: 0 14px; border: 0; border-radius: 8px; font: 500 14px/16px var(--cl-sans); cursor: pointer; background: var(--cl-strong); color: var(--cl-page); white-space: nowrap; transition: opacity .12s, background-color .12s; }
.cl-btn:hover { opacity: .88; }
.cl-btn.cl-sec { background: transparent; color: var(--cl-text); box-shadow: inset 0 0 0 .5px var(--cl-line-2); }
.cl-btn.cl-sec:hover { background: var(--cl-hover); opacity: 1; }
.cl-btn.cl-red { background: var(--cl-danger-bg); color: #fff; }
.cl-btn.cl-clay { background: var(--cl-clay); color: #fff; }
.cl-input { height: 38px; padding: 0 12px; border-radius: 8px; border: 0; box-shadow: inset 0 0 0 .5px var(--cl-line-2); background: var(--cl-input); color: var(--cl-text); font: 400 14px/20px var(--cl-sans); outline: 0; }
.cl-input:focus { box-shadow: inset 0 0 0 1px var(--cl-text-2); }
.cl-switch { position: relative; flex: none; width: 36px; height: 20px; border-radius: 10px; background: var(--cl-line-2); cursor: pointer; transition: background-color .2s; }
.cl-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .2s var(--cl-ease); box-shadow: 0 1px 2px rgba(0, 0, 0, .25); }
.cl-switch.cl-on { background: var(--cl-blue); }
.cl-switch.cl-on::after { transform: translateX(16px); }

/* search (Ctrl+K) */
.cl-modal.cl-search { width: min(640px, calc(100vw - 32px)); max-height: min(560px, 80vh); }
.cl-search-head { display: flex; align-items: center; gap: 10px; height: 54px; padding: 0 16px; border-bottom: .5px solid var(--cl-line-2); color: var(--cl-muted); flex: none; }
.cl-search-head input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; color: var(--cl-text); font: 400 16px/20px var(--cl-sans); }
.cl-search-list { overflow-y: auto; padding: 6px; }
.cl-search-row { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 10px; border-radius: 8px; cursor: pointer; font-size: 14px; color: var(--cl-text); }
.cl-search-row.cl-sel { background: var(--cl-hover); }
.cl-search-row svg { width: 16px; height: 16px; color: var(--cl-muted); }
.cl-search-row span:nth-child(2) { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cl-search-row small { flex: none; color: var(--cl-muted); font-size: 12px; }
.cl-search-head2 { padding: 10px 10px 4px; font-size: 12px; color: var(--cl-muted); }
.cl-empty { padding: 28px 16px; text-align: center; color: var(--cl-muted); font-size: 14px; }

/* settings dialog */
.cl-modal.cl-settings { width: min(920px, calc(100vw - 48px)); height: min(680px, calc(100vh - 48px)); max-height: none; display: grid; grid-template-columns: 210px minmax(0, 1fr); grid-template-rows: 52px minmax(0, 1fr); }
.cl-set-head { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; padding: 0 12px 0 18px; border-bottom: .5px solid var(--cl-line-2); font-size: 15px; font-weight: 500; color: var(--cl-strong); }
.cl-set-nav { overflow-y: auto; padding: 10px 8px; border-right: .5px solid var(--cl-line-2); }
.cl-set-find { display: flex; align-items: center; gap: 8px; height: 32px; margin: 0 0 10px; padding: 0 10px; border-radius: 8px; box-shadow: inset 0 0 0 .5px var(--cl-line-2); color: var(--cl-muted); }
.cl-set-find input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; color: var(--cl-text); font: 400 13px/18px var(--cl-sans); }
.cl-set-find svg { width: 14px; height: 14px; }
.cl-set-h { padding: 10px 10px 4px; font-size: 12px; color: var(--cl-muted); }
.cl-set-item { display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 10px; margin: 0 0 1px; border-radius: 8px; cursor: pointer; font-size: 14px; color: var(--cl-text); }
.cl-set-item:hover { background: var(--cl-hover); }
.cl-set-item.cl-on { background: var(--cl-active); }
.cl-set-item svg { width: 16px; height: 16px; color: var(--cl-text-2); }
.cl-set-item .cl-ext { margin-left: auto; width: 14px; height: 14px; color: var(--cl-muted); }
.cl-set-body { overflow-y: auto; padding: 18px 24px 32px; }
.cl-set-body h4 { margin: 0 0 4px; font-size: 15px; font-weight: 500; color: var(--cl-strong); }
.cl-set-body h4 + .cl-set-desc { margin-top: 0; }
.cl-set-body h4:not(:first-child) { margin-top: 22px; }
.cl-set-desc { margin: 4px 0 8px; font-size: 13px; line-height: 19px; color: var(--cl-muted); }
.cl-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 48px; font-size: 14px; color: var(--cl-text); }
.cl-row.cl-click { cursor: pointer; border-radius: 8px; margin: 0 -8px; padding: 0 8px; }
.cl-row.cl-click:hover { background: var(--cl-hover); }
.cl-row-t { min-width: 0; }
.cl-row-t small { display: block; margin-top: 2px; font-size: 12.5px; line-height: 17px; color: var(--cl-muted); }
.cl-row > svg { width: 16px; height: 16px; color: var(--cl-muted); }
.cl-select { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 8px 0 12px; border: 0; border-radius: 8px; background: none; color: var(--cl-text); font: 400 14px/20px var(--cl-sans); cursor: pointer; white-space: nowrap; }
.cl-select:hover { background: var(--cl-hover); }
.cl-select svg { width: 14px; height: 14px; color: var(--cl-muted); }
.cl-seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--cl-hover); }
.cl-seg button { min-width: 30px; height: 28px; padding: 0 8px; border: 0; border-radius: 6px; background: none; color: var(--cl-icon); font: 400 13px/1 var(--cl-sans); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.cl-seg button.cl-on { background: var(--cl-page); color: var(--cl-strong); box-shadow: 0 0 0 .5px var(--cl-line-2), 0 1px 2px rgba(0, 0, 0, .15); }
.cl-seg button svg { width: 16px; height: 16px; }
.cl-prof { display: flex; align-items: center; gap: 14px; padding: 8px 0 16px; }
.cl-prof .cl-av { width: 48px; height: 48px; font-size: 18px; }
.cl-prof b { display: block; font-size: 16px; font-weight: 500; color: var(--cl-strong); }
.cl-prof span { font-size: 13px; color: var(--cl-muted); }
.cl-kbd { display: inline-block; min-width: 20px; padding: 1px 6px; margin-left: 4px; border-radius: 5px; box-shadow: inset 0 0 0 .5px var(--cl-line-2); font: 500 12px/18px var(--cl-sans); color: var(--cl-text-2); text-align: center; }

/* toast */
#cl-toast {
  position: fixed; left: 50%; bottom: 28px; z-index: 2147483003; transform: translateX(-50%) translateY(8px); opacity: 0; pointer-events: none;
  background: var(--cl-strong); color: var(--cl-page); padding: 10px 14px; border-radius: 10px; font: 500 14px/18px var(--cl-sans); box-shadow: var(--cl-shadow);
  transition: opacity .15s, transform .15s; display: flex; align-items: center; gap: 10px; max-width: 90vw;
}
#cl-toast.cl-show { opacity: 1; transform: translateX(-50%); }
#cl-toast svg { width: 18px; height: 18px; }

/* scrollbars */
body.cl-on * { scrollbar-width: thin; scrollbar-color: var(--cl-scroll) transparent; }
body.cl-on ::-webkit-scrollbar { width: 8px; height: 8px; }
body.cl-on ::-webkit-scrollbar-thumb { background: var(--cl-scroll); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
body.cl-on ::-webkit-scrollbar-track { background: transparent; }
body.cl-on ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
body.cl-on ::selection { background: color-mix(in srgb, var(--cl-clay) 30%, transparent); }

/* reduced motion */
body.cl-still *, body.cl-still *::before, body.cl-still *::after { animation-duration: 0s !important; transition-duration: 0s !important; }
`;

  let styleEl = null;
  function addStyle() {
    if (styleEl && styleEl.isConnected) return;
    if (typeof GM_addStyle === 'function') { try { styleEl = GM_addStyle(CSS); } catch (e) { styleEl = null; } if (styleEl) return; }
    const parent = document.head || document.documentElement;
    if (!parent) return;
    styleEl = document.createElement('style');
    styleEl.id = 'cl-style';
    styleEl.textContent = CSS;
    parent.appendChild(styleEl);
  }
  addStyle();
  const styleKeeper = new MutationObserver(addStyle);
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
    more: 'c5,12,1.6|c12,12,1.6|c19,12,1.6',
    logout: 'M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5|M15 8l4 4-4 4|M19 12H9',
    panel: 'M4.5 4.5h15a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z|M9.5 4.5v15',
    chatBubble: 'M12 4c4.7 0 8 2.9 8 6.7S16.7 17.4 12 17.4c-.9 0-1.8-.1-2.6-.3L5 19.5l1.2-3.7C4.8 14.6 4 12.8 4 10.7 4 6.9 7.3 4 12 4z',
    codeTag: 'M8.5 8l-4 4 4 4|M15.5 8l4 4-4 4',
    projects: 'M4.5 7.5v-2a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v1|M3.5 9.5h17l-1.2 9.1a1 1 0 0 1-1 .9H5.7a1 1 0 0 1-1-.9z',
    artifacts: 'M8 4.5h8.5a1 1 0 0 1 1 1V15|M5.5 8h9a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z',
    customize: 'M4.5 8.5h15v10a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z|M9 8.5V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2.5|M4.5 12.5h15',
    filter: 'M4 7h16|M7 12h10|M10 17h4',
    ghost: 'M5 20V10a7 7 0 0 1 14 0v10l-2.3-1.6L14.3 20 12 18.4 9.7 20l-2.4-1.6z|c9.5,10.5,1|c14.5,10.5,1',
    device: 'M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z|M9 20h6|M12 16.5V20',
    usage: 'c12,13,8|M12 13l3.5-3.5|M9 3.5h6',
    thumbUp: 'M7.5 10.5v9H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z|M7.5 10.5l3.6-6.3a1.6 1.6 0 0 1 2.9 1.2l-.8 3.6h5.1a1.8 1.8 0 0 1 1.8 2.1l-1.2 6.6a2 2 0 0 1-2 1.8H7.5',
    thumbDown: 'M7.5 13.5v-9H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1z|M7.5 13.5l3.6 6.3a1.6 1.6 0 0 0 2.9-1.2l-.8-3.6h5.1a1.8 1.8 0 0 0 1.8-2.1l-1.2-6.6a2 2 0 0 0-2-1.8H7.5',
    retry: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3|M19.5 4.5v4h-4',
    plans: 'M4 6.5l1.5 1.5L8 5.5|M11 7h9|M4 14.5h4|M11 15h9',
    guest: 'M4 7.5h16v3a2 2 0 0 0 0 3v3H4v-3a2 2 0 0 0 0-3z|M14 7.5v9',
    apikey: 'c8,15,3.5|M10.5 12.5L19 4|M15.5 7.5l2.5 2.5|M13.5 9.5l2 2',
    extLink: 'M14 4.5h5.5V10|M19.5 4.5L11 13|M18 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10',
    memory: 'M9 4.5a3 3 0 0 0-3 3v.4a3 3 0 0 0-1.5 5.3A3 3 0 0 0 9 18.5h.5V4.5z|M15 4.5a3 3 0 0 1 3 3v.4a3 3 0 0 1 1.5 5.3 3 3 0 0 1-4.5 5.3h-.5V4.5z',
    capabilities: 'M12 3.5l2.2 5.3 5.3 2.2-5.3 2.2L12 18.5l-2.2-5.3L4.5 11l5.3-2.2z|M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
    connectors: 'M8.5 15.5l7-7|M10 6.5l1.6-1.6a3.5 3.5 0 0 1 5 5L15 11.5|M14 17.5l-1.6 1.6a3.5 3.5 0 0 1-5-5L9 12.5',
    billing: 'M4 6.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z|M3 10.5h18|M7 14.5h3',
    monitor: 'M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z|M9 20h6|M12 16v4',
    spark: 'F11.1 2.6h1.8l.4 6.5 5.1-4.1 1.3 1.3-4.1 5.1 6.5.4v1.8l-6.5.4 4.1 5.1-1.3 1.3-5.1-4.1-.4 6.5h-1.8l-.4-6.5-5.1 4.1-1.3-1.3 4.1-5.1-6.5-.4v-1.8l6.5-.4-4.1-5.1 1.3-1.3 5.1 4.1z',
  });
  const NS = 'http://www.w3.org/2000/svg';
  // 'c' = circle, 'F' = filled path, 'E' = filled path with holes, '!' = viewBox, anything else = stroked path
  function icon(name) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', 'cl-i');
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

  // "just now", "5m ago", "1h ago", "3 days ago", "Oct 17"
  function relTime(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    const d = Math.floor(s / 86400);
    if (d < 7) return d === 1 ? 'yesterday' : d + ' days ago';
    const dt = new Date(ts), now = new Date();
    return dt.toLocaleDateString([], dt.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const fmtFull = ts => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  function initials(t) {
    const w = (t || '?').replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] || '?').toUpperCase();
  }
  function userAvatar(size = 24) {
    const src = G.photo();
    const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px`;
    if (src) return h('img', { class: 'cl-av', src, alt: '', style: st });
    return h('span', { class: 'cl-av', style: st, text: initials(G.name()) });
  }
  // greetings in Claude's voice, picked per day and time
  function greeting() {
    const first = (G.name() || '').split(/\s+/)[0] || 'there';
    const hr = new Date().getHours();
    const tod = hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const all = [`${tod}, ${first}`, `Back at it, ${first}`, `How can I help, ${first}?`, `What's on your mind, ${first}?`, `${tod}, ${first}`, 'Coffee and Gemini time?'];
    const day = new Date(); const seed = day.getFullYear() * 400 + day.getMonth() * 32 + day.getDate();
    return all[seed % all.length];
  }

  /* ---------- clipboard / toast / sound ---------- */
  function copy(text) {
    try { if (typeof GM_setClipboard === 'function') { GM_setClipboard(text, 'text'); return; } } catch (e) { /* fall through */ }
    navigator.clipboard && navigator.clipboard.writeText(text).catch(() => {});
  }
  let toastTimer = 0;
  function toast(msg, ic = 'info') {
    let t = $('#cl-toast');
    if (!t) { t = h('div', { id: 'cl-toast', class: 'cl-ui' }); document.body.append(t); }
    t.replaceChildren(icon(ic), h('span', { text: msg }));
    t.classList.add('cl-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('cl-show'), 2400);
  }
  let audioCtx = null;
  function ding() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      [[660, 0], [990, 0.09]].forEach(([f, t0]) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + t0); g.gain.exponentialRampToValueAtTime(0.12, now + t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, now + t0 + 0.3);
        o.connect(g).connect(audioCtx.destination); o.start(now + t0); o.stop(now + t0 + 0.35);
      });
    } catch (e) { /* no audio */ }
  }
  function speak(text) {
    try {
      const sy = window.speechSynthesis;
      if (!sy) { toast("Your browser can't read this aloud", 'speaker'); return; }
      if (sy.speaking) { sy.cancel(); return; }
      sy.speak(new SpeechSynthesisUtterance(String(text).slice(0, 4000)));
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
      if (b.closest('.cl-ui')) continue;
      if (re.test(labelOf(b))) return b;
    }
    return null;
  }
  // Open one of Gemini's menus invisibly and click an item in it.
  let ghostDepth = 0;
  async function ghost(fn) {
    ghostDepth++;
    document.body.classList.add('cl-ghost');
    try { return await fn(); } finally {
      setTimeout(() => { if (--ghostDepth <= 0) { ghostDepth = 0; document.body.classList.remove('cl-ghost'); } }, 450);
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
  G.toolsBtn = () => $('input-area-v2 .simplified-input-menu-container button') || findBtn($('input-area-v2'), /upload|tools/i);
  async function toolAction(re) {
    const b = G.toolsBtn();
    if (!b) return false;
    return ghost(async () => {
      b.click();
      const it = await waitFor(() => $$('.cdk-overlay-container button, .cdk-overlay-popover button, [popover] button, .cdk-overlay-container [role="menuitem"]')
        .find(x => !x.closest('.cl-ui') && re.test((x.innerText || x.textContent || '').trim())), 1500);
      if (!it) { closeOverlays(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })); return false; }
      it.click();
      await sleep(120);
      closeOverlays();
      return true;
    });
  }
  // Gemini only offers temporary chats from a new chat, so open one first
  G.tempChat = async () => {
    let b = G.topBtn(/temporary|temp chat/i);
    if (!b) { G.newChat(); b = await waitFor(() => G.topBtn(/temporary|temp chat/i), 4000, 100); }
    if (b) { b.click(); return true; }
    toast('Incognito chats start from a new chat', 'ghost');
    return false;
  };
  const isTemp = () => !!$('chat-window.is-temporary-chat');
  function plan() {
    if ($('g1-dynamic-upsell-button button')) return 'Free';
    const t = (($('.mavatar-subscription, [class*="tier"], [class*="subscription"]') || {}).textContent || '').trim();
    return /ultra/i.test(t) ? 'Ultra' : /pro|plus|premium|advanced/i.test(t) ? 'Pro' : 'Gemini';
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
      if (el.closest('.cl-ui')) continue;
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
  // Gemini's other pages, named the way claude.ai names its own
  const PAGES = [
    [/^\/(library|mystuff)/, 'Artifacts', 'artifacts'],
    [/^\/images/, 'Images', 'images'],
    [/^\/scheduled/, 'Scheduled', 'clock'],
    [/^\/(customize|gems)/, 'Customize', 'customize'],
    [/^\/notebooks?/, 'Projects', 'projects'],
    [/^\/search/, 'Chats', 'search'],
    [/^\/(settings|saved-info|apps|extensions|personal|activity)/, 'Settings', 'settings'],
  ];
  const pageInfo = () => { const p = PAGES.find(x => x[0].test(location.pathname)); return p ? { title: p[1], icon: p[2], status: '' } : null; };
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
     Pop-up menus (Claude style, with sub-menus) and dialogs
     ===================================================================== */
  let closePopup = null;
  function popup(build, x, y, opts = {}) {
    if (closePopup) closePopup();
    const back = h('div', { class: 'cl-backdrop cl-ui' });
    const wrap = h('div', { class: 'cl-menu-wrap cl-ui' });
    const close = () => {
      back.remove(); wrap.remove(); $$('.cl-menu.cl-sub').forEach(s => s.remove());
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
      for (const b of $$('.cl-mi, .cl-reactbar button', wrap)) {
        let x = 0, y = 0, n = b;
        while (n && n !== wrap) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
        if (cx >= wr.left + x && cx <= wr.left + x + b.offsetWidth && cy >= wr.top + y && cy <= wr.top + y + b.offsetHeight) return b;
      }
      return null;
    };
    wrap.addEventListener('click', e => {
      if (forwarding || e.target.closest('input, .cl-emojigrid')) return;
      const early = performance.now() - openedAt < 300;
      if (!early && e.target.closest('.cl-mi, .cl-reactbar button')) return;
      const b = itemAt(e.clientX, e.clientY);
      if (!b || b === e.target.closest('.cl-mi, .cl-reactbar button')) return;
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
    $$('.cl-menu, .cl-reactbar', wrap).forEach(m => m.style.setProperty('--cl-origin', `${oy} ${ox}`));
    closePopup = close;
    return close;
  }
  function menuList(items, close, extraClass = '') {
    const m = h('div', { class: 'cl-menu ' + extraClass });
    let subEl = null, subFor = null, subTimer = 0;
    const closeSub = () => { if (subEl) { subEl.remove(); subEl = null; subFor = null; } };
    const openSub = (btn, it) => {
      if (subFor === btn || !m.isConnected) return; // a hover timer can fire after the menu has closed
      closeSub();
      const list = typeof it.sub === 'function' ? it.sub() : it.sub;
      subEl = menuList(list, close, 'cl-sub');
      subFor = btn;
      subEl.addEventListener('mouseenter', () => clearTimeout(subTimer));
      document.body.append(subEl);
      const br = btn.getBoundingClientRect(), mr = m.getBoundingClientRect(), sr = subEl.getBoundingClientRect();
      let left = mr.right + 6, top = br.top - 6;
      if (left + sr.width > innerWidth - 8) left = mr.left - sr.width - 6;
      top = Math.max(8, Math.min(top, innerHeight - sr.height - 8));
      subEl.style.left = left + 'px'; subEl.style.top = top + 'px';
      $$('.cl-mi', m).forEach(b => b.classList.toggle('cl-hl', b === btn));
    };
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { m.append(h('hr')); continue; }
      if (it.foot) { m.append(h('div', { class: 'cl-menu-foot', text: it.foot })); continue; }
      const lead = it.photo ? it.photo : icon(it.icon || 'dot');
      const btn = h('button', { class: 'cl-mi' + (it.danger ? ' cl-danger' : '') + (it.cls ? ' ' + it.cls : '') }, lead, h('span', { text: it.label }),
        it.sub ? h('span', { class: 'cl-mi-end' }, icon('chevRight')) : (it.end ? h('span', { class: 'cl-mi-end', text: it.end }) : null));
      if (it.sub) {
        btn.addEventListener('mouseenter', () => { clearTimeout(subTimer); subTimer = setTimeout(() => openSub(btn, it), 90); });
        btn.addEventListener('click', e => { e.stopPropagation(); openSub(btn, it); });
      } else {
        btn.addEventListener('mouseenter', () => { clearTimeout(subTimer); subTimer = setTimeout(() => { closeSub(); $$('.cl-mi', m).forEach(b => b.classList.remove('cl-hl')); }, 120); });
        btn.addEventListener('click', e => { e.stopPropagation(); close(); it.run && it.run(); });
      }
      m.append(btn);
    }
    return m;
  }
  let closeModal = null;
  function modal(build) {
    if (closePopup) closePopup();
    const back = h('div', { class: 'cl-modal-back cl-ui' });
    const box = h('div', { class: 'cl-modal' });
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
     Tooltips and hover cards
     ===================================================================== */
  let tipEl = null, tipFor = null, tipTimer = 0;
  function hideTip() { clearTimeout(tipTimer); tipFor = null; if (tipEl) tipEl.classList.remove('cl-show'); }
  function showTip(t) {
    if (!t.isConnected) return;
    const text = t.getAttribute('data-tip');
    if (!text) return;
    if (!tipEl || !tipEl.isConnected) { tipEl = h('div', { id: 'cl-tip', class: 'cl-ui' }); document.body.append(tipEl); }
    const [main, sub] = text.split('\n');
    tipEl.className = 'cl-ui' + (t.hasAttribute('data-tip-card') ? ' cl-card' : '');
    tipEl.id = 'cl-tip';
    tipEl.replaceChildren(main, ...(sub ? [h('span', { class: 'cl-tip-sub', text: sub })] : []));
    tipEl.style.left = '0px'; tipEl.style.top = '0px';
    const r = t.getBoundingClientRect(), tr = tipEl.getBoundingClientRect();
    const side = t.getAttribute('data-tip-side') || 'top';
    let x, y;
    if (side === 'right') { x = r.right + 10; y = r.top + r.height / 2 - tr.height / 2; }
    else if (side === 'bottom') { x = r.left + r.width / 2 - tr.width / 2; y = r.bottom + 6; }
    else { x = r.left + r.width / 2 - tr.width / 2; y = r.top - tr.height - 6; }
    tipEl.style.left = Math.round(Math.max(8, Math.min(x, innerWidth - tr.width - 8))) + 'px';
    tipEl.style.top = Math.round(Math.max(8, Math.min(y, innerHeight - tr.height - 8))) + 'px';
    tipEl.classList.add('cl-show');
  }
  document.addEventListener('mouseover', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t === tipFor) return;
    hideTip();
    if (!t || !t.getAttribute('data-tip')) return;
    tipFor = t;
    tipTimer = setTimeout(() => showTip(t), +(t.getAttribute('data-tip-delay') || 350));
  }, LC);
  document.addEventListener('mousedown', hideTip, LC);

  /* =====================================================================
     Sidebar: header, New / Projects / Artifacts…, Starred and Recents, account
     ===================================================================== */
  let sideHead = null, navEl = null, acctEl = null;
  function toggleSidebar() {
    const side = $('bard-sidenav');
    const open = !!(side && side.getBoundingClientRect().width > 120);
    const b = findBtn(document, open ? /close sidebar|collapse menu/i : /open sidebar|expand menu|main menu/i, '.cl-ui') || $('.side-nav-menu-button button');
    if (b) b.click();
    setTimeout(schedule, 300);
  }
  async function openCanvas() {
    if (convId() !== '_new' || pageKind() !== 'chat') { G.newChat(); await sleep(700); }
    if (!(await toolAction(/^canvas$/i))) toast("Couldn't find Canvas in Gemini's tools", 'codeTag');
  }
  function buildSideHead() {
    const head = $('.sidenav-header-buttons');
    if (!head) return;
    if (sideHead && sideHead.isConnected && sideHead.parentElement === head) return;
    sideHead = h('div', { class: 'cl-side-head cl-ui' },
      h('button', { class: 'cl-iconbtn', 'data-tip': 'Close sidebar', 'data-tip-side': 'bottom', onclick: toggleSidebar }, icon('panel')),
      h('span', { class: 'cl-mark', text: 'Gemini', onclick: G.newChat }),
      h('div', { class: 'cl-mode' },
        h('button', { class: 'cl-on', 'data-tip': 'Chat', 'data-tip-side': 'bottom', onclick: G.newChat }, icon('chatBubble')),
        h('button', { 'data-tip': 'Canvas\nA new chat with the Canvas tool on', 'data-tip-side': 'bottom', onclick: openCanvas }, icon('codeTag'))));
    head.prepend(sideHead);
  }
  function renderNav() {
    const list = $('bard-sidenav conversations-list');
    if (!list || !list.parentElement) return;
    if (!navEl || !navEl.isConnected || navEl.nextElementSibling !== list) {
      if (navEl) navEl.remove();
      navEl = h('div', { id: 'cl-nav', class: 'cl-ui' });
      list.parentElement.insertBefore(navEl, list);
    }
    const p = location.pathname, fresh = pageKind() === 'chat' && convId() === '_new' && !isTemp();
    const sig = p + '|' + fresh;
    if (navEl.dataset.v === sig) return;
    navEl.dataset.v = sig;
    const item = (ic, label, run, on) => h('div', { class: 'cl-nav-item' + (on ? ' cl-on' : ''), onclick: run }, icon(ic), h('span', { text: label }));
    navEl.replaceChildren(
      item('add', 'New chat', G.newChat, fresh),
      item('projects', 'Projects', e => openProjects(e.currentTarget), /^\/notebooks?/.test(p)),
      item('artifacts', 'Artifacts', G.library, /^\/(library|mystuff|images)/.test(p)),
      item('clock', 'Scheduled', G.scheduled, /^\/scheduled/.test(p)),
      item('customize', 'Customize', G.customize, /^\/(customize|gems)/.test(p)));
  }
  function openProjects(anchor) {
    const r = anchor.getBoundingClientRect();
    const nb = G.notebooks();
    popup((wrap, close) => wrap.append(menuList([
      ...nb.map(n => ({ icon: 'projects', label: n.title, run: () => n.el.click() })),
      nb.length ? '-' : null,
      { icon: 'add', label: 'New project', run: G.newNotebook },
      nb.length ? null : { foot: 'Projects are Gemini notebooks: chats and files grouped by topic.' },
    ], close)), r.right + 6, r.top);
  }
  function isRowPinned(r) {
    return !!(r.item.closest('[data-test-id*="pinned" i], .pinned-conversations') ||
      $$('mat-icon, gem-icon', r.item).some(i => /keep|push_pin|pinned/i.test((i.getAttribute('fonticon') || '') + ' ' + (i.textContent || '') + ' ' + (i.getAttribute('data-mat-icon-name') || ''))));
  }
  function buildResizer() {
    const side = $('bard-sidenav');
    if (!side || $('#cl-resizer', side)) return;
    const rz = h('div', { id: 'cl-resizer', class: 'cl-ui' });
    rz.addEventListener('mousedown', e => {
      e.preventDefault();
      rz.classList.add('cl-drag'); document.body.classList.add('cl-resizing');
      const left = side.getBoundingClientRect().left;
      const move = ev => { S.sideWidth = Math.max(220, Math.min(420, ev.clientX - left)); applyVars(); schedule(); };
      const up = () => { rz.classList.remove('cl-drag'); document.body.classList.remove('cl-resizing'); setS('sideWidth', S.sideWidth); removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    });
    rz.addEventListener('dblclick', () => setS('sideWidth', CONFIG.sideWidth));
    side.append(rz);
  }
  function decorateSidebar(gen) {
    buildSideHead();
    renderNav();
    buildResizer();
    renderAcct();
    const cur = convId();
    let firstPinned = null, firstChat = null;
    for (const r of sidebarRows()) safe('row', () => {
      const a = r.a;
      let more = $(':scope > .cl-row-more', a);
      if (!more) {
        $$(':scope > .cl-ui', a).forEach(x => x.remove());
        more = h('button', { class: 'cl-row-more cl-ui', 'data-tip': 'More', onclick: ev => {
          ev.preventDefault(); ev.stopPropagation();
          const row = sidebarRows().find(x => x.a === a), rr = ev.currentTarget.getBoundingClientRect();
          if (row) openRowMenu(row, rr.left, rr.bottom + 4);
        } }, icon('more'));
        a.append(more);
      }
      a.classList.toggle('cl-row-on', isActiveRow(r));
      const ts = r.id && DB.chats[r.id] && DB.chats[r.id].ts;
      const tip = r.title + (ts ? '\n' + relTime(ts) : '');
      if (a.getAttribute('data-tip') !== tip) { a.setAttribute('data-tip', tip); a.setAttribute('data-tip-side', 'right'); a.setAttribute('data-tip-card', ''); a.setAttribute('data-tip-delay', '650'); }
      let dot = $(':scope > .cl-row-dot', a);
      const busy = (gen && r.id === cur) || (r.id && DB.unread[r.id] && r.id !== cur);
      if (busy && !dot) { dot = h('span', { class: 'cl-row-dot cl-ui' }); more.before(dot); } else if (!busy && dot) dot.remove();
      const pinned = isRowPinned(r);
      if (pinned && !firstPinned) firstPinned = r;
      if (!pinned && !firstChat) firstChat = r;
      r.item.classList.toggle('cl-collapsed-row', !isActiveRow(r) && !!S.collapsed[pinned ? 'starred' : 'recents']);
    });
    placeSec('starred', 'Starred', firstPinned);
    placeSec('recents', 'Recents', firstChat, true);
  }
  function placeSec(key, label, row, tools) {
    let el = $('.cl-sec[data-sec="' + key + '"]');
    if (!row) { if (el) el.remove(); return; }
    if (!el) {
      el = h('div', { class: 'cl-sec cl-ui', 'data-sec': key, onclick: () => { S.collapsed[key] = !S.collapsed[key]; setS('collapsed', S.collapsed); scan(); } },
        h('span', {}, label, icon('chevDown')),
        tools ? h('div', { class: 'cl-sec-tools' }, h('button', { 'data-tip': 'Search chats', onclick: e => { e.stopPropagation(); openSearch(); } }, icon('search'))) : null);
    }
    el.classList.toggle('cl-closed', !!S.collapsed[key]);
    if (el.nextElementSibling !== row.item) row.item.parentElement.insertBefore(el, row.item);
  }
  function openRowMenu(row, x, y) {
    const starred = isRowPinned(row);
    row.a.classList.add('cl-row-ctx');
    popup((wrap, close) => wrap.append(menuList([
      { icon: 'star', label: starred ? 'Unstar' : 'Star', run: () => G.rowMenu(row, 'pin-button') },
      { icon: 'edit', label: 'Rename', run: () => G.rowMenu(row, 'rename-button') },
      { icon: 'share', label: 'Share', run: () => G.rowMenu(row, 'share-button') },
      { icon: 'newtab', label: 'Open in new tab', run: () => window.open(row.a.href, '_blank') },
      '-',
      { icon: 'trash', label: 'Delete', danger: true, run: () => G.rowMenu(row, 'delete-button') },
    ], close)), x, y, { onClose: () => row.a.classList.remove('cl-row-ctx') });
  }
  function renderAcct() {
    const side = $('bard-sidenav');
    if (!side) return;
    if (!acctEl || !acctEl.isConnected || acctEl.parentElement !== side) {
      if (acctEl) acctEl.remove();
      acctEl = h('div', { id: 'cl-acct', class: 'cl-ui' },
        h('button', { class: 'cl-acct-btn', onclick: e => openAccountMenu(e.currentTarget) }, h('span', { class: 'cl-acct-av' }), h('span', { class: 'cl-acct-name' }), h('span', { class: 'cl-acct-plan' }), icon('chevDown')),
        h('button', { class: 'cl-iconbtn', 'data-tip': 'Get the apps', onclick: G.getApp }, icon('device')));
      side.append(acctEl);
    }
    const sig = [G.name(), G.photo(), plan()].join('|');
    if (acctEl.dataset.sig === sig) return;
    acctEl.dataset.sig = sig;
    $('.cl-acct-av', acctEl).replaceChildren(userAvatar(24));
    setText($('.cl-acct-name', acctEl), (G.name() || 'You').split(/\s+/)[0]);
    setText($('.cl-acct-plan', acctEl), '· ' + plan());
  }
  function openAccountMenu(btn) {
    const r = btn.getBoundingClientRect();
    btn.classList.add('cl-on');
    popup((wrap, close) => {
      const m = menuList([
        { icon: 'settings', label: 'Settings', end: 'Ctrl+Shift+,', run: () => openSettings() },
        { icon: 'usage', label: 'Usage', run: () => G.settings('desktop-usage-metrics-button') },
        { icon: 'globe', label: 'Language', run: () => window.open('https://myaccount.google.com/language', '_blank', 'noopener') },
        { icon: 'help', label: 'Get help', run: () => G.settings('help-button', /help center/i) },
        '-',
        { icon: 'plans', label: 'View all plans', run: G.upgrade },
        { icon: 'device', label: 'Get apps and extensions', run: G.getApp },
        { icon: 'guest', label: 'Add another account', run: G.addAccount },
        { icon: 'info', label: 'Learn more', sub: () => [
          { icon: 'shield', label: 'Privacy policy', run: () => G.settings('help-button', /privacy/i) },
          { icon: 'feedback', label: 'Send feedback', run: () => G.settings('send-feedback-button') },
          { icon: 'user', label: 'Google Account', run: G.account }] },
        '-',
        { icon: 'logout', label: 'Log out', run: confirmLogout },
      ], close);
      m.prepend(h('div', { class: 'cl-mi cl-head', text: G.email() || G.name() }));
      wrap.append(m);
    }, r.left, r.top - 6, { above: true, onClose: () => btn.classList.remove('cl-on') });
  }
  function confirmLogout() {
    modal((box, close) => box.append(
      h('h3', { text: 'Log out?' }),
      h('p', { text: 'This switches Gemini back to its normal look. Your chats stay right where they are, and you can come back anytime from the Tampermonkey menu.' }),
      h('div', { class: 'cl-actions' }, h('button', { class: 'cl-btn cl-sec', text: 'Cancel', onclick: close }),
        h('button', { class: 'cl-btn cl-red', text: 'Log out', onclick: () => { close(); turnOff(); } }))));
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
  function shareChat() {
    if (pageKind() === 'chat' && convId() !== '_new') G.convMenu('share-button');
    else toast('Open a chat to share it', 'share');
  }

  /* =====================================================================
     Title bar over the chat
     ===================================================================== */
  let topBar = null;
  function buildTop() {
    $$('#cl-top').forEach(e => e.remove());
    topBar = h('div', { id: 'cl-top', class: 'cl-ui' },
      h('button', { class: 'cl-iconbtn cl-top-toggle', 'data-tip': 'Open sidebar', 'data-tip-side': 'bottom', onclick: toggleSidebar }, icon('panel')),
      h('button', { class: 'cl-title-btn', onclick: e => openTitleMenu(e.currentTarget) }, h('span'), icon('chevDown')),
      h('div', { class: 'cl-top-right' },
        h('button', { class: 'cl-iconbtn cl-tb-files', 'data-tip': 'Files in this chat', 'data-tip-side': 'bottom', onclick: () => G.convMenu('studio-sidebar-button') }, icon('doc')),
        h('button', { class: 'cl-share', onclick: shareChat }, icon('share'), 'Share'),
        h('button', { class: 'cl-iconbtn cl-incog', 'data-tip-side': 'bottom', onclick: () => (isTemp() ? G.newChat() : G.tempChat()) }, icon('ghost'))));
    document.body.append(topBar);
  }
  function renderTop(title, kind, id) {
    const temp = isTemp();
    const chat = kind === 'chat' && id !== '_new' && !temp;
    const pi = kind !== 'chat' ? pageInfo() : null;
    const tb = $('.cl-title-btn', topBar);
    setText($('span', tb), chat ? title : pi ? pi.title : temp ? 'Incognito chat' : '');
    setStyle(tb, 'display', chat || pi || temp ? '' : 'none');
    tb.classList.toggle('cl-ghostly', !chat);
    setStyle($('svg', tb), 'display', chat ? '' : 'none');
    setStyle($('.cl-tb-files', topBar), 'display', chat ? '' : 'none');
    setStyle($('.cl-share', topBar), 'display', chat ? '' : 'none');
    const inc = $('.cl-incog', topBar);
    setStyle(inc, 'display', kind === 'chat' && (id === '_new' || temp) ? '' : 'none');
    inc.classList.toggle('cl-on', temp);
    inc.setAttribute('data-tip', temp ? 'Leave incognito' : 'Incognito chat');
  }
  function openTitleMenu(btn) {
    if (pageKind() !== 'chat' || convId() === '_new' || isTemp()) return;
    const r = btn.getBoundingClientRect();
    const row = currentRow();
    const starred = row && isRowPinned(row);
    const conv = m => () => G.convMenu(m).then(ok => { if (!ok) toast("That isn't available for this chat", 'info'); });
    btn.classList.add('cl-on');
    popup((wrap, close) => wrap.append(menuList([
      { icon: 'star', label: starred ? 'Unstar' : 'Star', run: conv('pin-button') },
      { icon: 'edit', label: 'Rename', run: conv('rename-button') },
      { icon: 'projects', label: 'Add to project', run: conv(/notebook|project/i) },
      { icon: 'download', label: 'Download as PDF', run: conv('download-pdf-button') },
      { icon: 'doc', label: 'Export to Docs', run: conv('export-to-docs-button') },
      '-',
      { icon: 'trash', label: 'Delete', danger: true, run: conv('delete-button') },
    ], close)), r.left, r.bottom + 6, { onClose: () => btn.classList.remove('cl-on') });
  }

  /* =====================================================================
     Search chats (Ctrl+K)
     ===================================================================== */
  function openSearch() {
    if (closeModal) closeModal();
    modal((box, close) => {
      box.classList.add('cl-search');
      const input = h('input', { placeholder: 'Search chats…', spellcheck: 'false', autocomplete: 'off' });
      const list = h('div', { class: 'cl-search-list' });
      let sel = 0, items = [];
      const mark = () => items.forEach((it, i) => it.el.classList.toggle('cl-sel', i === sel));
      const add = (ic, name, meta, run) => {
        const el = h('div', { class: 'cl-search-row' }, icon(ic), h('span', { text: name }), meta ? h('small', { text: meta }) : null);
        const it = { el, run };
        el.addEventListener('mousemove', () => { if (items[sel] !== it) { sel = items.indexOf(it); mark(); } });
        el.addEventListener('click', () => { close(); run(); });
        items.push(it);
        list.append(el);
      };
      const render = () => {
        const q = input.value.trim().toLowerCase();
        items = []; list.replaceChildren();
        if (!q) add('add', 'New chat', '', G.newChat);
        const rows = sidebarRows().filter(r => !q || r.title.toLowerCase().includes(q) || ((DB.prev[r.id] || {}).t || '').toLowerCase().includes(q)).slice(0, q ? 50 : 12);
        if (rows.length) list.append(h('div', { class: 'cl-search-head2', text: q ? 'Chats' : 'Recent chats' }));
        rows.forEach(r => { const ts = r.id && DB.chats[r.id] && DB.chats[r.id].ts; add('chatBubble', r.title, ts ? relTime(ts) : '', () => r.a.click()); });
        if (q) add('search', `Search all messages for “${input.value.trim()}”`, '', () => searchAll(input.value.trim()));
        if (!items.length) list.append(h('div', { class: 'cl-empty', text: 'No chats found' }));
        sel = Math.min(sel, Math.max(0, items.length - 1));
        mark();
      };
      input.addEventListener('input', () => { sel = 0; render(); });
      input.addEventListener('keydown', e => {
        if (!items.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; mark(); items[sel].el.scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + items.length - 1) % items.length; mark(); items[sel].el.scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'Enter') { e.preventDefault(); const it = items[sel]; if (it) { close(); it.run(); } }
      });
      box.append(h('div', { class: 'cl-search-head' }, icon('search'), input, h('span', { class: 'cl-kbd', text: 'Esc' })), list);
      render();
    });
  }
  async function searchAll(q) {
    if (!G.searchChats()) { toast('Search is not available here', 'search'); return; }
    const input = await waitFor(() => $$('input[type="text"], input[type="search"], textarea').find(i => visible(i) && !i.closest('.cl-ui')), 1500);
    if (input) { input.focus(); input.value = q; input.dispatchEvent(new Event('input', { bubbles: true })); }
  }

  /* =====================================================================
     New chat: the greeting
     ===================================================================== */
  function renderGreeting() {
    const host = $('assistant-messages-primary');
    if (!host) return;
    const inner = $('.lm-mobile-sparkle-and-text', host) || $('.content-wrapper', host) || host;
    let g = $('.cl-greet', host);
    if (!g || g.parentElement !== inner) { if (g) g.remove(); g = h('div', { class: 'cl-greet cl-ui' }, icon('spark'), h('span')); inner.prepend(g); }
    setText($('span', g), greeting());
  }

  /* =====================================================================
     Settings (Claude's dialog)
     ===================================================================== */
  let setTab = 'general', geminiState = null, settingsRender = null;
  const SET_TABS = [
    ['h', 'Preferences'], ['general', 'General', 'settings'], ['account', 'Account', 'user'], ['privacy', 'Privacy', 'shield'], ['billing', 'Billing', 'billing'],
    ['usage', 'Usage', 'usage'], ['capabilities', 'Capabilities', 'capabilities'], ['memory', 'Memory', 'memory'],
    ['h', 'Customize'], ['skills', 'Skills', 'doc'], ['connectors', 'Connectors', 'connectors'],
    ['h', 'Help'], ['shortcuts', 'Keyboard shortcuts', 'keyboard'], ['feedback', 'Send feedback', 'feedback'],
  ];
  // Gemini's own pages and dialogs open under this dialog, so close it first
  const go = fn => () => { if (closeModal) closeModal(); setTimeout(fn, 120); };
  function openSettings(tab) {
    if (closePopup) closePopup();
    if (tab) setTab = tab;
    modal((box, close) => {
      box.classList.add('cl-settings');
      const nav = h('div', { class: 'cl-set-nav' });
      const body = h('div', { class: 'cl-set-body' });
      const render = top => {
        const find = h('input', { placeholder: 'Search', spellcheck: 'false' });
        find.addEventListener('input', () => {
          const q = find.value.trim().toLowerCase();
          $$('.cl-set-item', nav).forEach(i => { i.style.display = !q || i.textContent.toLowerCase().includes(q) ? '' : 'none'; });
          $$('.cl-set-h', nav).forEach(x => { x.style.display = q ? 'none' : ''; });
        });
        nav.replaceChildren(h('label', { class: 'cl-set-find' }, icon('search'), find),
          ...SET_TABS.map(([k, l, ic]) => k === 'h' ? h('div', { class: 'cl-set-h', text: l })
            : h('div', { class: 'cl-set-item' + (k === setTab ? ' cl-on' : ''), onclick: () => { if (k === 'feedback') { go(() => G.settings('send-feedback-button'))(); return; } setTab = k; render(true); } },
              icon(ic), h('span', { text: l }), k === 'feedback' ? (() => { const x = icon('extLink'); x.classList.add('cl-ext'); return x; })() : null)));
        body.replaceChildren(...(TABS[setTab] || TABS.general)());
        if (top) body.scrollTop = 0;
      };
      settingsRender = () => { if (box.isConnected) render(); };
      box.append(h('div', { class: 'cl-set-head' }, h('span', { text: 'Settings' }), h('button', { class: 'cl-iconbtn', 'data-tip': 'Close', onclick: close }, icon('close'))), nav, body);
      render(true);
    });
    G.readState().then(s => { if (s) { geminiState = s; if (settingsRender && ['general', 'privacy'].includes(setTab)) settingsRender(); } });
  }
  const row = (label, sub, ctl, run) => {
    const el = h('div', { class: 'cl-row' + (run ? ' cl-click' : '') }, h('div', { class: 'cl-row-t' }, label, sub ? h('small', { text: sub }) : null), ctl || (run ? icon('chevRight') : null));
    if (run) el.addEventListener('click', run);
    return el;
  };
  const toggle = (on, set) => {
    const sw = h('span', { class: 'cl-switch' + (on ? ' cl-on' : '') });
    sw.addEventListener('click', e => { e.stopPropagation(); const v = !sw.classList.contains('cl-on'); sw.classList.toggle('cl-on', v); set(v); });
    return sw;
  };
  function seg(options, cur, pick) {
    const el = h('div', { class: 'cl-seg' });
    for (const [k, label, ic] of options) {
      const b = h('button', { class: k === cur ? 'cl-on' : '', 'data-tip': ic ? label : null, onclick: () => { $$('button', el).forEach(x => x.classList.toggle('cl-on', x === b)); pick(k); } }, ic ? icon(ic) : label);
      el.append(b);
    }
    return el;
  }
  function select(options, cur, pick) {
    const lab = h('span', { text: (options.find(o => o[0] === cur) || options[0])[1] });
    const b = h('button', { class: 'cl-select' }, lab, icon('chevDown'));
    b.addEventListener('click', () => {
      const r = b.getBoundingClientRect();
      popup((wrap, close) => wrap.append(menuList(options.map(([k, l]) => ({ icon: k === cur ? 'check' : 'dot', label: l, cls: k === cur ? '' : 'cl-unsel', run: () => { cur = k; setText(lab, l); pick(k); } })), close)), r.right, r.bottom + 4, { alignRight: true });
    });
    return b;
  }
  function setMode(k) {
    setS('mode', k);
    if (k === 'light') setGeminiTheme(/^light$/i);
    else if (k === 'dark') setGeminiTheme(/^dark$/i);
    else setGeminiTheme(/^system$/i);
  }
  const h4 = t => h('h4', { text: t });
  const desc = t => h('p', { class: 'cl-set-desc', text: t });
  const langLabel = () => { try { const l = (document.documentElement.lang || navigator.language || 'en'); return new Intl.DisplayNames([l], { type: 'language' }).of(l.split('-')[0]); } catch (e) { return 'English'; } };
  const TABS = {
    general: () => [
      h4('Appearance'),
      row('Theme', null, seg([['sync', 'Match system', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']], S.mode, setMode)),
      row('Color', "Neutral is how claude.ai looks today, warm is the classic cream and clay", seg([['neutral', 'Neutral'], ['warm', 'Warm']], S.palette, k => setS('palette', k))),
      row('Response font', null, select([['serif', 'Serif'], ['sans', 'Sans']], S.respFont, k => setS('respFont', k))),
      row('Transcript text size', null, select([['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], S.textSize, k => setS('textSize', k))),
      row('Transcript width', null, select([['narrow', 'Narrow'], ['wide', 'Wide']], S.width, k => setS('width', k))),
      row('Motion', null, select([['system', 'System'], ['reduce', 'Reduced'], ['full', 'Full']], S.motion, k => setS('motion', k))),
      h4('Notifications'),
      row('Desktop notifications', 'When an answer finishes while you are in another tab', toggle(S.notify, v => {
        setS('notify', v);
        if (v && typeof GM_notification !== 'function' && window.Notification && Notification.permission === 'default') Notification.requestPermission();
      })),
      row('Sound', 'A soft chime when an answer lands in the background', toggle(S.sound, v => { setS('sound', v); if (v) ding(); })),
      row('Unread count in the tab title', null, toggle(S.titleCount, v => setS('titleCount', v))),
      h4('Chat'),
      row("Show Gemini's own buttons under answers", 'Copy, retry and thumbs are already in the bar under each answer', toggle(S.geminiButtons, v => setS('geminiButtons', v))),
    ],
    account() {
      const email = G.email();
      return [
        h('div', { class: 'cl-prof' }, userAvatar(48), h('div', {}, h('b', { text: G.name() }), h('span', { text: email || 'Google Account' }))),
        row('Full name', 'Comes from your Google Account', h('button', { class: 'cl-btn cl-sec', text: 'Manage', onclick: G.account })),
        row('Language', null, h('button', { class: 'cl-select', onclick: () => window.open('https://myaccount.google.com/language', '_blank', 'noopener') }, h('span', { text: langLabel() }), icon('extLink'))),
        row('Add another account', null, null, go(G.addAccount)),
        h4('Session'),
        row('Log out of this look', 'Switches back to the normal Gemini interface', h('button', { class: 'cl-btn cl-sec', text: 'Log out', onclick: () => { if (closeModal) closeModal(); confirmLogout(); } })),
      ];
    },
    privacy() {
      const st = geminiState || {};
      const val = x => Array.isArray(x) ? x[0] : (x || '');
      const wm = /^on$/i.test(String(val(st.watermark))) ? 'on' : /^off$/i.test(String(val(st.watermark))) ? 'off' : '';
      return [
        h4('Privacy'),
        desc('Gemini keeps your chats with your Google Account. These open Gemini’s own controls.'),
        row('Gemini Apps Activity', 'Your chat history and what Google keeps', null, go(() => G.settings('desktop-bard-activity-control'))),
        row('Personal Intelligence', 'What Gemini remembers about you', null, go(() => G.settings('personal-intelligence-button'))),
        row('Public links', 'Chats you shared with a link', null, go(() => G.settings('toggle-shared-links-button'))),
        row('Location', val(st.location) || 'Used for local answers', h('button', { class: 'cl-btn cl-sec', text: 'Update', onclick: go(() => G.settings('location-menu-button', /update location/i)) })),
        row('Media watermark', 'A visible mark on images and videos Gemini makes', seg([['on', 'On'], ['off', 'Off']], wm, async k => {
          await G.settings('watermark-button', new RegExp('^' + k + '$', 'i'));
          toast('Media watermark ' + k, 'images');
        })),
      ];
    },
    billing: () => [
      h4('Plan'),
      row('Your plan', plan(), h('button', { class: 'cl-btn cl-clay', text: 'View plans', onclick: go(G.upgrade) })),
      row('Cart and orders', 'Things you bought through Gemini', null, go(() => G.settings('shopping-cart-button'))),
    ],
    usage: () => [
      h4('Usage'),
      desc('How much of each model and tool you have left.'),
      row('Usage limits', null, null, go(() => G.settings('desktop-usage-metrics-button'))),
    ],
    capabilities: () => [
      h4('Capabilities'),
      row('Gems', 'Custom versions of Gemini for specific jobs', null, go(() => G.settings('desktop-gems-manager-settings-button'))),
      row('Avatar', 'How Gemini looks to you', null, go(() => G.settings('likeness-button'))),
      row('Developer mode', 'Gemini’s own developer options', null, go(() => G.settings(/developer mode/i))),
      row('Canvas', 'Start a new chat with the Canvas tool on', null, go(openCanvas)),
    ],
    memory: () => [
      h4('Memory'),
      row('Personal Intelligence', 'What Gemini remembers across chats', null, go(() => G.settings('personal-intelligence-button'))),
      row('Import memory', 'Bring over what other assistants know about you', null, go(() => G.settings('import-hub-settings-button'))),
      row('Personal context', 'Saved info and instructions', null, go(G.customize)),
    ],
    skills: () => [
      h4('Skills'),
      desc('Things you taught Gemini to do for you.'),
      row('Manage skills', null, null, go(() => G.settings(/^skills$/i))),
    ],
    connectors: () => [
      h4('Connectors'),
      desc('Apps Gemini can use for you, like Gmail, Drive, Maps and YouTube. Type @ in the message box to use one.'),
      row('Connected apps', null, null, go(() => G.settings(/^(apps|connected apps|extensions)/i).then(ok => { if (!ok) location.href = '/apps'; }))),
    ],
    shortcuts() {
      const k = (...keys) => h('span', {}, keys.map(x => h('span', { class: 'cl-kbd', text: x })));
      return [h4('Keyboard shortcuts'),
        row('Search chats', null, k('Ctrl', 'K')), row('New chat', null, k('Ctrl', 'Shift', 'O')), row('Settings', null, k('Ctrl', 'Shift', ',')),
        row('Toggle sidebar', null, k('Ctrl', '.')), row('Edit your last message', null, k('↑')), row('Dictate', null, k('Ctrl', 'Shift', 'D')), row('Close dialogs and menus', null, k('Esc'))];
    },
  };

  /* =====================================================================
     Messages: Claude's bars under prompts and answers
     ===================================================================== */
  let MSGS = [];
  const RE_EDIT = /edit/i, RE_REDO = /redo|regenerate|try again|retry/i, RE_TTS = /listen|read aloud|text.?to.?speech|tts/i, RE_SHARE = /share|export/i,
    RE_UP = /good response|thumb.?up|like/i, RE_DOWN = /bad response|thumb.?down|dislike/i;
  const clickMsg = (msg, re) => { const b = msgBtn(msg, re); if (b) { b.click(); return true; } return false; };
  const pressed = b => !!b && (b.getAttribute('aria-pressed') === 'true' || /selected|active|pressed/.test(b.className) || !!b.querySelector('[class*="selected"], [class*="filled"]'));
  function flashCopied(btn) {
    btn.replaceChildren(icon('check'));
    btn.setAttribute('data-tip', 'Copied!');
    setTimeout(() => { btn.replaceChildren(icon('copy')); btn.setAttribute('data-tip', 'Copy'); }, 1500);
  }
  function shortTime(ts) {
    const d = new Date(ts), now = new Date();
    return d.toDateString() === now.toDateString() ? fmtTime(ts) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + fmtTime(ts);
  }
  function decorate(msg) {
    const { el, role } = msg;
    const ts = msgTime(msg);
    if (role === 'u') {
      let ua = $(':scope > .cl-uacts', el);
      if (!ua) {
        ua = h('div', { class: 'cl-uacts cl-ui' }, h('time'),
          h('button', { class: 'cl-abtn', 'data-tip': 'Copy', onclick: e => { e.stopPropagation(); copy(userText(el).body); flashCopied(e.currentTarget); } }, icon('copy')),
          h('button', { class: 'cl-abtn cl-ua-edit', 'data-tip': 'Edit', onclick: e => { e.stopPropagation(); const m = MSGS.find(x => x.el === el); if (m) clickMsg(m, RE_EDIT); } }, icon('edit')));
        el.append(ua);
      }
      const t = $('time', ua), s = ts ? shortTime(ts) : '';
      if (t.textContent !== s) { setText(t, s); t.setAttribute('data-tip', ts ? fmtFull(ts) : ''); }
      setStyle($('.cl-ua-edit', ua), 'display', msgBtn(msg, RE_EDIT) ? '' : 'none');
      return;
    }
    let acts = $(':scope > .cl-acts', el);
    if (!acts) {
      const find = () => MSGS.find(x => x.el === el);
      const btn = (tip, ic, run, cls) => h('button', { class: 'cl-abtn' + (cls ? ' ' + cls : ''), 'data-tip': tip, onclick: e => { e.stopPropagation(); const m = find(); if (m) run(e.currentTarget, m); } }, icon(ic));
      acts = h('div', { class: 'cl-acts cl-ui' },
        btn('Copy', 'copy', (b, m) => { copy(m.text); flashCopied(b); }),
        btn('Read aloud', 'speaker', (b, m) => { if (!clickMsg(m, RE_TTS)) speak(m.text); }),
        btn('Good response', 'thumbUp', (b, m) => { clickMsg(m, RE_UP); setTimeout(schedule, 300); }, 'cl-up'),
        btn('Bad response', 'thumbDown', (b, m) => { clickMsg(m, RE_DOWN); setTimeout(schedule, 300); }, 'cl-down'),
        btn('Share', 'share', (b, m) => { if (!clickMsg(m, RE_SHARE)) shareChat(); }),
        h('button', { class: 'cl-retry', 'data-tip': 'Retry', onclick: e => { e.stopPropagation(); const m = find(); if (!m || !clickMsg(m, RE_REDO)) toast("Retry isn't available for this answer", 'retry'); } }, icon('retry'), 'Retry'),
        h('span', { class: 'cl-acts-sp' }),
        h('time', { class: 'cl-acts-note' }));
      el.append(acts);
    } else if (acts !== el.lastElementChild) el.append(acts);
    acts.classList.toggle('cl-last', !!msg.last);
    setStyle(acts, 'display', msg.last && msg.generating ? 'none' : '');
    $('.cl-up', acts).classList.toggle('cl-on', pressed(msgBtn(msg, RE_UP)));
    $('.cl-down', acts).classList.toggle('cl-on', pressed(msgBtn(msg, RE_DOWN)));
    const t = $('time', acts), s = ts ? shortTime(ts) : '';
    if (t.textContent !== s) { setText(t, s); t.setAttribute('data-tip', ts ? fmtFull(ts) : ''); }
  }

  /* the message box: placeholder, disclaimer */
  function decorateComposer(zero) {
    const field = $('input-area-v2 .text-input-field');
    if (field && !$(':scope > .cl-note', field)) {
      $$('.cl-note', field).forEach(n => n.remove());
      field.append(h('div', { class: 'cl-note cl-ui', text: 'Gemini is AI and can make mistakes. Please double-check responses.' }));
    }
    const area = $('input-area-v2');
    if (area) {
      const ph = zero ? 'How can I help you today?' : 'Reply…';
      if (area.dataset.ph !== ph) { area.dataset.ph = ph; area.style.setProperty('--cl-ph', JSON.stringify(ph)); }
    }
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
    try { return fn(); } catch (e) { if (!warned[name]) { warned[name] = 1; console.warn('[Gemini·Claude] ' + name + ':', e); } return undefined; }
  }
  function scan() {
    if (disposed) return;
    lastScan = Date.now();
    if (!document.body) return;
    document.body.classList.add('cl-on');
    applyVars();
    if (!topBar || !topBar.isConnected) safe('top0', buildTop);

    const id = convId();
    if (lastConv !== id) safe('switch', () => { if (DB.unread[id]) { delete DB.unread[id]; save(); } });
    if (lastConv !== id) lastConv = id;
    MSGS = safe('read', getMessages) || [];
    const gen = !!safe('gen', isGenerating);
    const c = C();
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
          if (live && live.u && !live.m && now - live.u < 10 * 60e3) live.m = now;
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
    safe('preview', () => {
      if (id === '_new' || !MSGS.length) return;
      const last = MSGS[MSGS.length - 1];
      if (gen && last.role !== 'u') return;
      const t = snip(cleanMd(last.text), 90), ts = msgTime(last) || (DB.prev[id] && DB.prev[id].ts) || null;
      const p = DB.prev[id];
      if (t && (!p || p.t !== t || p.r !== last.role || (ts && p.ts !== ts))) { DB.prev[id] = { t, r: last.role, ts }; dirty = true; }
      if (ts) { const ch = DB.chats[id] || (DB.chats[id] = {}); if (!ch.ts || ts > ch.ts) { ch.ts = ts; dirty = true; } }
    });
    if (dirty) save();

    const kind = pageKind();
    const zero = kind === 'chat' && id === '_new' && !MSGS.length;
    document.body.classList.toggle('cl-zero', zero);
    document.body.classList.toggle('cl-page', kind !== 'chat');
    const title = safe('title', currentTitle) || 'Gemini';
    safe('layout', () => {
      const side = $('bard-sidenav');
      const sr = side ? side.getBoundingClientRect() : null;
      const open = !!(sr && sr.width > 120);
      document.body.classList.toggle('cl-side-closed', !open);
      setStyle(topBar, 'left', (open ? Math.round(sr.right) : 0) + 'px');
    });
    safe('top', () => renderTop(title, kind, id));
    if (wasGenerating && !gen) safe('done', () => answerDone(title, id));
    wasGenerating = gen;
    safe('sidebar', () => decorateSidebar(gen));
    safe('greeting', () => { if (zero && !isTemp()) renderGreeting(); });
    safe('composer', () => decorateComposer(zero));
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
  document.addEventListener('contextmenu', e => {
    if (e.shiftKey || !document.body.classList.contains('cl-on')) return;
    const rowEl = e.target.closest && e.target.closest('gem-nav-list-item[data-test-id="conversation"]');
    if (!rowEl) return;
    const r = sidebarRows().find(x => x.item === rowEl);
    if (r) { e.preventDefault(); openRowMenu(r, e.clientX, e.clientY); }
  }, LC);
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button');
    if (b && b === sendButton() && !b.closest('.cl-ui')) noteSend();
  }, LC);
  window.addEventListener('keydown', e => {
    const inEditor = e.target.closest && e.target.closest('.ql-editor');
    const key = (e.key || '').toLowerCase();
    if (e.key === 'Escape' && e.isTrusted) {
      if (closePopup) { closePopup(); return; }
      if (closeModal) { closeModal(); return; }
      if (window.speechSynthesis && speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'k') { e.preventDefault(); e.stopPropagation(); openSearch(); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === ',' || key === '<')) { e.preventDefault(); openSettings(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === '.') { e.preventDefault(); toggleSidebar(); return; }
    if (!inEditor) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) noteSend();
    if (e.key === 'ArrowUp' && !editorText().trim()) {
      const last = [...MSGS].reverse().find(m => m.role === 'u');
      const b = last && msgBtn(last, RE_EDIT);
      if (b) { e.preventDefault(); b.click(); }
    }
  }, LC);
  window.addEventListener('resize', schedule, L);

  let mainObserver = null, mainTimer = 0;
  const ours = n => n.nodeType === 1 && (n.classList.contains('cl-ui') || n.id === 'cl-toast' || n.id === 'cl-tip');
  function start() {
    if (disposed) return;
    mainObserver = new MutationObserver(muts => {
      for (const m of muts) {
        const t = m.target;
        if (t && t.nodeType === 1 && (t.closest('.cl-ui') || t.id === 'cl-toast')) continue;
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
    if (W.__clOnRpc === onRpcText) W.__clOnRpc = null;
    $$('#cl-top, #cl-nav, #cl-acct, #cl-resizer, #cl-tip, #cl-toast, .cl-side-head, .cl-sec, .cl-row-more, .cl-row-dot, .cl-uacts, .cl-acts, .cl-note, .cl-greet, .cl-menu.cl-sub').forEach(e => e.remove());
    const marks = ['cl-row-on', 'cl-row-ctx', 'cl-collapsed-row', 'cl-flash'];
    $$(marks.map(m => '.' + m).join(',')).forEach(e => e.classList.remove(...marks));
    $$('[data-tip-card]').forEach(a => { a.removeAttribute('data-tip'); a.removeAttribute('data-tip-side'); a.removeAttribute('data-tip-card'); a.removeAttribute('data-tip-delay'); });
    const area = $('input-area-v2'); if (area) { area.style.removeProperty('--cl-ph'); delete area.dataset.ph; }
    for (const v of ['--cl-resp-size', '--cl-col', '--cl-side-w']) document.documentElement.style.removeProperty(v);
    if (styleEl) styleEl.remove();
    if (document.body) document.body.classList.remove('cl-on', 'cl-light', 'cl-warm', 'cl-sans', 'cl-still', 'cl-hide-gemini-actions', 'cl-zero', 'cl-page', 'cl-side-closed', 'cl-ghost', 'cl-resizing');
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, L);
})();
