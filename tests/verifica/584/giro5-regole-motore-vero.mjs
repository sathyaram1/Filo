// Verifica #584 giro 5 — le porte che i quattro giri passati non hanno provato,
// col motore VERO delle regole (l'emulatore ufficiale) e con la strada REST,
// quella che Filo usa davvero.
//
// I giri passati hanno chiuso: la raccolta intera, le query di gruppo, l'elenco
// dei domini, le stanze accanto, la paginazione, la data nel futuro, i campi
// fuori forma. Restano fuori tre modi di interrogare Firestore che non sono
// una lettura di documenti e che quindi potrebbero sfuggire al tetto:
//
//   1. il CONTEGGIO (`runAggregationQuery`): non scarica documenti, quindi non
//      ha una `limit` da confrontare col tetto. Se passasse in forma di gruppo
//      direbbe quanti percorsi esistono in tutto; su un dominio nominato
//      sarebbe un oracolo che conta senza leggere.
//   2. la PROIEZIONE (`select`): chiedere solo i nomi dei documenti invece dei
//      campi. Se il tetto si applicasse solo ai documenti interi, da qui si
//      enumererebbe.
//   3. il PRELIEVO A MAZZO (`:batchGet`) e l'elenco dei figli
//      (`:listCollectionIds`) alla radice e sotto un singolo percorso.
//
// NON è un test della suite: il nome non finisce in `.spec.mjs` apposta. Per
// girare vuole Java e l'emulatore ufficiale, che nel repo non stanno.
//
// COME SI LANCIA (in una cartella usa-e-getta, fuori dal repo):
//
//   mkdir /tmp/emu584 && cd /tmp/emu584 && npm init -y
//   npm i firebase-tools @firebase/rules-unit-testing firebase
//   cat > firebase.json <<'FINE'
//   { "firestore": { "rules": "firestore.rules" },
//     "emulators": { "firestore": { "port": 8089, "host": "127.0.0.1" },
//                    "ui": { "enabled": false } } }
//   FINE
//   cp <repo>/firestore.rules .
//   npx firebase emulators:exec --only firestore --project filo-attacco-584 \
//     "RULES_FILE=<repo>/firestore.rules node <repo>/tests/verifica/584/giro5-regole-motore-vero.mjs"

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const REGOLE = process.env.RULES_FILE || '/home/user/Filo/firestore.rules';
const PROGETTO = 'filo-attacco-584';
const PORTA = Number(process.env.FIRESTORE_PORT || 8089);
const BASE = `http://127.0.0.1:${PORTA}/v1/projects/${PROGETTO}/databases/(default)/documents`;

const env = await initializeTestEnvironment({
  projectId: PROGETTO,
  firestore: { host: '127.0.0.1', port: PORTA, rules: readFileSync(REGOLE, 'utf8') },
});
await env.clearFirestore();

const OGGI = new Date(Math.floor(Date.now() / 86400000) * 86400000).toISOString();

const nomi = [];
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const dominio of ['esempio.it', 'altro.com']) {
    for (let i = 0; i < 3; i += 1) {
      const id = `p${i}`;
      await setDoc(doc(db, `paths/${dominio}/entries/${id}`), {
        initialUrl: '/ordini', intent: 'vedere gli ordini',
        steps: [{ selector: '#a', action: 'click', retracted: false }],
        success: i !== 2, createdAt: new Date(OGGI),
      });
      nomi.push(`projects/${PROGETTO}/databases/(default)/documents/paths/${dominio}/entries/${id}`);
    }
    await setDoc(doc(db, `paths/${dominio}`), { visto: true });
  }
});

let ok = 0; let ko = 0;
const rossi = [];
async function prova(nome, fn) {
  try { await fn(); console.log(`  ok   ${nome}`); ok += 1; }
  catch (e) { console.log(`  FAIL ${nome}\n       ${String(e.message).slice(0, 400)}`); ko += 1; rossi.push(nome); }
}

async function post(percorso, corpo) {
  const res = await fetch(`${BASE}${percorso}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return { stato: res.status, testo: await res.text() };
}
async function get(percorso) {
  const res = await fetch(`${BASE}${percorso}`);
  return { stato: res.status, testo: await res.text() };
}

function negato(r, nome) {
  if (r.stato === 200 && !/PERMISSION_DENIED/.test(r.testo)) {
    throw new Error(`${nome}: PASSATA (${r.stato}) ${r.testo.slice(0, 200)}`);
  }
}
function riuscita(r, nome) {
  if (r.stato !== 200 || /PERMISSION_DENIED/.test(r.testo)) {
    throw new Error(`${nome}: negata (${r.stato}) ${r.testo.slice(0, 200)}`);
  }
}

const conteggio = (from) => ({
  structuredAggregationQuery: {
    structuredQuery: { from },
    aggregations: [{ alias: 'quanti', count: {} }],
  },
});

console.log('— contare senza leggere —');

await prova('anonimo: contare i percorsi di TUTTI i domini insieme → negato', async () => {
  const r = await post(':runAggregationQuery', conteggio([{ collectionId: 'entries', allDescendants: true }]));
  negato(r, 'conteggio di gruppo');
});

await prova('anonimo: contare i percorsi di un dominio nominato, senza tetto → negato', async () => {
  const r = await post('/paths/esempio.it:runAggregationQuery', conteggio([{ collectionId: 'entries' }]));
  negato(r, 'conteggio per dominio');
});

await prova('anonimo: contare i domini raccolti → negato', async () => {
  const r = await post(':runAggregationQuery', conteggio([{ collectionId: 'paths' }]));
  negato(r, 'conteggio dei domini');
});

console.log('— chiedere i soli nomi invece dei campi —');

await prova('anonimo: la proiezione sui soli nomi, di gruppo → negata', async () => {
  const r = await post(':runQuery', {
    structuredQuery: {
      from: [{ collectionId: 'entries', allDescendants: true }],
      select: { fields: [{ fieldPath: '__name__' }] },
      limit: 200,
    },
  });
  negato(r, 'proiezione di gruppo');
});

await prova('anonimo: la proiezione sui soli nomi, senza tetto, su un dominio → negata', async () => {
  const r = await post('/paths/esempio.it:runQuery', {
    structuredQuery: {
      from: [{ collectionId: 'entries' }],
      select: { fields: [{ fieldPath: '__name__' }] },
    },
  });
  negato(r, 'proiezione senza tetto');
});

console.log('— prelevare a mazzo e chiedere i figli —');

await prova('anonimo: prendere sei percorsi di DUE domini in una sola richiesta → passa solo perché i nomi si conoscevano già', async () => {
  const r = await post(':batchGet', { documents: nomi });
  // Le regole dicono `allow get: if true`: chi conosce il nome esatto di un
  // documento lo legge. I nomi sono casuali e non si elencano da nessuna parte
  // (le prove qui sopra), quindi questa strada non aggiunge niente a chi non li
  // ha già. Lo scrivo per lasciarlo agli atti, non come porta.
  riuscita(r, 'batchGet coi nomi in mano');
});

await prova('anonimo: chiedere i nomi dei documenti di un dominio senza leggerli → negato', async () => {
  const r = await get('/paths/esempio.it/entries?pageSize=300&mask.fieldPaths=__name__');
  negato(r, 'listDocuments con maschera');
});

await prova('anonimo: chiedere le raccolte figlie di un singolo percorso → negato', async () => {
  const r = await post('/paths/esempio.it/entries/p0:listCollectionIds', { pageSize: 100 });
  negato(r, 'listCollectionIds sotto un percorso');
});

await prova('anonimo: chiedere le raccolte alla radice → negato', async () => {
  const r = await post(':listCollectionIds', { pageSize: 100 });
  negato(r, 'listCollectionIds alla radice');
});

console.log('— e la funzione deve continuare a funzionare —');

await prova('anonimo: i percorsi riusciti di un dominio nominato, col tetto → riesce', async () => {
  const r = await post('/paths/esempio.it:runQuery', {
    structuredQuery: {
      from: [{ collectionId: 'entries' }],
      where: { fieldFilter: { field: { fieldPath: 'success' }, op: 'EQUAL', value: { booleanValue: true } } },
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
      limit: 50,
    },
  });
  riuscita(r, 'lettura per dominio');
  const righe = JSON.parse(r.testo).filter((x) => x.document);
  if (righe.length !== 2) throw new Error(`attesi 2 percorsi riusciti, arrivati ${righe.length}`);
});

console.log(`\n${ok} verdi, ${ko} rossi`);
if (ko) { console.log('ROSSI:', rossi.join(' | ')); process.exitCode = 1; }
await env.cleanup();
