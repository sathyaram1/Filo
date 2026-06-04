// Gestione cookie / consenso — lato pagina (content script).
//
// Vive sulle pagine web esterne (page-preload.js, mondo isolato). Si occupa
// delle due cose che si possono fare solo dal DOM della pagina:
//
//   1) Rifiuto automatico dei banner CMP ("Consent Management Platform"):
//      OneTrust, Cookiebot, Didomi, Quantcast/TCF, Sourcepoint, Usercentrics,
//      CookieYes, Iubenda, TrustArc, Osano, Complianz, Termly, ... Cerchiamo il
//      pulsante "rifiuta tutto" e lo premiamo. Se il CMP nasconde il rifiuto
//      dietro "Impostazioni", apriamo il pannello e poi rifiutiamo lì dentro.
//
//   2) Riscrittura degli embed YouTube in youtube-nocookie.com (privacy-enhanced
//      mode): nessun cookie finché l'utente non preme play.
//
// Tutto è guidato dalla modalità (settings.security.cookies.mode):
//   - 'manual'  → inattivo (banner mostrati normalmente).
//   - 'default' → attivo.
//   - 'privacy' → attivo (uguale a default qui; l'isolamento del jar è lato main).
//
// GPC (navigator.globalPrivacyControl + header Sec-GPC) NON sta qui: la
// proprietà è iniettata da tabs.js nel main world, l'header da services/cookies.js.

(function (global) {
  'use strict';

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const T_GET = MSG.COOKIES_CONFIG || 'cookies_config';
  const T_UPDATE = MSG.COOKIES_CONFIG_UPDATE || 'cookies_config_update';

  const chrome = global.chrome;
  function send(msg, cb) {
    try { chrome.runtime.sendMessage(msg, cb); } catch (_) { if (cb) cb(null); }
  }

  let mode = 'default';   // finché non arriva la config dal main
  let active = false;     // CMP-reject + nocookie attivi?
  let observer = null;
  const openedSettings = new Set(); // CMP per cui abbiamo già aperto "Impostazioni"

  // ─── util ──────────────────────────────────────────────────────────────────

  function isVisible(el) {
    if (!el) return false;
    try {
      if (el.disabled) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      if (parseFloat(s.opacity || '1') < 0.1) return false;
      return true;
    } catch (_) { return false; }
  }

  function clickEl(el) {
    if (!el || el.__filoCookieClicked || !isVisible(el)) return false;
    el.__filoCookieClicked = true;
    try { el.click(); return true; } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch (_) {}
    return false;
  }

  // querySelector che entra anche negli shadow root aperti dei root indicati.
  // Alcuni CMP (Usercentrics) montano l'UI dentro uno shadow DOM, irraggiungibile
  // con un querySelector classico.
  function queryIn(root, selectors) {
    for (const sel of selectors) {
      let el = null;
      try { el = root.querySelector(sel); } catch (_) {}
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function shadowRootsOf(ids) {
    const roots = [];
    for (const id of ids) {
      const host = document.getElementById(id);
      if (host && host.shadowRoot) roots.push(host.shadowRoot);
    }
    return roots;
  }

  // ─── ruleset CMP ─────────────────────────────────────────────────────────
  //
  // Per ogni CMP: `reject` = selettori del pulsante "rifiuta tutto" diretto.
  // `openSettings` = selettore per aprire il pannello impostazioni quando il
  // rifiuto non è in prima battuta. `rejectInSettings` = rifiuto dentro al
  // pannello. `shadowHosts` = id di host shadow-DOM in cui cercare.

  const CMPS = [
    {
      name: 'OneTrust',
      reject: ['#onetrust-reject-all-handler', '.ot-pc-refuse-all-handler', 'button.ot-pc-refuse-all-handler'],
      openSettings: ['#onetrust-pc-btn-handler', '.ot-sdk-show-settings'],
      rejectInSettings: ['.ot-pc-refuse-all-handler', '#onetrust-reject-all-handler'],
    },
    {
      name: 'Cookiebot',
      reject: [
        '#CybotCookiebotDialogBodyButtonDecline',
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
        '#CybotCookiebotDialogBodyButtonDeclineAll',
      ],
    },
    {
      name: 'Didomi',
      reject: [
        '#didomi-notice-disagree-button',
        'button#didomi-notice-disagree-button',
        '.didomi-continue-without-agreeing',
        'button[aria-label="Disagree to our data processing and close"]',
      ],
    },
    {
      name: 'Quantcast',
      reject: [
        '.qc-cmp2-summary-buttons button[mode="secondary"]',
        '.qc-cmp2-buttons-desktop button[mode="secondary"]',
      ],
    },
    {
      name: 'Sourcepoint',
      reject: [
        'button.sp_choice_type_REJECT_ALL',
        '.message-component button.sp_choice_type_13',
        'button[title="Reject All"]',
        'button[aria-label="Reject All"]',
      ],
    },
    {
      name: 'Usercentrics',
      shadowHosts: ['usercentrics-root', 'usercentrics-cmp-ui'],
      reject: [
        'button[data-testid="uc-deny-all-button"]',
        '#uc-btn-deny-banner',
        'button.uc-deny-button',
        'button[data-testid="uc-deny-all-button"]',
      ],
    },
    {
      name: 'CookieYes',
      reject: ['.cky-btn-reject', '[data-cky-tag="reject-button"]'],
    },
    {
      name: 'Iubenda',
      reject: ['.iubenda-cs-reject-btn', '#iubenda-cs-reject-btn'],
    },
    {
      name: 'TrustArc',
      reject: ['#truste-consent-required', '.trustarc-banner-container .required'],
    },
    {
      name: 'Osano',
      reject: ['.osano-cm-denyAll', 'button.osano-cm-button--type_denyAll'],
    },
    {
      name: 'Complianz',
      reject: ['.cmplz-deny', 'button.cmplz-deny', '.cc-deny'],
    },
    {
      name: 'Termly',
      reject: ['[data-tid="banner-decline"]', '.t-declineAllButton'],
    },
    {
      name: 'Borlabs',
      reject: ['._brlbs-refuse-btn a', '._brlbs-refuse-btn', '.brlbs-cmpnt-cookie-box ._brlbs-btn-cookie-refuse'],
    },
  ];

  // Frasi di rifiuto (fallback testuale, multilingua) — usate SOLO dentro
  // contenitori che sembrano un banner cookie, per non premere pulsanti a caso.
  const REJECT_PHRASES = [
    'reject all', 'reject', 'decline all', 'decline', 'refuse all', 'refuse',
    'deny', 'rifiuta tutto', 'rifiuta', 'rifiuto', 'non accetto', 'continua senza accettare',
    'continue without accepting', 'tout refuser', 'refuser', 'ablehnen', 'alle ablehnen',
    'rechazar', 'rechazar todo', 'reject non-essential', 'only necessary', 'solo necessari',
  ];
  // Container che hanno l'aria di un consenso cookie (per limitare il fallback).
  const CONSENT_HINT = /(cookie|consent|gdpr|cmp|privacy|consenso|cmpwrapper|didomi|onetrust|cybot|qc-cmp|sp_message|usercentrics|iubenda|truste)/i;

  function looksLikeConsent(el) {
    let n = el;
    for (let i = 0; i < 6 && n && n !== document.body; i++) {
      const id = (n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : '');
      if (CONSENT_HINT.test(id)) return true;
      n = n.parentElement;
    }
    return false;
  }

  // Fallback testuale: cerca un button/link con testo di rifiuto dentro un
  // contenitore di consenso. Conservativo per costruzione.
  function textRejectFallback(roots) {
    for (const root of roots) {
      let nodes = [];
      try { nodes = root.querySelectorAll('button, a[role="button"], [role="button"], a'); } catch (_) {}
      for (const el of nodes) {
        if (!isVisible(el) || el.__filoCookieClicked) continue;
        const txt = (el.textContent || '').trim().toLowerCase();
        if (!txt || txt.length > 40) continue;
        if (!REJECT_PHRASES.some((p) => txt === p || txt.startsWith(p))) continue;
        if (!looksLikeConsent(el)) continue;
        return el;
      }
    }
    return null;
  }

  // Un giro di rifiuto su tutti i root (document + shadow root noti).
  function tryReject() {
    const extraRoots = [];
    for (const cmp of CMPS) {
      if (cmp.shadowHosts) extraRoots.push(...shadowRootsOf(cmp.shadowHosts));
    }
    const roots = [document, ...extraRoots];

    for (const cmp of CMPS) {
      const searchRoots = cmp.shadowHosts ? [document, ...shadowRootsOf(cmp.shadowHosts)] : [document];
      // 1) rifiuto diretto
      for (const root of searchRoots) {
        const btn = queryIn(root, cmp.reject);
        if (btn && clickEl(btn)) return true;
      }
      // 2) apri impostazioni → rifiuta dentro
      if (cmp.openSettings && cmp.rejectInSettings) {
        if (!openedSettings.has(cmp.name)) {
          for (const root of searchRoots) {
            const inSettings = queryIn(root, cmp.rejectInSettings);
            if (inSettings && clickEl(inSettings)) return true;
            const open = queryIn(root, cmp.openSettings);
            if (open && clickEl(open)) { openedSettings.add(cmp.name); return true; }
          }
        } else {
          for (const root of searchRoots) {
            const inSettings = queryIn(root, cmp.rejectInSettings);
            if (inSettings && clickEl(inSettings)) return true;
          }
        }
      }
    }
    // 3) fallback testuale
    const fb = textRejectFallback(roots);
    if (fb && clickEl(fb)) return true;
    return false;
  }

  // ─── riscrittura embed YouTube → nocookie ──────────────────────────────────

  function nocookieUrl(src) {
    try {
      const u = new URL(src, location.href);
      if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return null;
      if (!/^\/embed\//i.test(u.pathname)) return null;
      u.hostname = u.hostname.replace(/(^|\.)youtube\.com$/i, (m) => m.replace('youtube.com', 'youtube-nocookie.com'));
      return u.toString();
    } catch (_) { return null; }
  }

  function rewriteYouTube(root) {
    let frames = [];
    try { frames = root.querySelectorAll('iframe[src]'); } catch (_) { return; }
    for (const f of frames) {
      if (f.__filoNocookie) continue;
      const next = nocookieUrl(f.getAttribute('src') || '');
      if (next && next !== f.src) {
        f.__filoNocookie = true;
        try { f.src = next; } catch (_) {}
      }
    }
  }

  // ─── scan + observer ────────────────────────────────────────────────────────

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    const run = () => { scanScheduled = false; scan(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function scan() {
    if (!active) return;
    try { tryReject(); } catch (_) {}
    try { rewriteYouTube(document); } catch (_) {}
  }

  function startObserver() {
    if (observer) return;
    try {
      observer = new MutationObserver(() => scheduleScan());
      observer.observe(document.documentElement || document, { childList: true, subtree: true });
    } catch (_) {}
  }

  function stopObserver() {
    if (observer) { try { observer.disconnect(); } catch (_) {} observer = null; }
  }

  function setActive(on) {
    if (on === active) { if (on) scheduleScan(); return; }
    active = on;
    if (on) {
      startObserver();
      scheduleScan();
      // Alcuni CMP montano il banner con ritardo (lazy / dopo consenso TCF):
      // ripassiamo qualche volta nei primi secondi anche senza mutazioni utili.
      let n = 0;
      const t = setInterval(() => { if (!active || ++n > 12) { clearInterval(t); return; } scan(); }, 700);
    } else {
      stopObserver();
      openedSettings.clear();
    }
  }

  function applyMode(m) {
    mode = (m === 'manual' || m === 'privacy') ? m : 'default';
    setActive(mode !== 'manual');
  }

  // ─── bootstrap ───────────────────────────────────────────────────────────

  // Aggiorna a caldo quando l'utente cambia modalità nelle impostazioni.
  try {
    chrome.runtime.onMessage.addListener((m) => {
      if (m && m.type === T_UPDATE) applyMode(m.mode);
    });
  } catch (_) {}

  function start() {
    send({ type: T_GET }, (r) => {
      applyMode(r && r.ok ? r.mode : 'default');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  global.SN_COOKIES_CS = { applyMode, tryReject, rewriteYouTube, nocookieUrl, _state: () => ({ mode, active }) };
})(typeof globalThis !== 'undefined' ? globalThis : self);
