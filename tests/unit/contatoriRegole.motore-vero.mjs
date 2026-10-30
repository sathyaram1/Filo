// Le regole Firestore dei contatori anonimi (#969, #1461, #1463, #1464, #1465, #1466, #1467, #1469, #1471), provate col MOTORE VERO e col codice vero dell'app.
//
// NON è un unit test: il nome non finisce in `.test.mjs` apposta (vedi pathsRegole.motore-vero.mjs, che spiega
// perché e come si prepara la cartella usa-e-getta con l'emulatore). La sentinella sempre accesa è
// firestoreRulesContatori.test.mjs; questo è l'altra metà: l'ora che l'app spedisce davvero (il servizio
// src/main/services/contatori.js, con la sua chiamata REST) passa con la sua chat e le sue chiamate ai modelli, e il
// giorno delle copie vecchie anche; uno manomesso no, e la lettura è dell'admin.
//
// Si lancia come l'altro, con in più FILO_REPO=<repo>:
//   FILO_REPO=<repo> RULES_FILE=<repo>/firestore.rules npx firebase emulators:exec \
//     --only firestore --project filo-prova-969 "node <cartella>/contatoriRegole.motore-vero.mjs"
// Esito atteso: 143 righe verdi, uscita 0 (#1586, 2026-10-30, coi campi facoltativi dei riquadri). È l'unica prova del tetto di mille
// espressioni che Firestore concede a una scrittura: le regole dell'ora ne valutano già circa 950, e un controllo in più
// le fa rifiutare tutte (per questo chiamate ai modelli, chat e attività hanno il loro documento), mentre la sentinella che
// legge il file non se ne accorge. Un rifiuto per il tetto qui si legge «maximum of 1000 expressions».

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
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'actionTools',
  'chatArchive', 'disposizioneIcone', 'carteHome', 'themeTokens', 'tabColor', 'contatoriGiornalieri']) {
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

// Un token senza firma, come quelli che l'emulatore accetta: serve alla lettura REST dell'owner e, anonimo, all'invio
// delle ore, che senza un'identità le regole rifiutano (#1547).
function tokenDi(email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ora = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROGETTO}`, aud: PROGETTO, sub: email, user_id: email, email,
    email_verified: true, iat: ora, exp: ora + 3600, auth_time: ora, firebase: { sign_in_provider: 'google.com', identities: {} },
  })}.`;
}
function tokenAnonimo(uid = 'installazione-di-prova') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ora = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROGETTO}`, aud: PROGETTO, sub: uid, user_id: uid,
    iat: ora, exp: ora + 3600, auth_time: ora, firebase: { sign_in_provider: 'anonymous', identities: {} },
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
    idToken: async () => tokenAnonimo(),
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
  // Il sistema (#1466): ogni misura almeno una volta.
  s.passoAvvio('adblock', 300);
  s.processoMorto('GPU', 'crashed', { incognito: false });
  s.eccezione('uncaught', new TypeError('Cannot read properties of undefined'));
  s.ipcSincrono('fp-config', 2);
  s.aggiornamento('trovato');
  s.sessione({ esito: 'ripristinata', schede: 3, t0: 0 }).vista();
  s.secondaIstanza();
  // I gesti (#1471): partono nel terzo documento della stessa ora.
  s.disposizioneIcone(globalThis.SN_DISPOSIZIONE_ICONE.DEFAULT);
  s.gesto('icona_spostata', { icona: 'qrCode', da: 'primary', a: 'bar', via: 'trascina' });
  s.gesto('barra_aperta', { motivo: 'spinta', esito: 'a_vuoto', apertaMs: 400 });
  s.gesto('trascinamento', { da: 'carta_home', a: 'chat_home', esito: 'posato' });
  s.gesto('modulo_editor', { colonne: 8, righe: 12 });
  s.gesto('ripristino', { cosa: 'token', token: 'accent' });
  s.cambioRitirato({ tipo: 'impostazioni', via: 'chat', ts: new Date(IERI - 90000).toISOString(), cambi: [{ chiave: 'theme' }] });
  // La navigazione (#1469): una voce per misura, col suo documento accanto all'ora.
  const N = C.NAV;
  for (const v of [N.navFallita(-105, true), N.navRiprova(-106, true), N.geoRilevato('http_451'), N.geoClasse({ class: 'paywall' }),
    N.geoDecisione('not_configured'), N.proxy('jp', 'residential', false), N.lista('adblock', { ok: true }, 3 * 60 * 60 * 1000, 120000),
    N.sitoBloccato('lists'), N.apriComunque('blacklist'), N.banner('mostra_banner'), N.pulizia('tetto_2500ms'),
    N.riquadro('google-maps', 'ancora_rotto'), N.scaricamento('cancelled', 3 * 1024 * 1024, 4000), N.programma('immagine_disco', 'aperto')]) {
    vero(v, 'una voce della navigazione non si costruisce');
    s.navigazione(v);
  }
  const t = s.turnoChat(A.FILO_CHAT);
  t.giro(); t.azioni(2); t.strumento('CERCA_WEB', 'eseguito'); t.strumento('inventato', 'rifiutato'); t.recupero('sollecito'); t.giro();
  t.fine('risposta');
  s.reazione('ferma_durante_testo'); s.copia('risposta');
  await s.chatChiusa('chat-1', { via: 'uscita', messaggi: 3, durataMs: 120000 });
  await s.chatClassificata('chat-1', 'conversazione');
  s.attivita('aiuto', { esito: 'fatto', passiDaSolo: 3, passiCliccati: 1, nonTrovati: 1, documenti: 0 });
  s.attivita('ricercaWeb', { da: 'chat', fornitore: 'tavily', ripiego: false, risultati: 5 });
  s.attivita('suggerimenti', { tipo: 'NAVIGA', posizione: 2, etaMs: 60000 });
  s.memoriaCorretta('quaderno', 'togli', { modulo: 'PROFILO', lezione: false, nata: '2026-10-01T10:00:00.000Z' });
  await new Promise((r) => setTimeout(r, 30));
  sposta(ORA);
  const esito = await s.controlla();
  vero(esito === 'inviati', `esito ${esito}, errore ${JSON.stringify(disco.get(Servizio.CHIAVE)?.errore)}`);
  const id = `${'ab'.repeat(9)}01_2026-10-15_10`;
  let letti = null;
  await env.withSecurityRulesDisabled(async (ctx) => { letti = (await getDoc(doc(ctx.firestore(), `${C.COLLEZIONE_GESTI}/${id}`))).data(); });
  vero(letti && letti.trascinamento && letti.trascinamento.carta_home === 'chat_home|posato|1', `gesti: ${JSON.stringify(letti)}`);
  vero(Object.keys(disco.get(Servizio.CHIAVE).ore).every((k) => !k.endsWith('T10')), 'l’ora e la sua chat sono arrivate');
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

// Una copia di Filo scrive con la sua identità anonima; senza identità non si crea niente (#1547).
const anon = env.authenticatedContext('installazione-di-prova', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const senzaIdentita = env.unauthenticatedContext().firestore();
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
const datiGesti = C.oraVuota();
C.registraGesto(datiGesti, 'carta_home', { carta: 'editor', mossa: 'togli' });
C.segnaDisposizione(datiGesti, { primary: 'si', secondary: 'no', bar: 'si' });
const GESTI = C.documentoGesti({ pseudonimo: 'c'.repeat(20), chiave: '2026-10-14T10', app: '0.2.243', os: 'mac', dati: datiGesti });
const COLL_GESTI = C.COLLEZIONE_GESTI;
const COLL_NAV = C.COLLEZIONE_NAVIGAZIONE;
for (const v of [C.NAV.navFallita(-118, false), C.NAV.scaricamento('completed', 10, 10), C.NAV.riquadro('youtube', 'regola')]) {
  C.registraNavigazione(datiBuoni, v.misura, v.chiave, v.voci);
}
const NAVIGA = C.documentoNavigazione({ pseudonimo: 'c'.repeat(20), chiave: '2026-10-14T10', app: '0.2.243', os: 'mac', dati: datiBuoni });
const rifiutaNav = (patch) => assertFails(setDoc(doc(anon, `${COLL_NAV}/${idBuono}`), { ...NAVIGA, ...patch }));
const datiChat = C.oraVuota();
C.registraTurno(datiChat, 'filo-chat', { esito: 'risposta', giri: 2 });
C.registraStrumento(datiChat, 'filo-chat', 'NAVIGA', 'eseguito');
C.registraChatChiusa(datiChat, { via: 'chat_nuova', messaggi: 2, durataMs: 90000, tipo: 'comando' });
const CHAT = C.documentoChat({ pseudonimo: 'c'.repeat(20), chiave: '2026-10-14T10', app: '0.2.243', os: 'mac', dati: datiChat });
const idChat = C.idDocumento(CHAT);
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
await prova('errori appena oltre il tetto del documento (#1547)', () => rifiuta({ errori: { help: Array.from({ length: 270 }, (_, i) => `${'m'.repeat(120)}|${'H'.repeat(48)}|fornitore|${i + 1}`).join(';') } }));
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
await prova('un trascinamento col testo trascinato al posto della destinazione', () => assertFails(setDoc(doc(anon, `${COLL_GESTI}/${idBuono}`), { ...GESTI, trascinamento: { carta_home: 'ecco la relazione di Mario|posato|1' } })));
await prova('un’origine di trascinamento fuori elenco', () => assertFails(setDoc(doc(anon, `${COLL_GESTI}/${idBuono}`), { ...GESTI, trascinamento: { 'file di mario': 'chat_home|posato|1' } })));
await prova('il valore di un token al posto del suo nome', () => assertFails(setDoc(doc(anon, `${COLL_GESTI}/${idBuono}`), { ...GESTI, ripristino: { token: '#ff0000|1' } })));
await prova('una disposizione che non è sì o no', () => assertFails(setDoc(doc(anon, `${COLL_GESTI}/${idBuono}`), { ...GESTI, disposizione_di_serie: { bar: 'quasi' } })));
await prova('i gesti senza una misura', () => { const { ripristino, ...senza } = GESTI; return assertFails(setDoc(doc(anon, `${COLL_GESTI}/${idBuono}`), senza)); });
await prova('i gesti sotto l’id di un’altra ora', () => assertFails(setDoc(doc(anon, `${COLL_GESTI}/${'c'.repeat(20)}_2026-10-14_11`), GESTI)));
await prova('un anonimo legge i gesti', () => assertFails(getDoc(doc(anon, `${COLL_GESTI}/${idBuono}`))));
await prova('una navigazione con un dominio come codice', () => rifiutaNav({ navFallite: { 'mario.rossi.it': '1,0' } }));
await prova('una navigazione con un indirizzo nel valore', () => rifiutaNav({ navFallite: { '-105': '1,0 https://mario.it/' } }));
await prova('uno scaricamento col nome del file', () => rifiutaNav({ scaricamenti: { 'relazione finale.docx': '1,0,0,0,0;1,0,0,0,0,0' } }));
await prova('un riquadro col sito al posto del servizio', () => rifiutaNav({ riquadri: { 'instagram-accesso.xyz': '1,0,0,0,0,0,0,0,0,0,0' } }));
await prova('un paese fuori elenco', () => rifiutaNav({ geoProxy: { 'it|datacenter': '1,0' } }));
await prova('una lista senza un gruppo', () => rifiutaNav({ liste: { adblock: '1,0,0,0;1,0,0,0,0,0' } }));
await prova('un conto con dentro una mappa', () => rifiutaNav({ bannerCookie: { hidden: { n: 1, nota: 'testo libero' } } }));
await prova('la navigazione con un campo dell’ora', () => rifiutaNav({ uso: {} }));
await prova('la navigazione senza una misura', () => { const { programmi, ...senza } = NAVIGA; return assertFails(setDoc(doc(anon, `${COLL_NAV}/${idBuono}`), senza)); });
await prova('la navigazione sotto l’id di un’altra ora', () => assertFails(setDoc(doc(anon, `${COLL_NAV}/${'c'.repeat(20)}_2026-10-14_11`), NAVIGA)));
await prova('un anonimo legge la navigazione', () => assertFails(getDoc(doc(anon, `${COLL_NAV}/${idBuono}`))));
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
const rifiutaChat = (patch) => assertFails(setDoc(doc(anon, `contatori-giornalieri/${idChat}`), { ...CHAT, ...patch }));
await prova('la chat con un campo dell’ora', () => rifiutaChat({ primo: 'mese' }));
await prova('l’ora con un campo della chat', () => rifiuta({ chatCopie: {} }));
await prova('la chat con l’id dell’ora', () => assertFails(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), CHAT)));
await prova('la chat senza una sua misura', () => { const { chatCopie, ...senza } = CHAT; return assertFails(setDoc(doc(anon, `contatori-giornalieri/${idChat}`), senza)); });
await prova('uno strumento col nome scritto a parole', () => rifiutaChat({ strumenti: { 'filo-chat': 'cerca mario rossi|eseguito|1' } }));
await prova('uno strumento con l’argomento al posto dell’esito', () => rifiutaChat({ strumenti: { 'filo-chat': 'NAVIGA|https://mario.it|1' } }));
await prova('un turno con un esito inventato', () => rifiutaChat({ chatTurni: { 'filo-chat': 'benissimo|g1|1' } }));
await prova('una chat chiusa col titolo al posto del tipo', () => rifiutaChat({ chatChiuse: { uscita: 'm1|min1|Ricetta della nonna|1' } }));
await prova('una chat chiusa con una via inventata', () => rifiutaChat({ chatChiuse: { 'chiusa da mario': 'm1|min1|comando|1' } }));
await prova('una reazione scritta a parole', () => rifiutaChat({ chatReazioni: { 'non mi piaceva': '1' } }));
await prova('una copia col testo copiato', () => rifiutaChat({ chatCopie: { risposta: 'il testo che ho copiato' } }));
await prova('le azioni per giro con una fascia in più', () => rifiutaChat({ azioniPerGiro: { 'filo-chat': '1,0,0,0,7' } }));
await prova('un giorno di prima con un campo dell’ora', () => assertFails(setDoc(doc(anon, `contatori-giornalieri/${C.idDocumento(GIORNO_VECCHIO)}`), { ...GIORNO_VECCHIO, azioni: {} })));
// Il sistema (#1466): niente percorsi, messaggi o chiavi dello storage, né come voce né come conto.
await prova('un processo morto col percorso del dump', () => rifiuta({ sistema: 'processoMorto.gpu.crashed|1;C:/Users/mario/crash.dmp|1' }));
await prova('un processo morto con un tipo inventato', () => rifiuta({ sistema: 'processoMorto.filo_di_mario.crashed|1' }));
await prova('un’eccezione col suo messaggio', () => rifiuta({ sistema: 'eccezioneMain.uncaught.Cannot read properties|1' }));
await prova('un esito del disco con la chiave dello storage', () => rifiuta({ sistema: 'storageEsito.settings.apiKeys|1' }));
await prova('il sistema con un indirizzo in coda', () => rifiuta({ sistema: 'memoria.totale.mb512|1;https://x.it' }));
await prova('il sistema come mappa', () => rifiuta({ sistema: { sessione: 'ripristinata' } }));
await prova('un passo dell’avvio fuori elenco', () => rifiuta({ sistema: 'avvioPasso.apri_relazione.ms500|1' }));
await prova('un aggiornamento con la versione', () => rifiuta({ sistema: 'aggiornamento.0.2.250|1' }));
await prova('un’ora v3 senza il sistema', () => { const { sistema, ...senza } = BUONO; return assertFails(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), senza)); });
await prova('un’ora v2 col sistema', () => rifiuta({ v: 2 }));
await prova('un anonimo legge un’ora', () => assertFails(getDoc(doc(anon, `contatori-giornalieri/${idBuono}`))));
await prova('un anonimo elenca la collezione', () => assertFails(getDocs(collection(anon, 'contatori-giornalieri'))));

await prova('senza identità non si crea l’ora', () => assertFails(setDoc(doc(senzaIdentita, `contatori-giornalieri/${idBuono}`), BUONO)));
await prova('senza identità non si crea la chat dell’ora', () => assertFails(setDoc(doc(senzaIdentita, `contatori-giornalieri/${idChat}`), CHAT)));
await prova('senza identità non si crea il giorno di una copia vecchia', () => assertFails(setDoc(doc(senzaIdentita, `contatori-giornalieri/${C.idDocumento(GIORNO_VECCHIO)}`), GIORNO_VECCHIO)));
await prova('senza identità non si creano le chiamate', () => assertFails(setDoc(doc(senzaIdentita, `${COLL_CHIAMATE}/${idBuono}`), CHIAMATE)));
await prova('senza identità non si creano i gesti', () => assertFails(setDoc(doc(senzaIdentita, `${COLL_GESTI}/${idBuono}`), GESTI)));
await prova('senza identità non si crea la navigazione', () => assertFails(setDoc(doc(senzaIdentita, `${COLL_NAV}/${idBuono}`), NAVIGA)));
await prova('senza identità non si creano le attività', () => assertFails(setDoc(doc(senzaIdentita, `${COLL_ATTIVITA}/${idBuono}`), ATTIVITA)));
await prova('senza identità non si legge un’ora', () => assertFails(getDoc(doc(senzaIdentita, `contatori-giornalieri/${idBuono}`))));

console.log('\n— quello che si deve poter fare, e poi più —');
await prova('un anonimo crea la sua ora', () => assertSucceeds(setDoc(doc(anon, `contatori-giornalieri/${idBuono}`), BUONO)));
await prova('un anonimo crea le chiamate della sua ora', () => assertSucceeds(setDoc(doc(anon, `${COLL_CHIAMATE}/${idBuono}`), CHIAMATE)));
await prova('ma non le riscrive', () => assertFails(setDoc(doc(anon, `${COLL_CHIAMATE}/${idBuono}`), CHIAMATE)));
await prova('un anonimo crea la navigazione della sua ora', () => assertSucceeds(setDoc(doc(anon, `${COLL_NAV}/${idBuono}`), NAVIGA)));
await prova('ma non la riscrive', () => assertFails(setDoc(doc(anon, `${COLL_NAV}/${idBuono}`), NAVIGA)));
await prova('l’admin legge la navigazione', () => assertSucceeds(getDoc(doc(owner, `${COLL_NAV}/${idBuono}`))));
await prova('la navigazione più carica che l’app costruisce (ogni chiave di ogni misura, ai tetti) passa', () => {
  const dati = C.oraVuota();
  for (const c of C.MISURE_NAVIGAZIONE) {
    const n = C.NAVIGAZIONE[c].gruppi.reduce((a, g) => a + g.length, 0);
    for (const k of C.NAVIGAZIONE[c].chiavi) dati[c][k] = Array(n).fill(999999999);
  }
  const piena = C.documentoNavigazione({ pseudonimo: 'd'.repeat(20), chiave: '2026-10-14T23', app: '9999.9999.999999', os: 'linux', dati });
  vero(C.validaNavigazione(piena).ok, C.validaNavigazione(piena).motivo);
  return assertSucceeds(setDoc(doc(anon, `${COLL_NAV}/${C.idDocumento(piena)}`), piena));
});
// I riquadri AI e l'Editor (#1465): come la navigazione, il loro documento accanto all'ora.
const COLL_RIQ = C.COLLEZIONE_RIQUADRI;
const datiRiq = C.oraVuota();
for (const [m, d] of [['ocr', { esito: 'copiato' }], ['riscrittura', { scorciatoia: 'formale', esito: 'sostituito', proposte: 2 }],
  ['traduzione_pagina', { esito: 'parziale', rimasto: 0.3, originale: true }]]) {
  const v = C.voceRiquadro(m, d);
  C.registraRiquadro(datiRiq, v.misura, v.chiave, v.voci);
}
const RIQ = C.documentoRiquadri({ pseudonimo: 'c'.repeat(20), chiave: '2026-10-14T10', app: '0.2.243', os: 'mac', dati: datiRiq });
await prova('senza identità non si creano i riquadri', () => assertFails(setDoc(doc(senzaIdentita, `${COLL_RIQ}/${idBuono}`), RIQ)));
await prova('un anonimo crea i riquadri della sua ora', () => assertSucceeds(setDoc(doc(anon, `${COLL_RIQ}/${idBuono}`), RIQ)));
await prova('ma non li riscrive', () => assertFails(setDoc(doc(anon, `${COLL_RIQ}/${idBuono}`), RIQ)));
await prova('l’admin legge i riquadri', () => assertSucceeds(getDoc(doc(owner, `${COLL_RIQ}/${idBuono}`))));
await prova('un anonimo non li legge', () => assertFails(getDoc(doc(anon, `${COLL_RIQ}/${idBuono}`))));
await prova('un’istruzione scritta come chiave della riscrittura no', () => assertFails(setDoc(doc(anon, `${COLL_RIQ}/${C.idDocumento({ ...RIQ, ora: '11' })}`),
  { ...RIQ, ora: '11', riscrittura: { 'rendilo gentile': '1,0,0,0,0,0,0,0,0,0' } })));
// #1586: le misure arrivate dopo la v1 sono campi facoltativi, con la stessa versione.
vero(C.MISURE_RIQUADRI_FACOLTATIVE.every((c) => !(c in RIQ)), 'i riquadri di prova sono quelli di una copia vecchia');
await prova('con una sola misura arrivata dopo (le correzioni automatiche) passano', () => {
  const dati = JSON.parse(JSON.stringify(datiRiq));
  C.registraRiquadro(dati, 'correttore_automatica', 'nome', ['annullata']);
  const d = C.documentoRiquadri({ pseudonimo: 'c'.repeat(20), chiave: '2026-10-14T12', app: '0.2.260', os: 'mac', dati });
  vero('correttore_automatica' in d && !('correttore_valuta' in d), 'parte solo la facoltativa che ha conti');
  return assertSucceeds(setDoc(doc(anon, `${COLL_RIQ}/${C.idDocumento(d)}`), d));
});
await prova('una misura arrivata dopo fuori forma no', () => assertFails(setDoc(doc(anon, `${COLL_RIQ}/${C.idDocumento({ ...RIQ, ora: '13' })}`),
  { ...RIQ, ora: '13', correttore_segnaposto: { da_solo: '1,0,0' } })));
await prova('una parola come chiave delle correzioni automatiche no', () => assertFails(setDoc(doc(anon, `${COLL_RIQ}/${C.idDocumento({ ...RIQ, ora: '14' })}`),
  { ...RIQ, ora: '14', correttore_automatica: { Marco: '1,0,0' } })));
await prova('i riquadri più carichi che l’app costruisce (ogni chiave di ogni misura, ai tetti) passano', () => {
  const dati = C.oraVuota();
  for (const c of C.MISURE_RIQUADRI) {
    const n = C.RIQUADRI[c].gruppi.reduce((a, g) => a + g.length, 0);
    for (const k of C.RIQUADRI[c].chiavi) dati[c][k] = Array(n).fill(999999999);
  }
  const pieni = C.documentoRiquadri({ pseudonimo: 'd'.repeat(20), chiave: '2026-10-14T23', app: '9999.9999.999999', os: 'linux', dati });
  vero(C.validaRiquadri(pieni).ok, C.validaRiquadri(pieni).motivo);
  return assertSucceeds(setDoc(doc(anon, `${COLL_RIQ}/${C.idDocumento(pieni)}`), pieni));
});
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
await prova('un anonimo crea i gesti della sua ora', () => assertSucceeds(setDoc(doc(anon, `${COLL_GESTI}/${idBuono}`), GESTI)));
await prova('ma non li riscrive', () => assertFails(setDoc(doc(anon, `${COLL_GESTI}/${idBuono}`), GESTI)));
await prova('l’admin li legge', () => assertSucceeds(getDoc(doc(owner, `${COLL_GESTI}/${idBuono}`))));
await prova('i gesti più carichi che l’app costruisce (ogni voce di ogni chiave, ai tetti) passano', () => {
  const dati = C.oraVuota();
  for (const c of C.MISURE_GESTI) {
    if (c === 'barra_aperta') {
      for (const m of C.MOTIVI_BARRA) dati[c][m] = Object.fromEntries(C.ESITI_BARRA.map((e) => [e, { n: 999999999, fasce: Object.fromEntries(C.NOMI_FASCE.map((f) => [f, 142857142])) }]));
    } else if (c === 'disposizione_di_serie') dati[c] = { primary: 'no', secondary: 'no', bar: 'no' };
    else for (const k of C.chiaviGesto(c)) dati[c][k] = Object.fromEntries(C.vociGesto(c, k).map((v) => [v, 999999999]));
  }
  const pieni = C.documentoGesti({ pseudonimo: 'd'.repeat(20), chiave: '2026-10-14T23', app: '9999.9999.999999', os: 'linux', dati });
  vero(C.validaGesti(pieni).ok, C.validaGesti(pieni).motivo);
  return assertSucceeds(setDoc(doc(anon, `${COLL_GESTI}/${C.idDocumento(pieni)}`), pieni));
});
await prova('un anonimo crea la chat della sua ora', () => assertSucceeds(setDoc(doc(anon, `contatori-giornalieri/${idChat}`), CHAT)));
await prova('la chat più carica che l’app costruisce passa', () => {
  const dati = C.oraVuota();
  for (const esito of C.ESITI_TURNO) for (const giri of [1, 2, 3, 5, 9, 12]) C.registraTurno(dati, 'filo-chat', { esito, giri });
  for (const nome of C.strumenti()) for (const esito of C.ESITI_STRUMENTO) C.registraStrumento(dati, 'filo-chat', nome, esito, 999999999);
  for (const n of [1, 2, 4, 9]) C.registraAzioniDelGiro(dati, 'filo-chat', n, 999999999);
  for (const v of C.RECUPERI) C.registraRecupero(dati, v);
  for (const v of C.REAZIONI) C.registraReazione(dati, v);
  for (const r of C.RUOLI_COPIA) C.registraCopia(dati, r);
  for (const via of C.VIE_CHIUSURA) for (const messaggi of [1, 2, 4, 8, 50]) for (const durataMs of [0, 2e5, 6e5, 2e6, 1e9]) {
    for (const tipo of C.TIPI_CHAT) C.registraChatChiusa(dati, { via, messaggi, durataMs, tipo });
  }
  const piena = C.documentoChat({ pseudonimo: 'd'.repeat(20), chiave: '2026-10-14T23', app: '0.2.243', os: 'linux', dati });
  vero(C.valida(piena).ok, C.valida(piena).motivo);
  return assertSucceeds(setDoc(doc(anon, `contatori-giornalieri/${C.idDocumento(piena)}`), piena));
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
await prova('una copia vecchia crea ancora la sua ora v2, senza il sistema', () => {
  const v2 = { ...Object.fromEntries(Object.entries(BUONO).filter(([k]) => C.CAMPI_ORA_V2.includes(k))), v: 2, pseudonimo: 'f'.repeat(20) };
  return assertSucceeds(setDoc(doc(anon, `contatori-giornalieri/${C.idDocumento(v2)}`), v2));
});
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
  for (const p of C.PASSI_AVVIO) for (const ms of [100, 900, 1500, 4000, 9000, 20000, 99999]) C.registraPassoAvvio(dati, p, ms);
  for (const t of C.TIPI_AVVIO) C.registraTipoAvvio(dati, t);
  for (const t of C.TIPI_PROCESSO) for (const m of C.MOTIVI_CRASH) C.registraProcessoMorto(dati, t, m);
  C.registraFinestraBloccata(dati, 'volte'); C.registraFinestraBloccata(dati, 'tornata', 3000); C.registraFinestraBloccata(dati, 'chiusa_da_utente', 90000);
  for (const ms of [300, 1500, 7000]) C.registraMainFermo(dati, ms);
  for (const o of C.ORIGINI_ECCEZIONE) for (const n of C.NOMI_ECCEZIONE) C.registraEccezione(dati, o, { name: n });
  C.registraMemoria(dati, { mb: 5000, vive: 60, attesa: 0 });
  for (const c of C.CANALI_SINCRONI) for (const ms of [1, 900, 99999]) C.registraIpcSincrono(dati, c, ms);
  C.registraChiusura(dati, { ms: 2600, tetto: true });
  for (const e of C.ESITI_USCITA) C.registraUscita(dati, e);
  for (const e of C.EVENTI_STORAGE) C.registraStorage(dati, e, 999999);
  C.registraSessione(dati, { esito: 'ripristinata', schede: 80, vistaMs: 500, codaMs: 40000 }); C.registraSessione(dati, { esito: 'niente' });
  for (const e of C.EVENTI_AGGIORNAMENTO) C.registraAggiornamento(dati, e);
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
