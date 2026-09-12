// #589 — che cosa può CHIEDERE al cuore di Filo la pagina di un sito.
//
// Il canale verso il main è uno solo, condiviso fra le pagine di Filo e il
// codice che Filo carica dentro ogni pagina visitata. Senza un confine unico,
// un sito che chiedeva otteneva la memoria che Filo si è costruito
// sull'utente, l'elenco delle pagine messe da parte, lo stato della home e
// perfino l'uscita dall'account.
//
// Qui si asserisce la difesa dal punto di vista dell'utente: quelle domande da
// un sito non ottengono risposta, e tutto ciò che serve al codice dentro le
// pagine continua a passare. L'ultima prova è la sentinella nell'altro verso:
// legge tutto il codice che gira dentro una pagina web e pretende che ogni
// messaggio che manda sia fra quelli ammessi, così stringere la lista non può
// spegnere una funzione in silenzio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
require(join(ROOT, 'src', 'shared', 'webMessageScope.js'));
require(join(ROOT, 'src', 'shared', 'messages.js'));

const W = globalThis.SN_WEB_MESSAGE_SCOPE;
const { MSG } = globalThis.SN_MSG;

const SITO = 'https://esempio.test/pagina';

test('da un sito non si chiedono i dati personali dell\'utente', () => {
  for (const tipo of [
    MSG.FILO_GET_MEMORY,      // quello che Filo ha imparato sull'utente
    MSG.FILO_GET_STATE,       // messaggio della home, suggerimenti, crediti, schede aperte
    MSG.GET_SAVED_PAGES,      // le pagine messe da parte
    MSG.GET_ARCHIVED_TABS,
    MSG.SEARCH_ARCHIVED_TABS,
    MSG.GET_CATEGORIES,
    MSG.DECKS_LIST,
    MSG.GET_HISTORY,
    MSG.EXPORT_DATA,
    MSG.FILO_GET_TIMERS,
    MSG.FILO_GET_NOTIFICATIONS,
  ]) {
    assert.equal(W.allowed(tipo, SITO), false, `un sito può ancora chiedere ${tipo}`);
  }
});

test('da un sito non si chiude la sessione dell\'account', () => {
  assert.equal(W.allowed(MSG.AUTH_SIGNOUT, SITO), false);
  // L'accesso invece lo propone il modulo del red team, che vive dentro le pagine.
  assert.equal(W.allowed(MSG.AUTH_SIGNIN, SITO), true);
  assert.equal(W.allowed(MSG.AUTH_STATUS, SITO), true);
});

test('quello che serve al codice dentro le pagine continua a passare', () => {
  for (const tipo of [
    MSG.GET_SETTINGS, MSG.UPDATE_SETTINGS, MSG.AI_REQUEST, MSG.WEB_SEARCH,
    MSG.GET_CLIPBOARD_HISTORY, MSG.PUSH_CLIPBOARD_ENTRY, MSG.SAVE_PAGE,
    MSG.CAPTURE_VISIBLE_TAB, MSG.SUBMIT_FEEDBACK, MSG.FILO_RUN_ACTION,
    MSG.TTS_SYNTH, MSG.OPEN_URL, MSG.NAV_BACK, MSG.TAB_ACTIVITY,
    '_storage:get', '_storage:set', '_tabs:create', 'fetch_link_meta',
  ]) {
    assert.equal(W.allowed(tipo, SITO), true, `il codice dentro le pagine non può più mandare ${tipo}`);
  }
});

test('interne sono le pagine di Filo e le chiamate che il main fa a se stesso', () => {
  for (const origine of [
    'filo://newtab/',
    'filo://shell/shell.html',
    '',            // chiamata interna del main (una scorciatoia da tastiera)
    undefined,
  ]) {
    assert.equal(W.allowed(MSG.FILO_GET_MEMORY, origine), true, `origine ${String(origine)} trattata come un sito`);
  }
});

test('un\'origine che imita filo:// resta un sito', () => {
  for (const finta of ['https://filo.example/filo://', 'http://filo/newtab', 'https://filo://x']) {
    assert.equal(W.allowed(MSG.FILO_GET_MEMORY, finta), false, `${finta} è passata per interna`);
  }
});

// Il confine è scritto al contrario di come sembrerebbe naturale, e questo è il
// motivo: cercare «comincia per http» lasciava fuori tutti gli indirizzi che una
// pagina di un sito sa darsi da sola, e lì il confine si spegneva del tutto.
test('gli indirizzi che una pagina si dà da sola non sono superfici di Filo', () => {
  for (const origine of [
    'blob:https://sito.example/6b2f-4c1a',        // pagina composta dal sito
    'blob:http://127.0.0.1:8080/1a2b',
    'about:blank',                                 // scheda vuota aperta dal sito
    'about:srcdoc',
    'data:text/html;charset=utf-8,%3Ch1%3Ex%3C/h1%3E',
    'filesystem:https://sito.example/temporary/x',
  ]) {
    assert.equal(
      W.allowed(MSG.FILO_GET_MEMORY, origine), false,
      `da "${origine}" si chiede ancora quello che Filo ha imparato sull'utente`,
    );
    assert.equal(W.allowed(MSG.AUTH_SIGNOUT, origine), false, `da "${origine}" si chiude ancora la sessione`);
  }
});

test('una pagina viva senza indirizzo non è una chiamata interna', () => {
  // Durante un caricamento l'indirizzo può mancare per un istante: quell'istante
  // non deve valere come lasciapassare.
  assert.equal(W.allowed(MSG.FILO_GET_MEMORY, '', { fromPage: true }), false);
  assert.equal(W.allowed(MSG.FILO_GET_MEMORY, '', { fromPage: false }), true);
  assert.equal(W.isInternalSurface('filo://newtab/', { fromPage: true }), true);
});

test('è una lista di ciò che passa: il messaggio aggiunto domani resta fuori da solo', () => {
  assert.equal(W.allowed('sincronizza_tutto_il_disco', SITO), false);
  assert.equal(W.isWebMessage('sincronizza_tutto_il_disco'), false);
});

// ── Il magazzino dei dati, scomparto per scomparto ─────────────────────────
// Chiedere tutto in un colpo era già vietato. Chiederli per nome, uno alla
// volta, no: ne usciva la stessa roba, e dalla stessa porta si riscriveva.
test('gli scomparti dei dati personali non si aprono da una pagina web', () => {
  for (const chiave of [
    'filo_memory',      // quello che Filo ha imparato sull'utente
    'savedPages',       // le pagine messe da parte, con indirizzi e titoli
    'aiHistory',        // le richieste ai modelli
    'downloads',        // percorso su disco, e quindi il nome utente del computer
    'archivedTabs', 'costs', 'credits', 'filo_notes', 'filo_timers',
    'filo_proxy_rules', 'filo_onboarding', 'clipboardHistory', 'filo_raw_log',
    'filo_session', 'categories', 'decks',
  ]) {
    assert.equal(W.isWebStorageKey(chiave), false, `una pagina web può ancora aprire "${chiave}"`);
  }
});

test('quello che il codice dentro le pagine tiene nel magazzino continua a passare', () => {
  for (const chiave of [
    'settings',                   // ridotto ai campi ammessi, non intero
    'sn_personal_dict', 'sn_autocorrect',
    'sn_icon_layout', 'sn_feedback_draft_text', 'sn_feedback_client_id',
  ]) {
    assert.equal(W.isWebStorageKey(chiave), true, `il codice dentro le pagine non può più aprire "${chiave}"`);
  }
});

test('anche gli scomparti sono una lista di ciò che passa', () => {
  assert.equal(W.isWebStorageKey('scomparto_nuovo_di_domani'), false);
});

// ── Sentinella: la lista ammette tutto ciò che le pagine mandano davvero ────
// Ogni file che finisce dentro una pagina web: i content script, i moduli
// condivisi che page-preload.js carica insieme a loro e il preload stesso (lo
// shim chrome.* parla sullo stesso canale). L'elenco dei condivisi si ricava
// da page-preload.js, non si scrive a mano.
function fileCheGiranoNellePagine() {
  const dirContent = join(ROOT, 'src', 'content');
  const elenco = readdirSync(dirContent)
    .filter((n) => n.endsWith('.js'))
    .map((n) => ({ etichetta: `src/content/${n}`, percorso: join(dirContent, n) }));
  const percorsoPreload = join(ROOT, 'src', 'preload', 'page-preload.js');
  const preload = readFileSync(percorsoPreload, 'utf8');
  const condivisi = new Set();
  for (const m of preload.matchAll(/SHARED_DIR\s*,\s*'([^']+\.js)'/g)) condivisi.add(m[1]);
  assert.ok(condivisi.size > 0, 'nessun modulo condiviso trovato in page-preload.js: è cambiato come li carica?');
  for (const n of condivisi) {
    elenco.push({ etichetta: `src/shared/${n}`, percorso: join(ROOT, 'src', 'shared', n) });
  }
  elenco.push({ etichetta: 'src/preload/page-preload.js', percorso: percorsoPreload });
  return elenco;
}

test('ogni messaggio mandato da dentro una pagina web è ammesso', () => {
  const noti = new Set(Object.values(MSG));
  const usati = new Map(); // tipo → file dove si vede
  for (const { etichetta, percorso } of fileCheGiranoNellePagine()) {
    const src = readFileSync(percorso, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    for (const m of src.matchAll(/\btype:\s*MSG\.([A-Z_0-9]+)/g)) {
      const tipo = MSG[m[1]];
      assert.ok(tipo, `${etichetta} manda MSG.${m[1]}, che non esiste in src/shared/messages.js`);
      if (!usati.has(tipo)) usati.set(tipo, etichetta);
    }
    // Tipi scritti come stringa: contano solo quelli che sono davvero messaggi
    // (nel registro, o i canali interni dello shim che iniziano con `_`).
    for (const m of src.matchAll(/\btype:\s*'([^']+)'/g)) {
      const tipo = m[1];
      if (!noti.has(tipo) && !tipo.startsWith('_') && tipo !== 'fetch_link_meta') continue;
      if (!usati.has(tipo)) usati.set(tipo, etichetta);
    }
  }
  assert.ok(usati.size > 10, 'la sentinella non ha letto nulla: percorso sbagliato?');
  for (const [tipo, file] of usati) {
    assert.ok(
      W.isWebMessage(tipo),
      `${file} manda "${tipo}" dalla pagina di un sito, ma il messaggio non è fra quelli ammessi `
      + '(aggiungilo a WEB_MESSAGE_TYPES in src/shared/webMessageScope.js, oppure smetti di mandarlo da lì)',
    );
  }
});

// ── Sentinella gemella: gli scomparti che le pagine aprono davvero ─────────
// Stessa idea, sull'altra lista: se domani un pezzo di Filo dentro le pagine
// tiene una cosa sua in uno scomparto nuovo, questa diventa rossa invece di
// lasciare che quella funzione si spenga in silenzio sui siti.
require(join(ROOT, 'src', 'shared', 'constants.js'));
const { STORAGE_KEYS } = globalThis.SN_CONST;

// Il testo fra le parentesi della chiamata che comincia a `apertura`.
function dentroLeParentesi(src, apertura) {
  let profondita = 0;
  for (let i = apertura; i < src.length; i += 1) {
    if (src[i] === '(') profondita += 1;
    else if (src[i] === ')') {
      profondita -= 1;
      if (profondita === 0) return src.slice(apertura + 1, i);
    }
  }
  return '';
}

// Solo il PRIMO argomento: il secondo è la funzione che riceve la risposta, e
// dentro ci sta di tutto (stringhe che non sono nomi di scomparti).
function primoArgomento(testo) {
  let profondita = 0;
  for (let i = 0; i < testo.length; i += 1) {
    const c = testo[i];
    if ('([{'.includes(c)) profondita += 1;
    else if (')]}'.includes(c)) profondita -= 1;
    else if (c === ',' && profondita === 0) return testo.slice(0, i);
  }
  return testo;
}

function scompartiApertiDa(src) {
  const costanti = new Map();
  for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*'([^']*)'/g)) costanti.set(m[1], m[2]);
  const chiavi = new Set();
  const re = /chrome\.storage\.local\.(?:get|set|remove)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const arg = primoArgomento(dentroLeParentesi(src, re.lastIndex - 1));
    for (const q of arg.matchAll(/'([^']+)'/g)) chiavi.add(q[1]);
    for (const q of arg.matchAll(/STORAGE_KEYS\.([A-Z_0-9]+)/g)) {
      const valore = STORAGE_KEYS[q[1]];
      assert.ok(valore, `STORAGE_KEYS.${q[1]} non esiste in src/shared/constants.js`);
      chiavi.add(valore);
    }
    for (const q of arg.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      if (costanti.has(q[1])) chiavi.add(costanti.get(q[1]));
    }
  }
  return chiavi;
}

test('ogni scomparto aperto da dentro una pagina web è ammesso', () => {
  const usati = new Map(); // chiave → file dove si vede
  for (const { etichetta, percorso } of fileCheGiranoNellePagine()) {
    const src = readFileSync(percorso, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    for (const chiave of scompartiApertiDa(src)) {
      if (!usati.has(chiave)) usati.set(chiave, etichetta);
    }
  }
  assert.ok(usati.size >= 4, 'la sentinella non ha letto nulla: è cambiato il modo di aprire il magazzino?');
  for (const [chiave, file] of usati) {
    assert.ok(
      W.isWebStorageKey(chiave),
      `${file} apre "${chiave}" dalla pagina di un sito, ma quello scomparto non è fra quelli ammessi `
      + '(aggiungilo a WEB_STORAGE_KEYS in src/shared/webMessageScope.js, oppure smetti di aprirlo da lì)',
    );
  }
});
