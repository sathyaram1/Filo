// Verifica #583, giro 8 — la prova sul deposito VERO: un allegato si scarica
// col solo indirizzo.
//
// NON è uno spec: il nome finisce in `.mjs` e non in `.spec.mjs` apposta, così
// la suite non prova a lanciarlo. Per girare ha bisogno della rete e parla col
// deposito vero di Filo. È SOLO LETTURA: nessuna scrittura, nessuna
// cancellazione, e non stampa niente del contenuto — solo l'esito HTTP e la
// misura.
//
// COME SI LANCIA (dalla radice del repo):
//   node tests/verifica/583/giro8-allegato-col-solo-indirizzo.mjs
//
// COSA MOSTRA (giro 8, 2026-09-14, sul deposito vero):
//   · elenco del deposito                                   → 200 (le regole
//     nuove lo chiudono, là fuori non sono ancora pubblicate)
//   · allegato col link intero dell'app (gettone compreso)   → 200
//   · allegato col SOLO indirizzo, senza gettone             → 200  ← la porta
//   · allegato con un gettone SBAGLIATO                      → 200  ← il
//     gettone non lo guarda nessuno: apre la regola, non il gettone
//
// La riga che apre è `allow get: if true` in storage.rules, che questo lavoro
// ha lasciato com'era (ha chiuso solo `list`). Gli indirizzi degli allegati
// stavano dentro i documenti dei feedback, leggibili da chiunque fino a questo
// lavoro: chi li ha raccolti se li tiene per sempre, e cambiare il gettone del
// file — la cura di serie per un link scappato — non serve finché il file si
// prende col solo indirizzo.
//
// La guardia che resta accesa nel ramo è
// tests/verifica/583/giro8-deposito-allegati.spec.mjs, che rilegge il file
// delle regole in millisecondi e oggi è rossa.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(ROOT, 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

const { FIRESTORE_BASE, API_KEY } = FB.rest;

function riga(etichetta, res, extra = '') {
  console.log(`  ${String(res.status).padEnd(4)} ${etichetta}${extra ? `  (${extra})` : ''}`);
}

(async () => {
  // Un allegato qualunque, preso da un documento STORICO (quelli anteriori al
  // 25 giugno 2026, in chiaro per intero). Serve solo il suo indirizzo.
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'feedback' }],
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
      limit: 40,
    },
  };
  const q = await fetch(`${FIRESTORE_BASE}:runQuery?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  console.log(`\nlettura anonima della collezione feedback (là fuori): HTTP ${q.status}`);
  if (!q.ok) {
    console.log('  la collezione non si legge più senza credenziali: le regole nuove sono pubblicate.');
    console.log('  Per rifare la prova serve un indirizzo di allegato preso prima.');
    return;
  }
  const arr = await q.json();
  let url = '';
  for (const row of arr) {
    const f = row.document && row.document.fields;
    const imgs = f && f.images && f.images.arrayValue && f.images.arrayValue.values;
    if (imgs && imgs.length && imgs[0].stringValue) { url = imgs[0].stringValue; break; }
  }
  if (!url) { console.log('  nessun allegato nei documenti letti: prova non eseguita.'); return; }

  const soloIndirizzo = `${url.split('?')[0]}?alt=media`;
  const gettoneFinto = `${url.split('?')[0]}?alt=media&token=00000000-0000-0000-0000-000000000000`;
  const elenco = `https://firebasestorage.googleapis.com/v0/b/${
    url.split('/o/')[0].split('/b/')[1]}/o?prefix=feedback%2F&maxResults=3`;

  console.log('\nil deposito degli allegati, senza nessuna credenziale:');
  riga('elenco del deposito', await fetch(elenco));
  const a = await fetch(url);
  riga('allegato col link intero dell\'app', a, `${a.headers.get('content-length') || '?'} byte`);
  const b = await fetch(soloIndirizzo);
  riga('allegato col SOLO indirizzo, senza gettone', b, `${b.headers.get('content-length') || '?'} byte`);
  riga('allegato con un gettone sbagliato', await fetch(gettoneFinto));
  console.log('');
})();
