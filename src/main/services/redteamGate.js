// Chi vede il Red Team (#896): visibile = interruttore `config/redteam.openToAll` acceso, oppure owner.
// Non dice mai «visibile» per un interruttore mai letto: assente o illeggibile vale «in pausa», come sul server.
// Home, tasto destro, pagina, manifesto e handler REDTEAM_* chiedono qui. Prove: tests/redteam-pausa.spec.mjs.

'use strict';

const auth = require('../auth/google-auth');
const Defaults = require('./defaultsStore');

const FRASE_PAUSA = 'Il Red Team è in pausa: tornerà dopo il rilascio';

// La riaccensione arriva alle altre installazioni entro questo tempo, senza riavvio; sull'installazione
// dell'owner subito. Un quarto d'ora tiene basse le letture di Firestore per utente.
const SCADENZA_MS = 15 * 60 * 1000;
// Un tentativo andato a vuoto (rete giù) si ripete presto: l'owner che riapre non deve aspettare la scadenza lunga.
const RIPROVA_MS = 30 * 1000;
// Quanto aspetta chi serve la pagina o un handler la PRIMA lettura, prima di rispondere «in pausa».
const ATTESA_PRIMA_LETTURA_MS = 4000;

let aperto = false;
let lettoAlle = 0;
let tentatoAlle = 0;
let inCorso = null;
let adesso = () => Date.now();
let ultimoStato = null;
const ascoltatori = new Set();

function owner() {
  try { return Boolean(auth.isAdmin()); } catch (_) { return false; }
}

function stato() {
  const isOwner = owner();
  return { visible: aperto || isOwner, owner: isOwner, openToAll: aperto, letto: lettoAlle > 0 };
}

function visibile() {
  return stato().visible;
}

// Chi ascolta (il main, che lo dice alle pagine) sente solo i cambi di «visibile».
function notificaSeCambia() {
  const s = stato();
  const prima = ultimoStato;
  ultimoStato = s;
  if (prima && prima.visible === s.visible && prima.openToAll === s.openToAll) return;
  for (const fn of ascoltatori) {
    try { fn(s); } catch (_) {}
  }
}

function rileggi() {
  if (inCorso) return inCorso;
  tentatoAlle = adesso();
  inCorso = (async () => {
    try {
      const r = await Defaults.getRedteamOpen();
      if (r && r.risposto) {
        aperto = r.aperto === true;
        lettoAlle = adesso();
      }
    } catch (_) {
      // Rete giù: resta l'ultima risposta del server (o «in pausa» se non ce n'è mai stata una).
    } finally {
      inCorso = null;
    }
    notificaSeCambia();
    return stato();
  })();
  return inCorso;
}

function scaduto() {
  const t = adesso();
  if (!lettoAlle) return t - tentatoAlle >= RIPROVA_MS || !tentatoAlle;
  return t - lettoAlle >= SCADENZA_MS && t - tentatoAlle >= RIPROVA_MS;
}

/** Rilegge se la copia è vecchia (o se `forza`), senza far aspettare chi chiede: torna lo stato di adesso. */
function aggiorna({ forza = false } = {}) {
  if (forza || scaduto()) rileggi().catch(() => {});
  return stato();
}

/** Per chi deve decidere adesso (pagina, handler): alla prima lettura aspetta un poco, poi risponde. */
async function assicura() {
  if (!lettoAlle) {
    const lettura = scaduto() || inCorso ? rileggi() : null;
    if (lettura) {
      await Promise.race([lettura, new Promise((r) => setTimeout(r, ATTESA_PRIMA_LETTURA_MS))]);
    }
  } else {
    aggiorna();
  }
  return stato();
}

/** Il gesto dell'owner in Gestione: scrive il documento e vale subito su questa installazione. */
async function impostaApertoATutti(on) {
  if (!owner()) throw new Error('Solo l’owner apre o mette in pausa il Red Team.');
  const idToken = await auth.getIdToken();
  const scritto = await Defaults.setRedteamOpen(Boolean(on), idToken);
  aperto = scritto;
  lettoAlle = adesso();
  tentatoAlle = lettoAlle;
  notificaSeCambia();
  return stato();
}

function suCambio(fn) {
  if (typeof fn === 'function') ascoltatori.add(fn);
  return () => ascoltatori.delete(fn);
}

/** Chi è entrato o uscito cambia «visibile» senza che l'interruttore si muova. */
function accessoCambiato() {
  notificaSeCambia();
}

module.exports = {
  FRASE_PAUSA,
  SCADENZA_MS,
  stato,
  visibile,
  aggiorna,
  assicura,
  impostaApertoATutti,
  suCambio,
  accessoCambiato,
  _setAdesso: (fn) => { adesso = typeof fn === 'function' ? fn : () => Date.now(); },
};
