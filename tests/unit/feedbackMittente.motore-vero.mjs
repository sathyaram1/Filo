// La prova del mittente (#595), la fiducia (#1148) e l'interruttore del Red Team (#896) contro il
// MOTORE VERO delle regole. Non è un unit test (nome senza `.test.mjs`): serve
// l'emulatore Firestore e Java. Si lancia come pathsRegole.motore-vero.mjs,
// accanto (stessa cartella usa-e-getta), con questo file al posto di quello:
//
//   RULES_FILE=<repo>/firestore.rules npx firebase emulators:exec \
//     --only firestore --project filo-prova-595 "node <cartella>/feedbackMittente.motore-vero.mjs"
//
// Le sentinelle sempre accese sono firestoreRulesSenderProof.test.mjs e firestoreRulesFiducia.test.mjs.

import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const env = await initializeTestEnvironment({
  projectId: 'filo-prova-595',
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
  const db = ctx.firestore();
  await setDoc(doc(db, `admins/${ADMIN}`), { ok: true });
  await setDoc(doc(db, 'feedback/vecchio'), { text: 'x', clientId: 'owner:abc', status: 'todo' });
});

const anon = env.unauthenticatedContext().firestore();
const loggato = env.authenticatedContext('chiunque', { email: 'x@y.z', email_verified: true }).firestore();
const admin = env.authenticatedContext('owner', { email: ADMIN, email_verified: true }).firestore();

const FEEDBACK = { text: 'ciao', clientId: 'owner:abc', statusPublic: 'open', createdAt: Timestamp.now() };

await prova('create anonima senza prova: accettata (il cammino di sempre)', () =>
  assertSucceeds(setDoc(doc(anon, 'feedback/a1'), FEEDBACK)));
await prova('create anonima con senderProof admin: rifiutata', () =>
  assertFails(setDoc(doc(anon, 'feedback/a2'), { ...FEEDBACK, senderProof: 'admin' })));
await prova('create di un loggato qualunque con senderProof: rifiutata', () =>
  assertFails(setDoc(doc(loggato, 'feedback/a3'), { ...FEEDBACK, senderProof: 'admin' })));
await prova('create admin con senderProof admin: accettata', () =>
  assertSucceeds(setDoc(doc(admin, 'feedback/a4'), { ...FEEDBACK, senderProof: 'admin' })));
await prova('ripasso admin di un documento vecchio: senderProof admin accettato', () =>
  assertSucceeds(updateDoc(doc(admin, 'feedback/vecchio'), { senderProof: 'admin' })));
await prova('ripasso admin con un valore inventato: rifiutato', () =>
  assertFails(updateDoc(doc(admin, 'feedback/vecchio'), { senderProof: 'utente' })));
await prova('un loggato qualunque non aggiunge senderProof a un documento', () =>
  assertFails(updateDoc(doc(loggato, 'feedback/a1'), { senderProof: 'admin' })));

// #1148: la fiducia la scrive solo l'Admin SDK, nemmeno l'admin (che è anche ogni sessione locale).
for (const campo of ['fiducia', 'fiduciaDa', 'genitori', 'mergePreapproved']) {
  const valore = campo === 'genitori' ? ['x'] : campo === 'fiducia' ? 'fidato' : { by: 'owner', at: 1 };
  await prova(`create admin con ${campo}: rifiutata`, () =>
    assertFails(setDoc(doc(admin, `feedback/fid-${campo}`), { ...FEEDBACK, senderProof: 'admin', [campo]: valore })));
  await prova(`create anonima con ${campo}: rifiutata`, () =>
    assertFails(setDoc(doc(anon, `feedback/fan-${campo}`), { ...FEEDBACK, [campo]: valore })));
  await prova(`update admin con ${campo}: rifiutato`, () =>
    assertFails(updateDoc(doc(admin, 'feedback/vecchio'), { [campo]: valore })));
}
await prova('create admin col biglietto locale: accettata', () =>
  assertSucceeds(setDoc(doc(admin, 'feedback/big1'), { ...FEEDBACK, senderProof: 'admin', bigliettoLocale: 'a'.repeat(64) })));
await prova('create admin con un biglietto locale troppo lungo: rifiutata', () =>
  assertFails(setDoc(doc(admin, 'feedback/big2'), { ...FEEDBACK, senderProof: 'admin', bigliettoLocale: 'a'.repeat(65) })));
await prova('create anonima col biglietto locale: rifiutata', () =>
  assertFails(setDoc(doc(anon, 'feedback/big3'), { ...FEEDBACK, bigliettoLocale: 'a'.repeat(64) })));
await prova('update admin del biglietto locale: rifiutato', () =>
  assertFails(updateDoc(doc(admin, 'feedback/big1'), { bigliettoLocale: 'b'.repeat(64) })));

await prova('config/redteam: lo legge chiunque', () =>
  assertSucceeds(getDoc(doc(anon, 'config/redteam'))));
await prova('config/redteam: un loggato qualunque non lo scrive', () =>
  assertFails(setDoc(doc(loggato, 'config/redteam'), { openToAll: true })));
await prova('config/redteam: un anonimo non lo scrive', () =>
  assertFails(setDoc(doc(anon, 'config/redteam'), { openToAll: true })));
await prova('config/redteam: l’admin lo scrive', () =>
  assertSucceeds(setDoc(doc(admin, 'config/redteam'), { openToAll: true, updatedAt: Timestamp.now() })));
await prova('config/redteam: niente campi fuori da openToAll e updatedAt', () =>
  assertFails(setDoc(doc(admin, 'config/redteam'), { openToAll: true, altro: 1 })));
await prova('config/redteam: openToAll è un booleano', () =>
  assertFails(setDoc(doc(admin, 'config/redteam'), { openToAll: 'sì' })));
await prova('config/redteam: l’admin lo cancella (= in pausa)', () =>
  assertSucceeds(deleteDoc(doc(admin, 'config/redteam'))));

console.log(`\n${ok} ok, ${ko} falliti`);
await env.cleanup();
process.exit(ko ? 1 : 0);
