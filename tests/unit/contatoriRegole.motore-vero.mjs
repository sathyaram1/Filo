// Le regole Firestore dei contatori anonimi (#969, #1461, #1464), provate col MOTORE VERO e col codice vero dell'app.
//
// NON è un unit test: il nome non finisce in `.test.mjs` apposta (vedi pathsRegole.motore-vero.mjs, che spiega
// perché e come si prepara la cartella usa-e-getta con l'emulatore). La sentinella sempre accesa è
// firestoreRulesContatori.test.mjs; questo è l'altra metà: l'ora che l'app spedisce davvero (il servizio
// src/main/services/contatori.js, con la sua chiamata REST) passa insieme alle sue chiamate ai modelli, e il giorno
// delle copie vecchie anche; uno manomesso no, e la lettura è dell'admin.
//
// Si lancia come l'altro, con in più FILO_REPO=<repo>:
//   FILO_REPO=<repo> RULES_FILE=<repo>/firestore.rules npx firebase emulators:exec \
//     --only firestore --project filo-prova-969 "node <cartella>/contatoriRegole.motore-vero.mjs"
// Esito atteso: 60 righe verdi, uscita 0 (#1464, 2026-10-23). Le regole dell'ora valutano già circa 950 delle mille
// espressioni che Firestore concede a una scrittura: un controllo in più lì le fa rifiutare tutte, per questo le
// chiamate ai modelli hanno il loro documento. Un rifiuto per il tetto qui si legge «maximum of 1000 expressions».

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
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri']) {
  require(join(REPO, `src/shared/${f}.js`));
}
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
const ORA = 60 * 60 * 1000;
const A = globalThis.SN_CONST.ACTIONS;

console.log('\n— quello che l’app spedisce davvero —');
await prova('l’ora chiusa parte, con ogni misura, e il server la accetta', async () => {
  const { s, disco, sposta } = servizio(IERI);
  const h = s.apri(A.FILO_CHAT); sposta(800); h.visto();
  h.chiamata({ modello: 'deepseek/deepseek-v4-pro', ingresso: 30000, cacheLetti: 20000, cacheDetta: true, ragionamento: 900, uscita: 400,
    fine: 'tool_calls', tentativo: 2, ricominciata: true, ragionamentoTolto: true, spesa: { usd: 0.012, origine: 'router' } });
  h.fine(true);
  h.tardiva('deepseek/deepseek-v4-pro', 0.001);
  s.adattamento(A.FILO_CHAT, 'deepseek/deepseek-v4-pro', 'contesto_stretto');
  const e = s.apri(A.EXPLAIN);
  e.errore(Object.assign(new Error('OpenRouter 402: Insufficient credits'), { status: 402 }), { modello: 'deepseek/deepseek-v4-pro', host: 'DeepInfra' });
  e.fine(false);
  s.azione('new-tab').fine();
  s.impostazioniCambiate({ theme: 'light' }, { theme: 'dark' }, { via: 'mano' });
  s.ricerca('cerca-filo', { esito: 'scelta', attesaMs: 900, posizione: 2 });
  s.proposta('ortografia', 'deepseek/deepseek-v4-flash', 'accettata');
  s.confermaDecisa('NAVIGA', { livello: 'default', stato: 'pulito', costo: 1, perimetro: 'dentro', origine: 'chat', risposta: 'si' }, 'automatica');
  s.annullatoInPagina('correzione');
  s.anticipoPronto(A.EXPLAIN);
  s.chiesto(A.EXPLAIN);
  s.erroreVisto('crash:scheda:oom');
  s.intervista('autonomia', 'default');
  s.attivita('aiuto', { esito: 'fatto', passiDaSolo: 3, passiCliccati: 1, nonTrovati: 1, documenti: 0 });
  s.attivita('ricercaWeb', { da: 'chat', fornitore: 'tavily', ripiego: false, risultati: 5 });
  s.attivita('suggerimenti', { tipo: 'NAVIGA', posizione: 2, etaMs: 60000 });
  s.memoriaCorretta('quaderno', 'togli', { modulo: 'PROFILO', lezione: false, nata: '2026-10-01T10:00:00.000Z' });
  await new Promise((r) => setTimeout(r, 30));
  sposta(ORA);
  const esito = await s.controlla();
  vero(esito === 'inviati', `esito ${esito}, errore ${JSON.stringify(disco.get(Servizio.CHIAVE)?.errore)}`);
});
await prova('rispedita, la stessa ora non si riscrive (create sì, update no) e l’app la dà per arrivata', async () => {
  const { s, sposta } = servizio(IERI);
  s.apri(A.FILO_CHAT).fine(true);
  await new Promise((r) => setTimeout(r, 20));
  sposta(ORA);
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
const datiBuoni = C.oraVuota();
C.registraUso(datiBuoni, 'help', { visto: 1500, fine: 3000 });
C.registraAzione(datiBuoni, 'reload', { visto: 100, fine: 900 });
const BUONO = C.documento({ pseudonimo: 'c'.repeat(20), chiave: '2026-10-14T10', app: '0.2.243', os: 'mac', dati: datiBuoni });
const idBuono = C.idDocumento(BUONO);
C.registraChiamata(datiBuoni, 'help', { modello: 'deepseek/deepseek-v4-flash', ingresso: 5000, cacheDetta: false, ragionamento: null, uscita: 300, fine: 'stop', tentativo: 1, spesa: { usd: 0.0004, origine: 'router' } });
C.registraChiamate(datiBuoni, 'help', 2);
const CHIAMATE = C.documentoChiamate({ pseudonimo: 'c'.repeat(20), chiave: '2026-10-14T10', app: '0.2.243', os: 'mac', dati: datiBuoni });
const COLL_CHIAMATE = C.COLLEZIONE_CHIAMATE;
C.registraAttivita(datiBuoni, 'dettatura', { motivo: 'finito', frasi: 2, invio: 'da_sola' });
C.registraAttivita(datiBuoni, 'riaperte', { chiusaDa: 'pulizia', etaMs: 120000 });
const ATTIVITA = C.documentoAttivita({ pseudonimo: 'c'.repeat(20), chiave: '2026-10-14T10', app: '0.2.243', os: 'mac', dati: datiBuoni });
const COLL_ATTIVITA = C.COLLEZIONE_ATTIVITA;
const conAttivita = (patch) => assertFails(setDoc(doc(anon, `${COLL_ATTIVITA}/${idBuono}`), { ...ATTIVITA, ...patch }));
const GIORNO_VECCHIO = C.documentoGiorno({ pseudonimo: 'e'.repeat(20), giorno: '2026-10-13', app: '0.2.240', os: 'win', dati: { uso: { help: { n: 2, fasce: { s2: 1 } } }, errori: {} } });

console.log('\n— quello che NON si deve poter fare —');
const conCampo = (patch) => ({ ...BUONO, ...patch });
const rifiuta = (patch) => assertFails(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), conCampo(patch)));
await prova('un campo in più (testo libero)', () => rifiuta({ nota: 'ciao' }));
await prova('una funzione fuori elenco', () => rifiuta({ uso: { 'mario rossi': '1;0,0,0,0,0,0,0;0,0,0,0,0,0,0;0' } }));
await prova('un uso nella forma dei giorni di prima', () => rifiuta({ uso: { help: '1;0,0,0,0,0,0,0' } }));
await prova('un uso che è una mappa con testo dentro', () => rifiuta({ uso: { help: { n: 1, fasce: {}, nota: 'testo libero' } } }));
await prova('un uso che è una lista con dentro la stringa giusta', () => rifiuta({ uso: { help: ['1;0,0,0,0,0,0,0;0,0,0,0,0,0,0;0'] } }));
await prova('un uso che è un numero', () => rifiuta({ uso: { help: 1 } }));
await prova('un uso con testo in coda', () => rifiuta({ uso: { help: '1;0,0,0,0,0,0,0;0,0,0,0,0,0,0;0 testo libero' } }));
await prova('un errore col testo libero al posto del modello', () => rifiuta({ errori: { help: 'Scrivi a mario.rossi@gmail.com|H|rete|1' } }));
await prova('errori oltre il tetto di lunghezza', () => rifiuta({ errori: { help: Array.from({ length: 2500 }, (_, i) => `${'m'.repeat(120)}|${'H'.repeat(48)}|fornitore|${i + 1}`).join(';') } }));
await prova('un’azione con uno spazio (un testo) come chiave', () => rifiuta({ azioni: { 'cerca mario rossi': '1;0,0,0,0,0,0,0;0,0,0,0,0,0,0;0' } }));
await prova('un’impostazione col valore scritto da chi usa Filo', () => rifiuta({ impostazioni: { theme: 'il mio tema preferito|mano|1' } }));
await prova('un’impostazione con un indirizzo come chiave', () => rifiuta({ impostazioni: { 'https://mario.it': 'cambiato|mano|1' } }));
await prova('un pannello fuori elenco', () => rifiuta({ ricerche: { 'la barra di mario': '1;0,0,0,0,0,0,0;0,0,0,0,0,0;0' } }));
await prova('un tipo del correttore fuori elenco (una parola)', () => rifiuta({ correttore: { perchè: 'altro|1,0,0,0' } }));
await prova('una conferma con un esito inventato', () => rifiuta({ conferme: { NAVIGA: 'default|pulito|1|dentro|chat|si|forse|1' } }));
await prova('un annullo con una parola accanto al numero', () => rifiuta({ annullati: { NAVIGA: '1 volta' } }));
await prova('un anticipo sotto una funzione fuori elenco', () => rifiuta({ anticipi: { 'via roma 1': '1;0' } }));
await prova('un errore visto col testo dell’avviso', () => rifiuta({ erroriVisti: { 'impossibile salvare relazione.pdf': '1' } }));
await prova('una scelta dell’intervista scritta a parole', () => rifiuta({ intervista: { profilo: 'faccio il medico|1' } }));
await prova('una chiamata col testo libero al posto del modello', () => assertFails(setDoc(doc(anon, `${COLL_CHIAMATE}/${idBuono}`), { ...CHIAMATE, contesto: { help: 'scrivi a mario.rossi@gmail.com|t2k|1' } })));
await prova('un’uscita con una fine inventata', () => assertFails(setDoc(doc(anon, `${COLL_CHIAMATE}/${idBuono}`), { ...CHIAMATE, uscita: { help: 'a/b|o1k|bene|1' } })));
await prova('una spesa con la virgola', () => assertFails(setDoc(doc(anon, `${COLL_CHIAMATE}/${idBuono}`), { ...CHIAMATE, spesa: { help: 'a/b|router|1.5' } })));
await prova('le chiamate di un uso come numero', () => assertFails(setDoc(doc(anon, `${COLL_CHIAMATE}/${idBuono}`), { ...CHIAMATE, chiamate: { help: 3 } })));
await prova('una misura delle chiamate sotto una funzione fuori elenco', () => assertFails(setDoc(doc(anon, `${COLL_CHIAMATE}/${idBuono}`), { ...CHIAMATE, cache: { 'appunti di mario': 'a/b|q25|1' } })));
await prova('le chiamate con un campo dell’ora', () => assertFails(setDoc(doc(anon, `${COLL_CHIAMATE}/${idBuono}`), { ...CHIAMATE, uso: {} })));
await prova('le chiamate senza una misura', () => { const { spesa, ...senza } = CHIAMATE; return assertFails(setDoc(doc(anon, `${COLL_CHIAMATE}/${idBuono}`), senza)); });
await prova('le chiamate sotto l’id di un’altra ora', () => assertFails(setDoc(doc(anon, `${COLL_CHIAMATE}/${'c'.repeat(20)}_2026-10-14_11`), CHIAMATE)));
await prova('le chiamate nella collezione delle ore', () => assertFails(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), CHIAMATE)));
await prova('un anonimo legge le chiamate', () => assertFails(getDoc(doc(anon, `${COLL_CHIAMATE}/${idBuono}`))));
await prova('un’attività con un testo come combinazione', () => conAttivita({ aiuto: { 'cerca il volo per Roma': '1' } }));
await prova('un’attività con un indirizzo dentro la combinazione', () => conAttivita({ suggerimenti: { 'NAVIGA|1|ora|https://mario.it': '1' } }));
await prova('un’attività col conto scritto a parole', () => conAttivita({ dettatura: { 'finito|f1|da_sola|no': '1 volta' } }));
await prova('un’attività col conto come mappa', () => conAttivita({ home: { generata: { n: 1, nota: 'ciao' } } }));
await prova('le attività con un campo dell’ora', () => conAttivita({ uso: {} }));
await prova('le attività senza una misura', () => { const { lettura, ...senza } = ATTIVITA; return assertFails(setDoc(doc(anon, `${COLL_ATTIVITA}/${idBuono}`), senza)); });
await prova('le attività sotto l’id di un’altra ora', () => assertFails(setDoc(doc(anon, `${COLL_ATTIVITA}/${'c'.repeat(20)}_2026-10-14_11`), ATTIVITA)));
await prova('le attività nella collezione delle chiamate', () => assertFails(setDoc(doc(anon, `${COLL_CHIAMATE}/${idBuono}`), ATTIVITA)));
await prova('un anonimo legge le attività', () => assertFails(getDoc(doc(anon, `${COLL_ATTIVITA}/${idBuono}`))));
await prova('una prima volta che è un testo', () => rifiuta({ primeVolte: ['help', 'appunti di mario'] }));
await prova('le prime volte come stringa', () => rifiuta({ primeVolte: 'help' }));
await prova('un’ora che non esiste', () => assertFails(setDoc(doc(anon, `contatori-giornalieri/${'c'.repeat(20)}_2026-10-14_24`), conCampo({ ora: '24' }))));
await prova('uno pseudonimo che non è uno pseudonimo', () => assertFails(setDoc(doc(anon, 'contatori-giornalieri/mario_2026-10-14_10'), conCampo({ pseudonimo: 'mario' }))));
await prova('un id che non è pseudonimo, giorno e ora', () => assertFails(setDoc(doc(anon, 'contatori-giornalieri/qualsiasi'), BUONO)));
await prova('un’ora col suo id da giorno', () => assertFails(setDoc(doc(anon, `contatori-giornalieri/${'c'.repeat(20)}_2026-10-14`), BUONO)));
await prova('un mese che non è quello del giorno', () => rifiuta({ mese: '2026-09' }));
await prova('un sistema fuori elenco', () => rifiuta({ os: 'Windows 11 di Mario' }));
await prova('un segno di primo documento fuori elenco', () => rifiuta({ primo: 'mario' }));
await prova('senza il segno di primo documento', () => { const { primo, ...senza } = BUONO; return assertFails(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), senza)); });
await prova('una versione dell’app che è testo', () => rifiuta({ app: 'ciao mamma' }));
await prova('un campo mancante', () => { const { intervista, ...senza } = BUONO; return assertFails(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), senza)); });
await prova('un giorno di prima con un campo dell’ora', () => assertFails(setDoc(doc(anon, `contatori-giornalieri/${C.idDocumento(GIORNO_VECCHIO)}`), { ...GIORNO_VECCHIO, azioni: {} })));
await prova('un anonimo legge un’ora', () => assertFails(getDoc(doc(anon, `contatori-giornalieri/${idBuono}`))));
await prova('un anonimo elenca la collezione', () => assertFails(getDocs(collection(anon, 'contatori-giornalieri'))));

console.log('\n— quello che si deve poter fare, e poi più —');
await prova('un anonimo crea la sua ora', () => assertSucceeds(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), BUONO)));
await prova('un anonimo crea le chiamate della sua ora', () => assertSucceeds(setDoc(doc(anon, `${COLL_CHIAMATE}/${idBuono}`), CHIAMATE)));
await prova('ma non le riscrive', () => assertFails(setDoc(doc(anon, `${COLL_CHIAMATE}/${idBuono}`), CHIAMATE)));
await prova('l’admin le legge', () => assertSucceeds(getDoc(doc(owner, `${COLL_CHIAMATE}/${idBuono}`))));
await prova('le chiamate più cariche che l’app costruisce (ogni misura di ogni funzione, ai tetti) passano', () => {
  const dati = C.oraVuota();
  // Modelli lunghi oltre il tetto dell'ora, e ogni resto di ogni funzione sulla riga «altro».
  const lunghissimo = (i) => `${'m'.repeat(60)}/${'x'.repeat(56)}${String(i % 1000).padStart(3, '0')}`;
  let k = 0;
  for (const f of C.funzioni()) {
    for (const c of C.MISURE_MODELLI) {
      dati[c][f] = {};
      for (const r of C.RESTI[c]) { dati[c][f][`${lunghissimo(k++)}|${r}`] = 999999999; dati[c][f][`altro|${r}`] = 999999999; }
    }
    for (const n of [1, 2, 4, 9, 40]) for (let i = 0; i < 3; i++) C.registraChiamate(dati, f, n);
  }
  const piene = C.documentoChiamate({ pseudonimo: 'd'.repeat(20), chiave: '2026-10-14T23', app: '9999.9999.999999', os: 'linux', dati });
  vero(C.validaChiamate(piene).ok, C.validaChiamate(piene).motivo);
  return assertSucceeds(setDoc(doc(anon, `${COLL_CHIAMATE}/${C.idDocumento(piene)}`), piene));
});
await prova('un anonimo crea le attività della sua ora', () => assertSucceeds(setDoc(doc(anon, `${COLL_ATTIVITA}/${idBuono}`), ATTIVITA)));
await prova('ma non le riscrive', () => assertFails(setDoc(doc(anon, `${COLL_ATTIVITA}/${idBuono}`), ATTIVITA)));
await prova('l’admin legge le attività', () => assertSucceeds(getDoc(doc(owner, `${COLL_ATTIVITA}/${idBuono}`))));
await prova('le attività più cariche che l’app costruisce (ogni combinazione di ogni misura, ai tetti) passano', () => {
  const dati = C.oraVuota();
  const combinazioni = (forma) => forma
    .reduce((acc, d) => acc.flatMap((p) => (d === C.TIPO_SUGGERIMENTO ? C.tipiSuggerimento() : d).map((x) => [...p, x])), [[]])
    .map((p) => p.join('|'));
  for (const m of C.MISURE_ATTIVITA) {
    const tutte = C.DIMENSIONI_ATTIVITA[m].flatMap(combinazioni).sort((a, b) => b.length - a.length);
    dati[m] = Object.fromEntries([...tutte.map((k) => [k, 999999999]), ['altro', 999999999]]);
  }
  const piene = C.documentoAttivita({ pseudonimo: 'd'.repeat(20), chiave: '2026-10-14T23', app: '9999.9999.999999', os: 'linux', dati });
  vero(C.validaAttivita(piene).ok, C.validaAttivita(piene).motivo);
  return assertSucceeds(setDoc(doc(anon, `${COLL_ATTIVITA}/${C.idDocumento(piene)}`), piene));
});
await prova('una copia vecchia crea ancora il suo giorno', () => assertSucceeds(setDoc(doc(anon, `contatori-giornalieri/${C.idDocumento(GIORNO_VECCHIO)}`), GIORNO_VECCHIO)));
await prova('l’ora più carica che l’app costruisce (ogni funzione, azione, impostazione e scelta, ai tetti) passa', () => {
  const dati = C.oraVuota();
  const modello = (i) => `${'m'.repeat(60)}/${'x'.repeat(50)}${i}`;
  for (const f of C.funzioni()) {
    for (const ms of [100, 900, 1500, 4000, 9000, 20000, 99999]) C.registraUso(dati, f, { visto: ms, fine: ms, ripetuta: true });
    for (let i = 0; i < 40; i++) C.registraErrore(dati, f, { modello: modello(i), host: 'H'.repeat(48), tipo: C.ERRORI[i % 6] });
    C.registraAnticipo(dati, f, 'preparato'); C.registraChiesto(dati, f); C.registraPrimaVolta(dati, f);
  }
  for (const a of C.azioni()) { C.registraAzione(dati, a, { visto: 10, fine: 99999 }); C.registraPrimaVolta(dati, a); }
  for (const k of C.chiaviImpostazioni()) for (const via of C.VIE) C.registraImpostazione(dati, k, true, via);
  for (const p of C.PANNELLI) C.registraRicerca(dati, p, { esito: 'scelta', attesaMs: 100, posizione: 4 });
  for (const t of C.TIPI_PROPOSTA) for (let i = 0; i < 60; i++) C.registraProposta(dati, t, modello(i), 'mostrata');
  for (const t of C.tipiAzione()) {
    for (const risposta of C.RISPOSTE) for (const esito of C.ESITI_CONFERMA) C.registraConferma(dati, t, { livello: 'yolo', stato: 'contaminato', costo: 3, perimetro: 'fuori', origine: 'automazione', risposta, esito });
    C.registraAnnullato(dati, t);
  }
  for (const d of C.DOVE_CRASH) for (const m of C.MOTIVI_CRASH) C.registraErroreVisto(dati, `crash:${d}:${m}`);
  for (const t of C.TIPI_ERRORE_VISTO) C.registraErroreVisto(dati, `chat:${t}`);
  for (const p of C.passiIntervista()) for (const sc of C.SCELTE_INTERVISTA) C.registraIntervista(dati, p, sc);
  const pieno = C.documento({ pseudonimo: 'd'.repeat(20), chiave: '2026-10-14T23', app: '0.2.243', os: 'linux', dati });
  vero(C.valida(pieno).ok, C.valida(pieno).motivo);
  return assertSucceeds(setDoc(doc(anon, `contatori-giornalieri/${C.idDocumento(pieno)}`), pieno));
});
await prova('ma non la riscrive', () => assertFails(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), BUONO)));
await prova('né la aggiorna', () => assertFails(updateDoc(doc(anon, `contatori-giornalieri/${idBuono}`), { os: 'linux' })));
await prova('né la cancella', () => assertFails(deleteDoc(doc(anon, `contatori-giornalieri/${idBuono}`))));
await prova('l’admin la legge', () => assertSucceeds(getDoc(doc(owner, `contatori-giornalieri/${idBuono}`))));
await prova('nemmeno l’admin la cancella', () => assertFails(deleteDoc(doc(owner, `contatori-giornalieri/${idBuono}`))));

console.log(`\n${ok} ok, ${ko} falliti`);
await env.cleanup();
process.exit(ko ? 1 : 0);
