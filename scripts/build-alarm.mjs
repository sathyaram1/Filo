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
// USO
//   node scripts/build-alarm.mjs "<titolo>" "<testo>"

const BASE = process.env.FILO_ROUTINE_API
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

const [name, text] = process.argv.slice(2);
const passphrase = process.env.FILO_BUILD_PASSPHRASE;

if (!passphrase) {
  console.error('[allarme] FILO_BUILD_PASSPHRASE assente: non posso avvisare nessuno.');
  process.exit(1);
}
if (!name) {
  console.error('Uso: node scripts/build-alarm.mjs "<titolo>" "<testo>"');
  process.exit(1);
}

try {
  const res = await fetch(`${BASE}/buildAlarm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase, name, text: text || '' }),
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
