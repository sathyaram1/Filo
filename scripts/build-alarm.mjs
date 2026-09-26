// build-alarm.mjs — apre un feedback quando la pubblicazione si ferma.
//
// PERCHÉ ESISTE
//   Quando i controlli automatici sono rossi la versione non esce, e gli utenti
//   restano sull'ultima buona. Se nessuno lo dice, quella è una pubblicazione
//   che si ferma IN SILENZIO: l'owner se ne accorge giorni dopo, chiedendosi
//   perché non arrivano più aggiornamenti. Questo allarme diventa un feedback in
//   coda, e al giro successivo qualcuno lo prende in carico come qualsiasi altro
//   lavoro.
//
//   Prima lo faceva uno script della coda su git. Smontata quella, senza questo
//   l'allarme sarebbe semplicemente sparito — ed è successo: per un tratto il
//   cancello rosso bloccava la pubblicazione senza lasciare niente.
//
// LA CREDENZIALE
//   La stessa della costruzione (`FILO_BUILD_PASSPHRASE`), che non apre altro:
//   non legge feedback, non ne tocca di esistenti, non chiede lavoro alle
//   routine. Apre un feedback di forma fissa e basta.
//
// IL TETTO DEL TESTO
//   Il server tiene i primi 10.000 caratteri e taglia il resto senza dirlo.
//   Il testo della suite rossa (premessa, fino a ottanta righe di rossi, la
//   coda del verdetto) ci arriva vicino, e con molti rossi lo supera: il
//   taglio si fa QUI, prima di spedire, e si dice nel testo stesso, con il
//   numero (giro del 14/09, terza verifica). Un taglio muto mangia proprio
//   la parte che serviva a chi prende il feedback.
//
// USO
//   node scripts/build-alarm.mjs "<titolo>" "<testo>"

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.FILO_ROUTINE_API
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

/** Quanti caratteri di testo il server tiene (functions/index.js, buildAlarm). */
export const TETTO_TESTO = 10000;

/**
 * Il testo entro il tetto del server: intero se ci sta; altrimenti tagliato
 * con, in coda, la riga che dice che è stato tagliato e quanto era lungo.
 * Il risultato non supera mai `max`. PURA.
 */
export function testoEntroIlTetto(text, max = TETTO_TESTO) {
  const s = String(text || '');
  if (s.length <= max) return s;
  const nota = `\n\n… testo tagliato a ${max} caratteri (era di ${s.length}): il resto sta nel registro e nell'artifact di questa esecuzione (Actions).`;
  return s.slice(0, Math.max(0, max - nota.length)) + nota;
}

/**
 * Spedisce l'allarme e ferma il processo se non arriva. La usa anche
 * `release-platform-alarm.mjs`: una sola strada verso il server, una sola
 * credenziale, un solo taglio del testo.
 */
export async function inviaAllarme(name, text) {
  const passphrase = process.env.FILO_BUILD_PASSPHRASE;

  if (!passphrase) {
    console.error('[allarme] FILO_BUILD_PASSPHRASE assente: non posso avvisare nessuno.');
    process.exit(1);
  }
  if (!name) {
    console.error('[allarme] titolo assente: non spedisco un feedback senza nome.');
    process.exit(1);
  }

  const testo = testoEntroIlTetto(text || '');
  if (testo.length < String(text || '').length) {
    console.error(`[allarme] testo di ${String(text).length} caratteri, il server ne tiene ${TETTO_TESTO}: tagliato, e il taglio è scritto in coda al testo.`);
  }

  try {
    const res = await fetch(`${BASE}/buildAlarm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase, name, text: testo }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      console.error(`[allarme] non consegnato (${res.status}${body.reason ? ' ' + body.reason : ''}).`);
      process.exit(1);
    }
    console.log(`[allarme] feedback aperto${body.num ? ` (${body.num})` : ''}.`);
  } catch (e) {
    console.error(`[allarme] server non raggiungibile: ${e.message}`);
    process.exit(1);
  }
}

async function main() {
  const [name, text] = process.argv.slice(2);
  if (!name) {
    console.error('Uso: node scripts/build-alarm.mjs "<titolo>" "<testo>"');
    process.exit(1);
  }
  await inviaAllarme(name, text);
}

const eseguitoDirettamente = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (eseguitoDirettamente) await main();
