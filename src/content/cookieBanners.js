// Banner dei cookie che Filo non sa rifiutare: li riconosce con EasyList Cookie, li nasconde e sblocca la pagina rimasta ferma.
// Non clicca niente e non decide quando nascondere: lo decide cookies.js. Solo nel frame principale.
// Le regole arrivano da src/main/services/cookieBanners.js (lista scaricata, mai impacchettata).

(function (global) {
  'use strict';

  const ANIM = 'filo-cookie-seen';

  let style = null;
  let sheet = null;
  const inserted = new Set();
  const candidates = new Map();
  const hidden = new WeakSet();
  const hiddenList = [];
  const askedTokens = new Set();
  let pendingIds = new Set();
  let pendingClasses = new Set();
  let ask = null;
  let onFound = null;
  let running = false;
  let surveyTimer = null;
  let unlockTimers = [];

  // Il riconoscimento lo fa il motore di stile: ogni selettore della lista accende un'animazione muta,
  // e il suo `animationstart` porta qui l'elemento appena viene disegnato. Nessuna scansione del DOM.
  const KEYFRAMES = `@keyframes ${ANIM}{from{--filo-cookie-seen:0}to{--filo-cookie-seen:1}}`;
  let adopted = null;

  // Un <style> che la CSP del sito blocca resta senza foglio: allora un foglio costruito, che la CSP non guarda.
  function ensureSheet() {
    if (sheet) return true;
    try {
      style = document.createElement('style');
      style.textContent = KEYFRAMES;
      (document.head || document.documentElement).appendChild(style);
      sheet = style.sheet;
    } catch (_) { sheet = null; }
    if (!sheet) {
      try { if (style) style.remove(); } catch (_) {}
      style = null;
      try {
        adopted = new CSSStyleSheet();
        adopted.replaceSync(KEYFRAMES);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, adopted];
        sheet = adopted;
      } catch (_) { adopted = null; sheet = null; }
    }
    return !!sheet;
  }

  function addSelectors(list) {
    if (!running || !ensureSheet()) return;
    for (const sel of Array.isArray(list) ? list : []) {
      if (typeof sel !== 'string' || !sel || inserted.has(sel)) continue;
      inserted.add(sel);
      try { sheet.insertRule(`${sel}{animation:${ANIM} 1ms 1 !important}`, sheet.cssRules.length); } catch (_) {}
    }
  }

  function onAnimation(e) {
    if (!running || !e || e.animationName !== ANIM) return;
    const el = e.target;
    if (!el || el.nodeType !== 1 || hidden.has(el)) return;
    try { if (global.SN_FILO_UI && global.SN_FILO_UI.inside(el)) return; } catch (_) {}
    if (!candidates.has(el)) candidates.set(el, Date.now());
    if (onFound) onFound();
  }

  // ─── id e classi della pagina: si chiede al main quali sono nella lista ───────

  function collect(el) {
    if (!el || el.nodeType !== 1) return;
    const id = el.id;
    if (id && typeof id === 'string' && id.length <= 120 && !askedTokens.has('#' + id)) {
      askedTokens.add('#' + id);
      pendingIds.add(id);
    }
    const cl = el.classList;
    if (cl) {
      for (const c of cl) {
        if (c.length > 120 || askedTokens.has('.' + c)) continue;
        askedTokens.add('.' + c);
        pendingClasses.add(c);
      }
    }
  }

  function survey(root, deep) {
    if (!running || !root) return;
    collect(root);
    if (deep !== false) {
      let nodes = [];
      try { nodes = root.querySelectorAll ? root.querySelectorAll('[id],[class]') : []; } catch (_) {}
      for (const n of nodes) collect(n);
    }
    scheduleFlush();
  }

  function scheduleFlush() {
    if (surveyTimer || (!pendingIds.size && !pendingClasses.size)) return;
    surveyTimer = setTimeout(flush, 120);
  }

  function flush() {
    surveyTimer = null;
    if (!running || !ask) return;
    const ids = [...pendingIds];
    const classes = [...pendingClasses];
    pendingIds = new Set();
    pendingClasses = new Set();
    if (!ids.length && !classes.length) return;
    Promise.resolve(ask(ids, classes)).then((sels) => addSelectors(sels)).catch(() => {});
  }

  // ─── nascondere e sbloccare ───────────────────────────────────────────────────

  function hide(el) {
    if (!el || hidden.has(el)) return false;
    hidden.add(el);
    hiddenList.push(el);
    candidates.delete(el);
    try { el.style.setProperty('display', 'none', 'important'); } catch (_) { return false; }
    unlockSoon();
    return true;
  }

  function coversViewport(el, cs) {
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
    const r = el.getBoundingClientRect();
    return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9;
  }

  // Un velo: copre la finestra, non ha testo suo, ha uno sfondo o sfoca quello che c'è sotto.
  function isVeil(el) {
    let cs;
    try { cs = getComputedStyle(el); } catch (_) { return false; }
    if (cs.display === 'none' || cs.visibility === 'hidden' || !coversViewport(el, cs)) return false;
    if (!(parseInt(cs.zIndex, 10) > 0)) return false;
    if ((el.innerText || '').trim().length > 3) return false;
    if (el.querySelector('iframe,video,canvas,img,svg,input,textarea,select')) return false;
    const bg = cs.backgroundColor || '';
    const tinted = bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg);
    return tinted || (cs.backdropFilter && cs.backdropFilter !== 'none');
  }

  // Un sito fatto per non scorrere (un'applicazione che scorre dentro un suo pannello) sta tutto nella finestra:
  // il suo corpo fermo è disegno, non il blocco di un banner. Il contenuto oltre il bordo è il segno del blocco.
  function contentOverflows(body) {
    try { return !!body && body.scrollHeight > window.innerHeight * 1.1; } catch (_) { return false; }
  }

  // Quello che un banner lascia dietro di sé: scorrimento fermo, pagina inchiodata, clic spenti, velo scuro.
  function unlock() {
    const html = document.documentElement;
    const body = document.body;
    const locked = contentOverflows(body);
    for (const el of [html, body]) {
      if (!el) continue;
      let cs;
      try { cs = getComputedStyle(el); } catch (_) { continue; }
      if (locked && (cs.overflowY === 'hidden' || cs.overflowY === 'clip')) el.style.setProperty('overflow-y', 'auto', 'important');
      if (cs.pointerEvents === 'none') el.style.setProperty('pointer-events', 'auto', 'important');
      if (el === body && cs.position === 'fixed') {
        const top = parseFloat(cs.top) || 0;
        el.style.setProperty('position', 'static', 'important');
        if (top < 0) { try { window.scrollTo(0, -top); } catch (_) {} }
      }
    }
    let fixed = [];
    try { fixed = document.querySelectorAll('body > *, body > * > *'); } catch (_) {}
    for (const el of fixed) {
      if (hidden.has(el)) continue;
      try { if (global.SN_FILO_UI && global.SN_FILO_UI.inside(el)) continue; } catch (_) {}
      if (isVeil(el)) { hidden.add(el); hiddenList.push(el); el.style.setProperty('display', 'none', 'important'); }
    }
  }

  // Il sito spesso blocca lo scorrimento DOPO aver mostrato il banner: si ripassa per qualche secondo.
  function unlockSoon() {
    for (const t of unlockTimers) clearTimeout(t);
    unlockTimers = [0, 400, 1500, 4000].map((ms) => setTimeout(() => { if (running) unlock(); }, ms));
  }

  // ─── ciclo di vita ───────────────────────────────────────────────────────────

  function start(cfg) {
    if (running) return;
    running = true;
    ask = cfg && cfg.ask;
    onFound = cfg && cfg.onFound;
    document.addEventListener('animationstart', onAnimation, true);
    addSelectors(cfg && cfg.complex);
    addSelectors(cfg && cfg.specific);
    survey(document.documentElement);
  }

  function stop() {
    running = false;
    try { document.removeEventListener('animationstart', onAnimation, true); } catch (_) {}
    try { if (style) style.remove(); } catch (_) {}
    try { if (adopted) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== adopted); } catch (_) {}
    style = null; sheet = null; adopted = null;
    inserted.clear();
    candidates.clear();
    askedTokens.clear();
    pendingIds = new Set(); pendingClasses = new Set();
    if (surveyTimer) { clearTimeout(surveyTimer); surveyTimer = null; }
    for (const t of unlockTimers) clearTimeout(t);
    unlockTimers = [];
  }

  // Candidati ancora in pagina, col momento in cui sono comparsi.
  function pending() {
    const out = [];
    for (const [el, at] of candidates) {
      if (!el.isConnected || hidden.has(el)) { candidates.delete(el); continue; }
      out.push({ el, at });
    }
    return out;
  }

  function forget(el) { candidates.delete(el); }

  global.SN_COOKIE_BANNERS = {
    start, stop, survey, pending, forget, hide, unlock,
    hiddenCount: () => hiddenList.filter((el) => el.isConnected).length,
    isRunning: () => running,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
