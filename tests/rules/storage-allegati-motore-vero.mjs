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
// Si lanciano DUE emulatori, non uno. Non più perché le regole interroghino
// Firestore — quel ramo non c'è più, la lettura è negata a tutti — ma perché i
// contesti autenticati della prova (l'owner, un account Google qualunque)
// vogliono un progetto completo, e perché caricare anche `firestore.rules`
// tiene le due metà dello stesso confine sotto lo stesso comando.
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
// Esito atteso: tutte le righe verdi, uscita 0, più le righe NOTA di ciò che
// l'emulatore non sa misurare. Al passaggio di #1518 (2026-10-23, firebase-tools
// 15.34): 47/47 con due NOTE (Cache-Control e Content-Language non arrivano alle
// regole; il codice di scarico scelto da chi carica l'emulatore lo toglie dai
// metadati prima di valutarle).
//
// QUEL CHE L'EMULATORE NON DICE (#1666): il motore vero scrive il codice di
// scarico in `metadata.firebaseStorageDownloadTokens` PRIMA di valutare le
// regole. Con `metadata.size() == 0` qui tutto era verde e in produzione ogni
// allegato prendeva 403 dal 23/10 al 25/10. Dopo ogni pubblicazione delle
// regole la prova che conta è un caricamento vero dall'app (o `sealForUpload`
// più POST al deposito): se risponde 403, il verde di questo file non vale.
//
// CONTROPROVA, che è la metà che conta: le stesse chiamate con le regole di
// PRIMA (`git show origin/main:storage.rules > vecchie.rules`, poi
// `STORAGE_RULES_FILE=vecchie.rules`; `HEAD` no, sul ramo il salvataggio
// automatico ha già le nuove). Per #1518: 27/47, e i venti rossi sono il danno
// segnalato — senza login entravano immagini e testi in chiaro, octet-stream
// con estensione libera (.exe, .html), un nome di scarico scelto, una chiave
// personalizzata, una codifica; e la funzione dei metadati non c'era. Una prova
// che resta verde su entrambe le versioni non prova niente.

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
const PROGETTO = 'filo-prova-582';
const DEPOSITO = `${PROGETTO}.appspot.com`;
const EMULATORE = 'http://127.0.0.1:9199';

const env = await initializeTestEnvironment({
  projectId: PROGETTO,
  firestore: { host: '127.0.0.1', port: 8089, rules: readFileSync(REGOLE_FIRESTORE, 'utf8') },
  storage: { host: '127.0.0.1', port: 9199, rules: readFileSync(REGOLE_STORAGE, 'utf8') },
});

await env.clearFirestore();
await env.clearStorage();

// Quello che carica l'app da #602: un blob cifrato, tipo opaco. Per le regole il
// contenuto non conta, conta come si presenta.
const OPACO = 'application/octet-stream';
const BLOB = new Uint8Array([0x01, 0x04, 0x2a, 0x2a, 0x2a, 0x2a, 0x2a, 0x2a]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Il nome come lo dà `SN_FEEDBACK.attachmentPath`, ricopiato perché la prova gira fuori dal repo.
const nome = (etichetta, ext = 'octetstream') => `feedback/${etichetta ? `${etichetta}_` : ''}${Date.now()}_${randomUUID()}.${ext}`;

// Un allegato che c'è GIÀ: è quello che l'anonimo proverà a leggere, a
// sovrascrivere e a cancellare. Seminato con le regole spente, come farebbe un
// tester che ha appena mandato uno screenshot.
const ESISTENTE = nome();
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'admins', 'owner@example.com'), { added: true });
  await uploadBytes(ref(ctx.storage(), ESISTENTE), BLOB, { contentType: OPACO });
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

const carica = (ctx, percorso, byte = BLOB, metadati = { contentType: OPACO }) => () =>
  uploadBytes(ref(ctx.storage(), percorso), byte, metadati);

/**
 * Il caricamento come lo fa l'app (src/shared/feedback.js → uploadImage): POST
 * `uploadType=media`, senza login, nessun metadato oltre al tipo. Torna il
 * codice di scarico, che è la sola chiave dell'allegato: senza, è un rifiuto.
 */
function caricaComeLApp(percorso, tipo = OPACO) {
  return async () => {
    const r = await fetch(`${EMULATORE}/v0/b/${DEPOSITO}/o?uploadType=media&name=${encodeURIComponent(percorso)}`, {
      method: 'POST', headers: { 'Content-Type': tipo }, body: BLOB,
    });
    if (r.status === 403) throw Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' });
    if (!r.ok) throw new Error(`deposito ${r.status}`);
    const j = await r.json();
    if (!j.downloadTokens) throw new Error('accettato senza codice di scarico');
    return j;
  };
}

/**
 * Quello che questo attrezzo non sa provare: si scrive, non si finge.
 */
function nota(riga) { esiti.push(['NOTA ', riga]); }

// ── La porta che la segnalazione voleva chiusa ──────────────────────────────
await prova('allegato esistente — lettura fuori da ogni login: NEGATA', 'ko',
  () => getBytes(ref(fuori.storage(), ESISTENTE)));
await prova('allegato esistente — lettura da account Google qualunque: NEGATA', 'ko',
  () => getBytes(ref(googleQualunque.storage(), ESISTENTE)));
await prova('allegato esistente — lettura da login anonimo: NEGATA', 'ko',
  () => getBytes(ref(anonimo.storage(), ESISTENTE)));
// L'owner NON fa eccezione: la dashboard apre gli allegati col download token
// dentro l'URL salvato nel feedback (valutato da Firebase PRIMA delle regole),
// e il server dei giudici con l'Admin SDK, che le regole non le guarda affatto.
await prova('allegato esistente — lettura dell’owner: NEGATA anche a lui', 'ko',
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
await prova('blob cifrato come lo carica l’app, senza login: OK e col codice di scarico', 'ok',
  caricaComeLApp(nome()));
await prova('blob cifrato dalla libreria di Firebase, solo col tipo: OK', 'ok',
  carica(fuori, nome()));
await prova('allegato NUOVO etichettato (agente esploratore): OK', 'ok',
  caricaComeLApp(nome('agent')));
await prova('allegato da 4 MB tondi, cifrato (col preambolo sfora di poco): OK', 'ok',
  carica(fuori, nome(), new Uint8Array(4 * 1024 * 1024 + 90)));
// Le due forme che Firebase scrive da sé: ammesse perché il nome lo fissa lui.
{
  const n = nome();
  await prova('Content-Disposition di serie (inline): OK', 'ok',
    carica(fuori, nome(), BLOB, { contentType: OPACO, contentDisposition: 'inline' }));
  await prova('Content-Disposition di serie col nome dell’oggetto: OK', 'ok',
    carica(fuori, n, BLOB, { contentType: OPACO, contentDisposition: `inline; filename*=utf-8''${n.split('/')[1]}` }));
}

// ── Byte in chiaro: rifiutati, con qualunque nome (#1518) ───────────────────
await prova('immagine in chiaro, senza login (image/png, .png): NEGATA', 'ko',
  carica(fuori, nome('', 'png'), PNG, { contentType: 'image/png' }));
await prova('immagine in chiaro col nome giusto (image/png, .octetstream): NEGATA', 'ko',
  carica(fuori, nome(), PNG, { contentType: 'image/png' }));
await prova('testo in chiaro come lo caricherebbe l’app (text/plain): NEGATO', 'ko',
  caricaComeLApp(nome('', 'txt'), 'text/plain'));
for (const [ext, tipo] of [['pdf', 'application/pdf'], ['tsv', 'text/tab-separated-values'], ['yaml', 'application/x-yaml'], ['json', 'application/json']]) {
  await prova(`documento in chiaro (${tipo}): NEGATO`, 'ko',
    carica(fuori, nome('', ext), BLOB, { contentType: tipo }));
}

// ── Il tipo opaco con un nome che non è quello dell'app ─────────────────────
for (const ext of ['bin', 'exe', 'png', 'html', 'octetstreamx']) {
  await prova(`octet-stream con estensione .${ext}: NEGATO`, 'ko',
    caricaComeLApp(nome('', ext)));
}

// ── Metadati scelti da chi carica (#1518) ───────────────────────────────────
await prova('nome di scarico scelto (attachment; filename="fattura.exe"): NEGATO', 'ko',
  carica(fuori, nome(), BLOB, { contentType: OPACO, contentDisposition: 'attachment; filename="fattura.exe"' }));
await prova('nome di scarico travestito da quello di serie (inline; fattura.exe): NEGATO', 'ko',
  carica(fuori, nome(), BLOB, { contentType: OPACO, contentDisposition: "inline; filename*=utf-8''fattura.exe" }));
await prova('chiave personalizzata (un segno «già sistemato»): NEGATA', 'ko',
  carica(fuori, nome(), BLOB, { contentType: OPACO, customMetadata: { filoSistemato: 'si' } }));
await prova('codifica scelta (Content-Encoding: gzip): NEGATA', 'ko',
  carica(fuori, nome(), BLOB, { contentType: OPACO, contentEncoding: 'gzip' }));
nota('Cache-Control e Content-Language scelti: l’emulatore non li passa alle regole, quindi qui passano. '
  + 'La riga c’è, e la sua espressione si prova più sotto su una risorsa scritta a mano.');
nota('Codice di scarico scelto da chi carica: l’emulatore lo toglie dai metadati prima delle regole e lo usa come codice. '
  + 'Se il motore vero lo lasciasse vedere, la stessa riga che vieta le chiavi personalizzate lo rifiuterebbe (provato più sotto).');

// ── Nomi: il percorso deve restare non indovinabile ─────────────────────────
await prova('nome indovinabile (screenshot.octetstream): NEGATO', 'ko',
  carica(fuori, 'feedback/screenshot.octetstream'));
await prova('nome col solo timestamp: NEGATO', 'ko',
  carica(fuori, `feedback/${Date.now()}.octetstream`));
await prova('sottocartella di feedback/: NEGATA', 'ko',
  carica(fuori, `feedback/sotto/${Date.now()}_${randomUUID()}.octetstream`));
await prova('fuori da feedback/: NEGATO', 'ko',
  carica(fuori, `pubblico/${Date.now()}_${randomUUID()}.octetstream`));

// ── Tipi attivi e dimensione ────────────────────────────────────────────────
await prova('text/html (documento ATTIVO nel dominio di Storage): NEGATO', 'ko',
  carica(fuori, nome(), PNG, { contentType: 'text/html' }));
await prova('image/svg+xml (può contenere script): NEGATO', 'ko',
  carica(fuori, nome(), PNG, { contentType: 'image/svg+xml' }));
await prova('allegato oltre il tetto (5 MB): NEGATO', 'ko',
  carica(fuori, nome(), new Uint8Array(5 * 1024 * 1024)));

await env.cleanup();

// ── L'espressione dei metadati, sui campi che l'emulatore non passa ─────────
// Le stesse regole, più un blocco che chiama `senzaMetadatiScelti` su una
// risorsa scritta a mano: così il motore vero valuta anche i campi che dal
// caricamento non gli arrivano. Il blocco vive solo in questa seconda copia.
const CASI = {
  'di-serie': ["{'metadata': {}, 'contentDisposition': null, 'contentEncoding': null}", 'ok'],
  'metadati-assenti': ["{'metadata': null, 'contentDisposition': null, 'contentEncoding': null}", 'ok'],
  'campi-vuoti': ["{'metadata': {}, 'contentDisposition': '', 'contentEncoding': '', 'cacheControl': '', 'contentLanguage': ''}", 'ok'],
  'cache-nulla': ["{'metadata': {}, 'contentDisposition': null, 'contentEncoding': null, 'cacheControl': null, 'contentLanguage': null}", 'ok'],
  'cache-scelta': ["{'metadata': {}, 'contentDisposition': null, 'contentEncoding': null, 'cacheControl': 'public, max-age=31536000'}", 'ko'],
  'lingua-scelta': ["{'metadata': {}, 'contentDisposition': null, 'contentEncoding': null, 'contentLanguage': 'it'}", 'ko'],
  'codice-visibile': ["{'metadata': {'firebaseStorageDownloadTokens': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}, 'contentDisposition': null, 'contentEncoding': null}", 'ko'],
};
const regole = readFileSync(REGOLE_STORAGE, 'utf8');
const coda = regole.lastIndexOf('match /{path=**}');
const blocco = `match /espressione/{caso} {\n      allow create: if ${Object.entries(CASI)
  .map(([caso, [risorsa]]) => `(caso == '${caso}' && senzaMetadatiScelti(${risorsa}, 'n.octetstream'))`)
  .join('\n        || ')};\n    }\n\n    `;
let env2 = null;
try {
  env2 = await initializeTestEnvironment({
    projectId: PROGETTO,
    storage: { host: '127.0.0.1', port: 9199, rules: regole.slice(0, coda) + blocco + regole.slice(coda) },
  });
} catch (e) {
  // Con regole che la funzione non ce l'hanno (la controprova) il blocco non compila: è un rosso, non un crollo.
  esiti.push(['ROSSO', `espressione dei metadati: regole senza senzaMetadatiScelti — ${String(e && e.message).slice(0, 160)}`]);
}
if (env2) {
  const fuori2 = env2.unauthenticatedContext();
  for (const [caso, [, attesa]] of Object.entries(CASI)) {
    await prova(`espressione dei metadati, ${caso}: ${attesa === 'ok' ? 'OK' : 'NEGATO'}`, attesa,
      carica(fuori2, `espressione/${caso}`));
  }
  await env2.cleanup();
}

let rossi = 0;
let note = 0;
for (const [stato, riga] of esiti) {
  if (stato.trim() === 'ROSSO') rossi++;
  if (stato.trim() === 'NOTA') note++;
  console.log(`${stato} ${riga}`);
}
const prove = esiti.length - note;
console.log(`\n${prove - rossi}/${prove} verdi${note ? ` — ${note} cosa/e che questo attrezzo non sa provare, scritte qui sopra` : ''}`);
process.exit(rossi ? 1 : 0);
