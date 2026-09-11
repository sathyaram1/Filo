// Verifica #584 giro 1 — attacco alle regole dei percorsi condivisi, col
// MOTORE VERO (emulatore Firestore ufficiale). Scritto dal verificatore.
//
// NON è un test della suite: il nome non finisce in `.spec.mjs` né in
// `.test.mjs` apposta. Per girare vuole Java e l'emulatore ufficiale (un .jar
// da centinaia di MB), che nel repo non ci sono e non ci devono stare.
//
// COME SI LANCIA (in una cartella usa-e-getta, fuori dal repo):
//
//   mkdir /tmp/emu584 && cd /tmp/emu584 && npm init -y
//   npm i firebase-tools @firebase/rules-unit-testing firebase
//   cp <repo>/firestore.rules .
//   cat > firebase.json <<'FINE'
//   { "firestore": { "rules": "firestore.rules" },
//     "emulators": { "firestore": { "port": 8089, "host": "127.0.0.1" },
//                    "ui": { "enabled": false } } }
//   FINE
//   cp <repo>/tests/verifica/584/giro1-regole-motore-vero.mjs .
//   npx firebase emulators:exec --only firestore --project filo-attacco-584 \
//     "RULES_FILE=<repo>/firestore.rules node /tmp/emu584/giro1-regole-motore-vero.mjs"
//
// Esito del giro 1 (2026-09-11): 22 verdi, 0 rossi. Le regole reggono tutte e
// 22 le strade provate — collezione intera, query di gruppo (con e senza
// tetto), vecchio documento piatto, lista senza limite, campi del mittente
// rimessi dentro, modifica e cancellazione.
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, deleteDoc, updateDoc, getDocs, collection, collectionGroup,
  query, limit, orderBy, addDoc, Timestamp,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const REGOLE = process.env.RULES_FILE;
const PROGETTO = 'filo-attacco-584';
const PORTA = 8089;

const env = await initializeTestEnvironment({
  projectId: PROGETTO,
  firestore: { host: '127.0.0.1', port: PORTA, rules: readFileSync(REGOLE, 'utf8') },
});
await env.clearFirestore();

let ok = 0; let ko = 0;
const rossi = [];
async function prova(nome, fn) {
  try { await fn(); console.log(`  ok   ${nome}`); ok += 1; }
  catch (e) { console.log(`  FAIL ${nome}\n       ${String(e.message).slice(0, 300)}`); ko += 1; rossi.push(nome); }
}

// ── semina, bypassando le regole (come farebbe il vero traffico degli utenti)
const ORA = new Date(Math.floor(Date.now() / 3600000) * 3600000);
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  // un vecchio documento piatto, della forma di prima (col clientId in chiaro)
  await setDoc(doc(db, 'paths/vecchio-doc-piatto'), {
    domain: 'esempio.it', initialUrl: '/ordini', intent: 'vedere gli ordini',
    steps: [], success: true, clientId: 'c-123-abc', userAgent: 'Mozilla/5.0',
    createdAt: Timestamp.fromDate(new Date()),
  });
  // la forma nuova, due domini diversi, scritti a 40 secondi di distanza
  await setDoc(doc(db, 'paths/esempio.it/entries/e1'), {
    initialUrl: '/ordini', intent: 'vedere gli ordini', steps: [{ selector: 'a#o', action: 'click', retracted: false }],
    success: true, createdAt: Timestamp.fromDate(ORA),
  });
  await new Promise((r) => setTimeout(r, 120));
  await setDoc(doc(db, 'paths/altrosito.com/entries/a1'), {
    initialUrl: '/posta', intent: 'aprire la posta', steps: [{ selector: 'a#p', action: 'click', retracted: false }],
    success: true, createdAt: Timestamp.fromDate(ORA),
  });
  await setDoc(doc(db, 'paths/esempio.it/entries/e2'), {
    initialUrl: '/carrello', intent: 'svuotare il carrello', steps: [{ selector: 'b#c', action: 'click', retracted: false }],
    success: false, createdAt: Timestamp.fromDate(ORA),
  });
});

const anon = env.unauthenticatedContext().firestore();
const loggato = env.authenticatedContext('utente-qualsiasi', { email: 'tizio@x.it' }).firestore();

console.log('\n— la porta che il feedback chiede di chiudere —');
await prova('anonimo: scaricare la collezione INTERA `paths` → negato', async () => {
  await assertFails(getDocs(collection(anon, 'paths')));
});
await prova('anonimo: leggere un vecchio documento piatto (col clientId) → negato', async () => {
  await assertFails(getDoc(doc(anon, 'paths/vecchio-doc-piatto')));
});
await prova('anonimo: query di gruppo su `entries` (tutti i domini insieme) → negata', async () => {
  await assertFails(getDocs(collectionGroup(anon, 'entries')));
});
await prova('anonimo: query di gruppo su `entries` con limit 200 → negata', async () => {
  await assertFails(getDocs(query(collectionGroup(anon, 'entries'), limit(200))));
});
await prova('anonimo: query di gruppo su `entries` con limit 1 → negata', async () => {
  await assertFails(getDocs(query(collectionGroup(anon, 'entries'), limit(1))));
});
await prova('LOGGATO: la collezione intera resta negata anche col login', async () => {
  await assertFails(getDocs(collection(loggato, 'paths')));
});
await prova('LOGGATO: la query di gruppo resta negata anche col login', async () => {
  await assertFails(getDocs(collectionGroup(loggato, 'entries')));
});
await prova('anonimo: elencare i domini raccolti con una query ordinata → negato', async () => {
  await assertFails(getDocs(query(collection(anon, 'paths'), limit(200))));
});

console.log('\n— la funzione deve continuare a funzionare —');
await prova('anonimo: leggere i percorsi di UN dominio nominato (limit 50) → riesce', async () => {
  const snap = await assertSucceeds(getDocs(query(collection(anon, 'paths/esempio.it/entries'), orderBy('createdAt', 'desc'), limit(50))));
  if (snap.size !== 2) throw new Error(`attesi 2 percorsi, arrivati ${snap.size}`);
});
await prova('anonimo: leggere un singolo percorso per id → riesce', async () => {
  await assertSucceeds(getDoc(doc(anon, 'paths/esempio.it/entries/e1')));
});
await prova('anonimo: dominio senza percorsi → elenco vuoto, non un errore', async () => {
  const snap = await assertSucceeds(getDocs(query(collection(anon, 'paths/mai-visto.org/entries'), limit(50))));
  if (snap.size !== 0) throw new Error('doveva essere vuoto');
});

console.log('\n— il tetto della lettura —');
await prova('anonimo: limit 200 (il tetto esatto) → riesce', async () => {
  await assertSucceeds(getDocs(query(collection(anon, 'paths/esempio.it/entries'), limit(200))));
});
await prova('anonimo: limit 201 → negato', async () => {
  await assertFails(getDocs(query(collection(anon, 'paths/esempio.it/entries'), limit(201))));
});
await prova('anonimo: limit 100000 → negato', async () => {
  await assertFails(getDocs(query(collection(anon, 'paths/esempio.it/entries'), limit(100000))));
});
await prova('anonimo: NESSUN limit sulla lettura di un dominio → negato (il tetto non si aggira)', async () => {
  await assertFails(getDocs(collection(anon, 'paths/esempio.it/entries')));
});

console.log('\n— il documento non deve poter tornare a dire CHI —');
const buono = { initialUrl: '/x', intent: 'fare x', steps: [], success: true, createdAt: Timestamp.now() };
await prova('anonimo: scrivere un percorso valido → riesce (la scrittura è un altro feedback)', async () => {
  await assertSucceeds(addDoc(collection(anon, 'paths/esempio.it/entries'), buono));
});
await prova('anonimo: rimettere `clientId` nel documento → negato', async () => {
  await assertFails(addDoc(collection(anon, 'paths/esempio.it/entries'), { ...buono, clientId: 'c-1' }));
});
await prova('anonimo: rimettere `userAgent` nel documento → negato', async () => {
  await assertFails(addDoc(collection(anon, 'paths/esempio.it/entries'), { ...buono, userAgent: 'Mozilla' }));
});
await prova('anonimo: rimettere `domain` come campo → negato', async () => {
  await assertFails(addDoc(collection(anon, 'paths/esempio.it/entries'), { ...buono, domain: 'esempio.it' }));
});
await prova('anonimo: modificare un percorso già scritto → negato', async () => {
  await assertFails(updateDoc(doc(anon, 'paths/esempio.it/entries/e1'), { intent: 'altro' }));
});
await prova('anonimo: cancellare un percorso → negato', async () => {
  await assertFails(deleteDoc(doc(anon, 'paths/esempio.it/entries/e1')));
});
await prova('anonimo: scrivere sul vecchio percorso piatto → negato', async () => {
  await assertFails(setDoc(doc(anon, 'paths/nuovo-piatto'), buono));
});

console.log(`\n${ok} verdi, ${ko} rossi`);
if (rossi.length) console.log('ROSSI:\n - ' + rossi.join('\n - '));
await env.cleanup();
process.exit(ko ? 1 : 0);
