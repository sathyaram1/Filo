// Verifica #584 giro 3 — le porte che i due giri prima non avevano provato,
// col MOTORE VERO (emulatore Firestore ufficiale). Scritto dal verificatore.
//
// NON è un test della suite: il nome non finisce in `.spec.mjs` né in
// `.test.mjs` apposta. Per girare vuole Java e l'emulatore ufficiale (un .jar
// da centinaia di MB), che nel repo non ci sono e non ci devono stare.
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
//   cp <repo>/tests/verifica/584/giro3-regole-motore-vero.mjs .
//   npx firebase emulators:exec --only firestore --project filo-attacco-584 \
//     "RULES_FILE=<repo>/firestore.rules node /tmp/emu584/giro3-regole-motore-vero.mjs"
//
// Cosa aggiunge ai giri prima: la strada REST (quella che usa Filo davvero, con
// la chiave web, non gRPC), l'elenco delle sottocollezioni di un dominio, e la
// lettura di un dominio NON nominato per intero ma indovinato con un prefisso.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const REGOLE = process.env.RULES_FILE;
const PROGETTO = 'filo-attacco-584';
const PORTA = 8089;
const BASE = `http://127.0.0.1:${PORTA}/v1/projects/${PROGETTO}/databases/(default)/documents`;

const env = await initializeTestEnvironment({
  projectId: PROGETTO,
  firestore: { host: '127.0.0.1', port: PORTA, rules: readFileSync(REGOLE, 'utf8') },
});

let verdi = 0; let rossi = 0;
function esito(ok, cosa) {
  if (ok) { verdi++; console.log(`  ok   ${cosa}`); }
  else { rossi++; console.log(`  ROSSO ${cosa}`); }
}

// Semina: due domini, un percorso ciascuno (scritto scavalcando le regole).
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [dominio, id] of [['esempio.it', 'a1'], ['altro.example', 'b1']]) {
    await setDoc(doc(db, `paths/${dominio}/entries/${id}`), {
      initialUrl: '/area', intent: 'fare una cosa', steps: [], success: true,
      createdAt: Timestamp.fromMillis(Date.now() - 60_000),
    });
  }
});

// Da qui in poi si parla REST senza nessun token, che è esattamente il cammino
// di Filo (chiave web + fetch): l'emulatore applica le stesse regole.
async function rest(percorso, opts = {}) {
  const r = await fetch(`${BASE}${percorso}`, opts);
  return { status: r.status, testo: await r.text() };
}

console.log('\n— la strada REST, quella vera di Filo —');
{
  const r = await rest('/paths/esempio.it/entries?pageSize=50');
  esito(r.status === 200 && r.testo.includes('fare una cosa'),
    'anonimo: leggere i percorsi di UN dominio nominato via REST → riesce');
}
{
  // La lettura "a elenco" senza passare da runQuery: qui NON c'è nessuna
  // `request.query.limit`, quindi la regola del tetto decide da sola.
  const r = await rest('/paths?pageSize=300');
  esito(r.status !== 200, `anonimo: elencare la raccolta paths via REST → ${r.status}`);
}
{
  const r = await rest('/paths/esempio.it');
  esito(r.status !== 200, `anonimo: leggere il documento del dominio via REST → ${r.status}`);
}
{
  // L'elenco delle SOTTOCOLLEZIONI di un documento: se rispondesse, direbbe
  // quali domini sono stati raccolti senza leggerne un solo percorso.
  const r = await rest('/paths/esempio.it:listCollectionIds', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  esito(r.status !== 200, `anonimo: chiedere le sottocollezioni di un dominio → ${r.status}`);
}
{
  const r = await rest(':listCollectionIds', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  esito(!(r.status === 200 && r.testo.includes('paths')),
    `anonimo: chiedere l'elenco delle raccolte alla radice → ${r.status}`);
}
{
  // Query di gruppo dalla RADICE via REST (allDescendants), che è la forma in
  // cui si chiederebbero tutti i domini insieme.
  const corpo = JSON.stringify({ structuredQuery: {
    from: [{ collectionId: 'entries', allDescendants: true }], limit: 50,
  } });
  const r = await rest(':runQuery', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo,
  });
  esito(!(r.status === 200 && r.testo.includes('fare una cosa')),
    `anonimo: query di gruppo su entries via REST → ${r.status}`);
}
{
  // Un solo percorso preso per id: è `allow get`, deve riuscire (serve a Filo).
  const r = await rest('/paths/esempio.it/entries/a1');
  esito(r.status === 200, 'anonimo: leggere un percorso per id via REST → riesce');
}
{
  // Le regole contano i passi ma non li pesano: un percorso enorme passa. Qui
  // si guarda solo che la strada REST si comporti come quella gRPC.
  const grosso = JSON.stringify({ fields: {
    initialUrl: { stringValue: '/x' },
    intent: { stringValue: 'a' },
    steps: { arrayValue: { values: [{ mapValue: { fields: {
      selector: { stringValue: 'x'.repeat(30000) }, action: { stringValue: 'click' },
    } } }] } },
    success: { booleanValue: true },
    createdAt: { timestampValue: new Date(Date.now() - 60_000).toISOString() },
  } });
  const r = await rest('/paths/esempio.it/entries', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: grosso,
  });
  esito(r.status === 200, `anonimo: scrivere un passo da 30.000 caratteri via REST → ${r.status} (le regole non pesano; chi legge lo scarta)`);
}

console.log(`\n${verdi} verdi, ${rossi} rossi`);
await env.cleanup();
process.exit(rossi ? 1 : 0);
