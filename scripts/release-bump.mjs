// Chiedere al SERVER il numero della prossima versione — lato pubblicazione.
//
// PERCHÉ ESISTE (SPEC-RIDISEGNO-MAX.md §10)
//   Il numero di versione continua a vivere nel manifesto del repo: le note di
//   rilascio per l'utente sono organizzate per versione, e senza quel numero
//   smetterebbero di raggiungerlo. Ma su `main` scrive UNA SOLA identità,
//   quella del server — e il lavoro di pubblicazione gira su una macchina
//   qualunque, con un token che eredita chiunque ci passi. Fino al 18/08/2026
//   alzava la versione da sé e la spingeva su `main`: da quando `main` è
//   protetto, quel push non passerebbe comunque.
//
//   Quindi non lo fa più. Lo CHIEDE: il server legge il manifesto vero, calcola
//   lui il numero successivo, e scrive lui il commit. Da qui non parte nessun
//   numero e nessun contenuto — solo la parola d'ordine della costruzione, che
//   non apre nient'altro.
//
// COSA STAMPA
//   Su stdout, SOLO il numero nuovo (una riga): serve al lavoro di
//   pubblicazione, che lo cattura. Tutto ciò che è per gli umani va su stderr,
//   così non si mescola.
//
// USO
//   node scripts/release-bump.mjs
//
//   Exit code:
//     0 → fatto: il numero nuovo è su main (stampato su stdout)
//     2 → RIFIUTATO dal server (parola d'ordine, freno anti-raffica, manifesto
//         che non si legge): niente è cambiato, e insistere darebbe lo stesso no
//     3 → server non raggiungibile o funzione assente: niente è cambiato,
//         si può riprovare più tardi

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Dove vive il server. `FILO_ROUTINE_API` esiste per i test e per un eventuale
// ambiente di prova: NON è un segreto, è solo un indirizzo.
const BASE = process.env.FILO_ROUTINE_API
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

export const RELEASE_BUMP_URL = `${BASE}/releaseBump`;

/**
 * Dalla risposta grezza del server a un esito con un nome. PURA.
 *
 * Le tre famiglie sono diverse apposta: "il server ha detto no" non è "il
 * server non c'era". Nella prima insistere è inutile, nella seconda è l'unica
 * cosa sensata.
 *
 * @param {number} status  codice HTTP (0 = non ci si è arrivati)
 * @param {object} body    corpo JSON già interpretato
 */
export function classifyBump(status, body) {
  const b = body || {};
  if (status === 200 && b.ok === true) {
    const version = String(b.version || '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      // Un "fatto" senza un numero utilizzabile non è un fatto: la costruzione
      // che segue userebbe chissà cosa.
      return { outcome: 'fault', reason: `risposta senza numero: "${version}"` };
    }
    return { outcome: 'done', version, previous: String(b.previous || ''), sha: String(b.sha || '') };
  }
  const reason = String(b.reason || '') || `http_${status}`;
  // 429 = il freno anti-raffica del server.
  if (status === 429) return { outcome: 'throttled', reason };
  // Una chiamata che non esiste (ancora) è il caso più probabile finché il
  // server non è stato rideployato: dirlo per nome evita mezz'ora di caccia.
  if (status === 404) return { outcome: 'not_deployed', reason };
  if (status === 0 || status >= 500) return { outcome: 'unreachable', reason };
  if (status === 401 || status === 403) return { outcome: 'denied', reason };
  if (status === 400) return { outcome: 'rejected', reason };
  return { outcome: 'fault', reason };
}

/**
 * L'uscita del processo. PURA. Tre esiti, perché tre sono le cose da fare:
 * proseguire, smettere di insistere, riprovare più tardi.
 */
export function exitCodeForBump(reply) {
  switch ((reply || {}).outcome) {
    case 'done': return 0;
    case 'throttled':
    case 'denied':
    case 'rejected':
    case 'no_passphrase': return 2;
    default: return 3;   // not_deployed, unreachable, fault
  }
}

/** Cosa legge chi guarda il registro del lavoro di pubblicazione. PURA. */
export function messageForBump(reply) {
  const r = reply || {};
  switch (r.outcome) {
    case 'done':
      return `[release-bump] versione ${r.previous || '?'} → ${r.version} scritta su main dal server${r.sha ? ` (${String(r.sha).slice(0, 8)})` : ''}.`;
    case 'throttled':
      return `[release-bump] RIFIUTATO dal freno del server (${r.reason}): nessun numero consumato.\n`
        + '  È voluto: un aumento a raffica brucia numeri di versione. Riprova al prossimo giro.';
    case 'denied':
      return '[release-bump] RIFIUTATO: il server non riconosce la parola d’ordine della costruzione.\n'
        + '  Va rigenerata e rimessa nel segreto FILO_BUILD_PASSPHRASE del repo.';
    case 'rejected':
      return `[release-bump] RIFIUTATO: ${r.reason}.\n`
        + '  Il manifesto su main non è come il server se lo aspetta: niente è cambiato.';
    case 'no_passphrase':
      return '[release-bump] RIFIUTATO: manca FILO_BUILD_PASSPHRASE, non posso nemmeno chiedere.';
    case 'not_deployed':
      return '[release-bump] il server non espone (ancora) l’aumento di versione.\n'
        + '  Nessun numero è stato scritto: vanno rideployate le funzioni di sicurezza.';
    case 'unreachable':
      return `[release-bump] server non raggiungibile (${r.reason}): nessun numero è stato scritto.`;
    default:
      return `[release-bump] guasto: ${r.reason || 'senza motivo'}. Nessun numero è stato scritto.`;
  }
}

/**
 * La domanda al server: "qual è il numero della prossima versione, e scrivilo
 * tu". Ritorna sempre un esito classificato, mai un'eccezione.
 */
export async function askServerBump({ passphrase, fetchImpl = fetch, url = RELEASE_BUMP_URL } = {}) {
  if (!passphrase) return { outcome: 'no_passphrase' };
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Il corpo è solo la credenziale: nessun numero, nessun contenuto. Se un
      // giorno qualcuno ci infilasse la versione da scrivere, il server la
      // ignorerebbe — ma il posto giusto perché non ci sia è questo.
      body: JSON.stringify({ passphrase }),
    });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (_) { body = {}; }
    return classifyBump(res.status, body);
  } catch (e) {
    return { outcome: 'unreachable', reason: String((e && e.message) || e).slice(0, 200) };
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const reply = await askServerBump({ passphrase: process.env.FILO_BUILD_PASSPHRASE || '' });
  const code = exitCodeForBump(reply);
  console.error(messageForBump(reply));
  // Su stdout SOLO il numero, e solo se c'è: è quello che il lavoro di
  // pubblicazione cattura.
  if (code === 0) console.log(reply.version);
  // `exitCode` e non `exit()`: su Windows lo stdout verso una pipe è
  // asincrono, e uscire di colpo può TRONCARE la riga appena scritta — cioè
  // proprio il numero che il lavoro di pubblicazione deve leggere.
  process.exitCode = code;
}

// Esegui solo se invocato come script (non quando importato dai test).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
