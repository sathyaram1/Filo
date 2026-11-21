// #1589.8 — chi aggiorna da prima dei livelli di privacy con la protezione delle pagine delicate accesa (anche solo di
// serie) riparte da «Chiedi sulle delicate», all'avvio e da un backup di prima; spenta, o scelto un livello dopo, resta.

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
const M = require(join(ROOT, 'src', 'main', 'services', 'privacyMigrazione.js'));
const L = require(join(ROOT, 'src', 'shared', 'livelliPrivacy.js'));
const { mergeImportedData } = require(join(ROOT, 'src', 'main', 'services', 'exportData.js'));
const K = globalThis.SN_CONST.STORAGE_KEYS;

// Le impostazioni come le scriveva Filo prima dei livelli: l'interruttore c'era sempre, acceso di serie.
const diPrima = (enabled = true) => ({ theme: 'dark', security: { pagineDelicate: { enabled, siti: ['clinica.it'], nonDelicati: [] } } });

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

test('all\'avvio la protezione accesa di prima diventa «Chiedi sulle delicate», una volta sola', async () => {
  const d = disco({ [K.SETTINGS]: diPrima(true), [K.FILO_CAMBI]: [] });
  assert.equal(await M.migra(d), true);
  const r = L.regola(d.dati[K.SETTINGS]);
  assert.equal(r.livello, 'delicate');
  assert.equal(L.chiede(r, { host: 'mail.google.com', motivo: 'posta' }), 'posta', 'dalla posta non parte niente da solo');
  assert.equal(L.chiede(r, { host: 'clinica.it', motivo: 'utente' }), 'utente', 'i siti propri restano');
  assert.equal(d.dati[K.SETTINGS].theme, 'dark', 'il resto resta');
  assert.equal(d.dati[M.SEGNO], true);
  assert.deepEqual(d.scritte.map((s) => s.via), ['migrazione']);
  d.dati[K.SETTINGS].security.privacy.livello = 'anticipo';
  assert.equal(await M.migra(d), false, 'col segno non si ripete: dopo, il livello è una scelta');
  assert.equal(d.dati[K.SETTINGS].security.privacy.livello, 'anticipo');
});

test('anche chi ha già salvato le impostazioni dopo l\'aggiornamento, col livello di serie scritto, riparte da lì', async () => {
  const s = diPrima(true);
  s.security.privacy = { livello: 'anticipo', incognito: 'sempre', chiedi: ['sanita'], sitiAnticipo: [] };
  const d = disco({ [K.SETTINGS]: s, [K.FILO_CAMBI]: [] });
  assert.equal(await M.migra(d), true);
  assert.equal(d.dati[K.SETTINGS].security.privacy.livello, 'delicate');
  assert.deepEqual(d.dati[K.SETTINGS].security.privacy.chiedi, ['sanita'], 'le categorie restano');
});

test('spenta, o col livello scelto dopo, o più stretto, la migrazione non tocca niente', async () => {
  const spenta = disco({ [K.SETTINGS]: diPrima(false) });
  assert.equal(await M.migra(spenta), false);
  assert.equal(L.regola(spenta.dati[K.SETTINGS]).livello, 'anticipo');
  assert.equal(spenta.dati[M.SEGNO], true);

  const s = diPrima(true);
  s.security.privacy = { livello: 'anticipo' };
  const scelto = disco({ [K.SETTINGS]: s, [K.FILO_CAMBI]: [{ id: 'c1', tipo: 'impostazioni', cambi: [{ chiave: 'security.privacy.livello', prima: 'delicate', dopo: 'anticipo' }] }] });
  assert.equal(await M.migra(scelto), false, 'un livello cambiato dopo l\'aggiornamento è una scelta');
  const intervista = disco({ [K.SETTINGS]: { ...s }, [K.FILO_ONBOARDING]: { ticked: ['privacy'] } });
  assert.equal(await M.migra(intervista), false, 'confermato nell\'intervista è una scelta');

  const stretta = diPrima(true);
  stretta.security.privacy = { livello: 'sempre' };
  assert.equal(M.convertite({ [K.SETTINGS]: stretta }), null, 'più stretto di «delicate» resta com\'è');
  assert.equal(M.convertite({ [K.SETTINGS]: { theme: 'dark' } }), null, 'senza l\'interruttore di prima è un\'installazione nuova');
  assert.equal(M.convertite({}), null);
});

test('un backup di prima con la protezione accesa entra come «Chiedi sulle delicate»', () => {
  const qui = { [K.SETTINGS]: { security: { privacy: { livello: 'anticipo' } } } };
  const { merged } = mergeImportedData(qui, { [K.SETTINGS]: diPrima(true) });
  assert.equal(L.regola(merged[K.SETTINGS]).livello, 'delicate');
  const dopo = { [K.SETTINGS]: diPrima(true), [M.SEGNO]: true };
  assert.equal(L.regola(mergeImportedData(qui, dopo).merged[K.SETTINGS]).livello, 'anticipo', 'un backup di dopo ha il segno');
});
