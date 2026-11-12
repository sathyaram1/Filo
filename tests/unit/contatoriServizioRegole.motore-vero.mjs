// Le regole Firestore del servizio dei contatori (#1472), provate col MOTORE VERO e col codice vero dell'app.
// NON è un unit test (vedi pathsRegole.motore-vero.mjs); la sentinella sempre accesa è firestoreRulesContatoriServizio.test.mjs.
// Si lancia come contatoriFinestraRegole.motore-vero.mjs, col progetto filo-prova-1472: 17 righe verdi, uscita 0 (con l'identità di #1547, 2026-10-29).

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const REPO = process.env.FILO_REPO;
const REGOLE = process.env.RULES_FILE || join(REPO, 'firestore.rules');
const PROGETTO = process.env.PROGETTO || 'filo-prova-1472';
const BASE = `http://127.0.0.1:8089/v1/projects/${PROGETTO}/databases/(default)/documents`;

const require = createRequire(join(REPO, 'package.json'));
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri', 'contatoriSicurezza', 'contatoriServizio']) {
  require(join(REPO, `src/shared/${f}.js`));
}
const Servizio = require(join(REPO, 'src/main/services/contatori.js'));
const Misure = require(join(REPO, 'src/main/services/contatoriServizio.js'));
const C = globalThis.SN_CONTATORI;
const S = globalThis.SN_CONTATORI_SERVIZIO;
const { ACTIONS } = globalThis.SN_CONST;
const IERI_ORA = '10';

const env = await initializeTestEnvironment({
  projectId: PROGETTO,
  firestore: { host: '127.0.0.1', port: 8089, rules: readFileSync(REGOLE, 'utf8') },
});
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'admins/owner@filo.it'), { ok: true }); });
// Una copia di Filo scrive con la sua identità anonima; senza identità non si crea niente (#1547).
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
await prova('un’ora con ogni misura del servizio parte col suo documento, e il server lo accetta', async () => {
  const disco = new Map();
  let t = IERI;
  let n = 0;
  const s = Servizio.crea({
    contatori: C,
    storage: { getRaw: async (k, d) => (disco.has(k) ? disco.get(k) : d), setRaw: async (k, v) => { disco.set(k, JSON.parse(JSON.stringify(v))); } },
    impostazioni: async () => ({ contatori: { attivi: true }, openWeightsOnly: true, monthlyLimitEur: 5 }),
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
  const m = Misure.crea({
    contatori: s, portafoglio: () => ({ state: { server: { balance: { credits: 42 } } } }), spesaDelMese: async () => 1.5,
    coda: () => ({ voci: 2, piuVecchiaMs: 3 * 3600e3 }),
  });
  m.violazione({ action: ACTIONS.FILO_CHAT, modello: 'anthropic/claude-x', host: 'Amazon Bedrock', motivo: 'not-producer', fonte: 'personal' });
  m.servita(ACTIONS.FILO_CHAT, { modello: 'deepseek/deepseek-v4:free', provider: 'openrouter', keySource: 'factory', ignota: true });
  m.tentativoFallito(ACTIONS.TTS, { code: 'NO_ALLOWED_HOST', reason: 'zdrmixed' }, { modello: 'openai/gpt-x-tts', provider: 'openrouter' });
  m.maiPartita(ACTIONS.EXPLAIN, { code: 'NO_OPEN_WEIGHTS_MODEL', droppedRefs: ['a', 'b'] });
  m.bloccoPesi('model');
  m.ripiego(ACTIONS.FILO_TAB_TRIAGE, 'passeggero');
  m.ripiegoChiave(402, 'non_ammesso');
  m.avviso('scattato', 'proiezione');
  m.avviso('spenta', 'spiegaAnticipata');
  m.invito('code_used');
  m.identita('identity_unreadable');
  m.accesso('browser', 'senza_scheda');
  m.f4('capability-gap', '', 'in_coda');
  m.proposta('confermata');
  m.rinuncia('cifratura');
  m.attesaAccesso('rifiutato');
  await new Promise((r) => setTimeout(r, 30));
  m.accesso('esito', 'ok');
  await new Promise((r) => setTimeout(r, 30));
  t += ORA;
  const esito = await s.controlla();
  vero(esito === 'inviati', `esito ${esito}, errore ${JSON.stringify(disco.get(Servizio.CHIAVE)?.errore)}`);
  const id = `${'cd'.repeat(9)}01_2026-10-27_${IERI_ORA}`;
  const letto = await getDoc(doc(owner, `${S.COLLEZIONE}/${id}`));
  vero(letto.exists(), 'il documento del servizio non c’è');
  const d = letto.data();
  vero(d.politica_violata['filo-chat|anthropic/claude-x|Amazon Bedrock|not_producer|personal'] === '1', JSON.stringify(d.politica_violata));
  vero(d.pesi_aperti['stato|acceso'] === '1' && d.pesi_aperti['explain|tolto'] === '2', JSON.stringify(d.pesi_aperti));
  vero(d.saldo_spesa['saldo|c50'] === '1' && d.coda_feedback['voci|n5'] === '1', JSON.stringify(d));
  vero(d.zdr['tts|rifiutata'] === '1' && d.zdr['filo-chat|partita'] === '1', JSON.stringify(d.zdr));
});

console.log('\n— la forma —');
// Il modello e l'host più lunghi che passano: pezzi di sole lettere o sole cifre, mai uno che sembri una chiave.
const lunghissimo = (i) => `${'m'.repeat(60)}/${'x'.repeat(55)}-${String(i % 1000).padStart(3, '0')}`;
const piena = (() => {
  const ora = {};
  const d = S.dati(ora);
  for (const c of S.MAPPE) if (!S.aperta(c)) for (const k of S.chiaviDi(c)) d[c][k] = 999999999;
  for (let i = 0; i < S.TETTO_VOCI + 3; i++) {
    S.registraViolazione(ora, { funzione: 'filo-chat', modello: lunghissimo(i), host: `Host ${i}`, motivo: 'excluded', fonte: 'own' });
    S.registraServitaIgnota(ora, 'tab-triage', lunghissimo(i));
    S.registraNessunHost(ora, 'tts', lunghissimo(i), 'mixed');
    S.registraF4(ora, 'complaint', S.capacita()[i], 'inviata');
  }
  for (const c of S.MAPPE) for (const k of Object.keys(d[c])) d[c][k] = 999999999;
  return S.documento({ pseudonimo: 'e'.repeat(20), chiave: '2026-10-26T23', app: '9999.9999.999999', os: 'mac', dati: ora });
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
const vuota = S.documento({ pseudonimo: 'f'.repeat(20), chiave: '2026-10-26T05', app: '0.2.300', os: 'win', dati: {} });
const manomessa = (campo, v, ora) => {
  const d = { ...vuota, ora, [campo]: v };
  return assertFails(setDoc(doc(anon, `${S.COLLEZIONE}/${C.idDocumento(d)}`), d));
};
await prova('un’ora vuota passa', () => assertSucceeds(setDoc(doc(anon, `${S.COLLEZIONE}/${C.idDocumento(vuota)}`), vuota)));
await prova('una chiave al posto della fonte no', () => manomessa('politica_violata', { 'filo-chat|a/b|DeepInfra|excluded|sk-or-v1-0123456789abcdef': '1' }, '06'));
await prova('un’email come host no', () => manomessa('politica_violata', { 'filo-chat|a/b|mario@example.com|excluded|own': '1' }, '07'));
await prova('un codice d’invito no', () => manomessa('invito', { 'ABCD-EFGH': '1' }, '08'));
await prova('il messaggio del router no', () => manomessa('nessun_host', { 'tts|a/b|No allowed providers are available': '1' }, '09'));
await prova('il saldo vero no', () => manomessa('saldo_spesa', { 'saldo|42': '1' }, '10'));
await prova('un testo come conto no', () => manomessa('identita', { identity_lost: 'molti' }, '11'));
await prova('un campo in più no', () => assertFails(setDoc(doc(anon, `${S.COLLEZIONE}/${'f'.repeat(20)}_2026-10-26_12`), { ...vuota, ora: '12', email: 'x' })));
await prova('un id che non è il suo no', () => assertFails(setDoc(doc(anon, `${S.COLLEZIONE}/qualcosa`), { ...vuota, ora: '13' })));

console.log(`\n${ok} ok, ${ko} falliti`);
await env.cleanup();
process.exit(ko ? 1 : 0);
