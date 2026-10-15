// #841 — l'Aiuto è acceso di serie, e un file di dati di prima (dove `help: false` era il valore di serie) non lo
// spegne: conta come scelta solo l'ultimo cambio che il registro ha visto. Vale all'avvio e per un backup importato.

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
const A = require(join(ROOT, 'src', 'main', 'services', 'interruttoreAiuto.js'));
const { mergeImportedData, regolaImport } = require(join(ROOT, 'src', 'main', 'services', 'exportData.js'));
const C = globalThis.SN_CONST;
const K = C.STORAGE_KEYS;

const vecchie = (help) => ({ theme: 'dark', featureFlags: { help, categorize: false, spellcheck: true } });
const cambio = (dopo, via = 'chat') => ({ id: `c${dopo}`, tipo: 'impostazioni', via, cambi: [{ chiave: 'featureFlags.help', prima: !dopo, dopo }] });

// Un disco finto con la stessa forma di src/main/shim/storage.js, e un registro che annota chi scrive.
function disco(dati) {
  const scritte = [];
  let via = null;
  return {
    dati,
    scritte,
    storage: {
      async get(chiavi) { return Object.fromEntries(chiavi.map((k) => [k, dati[k]])); },
      async set(o) { scritte.push({ via, o }); Object.assign(dati, o); },
    },
    registro: { async con(p, fn) { via = p.via; try { return await fn(); } finally { via = null; } } },
  };
}

test('di serie l\'Aiuto è acceso', () => {
  assert.equal(C.DEFAULT_SETTINGS.featureFlags.help, true);
  assert.equal(A.acceso(C.DEFAULT_SETTINGS), true);
  assert.equal(A.acceso({}), true);
  assert.equal(A.acceso({ featureFlags: { help: false } }), false);
});

test('il registro dice l\'ultima scelta fatta, e niente se l\'interruttore non è mai cambiato', () => {
  assert.equal(A.sceltaRegistrata(undefined), undefined);
  assert.equal(A.sceltaRegistrata([{ tipo: 'impostazioni', cambi: [{ chiave: 'theme', prima: 'light', dopo: 'dark' }] }]), undefined);
  assert.equal(A.sceltaRegistrata([cambio(true), cambio(false)]), false);
  assert.equal(A.sceltaRegistrata([cambio(false), cambio(true)]), true);
  assert.equal(A.sceltaRegistrata([cambio(false), { tipo: 'timer', cambi: [{ chiave: 'featureFlags.help', dopo: true }] }]), false);
});

test('all\'avvio un file vecchio col valore di serie riaccende l\'Aiuto, una volta, senza un cambio nel filo', async () => {
  const d = disco({ [K.SETTINGS]: vecchie(false), [K.FILO_CAMBI]: [] });
  assert.equal(await A.migra(d), true);
  assert.equal(d.dati[K.SETTINGS].featureFlags.help, true);
  assert.equal(d.dati[K.SETTINGS].theme, 'dark', 'le altre impostazioni restano');
  assert.equal(d.dati[K.SETTINGS].featureFlags.categorize, false);
  assert.equal(d.dati[A.SEGNO], true);
  assert.deepEqual(d.scritte.map((s) => s.via), ['migrazione'], 'la scrittura passa dal registro come migrazione');

  // Dopo la migrazione un «spegni l'Aiuto» è una scelta: al riavvio resta spento.
  d.dati[K.SETTINGS] = vecchie(false);
  assert.equal(await A.migra(d), false);
  assert.equal(d.dati[K.SETTINGS].featureFlags.help, false);
  assert.equal(d.scritte.length, 1, 'al secondo avvio non si scrive niente');
});

test('chi l\'aveva spento davvero (il registro lo dice) lo ritrova spento', async () => {
  const d = disco({ [K.SETTINGS]: vecchie(false), [K.FILO_CAMBI]: [cambio(true), cambio(false)] });
  assert.equal(await A.migra(d), false);
  assert.equal(d.dati[K.SETTINGS].featureFlags.help, false);
  assert.equal(d.dati[A.SEGNO], true);
  assert.equal(d.scritte[0].o[K.SETTINGS], undefined, 'le impostazioni non si toccano');
});

test('un\'installazione nuova, o un Aiuto già acceso, prendono solo il segno', async () => {
  for (const dati of [{}, { [K.SETTINGS]: vecchie(true) }]) {
    const d = disco(dati);
    assert.equal(await A.migra(d), false);
    assert.equal(d.dati[A.SEGNO], true);
    assert.deepEqual(Object.keys(d.scritte[0].o), [A.SEGNO]);
  }
});

test('un backup di prima non spegne l\'Aiuto di chi lo importa; uno di adesso porta la scelta che contiene', () => {
  const qui = { [K.SETTINGS]: { ...vecchie(true), theme: 'light' } };
  const vecchio = { [K.SETTINGS]: vecchie(false) };
  const r1 = mergeImportedData(qui, vecchio).merged[K.SETTINGS];
  assert.equal(r1.featureFlags.help, true, 'il false del backup vecchio era il valore di serie');
  assert.equal(r1.theme, 'dark', 'il resto del backup entra');

  const nuovo = { [K.SETTINGS]: vecchie(false), [A.SEGNO]: true };
  assert.equal(mergeImportedData(qui, nuovo).merged[K.SETTINGS].featureFlags.help, false);

  const sceltoPrima = { [K.SETTINGS]: vecchie(false), [K.FILO_CAMBI]: [cambio(true), cambio(false)] };
  assert.equal(mergeImportedData(qui, sceltoPrima).merged[K.SETTINGS].featureFlags.help, false);

  assert.equal(regolaImport(A.SEGNO), 'stato', 'il segno è di questa installazione, non si importa');
  assert.equal(vecchio[K.SETTINGS].featureFlags.help, false, 'il backup letto non si tocca');
});
