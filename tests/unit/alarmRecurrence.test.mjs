// Unit test della parte pura di "sveglie ricorrenti" e di "quale sveglia intendi".
//
// Due pezzi, entrambi senza Electron e senza storage:
//   1. la ricorrenza: interpretare i giorni chiesti ("lun mer", "feriali",
//      "ogni giorno") e calcolare la PROSSIMA occorrenza — stesso giorno prima
//      o dopo l'orario, cavallo della settimana, scorciatoie;
//   2. la risoluzione del riferimento dell'utente ("la sveglia della palestra",
//      "quella delle 7", "tutte le sveglie") sulla lista vera.
//
// Senza le nuove funzioni questi test non compilano nemmeno: normalizeRepeat,
// nextRecurrence e resolveTimerRefs non esistevano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

require(join(root, 'src', 'shared', 'constants.js'));
require(join(root, 'src', 'shared', 'filoMemory.js'));

const M = globalThis.SN_FILO_MEMORY;

// "now" fisso: mercoledì 2026-09-02, ore 12:00 locali.
const NOW = new Date(2026, 8, 2, 12, 0, 0, 0);
assert.equal(NOW.getDay(), 3, 'la base del test deve essere un mercoledì');
const nowMs = NOW.getTime();

// Timestamp locale di un giorno/ora, come Date lo intende (niente aritmetica a
// millisecondi: attraversare l'ora legale sposterebbe i conti di un'ora).
function at(dayOffset, h, m = 0) {
  const d = new Date(nowMs);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

// ─── Interpretazione dei giorni ────────────────────────────────────────────

test('giorni scritti in tutti i modi in cui un utente (o un modello) li scrive', () => {
  assert.deepEqual(M.normalizeRepeat(['lun', 'mer']), ['lun', 'mer']);
  assert.deepEqual(M.normalizeRepeat(['lunedì', 'mercoledì']), ['lun', 'mer']);
  assert.deepEqual(M.normalizeRepeat('lun, mer'), ['lun', 'mer']);
  assert.deepEqual(M.normalizeRepeat('lunedì e mercoledì'), ['lun', 'mer']);
  assert.deepEqual(M.normalizeRepeat(['MER', 'LUN']), ['lun', 'mer'], 'sempre ordinati da lunedì');
  assert.deepEqual(M.normalizeRepeat(['lun', 'lun', 'lunedi']), ['lun'], 'niente doppioni');
});

test('scorciatoie: feriali, weekend, ogni giorno', () => {
  assert.deepEqual(M.normalizeRepeat('feriali'), ['lun', 'mar', 'mer', 'gio', 'ven']);
  assert.deepEqual(M.normalizeRepeat('giorni lavorativi'), ['lun', 'mar', 'mer', 'gio', 'ven']);
  assert.deepEqual(M.normalizeRepeat('weekend'), ['sab', 'dom']);
  assert.deepEqual(M.normalizeRepeat('fine settimana'), ['sab', 'dom']);
  assert.deepEqual(M.normalizeRepeat('ogni giorno'), ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']);
  assert.deepEqual(M.normalizeRepeat('tutti i giorni'), ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']);
  assert.deepEqual(M.normalizeRepeat('feriali e sabato'), ['lun', 'mar', 'mer', 'gio', 'ven', 'sab']);
});

test('niente ricorrenza = array vuoto (sveglia a colpo singolo, come sempre)', () => {
  assert.deepEqual(M.normalizeRepeat(undefined), []);
  assert.deepEqual(M.normalizeRepeat(''), []);
  assert.deepEqual(M.normalizeRepeat([]), []);
  assert.deepEqual(M.normalizeRepeat('boh'), []);
  assert.deepEqual(M.normalizeRepeat('una volta sola'), []);
});

test('dicitura leggibile: la scorciatoia torna scorciatoia', () => {
  assert.equal(M.formatRepeat(['lun', 'mer']), 'lun+mer');
  assert.equal(M.formatRepeat('feriali'), 'feriali');
  assert.equal(M.formatRepeat(['sab', 'dom']), 'weekend');
  assert.equal(M.formatRepeat('ogni giorno'), 'ogni giorno');
  assert.equal(M.formatRepeat([]), '');
});

// ─── Prossima occorrenza ───────────────────────────────────────────────────

test('stesso giorno, orario ancora da venire → oggi', () => {
  // Mercoledì mezzogiorno, sveglia del mercoledì alle 18:30.
  assert.equal(M.nextRecurrence({ h: 18, m: 30 }, ['mer'], nowMs), at(0, 18, 30));
});

test('stesso giorno, orario già passato → fra sette giorni, non domani', () => {
  // Mercoledì mezzogiorno, sveglia del solo mercoledì alle 07:55.
  assert.equal(M.nextRecurrence({ h: 7, m: 55 }, ['mer'], nowMs), at(7, 7, 55));
});

test('orario esattamente adesso → la settimana prossima (mai istantanea)', () => {
  assert.equal(M.nextRecurrence({ h: 12, m: 0 }, ['mer'], nowMs), at(7, 12, 0));
});

test('più giorni: vince il primo che arriva', () => {
  // Mercoledì mezzogiorno: lun+mer alle 07:55 → il lunedì (fra 5 giorni).
  assert.equal(M.nextRecurrence({ h: 7, m: 55 }, ['lun', 'mer'], nowMs), at(5, 7, 55));
  // Se invece l'orario del mercoledì deve ancora arrivare, è oggi.
  assert.equal(M.nextRecurrence({ h: 20, m: 0 }, ['lun', 'mer'], nowMs), at(0, 20, 0));
});

test('cavallo della settimana: domenica sera → lunedì mattina', () => {
  const dom = new Date(2026, 8, 6, 22, 0, 0, 0); // domenica
  assert.equal(dom.getDay(), 0);
  const target = new Date(2026, 8, 7, 7, 0, 0, 0); // lunedì
  assert.equal(M.nextRecurrence({ h: 7, m: 0 }, ['lun'], dom.getTime()), target.getTime());
});

test('feriali chiesti di venerdì sera → lunedì, non sabato', () => {
  const ven = new Date(2026, 8, 4, 21, 0, 0, 0); // venerdì
  assert.equal(ven.getDay(), 5);
  const lun = new Date(2026, 8, 7, 6, 30, 0, 0);
  assert.equal(M.nextRecurrence({ h: 6, m: 30 }, 'feriali', ven.getTime()), lun.getTime());
});

test('weekend chiesto di mercoledì → sabato', () => {
  assert.equal(M.nextRecurrence({ h: 9, m: 0 }, 'weekend', nowMs), at(3, 9, 0));
});

test('ogni giorno → domani se l\'ora di oggi è passata, oggi altrimenti', () => {
  assert.equal(M.nextRecurrence({ h: 7, m: 0 }, 'ogni giorno', nowMs), at(1, 7, 0));
  assert.equal(M.nextRecurrence({ h: 15, m: 0 }, 'ogni giorno', nowMs), at(0, 15, 0));
});

test('senza giorni validi non c\'è occorrenza (l\'azione fallisce invece di fingere)', () => {
  assert.equal(M.nextRecurrence({ h: 7, m: 0 }, [], nowMs), null);
  assert.equal(M.nextRecurrence(null, ['lun'], nowMs), null);
});

test('l\'ora si legge anche da una data-ora completa', () => {
  assert.deepEqual(M.parseClock('07:55'), { h: 7, m: 55 });
  assert.deepEqual(M.parseClock('7'), { h: 7, m: 0 });
  assert.deepEqual(M.parseClock('7.30'), { h: 7, m: 30 });
  assert.deepEqual(M.parseClock(new Date(2026, 8, 4, 6, 15).toISOString()), { h: 6, m: 15 });
  assert.equal(M.parseClock('25:00'), null);
  assert.equal(M.parseClock('boh'), null);
});

// ─── Sveglia ricorrente salvata ────────────────────────────────────────────

function stubChrome() {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) { return { [key]: store[key] }; },
        async set(obj) { Object.assign(store, obj); },
      },
    },
  };
  return store;
}

test('addAlarm con ripeti salva i giorni e punta alla prossima occorrenza', async () => {
  stubChrome();
  const entry = await M.addAlarm({ label: 'lezione', time: '07:55', repeat: ['lun', 'mer'], nowMs });
  assert.ok(entry);
  assert.deepEqual(entry.repeat, ['lun', 'mer']);
  assert.equal(entry.atTime, '07:55');
  assert.equal(new Date(entry.endsAt).getTime(), at(5, 7, 55)); // lunedì prossimo
  assert.equal(M.isRecurring(entry), true);
});

test('addAlarm senza ripeti resta a colpo singolo (nessun campo in più)', async () => {
  stubChrome();
  const entry = await M.addAlarm({ label: 'x', time: '18:30', nowMs });
  assert.ok(entry);
  assert.equal(entry.repeat, undefined);
  assert.equal(M.isRecurring(entry), false);
});

test('la sveglia ricorrente si ricalcola, non si consuma', async () => {
  stubChrome();
  // Ricorrente ogni giorno, scaduta un minuto fa.
  const e = await M.addAlarm({ label: 'pillola', time: '08:00', repeat: 'ogni giorno', nowMs });
  const t = { ...e, endsAt: new Date(Date.now() - 60_000).toISOString() };
  await globalThis.chrome.storage.local.set({ [globalThis.SN_CONST.STORAGE_KEYS.FILO_TIMERS]: [t] });

  const after = await M.gcTimers();
  assert.equal(after.length, 1, 'resta in lista: suona, non sparisce');
  assert.equal(after[0].ringing, true);
  assert.ok(new Date(after[0].endsAt).getTime() > Date.now(), 'già puntata alla prossima volta');

  // "Ferma" la zittisce ma NON la disdice: domani suona di nuovo.
  const stopped = await M.stopTimerAlarm(after[0].id);
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].ringing, false);
  assert.ok(new Date(stopped[0].endsAt).getTime() > Date.now());
});

test('"Ferma" su una sveglia NON ricorrente la toglie, come prima', async () => {
  stubChrome();
  const e = await M.addAlarm({ label: 'una volta', time: '18:30', nowMs });
  const stopped = await M.stopTimerAlarm(e.id);
  assert.equal(stopped.length, 0);
});

// ─── "Quale sveglia intendi" ───────────────────────────────────────────────

const LISTA = [
  { id: 'a1', kind: 'alarm', label: 'palestra', endsAt: new Date(2026, 8, 3, 7, 0).toISOString(), atTime: '07:00', repeat: ['lun', 'mer'] },
  { id: 'a2', kind: 'alarm', label: 'antibiotico', endsAt: new Date(2026, 8, 2, 20, 0).toISOString(), atTime: '20:00' },
  { id: 'a3', kind: 'alarm', label: 'sveglia lavoro', endsAt: new Date(2026, 8, 3, 6, 30).toISOString(), atTime: '06:30' },
  { id: 't1', label: 'pasta', endsAt: new Date(2026, 8, 2, 12, 10).toISOString() },
];
const ids = (r) => r.map((t) => t.id);

test('etichetta esatta', () => {
  assert.deepEqual(ids(M.resolveTimerRefs(LISTA, { label: 'palestra' })), ['a1']);
});

test('etichetta parziale e accenti/maiuscole non contano', () => {
  assert.deepEqual(ids(M.resolveTimerRefs(LISTA, { label: 'la sveglia della PALESTRA' })), ['a1']);
  assert.deepEqual(ids(M.resolveTimerRefs(LISTA, { label: 'lavoro' })), ['a3']);
});

test('riferimento all\'orario: "quella delle 7"', () => {
  assert.deepEqual(ids(M.resolveTimerRefs(LISTA, { label: 'quella delle 7' })), ['a1']);
  assert.deepEqual(ids(M.resolveTimerRefs(LISTA, { label: '06:30' })), ['a3']);
});

test('"tutte le sveglie" prende le sveglie e NON i timer', () => {
  assert.deepEqual(ids(M.resolveTimerRefs(LISTA, { all: true, kind: 'alarm' })), ['a1', 'a2', 'a3']);
  assert.deepEqual(ids(M.resolveTimerRefs(LISTA, { all: true, kind: 'timer' })), ['t1']);
  assert.deepEqual(ids(M.resolveTimerRefs(LISTA, { all: true })), ['a1', 'a2', 'a3', 't1']);
});

test('un riferimento che non combacia non prende NIENTE (mai a caso)', () => {
  assert.deepEqual(ids(M.resolveTimerRefs(LISTA, { label: 'dentista' })), []);
  assert.deepEqual(ids(M.resolveTimerRefs(LISTA, {})), []);
});

test('il timer si trova per etichetta come le sveglie', () => {
  assert.deepEqual(ids(M.resolveTimerRefs(LISTA, { label: 'pasta' })), ['t1']);
  assert.deepEqual(ids(M.resolveTimerRefs(LISTA, { label: 'pasta', kind: 'alarm' })), []);
});

// ─── Cancellare e spostare ─────────────────────────────────────────────────

async function seed() {
  stubChrome();
  await globalThis.chrome.storage.local.set({
    [globalThis.SN_CONST.STORAGE_KEYS.FILO_TIMERS]: JSON.parse(JSON.stringify(LISTA)),
  });
}

test('cancellare per etichetta toglie solo quella', async () => {
  await seed();
  const r = await M.removeTimersByRef({ label: 'palestra' });
  assert.deepEqual(r.removed.map((t) => t.id), ['a1']);
  assert.deepEqual(ids(r.list), ['a2', 'a3', 't1']);
});

test('cancellare "tutte le sveglie" lascia in piedi i timer', async () => {
  await seed();
  const r = await M.removeTimersByRef({ all: true, kind: 'alarm' });
  assert.equal(r.removed.length, 3);
  assert.deepEqual(ids(r.list), ['t1']);
});

test('un riferimento incomprensibile non cancella niente', async () => {
  await seed();
  const r = await M.removeTimersByRef({ label: 'dentista' });
  assert.equal(r.removed.length, 0);
  assert.equal(r.list.length, 4);
});

test('spostare l\'orario tiene la ricorrenza che la sveglia aveva già', async () => {
  await seed();
  const r = await M.updateTimersByRef({ label: 'palestra' }, { time: '08:15', nowMs });
  assert.equal(r.updated.length, 1);
  const e = r.updated[0];
  assert.equal(e.atTime, '08:15');
  assert.deepEqual(e.repeat, ['lun', 'mer'], 'spostare l\'ora non disdice lun+mer');
  assert.equal(new Date(e.endsAt).getTime(), at(5, 8, 15));
});

test('si può aggiungere la ricorrenza a una sveglia che non ce l\'aveva', async () => {
  await seed();
  const r = await M.updateTimersByRef({ label: 'antibiotico' }, { repeat: 'ogni giorno', nowMs });
  assert.equal(r.updated.length, 1);
  assert.deepEqual(r.updated[0].repeat, ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']);
  assert.equal(r.updated[0].atTime, '20:00', 'senza nuovo orario resta il suo');
  assert.equal(new Date(r.updated[0].endsAt).getTime(), at(0, 20, 0));
});

test('un nuovo orario non interpretabile non tocca niente', async () => {
  await seed();
  const r = await M.updateTimersByRef({ label: 'antibiotico' }, { time: 'boh', nowMs });
  assert.equal(r.updated.length, 0);
  const list = await M.listTimers();
  assert.equal(list.find((t) => t.id === 'a2').endsAt, LISTA[1].endsAt);
});

// ─── Livello di conferma e stato letto dall'agente ─────────────────────────
//
// Il criterio è QUANTE voci sparirebbero, non come è scritta la richiesta:
// togliere quella nominata è immediato, toglierne più d'una passa dal popup
// che le elenca. Il conteggio arriva dal main (`_targets`), mai dall'LLM.

require(join(root, 'src', 'shared', 'preferences.js'));
require(join(root, 'src', 'shared', 'themeTokens.js'));
require(join(root, 'src', 'shared', 'cmdClassify.js'));
require(join(root, 'src', 'shared', 'actionLevels.js'));
require(join(root, 'src', 'shared', 'filoState.js'));

const AL = globalThis.SN_ACTION_LEVELS;

test('cancellare UNA sveglia si fa subito; più d\'una chiede conferma', () => {
  assert.equal(AL.levelFor({ type: 'CANCELLA_SVEGLIA', etichetta: 'palestra', _targets: ['Sveglia “palestra” 07:00'] }), 1);
  assert.equal(AL.levelFor({ type: 'CANCELLA_SVEGLIA', tutte: true, _targets: ['a', 'b', 'c'] }), 2);
  // "tutte" che in realtà prende una cosa sola non merita un popup.
  assert.equal(AL.levelFor({ type: 'CANCELLA_SVEGLIA', tutte: true, _targets: ['a'] }), 1);
  // Senza conteggio (registro consultato fuori dal main) si sta prudenti.
  assert.equal(AL.levelFor({ type: 'CANCELLA_SVEGLIA', tutte: true }), 2);
  assert.equal(AL.levelFor({ type: 'CANCELLA_SVEGLIA', etichetta: 'palestra' }), 1);
});

test('il popup elenca cosa sta per sparire, non solo "delle sveglie"', () => {
  const d = AL.describe({
    type: 'CANCELLA_SVEGLIA', tutte: true,
    _targets: ['Sveglia “palestra” 07:00 (lun+mer)', 'Sveglia “antibiotico” 20:00'],
  });
  assert.match(d, /palestra/);
  assert.match(d, /antibiotico/);
});

test('spostare un orario si fa subito; spostarne più d\'uno chiede conferma', () => {
  assert.equal(AL.levelFor({ type: 'MODIFICA_SVEGLIA', etichetta: 'palestra', orario: '08:00', _targets: ['a'] }), 1);
  assert.equal(AL.levelFor({ type: 'MODIFICA_SVEGLIA', orario: '08:00', _targets: ['a', 'b'] }), 2);
});

test('lo STATO che legge l\'agente dice la ricorrenza', () => {
  const text = globalThis.SN_FILO_STATE.renderForPrompt({
    time: { humanNow: 'x', timeSinceLastInteractionMin: null, session: null },
    tabs: [], notifications: [], recentActions: [], dashboard: null, credits: null,
    timers: [
      { id: 'a1', kind: 'alarm', label: 'lezione', repeat: ['lun', 'mer'], endsAt: new Date(2026, 8, 7, 7, 55).toISOString(), paused: false, remainingSec: 99 },
      { id: 'a2', kind: 'alarm', label: 'dentista', repeat: null, endsAt: new Date(2026, 8, 3, 9, 0).toISOString(), paused: false, remainingSec: 99 },
    ],
  });
  assert.match(text, /Sveglia "lezione" ricorrente lun\+mer: suona alle 07:55/);
  assert.match(text, /Sveglia "dentista": suona alle 09:00/);
});
