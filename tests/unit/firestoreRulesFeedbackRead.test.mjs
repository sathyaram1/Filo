// Sentinella sulle regole Firestore: i documenti dei feedback non si leggono
// senza credenziali, e la vista pubblica contiene SOLO campi pubblici.
//
// Il caso che l'ha fatta nascere (audit pre-alpha, #583). `feedback` aveva
// `allow read: if true`. Testo e URL erano cifrati per l'owner, ma il resto no
// — titolo, user agent, link agli screenshot, numero, data — e i documenti
// anteriori al cutover della cifratura (25 giugno 2026) erano in chiaro per
// intero, note di lavorazione comprese. Con la sola chiave web del repo, che
// sta in un repo pubblico, un estraneo ricostruiva cosa stanno provando i
// tester e su quali pagine.
//
// Perché una sentinella e non un test sulle regole vere: farle girare davvero
// vuol dire emulatore Firestore (Java, centinaia di MB, un servizio da
// avviare) per asserire poche righe. Il rischio qui non è che il motore delle
// regole sbagli: è che qualcuno riapra la porta scrivendo un'altra riga.
// Questo test legge il file che si deploya e diventa rosso in millisecondi.
//
// Senza il fix è ROSSO: la lettura di `feedback` era `if true`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

require(join(ROOT, 'src', 'shared', 'feedbackPublicView.js'));
const VIEW = globalThis.SN_FEEDBACK_PUBLIC_VIEW;

// Estrae il corpo di un blocco `match <percorso> { … }` contando le graffe:
// dentro ci sono mappe vuote (`{}`) e condizioni su più righe, quindi una
// regex che si ferma alla prima parentesi chiusa leggerebbe mezzo blocco e un
// test che vede mezzo file passa sempre.
function blocco(testo, percorso) {
  const apre = testo.indexOf(`match ${percorso} {`);
  if (apre < 0) return null;
  // La graffa del blocco, non quella del segnaposto nel percorso (`{doc}`).
  const i = testo.indexOf('{', apre + `match ${percorso}`.length);
  let livello = 0;
  for (let j = i; j < testo.length; j++) {
    if (testo[j] === '{') livello++;
    else if (testo[j] === '}') {
      livello--;
      if (livello === 0) return testo.slice(i + 1, j);
    }
  }
  return null;
}

// Le condizioni di LETTURA dichiarate in un blocco (read/get/list).
function letture(corpo) {
  const out = [];
  const re = /allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g;
  let m;
  while ((m = re.exec(corpo)) !== null) {
    const verbi = m[1].split(',').map((v) => v.trim()).filter(Boolean);
    if (!verbi.some((v) => v === 'read' || v === 'get' || v === 'list')) continue;
    out.push(m[2].replace(/\/\/[^\n]*/g, ' ').replace(/\s+/g, ' ').trim());
  }
  return out;
}

const FEEDBACK = blocco(RULES, '/feedback/{doc}');
const VISTA = blocco(RULES, '/feedback-public/{doc}');
const CONTATORI = blocco(RULES, '/counters/{name}');

test('il parser vede davvero i blocchi (un test cieco passerebbe sempre)', () => {
  assert.ok(FEEDBACK && FEEDBACK.includes('allow create'), 'blocco /feedback non letto');
  assert.ok(VISTA && VISTA.includes('allow read'), 'blocco /feedback-public non letto');
  assert.ok(CONTATORI && CONTATORI.includes('allow read'), 'blocco /counters non letto');
});

test('la lettura dei feedback NON è pubblica e passa da admin o routine', () => {
  const conds = letture(FEEDBACK);
  assert.ok(conds.length >= 1, 'nessuna regola di lettura per /feedback: il parser sta leggendo male');
  for (const c of conds) {
    assert.notEqual(c, 'true',
      'la lettura dei feedback è tornata pubblica: dentro ci sono titolo, user agent, link agli screenshot e i documenti storici in chiaro');
    assert.ok(/isAdmin\(\)/.test(c) || /isRoutine\(\)/.test(c),
      `lettura di /feedback non riconducibile a owner o server: "${c}"`);
    const soloLoggato = /^request\.auth\s*!=\s*null/.test(c) && !/isAdmin\(\)/.test(c) && !/isRoutine\(\)/.test(c);
    assert.ok(!soloLoggato,
      'iscriversi non costa niente e la chiave web sta nel repo: "sei loggato" non è una barriera');
  }
});

test('sia `get` sia `list` sono chiusi (un id noto non basta a leggere)', () => {
  // Chiudere solo la lista lascerebbe leggibile qualunque documento di cui si
  // conosca l'id, e gli id storici sono finiti in link e log.
  const re = /allow\s+([a-z,\s]+?)\s*:\s*if/g;
  const verbi = new Set();
  let m;
  while ((m = re.exec(FEEDBACK)) !== null) {
    for (const v of m[1].split(',').map((s) => s.trim())) verbi.add(v);
  }
  assert.ok(verbi.has('read') || (verbi.has('get') && verbi.has('list')),
    'servono entrambi: `get` e `list` (oppure `read`, che li comprende)');
});

test('la vista pubblica è leggibile da chiunque: è il suo mestiere', () => {
  assert.deepEqual(letture(VISTA), ['true'],
    'la bacheca e il popup delle ricompense girano su macchine senza credenziali: la vista deve essere pubblica');
});

test('la vista pubblica ammette SOLO i campi della scheda (le regole sono la rete)', () => {
  const m = VISTA.match(/hasOnly\(\s*\[([\s\S]*?)\]\s*\)/);
  assert.ok(m, 'la scrittura della vista deve enumerare i campi ammessi con hasOnly');
  const ammessi = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

  // Ciò che non deve MAI entrare in un documento pubblico, per nessun motivo.
  const VIETATI = ['text', 'url', 'title', 'userAgent', 'images', 'files', 'notes',
    'clientId', 'priority', 'pipeline', 'reviewComment', 'reviewDecision', 'reviewedAt',
    'branch', 'blockReason', 'claimedBy', 'starred'];
  for (const f of VIETATI) {
    assert.ok(!ammessi.includes(f),
      `"${f}" è finito fra i campi scrivibili sulla vista pubblica: quella collezione la legge chiunque`);
  }

  // E l'elenco delle regole deve combaciare con quello del codice che le
  // scrive: se divergono, o una scrittura legittima viene respinta, o un campo
  // nuovo passa senza che nessuno l'abbia deciso.
  const attesi = [...VIEW.CARD_FIELDS, ...VIEW.USER_FIELDS].slice().sort();
  assert.deepEqual(ammessi.slice().sort(), attesi,
    'i campi ammessi dalle regole e quelli di SN_FEEDBACK_PUBLIC_VIEW devono essere gli stessi');
});

test('la vista pubblica ammette solo stati CHIUSI', () => {
  const m = VISTA.match(/get\('status',\s*'[a-z]+'\)\s*in\s*\[([^\]]*)\]/);
  assert.ok(m, 'le regole devono vincolare `status` sulla vista');
  const stati = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  for (const s of stati) {
    assert.ok(['done', 'verified', 'archived', 'ignored'].includes(s),
      `stato "${s}" ammesso sulla vista pubblica: una scheda esiste solo per un feedback chiuso`);
  }
  for (const s of VIEW.PUBLISHABLE_STATUSES) {
    assert.ok(stati.includes(s), `il codice pubblica "${s}" ma le regole non lo ammettono`);
  }
});

test('gli allegati dei feedback non si possono ELENCARE', () => {
  // L'altra porta sulla stessa stanza: chiudere i documenti e lasciare il
  // bucket elencabile vuol dire che chiunque si porta via i nomi di tutti gli
  // allegati, e poi i file. Il singolo `get` resta aperto: i link della
  // dashboard portano già il loro token di download.
  const STORAGE = readFileSync(join(ROOT, 'storage.rules'), 'utf8');
  const corpo = blocco(STORAGE, '/feedback/{file=**}');
  assert.ok(corpo, 'blocco /feedback delle storage.rules non letto');
  assert.ok(/allow\s+list\s*:\s*if\s+false/.test(corpo),
    'gli allegati dei feedback non devono essere elencabili');
  assert.ok(!/allow\s+read\s*:\s*if\s+true/.test(corpo),
    '`read` comprende anche `list`: serve il solo `get`');
});

test('il contatore dei numeri: pubblico in lettura, e si può solo far avanzare di uno', () => {
  assert.deepEqual(letture(CONTATORI), ['true'],
    'chi invia un feedback non ha credenziali: il contatore deve potersi leggere');
  assert.ok(/request\.resource\.data\.value\s*==\s*resource\.data\.value\s*\+\s*1/.test(CONTATORI),
    'senza il vincolo "+1" chiunque potrebbe riscrivere il contatore a piacere');
  assert.ok(/allow delete: if false/.test(CONTATORI),
    'il contatore non si cancella: ricrearlo da zero rimetterebbe i numeri a 1');
});
