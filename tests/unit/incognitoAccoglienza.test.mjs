// #2578: in una finestra incognito chi è già stato accolto non rifà l'intervista, ma dell'intervista l'incognito
// vede solo il segno, mai le risposte. Electron è mockato come in storagePrimaLettura.test.mjs; lo stato passa da
// SN_FILO_MEMORY, la stessa lettura di home, chat e carte.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const userData = cartellaTemporanea('filo-incognito-accolto-');
process.env.FILO_USER_DATA = userData;
const accolto = {
  done: true,
  ticked: [],
  thread: [{ role: 'filo', text: 'Ciao, sono Filo' }, { role: 'user', text: 'faccio il fornaio a Bari' }],
  past: [{ thread: [{ role: 'filo', text: 'Ciao' }, { role: 'user', text: 'ho due gatti' }] }],
  closedAt: '2026-11-01T10:00:00.000Z',
};
writeFileSync(join(userData, 'storage.json'), JSON.stringify({ filo_onboarding: accolto }));

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => userData }, safeStorage: { isEncryptionAvailable: () => false } };
  }
  return origLoad.call(this, request, parent, isMain);
};
const Storage = require(join(ROOT, 'src', 'main', 'shim', 'storage.js'));
globalThis.chrome = { storage: { local: Storage } };
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'onboarding.js'));
require(join(ROOT, 'src', 'shared', 'filoMemory.js'));
const FiloMem = globalThis.SN_FILO_MEMORY;

const disco = async (stato) => {
  Storage.resetIncognito();
  await Storage.set({ filo_onboarding: stato });
};

test('accolto fuori, accolto anche in incognito: niente intervista da riaprire', async () => {
  await disco(accolto);
  const dentro = await Storage.runIncognito(() => FiloMem.getOnboarding());
  assert.equal(dentro.done, true, 'in incognito l\'intervista ripartirebbe da capo');
});

test('in incognito le risposte dell\'intervista e quelle passate restano fuori, da ogni lettura', async () => {
  await disco(accolto);
  const dentro = await Storage.runIncognito(() => FiloMem.getOnboarding());
  assert.deepEqual(dentro.thread, []);
  assert.deepEqual(dentro.past, []);
  const tutto = await Storage.runIncognito(() => Storage.get(null));
  assert.deepEqual(tutto.filo_onboarding, { done: true });
  assert.doesNotMatch(JSON.stringify(tutto), /fornaio|gatti/);
});

test('rifatta dalle Preferenze e ancora aperta: in incognito resta accolto', async () => {
  await disco({ ...accolto, done: false, rifatta: true, thread: [{ role: 'filo', text: 'Ciao, sono Filo' }] });
  assert.equal((await Storage.runIncognito(() => FiloMem.getOnboarding())).done, true);
});

test('chi non è mai stato accolto in incognito non vede niente di quella che ha cominciato', async () => {
  await disco({ done: false, ticked: [], thread: [{ role: 'user', text: 'faccio il fornaio a Bari' }] });
  const dentro = await Storage.runIncognito(() => FiloMem.getOnboarding());
  assert.equal(dentro.done, false);
  assert.deepEqual(dentro.thread, []);
});

test('il vecchio segno di benvenuto vale anche in incognito', async () => {
  Storage.resetIncognito();
  await Storage.remove('filo_onboarding');
  await Storage.set({ filo_welcomed: true });
  assert.equal((await Storage.runIncognito(() => FiloMem.getOnboarding())).done, true);
  await Storage.remove('filo_welcomed');
});

test('quello che l\'incognito scrive sull\'intervista non arriva sul disco, e il disco resta accolto', async () => {
  await disco(accolto);
  await Storage.runIncognito(async () => {
    const cur = await FiloMem.getOnboarding();
    await FiloMem.setOnboarding({ ...cur, done: false, thread: [{ role: 'user', text: 'segreto incognito' }] });
    assert.equal((await FiloMem.getOnboarding()).thread[0].text, 'segreto incognito', 'lì dentro la scrittura si vede');
  });
  const fuori = await FiloMem.getOnboarding();
  assert.equal(fuori.done, true);
  assert.equal(fuori.thread[1].text, 'faccio il fornaio a Bari');
  await Storage.flushNow();
  assert.doesNotMatch(readFileSync(join(userData, 'storage.json'), 'utf8'), /segreto incognito/);
});
