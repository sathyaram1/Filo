// Le regole Storage degli allegati (#582) provate col MOTORE VERO.
//
// NON è uno spec: il nome finisce in `.mjs` e non in `.spec.mjs` apposta, così
// la suite non prova a lanciarlo. Per girare ha bisogno di due cose che nella
// suite non ci sono e non ci devono essere — gli emulatori ufficiali Firebase
// (centinaia di MB) e Java. La sentinella sempre accesa è
// `tests/unit/storageRulesAllegati.test.mjs`, che rilegge il file che si
// deploya in millisecondi; questo file è l'altra metà: la prova che quel file,
// dato in pasto al motore vero, si comporta come dice.
//
// Servono DUE emulatori, non uno: le regole riconoscono l'owner leggendo
// l'allowlist `admins` di Firestore (regole cross-service), quindi il motore di
// Storage deve poter interrogare quello di Firestore.
//
// COME SI LANCIA (fuori dal repo, in una cartella usa-e-getta: stando nel repo
// Node cerca i pacchetti nel node_modules del repo, dove l'emulatore non c'è —
// ed è giusto che non ci sia):
//
//   mkdir /tmp/emu && cd /tmp/emu && npm init -y
//   npm i firebase-tools @firebase/rules-unit-testing firebase
//   cp <repo>/storage.rules <repo>/firestore.rules .
//   cp <repo>/tests/rules/storage-allegati-motore-vero.mjs .
//   cat > firebase.json <<'FINE'
//   { "firestore": { "rules": "firestore.rules" },
//     "storage": { "rules": "storage.rules" },
//     "emulators": { "firestore": { "port": 8089, "host": "127.0.0.1" },
//                    "storage":   { "port": 9199, "host": "127.0.0.1" },
//                    "ui": { "enabled": false } } }
//   FINE
//   npx firebase emulators:exec --only firestore,storage --project filo-prova-582 \
//     "node storage-allegati-motore-vero.mjs"
//
// Esito atteso: tutte le righe verdi, uscita 0. Al primo passaggio (2026-09-11)
// è stato così.
//
// CONTROPROVA, che è la metà che conta: le stesse chiamate con le regole di
// `main` (`git show main:storage.rules`, via STORAGE_RULES_FILE). Lì l'anonimo
// scarica l'allegato di un altro, ELENCA il bucket e sovrascrive un file
// esistente. Una prova che passa su entrambe le versioni non prova niente.

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, listAll, deleteObject } from 'firebase/storage';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const REGOLE_STORAGE = process.env.STORAGE_RULES_FILE || 'storage.rules';
const REGOLE_FIRESTORE = process.env.FIRESTORE_RULES_FILE || 'firestore.rules';

const env = await initializeTestEnvironment({
  projectId: 'filo-prova-582',
  firestore: { host: '127.0.0.1', port: 8089, rules: readFileSync(REGOLE_FIRESTORE, 'utf8') },
  storage: { host: '127.0.0.1', port: 9199, rules: readFileSync(REGOLE_STORAGE, 'utf8') },
});

await env.clearFirestore();
await env.clearStorage();

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const nome = (etichetta) => `feedback/${etichetta ? `${etichetta}_` : ''}${Date.now()}_${randomUUID()}.png`;

// Un allegato che c'è GIÀ: è quello che l'anonimo proverà a leggere, a
// sovrascrivere e a cancellare. Seminato con le regole spente, come farebbe un
// tester che ha appena mandato uno screenshot.
const ESISTENTE = nome();
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'admins', 'owner@example.com'), { added: true });
  await uploadBytes(ref(ctx.storage(), ESISTENTE), PNG, { contentType: 'image/png' });
});

const owner = env.authenticatedContext('uid-owner', { email: 'owner@example.com', email_verified: true });
// Per entrare basta la chiave web che sta nel repo: un account Google qualunque
// è il caso peggiore realistico, non un'ipotesi di scuola.
const googleQualunque = env.authenticatedContext('uid-chiunque', { email: 'chiunque@gmail.com', email_verified: true });
const anonimo = env.authenticatedContext('uid-anon', {});
const fuori = env.unauthenticatedContext();

const esiti = [];
async function prova(nomeProva, attesa, fn) {
  try {
    if (attesa === 'ok') await assertSucceeds(fn());
    else await assertFails(fn());
    esiti.push(['OK   ', nomeProva]);
  } catch (e) {
    esiti.push(['ROSSO', `${nomeProva} — ${String(e && e.message).slice(0, 200)}`]);
  }
}

const carica = (ctx, percorso, byte = PNG, tipo = 'image/png') => () =>
  uploadBytes(ref(ctx.storage(), percorso), byte, { contentType: tipo });

// ── La porta che la segnalazione voleva chiusa ──────────────────────────────
await prova('allegato esistente — lettura fuori da ogni login: NEGATA', 'ko',
  () => getBytes(ref(fuori.storage(), ESISTENTE)));
await prova('allegato esistente — lettura da account Google qualunque: NEGATA', 'ko',
  () => getBytes(ref(googleQualunque.storage(), ESISTENTE)));
await prova('allegato esistente — lettura da login anonimo: NEGATA', 'ko',
  () => getBytes(ref(anonimo.storage(), ESISTENTE)));
await prova('allegato esistente — lettura dell’owner (allowlist admins): OK', 'ok',
  () => getBytes(ref(owner.storage(), ESISTENTE)));

// ── Elencare il bucket: per nessuno, owner compreso ─────────────────────────
await prova('elenco di feedback/ senza login: NEGATO', 'ko',
  () => listAll(ref(fuori.storage(), 'feedback')));
await prova('elenco di feedback/ da account qualunque: NEGATO', 'ko',
  () => listAll(ref(googleQualunque.storage(), 'feedback')));
await prova('elenco della radice del bucket: NEGATO', 'ko',
  () => listAll(ref(googleQualunque.storage(), '')));

// ── Sovrascrittura e cancellazione ──────────────────────────────────────────
await prova('sovrascrittura di un allegato esistente, senza login: NEGATA', 'ko',
  carica(fuori, ESISTENTE));
await prova('sovrascrittura di un allegato esistente, da account qualunque: NEGATA', 'ko',
  carica(googleQualunque, ESISTENTE));
await prova('sovrascrittura di un allegato esistente, dall’owner: NEGATA', 'ko',
  carica(owner, ESISTENTE));
await prova('cancellazione di un allegato esistente: NEGATA', 'ko',
  () => deleteObject(ref(googleQualunque.storage(), ESISTENTE)));

// ── Quello che NON deve essersi rotto: l'invio anonimo di un feedback ───────
await prova('allegato NUOVO da chi manda un feedback senza login: OK', 'ok',
  carica(fuori, nome()));
await prova('allegato NUOVO etichettato (agente esploratore): OK', 'ok',
  carica(fuori, nome('agent')));
await prova('documento passivo (application/pdf): OK', 'ok',
  carica(fuori, nome().replace(/\.png$/, '.pdf'), PNG, 'application/pdf'));
await prova('blob cifrato (application/octet-stream): OK', 'ok',
  carica(fuori, nome().replace(/\.png$/, '.bin'), PNG, 'application/octet-stream'));
await prova('allegato da 4 MB tondi, cifrato (col preambolo sfora di poco): OK', 'ok',
  carica(fuori, nome().replace(/\.png$/, '.bin'), new Uint8Array(4 * 1024 * 1024 + 90), 'application/octet-stream'));

// ── Nomi: il percorso deve restare non indovinabile ─────────────────────────
await prova('nome indovinabile (screenshot.png): NEGATO', 'ko',
  carica(fuori, 'feedback/screenshot.png'));
await prova('nome col solo timestamp: NEGATO', 'ko',
  carica(fuori, `feedback/${Date.now()}.png`));
await prova('sottocartella di feedback/: NEGATA', 'ko',
  carica(fuori, `feedback/sotto/${Date.now()}_${randomUUID()}.png`));
await prova('fuori da feedback/: NEGATO', 'ko',
  carica(fuori, `pubblico/${Date.now()}_${randomUUID()}.png`));

// ── Tipi attivi e dimensione ────────────────────────────────────────────────
await prova('text/html (documento ATTIVO nel dominio di Storage): NEGATO', 'ko',
  carica(fuori, nome().replace(/\.png$/, '.html'), PNG, 'text/html'));
await prova('image/svg+xml (può contenere script): NEGATO', 'ko',
  carica(fuori, nome().replace(/\.png$/, '.svg'), PNG, 'image/svg+xml'));
await prova('allegato oltre il tetto (5 MB): NEGATO', 'ko',
  carica(fuori, nome().replace(/\.png$/, '.bin'), new Uint8Array(5 * 1024 * 1024), 'application/octet-stream'));

await env.cleanup();

let rossi = 0;
for (const [stato, riga] of esiti) {
  if (stato.trim() === 'ROSSO') rossi++;
  console.log(`${stato} ${riga}`);
}
console.log(`\n${esiti.length - rossi}/${esiti.length} verdi`);
process.exit(rossi ? 1 : 0);
