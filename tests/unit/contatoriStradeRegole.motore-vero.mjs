// Le regole Firestore delle strade dei contatori (#1468), provate col MOTORE VERO e col codice vero dell'app.
// NON è un unit test (vedi pathsRegole.motore-vero.mjs); la sentinella sempre accesa è firestoreRulesContatoriStrade.test.mjs.
// Si lancia come contatoriFinestraRegole.motore-vero.mjs, col progetto filo-prova-1468: 17 righe verdi, uscita 0 (2026-11-01).

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const REPO = process.env.FILO_REPO;
const REGOLE = process.env.RULES_FILE || join(REPO, 'firestore.rules');
const PROGETTO = process.env.PROGETTO || 'filo-prova-1468';
const BASE = `http://127.0.0.1:8089/v1/projects/${PROGETTO}/databases/(default)/documents`;

const require = createRequire(join(REPO, 'package.json'));
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri', 'contatoriStrade']) {
  require(join(REPO, `src/shared/${f}.js`));
}
const Servizio = require(join(REPO, 'src/main/services/contatori.js'));
const Misure = require(join(REPO, 'src/main/services/contatoriStrade.js'));
const C = globalThis.SN_CONTATORI;
const S = globalThis.SN_CONTATORI_STRADE;

const env = await initializeTestEnvironment({
  projectId: PROGETTO,
  firestore: { host: '127.0.0.1', port: 8089, rules: readFileSync(REGOLE, 'utf8') },
});
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'admins/owner@filo.it'), { ok: true }); });
const anon = env.authenticatedContext('installazione-di-prova', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const senzaIdentita = env.unauthenticatedContext().firestore();
const owner = env.authenticatedContext('owner', { email: 'owner@filo.it', email_verified: true }).firestore();
const chiunque = env.authenticatedContext('x', { email: 'chiunque@filo.it', email_verified: true }).firestore();

let ok = 0; let ko = 0;
async function prova(nome, fn) {
  try { await fn(); console.log(`  ok   ${nome}`); ok += 1; } catch (e) { console.log(`  FAIL ${nome}\n       ${e.message}`); ko += 1; }
}
function vero(cond, msg) { if (!cond) throw new Error(msg); }

// Un idToken anonimo come quello che l'app manda: l'emulatore non ne controlla la firma.
function tokenAnonimo(uid = 'installazione-di-prova') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ora = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROGETTO}`, aud: PROGETTO, sub: uid, user_id: uid,
    iat: ora, exp: ora + 3600, auth_time: ora, firebase: { sign_in_provider: 'anonymous', identities: {} },
  })}.`;
}

const IERI = new Date(2026, 9, 27, 10, 0, 0).getTime();
const ORA = 60 * 60 * 1000;

console.log('\n— quello che l’app spedisce davvero —');
await prova('un’ora con ogni misura delle strade parte col suo documento, e il server lo accetta', async () => {
  const disco = new Map();
  let t = IERI;
  let n = 0;
  const s = Servizio.crea({
    contatori: C,
    storage: { getRaw: async (k, d) => (disco.has(k) ? disco.get(k) : d), setRaw: async (k, v) => { disco.set(k, JSON.parse(JSON.stringify(v))); } },
    impostazioni: async () => ({ contatori: { attivi: true } }),
    inIncognito: () => false,
    runNormale: (fn) => fn(),
    adesso: () => t,
    versione: () => '0.2.300',
    piattaforma: 'linux',
    casuale: () => `${'cd'.repeat(9)}${String(++n).padStart(2, '0')}`,
    rest: () => ({ FIRESTORE_BASE: BASE, API_KEY: 'chiave-di-prova' }),
    idToken: async () => tokenAnonimo(),
    log: () => {},
  });
  const m = Misure.crea({ contatori: s, adesso: () => t });
  m.azione('open-help-sidebar', 'scorciatoia');
  m.azione('closeTab', 'menu_scheda');
  m.tasto({ type: 'keyDown', key: 'F5' });
  const riaperta = {};
  m.attesa(riaperta, 'ctrl_shift_t');
  m.chiusa({}, riaperta);
  m.aVuoto('translate-selection', 'avviso_sito');
  m.nativo('menu_del_sito:sempre_acceso');
  m.contesto(['media', 'livelli']);
  m.cronologia('indietro', 'barra_lista', { posizione: 2 });
  const finestra = {};
  m.pagina('filo://options/altro.html', 'collegamento_interno', { finestra });
  m.inVista(finestra, { id: 1 }, 'filo://options/altro.html');
  m.inVista(finestra, { id: 2 }, 'https://sito.example/');
  m.aiuto('menu_scheda');
  await new Promise((r) => setTimeout(r, 30));
  t += ORA;
  const esito = await s.controlla();
  vero(esito === 'inviati', `esito ${esito}, errore ${JSON.stringify(disco.get(Servizio.CHIAVE)?.errore)}`);
  const id = `${'cd'.repeat(9)}01_2026-10-27_10`;
  const letto = await getDoc(doc(owner, `${S.COLLEZIONE}/${id}`));
  vero(letto.exists(), 'il documento delle strade non c’è');
  const d = letto.data();
  vero(d.via_azione['help:scorciatoia'] === '1' && d.via_azione['closeTab:menu_scheda'] === '1', JSON.stringify(d));
  vero(d.tasto_da_browser.f5 === '1' && d.tasto_da_browser['aspettativa_mancata:ctrl_shift_t'] === '1', JSON.stringify(d));
  vero(d.contesto_box['media+livelli'] === '1' && d.navigazione_cronologia['indietro:barra_lista:p2_3'] === '1', JSON.stringify(d));
  vero(d.pagina_di_filo_aperta['options_altro:collegamento_interno'] === '1' && d.pagina_di_filo_aperta['vista:options_altro:ms500'] === '1', JSON.stringify(d));
});

console.log('\n— la forma —');
const piena = (() => {
  const ora = {};
  const d = S.dati(ora);
  for (const c of S.MAPPE) for (const k of S.chiaviDi(c)) d[c][k] = 999999999;
  return S.documento({ pseudonimo: 'e'.repeat(20), chiave: '2026-10-25T23', app: '9999.9999.999999', os: 'mac', dati: ora });
})();
vero(S.valida(piena).ok, S.valida(piena).motivo);
const idPiena = C.idDocumento(piena);
await prova('senza identità non si crea', () => assertFails(setDoc(doc(senzaIdentita, `${S.COLLEZIONE}/${idPiena}`), piena)));
await prova('il documento più carico dell’app passa', () => assertSucceeds(setDoc(doc(anon, `${S.COLLEZIONE}/${idPiena}`), piena)));
await prova('ma non si riscrive', () => assertFails(setDoc(doc(anon, `${S.COLLEZIONE}/${idPiena}`), piena)));
await prova('né si aggiorna', () => assertFails(updateDoc(doc(anon, `${S.COLLEZIONE}/${idPiena}`), { os: 'win' })));
await prova('né si cancella, nemmeno dall’admin', () => assertFails(deleteDoc(doc(owner, `${S.COLLEZIONE}/${idPiena}`))));
await prova('chi non è admin non legge', () => assertFails(getDoc(doc(chiunque, `${S.COLLEZIONE}/${idPiena}`))));
await prova('l’admin legge', () => assertSucceeds(getDoc(doc(owner, `${S.COLLEZIONE}/${idPiena}`))));
const vuota = S.documento({ pseudonimo: 'f'.repeat(20), chiave: '2026-10-25T05', app: '0.2.300', os: 'win', dati: {} });
const manomessa = (campo, v, ora) => {
  const d = { ...vuota, ora, [campo]: v };
  return assertFails(setDoc(doc(anon, `${S.COLLEZIONE}/${C.idDocumento(d)}`), d));
};
await prova('un’ora vuota passa', () => assertSucceeds(setDoc(doc(anon, `${S.COLLEZIONE}/${C.idDocumento(vuota)}`), vuota)));
await prova('un sito come strada no', () => manomessa('via_azione', { 'newTab:banca.example': '1' }, '06'));
await prova('l’incognito no', () => manomessa('via_azione', { 'incognito:barra': '1' }, '07'));
await prova('un tasto che scrive no', () => manomessa('tasto_da_browser', { a: '1' }, '08'));
await prova('il sito del menu del sito no', () => manomessa('menu_nativo_scelto', { 'menu_del_sito:banca.example': '1' }, '09'));
await prova('un indirizzo di Filo intero no', () => manomessa('pagina_di_filo_aperta', { 'filo://editor/editor.html:barra': '1' }, '10'));
await prova('un testo come conto no', () => manomessa('aiuto_aperto', { barra: 'molti' }, '11'));
await prova('un campo in più no', () => assertFails(setDoc(doc(anon, `${S.COLLEZIONE}/${'f'.repeat(20)}_2026-10-25_12`), { ...vuota, ora: '12', sito: 'x' })));
await prova('un id che non è il suo no', () => assertFails(setDoc(doc(anon, `${S.COLLEZIONE}/qualcosa`), { ...vuota, ora: '13' })));

console.log(`\n${ok} ok, ${ko} falliti`);
await env.cleanup();
process.exit(ko ? 1 : 0);
