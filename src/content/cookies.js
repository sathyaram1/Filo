// Cookie e consenso, lato pagina: rifiuta i banner dei CMP, nasconde quelli senza «rifiuta», riscrive gli embed YouTube.
// Gira in ogni frame http(s), riquadri compresi (lì solo rifiuto e YouTube: nascondere e sbloccare spetta alla pagina).
// Modalità in settings.security.cookies (manuale = spento); GPC, blocco tracker e partizioni stanno in services/cookies.js.

(function (global) {
  'use strict';

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const T_GET = MSG.COOKIES_CONFIG || 'cookies_config';
  const T_UPDATE = MSG.COOKIES_CONFIG_UPDATE || 'cookies_config_update';
  const T_RULE = MSG.COOKIES_RULE || 'cookies_rule';
  const T_OUTCOME = MSG.COOKIES_OUTCOME || 'cookies_outcome';
  const T_TOKENS = MSG.COOKIES_BANNER_TOKENS || 'cookies_banner_tokens';
  const T_FRAME = MSG.COOKIES_FRAME_BANNER || 'cookies_frame_banner';
  const T_HIDE_FRAME = MSG.COOKIES_HIDE_FRAME || 'cookies_hide_frame';
  const T_ACCESSO = MSG.COOKIES_ACCESSO || 'cookies_accesso';

  const IS_TOP = (() => { try { return window.top === window.self; } catch (_) { return false; } })();

  const chrome = global.chrome;
  function send(msg, cb) {
    try { chrome.runtime.sendMessage(msg, cb); } catch (_) { if (cb) cb(null); }
  }
  function ask(msg) {
    return new Promise((resolve) => send(msg, (r) => resolve(r || null)));
  }

  let mode = 'default';   // finché non arriva la config dal main
  let active = false;     // gestione automatica accesa (non manuale)
  let banners = false;    // rifiuto/occultamento accesi su questo sito (l'utente non ha chiesto di vedere i banner)
  let cfg = null;
  let observer = null;
  let huntTimer = null;
  const openedSettings = new Set(); // CMP per cui abbiamo già aperto "Impostazioni"
  let lastActionAt = 0;
  const reported = new Set();

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
    lastActionAt = Date.now();
    const base = answerBase();
    let ok = false;
    try { el.click(); ok = true; } catch (_) {}
    if (!ok) {
      try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); ok = true; } catch (_) {}
    }
    answerAfter(base, true);
    return ok;
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

  function existsIn(root, selectors) {
    for (const sel of selectors) {
      try { if (root.querySelector(sel)) return true; } catch (_) {}
    }
    return false;
  }

  function shadowRootsOf(ids) {
    const roots = [];
    for (const id of ids) {
      const host = document.getElementById(id);
      if (host && host.shadowRoot) roots.push(host.shadowRoot);
    }
    return roots;
  }

  // ─── la risposta che il sito si scrive dopo un clic sul banner ──────────────
  //
  // «Mostra il banner» e «Rifiuta in automatico» devono togliere la risposta, qualunque nome le dia il sito.
  // La risposta è quello che il clic CREA mentre il sito lo gestisce: cookie e chiavi della pagina che prima
  // non c'erano. Quello che c'era già (stato dell'applicazione, accesso) o nasce più tardi resta del sito (#754).

  function cookieNames() {
    const out = new Set();
    let raw = '';
    try { raw = document.cookie || ''; } catch (_) {}
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      const k = (i < 0 ? part : part.slice(0, i)).trim();
      if (k) out.add(k);
    }
    return out;
  }

  function memoryNames() {
    const out = new Set();
    try { for (let i = 0; i < localStorage.length && i < 2000; i++) out.add(localStorage.key(i)); } catch (_) {}
    return out;
  }

  const answerSent = new Set();

  function answerBase() {
    return IS_TOP ? { c: cookieNames(), s: memoryNames() } : null;
  }

  function created(base, now, tag) {
    const out = [];
    for (const k of now) {
      if (base.has(k) || k.length > 200 || answerSent.has(tag + k)) continue;
      answerSent.add(tag + k);
      out.push(k);
    }
    return out;
  }

  function reportCreated(base) {
    const cookies = created(base.c, cookieNames(), 'c:');
    const storage = created(base.s, memoryNames(), 's:');
    if (cookies.length || storage.length) {
      send({ type: T_OUTCOME, outcome: 'answer', cookies: cookies.slice(0, 20), storage: storage.slice(0, 20) });
    }
  }

  // I gestori del sito girano dentro click(); promesse e rinvii a zero finiscono prima del giro dopo.
  function answerAfter(base, now) {
    if (!base) return;
    if (now) reportCreated(base);
    setTimeout(() => reportCreated(base), 0);
  }

  // Coi banner mostrati la risposta la dà l'utente: stessa regola, dal suo clic dentro al banner.
  function onUserClick(e) {
    if (!active || banners || !e || !e.isTrusted) return;
    const t = e.target && e.target.nodeType === 1 ? e.target : null;
    if (t && looksLikeConsent(t)) answerAfter(answerBase(), false);
  }

  // ─── ruleset CMP scritto a mano ─────────────────────────────────────────────
  //
  // Per ogni CMP: `reject` = selettori del pulsante "rifiuta tutto" diretto.
  // `openSettings` = selettore per aprire il pannello impostazioni quando il
  // rifiuto non è in prima battuta. `rejectInSettings` = rifiuto dentro al
  // pannello. `shadowHosts` = id di host shadow-DOM in cui cercare.
  // `com` = regole Consent-O-Matic dello stesso CMP: dove questa lo trova, quelle non partono.
  // `hide` = il contenitore da nascondere quando non c'è un rifiuto, anche se la lista non lo nomina.

  const CMPS = [
    {
      name: 'OneTrust',
      reject: ['#onetrust-reject-all-handler', '.ot-pc-refuse-all-handler', 'button.ot-pc-refuse-all-handler'],
      openSettings: ['#onetrust-pc-btn-handler', '.ot-sdk-show-settings'],
      rejectInSettings: ['.ot-pc-refuse-all-handler', '#onetrust-reject-all-handler'],
      // «Impostazioni cookie» resta nel piè di pagina anche dopo la risposta: si apre solo col banner a schermo.
      showing: ['#onetrust-banner-sdk'],
      // L'involucro tiene banner, pannello e velo: aperto il pannello senza «Rifiuta tutto», va via tutto insieme.
      hide: ['#onetrust-consent-sdk'],
      com: ['onetrust', 'onetrust_banner', 'onetrust_pcpanel', 'onetrust_pctab', 'onetrust-stackoverflow', 'optanon', 'optanon-alternative', 'optanon_springernature'],
    },
    {
      name: 'Cookiebot',
      reject: [
        '#CybotCookiebotDialogBodyButtonDecline',
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
        '#CybotCookiebotDialogBodyButtonDeclineAll',
      ],
      com: ['cookiebot'],
    },
    {
      name: 'Didomi',
      reject: [
        '#didomi-notice-disagree-button',
        'button#didomi-notice-disagree-button',
        '.didomi-continue-without-agreeing',
        'button[aria-label="Disagree to our data processing and close"]',
      ],
      com: ['didomi.io'],
    },
    {
      name: 'Quantcast',
      reject: [
        '.qc-cmp2-summary-buttons button[mode="secondary"]',
        '.qc-cmp2-buttons-desktop button[mode="secondary"]',
      ],
      com: ['quantcast', 'quantcast2', 'quantcast2b'],
    },
    {
      name: 'Sourcepoint',
      reject: [
        'button.sp_choice_type_REJECT_ALL',
        '.message-component button.sp_choice_type_13',
        'button[title="Reject All"]',
        'button[aria-label="Reject All"]',
      ],
      com: ['sourcepoint', 'sourcepointframe', 'sourcepoint_frame_2022', 'sourcepointpopup'],
    },
    {
      // Il riquadro del consenso di Google (Funding Choices): «Non acconsento» c'è solo se il sito lo attiva.
      name: 'Google',
      reject: ['.fc-consent-root .fc-cta-do-not-consent'],
      hide: ['.fc-consent-root'],
      com: ['bbc_fc'],
    },
    {
      name: 'Usercentrics',
      shadowHosts: ['usercentrics-root', 'usercentrics-cmp-ui'],
      reject: [
        'button[data-testid="uc-deny-all-button"]',
        '#uc-btn-deny-banner',
        'button.uc-deny-button',
      ],
      com: ['usercentrics'],
    },
    {
      name: 'CookieYes',
      reject: ['.cky-btn-reject', '[data-cky-tag="reject-button"]'],
    },
    {
      name: 'Iubenda',
      reject: ['.iubenda-cs-reject-btn', '#iubenda-cs-reject-btn'],
      com: ['iubuenda'],
    },
    {
      name: 'TrustArc',
      reject: ['#truste-consent-required', '.trustarc-banner-container .required'],
      com: ['trustarcbar', 'trustarcframe', 'trustarc_popup_hider'],
    },
    {
      name: 'Osano',
      reject: ['.osano-cm-denyAll', 'button.osano-cm-button--type_denyAll'],
      com: ['osano'],
    },
    {
      name: 'Complianz',
      reject: ['.cmplz-deny', 'button.cmplz-deny', '.cc-deny'],
      com: ['complianz'],
    },
    {
      name: 'Termly',
      reject: ['[data-tid="banner-decline"]', '.t-declineAllButton'],
    },
    {
      name: 'Borlabs',
      reject: ['._brlbs-refuse-btn a', '._brlbs-refuse-btn', '.brlbs-cmpnt-cookie-box ._brlbs-btn-cookie-refuse'],
      com: ['BorlabsCookieBox'],
    },
  ];

  // Frasi di rifiuto (fallback testuale, multilingua) — usate SOLO dentro
  // contenitori che sembrano un banner cookie, per non premere pulsanti a caso.
  const REJECT_PHRASES = [
    'reject all', 'reject', 'decline all', 'decline', 'refuse all', 'refuse',
    'deny', 'rifiuta tutto', 'rifiuta', 'rifiuto', 'non accetto', 'continua senza accettare',
    'continue without accepting', 'tout refuser', 'refuser', 'ablehnen', 'alle ablehnen',
    'rechazar', 'rechazar todo', 'reject non-essential', 'only necessary', 'solo necessari',
    'non acconsento', 'do not consent',
  ];

  const HAND_HIDE = CMPS.flatMap((c) => c.hide || []);
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

  // «Rifiuta e abbonati» porta alla pagina dell'abbonamento: non è un rifiuto, è l'altra metà di un banner da nascondere.
  const NOT_A_REJECT = /(abbona|abbonati|subscri|abonn|suscri|assin|premium|paga|pay|acquista|compra|buy|accedi|login|log in|sign in|registr)/i;

  function isRejectText(el) {
    const txt = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!txt || txt.length > 40) return false;
    if (!REJECT_PHRASES.some((p) => txt === p || txt.startsWith(p))) return false;
    return !NOT_A_REJECT.test(txt);
  }

  // Un «rifiuta» che porta a un'altra pagina non è il tasto del banner: premerlo porterebbe via l'utente.
  function leavesPage(a) {
    if (a.target === '_blank') return true;
    const href = (a.getAttribute('href') || '').trim();
    if (!href || href[0] === '#' || /^javascript:/i.test(href)) return false;
    try {
      const u = new URL(href, location.href);
      return u.origin !== location.origin || u.pathname !== location.pathname || u.search !== location.search;
    } catch (_) { return true; }
  }

  // Un button/link con testo di rifiuto. Dentro `root` qualsiasi; nel resto della pagina solo se
  // sta in un contenitore di consenso. Conservativo per costruzione.
  function findRejectText(root, inConsentBox) {
    let nodes = [];
    try { nodes = root.querySelectorAll('button, a[role="button"], [role="button"], a, input[type="button"], input[type="submit"]'); } catch (_) {}
    for (const el of nodes) {
      if (el.__filoCookieClicked) continue;
      const probe = el.tagName === 'INPUT' ? { textContent: el.value } : el;
      if (!isRejectText(probe)) continue;
      if (el.tagName === 'A' && leavesPage(el)) continue;
      if (!inConsentBox && !looksLikeConsent(el)) continue;
      if (!isVisible(el)) continue;
      return el;
    }
    return null;
  }

  // CMP scritti a mano presenti in pagina (anche nascosti): le loro regole Consent-O-Matic stanno ferme.
  function handPresent() {
    const skip = new Set();
    let any = false;
    for (const cmp of CMPS) {
      const roots = cmp.shadowHosts ? [document, ...shadowRootsOf(cmp.shadowHosts)] : [document];
      const sels = [...cmp.reject, ...(cmp.openSettings || []), ...(cmp.rejectInSettings || [])];
      if (roots.some((r) => existsIn(r, sels))) {
        any = true;
        for (const n of cmp.com || []) skip.add(n);
      }
    }
    return { any, skip };
  }

  // Un giro delle regole a mano. Ritorna il nome del CMP su cui ha agito, o null.
  function handReject() {
    for (const cmp of CMPS) {
      const searchRoots = cmp.shadowHosts ? [document, ...shadowRootsOf(cmp.shadowHosts)] : [document];
      for (const root of searchRoots) {
        const btn = queryIn(root, cmp.reject);
        if (btn && clickEl(btn)) return { name: cmp.name, rejected: true };
      }
      if (cmp.openSettings && cmp.rejectInSettings) {
        for (const root of searchRoots) {
          const inSettings = queryIn(root, cmp.rejectInSettings);
          if (inSettings && clickEl(inSettings)) return { name: cmp.name, rejected: true };
          if (!openedSettings.has(cmp.name) && !seenHidden() && (!cmp.showing || queryIn(root, cmp.showing))) {
            const open = queryIn(root, cmp.openSettings);
            if (open && clickEl(open)) { openedSettings.add(cmp.name); return { name: cmp.name, rejected: false }; }
          }
        }
      }
    }
    return null;
  }

  // Compatibilità: un giro di rifiuto (mano + ripiego testuale), true se ha premuto qualcosa.
  function tryReject() {
    const hit = handReject();
    if (hit) { if (hit.rejected) noteRejected(hit.name); return true; }
    const extraRoots = [];
    for (const cmp of CMPS) if (cmp.shadowHosts) extraRoots.push(...shadowRootsOf(cmp.shadowHosts));
    for (const root of [document, ...extraRoots]) {
      const fb = findRejectText(root, false);
      if (fb && clickEl(fb)) { noteRejected('testo'); return true; }
    }
    return false;
  }

  // ─── regole Consent-O-Matic ─────────────────────────────────────────────────

  // Consent-O-Matic smette di cercare dopo pochi secondi senza CMP; qui la finestra è più larga, poi resta la mano.
  const COM_WINDOW_MS = 20000;
  const com = {
    busy: false,
    lastTick: 0,
    lastWaiting: false,
    since: 0,
    tried: new Set(),
    firstSeen: new Map(),
    rules: new Map(),
    asking: new Set(),
    shownCmp: null,
    shownAt: 0,
  };

  function comRule(name) {
    if (com.rules.has(name)) return com.rules.get(name);
    if (!com.asking.has(name)) {
      com.asking.add(name);
      ask({ type: T_RULE, name }).then((r) => {
        com.rules.set(name, (r && r.ok && r.rule) || null);
        scheduleScan();
      });
    }
    return undefined;
  }

  // Ritorna true se una regola sta lavorando o aspetta di poterlo fare: gli stadi dopo stanno fermi.
  function comTick(skip) {
    const R = global.SN_COOKIE_RULES;
    if (!R || !cfg || !Array.isArray(cfg.index) || !cfg.index.length) return false;
    if (com.busy) return true;
    const now = Date.now();
    if (!com.since) com.since = now;
    if (now - com.since > COM_WINDOW_MS && !com.firstSeen.size) return false;
    if (now - com.lastTick < 350) { scheduleScanIn(360); return com.lastWaiting; }
    com.lastTick = now;
    com.lastWaiting = comScan(R, skip, now);
    return com.lastWaiting;
  }

  function comClick(t) {
    const base = answerBase();
    t.click();
    answerAfter(base, true);
  }

  function comScan(R, skip, now) {
    const names = R.presentInIndex(cfg.index, new Set([...skip, ...com.tried]));
    let waiting = false;
    for (const name of names) {
      const rule = comRule(name);
      if (rule === undefined) { waiting = true; continue; }
      if (!rule) { com.tried.add(name); continue; }
      const cmp = R.makeCmp(name, rule, cfg.topUrl || location.href, { click: comClick });
      if (!cmp.detect()) { com.tried.add(name); continue; }
      if (!com.firstSeen.has(name)) com.firstSeen.set(name, now);
      const showing = cmp.isShowing();
      if (showing && (!com.shownCmp || com.shownCmp.name !== name)) { com.shownCmp = cmp; com.shownAt = now; }
      if (!showing) {
        // Consent-O-Matic lo riguarda per poco più di un secondo; qui qualche secondo, poi si arrende.
        if (now - com.firstSeen.get(name) > 6000) com.tried.add(name);
        else { waiting = true; scheduleScanIn(400); }
        continue;
      }
      com.busy = true;
      cmp.reject().then((res) => {
        com.busy = false;
        com.tried.add(name);
        // Una regola che non ha premuto niente non ha cambiato la pagina: non c'è niente da lasciar assestare.
        if (res && res.clicks > 0) lastActionAt = Date.now();
        if (res && res.clicks > 0 && !res.utility) noteRejected(name);
        scheduleScanIn(150);
      });
      return true;
    }
    return waiting;
  }

  // ─── TCF (__tcfapi) ─────────────────────────────────────────────────────────
  //
  // Il TCF non ha un comando per rifiutare: serve a sapere se il rifiuto è stato registrato davvero.
  // La pagina lo espone nel suo mondo; da qui si parla col protocollo postMessage del TCF, lo stesso dei riquadri.

  // Il riquadro «__tcfapiLocator» è come lo standard fa trovare il CMP: senza, alla pagina non si scrive niente.
  function hasTcf() {
    try { return !!document.querySelector('iframe[name="__tcfapiLocator"]'); } catch (_) { return false; }
  }

  function tcf(command, timeout) {
    return new Promise((resolve) => {
      if (!IS_TOP || !hasTcf()) { resolve(null); return; }
      const callId = 'filo-' + Math.random().toString(36).slice(2);
      let t = null;
      const onMsg = (e) => {
        let d = e && e.data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { return; } }
        const r = d && d.__tcfapiReturn;
        if (!r || r.callId !== callId) return;
        done(r.success === false ? null : r.returnValue);
      };
      const done = (v) => { window.removeEventListener('message', onMsg); clearTimeout(t); resolve(v || null); };
      t = setTimeout(() => done(null), timeout || 800);
      window.addEventListener('message', onMsg);
      try { window.postMessage({ __tcfapiCall: { command, version: 2, callId, parameter: null } }, '*'); } catch (_) { done(null); }
    });
  }

  // false solo se il TCF risponde e dice che qualche finalità ha ancora il consenso.
  async function tcfConfirmsReject() {
    await new Promise((r) => setTimeout(r, 700));
    const data = await tcf('getTCData', 900);
    const consents = data && data.purpose && data.purpose.consents;
    if (!consents || typeof consents !== 'object') return null;
    return !Object.values(consents).some((v) => v === true);
  }

  // ─── esiti: il main li mostra nel menu della scheda ─────────────────────────

  function noteRejected(via) {
    if (reported.has('rejected')) return;
    reported.add('rejected');
    const go = () => send({ type: T_OUTCOME, outcome: 'rejected', via: String(via || '').slice(0, 60) });
    if (!IS_TOP || !hasTcf()) { go(); return; }
    tcfConfirmsReject().then((ok) => {
      if (ok !== false) { go(); return; }
      reported.delete('rejected');
      send({ type: T_OUTCOME, outcome: 'unconfirmed' });
    });
  }

  function noteHidden() {
    if (reported.has('hidden')) return;
    reported.add('hidden');
    send({ type: T_OUTCOME, outcome: 'hidden' });
  }

  // ─── banner senza «rifiuta»: si nascondono (solo pagina) ────────────────────

  const FRAME_GRACE_MS = 2500;
  const CMP_GRACE_MS = 4000;
  const ACTION_GRACE_MS = 1500;

  // Su questo sito Filo ha già trovato un banner senza «rifiuta»: le attese servivano a dare tempo al rifiuto,
  // e il sito non si segna niente, quindi il banner torna a ogni pagina. Si nasconde subito, senza aprire le impostazioni.
  function seenHidden() { return !!(cfg && cfg.seen === 'hidden'); }

  // Un involucro senza misura sua (le parti visibili sono fisse, come in OneTrust) conta per quello che mostra.
  // Una parte piccola, come l'icona fissa per riaprire le preferenze, non fa di lui un banner aperto.
  const MIN_PART = 0.02;

  function shows(el) {
    if (isVisible(el)) return true;
    try {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') < 0.1) return false;
    } catch (_) { return false; }
    const min = window.innerWidth * window.innerHeight * MIN_PART;
    let level = [el];
    let seen = 0;
    for (let depth = 0; depth < 3 && level.length && seen < 400; depth++) {
      const next = [];
      for (const n of level) {
        for (const c of n.children || []) {
          if (++seen > 400) break;
          let r = null;
          try { r = c.getBoundingClientRect(); } catch (_) {}
          if (r && r.width * r.height >= min && isVisible(c)) return true;
          next.push(c);
        }
      }
      level = next;
    }
    return false;
  }

  function bannerTick(knownCmp) {
    const B = global.SN_COOKIE_BANNERS;
    if (!IS_TOP || !B || !B.isRunning() || reported.has('rejected')) return;
    const now = Date.now();
    let recheck = 0;
    for (const { el, at } of B.pending()) {
      if (!shows(el)) { if (now - at < 10000) recheck = 500; continue; }
      const btn = findRejectText(el, true);
      if (btn && clickEl(btn)) { B.forget(el); noteRejected('lista'); return; }
      const age = now - at;
      let wait = 0;
      if (now - lastActionAt < ACTION_GRACE_MS) wait = ACTION_GRACE_MS - (now - lastActionAt);
      if (!seenHidden() && (el.matches('iframe') || el.querySelector('iframe'))) wait = Math.max(wait, FRAME_GRACE_MS - age);
      if (knownCmp && !seenHidden()) wait = Math.max(wait, CMP_GRACE_MS - age);
      if (wait > 0) { recheck = recheck ? Math.min(recheck, wait + 20) : wait + 20; continue; }
      if (B.hide(el)) noteHidden();
    }
    if (recheck) scheduleScanIn(recheck);
  }

  // Le regole riconoscono un banner dalla forma, e la stessa forma porta anche l'avviso adblock o il limite di
  // articoli gratuiti: si nasconde solo un messaggio che parla di cookie o di consenso.
  const CONSENT_TEXT = /cookie|\bconsent\b|consenso|consentement|consentimiento|consentimento|einwilligung|zustimmung|toestemming|samtycke|samtykke|eväste/i;

  function aboutConsent(el) {
    let t = '';
    try { t = (el && (el.innerText || el.textContent)) || ''; } catch (_) {}
    return CONSENT_TEXT.test(t);
  }

  // ─── banner senza «rifiuta» dentro un riquadro: lo nasconde la pagina ───────
  //
  // Il riquadro riconosce il banner (regola a mano o Consent-O-Matic) ma non può nascondersi né sbloccare la
  // pagina: lo dice al main, che passa alla pagina l'indirizzo del riquadro da nascondere.

  const FRAME_REPORT_MS = 3000;
  let frameSeenAt = 0;

  // Solo il banner a schermo: un «Impostazioni cookie» nel piè di pagina di un riquadro qualsiasi non è un banner.
  function handShowing() {
    for (const cmp of CMPS) {
      if (!cmp.showing) continue;
      const roots = cmp.shadowHosts ? [document, ...shadowRootsOf(cmp.shadowHosts)] : [document];
      if (roots.some((r) => queryIn(r, cmp.showing))) return true;
    }
    return false;
  }

  function frameTick(handAny) {
    if (IS_TOP || reported.has('rejected') || reported.has('frame')) return;
    let showing = false;
    try { showing = (!!com.shownCmp && !com.busy && com.shownCmp.isShowing()) || (handAny && handShowing()); } catch (_) {}
    if (showing && !aboutConsent(document.body)) showing = false;
    if (!showing) { frameSeenAt = 0; return; }
    const now = Date.now();
    if (!frameSeenAt) frameSeenAt = now;
    const wait = Math.max((seenHidden() ? 0 : FRAME_REPORT_MS) - (now - frameSeenAt), ACTION_GRACE_MS - (now - lastActionAt));
    if (wait > 0) { scheduleScanIn(wait + 20); return; }
    reported.add('frame');
    send({ type: T_FRAME });
  }

  function originOf(u) {
    try { return new URL(u, location.href).origin; } catch (_) { return ''; }
  }

  function sameUrl(a, b) {
    try {
      const x = new URL(a, location.href);
      const y = new URL(b);
      x.hash = ''; y.hash = '';
      return x.href === y.href;
    } catch (_) { return false; }
  }

  function pinned(el) {
    try { const p = getComputedStyle(el).position; return p === 'fixed' || p === 'sticky'; } catch (_) { return false; }
  }

  // Il velo che porta il riquadro: l'antenato fisso più esterno senza contenuto suo, o il riquadro se è fisso lui.
  // Un riquadro nel flusso della pagina (un widget di prenotazione col suo banner) è contenuto: null, resta.
  function frameBox(f) {
    let box = pinned(f) ? f : null;
    for (let n = f.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (!pinned(n)) continue;
      if ((n.innerText || '').trim().length > 300 || n.querySelectorAll('iframe,video').length > 1) break;
      box = n;
    }
    return box;
  }

  const pendingFrames = [];

  function hideFrame(m) {
    if (!IS_TOP) return;
    if (!cfg) { pendingFrames.push(m); return; }
    const B = global.SN_COOKIE_BANNERS;
    if (!active || !banners || !B) return;
    let frames = [];
    try { frames = [...document.querySelectorAll('iframe')].filter(isVisible); } catch (_) {}
    const exact = frames.filter((f) => m.url && sameUrl(f.src, m.url));
    const hits = exact.length ? exact : frames.filter((f) => m.origin && originOf(f.src) === m.origin);
    let any = false;
    for (const f of hits) {
      const box = frameBox(f);
      if (box && B.hide(box)) any = true;
    }
    if (any) noteHidden();
  }

  // Banner che le regole riconoscono ma non sanno rifiutare («accetta o abbonati») e che la lista non nomina:
  // si nasconde quello che la regola stessa nasconde mentre lavora.
  function comHideTick() {
    const B = global.SN_COOKIE_BANNERS;
    const cmp = com.shownCmp;
    if (!IS_TOP || !B || !B.isRunning() || !cmp || com.busy || reported.has('rejected')) return;
    let showing = false;
    try { showing = cmp.isShowing(); } catch (_) {}
    if (!showing) return;
    const now = Date.now();
    const wait = Math.max((seenHidden() ? 0 : CMP_GRACE_MS) - (now - com.shownAt), ACTION_GRACE_MS - (now - lastActionAt));
    if (wait > 0) { scheduleScanIn(wait + 20); return; }
    com.shownCmp = null;
    let any = false;
    for (const el of cmp.hideTargets()) {
      if (el !== document.body && el !== document.documentElement && isVisible(el) && aboutConsent(el) && B.hide(el)) any = true;
    }
    if (any) noteHidden();
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
  let scanLater = null;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    const run = () => { scanScheduled = false; scan(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function scheduleScanIn(ms) {
    if (scanLater) return;
    scanLater = setTimeout(() => { scanLater = null; scheduleScan(); }, Math.max(16, ms | 0));
  }

  function scan() {
    if (!active) return;
    try { rewriteYouTube(document); } catch (_) {}
    if (!banners) return;
    try {
      if (com.busy) return;
      const hit = handReject();
      if (hit) { if (hit.rejected) noteRejected(hit.name); return; }
      const hand = handPresent();
      const comWorking = comTick(hand.skip);
      if (comWorking) return;
      const fb = findRejectText(document, false);
      if (fb && clickEl(fb)) { noteRejected('testo'); return; }
      if (IS_TOP) { bannerTick(hand.any || com.firstSeen.size > 0); comHideTick(); }
      else frameTick(hand.any);
    } catch (_) {}
  }

  // Le classi che cambiano servono solo a chiedere le regole della lista; a far ripassare le regole
  // bastano i nodi nuovi (un banner che compare per classe lo segnala il motore di stile, da cookieBanners.js).
  function onMutations(records) {
    const B = IS_TOP && banners ? global.SN_COOKIE_BANNERS : null;
    const surveying = !!(B && B.isRunning());
    let added = false;
    for (const r of records) {
      if (r.type === 'attributes') { if (surveying) B.survey(r.target, false); continue; }
      if (!r.addedNodes.length) continue;
      added = true;
      if (surveying) for (const n of r.addedNodes) if (n.nodeType === 1) B.survey(n, true);
    }
    if (added) scheduleScan();
  }

  function startObserver() {
    if (observer) return;
    try {
      observer = new MutationObserver(onMutations);
      observer.observe(document.documentElement || document, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'id'],
      });
    } catch (_) {}
  }

  function stopObserver() {
    if (observer) { try { observer.disconnect(); } catch (_) {} observer = null; }
  }

  // Alcuni CMP montano il banner con ritardo: si ripassa per qualche secondo anche senza mutazioni utili.
  // Se il TCF dice che un banner è aperto, la caccia dura di più.
  function hunt() {
    if (huntTimer) clearInterval(huntTimer);
    let n = 0;
    let limit = IS_TOP ? 12 : 8;
    if (IS_TOP) tcf('ping', 1500).then((p) => { if (p && p.displayStatus === 'visible') limit = 28; });
    huntTimer = setInterval(() => {
      if (!active || ++n > limit) { clearInterval(huntTimer); huntTimer = null; return; }
      scan();
    }, 700);
  }

  function startBanners() {
    const B = global.SN_COOKIE_BANNERS;
    if (!IS_TOP || !B || !cfg || !cfg.cosmetic) return;
    B.start({
      complex: [...(Array.isArray(cfg.cosmetic.complex) ? cfg.cosmetic.complex : []), ...HAND_HIDE],
      specific: cfg.cosmetic.specific,
      ask: (ids, classes) => ask({ type: T_TOKENS, ids, classes }).then((r) => (r && r.ok && Array.isArray(r.selectors) ? r.selectors : [])),
      onFound: scheduleScan,
    });
  }

  function stopBanners() {
    const B = global.SN_COOKIE_BANNERS;
    if (B) B.stop();
  }

  function apply(next) {
    const r = next || {};
    const m = (r.mode === 'manual' || r.mode === 'privacy') ? r.mode : 'default';
    const nextActive = m !== 'manual';
    const nextBanners = nextActive && !r.off;
    mode = m;
    cfg = r;
    if (!nextActive) {
      active = false; banners = false;
      stopObserver(); stopBanners();
      openedSettings.clear();
      if (huntTimer) { clearInterval(huntTimer); huntTimer = null; }
      return;
    }
    const wasBanners = banners;
    active = true;
    banners = nextBanners;
    startObserver();
    if (banners && !wasBanners) startBanners();
    if (!banners && wasBanners) stopBanners();
    scheduleScan();
    hunt();
    for (const m of pendingFrames.splice(0)) hideFrame(m);
  }

  function applyMode(m) {
    apply({ ...(cfg || {}), mode: m });
  }

  // ─── accesso a un sito (Privacy massima) ───────────────────────────────────
  //
  // Solo il gesto: una password scritta dall'utente (evento vero, la pagina non lo fabbrica) che parte col modulo,
  // con Invio o con un pulsante. Se l'accesso è riuscito, e la proposta «Resta connesso», lo decide il main.
  let campoPassword = null;
  let accessoInviatoAt = 0;
  function bersaglio(e) {
    try { const p = e.composedPath && e.composedPath(); if (p && p[0]) return p[0]; } catch (_) {}
    return e.target;
  }
  function onPasswordInput(e) {
    if (!e.isTrusted) return;
    const t = bersaglio(e);
    if (t && t.tagName === 'INPUT' && String(t.type).toLowerCase() === 'password') campoPassword = t;
  }
  function forseAccesso(e) {
    if (!e.isTrusted || mode !== 'privacy' || !campoPassword || !campoPassword.value) return;
    if (e.type === 'keydown' && e.key !== 'Enter') return;
    if (e.type === 'click') {
      const t = bersaglio(e);
      if (!t || !t.closest || !t.closest('button, input[type="submit"], input[type="image"], input[type="button"], [role="button"], a')) return;
    }
    const ora = Date.now();
    if (ora - accessoInviatoAt < 3000) return;
    accessoInviatoAt = ora;
    send({ type: T_ACCESSO });
  }
  // Anche nei riquadri: c'è chi mette il modulo d'accesso in un iframe (icloud.com, banche). Vale il sito della scheda.
  try {
    document.addEventListener('input', onPasswordInput, true);
    for (const ev of ['submit', 'keydown', 'click']) document.addEventListener(ev, forseAccesso, true);
  } catch (_) {}

  // ─── bootstrap ───────────────────────────────────────────────────────────

  function load() {
    send({ type: T_GET, url: location.href, frame: IS_TOP ? 'top' : 'sub' }, (r) => {
      apply(r && r.ok ? r : { mode: 'default' });
    });
  }

  // Modalità o siti con i banner cambiati nelle impostazioni: si rilegge la config per questo sito.
  try {
    chrome.runtime.onMessage.addListener((m) => {
      if (m && m.type === T_UPDATE) load();
      else if (m && m.type === T_HIDE_FRAME) hideFrame(m);
    });
  } catch (_) {}

  if (IS_TOP) { try { document.addEventListener('click', onUserClick, true); } catch (_) {} }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load, { once: true });
  } else {
    load();
  }

  global.SN_COOKIES_CS = { applyMode, tryReject, rewriteYouTube, nocookieUrl, _state: () => ({ mode, active, banners }) };
})(typeof globalThis !== 'undefined' ? globalThis : self);
