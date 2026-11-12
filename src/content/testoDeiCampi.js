// Il testo scritto nei campi dei siti che non si perde (#2378): segue i campi dove scrive l'utente e, alla nascita della
// pagina, rimette nei campi vuoti quello che il main ha tenuto. Se e cosa tenere lo decide il main; mai password,
// carte, codici, ricerche, moduli d'accesso. Regole: src/shared/testoDeiCampi.js.

(function (global) {
  'use strict';
  if (global.SN_TESTO_CAMPI_PAGINA) return;
  if (!/^https?:$/.test(location.protocol)) return;
  const R = global.SN_TESTO_CAMPI;
  const S = global.SN_CAMPI_SEGRETI;
  const chrome = global.chrome;
  if (!R || !S || !chrome || !chrome.runtime) return;
  global.SN_TESTO_CAMPI_PAGINA = true;

  const MSG = (global.SN_MSG && global.SN_MSG.MSG) || {};
  const T = MSG.TESTO_CAMPI || 'testo_campi';
  const RIPOSO_MS = 400;
  const CONTROLLO_MS = 2000;
  // La pagina può disegnare i suoi campi tardi (un sito fatto di script): li si aspetta per un po', non per sempre.
  const ATTESA_CAMPI_MS = 15000;

  let Segreti = null;
  try { Segreti = S.crea(window, (t) => !!global.SN_GUARDIANO_STATICO?.cartaValida?.(t), { ricorda: true }); } catch (_) { return; }

  let segui = true;
  // Campo → { firma, ultimo }: l'ultimo valore che il main conosce.
  const seguiti = new Map();
  let riposo = null;
  let controllo = null;

  function send(msg) {
    return new Promise((ok) => {
      try {
        Promise.resolve(chrome.runtime.sendMessage({ type: T, ...msg })).then(ok, () => ok(null));
      } catch (_) { ok(null); }
    });
  }

  // I riquadri e i menu di Filo nella pagina non sono del sito: il loro testo parte o si butta con loro.
  function diFilo(el) {
    let nostre = [];
    try { nostre = global.SN_FILO_UI?.aperti?.() || []; } catch (_) {}
    for (let n = el; n && nostre.length;) {
      if (nostre.some((r) => r === n || (r.contains && r.contains(n)))) return true;
      const radice = n.getRootNode && n.getRootNode();
      n = radice && radice.host ? radice.host : null;
    }
    return false;
  }

  function tipoDi(el) {
    return el.tagName === 'TEXTAREA' ? '' : String(el.getAttribute('type') || 'text').toLowerCase();
  }

  // Gli editor dei siti (codice, documenti) ricevono i tasti in una casella minuscola o trasparente e tengono il testo
  // altrove: rimettere lì dentro scriverebbe nell'editor, sopra il salvataggio suo.
  function sembraUnaCasella(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 10) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && Number(cs.opacity) >= 0.1;
  }

  function idoneo(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return false;
    if (el.tagName === 'INPUT' && !R.TIPI.test(tipoDi(el))) return false;
    if (el.disabled || el.readOnly) return false;
    try {
      if (!sembraUnaCasella(el)) return false;
      // Un modulo con la password è un accesso o un'iscrizione: niente di quello che c'è dentro.
      if (el.form && el.form.querySelector('input[type=password]')) return false;
      if (Segreti.campoSegreto(el)) return false;
      const Ric = global.SN_RICERCA_CAMPO;
      if (Ric && Ric.eRicerca(Ric.trattiDi(el))) return false;
    } catch (_) { return false; }
    return !diFilo(el);
  }

  function etichettaDi(el) {
    let t = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    if (!t) { try { const l = el.labels && el.labels[0]; if (l) t = l.textContent || ''; } catch (_) {} }
    return String(t).replace(/\s+/g, ' ').trim();
  }

  function firmaDi(el) {
    const tag = el.tagName.toLowerCase();
    const tipo = tipoDi(el);
    let ordine = 0;
    try {
      const radice = el.getRootNode();
      for (const x of radice.querySelectorAll(tag)) {
        if (x === el) break;
        if (tipoDi(x) === tipo) ordine++;
      }
    } catch (_) {}
    return R.firmaPulita({ tag, tipo, id: el.id || '', nome: el.getAttribute('name') || '', etichetta: etichettaDi(el), ordine });
  }

  function bersaglio(e) {
    try {
      const p = e.composedPath();
      if (p && p[0] && p[0].nodeType === 1) return p[0];
    } catch (_) {}
    return e.target;
  }

  function attivo() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }

  function segue(el, ultimo, data = null) {
    if (seguiti.has(el)) return seguiti.get(el);
    const firma = data || firmaDi(el);
    if (!firma) return null;
    const s = { firma, ultimo };
    seguiti.set(el, s);
    if (!controllo) controllo = setInterval(manda, CONTROLLO_MS);
    return s;
  }

  // Quello che è cambiato dall'ultima volta, svuotato compreso: la pagina che toglie il testo dopo l'invio lo toglie
  // anche dal disco.
  function manda() {
    if (!segui) return;
    const campi = [];
    for (const [el, s] of seguiti) {
      if (!el.isConnected) { seguiti.delete(el); continue; }
      const v = String(el.value || '');
      if (v === s.ultimo) continue;
      s.ultimo = v;
      campi.push({ firma: s.firma, valore: v });
    }
    if (!seguiti.size && controllo) { clearInterval(controllo); controllo = null; }
    if (campi.length) send({ fase: 'scrivi', campi }).then((r) => { if (r && r.segui === false) smetti(); });
  }

  function smetti() {
    segui = false;
    seguiti.clear();
    if (controllo) { clearInterval(controllo); controllo = null; }
  }

  function aRiposo() {
    clearTimeout(riposo);
    riposo = setTimeout(manda, RIPOSO_MS);
  }

  function onInput(e) {
    if (!segui || rimettendo) return;
    const el = bersaglio(e);
    // Lo scrive l'utente, o Filo per lui (Incolla, dettatura) nel campo dove sta: un valore messo dalla pagina no.
    if (!e.isTrusted && attivo() !== el) return;
    if (!seguiti.has(el) && !idoneo(el)) return;
    if (!segue(el, null)) return;
    aRiposo();
  }

  // Il modulo che parte si porta via il suo testo: tornando sulla pagina (spesso la stessa) non deve ricomparire.
  function partiti(form) {
    if (!form || !seguiti.size) return;
    const campi = [];
    for (const [el, s] of seguiti) {
      if (el.form !== form && !(form.contains && form.contains(el))) continue;
      s.ultimo = String(el.value || '');
      campi.push({ firma: s.firma, valore: '' });
    }
    if (campi.length && segui) send({ fase: 'scrivi', campi });
  }
  function onSubmit(e) {
    const form = e.target;
    setTimeout(() => { if (!e.defaultPrevented) partiti(form); }, 0);
  }
  function onDatiModulo(e) { partiti(e.target); }

  // --- Il ritorno ---------------------------------------------------------------------------------------------------
  let rimasti = [];
  let rimettendo = false;
  let osservatore = null;
  let fineAttesa = 0;
  let prossimo = null;

  function tuttiICampi(radice, out = [], prof = 0) {
    try {
      for (const el of radice.querySelectorAll('input, textarea')) out.push(el);
      if (prof < 8) for (const n of radice.querySelectorAll('*')) if (n.shadowRoot) tuttiICampi(n.shadowRoot, out, prof + 1);
    } catch (_) {}
    return out;
  }

  function scriviNelCampo(el, valore) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    rimettendo = true;
    try {
      if (d && d.set) d.set.call(el, valore); else el.value = valore;
      // Chi disegna il campo con i suoi script (React e simili) tiene il testo solo se riceve l'evento.
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } finally { rimettendo = false; }
  }

  function rimetti() {
    prossimo = null;
    if (!segui || !rimasti.length) { fermaAttesa(); return; }
    const presenti = [];
    const campi = [];
    for (const el of tuttiICampi(document)) {
      if (seguiti.has(el) || String(el.value || '') !== '' || !idoneo(el)) continue;
      const firma = firmaDi(el);
      if (!firma) continue;
      presenti.push({ firma, indice: campi.length });
      campi.push(el);
    }
    if (!presenti.length) return;
    const fatti = R.abbina(rimasti, presenti);
    for (const { indice, valore, da } of fatti) {
      const el = campi[indice];
      scriviNelCampo(el, valore);
      // Il testo rimesso è ancora dell'utente: resta seguito con la firma con cui è stato tenuto, che così si aggiorna.
      segue(el, String(el.value || ''), R.firmaPulita(rimasti[da].firma));
    }
    const usati = new Set(fatti.map((f) => f.da));
    rimasti = rimasti.filter((_, i) => !usati.has(i));
    if (!rimasti.length) fermaAttesa();
  }

  function fermaAttesa() {
    if (osservatore) { try { osservatore.disconnect(); } catch (_) {} osservatore = null; }
    rimasti = [];
  }

  function aspettaCampi() {
    fineAttesa = Date.now() + ATTESA_CAMPI_MS;
    try {
      osservatore = new MutationObserver(() => {
        if (Date.now() > fineAttesa) { fermaAttesa(); return; }
        if (!prossimo) prossimo = setTimeout(rimetti, 150);
      });
      osservatore.observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {}
    setTimeout(() => { if (Date.now() >= fineAttesa) fermaAttesa(); }, ATTESA_CAMPI_MS + 50);
  }

  async function nascita() {
    const r = await send({ fase: 'leggi' });
    if (!r || r.segui === false) { smetti(); return; }
    rimasti = (Array.isArray(r.campi) ? r.campi : []).filter((c) => c && c.firma && typeof c.valore === 'string' && c.valore);
    if (!rimasti.length) return;
    const parti = () => { rimetti(); if (rimasti.length) aspettaCampi(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', parti, { once: true });
    else parti();
  }

  window.addEventListener('input', onInput, true);
  window.addEventListener('submit', onSubmit, true);
  window.addEventListener('formdata', onDatiModulo, true);
  // Una scheda chiusa o una pagina lasciata entro il riposo: l'ultimo tasto parte adesso.
  window.addEventListener('pagehide', () => { clearTimeout(riposo); manda(); }, true);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { clearTimeout(riposo); manda(); } });
  nascita();
})(typeof globalThis !== 'undefined' ? globalThis : self);
