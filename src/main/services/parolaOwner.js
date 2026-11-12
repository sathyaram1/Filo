// La parola d'ordine «owner non fidato» che «Discutiamone» in Gestione copia (SPEC-SEDI §4.5): cifrata col sistema in
// userData, mai in chiaro su disco né nei log, mai fino alla pagina; senza cifratura vale fino alla chiusura.
// Prove: tests/unit/parolaOwner.test.mjs, tests/manage-domande-parola.spec.mjs.
'use strict';

require('../../shared/domande.js');

const NOME_FILE = 'parola-owner.bin';
// Largo: una parola d'ordine del server è di qualche decina di caratteri, oltre è un incollato con dentro altro.
const MAX_CARATTERI = 1000;
// Chi incolla la riga già copiata da «Discutiamone» porta con sé anche l'etichetta.
const ETICHETTA = globalThis.SN_DOMANDE.ETICHETTA_PAROLA_RE;

/** PURA. `testo` incollato → { ok, parola } | { ok:false, error } col motivo per l'owner. */
function controlla(testo) {
  if (typeof testo !== 'string') return { ok: false, error: 'Incolla la parola d’ordine.' };
  const parola = testo.trim().replace(ETICHETTA, '').trim();
  if (!parola) return { ok: false, error: 'Incolla la parola d’ordine: il campo è vuoto.' };
  if (/[\r\n]/.test(parola)) return { ok: false, error: 'La parola d’ordine sta su una riga sola: con lei hai incollato anche altro.' };
  if (/[\u0000-\u001f\u007f]/.test(parola)) return { ok: false, error: 'Dentro ci sono caratteri che non si scrivono: incollala di nuovo.' };
  if (parola.length > MAX_CARATTERI) {
    return { ok: false, error: `È lunga ${parola.length} caratteri, al massimo ${MAX_CARATTERI}: con lei hai incollato anche altro.` };
  }
  return { ok: true, parola };
}

function depositoDiSistema() {
  const electron = require('electron');
  const fs = require('node:fs');
  const path = require('node:path');
  const Disco = require('./scritturaAtomica');
  const file = () => path.join(electron.app.getPath('userData'), NOME_FILE);
  return {
    cifra() { try { return electron.safeStorage.isEncryptionAvailable(); } catch (_) { return false; } },
    leggi() {
      const raw = Disco.leggiSync(file());
      return raw ? electron.safeStorage.decryptString(raw) : null;
    },
    scrivi(parola) { Disco.scriviSync(file(), electron.safeStorage.encryptString(parola), { mode: 0o600 }); },
    togli() { fs.rmSync(file(), { force: true }); },
  };
}

function appuntiDiSistema() {
  return { scrivi(testo) { require('electron').clipboard.writeText(testo); } };
}

// `deposito` { cifra(), leggi(), scrivi(parola), togli() } e `appunti` { scrivi(testo) }: quelli veri fuori dai test.
function crea({ deposito, appunti } = {}) {
  const dep = deposito || depositoDiSistema();
  const ap = appunti || appuntiDiSistema();
  let inMemoria; // undefined: il disco non è ancora stato letto
  let suDisco = false;

  function leggi() {
    if (inMemoria !== undefined) return inMemoria;
    inMemoria = null;
    if (!dep.cifra()) return inMemoria;
    try {
      const c = controlla(dep.leggi());
      if (c.ok) { inMemoria = c.parola; suDisco = true; }
    } catch (_) { /* cifrata con un'altra chiave del sistema: come assente, si reincolla e si riscrive */ }
    return inMemoria;
  }

  function stato() {
    const p = leggi();
    return { salvata: !!p, suDisco: !!p && suDisco };
  }

  function salva(testo) {
    const c = controlla(testo);
    if (!c.ok) return c;
    leggi();
    inMemoria = c.parola;
    suDisco = false;
    try {
      // In chiaro non si scrive; una vecchia rimasta sul disco tornerebbe al prossimo avvio al posto di questa.
      if (dep.cifra()) { dep.scrivi(c.parola); suDisco = true; } else dep.togli();
    } catch (e) {
      console.warn('[Filo] parola d’ordine dell’owner non scritta sul disco:', (e && e.code) || 'errore');
    }
    return { ok: true, ...stato() };
  }

  function togli() {
    try { dep.togli(); } catch (e) {
      console.warn('[Filo] parola d’ordine dell’owner non tolta dal disco:', (e && e.code) || 'errore');
      return { ok: false, error: 'Non riesco a toglierla dal disco: riprova.' };
    }
    inMemoria = null;
    suDisco = false;
    return { ok: true, salvata: false, suDisco: false };
  }

  function copiaDiscuti(id) {
    const D = globalThis.SN_DOMANDE;
    if (D.numeroDi(id) === null) return { ok: false, error: 'Domanda sconosciuta.' };
    const pulito = String(id).trim();
    const parola = leggi();
    try { ap.scrivi(D.testoDiscuti(pulito, parola)); } catch (_) {
      return { ok: false, error: 'Gli appunti non rispondono: riprova.' };
    }
    return { ok: true, conParola: !!parola, riga: D.rigaDiscuti(pulito) };
  }

  // Per i segreti custoditi: un'uscita che la porta si ferma, e verso i modelli arriva oscurata.
  function segreti() { const p = leggi(); return p ? [p] : []; }

  return { stato, salva, togli, copiaDiscuti, segreti };
}

let predefinito = null;
function unico() { return predefinito || (predefinito = crea()); }

module.exports = {
  controlla, crea, MAX_CARATTERI,
  stato: () => unico().stato(),
  salva: (testo) => unico().salva(testo),
  togli: () => unico().togli(),
  copiaDiscuti: (id) => unico().copiaDiscuti(id),
  segreti: () => unico().segreti(),
};
