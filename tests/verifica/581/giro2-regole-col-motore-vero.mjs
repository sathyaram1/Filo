// Verifica #581, giro 2 — le regole Firestore provate col MOTORE VERO.
//
// NON è uno spec: il nome finisce in `.mjs` e non in `.spec.mjs` apposta, così
// la suite non prova a lanciarlo. Per girare ha bisogno di due cose che nella
// suite non ci sono e non ci devono essere — l'emulatore Firestore ufficiale
// (un .jar da centinaia di MB) e Java. La sentinella che resta sempre accesa
// sulle regole è `tests/unit/firestoreRulesConfigSecrets.test.mjs`, che rilegge
// il file in millisecondi; questo file è l'altra metà: la prova che quel file,
// dato in pasto al motore vero, si comporta come dice.
//
// Perché resta nel ramo. È la memoria del giro: chi verifica dopo non deve
// ricostruirla da capo, e chi corregge può rilanciarla prima di consegnare.
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
//   npx firebase emulators:exec --only firestore --project filo-prova-581 \
//     "node <repo>/tests/verifica/581/giro2-regole-col-motore-vero.mjs"
//
// Esito atteso: 18 righe verdi, uscita 0. Al giro 2 (2026-09-11) è stato così.
//
// Insieme a questo è stata fatta la CONTROPROVA: le stesse chiamate con le
// regole di `main` (`git show main:firestore.rules`), dove lo stesso account
// Google qualunque il documento se l'è portato via intero
// ({"apiKeys":{"openrouter":…,"tavily":…},"safeBrowsingKey":…}). Serve a
// dimostrare che la porta era aperta davvero e che a chiuderla è stato questo
// lavoro: una prova che passa su entrambe le versioni non prova niente.

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, getDocs, collection } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGOLE = process.env.RULES_FILE || resolve(__dirname, '..', '..', '..', 'firestore.rules');

const env = await initializeTestEnvironment({
  projectId: 'filo-prova-581',
  firestore: { host: '127.0.0.1', port: 8089, rules: readFileSync(REGOLE, 'utf8') },
});

await env.clearFirestore();

// Semina con le regole spente: l'elenco degli amministratori e i documenti.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'admins', 'owner@example.com'), { added: true });
  await setDoc(doc(db, 'routines', 'routine@example.com'), { added: true });
  await setDoc(doc(db, 'config', 'secrets'), {
    apiKeys: { openrouter: 'or-VERO', tavily: 'tav-VERO' },
    safeBrowsingKey: 'gsb-VERO',
  });
  await setDoc(doc(db, 'config', 'judgeSecrets'), { openrouterKey: 'or-giudici' });
  await setDoc(doc(db, 'config', 'models'), { provider: 'openrouter' });
});

const amministratore = env.authenticatedContext('uid-admin', { email: 'owner@example.com', email_verified: true });
const googleQualunque = env.authenticatedContext('uid-chiunque', { email: 'chiunque@gmail.com', email_verified: true });
const nonVerificato = env.authenticatedContext('uid-nv', { email: 'nv@gmail.com', email_verified: false });
const routine = env.authenticatedContext('uid-routine', { email: 'routine@example.com', email_verified: true });
// Login anonimo: da quando l'identità di un'installazione è anonima, per
// entrare basta la chiave pubblica che sta nel repo. È il caso peggiore.
const anonimo = env.authenticatedContext('uid-anon', {});
const fuori = env.unauthenticatedContext();

const esiti = [];
async function prova(nome, attesa, fn) {
  try {
    if (attesa === 'ok') await assertSucceeds(fn());
    else await assertFails(fn());
    esiti.push(['OK   ', nome]);
  } catch (e) {
    esiti.push(['ROSSO', `${nome} — ${e.message.slice(0, 200)}`]);
  }
}

const leggiSegreti = (ctx) => () => getDoc(doc(ctx.firestore(), 'config', 'secrets'));
const leggiGiudici = (ctx) => () => getDoc(doc(ctx.firestore(), 'config', 'judgeSecrets'));

// ── La porta che la segnalazione voleva chiusa ──────────────────────────────
await prova('config/secrets — account Google verificato qualunque: NEGATO', 'ko', leggiSegreti(googleQualunque));
await prova('config/secrets — account anonimo (solo chiave pubblica): NEGATO', 'ko', leggiSegreti(anonimo));
await prova('config/secrets — email non verificata: NEGATO', 'ko', leggiSegreti(nonVerificato));
await prova('config/secrets — routine (allowlist debole): NEGATO', 'ko', leggiSegreti(routine));
await prova('config/secrets — fuori da ogni login: NEGATO', 'ko', leggiSegreti(fuori));
await prova('config/secrets — amministratore: LEGGE (le chiavi si ruotano ancora)', 'ok', leggiSegreti(amministratore));

await prova('config/secrets — scrittura da account qualunque: NEGATA', 'ko',
  () => updateDoc(doc(googleQualunque.firestore(), 'config', 'secrets'), { 'apiKeys.openrouter': 'rubata' }));
await prova('config/secrets — scrittura da routine: NEGATA', 'ko',
  () => updateDoc(doc(routine.firestore(), 'config', 'secrets'), { safeBrowsingKey: 'x' }));
await prova('config/secrets — scrittura da amministratore: OK', 'ok',
  () => updateDoc(doc(amministratore.firestore(), 'config', 'secrets'), { safeBrowsingKey: 'gsb-ruotata' }));

// Il gemello si comporta uguale: l'asimmetria era la spia.
await prova('config/judgeSecrets — account qualunque: NEGATO', 'ko', leggiGiudici(googleQualunque));
await prova('config/judgeSecrets — anonimo: NEGATO', 'ko', leggiGiudici(anonimo));
await prova('config/judgeSecrets — amministratore: LEGGE', 'ok', leggiGiudici(amministratore));

// ── Quello che NON deve essersi rotto ───────────────────────────────────────
await prova('config/models — lettura pubblica senza login: OK', 'ok',
  () => getDoc(doc(fuori.firestore(), 'config', 'models')));
await prova('config/models — scrittura da account qualunque: NEGATA', 'ko',
  () => updateDoc(doc(googleQualunque.firestore(), 'config', 'models'), { provider: 'finto' }));

// ── La strada laterale: chiedere la RACCOLTA invece del documento ───────────
await prova('elenco della raccolta config da account qualunque: NEGATO', 'ko',
  () => getDocs(collection(googleQualunque.firestore(), 'config')));
await prova('elenco della raccolta config da anonimo: NEGATO', 'ko',
  () => getDocs(collection(anonimo.firestore(), 'config')));

// ── L'elenco degli amministratori non si scrive dal client ──────────────────
await prova('admins/<mia-email> — creazione da account qualunque: NEGATA', 'ko',
  () => setDoc(doc(googleQualunque.firestore(), 'admins', 'chiunque@gmail.com'), { x: 1 }));
await prova('admins — lettura da account qualunque: NEGATA', 'ko',
  () => getDoc(doc(googleQualunque.firestore(), 'admins', 'owner@example.com')));

await env.cleanup();

let rossi = 0;
for (const [stato, nome] of esiti) {
  if (stato.trim() === 'ROSSO') rossi++;
  console.log(`${stato} ${nome}`);
}
console.log(`\n${esiti.length - rossi}/${esiti.length} verdi`);
process.exit(rossi ? 1 : 0);
