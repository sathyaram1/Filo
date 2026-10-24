// Le regole Firestore della finestra dei contatori (#1470), provate col MOTORE VERO e col codice vero dell'app.
// NON è un unit test (vedi pathsRegole.motore-vero.mjs per il perché e la cartella usa-e-getta); la sentinella sempre
// accesa è firestoreRulesContatoriFinestra.test.mjs. Si lancia come contatoriRegole.motore-vero.mjs:
//   FILO_REPO=<repo> RULES_FILE=<repo>/firestore.rules npx firebase emulators:exec \
//     --only firestore --project filo-prova-1470 "node <cartella>/contatoriFinestraRegole.motore-vero.mjs"
// Esito atteso: 14 righe verdi, uscita 0 (2026-10-23).

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const REPO = process.env.FILO_REPO;
const REGOLE = process.env.RULES_FILE || join(REPO, 'firestore.rules');
const PROGETTO = process.env.PROGETTO || 'filo-prova-1470';
const BASE = `http://127.0.0.1:8089/v1/projects/${PROGETTO}/databases/(default)/documents`;

const require = createRequire(join(REPO, 'package.json'));
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri', 'contatoriFinestra']) {
  require(join(REPO, `src/shared/${f}.js`));
}
const Servizio = require(join(REPO, 'src/main/services/contatori.js'));
const Misure = require(join(REPO, 'src/main/services/contatoriFinestra.js'));
const C = globalThis.SN_CONTATORI;
const F = globalThis.SN_CONTATORI_FINESTRA;

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

const IERI = new Date(2026, 9, 22, 10, 0, 0).getTime();
const ORA = 60 * 60 * 1000;

console.log('\n— quello che l’app spedisce davvero —');
await prova('un’ora con ogni misura della finestra parte coi suoi tre documenti, e il server li accetta', async () => {
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
    versione: () => '0.2.249',
    piattaforma: 'linux',
    casuale: () => `${'cd'.repeat(9)}${String(++n).padStart(2, '0')}`,
    rest: () => ({ FIRESTORE_BASE: BASE, API_KEY: 'chiave-di-prova' }),
    log: () => {},
  });
  const schede = [{ id: 'a', openedAt: new Date(IERI - 3 * ORA).toISOString() }, { id: 'b', openedAt: new Date(IERI - 60000).toISOString() }];
  const m = Misure.crea({
    contatori: s, adesso: () => t, segui: false,
    finestreNormali: () => [{ _filoTabs: { tabs: schede } }],
    ambiente: () => ({ larghezza: 1536, scala: 1.25, stato: 'massimizzata', scuro: true }),
  });
  const manager = { incognito: false };
  m.sessione(manager, schede);
  m.chiusa(schede[0], 'pulsante_x');
  m.giroRiordino('reopen', { duplicati: 1, modello: 2, giudizioMancato: false });
  m.riordinatoPerColore(manager);
  m.trascinata(manager, 3);
  m.riapertaDallArchivio({ reason: 'duplicato', closedAt: new Date(IERI - 5 * 60000).toISOString() });
  m.voceMenu('tab-duplicate');
  m.anteprima('vecchia', 'clic_sulla_scheda', 1200);
  m.notifica('download_finito', 'azione_0', { letta: true, inAttesa: true });
  m.download('notifica', 'apri_file');
  m.rinominato();
  m.allUscita();
  await new Promise((r) => setTimeout(r, 30));
  t += ORA;
  const esito = await s.controlla();
  vero(esito === 'inviati', `esito ${esito}, errore ${JSON.stringify(disco.get(Servizio.CHIAVE)?.errore)}`);
  const id = `${'cd'.repeat(9)}01_2026-10-22_10`;
  const letto = await getDoc(doc(owner, `${F.COLLEZIONE}/${id}`));
  vero(letto.exists(), 'il documento della finestra non c’è');
  const d = letto.data();
  vero(d.schedeAperte === 'n2_5:n1' && d.ambienteFinestra === 'w1600:1_25:massimizzata:scuro', JSON.stringify(d));
  vero(d.chiusuraScheda['pulsante_x:h8'] === '1' && d.sessioneRipristinata['n2_5:q50'] === '1', JSON.stringify(d));
});

console.log('\n— la forma —');
const piena = (() => {
  const ora = {};
  const d = F.dati(ora);
  d.schede = 999999999; d.finestre = 999999999; d.ambiente = 'oltre:altro:schermo_intero:chiaro';
  for (const c of F.MAPPE) for (const k of F.chiaviDi(c)) d[c][k] = 999999999;
  return F.documento({ pseudonimo: 'e'.repeat(20), chiave: '2026-10-21T23', app: '9999.9999.999999', os: 'mac', dati: ora });
})();
vero(F.valida(piena).ok, F.valida(piena).motivo);
const idPiena = C.idDocumento(piena);
await prova('il documento più carico dell’app passa', () => assertSucceeds(setDoc(doc(anon, `${F.COLLEZIONE}/${idPiena}`), piena)));
await prova('ma non si riscrive', () => assertFails(setDoc(doc(anon, `${F.COLLEZIONE}/${idPiena}`), piena)));
await prova('né si aggiorna', () => assertFails(updateDoc(doc(anon, `${F.COLLEZIONE}/${idPiena}`), { os: 'win' })));
await prova('né si cancella, nemmeno dall’admin', () => assertFails(deleteDoc(doc(owner, `${F.COLLEZIONE}/${idPiena}`))));
await prova('chi non è admin non legge', () => assertFails(getDoc(doc(chiunque, `${F.COLLEZIONE}/${idPiena}`))));
await prova('l’admin legge', () => assertSucceeds(getDoc(doc(owner, `${F.COLLEZIONE}/${idPiena}`))));
const vuota = F.documento({ pseudonimo: 'f'.repeat(20), chiave: '2026-10-21T05', app: '0.2.249', os: 'win', dati: {} });
const manomessa = (campo, v, ora = '06') => {
  const d = { ...vuota, ora, [campo]: v };
  return assertFails(setDoc(doc(anon, `${F.COLLEZIONE}/${C.idDocumento(d)}`), d));
};
await prova('un’ora vuota passa', () => assertSucceeds(setDoc(doc(anon, `${F.COLLEZIONE}/${C.idDocumento(vuota)}`), vuota)));
await prova('un testo come tipo di notifica no', () => manomessa('notifica', { 'mario rossi:chiusa_x': '1' }, '07'));
await prova('un indirizzo come via di chiusura no', () => manomessa('chiusuraScheda', { 'youtube.com:m1': '1' }, '08'));
await prova('il paese scelto no', () => manomessa('voceMenuScheda', { 'tab-proxy-go:us': '1' }, '09'));
await prova('un nome di file come conto no', () => manomessa('downloadAzione', { 'pannello:apri_file': 'foto.jpg' }, '10'));
await prova('un campo in più no', () => assertFails(setDoc(doc(anon, `${F.COLLEZIONE}/${'f'.repeat(20)}_2026-10-21_11`), { ...vuota, ora: '11', titolo: 'x' })));
await prova('un id che non è il suo no', () => assertFails(setDoc(doc(anon, `${F.COLLEZIONE}/qualcosa`), { ...vuota, ora: '12' })));

console.log(`\n${ok} ok, ${ko} falliti`);
await env.cleanup();
process.exit(ko ? 1 : 0);
