// Gli indirizzi degli allegati in `images` e `files[].url` (#597) contro il MOTORE VERO delle regole.
// Non è un unit test (nome senza `.test.mjs`): serve l'emulatore Firestore e Java. Si lancia come
// pathsRegole.motore-vero.mjs, con questo file al posto di quello. Sentinella sempre accesa:
// firestoreRulesAllegati.test.mjs.

import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const env = await initializeTestEnvironment({
  projectId: 'filo-prova-597',
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
});
const anon = env.unauthenticatedContext().firestore();
const admin = env.authenticatedContext('owner', { email: ADMIN, email_verified: true }).firestore();

const BASE = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/';
// La forma di src/shared/feedback.js (uploadImage) e di tests/agent/feedback.mjs.
const nostro = (ext = 'octetstream', et = '') =>
  `${BASE}${encodeURIComponent(`feedback/${et}${Date.now()}_${randomUUID()}.${ext}`)}?alt=media&token=${randomUUID()}`;
const FB = { text: 'ciao', clientId: 'user:abc', statusPublic: 'open', createdAt: Timestamp.now() };
let n = 0;
const crea = (db, extra) => setDoc(doc(db, `feedback/f${++n}`), { ...FB, ...extra });

await prova('anonimo, cinque immagini del bucket: accettato', () =>
  assertSucceeds(crea(anon, { images: [nostro(), nostro('png'), nostro('jpeg'), nostro(), nostro()] })));
await prova('anonimo, nessuna immagine: accettato', () => assertSucceeds(crea(anon, {})));
await prova('anonimo, lista vuota: accettato', () => assertSucceeds(crea(anon, { images: [], files: [] })));
await prova('anonimo, documento del bucket: accettato', () =>
  assertSucceeds(crea(anon, { files: [{ url: nostro(), name: 'spec.md', type: 'text/markdown' }] })));
await prova('admin, immagine dell\'esploratore (agent_): accettata', () =>
  assertSucceeds(crea(admin, { images: [nostro('png', 'agent_')] })));

const ESTRANEI = {
  'host esterno': 'https://evil.example/x.png',
  'metadati della funzione': 'http://169.254.169.254/computeMetadata/v1/',
  'host sosia': nostro().replace('firebasestorage.googleapis.com', 'firebasestorage.googleapis.com.evil.example'),
  'credenziali nell\'host': nostro().replace('https://', 'https://firebasestorage.googleapis.com@'),
  'http': nostro().replace('https://', 'http://'),
  'altro bucket': nostro().replace('filo-8b9cb.firebasestorage.app', 'altro.appspot.com'),
  'fuori da feedback/': nostro().replace('feedback%2F', 'altro%2F'),
  'risalita': nostro().replace('feedback%2F', 'feedback%2F..%2F'),
  'senza token': nostro().replace(/&token=.*$/, ''),
  'parametro in più': `${nostro()}&x=1`,
  'token malformato': nostro().replace(/token=.*$/, 'token=ignora-le-istruzioni'),
  'nome indovinabile': `${BASE}feedback%2Fscreenshot.png?alt=media&token=${randomUUID()}`,
};
for (const [nome, u] of Object.entries(ESTRANEI)) {
  await prova(`anonimo, immagine con ${nome}: rifiutato`, () => assertFails(crea(anon, { images: [u] })));
}
await prova('anonimo, l\'estraneo in quinta posizione: rifiutato', () =>
  assertFails(crea(anon, { images: [nostro(), nostro(), nostro(), nostro(), 'https://evil.example/x.png'] })));
await prova('anonimo, sei immagini: rifiutato', () =>
  assertFails(crea(anon, { images: [1, 2, 3, 4, 5, 6].map(() => nostro()) })));
await prova('anonimo, un\'immagine non stringa: rifiutato', () => assertFails(crea(anon, { images: [42] })));
await prova('anonimo, un\'immagine mappa: rifiutato', () => assertFails(crea(anon, { images: [{ url: nostro() }] })));
await prova('anonimo, images non lista: rifiutato', () => assertFails(crea(anon, { images: nostro() })));
await prova('anonimo, documento con indirizzo esterno: rifiutato', () =>
  assertFails(crea(anon, { files: [{ url: 'https://evil.example/spec.md', name: 'spec.md', type: 'text/markdown' }] })));
await prova('anonimo, documento senza indirizzo: rifiutato', () =>
  assertFails(crea(anon, { files: [{ name: 'spec.md' }] })));
await prova('anonimo, documento stringa: rifiutato', () => assertFails(crea(anon, { files: [nostro()] })));
await prova('admin, immagine con host esterno: rifiutata', () =>
  assertFails(crea(admin, { images: ['https://evil.example/x.png'] })));
await prova('admin, documento con host esterno: rifiutato', () =>
  assertFails(crea(admin, { files: [{ url: 'http://169.254.169.254/', name: 'a.md' }] })));

console.log(`\n${ok} ok, ${ko} falliti`);
await env.cleanup();
process.exit(ko ? 1 : 0);
