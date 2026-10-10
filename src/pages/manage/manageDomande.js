// Sezione Domande di Gestione (SPEC-DOMANDE §3): legge le domande dal main e le elenca nelle tre schede.
// Non decide la sezione d'apertura né i contatori (manage.js, con le regole di manageReview.js).
// Finché il server non pubblica le domande lo dice, senza numeri. Prove: tests/manage-domande.spec.mjs.

(function () {
  'use strict';

  const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
  const ELENCO = MSG.DOMANDE_ELENCO || 'domande_elenco';
  const MR = window.SN_MANAGE_REVIEW;
  const $ = (id) => document.getElementById(id);

  const VUOTO = {
    domande: 'Nessuna domanda da rispondere.',
    'domande-lavoro': 'Nessuna domanda in lavorazione.',
    'domande-archivio': 'Nessuna domanda in archivio.',
  };
  const PRIORITA = { bloccante: 'Bloccante', importante: 'Importante', quando_puoi: 'Quando puoi' };

  // `lette` falso dopo un errore: un numero vecchio accanto a un guasto direbbe più di quanto si sa.
  const stato = { lette: false, fallita: false, nonDisponibile: false, errore: '', domande: [], riferimenti: {} };
  let finte = false;
  let inVolo = null;
  let scheda = 'domande';
  const ascoltatori = [];

  // Chiamato a ogni invio: le prove sostituiscono window.filo.message dopo il caricamento.
  function send(m) {
    if (window.filo && window.filo.message) return window.filo.message(m);
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) return chrome.runtime.sendMessage(m);
    return Promise.reject(new Error('canale main non disponibile'));
  }

  // Messaggio che il main non conosce ancora, o funzione del server non pubblicata: non è un guasto da riprovare.
  function nonPubblicata(err) {
    return /sconosciuto|non ancora pubblicat|not[ _-]?found/i.test(String(err || ''));
  }

  function cambia() {
    disegna();
    for (const fn of ascoltatori) {
      try { fn(); } catch (e) { console.error('[manage] domande:', e); }
    }
  }

  function carica() {
    if (finte) return Promise.resolve(stato);
    if (inVolo) return inVolo;
    inVolo = (async () => {
      let r;
      try { r = await send({ type: ELENCO }); } catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
      if (finte) return stato;
      if (r && r.ok && Array.isArray(r.domande)) {
        Object.assign(stato, {
          lette: true, fallita: false, nonDisponibile: false, errore: '',
          domande: r.domande, riferimenti: r.riferimenti || {},
        });
      } else {
        const errore = String((r && r.error) || 'nessuna risposta');
        Object.assign(stato, { lette: false, fallita: true, nonDisponibile: nonPubblicata(errore), errore, domande: [], riferimenti: {} });
      }
      cambia();
      return stato;
    })().finally(() => { inVolo = null; });
    return inVolo;
  }

  function dataBreve(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '';
    try { return new Date(n).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }); } catch (_) { return ''; }
  }

  function riga(d) {
    const li = document.createElement('li');
    li.className = 'mg-domanda';
    li.dataset.id = String(d.id || '');
    li.dataset.priorita = String(d.priorita || '');
    const parte = (cls, testo) => {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = testo;
      li.appendChild(s);
    };
    parte('mg-domanda-num', Number.isInteger(d.numero) ? `D-${d.numero}` : String(d.id || ''));
    parte('mg-domanda-titolo', String(d.titolo || '(senza titolo)'));
    parte('mg-domanda-prio', PRIORITA[d.priorita] || '');
    const quando = dataBreve(d.creataIl);
    if (quando) parte('mg-domanda-data', quando);
    return li;
  }

  function disegna() {
    const el = $('mgDomandeStato');
    const lista = $('mgDomandeLista');
    const riprova = $('mgDomandeRiprova');
    if (!el || !lista || !MR) return;
    if (riprova) riprova.hidden = true;
    lista.hidden = true;
    lista.replaceChildren();
    el.hidden = false;
    if (!stato.lette) {
      if (stato.nonDisponibile) {
        el.textContent = 'Le domande non sono ancora disponibili: il server non le pubblica ancora.';
      } else if (stato.fallita) {
        el.textContent = `Non riesco a leggere le domande: ${stato.errore}`;
        if (riprova) riprova.hidden = false;
      } else {
        el.textContent = 'Caricamento…';
      }
      return;
    }
    const mie = stato.domande.filter((d) => MR.schedaDomanda(d) === scheda);
    const D = window.SN_DOMANDE;
    const ordinate = D && typeof D.ordina === 'function' ? D.ordina(mie) : mie;
    if (!ordinate.length) { el.textContent = VUOTO[scheda] || ''; return; }
    el.hidden = true;
    lista.hidden = false;
    for (const d of ordinate) lista.appendChild(riga(d));
  }

  const riprova = $('mgDomandeRiprova');
  if (riprova) riprova.addEventListener('click', () => { carica(); });

  window.SN_MG_DOMANDE = {
    carica,
    stato: () => stato,
    mostra(tab) { if (VUOTO[tab] !== undefined) scheda = tab; disegna(); },
    alCambio(fn) { if (typeof fn === 'function') ascoltatori.push(fn); },
    // Solo per le prove: domande finte (o un guasto finto) al posto del main, che da lì non le rimpiazza più.
    imposta(lista, opts) {
      finte = true;
      const errore = opts && opts.errore ? String(opts.errore) : '';
      Object.assign(stato, errore
        ? { lette: false, fallita: true, nonDisponibile: nonPubblicata(errore), errore, domande: [], riferimenti: {} }
        : { lette: true, fallita: false, nonDisponibile: false, errore: '', domande: Array.isArray(lista) ? lista : [], riferimenti: (opts && opts.riferimenti) || {} });
      cambia();
    },
  };
})();
