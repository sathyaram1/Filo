// #1274 — un'immagine nata su una pagina delicata resta fuori dal modello che descrive ovunque la si incolli: si
// riconosce dall'impronta dei pixel, anche ricodificata dagli appunti e dopo un riavvio, e dall'incognito non si scrive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { crea, MAX } = require('../../src/main/services/immaginiDelicate.js');

// I «pixel» di questi finti data URL sono quello che sta dopo la virgola: la ricodifica cambia solo l'intestazione.
const impronta = (x) => {
  const pixel = String(x).split(',')[1] || '';
  return pixel ? createHash('sha256').update(pixel).digest('hex') : '';
};
const disco = () => {
  const d = {};
  return { d, storage: { getRaw: async (k, v) => (k in d ? JSON.parse(JSON.stringify(d[k])) : v), setRaw: async (k, v) => { d[k] = v; } } };
};

test('lo screenshot di una pagina delicata resta delicato anche ricodificato, e un\'altra immagine no', async () => {
  const { storage } = disco();
  const I = crea({ impronta, storage: () => storage, appunti: async () => null });
  assert.equal(await I.daDelicata('data:image/png;base64,SALDO'), false, 'senza nessuna immagine segnata, niente è delicato');
  await I.segna('data:image/png;base64,SALDO');
  assert.equal(await I.daDelicata('data:image/bmp;base64,SALDO'), true);
  assert.equal(await I.daDelicata('data:image/png;base64,GATTO'), false);
  assert.equal(await I.daDelicata(''), false);
  assert.equal(await I.daDelicata(null), false);
});

test('conta anche quello che gli appunti di sistema tengono in quel momento, coi pixel che restituiscono loro', async () => {
  const { storage } = disco();
  const I = crea({ impronta, storage: () => storage, appunti: async () => 'data:image/png;base64,SALDO-DAGLI-APPUNTI' });
  await I.segna('data:image/png;base64,SALDO');
  assert.equal(await I.daDelicata('data:image/png;base64,SALDO-DAGLI-APPUNTI'), true);
  const rotti = crea({ impronta, storage: () => storage, appunti: async () => { throw new Error('appunti chiusi'); } });
  await rotti.segna('data:image/png;base64,IBAN');
  assert.equal(await rotti.daDelicata('data:image/png;base64,IBAN'), true, 'gli appunti illeggibili non fermano il segno');
});

test('dopo un riavvio l\'impronta resta, l\'immagine non è mai su disco, e dall\'incognito non si scrive', async () => {
  const { d, storage } = disco();
  const prima = crea({ impronta, storage: () => storage, appunti: async () => null });
  await prima.segna('data:image/png;base64,SALDO');
  await prima.segna('data:image/png;base64,REFERTO', { incognito: true });
  assert.equal(await prima.daDelicata('data:image/png;base64,REFERTO'), true, 'in memoria vale anche l\'incognito');
  const scritto = JSON.stringify(d);
  assert.ok(!scritto.includes('SALDO') && !scritto.includes('REFERTO'));
  assert.equal(d.filo_immagini_delicate.length, 1);

  const dopo = crea({ impronta, storage: () => storage, appunti: async () => null });
  assert.equal(await dopo.daDelicata('data:image/png;base64,SALDO'), true);
  assert.equal(await dopo.daDelicata('data:image/png;base64,REFERTO'), false);
});

test('oltre il tetto si dimentica la più vecchia; una voce rovinata su disco non conta', async () => {
  const { d, storage } = disco();
  d.filo_immagini_delicate = ['non-esadecimale', 42, impronta('x,VECCHIA')];
  const I = crea({ impronta, storage: () => storage, appunti: async () => null });
  assert.equal(await I.daDelicata('x,VECCHIA'), true);
  for (let i = 0; i < MAX; i++) await I.segna(`data:image/png;base64,N${i}`);
  assert.equal(d.filo_immagini_delicate.length, MAX);
  assert.ok(!d.filo_immagini_delicate.includes(impronta('x,VECCHIA')));
  assert.ok(d.filo_immagini_delicate.includes(impronta(`x,N${MAX - 1}`)));
});

test('senza aver letto il disco non lo sovrascrive', async () => {
  const storage = { getRaw: async () => { throw new Error('disco occupato'); }, setRaw: async () => { throw new Error('non doveva scrivere'); } };
  const I = crea({ impronta, storage: () => storage, appunti: async () => null });
  await I.segna('data:image/png;base64,SALDO');
  assert.equal(await I.daDelicata('data:image/png;base64,SALDO'), true);
});
