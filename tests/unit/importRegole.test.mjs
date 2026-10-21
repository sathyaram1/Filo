// #1088 — importare un backup vecchio non riavvolge la spesa del mese, i crediti né lo stato di questa installazione.
// La sentinella: ogni chiave di STORAGE_KEYS ha la sua regola d'importazione; una chiave nuova senza regola fa rosso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'filoMemory.js'));
const { mergeImportedData, REGOLE_IMPORT, REGOLE_ALTRE_CHIAVI, regolaImport } = require(join(ROOT, 'src', 'main', 'services', 'exportData.js'));
const C = globalThis.SN_CONST;
const FM = globalThis.SN_FILO_MEMORY;
const K = C.STORAGE_KEYS;

const REGOLE = new Set(['contenuto', 'stato', 'spesa', 'pagine', 'appunti', 'download', 'sveglie']);

test('sentinella: ogni chiave di STORAGE_KEYS dice se si importa e come', () => {
  const senza = Object.keys(K).filter((n) => !REGOLE.has(REGOLE_IMPORT[n]));
  assert.deepEqual(senza, [], `chiavi senza regola d'importazione in exportData.js: ${senza.join(', ')}`);
  const orfane = Object.keys(REGOLE_IMPORT).filter((n) => !(n in K));
  assert.deepEqual(orfane, [], 'una regola per una chiave che STORAGE_KEYS non ha più');
  for (const [k, r] of Object.entries(REGOLE_ALTRE_CHIAVI)) assert.ok(REGOLE.has(r), `${k}: regola sconosciuta`);
  assert.equal(regolaImport(K.CREDITS), 'stato');
  assert.equal(regolaImport('chiave-mai-vista'), 'contenuto', 'una chiave che la tabella non conosce si importa come prima');
});

test('la spesa del mese tiene il più alto fra qui e il backup: il tetto non torna ad avere margine', () => {
  const qui = { months: { '2026-10': { totalEur: 4.5, byAction: { chat: 4, voce: 0.5 }, byProvider: { or: 4.5 } } } };
  const backup = { months: {
    '2026-10': { totalEur: 1.2, byAction: { chat: 1, riassunto: 0.2 }, byProvider: { or: 1.2 } },
    '2026-09': { totalEur: 7, byAction: { chat: 7 }, byProvider: { or: 7 } },
  } };
  const { merged } = mergeImportedData({ [K.COSTS]: qui }, { [K.COSTS]: backup });
  assert.deepEqual(merged[K.COSTS].months['2026-10'], {
    totalEur: 4.5, byAction: { chat: 4, voce: 0.5, riassunto: 0.2 }, byProvider: { or: 4.5 },
  });
  assert.equal(merged[K.COSTS].months['2026-09'].totalEur, 7, 'un mese che qui non c\'è arriva dal backup');

  const verso = mergeImportedData({ [K.COSTS]: backup }, { [K.COSTS]: qui }).merged[K.COSTS];
  assert.equal(verso.months['2026-10'].totalEur, 4.5, 'vale anche quando il backup ha speso di più');
});

test('la conferma dice della spesa quello che la fusione fa: resta la più alta, non «quella di adesso»', () => {
  require(join(ROOT, 'src', 'shared', 'i18n.js'));
  const testo = globalThis.SN_I18N.t('security_import_confirm_text');
  assert.match(testo, /spesa[^.]*la più alta fra adesso e il backup/);
  assert.doesNotMatch(testo, /spesa[^.]*restano quelli di adesso/, 'col backup più caro la spesa del mese sale');
});

test('crediti, schede aperte, registro dei cambi, code, avvisi e bandierine restano quelli di qui', () => {
  const qui = {
    [K.CREDITS]: { saldo: 120 },
    [K.OPEN_TABS]: { tabs: ['https://oggi.example/'], activeIndex: 0 },
    [K.FILO_CAMBI]: [{ id: 'c1' }],
    [K.FILO_ONBOARDING]: { done: true },
  };
  const backup = {
    [K.CREDITS]: { saldo: 900 },
    [K.OPEN_TABS]: { tabs: ['https://ieri.example/', 'https://altro.example/'], activeIndex: 1 },
    [K.FILO_CAMBI]: [{ id: 'vecchio' }],
    [K.FILO_ONBOARDING]: { done: false },
    [K.FEEDBACK_OUTBOX]: [{ id: 'f1', payload: {} }],
    [K.FILO_NOTIFICATIONS]: [{ id: 'n1', text: 'vecchio avviso' }],
    [K.LAST_SEEN_VERSION]: '0.1.0',
    'filo.editor.notesMigrated': true,
    walletUsageQueue: [{ riga: 1 }],
    [K.FILO_MEMORY]: { PROFILO: 'Anna' },
  };
  const { merged, stats } = mergeImportedData(qui, backup);
  assert.deepEqual(merged[K.CREDITS], { saldo: 120 });
  assert.deepEqual(merged[K.OPEN_TABS], qui[K.OPEN_TABS]);
  assert.deepEqual(merged[K.FILO_CAMBI], [{ id: 'c1' }]);
  assert.deepEqual(merged[K.FILO_ONBOARDING], { done: true });
  for (const k of [K.FEEDBACK_OUTBOX, K.FILO_NOTIFICATIONS, K.LAST_SEEN_VERSION, 'filo.editor.notesMigrated', 'walletUsageQueue']) {
    assert.ok(!(k in merged), `${k} non si importa`);
  }
  assert.deepEqual(merged[K.FILO_MEMORY], { PROFILO: 'Anna' }, 'il contenuto si importa come sempre');
  assert.equal(stats.restano, 9);
  assert.equal(stats.added, 1);
});

test('dal backup esce solo ciò che è scaduto: una ricorrente punta sulla prossima volta, un timer passato non suona', () => {
  const adesso = Date.parse('2026-10-12T10:00:00');
  const backup = [
    { id: 't1', label: 'pasta', endsAt: '2026-01-01T12:10:00.000Z', paused: false },
    { id: 'a1', kind: 'alarm', label: 'domani', endsAt: '2026-01-02T07:00:00.000Z', paused: false },
    { id: 'a2', kind: 'alarm', label: 'palestra', repeat: ['mon', 'wed'], atTime: '07:30', endsAt: '2026-01-05T07:30:00.000Z', ringing: true },
    { id: 't2', label: 'scaduto e suona', endsAt: '2026-10-12T11:00:00.000Z', ringing: true },
  ];
  const qui = [{ id: 'q1', label: 'tè', endsAt: '2026-10-12T10:05:00.000Z', paused: false }];
  const { merged } = mergeImportedData({ [K.FILO_TIMERS]: qui }, { [K.FILO_TIMERS]: backup }, {
    prossimaSveglia: FM.nextAlarmOccurrence, adesso,
  });
  const lista = merged[K.FILO_TIMERS];
  assert.deepEqual(lista.map((t) => t.id), ['q1', 'a2']);
  const palestra = lista[1];
  assert.ok(Date.parse(palestra.endsAt) > adesso, 'la sveglia punta sulla prossima volta');
  assert.equal(new Date(palestra.endsAt).getDay(), 3, 'mercoledì 14: lunedì 12 alle 7:30 è già passato');
  assert.ok(!('ringing' in palestra), 'non arriva già a suonare');

  // Su un profilo vuoto, un backup di soli timer passati non crea la chiave.
  const vuoto = mergeImportedData({}, { [K.FILO_TIMERS]: backup.slice(0, 2) }, { prossimaSveglia: FM.nextAlarmOccurrence, adesso });
  assert.ok(!(K.FILO_TIMERS in vuoto.merged));
});

test('una sveglia singola di domani e un timer in corso o in pausa arrivano dal backup com\'erano', () => {
  const adesso = Date.parse('2026-10-12T10:00:00Z');
  const backup = [
    { id: 'a1', kind: 'alarm', label: 'dentista', endsAt: '2026-10-13T07:00:00.000Z', paused: false },
    { id: 't1', label: 'forno', endsAt: '2026-10-12T10:40:00.000Z', paused: false },
    { id: 't2', label: 'tè', endsAt: '2026-01-01T00:00:00.000Z', paused: true, remainingMs: 120000 },
  ];
  const { merged } = mergeImportedData({}, { [K.FILO_TIMERS]: backup }, { prossimaSveglia: () => null, adesso });
  assert.deepEqual(merged[K.FILO_TIMERS], backup);
});

test('pagine salvate: una per indirizzo, dalla più recente, e quelle oltre il tetto si contano', () => {
  const pagina = (id, url, giorno) => ({ id, url, title: id, savedAt: `2026-10-${String(giorno).padStart(2, '0')}T10:00:00.000Z` });
  const qui = [pagina('q3', 'https://c.example/', 9), pagina('q2', 'https://b.example/', 5), pagina('q1', 'https://a.example/', 1)];
  const backup = [pagina('b2', 'https://b.example/', 7), pagina('b4', 'https://d.example/', 3), pagina('b0', 'https://z.example/', 2)];
  const { merged, stats } = mergeImportedData({ [K.SAVED_PAGES]: qui }, { [K.SAVED_PAGES]: backup }, { tettoPagine: 4 });
  assert.deepEqual(merged[K.SAVED_PAGES].map((p) => p.id), ['q3', 'b2', 'b4', 'b0'],
    'la più recente per indirizzo, in ordine di data: in fondo, dove taglia il salvataggio, stanno le più vecchie');
  assert.equal(stats.pagineFuori, 1);
  assert.equal(stats.pagineMieFuori, 1, 'q1 è di qui ed esce; q2 non esce: lo stesso indirizzo resta, più recente');

  const vecchie = [pagina('v1', 'https://v1.example/', 1), pagina('v2', 'https://v2.example/', 2)];
  const soloBackup = mergeImportedData({ [K.SAVED_PAGES]: qui }, { [K.SAVED_PAGES]: vecchie }, { tettoPagine: 4 });
  assert.equal(soloBackup.stats.pagineFuori, 1);
  assert.equal(soloBackup.stats.pagineMieFuori, 0, 'esce solo una pagina del backup');

  const largo = mergeImportedData({ [K.SAVED_PAGES]: qui }, { [K.SAVED_PAGES]: backup }, { tettoPagine: 1000 });
  assert.equal(largo.stats.pagineFuori, 0);
  assert.equal(largo.merged[K.SAVED_PAGES].length, 5);
});

// #1256 — gli appunti del backup non stanno in fondo, dove la prima copia taglia: l'unione rispetta il tetto subito.
test('appunti copiati: 50 di qui più 20 del backup ne tengono 50, i più recenti, e la conferma sa quanti escono', () => {
  require(join(ROOT, 'src', 'shared', 'clipboardHistory.js'));
  const voce = (chi, i, ts) => ({ type: 'text', text: `${chi} ${i}`, ts });
  const qui = Array.from({ length: 50 }, (_, i) => voce('qui', i, 2000 - i));
  const backup = [
    ...Array.from({ length: 20 }, (_, i) => voce('backup', i, 3000 - i)),
    { type: 'text', text: '  qui   0 ', ts: 5000 }, // gemella di una voce di qui: non entra due volte
  ];
  const { merged, stats } = mergeImportedData({ [K.CLIPBOARD_HISTORY]: qui }, { [K.CLIPBOARD_HISTORY]: backup });
  const lista = merged[K.CLIPBOARD_HISTORY];
  assert.equal(lista.length, C.CLIPBOARD_HISTORY_MAX);
  assert.deepEqual(lista.slice(0, 20).map((x) => x.text), backup.slice(0, 20).map((x) => x.text), 'i più recenti in cima');
  assert.equal(lista.filter((x) => globalThis.SN_CLIPBOARD.chiave(x) === 't:qui 0').length, 1, 'nessuna gemella');
  assert.equal(stats.appuntiFuori, 20);
  assert.equal(stats.appuntiMieFuori, 20, 'escono i 20 più vecchi di qui, e la conferma lo dice');
  for (const x of lista) assert.ok(Number.isFinite(x.ts));

  // Una copia dopo l'importazione toglie solo l'ultimo: quello che la conferma ha promesso resta.
  const dopoCopia = [{ type: 'text', text: 'nuova', ts: 9000 }, ...lista].slice(0, C.CLIPBOARD_HISTORY_MAX);
  for (const x of backup.slice(0, 20)) assert.ok(dopoCopia.some((y) => y.text === x.text), `${x.text} c'è ancora`);

  const pochi = mergeImportedData({ [K.CLIPBOARD_HISTORY]: qui.slice(0, 10) }, { [K.CLIPBOARD_HISTORY]: backup });
  assert.equal(pochi.merged[K.CLIPBOARD_HISTORY].length, 30);
  assert.equal(pochi.stats.appuntiFuori, 0);
});

test('download: l\'unione tiene il tetto dell\'elenco, i più recenti, e conta quelli che restano fuori', () => {
  const dl = (id, giorno) => ({ id, filename: `${id}.pdf`, state: 'completed', startedAt: `2026-10-${String(giorno).padStart(2, '0')}T10:00:00.000Z` });
  const qui = [dl('q3', 9), dl('q1', 1)];
  const backup = [dl('b2', 5), dl('q3', 9), dl('b0', 2)];
  const { merged, stats } = mergeImportedData({ [K.DOWNLOADS]: qui }, { [K.DOWNLOADS]: backup }, { tettoDownload: 3 });
  assert.deepEqual(merged[K.DOWNLOADS].map((d) => d.id), ['q3', 'b2', 'b0']);
  assert.equal(stats.downloadFuori, 1);
  assert.equal(stats.downloadMieFuori, 1);
  const largo = mergeImportedData({ [K.DOWNLOADS]: qui }, { [K.DOWNLOADS]: backup }, { tettoDownload: 200 });
  assert.equal(largo.merged[K.DOWNLOADS].length, 4);
  assert.equal(largo.stats.downloadFuori, 0);
});

// #1256, regola del freno (#1050): un backup non alza il tetto di spesa mensile; quello più largo lo offre la conferma.
test('tetto di spesa: resta il più stretto fra qui e il backup, e quello più largo del backup si offre', () => {
  const S = K.SETTINGS;
  const caso = (qui, backup) => mergeImportedData(qui === undefined ? {} : { [S]: qui }, { [S]: backup });

  const senzaTetto = caso({ monthlyLimitEur: 5, theme: 'light' }, { monthlyLimitEur: 0, theme: 'dark' });
  assert.equal(senzaTetto.merged[S].monthlyLimitEur, 5, 'un backup senza tetto non toglie quello di qui');
  assert.equal(senzaTetto.merged[S].theme, 'dark', 'il resto delle impostazioni arriva come sempre');
  assert.deepEqual(senzaTetto.stats.tettoSpesa, { tenuto: 5, backup: 0 });

  const piuAltoNelBackup = caso({ monthlyLimitEur: 5 }, { monthlyLimitEur: 20 });
  assert.equal(piuAltoNelBackup.merged[S].monthlyLimitEur, 5);
  assert.deepEqual(piuAltoNelBackup.stats.tettoSpesa, { tenuto: 5, backup: 20 });

  const piuStrettoNelBackup = caso({ monthlyLimitEur: 20 }, { monthlyLimitEur: 3 });
  assert.equal(piuStrettoNelBackup.merged[S].monthlyLimitEur, 3);
  assert.equal(piuStrettoNelBackup.stats.tettoSpesa, null, 'niente da offrire: vale già il più stretto');
  assert.deepEqual(piuStrettoNelBackup.stats.tettoSceso, { prima: 20, dopo: 3 }, 'il tetto che scende la conferma lo dice coi numeri');

  const quiSenzaTetto = caso({ monthlyLimitEur: 0 }, { monthlyLimitEur: 8 });
  assert.equal(quiSenzaTetto.merged[S].monthlyLimitEur, 8);
  assert.deepEqual(quiSenzaTetto.stats.tettoSceso, { prima: 0, dopo: 8 });
  assert.equal(caso({ monthlyLimitEur: 5 }, { monthlyLimitEur: 5 }).stats.tettoSceso, null, 'uguale: niente da dire');
  assert.equal(senzaTetto.stats.tettoSceso, null);

  // Il computer nuovo: le impostazioni non hanno ancora il tetto, che vale quello di serie.
  const nuovo = caso(undefined, { monthlyLimitEur: 50, theme: 'dark' });
  assert.equal(nuovo.merged[S].monthlyLimitEur, C.DEFAULT_SETTINGS.monthlyLimitEur);
  assert.deepEqual(nuovo.stats.tettoSpesa, { tenuto: C.DEFAULT_SETTINGS.monthlyLimitEur, backup: 50 });
  const nuovoConImpostazioni = caso({ theme: 'light' }, { monthlyLimitEur: 0 });
  assert.equal(nuovoConImpostazioni.merged[S].monthlyLimitEur, C.DEFAULT_SETTINGS.monthlyLimitEur);

  const rovinato = caso({ monthlyLimitEur: 5 }, { monthlyLimitEur: 'tanto' });
  assert.equal(rovinato.merged[S].monthlyLimitEur, 5);
  assert.equal(rovinato.stats.tettoSpesa, null);

  const senzaVoce = caso({ monthlyLimitEur: 5 }, { theme: 'dark' });
  assert.equal(senzaVoce.merged[S].monthlyLimitEur, 5);
  assert.equal(senzaVoce.stats.tettoSpesa, null);
});
