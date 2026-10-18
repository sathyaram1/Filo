// La forma di `localMerges` alla creazione admin (#939, #1336) contro il MOTORE VERO delle regole. Non è un unit test
// (nome senza `.test.mjs`): serve l'emulatore Firestore e Java. Si lancia come pathsRegole.motore-vero.mjs, con questo
// file al posto di quello. La sentinella sempre accesa è in partiLavoro.test.mjs.

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const env = await initializeTestEnvironment({
  projectId: 'filo-prova-939',
  firestore: { host: '127.0.0.1', port: Number(process.env.EMU_PORT || 8089), rules: readFileSync(process.env.RULES_FILE || 'firestore.rules', 'utf8') },
});
await env.clearFirestore();

let ok = 0; let ko = 0;
async function prova(nome, fn) {
  try { await fn(); console.log(`  ok   ${nome}`); ok += 1; }
  catch (e) { console.log(`  FAIL ${nome}\n       ${e.message}`); ko += 1; }
}

const ADMIN = 'owner@esempio.it';
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), `admins/${ADMIN}`), { ok: true });
  // Com'era prima del controllo: nato malformato, poi nessun aggiornamento dell'owner passa.
  await setDoc(doc(ctx.firestore(), 'feedback/malformato'), { text: 'x', clientId: 'owner:abc', status: 'todo', localMerges: { app: 'ieri' } });
});
const admin = env.authenticatedContext('owner', { email: ADMIN, email_verified: true }).firestore();
const anon = env.unauthenticatedContext().firestore();

const BASE = { text: 'ciao', clientId: 'owner:abc', statusPublic: 'open', createdAt: Timestamp.now() };
const MALFORMATI = [
  ['app come testo', { app: 'ieri' }],
  ['server a zero', { server: 0 }],
  ['una chiave in più', { app: 5, altro: 1 }],
  ['solo fuori elenco', { solo: 'tutto' }],
  ['ramo fuori forma', { ramo: 'main' }],
  ['non una mappa', 'app'],
];

for (const [nome, localMerges] of MALFORMATI) {
  await prova(`create admin con localMerges malformato (${nome}): rifiutata`, () =>
    assertFails(setDoc(doc(admin, `feedback/m-${nome.replace(/\W+/g, '-')}`), { ...BASE, localMerges })));
}
await prova('create admin con localMerges ben formato: accettata', () =>
  assertSucceeds(setDoc(doc(admin, 'feedback/buono'), { ...BASE, localMerges: { app: 5, server: 7, solo: 'server', ramo: 'claude/x' } })));
await prova('create admin senza localMerges: accettata', () =>
  assertSucceeds(setDoc(doc(admin, 'feedback/senza'), BASE)));
await prova('il nato ben formato si aggiorna da Gestione', () =>
  assertSucceeds(updateDoc(doc(admin, 'feedback/buono'), { starred: true })));
await prova('controprova: il nato malformato non si aggiorna più (il perché del controllo alla nascita)', () =>
  assertFails(updateDoc(doc(admin, 'feedback/malformato'), { starred: true })));
await prova('create anonima con localMerges: rifiutata come prima', () =>
  assertFails(setDoc(doc(anon, 'feedback/anon'), { ...BASE, localMerges: { app: 5 } })));

await env.cleanup();
console.log(`\n${ok} ok, ${ko} falliti`);
process.exit(ko ? 1 : 0);
