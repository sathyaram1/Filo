// Le regole Firestore della sicurezza dei contatori (#1474), provate col MOTORE VERO e col codice vero dell'app.
// NON è un unit test (vedi pathsRegole.motore-vero.mjs); la sentinella sempre accesa è firestoreRulesContatoriSicurezza.test.mjs.
// Si lancia come contatoriFinestraRegole.motore-vero.mjs, col progetto filo-prova-1474: 16 righe verdi, uscita 0.

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const REPO = process.env.FILO_REPO;
const REGOLE = process.env.RULES_FILE || join(REPO, 'firestore.rules');
const PROGETTO = process.env.PROGETTO || 'filo-prova-1474';
const BASE = `http://127.0.0.1:8089/v1/projects/${PROGETTO}/databases/(default)/documents`;

const require = createRequire(join(REPO, 'package.json'));
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri', 'contatoriSicurezza']) {
  require(join(REPO, `src/shared/${f}.js`));
}
const Servizio = require(join(REPO, 'src/main/services/contatori.js'));
const Misure = require(join(REPO, 'src/main/services/contatoriSicurezza.js'));
const C = globalThis.SN_CONTATORI;
const S = globalThis.SN_CONTATORI_SICUREZZA;
const { ACTIONS } = globalThis.SN_CONST;

const env = await initializeTestEnvironment({
  projectId: PROGETTO,
  firestore: { host: '127.0.0.1', port: 8089, rules: readFileSync(REGOLE, 'utf8') },
});
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'admins/owner@filo.it'), { ok: true }); });
const anon = env.unauthenticatedContext().firestore();
const owner = env.authenticatedContext('owner', { email: 'owner@filo.it', email_verified: true }).firestore();
const chiunque = env.authenticatedContext('x', { email: 'chiunque@filo.it', email_verified: true }).firestore();

let ok = 0; let ko = 0;
async function prova(nome, fn) {
  try { await fn(); console.log(`  ok   ${nome}`); ok += 1; } catch (e) { console.log(`  FAIL ${nome}\n       ${e.message}`); ko += 1; }
}
function vero(cond, msg) { if (!cond) throw new Error(msg); }

const IERI = new Date(2026, 9, 27, 10, 0, 0).getTime();
const ORA = 60 * 60 * 1000;

console.log('\n— quello che l’app spedisce davvero —');
await prova('un’ora con ogni misura della sicurezza parte col suo documento, e il server lo accetta', async () => {
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
    log: () => {},
  });
  const m = Misure.crea({ contatori: s });
  m.verdetto({}, { level: 'pericoloso', reasons: ['gsb_phishing', 'sensitive_input'] });
  m.controllo('gsb', 'ok', 320);
  m.controllo('llm', 'non_configurato');
  m.controllo('cert', 'ok');
  m.cambiato(true);
  m.scelta('segnala_falso_allarme', 'pericoloso', 'dopo');
  m.paginaDelicata('banche', 'riassunto_schede');
  m.filtroGuasto('schermo');
  m.segretiTolti(ACTIONS.FILO_CHAT, ['chiave']);
  m.uscitaFermata({ blocca: true, regola: 'custodito', tipo: 'portafoglio' }, { type: 'NAVIGA' });
  m.tetto('geo_budget');
  await new Promise((r) => setTimeout(r, 30));
  t += ORA;
  const esito = await s.controlla();
  vero(esito === 'inviati', `esito ${esito}, errore ${JSON.stringify(disco.get(Servizio.CHIAVE)?.errore)}`);
  const id = `${'cd'.repeat(9)}01_2026-10-27_10`;
  const letto = await getDoc(doc(owner, `${S.COLLEZIONE}/${id}`));
  vero(letto.exists(), 'il documento della sicurezza non c’è');
  const d = letto.data();
  vero(d.sito_verdetto['pericoloso:gsb_phishing'] === '1' && d.uscita_fermata['custodito:portafoglio:NAVIGA'] === '1', JSON.stringify(d));
  vero(d.segreto_oscurato['chiave:filo-chat'] === '1' && d.tetto_toccato.geo_budget === '1', JSON.stringify(d));
});

console.log('\n— la forma —');
const piena = (() => {
  const ora = {};
  const d = S.dati(ora);
  for (const c of S.MAPPE) for (const k of S.chiaviDi(c)) d[c][k] = 999999999;
  return S.documento({ pseudonimo: 'e'.repeat(20), chiave: '2026-10-26T23', app: '9999.9999.999999', os: 'mac', dati: ora });
})();
vero(S.valida(piena).ok, S.valida(piena).motivo);
const idPiena = C.idDocumento(piena);
await prova('il documento più carico dell’app passa', () => assertSucceeds(setDoc(doc(anon, `${S.COLLEZIONE}/${idPiena}`), piena)));
await prova('ma non si riscrive', () => assertFails(setDoc(doc(anon, `${S.COLLEZIONE}/${idPiena}`), piena)));
await prova('né si aggiorna', () => assertFails(updateDoc(doc(anon, `${S.COLLEZIONE}/${idPiena}`), { os: 'win' })));
await prova('né si cancella, nemmeno dall’admin', () => assertFails(deleteDoc(doc(owner, `${S.COLLEZIONE}/${idPiena}`))));
await prova('chi non è admin non legge', () => assertFails(getDoc(doc(chiunque, `${S.COLLEZIONE}/${idPiena}`))));
await prova('l’admin legge', () => assertSucceeds(getDoc(doc(owner, `${S.COLLEZIONE}/${idPiena}`))));
const vuota = S.documento({ pseudonimo: 'f'.repeat(20), chiave: '2026-10-26T05', app: '0.2.300', os: 'win', dati: {} });
const manomessa = (campo, v, ora) => {
  const d = { ...vuota, ora, [campo]: v };
  return assertFails(setDoc(doc(anon, `${S.COLLEZIONE}/${C.idDocumento(d)}`), d));
};
await prova('un’ora vuota passa', () => assertSucceeds(setDoc(doc(anon, `${S.COLLEZIONE}/${C.idDocumento(vuota)}`), vuota)));
await prova('un dominio come motivo no', () => manomessa('sito_verdetto', { 'pericoloso:banca-falsa.example': '1' }, '06'));
await prova('una durata in millisecondi no', () => manomessa('sito_approfondito', { 'gsb:ok:1234': '1' }, '07'));
await prova('una categoria remota col suo nome no', () => manomessa('pagina_delicata', { 'assicurazioni:riquadri': '1' }, '08'));
await prova('una chiave al posto della funzione no', () => manomessa('segreto_oscurato', { 'chiave:Chiave_Di_Prova_Con_Maiuscole': '1' }, '09'));
await prova('un codice letto come verbo no', () => manomessa('uscita_fermata', { 'codice:482913': '1' }, '10'));
await prova('un testo come conto no', () => manomessa('tetto_toccato', { geo_budget: 'molti' }, '11'));
await prova('un campo in più no', () => assertFails(setDoc(doc(anon, `${S.COLLEZIONE}/${'f'.repeat(20)}_2026-10-26_12`), { ...vuota, ora: '12', sito: 'x' })));
await prova('un id che non è il suo no', () => assertFails(setDoc(doc(anon, `${S.COLLEZIONE}/qualcosa`), { ...vuota, ora: '13' })));

console.log(`\n${ok} ok, ${ko} falliti`);
await env.cleanup();
process.exit(ko ? 1 : 0);
