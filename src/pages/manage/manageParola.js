// Gestione → Automazioni, la parola d'ordine «owner non fidato» (SPEC-SEDI §4.5): salvarla, cambiarla, toglierla.
// La parola resta nel main, qui arriva solo se c'è; «Discutiamone» (manageDomande.js) lo chiede a SN_MANAGE_PAROLA.
// Prove: tests/manage-domande-parola.spec.mjs.

(function () {
  'use strict';

  const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
  const T = {
    stato: MSG.PAROLA_OWNER_STATO || 'parola_owner_stato',
    salva: MSG.PAROLA_OWNER_SALVA || 'parola_owner_salva',
    togli: MSG.PAROLA_OWNER_TOGLI || 'parola_owner_togli',
    cambiata: MSG.PAROLA_OWNER_CAMBIATA || 'parola_owner_cambiata',
  };
  const $ = (id) => document.getElementById(id);
  const campo = $('mgParola');
  const salvaBtn = $('mgParolaSalva');
  const togliBtn = $('mgParolaTogli');
  const msgEl = $('mgParolaMsg');
  const statoEl = $('mgParolaStato');
  const TITOLO_TOGLI = 'Toglila da questo computer: «Discutiamone» copierà solo la riga';

  let stato = { salvata: false, suDisco: false };
  let inVolo = false;
  const ascoltatori = [];

  // Chiamato a ogni invio: le prove sostituiscono window.filo.message dopo il caricamento.
  function send(m) {
    if (window.filo && window.filo.message) return window.filo.message(m);
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) return chrome.runtime.sendMessage(m);
    return Promise.reject(new Error('canale main non disponibile'));
  }
  async function chiedi(m) {
    try { return (await send(m)) || { ok: false }; } catch (_) { return { ok: false }; }
  }
  function errore(r, ripiego) { return r && r.code !== 'forbidden' && r.error ? r.error : ripiego; }

  function dici(testo, tipo) {
    if (!msgEl) return;
    msgEl.textContent = testo || '';
    msgEl.classList.toggle('mg-ok', tipo === 'ok');
    msgEl.classList.toggle('mg-err', tipo === 'err');
  }

  function aggiorna(r) {
    const prima = stato.salvata;
    stato = { salvata: !!(r && r.salvata), suDisco: !!(r && r.salvata && r.suDisco) };
    if (statoEl) statoEl.textContent = stato.salvata ? (stato.suDisco ? '· salvata' : '· salvata fino alla chiusura di Filo') : '';
    if (campo) campo.placeholder = stato.salvata ? 'Incollane un’altra per cambiarla' : 'Incollala qui';
    if (togliBtn) togliBtn.hidden = !stato.salvata;
    if (!stato.salvata) disarma();
    if (prima !== stato.salvata) for (const fn of ascoltatori) { try { fn(stato.salvata); } catch (_) {} }
  }

  async function leggi() {
    const r = await chiedi({ type: T.stato });
    if (r.ok) aggiorna(r);
  }

  async function salva() {
    if (inVolo || !campo) return;
    inVolo = true;
    salvaBtn.disabled = true;
    dici('Salvo…');
    const r = await chiedi({ type: T.salva, parola: campo.value });
    inVolo = false;
    salvaBtn.disabled = false;
    if (!r.ok) { dici(errore(r, 'Non salvata: riprova.'), 'err'); return; }
    campo.value = '';
    aggiorna(r);
    if (r.suDisco) dici('Salvata: «Discutiamone» la copia insieme alla riga.', 'ok');
    else dici('Salvata solo fino alla chiusura di Filo: questo computer non la sa cifrare, e in chiaro non la scrivo.', 'err');
  }

  // Dal server non si rilegge: toglierla vuole un secondo clic, sullo stesso tasto (patterns/una-conferma-sul-posto-tiene-ferma-la-sua-scatola.md).
  let armato = false;
  let timer = null;
  function disarma() {
    armato = false;
    if (timer) { clearTimeout(timer); timer = null; }
    if (!togliBtn) return;
    window.SN_CONFERMA_SUL_POSTO.disarma(togliBtn, 'Togli');
    togliBtn.title = TITOLO_TOGLI;
  }
  async function togli(e) {
    if (inVolo) return;
    if (armato && e && e.detail > 1) return;
    if (!armato) {
      armato = true;
      window.SN_CONFERMA_SUL_POSTO.arma(togliBtn, 'Confermi?');
      togliBtn.title = 'Dal server non si rilegge: se non l’hai anche altrove, ne servirà una nuova';
      timer = setTimeout(disarma, 5000);
      return;
    }
    disarma();
    inVolo = true;
    togliBtn.disabled = true;
    dici('Tolgo…');
    const r = await chiedi({ type: T.togli });
    inVolo = false;
    togliBtn.disabled = false;
    if (!r.ok) { dici(errore(r, 'Non tolta: riprova.'), 'err'); return; }
    aggiorna(r);
    dici('Tolta: «Discutiamone» copia solo la riga.', 'ok');
  }

  if (campo && salvaBtn && togliBtn) {
    togliBtn.title = TITOLO_TOGLI;
    salvaBtn.title = 'Salvala su questo computer, cifrata';
    salvaBtn.addEventListener('click', salva);
    togliBtn.addEventListener('click', togli);
    campo.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      salva();
    });
    campo.addEventListener('input', () => { if (msgEl && msgEl.classList.contains('mg-err')) dici(''); });
    // Un campo di una riga cambia in spazi gli a capo, da qualunque strada arrivino (incolla, trascina, inserimento):
    // due righe diventerebbero una parola sbagliata, senza dirlo. Gli spazi ai bordi si tolgono solo da un incollato.
    campo.addEventListener('beforeinput', (e) => {
      const tipo = e.inputType || '';
      if (!tipo.startsWith('insert')) return;
      const testo = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || e.data || '';
      const incollato = /^insert(From|Replacement)/.test(tipo);
      if (!/[\r\n]/.test(testo) && !(incollato && /^\s|\s$/.test(testo))) return;
      const righe = testo.split(/\r\n|\r|\n/).map((r) => r.trim()).filter(Boolean);
      e.preventDefault();
      if (righe.length > 1) { dici('Hai incollato più righe: incolla solo la parola d’ordine.', 'err'); return; }
      campo.setRangeText(righe[0] || '', campo.selectionStart, campo.selectionEnd, 'end');
      dici('');
    });
  }
  // Salvata o tolta da un'altra Gestione aperta: l'annuncio non porta la parola, lo stato si rilegge.
  if (window.chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((m) => { if (m && m.type === T.cambiata) leggi(); });
  }
  leggi();

  window.SN_MANAGE_PAROLA = {
    salvata: () => stato.salvata,
    alCambio(fn) { if (typeof fn === 'function') ascoltatori.push(fn); },
    // Una copia ha appena detto se c'era: se lo stato di qui è vecchio, si rilegge.
    vista(salvata) { if (!!salvata !== stato.salvata) leggi(); },
  };
})();
