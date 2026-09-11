// Le regole Firestore dei percorsi condivisi, provate col MOTORE VERO (#584).
//
// NON è un unit test: il nome non finisce in `.test.mjs` apposta, così
// `npm run test:unit` non prova a lanciarlo (né Playwright, che guarda i
// `.spec.mjs`). Per girare ha bisogno di due cose che nella suite non ci sono
// e non ci devono essere — l'emulatore Firestore ufficiale (un .jar da
// centinaia di MB) e Java. La sentinella sempre accesa è il file accanto,
// `pathsRegoleLettura.test.mjs`, che rilegge le regole in millisecondi; questo
// è l'altra metà: la prova che quel file, dato in pasto al motore vero, si
// comporta come dice.
//
// COME SI LANCIA (fuori dal repo, in una cartella usa-e-getta):
//
//   mkdir /tmp/emu && cd /tmp/emu && npm init -y
//   npm i firebase-tools @firebase/rules-unit-testing firebase
//   cp <repo>/firestore.rules .
//   cat > firebase.json <<'FINE'
//   { "firestore": { "rules": "firestore.rules" },
//     "emulators": { "firestore": { "port": 8089, "host": "127.0.0.1" },
//                    "ui": { "enabled": false } } }
//   FINE
//   cp <repo>/tests/unit/pathsRegole.motore-vero.mjs .
//   RULES_FILE=<repo>/firestore.rules npx firebase emulators:exec \
//     --only firestore --project filo-prova-584 "node /tmp/emu/pathsRegole.motore-vero.mjs"
//
// (si copia il file nella cartella usa-e-getta perché stando nel repo Node
// cerca i pacchetti nel node_modules del repo, dove l'emulatore non c'è — ed è
// giusto che non ci sia).
//
// Esito atteso: 19 righe verdi, uscita 0. Al primo passaggio (2026-09-11) è
// stato così.
//
// Insieme a questo è stata fatta la CONTROPROVA con le regole di `main`
// (`git show main:firestore.rules`): lì le prime quattro righe diventano rosse,
// cioè un anonimo si porta via la collezione INTERA e legge il vecchio
// documento piatto col `clientId` in chiaro. Una prova che passa su entrambe le
// versioni non prova niente.

import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, deleteDoc, updateDoc, getDocs, collection, collectionGroup,
  query, limit, orderBy, addDoc, Timestamp,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const REGOLE = process.env.RULES_FILE || '/home/user/Filo/firestore.rules';

const env = await initializeTestEnvironment({
  projectId: 'filo-prova-584',
  firestore: { host: '127.0.0.1', port: 8089, rules: readFileSync(REGOLE, 'utf8') },
});
await env.clearFirestore();

let ok = 0; let ko = 0;
async function prova(nome, fn) {
  try { await fn(); console.log(`  ok   ${nome}`); ok += 1; }
  catch (e) { console.log(`  FAIL ${nome}\n       ${e.message}`); ko += 1; }
}

const PERCORSO_OK = {
  initialUrl: '/account',
  intent: 'disdire l’abbonamento',
  steps: [{ selector: '#menu', action: 'click', retracted: false }],
  success: true,
  createdAt: Timestamp.fromDate(new Date('2026-09-11T14:00:00.000Z')),
};

// Semina con le regole spente: due domini + un vecchio documento piatto, come
// quelli che esistono davvero in produzione.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'paths/esempio.it/entries/uno'), PERCORSO_OK);
  await setDoc(doc(db, 'paths/esempio.it/entries/due'), { ...PERCORSO_OK, intent: 'cambiare indirizzo' });
  await setDoc(doc(db, 'paths/altro.com/entries/tre'), { ...PERCORSO_OK, intent: 'altro dominio' });
  await setDoc(doc(db, 'paths/vecchioDocPiatto'), {
    domain: 'esempio.it', initialUrl: '/x', intent: 'vecchio', steps: [], success: true,
    userAgent: 'Filo/33', clientId: 'abc-123', createdAt: Timestamp.now(),
  });
});

const anon = env.unauthenticatedContext().firestore();
const loggato = env.authenticatedContext('chiunque', { email: 'x@y.z', email_verified: true }).firestore();

console.log('\n— quello che NON si deve poter fare —');
await prova('scaricare la collezione paths intera', () => assertFails(getDocs(collection(anon, 'paths'))));
await prova('scaricare la collezione paths intera da loggato', () => assertFails(getDocs(collection(loggato, 'paths'))));
await prova('leggere un vecchio documento piatto (col clientId in chiaro)', () => assertFails(getDoc(doc(anon, 'paths/vecchioDocPiatto'))));
await prova('elencare i domini raccolti', () => assertFails(getDocs(query(collection(anon, 'paths'), limit(10)))));
await prova('collection group query su entries (tutti i domini in un colpo)', () => assertFails(getDocs(query(collectionGroup(anon, 'entries'), limit(10)))));
await prova('listare un dominio senza tetto sulla limit', () => assertFails(getDocs(collection(anon, 'paths/esempio.it/entries'))));
await prova('listare un dominio con una limit oltre il tetto', () => assertFails(getDocs(query(collection(anon, 'paths/esempio.it/entries'), limit(500)))));
await prova('scrivere un percorso col clientId', () => assertFails(addDoc(collection(anon, 'paths/esempio.it/entries'), { ...PERCORSO_OK, clientId: 'abc-123' })));
await prova('scrivere un percorso con lo user agent', () => assertFails(addDoc(collection(anon, 'paths/esempio.it/entries'), { ...PERCORSO_OK, userAgent: 'Filo/33' })));
await prova('scrivere un percorso col dominio dentro al documento', () => assertFails(addDoc(collection(anon, 'paths/esempio.it/entries'), { ...PERCORSO_OK, domain: 'esempio.it' })));
await prova('scrivere un percorso senza intento', () => assertFails(addDoc(collection(anon, 'paths/esempio.it/entries'), { initialUrl: '/', steps: [], success: true, createdAt: Timestamp.now() })));
await prova('scrivere un percorso con 40 passi', () => assertFails(addDoc(collection(anon, 'paths/esempio.it/entries'), { ...PERCORSO_OK, steps: Array.from({ length: 40 }, () => ({ selector: '#a', action: 'click' })) })));
await prova('modificare un percorso già scritto', () => assertFails(updateDoc(doc(anon, 'paths/esempio.it/entries/uno'), { intent: 'altro' })));
await prova('cancellare un percorso', () => assertFails(deleteDoc(doc(anon, 'paths/esempio.it/entries/uno'))));
await prova('scrivere nella vecchia forma piatta', () => assertFails(setDoc(doc(anon, 'paths/nuovoPiatto'), { ...PERCORSO_OK })));

console.log('\n— quello che deve continuare a funzionare —');
await prova('l’agente di pagina legge i percorsi di UN dominio', async () => {
  const snap = await assertSucceeds(getDocs(query(collection(anon, 'paths/esempio.it/entries'), orderBy('createdAt', 'desc'), limit(50))));
  if (snap.size !== 2) throw new Error(`attesi 2 percorsi per esempio.it, trovati ${snap.size}`);
  const intenti = snap.docs.map((d) => d.data().intent).sort();
  if (!intenti.includes('cambiare indirizzo')) throw new Error('contenuto inatteso: ' + intenti.join(', '));
  for (const d of snap.docs) {
    const k = Object.keys(d.data());
    if (k.includes('clientId') || k.includes('userAgent')) throw new Error('il documento porta ancora un identificativo');
  }
});
await prova('un dominio vede solo i suoi percorsi', async () => {
  const snap = await assertSucceeds(getDocs(query(collection(anon, 'paths/altro.com/entries'), limit(50))));
  if (snap.size !== 1) throw new Error(`attesi 1, trovati ${snap.size}`);
});
await prova('leggere un singolo percorso per id', () => assertSucceeds(getDoc(doc(anon, 'paths/esempio.it/entries/uno'))));
await prova('salvare un percorso nuovo (anonimo, come oggi)', () => assertSucceeds(addDoc(collection(anon, 'paths/esempio.it/entries'), PERCORSO_OK)));

console.log(`\nverdi ${ok}, rossi ${ko}`);
await env.cleanup();
process.exit(ko ? 1 : 0);
