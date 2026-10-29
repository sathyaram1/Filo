// Le pubblicità dei video che si possono saltare: appena il lettore mostra «Salta», Filo lo preme (#737).
// Non accorcia quelle senza «Salta» e non clicca altro che i pulsanti di SALTA. Gira in ogni frame http(s).
// Il clic vero lo dà il main (services/adSkip.js) dove la config lo concede, altrove un clic dello script; regole lì.

(function (global) {
  'use strict';
  if (global.SN_AD_SKIP) return;

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const T_CONFIG = MSG.AD_SKIP_CONFIG || 'ad_skip_config';
  const T_CLICK = MSG.AD_SKIP_CLICK || 'ad_skip_click';
  const T_UPDATE = MSG.AD_SKIP_CONFIG_UPDATE || 'ad_skip_config_update';
  const T_WHERE = MSG.AD_SKIP_WHERE || 'ad_skip_where';
  const T_HERE = MSG.AD_SKIP_HERE || 'ad_skip_here';

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
  // Una pagina nascosta (scheda dietro, finestra ridotta o coperta) non disegna e l'animazione non parte, ma l'audio
  // della pubblicità si sente: lì i «Salta» si cercano nel DOM, al passo che Chromium concede ai timer nascosti.
  const VEGLIA_MS = 1000;
  const SELETTORE = SALTA.join(',');
  // Un clic che non ha effetto non si ripete a raffica: i tentativi si diradano fino a uno ogni dieci secondi.
  const ATTESE_MS = [500, 1000, 1500, 2500, 5000, 10000];
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
  let veglia = null;
  let premuto = false;
  const inCima = window.top === window;
  // Il nome con cui questo frame si presenta alla pagina sopra: pubblico, la pagina lo vede; lega le domande del main.
  const mioTag = (() => {
    try { return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); }
    catch (_) { return String(Math.random()).slice(2) + String(Date.now()); }
  })();
  // I riquadri di questa pagina che si sono presentati: il tag e l'origine vera del messaggio, non quella che dicono.
  const figli = new WeakMap();

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
    if (veglia) { clearTimeout(veglia); veglia = null; }
  }

  const nascosta = () => document.visibilityState === 'hidden';

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
  // In una pagina nascosta nessuno scrive né trascina, e il fuoco rimasto in un campo non ferma il «Salta».
  function utenteOccupato() {
    if (nascosta()) return false;
    if (premuto) return true;
    const ct = global.SN_CAMPO_TESTO;
    try { return !!(ct && ct.scriveQui(document) !== false); } catch (_) { return false; }
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

  // Una pagina nascosta col «Salta» fuori dalla vista (si leggevano i commenti) nessuno la guarda: la si porta sul
  // pulsante per il clic vero e la si rimette com'era appena il clic è arrivato (#1494). Torna la funzione che rimette.
  const RIMETTI_MS = 10000;
  // Una sola rimessa alla volta: un secondo tentativo prima del clic segnerebbe come «com'era» la pagina già spostata.
  let rimettiInAttesa = null;
  function portaInVista(el) {
    if (rimettiInAttesa) {
      try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (_) {}
      return rimettiInAttesa;
    }
    const posti = [];
    for (let n = el.parentElement; n; n = n.parentElement) posti.push([n, n.scrollLeft, n.scrollTop]);
    const se = document.scrollingElement;
    if (se && !posti.some((p) => p[0] === se)) posti.push([se, se.scrollLeft, se.scrollTop]);
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (_) { return null; }
    let fatto = false;
    let timer = null;
    const rimetti = () => {
      if (fatto) return;
      fatto = true;
      rimettiInAttesa = null;
      clearTimeout(timer);
      window.removeEventListener('click', suClic, true);
      for (const [n, l, t] of posti) {
        if (n.scrollLeft !== l || n.scrollTop !== t) { try { n.scrollTo({ left: l, top: t, behavior: 'instant' }); } catch (_) {} }
      }
    };
    // Rimessa prima che il clic arrivi, la pagina lo riceverebbe in un altro punto: si aspetta il clic, o a lungo.
    function suClic(e) { if (e.isTrusted && e.target instanceof Node && el.contains(e.target)) setTimeout(rimetti, 0); }
    window.addEventListener('click', suClic, true);
    timer = setTimeout(rimetti, RIMETTI_MS);
    rimettiInAttesa = rimetti;
    return rimetti;
  }

  // false = per ora non si preme: il tentativo non si conta e si riguarda al giro dopo.
  // Un «Salta» coperto o fuori dalla vista (si sta leggendo più giù) prende un clic dello script, poi si aspetta di vederlo.
  function premi(el, s) {
    if (clicVero && !s.finto) {
      if (utenteOccupato()) return false;
      let p = centro(el);
      let rimetti = null;
      if (!p && nascosta()) {
        rimetti = portaInVista(el);
        p = rimetti && centro(el);
        if (!p && rimetti) { rimetti(); rimetti = null; }
      }
      if (p) {
        send({ type: T_CLICK, x: p.x, y: p.y, tag: mioTag }, (r) => {
          if (rimetti && !(r && r.ok)) rimetti();
          if (!r || (!r.ok && RIFIUTI_FERMI.has(r.code))) s.finto = true;
          else if (r.code === 'ignoto') presentati();
        });
        return true;
      }
      if (s.scriptProvato) return false;
      s.scriptProvato = true;
    }
    try { el.click(); } catch (_) {}
    return true;
  }

  // Il «Salta» premuto da Filo che se ne va: la pubblicità è saltata, e i contatori lo sanno (#1473). Solo il nome.
  function saltata() {
    send({ type: MSG.CONTATORI_EVENTO || 'contatori_evento', misura: 'automatismo', tipo: 'pubblicita_saltata' });
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
      if (!el.isConnected) { if (s.visibile && s.tentativi > 0) saltata(); seguiti.delete(el); continue; }
      if (!premibile(el)) {
        if (s.visibile && s.tentativi > 0) saltata();
        s.visibile = false;
        if (ora - s.visto > SEGUI_NASCOSTO_MS) seguiti.delete(el);
        continue;
      }
      visibili++;
      // Riapparso: è la pubblicità dopo, i tentativi ripartono.
      if (!s.visibile) Object.assign(s, { visibile: true, tentativi: 0, prossimo: 0, finto: false, scriptProvato: false });
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

  function segui(el) {
    if (!seguiti.has(el)) seguiti.set(el, { visto: Date.now(), visibile: false, tentativi: 0, prossimo: 0, finto: false });
  }

  function suAnimazione(e) {
    if (!attivo || e.animationName !== ANIM) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    segui(el);
    giro();
  }

  // Solo i «Salta» che il lettore mostra: uno spento che tiene nel DOM non va seguito a ogni giro.
  function vegliaNascosta() {
    if (veglia) { clearTimeout(veglia); veglia = null; }
    if (!attivo || !nascosta()) return;
    veglia = setTimeout(() => {
      veglia = null;
      let nuovi = 0;
      try {
        for (const el of document.querySelectorAll(SELETTORE)) {
          if (!seguiti.has(el) && premibile(el)) { segui(el); nuovi++; }
        }
      } catch (_) {}
      if (nuovi) giro();
      vegliaNascosta();
    }, VEGLIA_MS);
  }

  // Il lettore incorporato si presenta alla pagina sopra, e ogni frame intermedio fa lo stesso col suo: così ciascuno
  // sa quale dei suoi riquadri è il figlio che il main gli nominerà. Mai al momento del clic: la pagina non deve saperlo.
  function presentati() {
    if (inCima) return;
    try { window.parent.postMessage({ filoAdSkipCiao: mioTag }, '*'); } catch (_) {}
  }

  function riquadroDi(win) {
    return global.SN_RIQUADRI_IN_ARRIVO?.riquadroDi(win, document) || null;
  }

  function suMessaggio(e) {
    const d = e.data;
    if (!e.isTrusted || !d || typeof d !== 'object' || typeof d.filoAdSkipCiao !== 'string') return;
    if (!d.filoAdSkipCiao || d.filoAdSkipCiao.length > 64) return;
    const el = riquadroDi(e.source);
    if (!el) return;
    figli.set(el, { tag: d.filoAdSkipCiao, origine: String(e.origin || '') });
    presentati();
  }

  // Dove cade nella vista di questo frame il punto (x, y) del riquadro figlio con quel tag e quell'origine.
  // Un elemento del sito messo sopra al riquadro non deve ricevere il clic vero: allora niente.
  function dove(q) {
    if (!attivo) return { code: 'off' };
    if (nascosta()) return { code: 'nascosta' };
    if (utenteOccupato()) return { code: 'occupato' };
    let f = null;
    let visto = false;
    try {
      for (const el of document.querySelectorAll('iframe, frame')) {
        const r = figli.get(el);
        if (!r || r.tag !== q.tag) continue;
        visto = true;
        if (r.origine === q.origine) { f = el; break; }
      }
    } catch (_) { f = null; }
    if (!f) return { code: visto ? 'coperto' : 'ignoto' };
    if (typeof q.x !== 'number' || typeof q.y !== 'number' || q.x > f.clientWidth || q.y > f.clientHeight) return { code: 'coperto' };
    const r = f.getBoundingClientRect();
    // Un riquadro ruotato o in scala non ha i px del suo contenuto: il punto non si saprebbe dove cade.
    if (Math.abs(r.width - f.offsetWidth) > 1 || Math.abs(r.height - f.offsetHeight) > 1) return { code: 'coperto' };
    const cs = getComputedStyle(f);
    const x = r.left + f.clientLeft + (parseFloat(cs.paddingLeft) || 0) + q.x;
    const y = r.top + f.clientTop + (parseFloat(cs.paddingTop) || 0) + q.y;
    let sopra = null;
    try { sopra = document.elementFromPoint(x, y); } catch (_) { sopra = null; }
    if (sopra !== f) return { code: 'coperto' };
    const vv = inCima ? window.visualViewport : null;
    const p = vv ? { x: (x - vv.offsetLeft) * vv.scale, y: (y - vv.offsetTop) * vv.scale } : { x, y };
    return { x: p.x, y: p.y, tag: mioTag };
  }

  function suPuntatore(e) {
    if (!e.isTrusted) return;
    if (e.type === 'pointerdown') premuto = true;
    else if (e.type !== 'pointermove' || e.buttons === 0) premuto = false;
  }

  function imposta(r) {
    attivo = !!(r && r.ok && r.enabled);
    clicVero = attivo && !!r.clicVero;
    if (clicVero) presentati();
    if (attivo) { metti(); vegliaNascosta(); } else togli();
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
    window.addEventListener('message', suMessaggio);
    // Tornando sulla pagina (finestra ridotta a icona e riaperta) si riprova subito, anche dove i tentativi erano finiti.
    document.addEventListener('visibilitychange', () => {
      vegliaNascosta();
      if (document.visibilityState === 'visible') riprova();
    });
    chrome.runtime.onMessage.addListener((m) => {
      if (m && m.type === T_UPDATE) carica();
      else if (m && m.type === T_WHERE && typeof m.id === 'string') send({ type: T_HERE, id: m.id, ...dove(m) });
    });
  } catch (_) {}

  carica();

  global.SN_AD_SKIP = { SALTA, _stato: () => ({ attivo, clicVero, seguiti: seguiti.size, veglia: !!veglia }) };
})(typeof globalThis !== 'undefined' ? globalThis : self);
