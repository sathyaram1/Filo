// Chi ha riscattato un codice Red Team (#991): la voce «Invia attacco» del tasto destro c'è solo per lui.
// Il sì lo dà il server (redteamState); qui una copia per account, che il tasto destro legge senza aspettare.
// La lettura la dà handlers/redteam.js, che la chiede solo con il Red Team visibile. Prove: tests/redteam-verificati.spec.mjs.

'use strict';

const auth = require('../auth/google-auth');

const SCADENZA_MS = 30 * 60_000;
// Rete giù: non si richiede a ogni tasto destro.
const RIPROVA_MS = 60_000;

const copie = new Map();
const ascoltatori = new Set();
let leggi = null;
let inCorso = null;
let fallitaIl = 0;

// Le schede già aperte tengono la loro copia: un cambio va detto a loro, non aspetta il loro tasto destro.
function suCambio(fn) {
  if (typeof fn === 'function') ascoltatori.add(fn);
  return () => ascoltatori.delete(fn);
}

function chi() {
  if (!auth.isSignedIn()) return null;
  return String(auth.getProfile()?.email || '');
}

function leggiCon(fn) { leggi = typeof fn === 'function' ? fn : null; }

// Solo una risposta del server col suo sì o no: un errore o la pausa non dicono niente.
function ricorda(risposta, account = chi()) {
  if (account == null || !risposta || risposta.paused || risposta.error || typeof risposta.verified !== 'boolean') return;
  const prima = !!copie.get(account)?.verificato;
  copie.set(account, { verificato: risposta.verified, letto: Date.now() });
  if (prima === risposta.verified) return;
  for (const fn of ascoltatori) { try { fn(risposta.verified); } catch (_) {} }
}

function rileggi() {
  if (inCorso) return inCorso;
  const account = chi();
  if (account == null || !leggi || Date.now() - fallitaIl < RIPROVA_MS) return Promise.resolve();
  inCorso = Promise.resolve()
    .then(() => leggi())
    .then((r) => {
      if (r && typeof r.verified === 'boolean' && !r.paused) ricorda(r, account);
      else fallitaIl = Date.now();
    }, () => { fallitaIl = Date.now(); })
    .finally(() => { inCorso = null; });
  return inCorso;
}

// Quello che si sa adesso; una copia mancante o scaduta si rilegge in sottofondo e vale dalla domanda dopo.
function noto() {
  const account = chi();
  if (account == null) return false;
  const copia = copie.get(account);
  if (!copia || Date.now() - copia.letto > SCADENZA_MS) rileggi();
  return !!(copia && copia.verificato);
}

async function assicura() {
  const account = chi();
  if (account == null) return false;
  if (!copie.has(account)) await rileggi();
  return noto();
}

module.exports = { leggiCon, ricorda, noto, assicura, suCambio, SCADENZA_MS };
