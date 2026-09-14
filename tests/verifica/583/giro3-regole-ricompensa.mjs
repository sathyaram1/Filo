// Verifica #583, giro 3 — la CIFRA della ricompensa sulla scheda pubblica,
// provata col MOTORE VERO delle regole.
//
// NON è uno spec: il nome finisce in `.mjs` apposta, come
// `giro1-regole-col-motore-vero.mjs`, così la suite non prova a lanciarlo (gli
// servono l'emulatore Firestore ufficiale e Java). Si lancia con le stesse
// istruzioni che stanno in testa a quel file, sostituendo il nome dello script.
//
// Perché esiste: `reward` è un campo NUOVO, arrivato con la correzione del giro
// 2, e le regole sono cambiate dopo l'ultima volta che il motore vero le ha
// viste. Da quella cifra dipendono i crediti che la macchina di chi ha
// segnalato si accredita da sola: se un utente qualunque potesse scriverla, si
// regalerebbe crediti scrivendo un numero.
//
// Esito al giro 3 (2026-09-11): 7 righe, tutte verdi.

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const OWNER = 'owner@filo.test';
let passati = 0, falliti = 0;
async function prova(nome, fn) {
  try { await fn(); passati++; console.log(`  ok   ${nome}`); }
  catch (e) { falliti++; console.log(`  ROTT ${nome}\n       ${e?.message || e}`); }
}

const env = await initializeTestEnvironment({
  projectId: 'filo-prova-583',
  firestore: { host: '127.0.0.1', port: 8189, rules: readFileSync('firestore.rules', 'utf8') },
});
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, 'admins', OWNER), { role: 'admin' });
});

const owner = env.authenticatedContext('owner-uid', { email: OWNER, email_verified: true }).firestore();
const utente = env.authenticatedContext('utente-uid', { email: 'tizio@gmail.com', email_verified: true }).firestore();

const SCHEDA = {
  name: 'Un fix', seq: 1, subSeq: 0, status: 'done', statusPublic: 'closed',
  resolvedInVersion: '0.2.70', createdAt: '2026-06-01T00:00:00Z',
  resolvedAt: '2026-06-02T00:00:00Z', clientIdTag: 'a'.repeat(32),
  userNote: 'sistemato', publishedAt: '2026-06-03T00:00:00Z',
};

console.log('\n— la cifra della ricompensa —');
await prova('owner: pubblica una scheda con la fascia massima', () =>
  assertSucceeds(setDoc(doc(owner, 'feedback-public', 'fb-1'), { ...SCHEDA, reward: 300 })));
await prova('owner: NON può promettere una cifra oltre il tetto', () =>
  assertFails(setDoc(doc(owner, 'feedback-public', 'fb-2'), { ...SCHEDA, reward: 100000 })));
await prova('owner: NON può promettere una cifra negativa', () =>
  assertFails(setDoc(doc(owner, 'feedback-public', 'fb-3'), { ...SCHEDA, reward: -5 })));
await prova('owner: NON può promettere una cifra che non è un numero intero', () =>
  assertFails(setDoc(doc(owner, 'feedback-public', 'fb-4'), { ...SCHEDA, reward: '9999' })));
await prova('utente qualunque: NON si alza la ricompensa da solo', () =>
  assertFails(updateDoc(doc(utente, 'feedback-public', 'fb-1'), { reward: 1000 })));
await prova('utente qualunque: NON alza la ricompensa insieme al suo voto', () =>
  assertFails(updateDoc(doc(utente, 'feedback-public', 'fb-1'), {
    reward: 1000,
    [`votes.utente-uid`]: { vote: 'works', at: '2026-06-04T00:00:00Z', credibilitySnapshot: 1 },
  })));
await prova('utente qualunque: il suo voto da solo passa ancora', () =>
  assertSucceeds(updateDoc(doc(utente, 'feedback-public', 'fb-1'), {
    [`votes.utente-uid`]: { vote: 'works', at: '2026-06-04T00:00:00Z', credibilitySnapshot: 1 },
  })));

console.log(`\n${passati} passate, ${falliti} rotte`);
await env.cleanup();
process.exit(falliti ? 1 : 0);
