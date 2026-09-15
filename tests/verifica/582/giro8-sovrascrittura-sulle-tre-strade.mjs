// Verifica #582, giro 8 — la sovrascrittura, misurata su TUTTE le strade di
// caricamento che il deposito accetta.
//
// NON è uno spec: il nome finisce in `.mjs` e non in `.spec.mjs` apposta, così
// la suite non prova a lanciarlo (vuole l'emulatore ufficiale di Storage e
// Java, che nella suite non ci sono e non ci devono essere).
//
// PERCHÉ QUESTO GIRO
//   L'attrezzo dei giri passati carica con l'SDK di Firebase (`uploadBytes`) e
//   su quella strada la sovrascrittura risulta negata. Filo però non carica
//   così: `src/shared/feedback.js` (uploadImage) e l'agente esploratore fanno
//   una POST diretta a `…/o?uploadType=media&name=…`. Il deposito ne accetta
//   una terza, il protocollo "resumable", che apre prima una sessione e scrive
//   dopo: se le regole si guardassero solo all'apertura, di lì si passerebbe.
//   Sono tre strade per la stessa cosa, e la segnalazione chiedeva proprio che
//   la sovrascrittura non si potesse: vanno misurate tutte e tre.
//
//   Il nome usato qui PASSA il controllo dell'entropia. Con un nome che non lo
//   passa il rifiuto arriva dalla forma del nome e non dice niente sulla
//   sovrascrittura — ed è esattamente l'inciampo per cui la prova gemella
//   `tests/verifica/583/giro9-deposito-porte-col-motore-vero.mjs` concludeva
//   che riscrivere l'allegato di un altro fosse ancora possibile: era vera
//   quando è stata scritta, non lo è più da quando queste regole pretendono un
//   nome con entropia.
//
// ESITO AL GIRO 8 (2026-09-15): 11 controlli su 11, tutto chiuso.
//   Il caricamento dalla strada dell'app passa e il deposito rilascia il codice
//   di scarico; il link col codice apre, il solo indirizzo no, i metadati no;
//   elencare non si può, né la cartella né la radice; sovrascrivere l'allegato
//   di un altro dalla strada dell'app è NEGATO, e dopo il tentativo il link del
//   tester apre ancora la SUA foto; cancellare è negato.
//
// COME SI LANCIA (fuori dal repo, in una cartella usa-e-getta):
//
//   mkdir /tmp/emu582 && cd /tmp/emu582 && npm init -y
//   npm i firebase-tools
//   cp <repo>/storage.rules .
//   cp <repo>/tests/verifica/582/giro8-sovrascrittura-sulle-due-strade.mjs prova.mjs
//   cat > firebase.json <<'FINE'
//   { "storage": { "rules": "storage.rules" },
//     "emulators": { "storage": { "port": 9199, "host": "127.0.0.1" },
//                    "ui": { "enabled": false } } }
//   FINE
//   npx firebase emulators:exec --only storage --project filo-prova-582 "node prova.mjs"

import { randomUUID } from 'node:crypto';

const BUCKET = 'filo-prova-582.appspot.com';
const BASE = `http://127.0.0.1:9199/v0/b/${BUCKET}/o`;

let rotte = 0;
function riga(etichetta, atteso, ottenuto, extra = '') {
  const ok = atteso === ottenuto;
  if (!ok) rotte += 1;
  console.log(`${ok ? 'ok  ' : 'ROTT'} ${String(ottenuto).padEnd(5)} ${etichetta}`
    + `${extra ? `  ${extra}` : ''}${ok ? '' : `  (atteso ${atteso})`}`);
}

// La forma che `SN_FEEDBACK.attachmentPath` genera e che le regole pretendono.
const nomeConEntropia = () => `feedback/${Date.now()}_${randomUUID()}.png`;

// La strada che usa Filo: POST diretta con `uploadType=media`.
async function caricaRest(nome, tipo, corpo) {
  const r = await fetch(`${BASE}?uploadType=media&name=${encodeURIComponent(nome)}`, {
    method: 'POST', headers: { 'Content-Type': tipo }, body: Buffer.from(corpo),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, codice: j.downloadTokens || (j.metadata && j.metadata.downloadTokens) || '' };
}

const nome = nomeConEntropia();
const enc = encodeURIComponent(nome);

// 1. Un tester manda il suo screenshot, dalla strada dell'app, senza login.
const primo = await caricaRest(nome, 'image/png', 'FOTO-DEL-TESTER');
riga('un tester carica il suo allegato (strada dell\'app)', 200, primo.status);
riga('il deposito rilascia il codice di scarico', true, !!primo.codice);

// 2. Il link col codice apre; il solo indirizzo no.
riga('il link col codice di scarico apre l\'allegato', 200,
  (await fetch(`${BASE}/${enc}?alt=media&token=${primo.codice}`)).status);
riga('il solo indirizzo, senza codice, non apre niente', 403,
  (await fetch(`${BASE}/${enc}?alt=media`)).status);
riga('i metadati col solo indirizzo (dentro c\'è il codice)', 403,
  (await fetch(`${BASE}/${enc}`)).status);

// 3. Elencare il deposito.
riga('elencare feedback/', 403, (await fetch(`${BASE}?prefix=feedback/`)).status);
riga('elencare la radice del deposito', 403, (await fetch(`${BASE}`)).status);

// 4. LA PORTA DI QUESTO GIRO: sovrascrivere, dalla strada dell'app.
const sopra = await caricaRest(nome, 'image/png', 'FOTO-DI-UN-ESTRANEO');
riga('sovrascrivere l\'allegato di un altro (strada dell\'app)', 403, sopra.status);

// 5. E dopo il tentativo, il link del tester apre ancora quello che aveva mandato?
const dopo = await fetch(`${BASE}/${enc}?alt=media&token=${primo.codice}`);
const testo = dopo.status === 200 ? await dopo.text() : '';
riga('il link originale del tester apre ancora', 200, dopo.status);
riga('e quello che apre è ancora la SUA foto', 'FOTO-DEL-TESTER', testo);

// 6. Cancellare.
riga('cancellare l\'allegato di un altro', 403,
  (await fetch(`${BASE}/${enc}`, { method: 'DELETE' })).status);

console.log(rotte ? `\n${rotte} porte che dovevano essere chiuse non lo sono.` : '\nTutte chiuse.');
process.exit(rotte ? 1 : 0);
