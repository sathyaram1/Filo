// Le pubblicità dei video che si possono saltare: appena il lettore mostra «Salta», Filo lo preme (#737).
// Non accorcia quelle senza «Salta» e non clicca altro che i pulsanti di SALTA. Gira in ogni frame http(s).
// Il clic vero lo dà il main (services/adSkip.js) dove la config lo concede; altrove un clic dello script.

(function (global) {
  'use strict';
  if (global.SN_AD_SKIP) return;

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const T_CONFIG = MSG.AD_SKIP_CONFIG || 'ad_skip_config';
  const T_CLICK = MSG.AD_SKIP_CLICK || 'ad_skip_click';
  const T_UPDATE = MSG.AD_SKIP_CONFIG_UPDATE || 'ad_skip_config_update';

  // I «Salta» dei lettori: YouTube nelle sue tre generazioni, Google IMA (il lettore pubblicitario di molti siti), JW Player.
  const SALTA = [
    '.ytp-skip-ad-button', '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern',
    '.videoAdUiSkipButton', '.jw-skip.jw-skippable',
  ];
  // Il motore di stile segnala ogni «Salta» appena viene disegnato: un'animazione muta, nessuna scansione del DOM.
  const ANIM = 'filo-ad-skip';
  const REGOLE = `@keyframes ${ANIM}{from{--filo-ad-skip:0}to{--filo-ad-skip:1}}`
    + `${SALTA.join(',')}{animation:${ANIM} 1ms 1 !important}`;

  const PASSO_MS = 250;
  const PASSO_NASCOSTI_MS = 1000;
  // Un clic che non ha effetto non si ripete a raffica: i tentativi si diradano fino a uno ogni dieci secondi.
  const ATTESE_MS = [600, 1200, 2400, 4800, 9600];
  const TENTATIVI = 12;
  // Un «Salta» sparito si segue ancora un po': il lettore lo riusa per la pubblicità dopo.
  const SEGUI_NASCOSTO_MS = 120000;

  const chrome = global.chrome;
  function send(msg, cb) {
    try { chrome.runtime.sendMessage(msg, cb); } catch (_) { if (cb) cb(null); }
  }

  let attivo = false;
  let clicVero = false;
  let stile = null;
  let adottato = null;
  const seguiti = new Map();
  let timer = null;
  let premuto = false;

  // Un <style> che la CSP del sito blocca resta senza foglio: allora un foglio costruito, che la CSP non guarda.
  function metti() {
    if (stile || adottato) return;
    try {
      stile = document.createElement('style');
      stile.textContent = REGOLE;
      (document.head || document.documentElement).appendChild(stile);
      if (stile.sheet && stile.sheet.cssRules.length) return;
    } catch (_) {}
    try { if (stile) stile.remove(); } catch (_) {}
    stile = null;
    try {
      adottato = new CSSStyleSheet();
      adottato.replaceSync(REGOLE);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, adottato];
    } catch (_) { adottato = null; }
  }

  function togli() {
    try { if (stile) stile.remove(); } catch (_) {}
    stile = null;
    if (adottato) {
      try { document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== adottato); } catch (_) {}
      adottato = null;
    }
    seguiti.clear();
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function premibile(el) {
    if (!el || !el.isConnected || el.disabled) return false;
    if (String(el.getAttribute('aria-disabled') || '') === 'true') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    try {
      if (typeof el.checkVisibility === 'function') {
        return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      }
    } catch (_) {}
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
  }

  // Il clic vero sposterebbe il fuoco da un campo in cui si scrive, o romperebbe un trascinamento: si aspetta.
  function utenteOccupato() {
    if (premuto) return true;
    const ct = global.SN_CAMPO_TESTO;
    try { return !!(ct && ct.scriveQui(document)); } catch (_) { return false; }
  }

  // Il centro del pulsante, se lì sopra c'è proprio lui: un clic vero nel punto sbagliato aprirebbe la pubblicità.
  function centro(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    let sopra = null;
    try { sopra = document.elementFromPoint(x, y); } catch (_) { sopra = null; }
    if (!sopra || !(sopra === el || el.contains(sopra))) return null;
    const vv = window.visualViewport;
    if (!vv) return { x, y };
    return { x: (x - vv.offsetLeft) * vv.scale, y: (y - vv.offsetTop) * vv.scale };
  }

  // Rifiuti del main che non passano: qui il clic vero non arriverà, si torna al clic dello script.
  const RIFIUTI_FERMI = new Set(['forbidden', 'off']);

  // false = per ora non si preme (l'utente è occupato): il tentativo non si conta.
  // Un «Salta» coperto o fuori dal riquadro visibile prende il clic dello script.
  function premi(el, s) {
    if (clicVero && !s.finto) {
      if (utenteOccupato()) return false;
      const p = centro(el);
      if (p) {
        send({ type: T_CLICK, x: p.x, y: p.y }, (r) => {
          if (!r || (!r.ok && RIFIUTI_FERMI.has(r.code))) s.finto = true;
        });
        return true;
      }
    }
    try { el.click(); } catch (_) {}
    return true;
  }

  function pianifica(ms) {
    if (timer || !seguiti.size) return;
    timer = setTimeout(giro, ms);
  }

  function giro() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!attivo) { seguiti.clear(); return; }
    const ora = Date.now();
    let visibili = 0;
    for (const [el, s] of seguiti) {
      if (!el.isConnected) { seguiti.delete(el); continue; }
      if (!premibile(el)) {
        s.visibile = false;
        if (ora - s.visto > SEGUI_NASCOSTO_MS) seguiti.delete(el);
        continue;
      }
      visibili++;
      // Riapparso: è la pubblicità dopo, i tentativi ripartono.
      if (!s.visibile) { s.visibile = true; s.tentativi = 0; s.prossimo = 0; s.finto = false; }
      s.visto = ora;
      if (ora < s.prossimo || s.tentativi >= TENTATIVI) continue;
      if (!premi(el, s)) continue;
      s.prossimo = ora + ATTESE_MS[Math.min(s.tentativi, ATTESE_MS.length - 1)];
      s.tentativi++;
    }
    pianifica(visibili ? PASSO_MS : PASSO_NASCOSTI_MS);
  }

  function riprova() {
    if (!seguiti.size) return;
    for (const s of seguiti.values()) { s.prossimo = 0; s.tentativi = Math.min(s.tentativi, TENTATIVI - 1); }
    giro();
  }

  function suAnimazione(e) {
    if (!attivo || e.animationName !== ANIM) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (!seguiti.has(el)) seguiti.set(el, { visto: Date.now(), visibile: false, tentativi: 0, prossimo: 0, finto: false });
    giro();
  }

  function suPuntatore(e) {
    if (!e.isTrusted) return;
    if (e.type === 'pointerdown') premuto = true;
    else if (e.type !== 'pointermove' || e.buttons === 0) premuto = false;
  }

  function imposta(r) {
    attivo = !!(r && r.ok && r.enabled);
    clicVero = attivo && !!r.clicVero;
    if (attivo) metti();
    else togli();
  }

  function carica() {
    send({ type: T_CONFIG }, (r) => imposta(r));
  }

  try {
    window.addEventListener('animationstart', suAnimazione, true);
    for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'pointermove']) {
      window.addEventListener(t, suPuntatore, { capture: true, passive: true });
    }
    window.addEventListener('blur', () => { premuto = false; });
    // Tornando sulla pagina (finestra ridotta a icona e riaperta) si riprova subito, anche dove i tentativi erano finiti.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') riprova(); });
    chrome.runtime.onMessage.addListener((m) => { if (m && m.type === T_UPDATE) carica(); });
  } catch (_) {}

  carica();

  global.SN_AD_SKIP = { SALTA, _stato: () => ({ attivo, clicVero, seguiti: seguiti.size }) };
})(typeof globalThis !== 'undefined' ? globalThis : self);
