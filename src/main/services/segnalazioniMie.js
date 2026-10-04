// Copia locale delle segnalazioni mandate da questo computer (#986): testo, nomi degli allegati, data, numero e stato, in file propri (userData/segnalazioni-mie).
// Non spedisce e non legge niente dal server: «risolta» arriva dall'annuncio all'avvio. L'incognito non scrive e non legge.
// Regole: patterns/un-archivio-che-cresce-sta-in-file-suoi-a-sole-aggiunte.md; prove: tests/unit/segnalazioniMie.test.mjs, tests/segnalazioni-mie.spec.mjs.

(function (global) {
  'use strict';

  const path = require('node:path');
  const { creaDeposito } = require('./depositoAggiunte');
  const Disco = require('../shim/storage');

  // Sotto questa chiave l'elenco entra nel backup di «Esporta dati» e ne riesce.
  const CHIAVE_BACKUP = 'sn_segnalazioni_mie';
  const STATI = ['in_partenza', 'inviata', 'non_partita', 'risolta', 'chiusa'];

  function cartella() {
    const root = process.env.FILO_USER_DATA || require('electron').app.getPath('userData');
    return path.join(root, 'segnalazioni-mie');
  }

  function meseDi(v) {
    const d = new Date(v && v.creataIl);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 7);
  }

  /** I nomi degli allegati, nell'ordine e coi nomi che usa l'invio quando un allegato non parte. PURA. */
  function nomiAllegati(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const out = [];
    (Array.isArray(p.images) ? p.images : []).forEach((img, i) => {
      if (img && img.dataUrl) out.push(String(img.name || `immagine ${i + 1}`));
    });
    for (const f of Array.isArray(p.files) ? p.files : []) {
      if (f) out.push(String(f.name || 'allegato'));
    }
    return out;
  }

  /** La voce da scrivere, qualunque cosa arrivi. PURA. */
  function voce({ id, testo, allegati, creataIl, stato, num, titolo, feedbackId } = {}) {
    const quando = new Date(creataIl || Date.now());
    return {
      id: String(id || ''),
      testo: String(testo || ''),
      allegati: Array.isArray(allegati) ? allegati.map(String) : [],
      creataIl: (Number.isNaN(quando.getTime()) ? new Date() : quando).toISOString(),
      stato: STATI.includes(stato) ? stato : 'in_partenza',
      num: String(num || ''),
      titolo: String(titolo || ''),
      feedbackId: String(feedbackId || ''),
      risposta: '',
    };
  }

  /**
   * Cosa cambia un evento su una voce, o null se non cambia niente. PURA.
   * Una chiusura annunciata non torna indietro, e «non partita» vale solo per
   * ciò che era ancora in partenza.
   */
  function applica(attuale, evento, dati = {}) {
    if (!attuale) return null;
    const chiusa = attuale.stato === 'risolta' || attuale.stato === 'chiusa';
    const patch = {};
    if (evento === 'inviata') {
      if (!chiusa) patch.stato = 'inviata';
      if (dati.feedbackId) patch.feedbackId = String(dati.feedbackId);
    } else if (evento === 'non_partita') {
      if (attuale.stato !== 'in_partenza') return null;
      patch.stato = 'non_partita';
    } else if (evento === 'risolta' || evento === 'chiusa') {
      patch.stato = evento;
      if (dati.risposta) patch.risposta = String(dati.risposta);
    } else {
      return null;
    }
    if (dati.num) patch.num = String(dati.num);
    if (dati.titolo) patch.titolo = String(dati.titolo);
    for (const k of Object.keys(patch)) if (attuale[k] === patch[k]) delete patch[k];
    return Object.keys(patch).length ? patch : null;
  }

  // Chi entra nell'elenco solo all'annuncio (vedi `chiusa`) non deve essere una voce tolta dall'utente: di quelle resta
  // l'identificativo, mai il testo. La data di nascita esclude anche ciò che l'incognito non ha scritto.
  const fs = require('node:fs');
  const FILE_NASCITA = 'nato-il.txt';
  const FILE_TOLTE = 'tolte.json';
  let nataIl = 0;
  let tolte = new Set();
  function leggiNascita() {
    const file = path.join(cartella(), FILE_NASCITA);
    try {
      const t = Date.parse(fs.readFileSync(file, 'utf8').trim());
      if (Number.isFinite(t)) return t;
    } catch (_) {}
    const ora = Date.now();
    try {
      fs.mkdirSync(cartella(), { recursive: true });
      fs.writeFileSync(file, new Date(ora).toISOString() + '\n', 'utf8');
    } catch (_) {}
    return ora;
  }
  function leggiTolte() {
    try {
      const a = JSON.parse(fs.readFileSync(path.join(cartella(), FILE_TOLTE), 'utf8'));
      return new Set(Array.isArray(a) ? a.map(String) : []);
    } catch (_) { return new Set(); }
  }
  function scriviTolte() {
    try {
      fs.mkdirSync(cartella(), { recursive: true });
      fs.writeFileSync(path.join(cartella(), FILE_TOLTE), JSON.stringify([...tolte]) + '\n', 'utf8');
    } catch (_) {}
  }

  let apertura = null;
  function apri() {
    if (!apertura) {
      apertura = (async () => {
        const d = creaDeposito({ cartella: cartella(), meseDi });
        await d.carica();
        nataIl = leggiNascita();
        tolte = leggiTolte();
        return d;
      })();
      apertura.catch(() => { apertura = null; });
    }
    return apertura;
  }

  // Le pagine aperte rileggono da sole; il segnale non porta dati e non va alle finestre incognito.
  function annuncia() {
    const tipo = (global.SN_MSG && global.SN_MSG.MSG.SEGNALAZIONI_MIE_CAMBIATE) || 'segnalazioni_mie_cambiate';
    try { global.SN_BROADCAST_FILO && global.SN_BROADCAST_FILO((ambito) => (ambito ? null : { type: tipo })); } catch (_) {}
  }

  /** Scrive una segnalazione appena mandata. Dall'incognito non scrive niente. */
  async function registra(dati) {
    if (Disco.inIncognito()) return null;
    const v = voce(dati);
    if (!v.id) return null;
    const r = (await apri()).aggiungi(v);
    if (r) annuncia();
    return r;
  }

  // Gli aggiornamenti non guardano l'incognito: arrivano dalla coda d'invio o dall'annuncio, che girano per tutte
  // le finestre, e una voce esiste solo se è nata fuori dall'incognito.
  async function aggiorna(trova, evento, dati) {
    const d = await apri();
    const attuale = trova(d);
    const patch = applica(attuale, evento, dati);
    if (!patch) return attuale;
    const r = d.aggiorna(attuale.id, patch);
    annuncia();
    return r;
  }

  const perId = (id) => (d) => d.prendi(String(id || ''));
  const perFeedback = (fid) => (d) => {
    const key = String(fid || '');
    return key ? d.tutti().find((v) => v.feedbackId === key || v.id === key) || null : null;
  };

  const inviata = (id, dati) => aggiorna(perId(id), 'inviata', dati);
  const nonPartita = (id) => aggiorna(perId(id), 'non_partita');
  /**
   * L'annuncio all'avvio: `stato` è 'risolta' o 'chiusa' (archiviata o doppia, senza modifiche).
   * Una segnalazione mandata prima che l'elenco esistesse entra qui, coi dati dell'annuncio; una più recente che
   * manca l'ha tolta l'utente, e non torna.
   */
  async function chiusa(feedbackId, { stato, creataIl, ...dati } = {}) {
    const evento = stato === 'chiusa' ? 'chiusa' : 'risolta';
    const d = await apri();
    const fid = String(feedbackId || '');
    if (!fid || perFeedback(fid)(d) || Disco.inIncognito()) return aggiorna(perFeedback(fid), evento, dati);
    // Una scheda può non avere la data (le più vecchie la scrivono vuota): senza, la segnalazione è di prima.
    const quando = Date.parse(creataIl || '');
    if (tolte.has(fid) || (Number.isFinite(quando) && quando >= nataIl)) return null;
    const v = voce({ id: fid, feedbackId: fid, creataIl, stato: 'inviata', num: dati.num, titolo: dati.titolo });
    const patch = applica(v, evento, dati) || {};
    const r = d.aggiungi({ ...v, ...patch }, { inCoda: true });
    if (r) annuncia();
    return r;
  }

  /** Questo computer aveva già mandato segnalazioni (il registro dei numeri le conosce)? */
  async function haPrecedenti() {
    try {
      const reg = await global.SN_FEEDBACK_MINE?.leggi?.();
      return !!(reg && ((Array.isArray(reg.ids) && reg.ids.length) || reg.ereditaFinoA));
    } catch (_) { return false; }
  }

  /** L'elenco, o null dall'incognito (che non lo vede). */
  async function elenco() {
    if (Disco.inIncognito()) return null;
    return (await apri()).tutti();
  }

  async function togli(id) {
    if (Disco.inIncognito()) return [];
    const d = await apri();
    const v = d.prendi(String(id || ''));
    if (v) {
      for (const k of [v.id, v.feedbackId]) if (k) tolte.add(String(k));
      scriviTolte();
    }
    if (d.togli([String(id || '')])) annuncia();
    return d.tutti();
  }

  async function svuota() {
    if (Disco.inIncognito()) return;
    (await apri()).svuota();
    tolte = new Set();
    try { fs.unlinkSync(path.join(cartella(), FILE_TOLTE)); } catch (_) {}
    annuncia();
  }

  // Un backup rimette le voci che mancano, dietro alle presenti.
  async function importa(voci) {
    if (Disco.inIncognito() || !Array.isArray(voci)) return 0;
    const pronte = voci
      .filter((v) => v && typeof v === 'object' && typeof v.id === 'string' && v.id)
      .map((v) => ({ ...voce(v), risposta: String(v.risposta || '') }));
    const n = (await apri()).aggiungiMolti(pronte, { inCoda: true }).length;
    if (n) annuncia();
    return n;
  }

  global.SN_SEGNALAZIONI_MIE = {
    CHIAVE_BACKUP, STATI,
    nomiAllegati, voce, applica,
    registra, inviata, nonPartita, chiusa, elenco, togli, svuota, importa, cartella, haPrecedenti,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.SN_SEGNALAZIONI_MIE;
}
