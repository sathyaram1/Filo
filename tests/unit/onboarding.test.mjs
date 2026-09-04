// Unit test per src/shared/onboarding.js — la micro-intervista di benvenuto
// (#524). Logica pura: niente Electron, niente LLM, gira in millisecondi.
//
// Le asserzioni che sarebbero ROSSE senza il fix, cioè quelle che descrivono il
// difetto segnalato:
//   1. lo stato appena creato NON è "già accolto": chi apre Filo e chiude la
//      finestra senza rispondere DEVE rivedere il benvenuto (prima il segno si
//      scriveva prima ancora che l'utente rispondesse);
//   2. esiste un elenco di cose da scoprire e da dire, e finisce nel prompt
//      (prima non c'era nessun elenco: la risposta dell'utente cadeva in una
//      chat qualunque);
//   3. il segno si scrive alla FINE, e la conversazione sopravvive per la
//      ripresa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'onboarding.js'));
require(join(ROOT, 'src', 'shared', 'capabilities.js'));
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'actionLevels.js'));

const O = globalThis.SN_ONBOARDING;
const C = globalThis.SN_CONST;
const Levels = globalThis.SN_ACTION_LEVELS;

test('si registra su globalThis con la sua API', () => {
  assert.ok(O, 'SN_ONBOARDING assente');
  for (const fn of ['emptyState', 'normalize', 'tick', 'close', 'restart', 'remaining',
    'isComplete', 'appendTurn', 'userTurns', 'shouldForceClose', 'renderChecklistForPrompt']) {
    assert.equal(typeof O[fn], 'function', `manca ${fn}()`);
  }
  assert.ok(O.WELCOME_MESSAGE.length > 40, 'il primo messaggio è un testo fisso scritto a mano');
});

test("l'elenco copre le cose da scoprire E quelle da dire", () => {
  const ids = O.ITEMS.map((i) => i.id);
  for (const id of ['profilo', 'stile', 'estetica', 'privacy', 'modelli', 'crediti']) {
    assert.ok(ids.includes(id), `manca la voce "${id}"`);
  }
  assert.deepEqual(O.ITEMS.filter((i) => i.kind === 'scoprire').map((i) => i.id), ['profilo', 'stile']);
  assert.equal(new Set(ids).size, ids.length, 'id duplicati');
  for (const i of O.ITEMS) {
    assert.ok(i.label && i.detail, `voce ${i.id} senza etichetta o dettaglio`);
  }
});

test('appena aperta, l’intervista NON è "già accolto" (il difetto di #524)', () => {
  const s = O.emptyState();
  assert.equal(s.done, false);
  assert.equal(O.isActive(s), true);
  // Chi chiude la finestra dopo aver solo LETTO il benvenuto la ritrova aperta.
  const letto = O.appendTurn(s, { role: 'filo', text: O.WELCOME_MESSAGE });
  assert.equal(letto.done, false, 'il benvenuto mostrato non deve chiudere l’accoglienza');
  assert.equal(O.isActive(letto), true);
});

test('le spunte avanzano solo sugli id veri, e non si duplicano', () => {
  const a = O.tick(O.emptyState(), ['profilo', 'inventata']);
  assert.deepEqual(a.applied, ['profilo']);
  assert.deepEqual(a.state.ticked, ['profilo']);
  const b = O.tick(a.state, ['profilo', 'privacy']);
  assert.deepEqual(b.applied, ['privacy'], 'una voce già spuntata non si "riapplica"');
  assert.deepEqual(b.state.ticked, ['profilo', 'privacy']);
  assert.equal(O.isTicked(b.state, 'PRIVACY'), true, 'gli id devono essere case-insensitive');
});

test('remaining() è quello che resta da fare, isComplete() quando non resta nulla', () => {
  let s = O.emptyState();
  assert.equal(O.remaining(s).length, O.ITEMS.length);
  for (const id of O.ITEM_IDS) s = O.tick(s, [id]).state;
  assert.deepEqual(O.remaining(s), []);
  assert.equal(O.isComplete(s), true);
});

test('il segno "già accolto" si scrive alla FINE, e una volta sola', () => {
  const chiusa = O.close(O.emptyState(), '2026-09-04T10:00:00.000Z');
  assert.equal(chiusa.done, true);
  assert.equal(chiusa.closedAt, '2026-09-04T10:00:00.000Z');
  const richiusa = O.close(chiusa, '2026-09-04T11:00:00.000Z');
  assert.equal(richiusa.closedAt, '2026-09-04T10:00:00.000Z', 'la chiusura non si riscrive');
});

test('la conversazione viene tenuta da parte: è così che si riprende da dove si era', () => {
  let s = O.appendTurn(O.emptyState(), { role: 'filo', text: O.WELCOME_MESSAGE });
  s = O.appendTurn(s, { role: 'user', text: 'sono Anna, insegnante' });
  s = O.appendTurn(s, { role: 'filo', text: 'Piacere Anna. Preferisci risposte brevi?' });
  assert.equal(s.thread.length, 3);
  assert.equal(s.thread[2].role, 'filo');
  assert.equal(O.userTurns(s), 1, 'gli scambi si contano sui messaggi dell’utente');
  // Sopravvive a un giro dallo storage (serializzazione + rilettura).
  const ripresa = O.normalize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(ripresa.thread, s.thread);
  assert.equal(ripresa.done, false);
  // L'ultima cosa che l'utente vede riaprendo è la domanda in sospeso.
  assert.match(ripresa.thread[ripresa.thread.length - 1].text, /brevi/);
});

test('la conversazione salvata ha un tetto (non cresce senza fine)', () => {
  let s = O.emptyState();
  for (let i = 0; i < O.THREAD_CAP + 20; i++) s = O.appendTurn(s, { role: 'user', text: `m${i}` });
  assert.equal(s.thread.length, O.THREAD_CAP);
  assert.equal(s.thread[s.thread.length - 1].text, `m${O.THREAD_CAP + 19}`, 'si tengono gli ULTIMI');
});

test('normalize() regge qualsiasi cosa arrivi dallo storage', () => {
  for (const raw of [null, undefined, 'rotto', 42, { ticked: 'profilo' }, { thread: [1, null, {}] }]) {
    const s = O.normalize(raw);
    assert.equal(typeof s.done, 'boolean');
    assert.ok(Array.isArray(s.ticked));
    assert.ok(Array.isArray(s.thread));
  }
  const sporco = O.normalize({ ticked: ['profilo', 'profilo', 'nope'], thread: [{ role: 'x', text: 'ciao' }] });
  assert.deepEqual(sporco.ticked, ['profilo']);
  assert.deepEqual(sporco.thread, [{ role: 'user', text: 'ciao' }]);
});

test('l’intervista non può diventare infinita: elenco finito o troppi scambi → si chiude', () => {
  let completa = O.emptyState();
  for (const id of O.ITEM_IDS) completa = O.tick(completa, [id]).state;
  assert.equal(O.shouldForceClose(completa), true, 'elenco finito → si chiude');

  let lunga = O.emptyState();
  for (let i = 0; i < O.HARD_MAX_EXCHANGES; i++) lunga = O.appendTurn(lunga, { role: 'user', text: `m${i}` });
  assert.equal(O.shouldForceClose(lunga), true, 'oltre il tetto duro → si chiude');

  const corta = O.appendTurn(O.emptyState(), { role: 'user', text: 'ciao' });
  assert.equal(O.shouldForceClose(corta), false);
  assert.equal(O.shouldForceClose(O.close(completa)), false, 'una chiusa non si richiude');
});

test('restart(): si riparte da capo, elenco tutto da spuntare', () => {
  let s = O.tick(O.emptyState(), ['profilo', 'crediti']).state;
  s = O.appendTurn(s, { role: 'user', text: 'ciao' });
  s = O.close(s);
  const nuova = O.restart(s);
  assert.equal(nuova.done, false);
  assert.deepEqual(nuova.ticked, []);
  assert.deepEqual(nuova.thread, []);
  assert.ok(nuova.startedAt, 'una ripartenza ha una data');
});

// ── RILIEVO 1: l'uscita che non passa dal modello ──────────────────────────
// Il benvenuto promette «scrivi "basta così" e chiudiamo». Senza questo,
// quella promessa vale solo se il modello collabora: col provider giù (o con un
// modello piccolo che si dimentica di chiudere) l'utente resta chiuso dentro
// l'accoglienza. Rosse senza il fix: isStopRequest() non esisteva.
test('«basta così» la riconosce l’APP, non il modello', () => {
  for (const frase of [
    'basta così', 'basta cosi', 'Basta così.', 'BASTA COSÌ!', 'basta',
    'ok basta così', 'va bene basta', 'salta', 'saltiamo', 'salta l’accoglienza',
    "salta l'intervista", 'chiudiamo', 'chiudi qui', 'stop',
    'basta domande', '  basta così  ', 'niente intervista',
  ]) {
    assert.equal(O.isStopRequest(frase), true, `non riconosciuta: "${frase}"`);
  }
});

test('…ma non chiude l’intervista a chi stava rispondendo', () => {
  for (const frase of [
    'basta che tu non sia prolisso', 'mi basta poco', 'no', 'sì', 'ok',
    'lavoro in banca, mi basta il browser',
    'preferisco risposte brevi, senza tanti giri',
    'Sono Anna, faccio la maestra e uso il computer per preparare le lezioni',
    'chiudi le schede quando ho finito', 'stop motion', 'salta la coda',
    '', '   ', null, undefined,
  ]) {
    assert.equal(O.isStopRequest(frase), false, `chiusa per sbaglio da: "${frase}"`);
  }
});

// ── Rifiutare una PROPOSTA non è chiedere di uscire ────────────────────────
//
// Filo, durante l'intervista, propone: l'accesso Google, il tema scuro, un
// approfondimento sui modelli. A una proposta si risponde «no grazie», «magari
// dopo», «non ora». Trattate da parola di stop, quelle frasi chiudevano tutta
// l'accoglienza al primo rifiuto: delle sei cose da scoprire e da dire l'utente
// ne sentiva due, e le altre quattro non le sentiva più.
// Rosse senza il fix: stavano tutte nell'elenco delle parole di stop.
const RIFIUTI = [
  'no grazie', 'no, grazie', 'magari dopo', 'più tardi', 'non ora',
  'non adesso', 'lascia stare', 'lascia perdere', 'passo', 'non mi va',
  'magari un’altra volta', 'non ho voglia',
];

test('un rifiuto non è una richiesta di uscita', () => {
  for (const frase of RIFIUTI) {
    assert.equal(O.isStopRequest(frase), false, `«${frase}» non chiede di uscire: rifiuta`);
    assert.equal(O.isDecline(frase), true, `«${frase}» non riconosciuta come rifiuto`);
  }
});

test('durante l’intervista il rifiuto lo gestisce il modello, non l’app', () => {
  // La conversazione com'è quando l'utente risponde: Filo ha appena proposto.
  let s = O.appendTurn(O.emptyState(), { role: 'filo', text: O.WELCOME_MESSAGE });
  s = O.appendTurn(s, { role: 'user', text: 'sono Anna, insegnante' });
  s = O.appendTurn(s, {
    role: 'filo',
    text: 'Con l’accesso Google i crediti restano tuoi anche dopo una reinstallazione. Vuoi accedere?',
  });

  for (const frase of RIFIUTI) {
    const conRisposta = O.appendTurn(s, { role: 'user', text: frase });
    assert.equal(O.isExitRequest(conRisposta, frase), false,
      `«${frase}» risponde alla proposta di Filo: non deve chiudere l’accoglienza`);
  }
  // Le uscite vere continuano a funzionare senza passare dal modello.
  for (const frase of ['basta così', 'salta', 'stop', 'ok basta così, grazie']) {
    assert.equal(O.isExitRequest(O.appendTurn(s, { role: 'user', text: frase }), frase), true,
      `«${frase}» è una richiesta di uscita: deve chiudere anche col modello muto`);
  }
  // Se non c'è nessuna battuta di Filo a cui rispondere, «lascia stare» non può
  // che riferirsi all'accoglienza.
  assert.equal(O.isExitRequest(O.emptyState(), 'lascia stare'), true);
});

test('il congedo scritto a mano esiste: è l’unica risposta possibile senza modello', () => {
  assert.ok(O.CLOSING_MESSAGE.length > 40);
  assert.match(O.CLOSING_MESSAGE, /Preferenze/, 'deve dire come rifarla');
});

// ── RILIEVO 2: il turno interrotto non deve contare due volte ──────────────
// Tre strade allo stesso guaio — finestra chiusa mentre Filo scriveva, «Riprova»
// dopo un errore, seconda scheda aperta durante l'attesa — e in tutte e tre lo
// stesso messaggio ripassa da appendTurn. Rossa senza il fix: la conversazione
// finiva con due copie e userTurns() ne contava due dei cinque scambi.
test('lo stesso messaggio ripetuto di fila è lo STESSO turno, non uno nuovo', () => {
  let s = O.appendTurn(O.emptyState(), { role: 'filo', text: O.WELCOME_MESSAGE });
  s = O.appendTurn(s, { role: 'user', text: 'sono Anna, insegnante' });
  const dopoRipresa = O.appendTurn(s, { role: 'user', text: 'sono Anna, insegnante' });
  assert.equal(dopoRipresa.thread.length, 2, 'la risposta non deve entrare due volte');
  assert.equal(O.userTurns(dopoRipresa), 1, 'e non deve consumare due dei cinque scambi');
  // Spazi a parte, è lo stesso messaggio: anche quello è lo stesso turno.
  assert.equal(O.userTurns(O.appendTurn(s, { role: 'user', text: ' sono Anna, insegnante ' })), 1);
  // Un messaggio DIVERSO invece prosegue normalmente.
  const avanti = O.appendTurn(s, { role: 'user', text: 'e preferisco risposte brevi' });
  assert.equal(avanti.thread.length, 3);
  assert.equal(O.userTurns(avanti), 2);
  // E lo stesso testo tornato dopo la risposta di Filo è un turno vero.
  let ripetuto = O.appendTurn(s, { role: 'filo', text: 'Piacere Anna.' });
  ripetuto = O.appendTurn(ripetuto, { role: 'user', text: 'sono Anna, insegnante' });
  assert.equal(O.userTurns(ripetuto), 2, 'non è più consecutivo: è un turno nuovo');
});

test('hasPendingTurn(): riparte solo il turno che è rimasto davvero a metà', () => {
  let s = O.appendTurn(O.emptyState(), { role: 'filo', text: O.WELCOME_MESSAGE });
  assert.equal(O.hasPendingTurn(s), false, 'ha solo letto il benvenuto: niente da riprendere');
  s = O.appendTurn(s, { role: 'user', text: 'sono Anna' });
  assert.equal(O.hasPendingTurn(s), true, 'Filo non ha ancora risposto');
  s = O.appendTurn(s, { role: 'filo', text: 'Piacere.' });
  assert.equal(O.hasPendingTurn(s), false);
  assert.equal(O.hasPendingTurn(O.close(O.appendTurn(s, { role: 'user', text: 'x' }))), false,
    'un’intervista chiusa non ha turni da riprendere');
});

// ── RILIEVO 3: rifare l'intervista non cancella quella di prima ────────────
// Rossa senza il fix: restart() sostituiva la conversazione e chi la rifaceva
// perdeva la prima per sempre.
test('rifare l’intervista ARCHIVIA quella di prima, non la cancella', () => {
  let s = O.appendTurn(O.emptyState(), { role: 'filo', text: O.WELCOME_MESSAGE });
  s = O.appendTurn(s, { role: 'user', text: 'sono Anna, insegnante' });
  s = O.appendTurn(s, { role: 'filo', text: 'Piacere Anna.' });
  s = O.close(s, '2026-09-04T10:00:00.000Z');

  const nuova = O.restart(s, '2026-09-10T09:00:00.000Z');
  assert.equal(nuova.thread.length, 0, 'la nuova parte pulita');
  assert.equal(nuova.past.length, 1, 'ma la precedente resta da parte');
  assert.equal(nuova.past[0].thread.length, 3);
  assert.match(nuova.past[0].thread[1].text, /Anna/);
  assert.equal(nuova.past[0].closedAt, '2026-09-04T10:00:00.000Z');

  // Sopravvive al giro dallo storage.
  assert.deepEqual(O.normalize(JSON.parse(JSON.stringify(nuova))).past, nuova.past);

  // Rifarla ancora accumula, senza crescere all'infinito.
  let acc = nuova;
  for (let i = 0; i < O.PAST_CAP + 3; i++) {
    acc = O.appendTurn(acc, { role: 'user', text: `giro ${i}` });
    acc = O.restart(O.close(acc));
  }
  assert.equal(acc.past.length, O.PAST_CAP);
  assert.match(acc.past[acc.past.length - 1].thread[0].text, new RegExp(`giro ${O.PAST_CAP + 2}`));

  // Un rilancio su un'intervista mai cominciata non archivia una conversazione vuota.
  assert.deepEqual(O.restart(O.emptyState()).past, []);
});

test('conversations(): le interviste conservate, dalla più recente', () => {
  let s = O.appendTurn(O.emptyState(), { role: 'filo', text: 'prima' });
  s = O.appendTurn(s, { role: 'user', text: 'io sono io' });
  s = O.restart(O.close(s, '2026-09-01T10:00:00.000Z'), '2026-09-05T10:00:00.000Z');
  s = O.appendTurn(s, { role: 'filo', text: 'seconda' });

  const list = O.conversations(s);
  assert.equal(list.length, 2, 'quella in corso e quella archiviata');
  assert.equal(list[0].current, true);
  assert.equal(list[0].thread[0].text, 'seconda');
  assert.equal(list[1].current, false);
  assert.equal(list[1].thread[0].text, 'prima');
  assert.deepEqual(O.conversations(O.emptyState()), [], 'niente ancora, niente da rileggere');
});

test('il prompt della chat riceve l’elenco di cosa resta da scoprire e da dire', () => {
  const s = O.tick(O.emptyState(), ['profilo']).state;
  const checklist = O.renderChecklistForPrompt(s);
  assert.match(checklist, /\[x\] profilo/, 'quello che Filo sa già risulta spuntato');
  assert.match(checklist, /\[ \] stile/);
  assert.match(checklist, /\[ \] crediti/);

  const conOnb = C.PROMPTS.filoChat({ capacita: 'x', onboarding: checklist, onboardingTurns: 1, onboardingMax: 5 });
  assert.match(conOnb, /STAI ACCOGLIENDO QUESTO UTENTE/);
  assert.match(conOnb, /ONBOARDING: \{spunta/, 'senza l’azione non può spuntare niente');
  assert.match(conOnb, /basta così/, 'deve saper chiudere quando glielo si chiede');
  assert.match(conOnb, /Scambi usati finora: 1 su 5/);
  assert.ok(conOnb.includes(checklist), 'l’elenco deve arrivare davvero al modello');
});

test('a intervista finita il prompt torna quello di sempre (niente elenco addosso per sempre)', () => {
  const normale = C.PROMPTS.filoChat({ capacita: 'x' });
  assert.ok(!/STAI ACCOGLIENDO QUESTO UTENTE/.test(normale));
  // …e l'elenco sta nella parte VARIABILE: la parte fissa (riusata dal
  // prompt caching) non deve cambiare per colpa dell'onboarding.
  const statico = C.PROMPTS.filoChatStatic({ capacita: 'x' });
  assert.ok(!/STAI ACCOGLIENDO/.test(statico));
  assert.ok(normale.startsWith(statico));
});

test('l’azione ONBOARDING è registrata: livello 1 e una descrizione in chiaro', () => {
  assert.equal(Levels.levelFor({ type: 'ONBOARDING', spunta: ['profilo'] }), 1);
  assert.equal(Levels.levelFor({ type: 'onboarding', fine: true }), 1, 'il type è case-insensitive');
  assert.match(Levels.describe({ type: 'ONBOARDING', fine: true }), /intervista di benvenuto/i);
  assert.match(Levels.describe({ type: 'ONBOARDING', spunta: ['profilo'] }), /profilo/);
});

test('il manifesto delle capacità dichiara l’onboarding', () => {
  const CAP = globalThis.SN_CAPABILITIES;
  const voce = CAP.get('onboarding');
  assert.ok(voce, 'manifesto senza la voce onboarding: l’agente non saprebbe di saperlo fare');
  assert.match(voce.invoke, /Preferenze/, 'deve dire come rilanciarla');
});
