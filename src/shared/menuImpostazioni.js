// Il tasto destro su una voce delle pagine delle impostazioni (Preferenze, Modelli, Altro, Sicurezza, #2096): Rimetti di
// serie, Spiega cosa fa, Chiedi a Filo. Quale impostazione è lo dice il controllo della riga, tramite l'elenco unico di
// src/shared/vociImpostazioni.js; non sa niente delle singole pagine. Il menu lo apre src/content/content.js.
(function (global) {
  'use strict';
  if (global.SN_MENU_IMPOSTAZIONI) return;

  const PAGINE = { 'preferences.html': 'preferences', 'options.html': 'options', 'altro.html': 'altro', 'security.html': 'security' };
  const CONTROLLI = 'input[id], select[id], textarea[id]';
  let aiutoAcceso = true;

  function paginaDi(loc = global.location) {
    const nome = String((loc && loc.pathname) || '').split('/').pop();
    return PAGINE[nome] || null;
  }

  function nidifica(percorso, valore) {
    const parti = String(percorso).split('.');
    const out = {};
    let x = out;
    parti.forEach((k, i) => { if (i === parti.length - 1) x[k] = valore; else x = (x[k] = {}); });
    return out;
  }

  // La voce sotto il puntatore: il controllo stesso, quello della sua etichetta, o l'unico controllo dell'impostazione
  // nella riga più stretta che lo contiene. Due impostazioni nella stessa riga: nessuna, meglio che quella sbagliata.
  function voceDi(target, pagina = paginaDi()) {
    const V = global.SN_VOCI_IMPOSTAZIONI;
    const el = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
    if (!V || !pagina || !el || !el.closest) return null;
    const campi = V.campi(pagina);
    const conId = (id) => (id && Object.prototype.hasOwnProperty.call(campi, id) ? { id, percorso: campi[id] } : null);
    const etichetta = el.closest('label[for]');
    const diretta = conId(el.id) || (etichetta && conId(etichetta.getAttribute('for')));
    if (diretta) return { ...diretta, riga: el.closest('.sn-toggle-row, label, .sn-field') || el };
    for (let n = el; n && n !== global.document.body; n = n.parentElement) {
      const dentro = [...n.querySelectorAll(CONTROLLI)].map((c) => conId(c.id)).filter(Boolean);
      const unici = [...new Map(dentro.map((d) => [d.percorso, d])).values()];
      if (unici.length === 1) return { ...unici[0], riga: n };
      if (unici.length > 1 || n.tagName === 'SECTION') return null;
    }
    return null;
  }

  // Il nome come lo legge l'utente: l'etichetta del controllo, o il titolo della sua riga.
  function nomeDi(v) {
    const doc = global.document;
    const lab = doc.querySelector(`label[for="${CSS.escape(v.id)}"]`) || (doc.getElementById(v.id) || {}).closest?.('label');
    const testo = String(((lab || v.riga) && (lab || v.riga).textContent) || '').replace(/\s+/g, ' ').trim();
    return testo.length > 80 ? `${testo.slice(0, 79)}…` : testo || v.percorso;
  }

  // Una chiave non entra nel registro dei cambi: tolta, non si riavrà da nessun Annulla.
  const segreto = (v) => /^apiKeys\./.test(v.percorso) || ((global.document.getElementById(v.id) || {}).type === 'password');

  // Quello che l'utente ha scritto e che il valore di serie cancellerebbe: le voci di un elenco che spariscono, un
  // testo (una chiave) che diventa un altro. Numeri e interruttori si rimettono senza chiedere: tornano con Annulla.
  function cosaSiPerde(attuale, diSerie) {
    if (Array.isArray(attuale)) {
      const resta = Array.isArray(diSerie) ? diSerie.map((x) => JSON.stringify(x)) : [];
      return attuale.filter((x) => !resta.includes(JSON.stringify(x)));
    }
    if (typeof attuale === 'string' && attuale.trim() && attuale !== diSerie) return [attuale];
    return [];
  }

  async function rimettiDiSerie(v, nome) {
    const V = global.SN_VOCI_IMPOSTAZIONI;
    const MSG = global.SN_MSG && global.SN_MSG.MSG;
    const valore = V.leggi({}, v.percorso);
    if (valore === undefined || !MSG) return false;
    const R = global.chrome.runtime;
    let attuale;
    try {
      const r = await R.sendMessage({ type: MSG.GET_SETTINGS });
      attuale = V.leggi((r && (r.settings || r)) || {}, v.percorso);
    } catch (_) { attuale = undefined; }
    const perse = cosaSiPerde(attuale, valore);
    if (perse.length) {
      const C = global.SN_CONFIRM_UI;
      const chiave = segreto(v);
      const elenco = Array.isArray(attuale);
      const ok = C ? await C.confirm({
        title: chiave ? 'Togliere la chiave?' : elenco ? 'Svuotare l’elenco?' : 'Rimettere di serie?',
        text: chiave ? `La chiave «${nome}» viene tolta. Per riaverla dovrai incollarla di nuovo: Filo non ne tiene una copia.`
          : elenco ? `«${nome}» perde ${perse.length === 1 ? 'la voce che hai scritto' : `le ${perse.length} voci che hai scritto`}: ${perse.slice(0, 5).map(String).join(', ')}${perse.length > 5 ? '…' : ''}.`
            : `«${nome}» perde il testo che hai scritto.`,
        okLabel: chiave ? 'Togli la chiave' : elenco ? 'Svuota' : 'Rimetti di serie',
      }) : false;
      if (ok !== true) return false;
    }
    return R.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: nidifica(v.percorso, valore) }).then(() => true, () => false);
  }

  function vociMenu(target) {
    const v = voceDi(target);
    if (!v) return [];
    const I = global.SN_ICONS || {};
    const icona = (n) => (typeof I[n] === 'function' ? I[n](16) : '');
    const nome = nomeDi(v);
    const voci = [];
    if (global.SN_VOCI_IMPOSTAZIONI.leggi({}, v.percorso) !== undefined) {
      voci.push({ type: 'item', icon: icona('undo'), label: 'Rimetti di serie', onClick: () => { rimettiDiSerie(v).catch(() => {}); } });
    }
    const S = global.SN_SIDEBAR;
    if (aiutoAcceso && S && typeof S.chiediDaPagina === 'function') {
      voci.push({ type: 'item', icon: icona('question'), label: 'Spiega cosa fa', onClick: () => S.chiediDaPagina(`Cosa fa l'impostazione «${nome}»?`, { invia: true }) });
      voci.push({ type: 'item', icon: icona('sparkles'), label: 'Chiedi a Filo', onClick: () => S.chiediDaPagina(`Sull'impostazione «${nome}»:`) });
    }
    return voci;
  }

  // Spiega e Chiedi passano dall'Aiuto: col suo interruttore spento in Preferenze le voci non ci sono.
  function seguiAiuto() {
    const MSG = global.SN_MSG && global.SN_MSG.MSG;
    const R = global.chrome && global.chrome.runtime;
    if (!MSG || !R) return;
    const leggi = (s) => { aiutoAcceso = !(s && s.featureFlags && s.featureFlags.help === false); };
    try { Promise.resolve(R.sendMessage({ type: MSG.GET_SETTINGS })).then((r) => leggi(r && (r.settings || r))).catch(() => {}); } catch (_) {}
    try { R.onMessage.addListener((m) => { if (m && m.type === MSG.SETTINGS_UPDATED && m.settings) leggi(m.settings); }); } catch (_) {}
  }

  global.SN_MENU_IMPOSTAZIONI = { voceDi, vociMenu, nidifica, paginaDi };
  if (global.document && paginaDi()) {
    global.SN_VOCI_PAGINA = Array.isArray(global.SN_VOCI_PAGINA) ? global.SN_VOCI_PAGINA : [];
    if (!global.SN_VOCI_PAGINA.includes(vociMenu)) global.SN_VOCI_PAGINA.push(vociMenu);
    seguiAiuto();
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
