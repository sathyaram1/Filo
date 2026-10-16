// Le regole Firestore dei contatori giornalieri (#969), provate col MOTORE VERO e col codice vero dell'app.
//
// NON è un unit test: il nome non finisce in `.test.mjs` apposta (vedi pathsRegole.motore-vero.mjs, che spiega
// perché e come si prepara la cartella usa-e-getta con l'emulatore). La sentinella sempre accesa è
// firestoreRulesContatori.test.mjs; questo è l'altra metà: il documento che l'app spedisce davvero (il servizio
// src/main/services/contatori.js, con la sua chiamata REST) passa, uno manomesso no, e la lettura è dell'admin.
//
// Si lancia come l'altro, con in più FILO_REPO=<repo>:
//   FILO_REPO=<repo> RULES_FILE=<repo>/firestore.rules npx firebase emulators:exec \
//     --only firestore --project filo-prova-969 "node <cartella>/contatoriRegole.motore-vero.mjs"

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const REPO = process.env.FILO_REPO;
const REGOLE = process.env.RULES_FILE || join(REPO, 'firestore.rules');
const PROGETTO = 'filo-prova-969';
const BASE = `http://127.0.0.1:8089/v1/projects/${PROGETTO}/databases/(default)/documents`;

const require = createRequire(join(REPO, 'package.json'));
require(join(REPO, 'src/shared/constants.js'));
require(join(REPO, 'src/shared/modelUsage.js'));
require(join(REPO, 'src/shared/contatoriGiornalieri.js'));
const Servizio = require(join(REPO, 'src/main/services/contatori.js'));
const C = globalThis.SN_CONTATORI;

const env = await initializeTestEnvironment({
  projectId: PROGETTO,
  firestore: { host: '127.0.0.1', port: 8089, rules: readFileSync(REGOLE, 'utf8') },
});
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'admins/owner@filo.it'), { ok: true });
});

let ok = 0; let ko = 0;
async function prova(nome, fn) {
  try { await fn(); console.log(`  ok   ${nome}`); ok += 1; } catch (e) { console.log(`  FAIL ${nome}\n       ${e.message}`); ko += 1; }
}
function vero(cond, msg) { if (!cond) throw new Error(msg); }

// Un token senza firma, come quelli che l'emulatore accetta: serve alla lettura REST dell'owner.
function tokenDi(email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ora = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROGETTO}`, aud: PROGETTO, sub: email, user_id: email, email,
    email_verified: true, iat: ora, exp: ora + 3600, auth_time: ora, firebase: { sign_in_provider: 'google.com', identities: {} },
  })}.`;
}

function servizio(ore, impostazioni = { contatori: { attivi: true } }) {
  const disco = new Map();
  let t = ore;
  let n = 0;
  const s = Servizio.crea({
    contatori: C,
    storage: { getRaw: async (k, d) => (disco.has(k) ? disco.get(k) : d), setRaw: async (k, v) => { disco.set(k, JSON.parse(JSON.stringify(v))); } },
    impostazioni: async () => impostazioni,
    inIncognito: () => false,
    runNormale: (fn) => fn(),
    adesso: () => t,
    versione: () => '0.2.243',
    piattaforma: 'win32',
    casuale: () => `${'ab'.repeat(9)}${String(++n).padStart(2, '0')}`,
    rest: () => ({ FIRESTORE_BASE: BASE, API_KEY: 'chiave-di-prova' }),
    log: () => {},
  });
  return { s, disco, sposta: (ms) => { t += ms; } };
}

const IERI = new Date(2026, 9, 15, 10, 0, 0).getTime();
const GIORNO = 24 * 60 * 60 * 1000;
const A = globalThis.SN_CONST.ACTIONS;

console.log('\n— quello che l’app spedisce davvero —');
await prova('il giorno chiuso parte e il server lo accetta', async () => {
  const { s, disco, sposta } = servizio(IERI);
  const h = s.apri(A.FILO_CHAT); sposta(800); h.visto(); h.fine(true);
  const e = s.apri(A.EXPLAIN);
  e.errore(Object.assign(new Error('OpenRouter 402: Insufficient credits'), { status: 402 }), { modello: 'deepseek/deepseek-v4-pro', host: 'DeepInfra' });
  e.fine(false);
  await new Promise((r) => setTimeout(r, 20));
  sposta(GIORNO);
  const esito = await s.controlla();
  vero(esito === 'inviati', `esito ${esito}, errore ${JSON.stringify(disco.get(Servizio.CHIAVE)?.errore)}`);
});
await prova('rispedito, lo stesso giorno non si riscrive (create sì, update no) e l’app lo dà per arrivato', async () => {
  const { s, sposta } = servizio(IERI);
  s.apri(A.FILO_CHAT).fine(true);
  await new Promise((r) => setTimeout(r, 20));
  sposta(GIORNO);
  const esito = await s.controlla();
  vero(esito === 'inviati', `esito ${esito}`);
});

console.log('\n— la lettura dell’owner, con la sua richiesta REST —');
await prova('l’admin conta le copie di ieri e del mese', async () => {
  const { s } = servizio(IERI + GIORNO);
  const r = await s.installazioni({ idToken: tokenDi('owner@filo.it') });
  vero(r.ieri.giorno === '2026-10-15' && r.ieri.n === 1, `ieri: ${JSON.stringify(r.ieri)}`);
  vero(r.mese.mese === '2026-10' && r.mese.n === 1, `mese: ${JSON.stringify(r.mese)}`);
});
await prova('chi non è admin non legge', async () => {
  const { s } = servizio(IERI + GIORNO);
  let errore = '';
  try { await s.installazioni({ idToken: tokenDi('chiunque@filo.it') }); } catch (e) { errore = e.message; }
  vero(/403/.test(errore), `doveva essere rifiutato: «${errore}»`);
});

const anon = env.unauthenticatedContext().firestore();
const owner = env.authenticatedContext('owner', { email: 'owner@filo.it', email_verified: true }).firestore();
const BUONO = C.documento({
  pseudonimo: 'c'.repeat(20), giorno: '2026-10-14', app: '0.2.243', os: 'mac',
  dati: { uso: { help: { n: 2, fasce: { s2: 1 } } }, errori: {} },
});
const idBuono = C.idDocumento(BUONO);

console.log('\n— quello che NON si deve poter fare —');
const conCampo = (patch) => ({ ...BUONO, ...patch });
await prova('un campo in più (testo libero)', () => assertFails(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), conCampo({ nota: 'ciao' }))));
await prova('una funzione fuori elenco', () => assertFails(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), conCampo({ uso: { 'mario rossi': { n: 1, fasce: {} } } }))));
await prova('un errore sotto una funzione fuori elenco', () => assertFails(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), conCampo({ errori: { 'via roma 1': [] } }))));
await prova('uno pseudonimo che non è uno pseudonimo', () => assertFails(setDoc(doc(anon, `contatori-giornalieri/mario_2026-10-14`), conCampo({ pseudonimo: 'mario' }))));
await prova('un id che non è pseudonimo più giorno', () => assertFails(setDoc(doc(anon, 'contatori-giornalieri/qualsiasi'), BUONO)));
await prova('un mese che non è quello del giorno', () => assertFails(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), conCampo({ mese: '2026-09' }))));
await prova('un sistema fuori elenco', () => assertFails(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), conCampo({ os: 'Windows 11 di Mario' }))));
await prova('una versione dell’app che è testo', () => assertFails(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), conCampo({ app: 'ciao mamma' }))));
await prova('un campo mancante', () => { const { os, ...senza } = BUONO; return assertFails(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), senza)); });
await prova('un anonimo legge un giorno', () => assertFails(getDoc(doc(anon, `contatori-giornalieri/${C.idDocumento({ pseudonimo: 'ab'.repeat(9) + '01', giorno: '2026-10-15' })}`))));
await prova('un anonimo elenca la collezione', () => assertFails(getDocs(collection(anon, 'contatori-giornalieri'))));

console.log('\n— quello che si deve poter fare, e poi più —');
await prova('un anonimo crea il suo giorno', () => assertSucceeds(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), BUONO)));
await prova('ma non lo riscrive', () => assertFails(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), BUONO)));
await prova('né lo aggiorna', () => assertFails(updateDoc(doc(anon, `contatori-giornalieri/${idBuono}`), { os: 'linux' })));
await prova('né lo cancella', () => assertFails(deleteDoc(doc(anon, `contatori-giornalieri/${idBuono}`))));
await prova('l’admin lo legge', () => assertSucceeds(getDoc(doc(owner, `contatori-giornalieri/${idBuono}`))));
await prova('nemmeno l’admin lo cancella', () => assertFails(deleteDoc(doc(owner, `contatori-giornalieri/${idBuono}`))));

console.log(`\n${ok} ok, ${ko} falliti`);
await env.cleanup();
process.exit(ko ? 1 : 0);
