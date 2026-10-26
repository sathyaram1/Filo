// #1561 — il registro dei cambi di prima (`filo_cambi` in storage.json) entra nel filo alla prima lettura: niente di
// quello che l'utente vedeva o annullava si perde, la chiave sparisce da storage.json e i cambi nuovi vanno nel filo.
// Qui con lo storage vero, in una cartella temporanea.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const userData = cartellaTemporanea('filo-cambi-filo-');
process.env.FILO_USER_DATA = userData;
const VECCHI = [
  { id: 'c1aaaaaaaa', ts: '2026-09-01T10:00:00.000Z', tipo: 'impostazioni', via: 'interfaccia', dove: 'preferences', cambi: [{ chiave: 'theme', prima: 'light', dopo: 'dark' }] },
  { id: 'c2bbbbbbbb', ts: '2026-09-02T10:00:00.000Z', agg: '2026-09-02T10:01:30.000Z', tipo: 'zoom', via: 'interfaccia', dove: 'zoom', cambi: [{ chiave: 'zoom:a.it', prima: 100, dopo: 150 }] },
];
writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: { theme: 'dark' }, filo_cambi: VECCHI }));

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => userData }, safeStorage: { isEncryptionAvailable: () => false } };
  return origLoad.call(this, request, parent, isMain);
};

const Disco = require(join(ROOT, 'src', 'main', 'shim', 'storage.js'));
globalThis.self = globalThis;
globalThis.chrome = { storage: { local: { get: Disco.get, set: Disco.set, remove: Disco.remove } } };
for (const m of ['constants', 'contenutoEsterno', 'timeFormat', 'storage', 'themeTokens', 'tabColor', 'ttsVoices', 'filoMemory', 'preferences', 'cambi', 'filoEventi']) {
  require(join(ROOT, 'src', 'shared', `${m}.js`));
}
const Registro = require(join(ROOT, 'src', 'main', 'services', 'registroCambi.js'));
const K = globalThis.SN_CONST.STORAGE_KEYS;
Registro.collega({ applicaImpostazioni: (p) => globalThis.SN_STORAGE.updateSettings(p) });
Registro.avvia();

test('i cambi di prima tornano tali e quali, la chiave lascia storage.json, e uno nuovo si accoda nel filo', async () => {
  assert.deepEqual(await Registro.lista(), VECCHI);
  await Disco.flushNow();
  const disco = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
  assert.ok(!(K.FILO_CAMBI in disco), 'il registro vecchio è ancora in storage.json');
  const file = join(userData, 'filo', 'eventi.jsonl');
  assert.ok(existsSync(file));
  assert.equal(readFileSync(file, 'utf8').split('\n').filter((r) => r.includes('"tipo":"cambio"')).length, 3, 'due cambi, uno col suo ritocco');

  await Registro.con({ via: 'interfaccia', dove: 'preferences' }, () => globalThis.SN_STORAGE.updateSettings({ fontSize: 'large' }));
  const lista = await Registro.lista();
  assert.equal(lista.length, 3);
  assert.equal(lista[2].via, 'interfaccia');
  assert.ok(lista[2].cambi.some((c) => c.chiave === 'fontSize'));
  await Disco.flushNow();
  assert.ok(!(K.FILO_CAMBI in JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'))), 'un cambio nuovo è tornato in storage.json');
});

test('un cambio arrivato dal registro di prima si annulla ancora, e l\'annullo è un evento del filo', async () => {
  const r = await Registro.annulla('c1aaaaaaaa', { via: 'interfaccia', dove: 'newtab' });
  assert.equal(r.ok, true, r.motivo);
  assert.equal((await globalThis.SN_STORAGE.getSettings()).theme, 'light');
  const tutti = await Registro.tutti();
  const annullato = tutti.find((e) => e.id === 'c1aaaaaaaa');
  assert.ok(annullato.annullatoDa, 'la riga non dice che è annullata');
  assert.ok(tutti.some((e) => e.annulla === 'c1aaaaaaaa'));
});

test('lo zoom ritoccato a più riprese resta un cambio solo, da com\'era a com\'è', async () => {
  const zoom = (prima, dopo) => Registro.con({ via: 'interfaccia', dove: 'zoom' }, () => Registro.registraZoom({ host: 'b.it', prima, dopo }));
  zoom(100, 110);
  zoom(110, 125);
  await Registro.attesa();
  let righe = (await Registro.lista()).filter((e) => e.cambi.some((c) => c.chiave === 'zoom:b.it'));
  assert.equal(righe.length, 1);
  assert.deepEqual(righe[0].cambi[0], { chiave: 'zoom:b.it', prima: 100, dopo: 125 });
  zoom(125, 100);
  await Registro.attesa();
  righe = (await Registro.lista()).filter((e) => e.cambi.some((c) => c.chiave === 'zoom:b.it'));
  assert.deepEqual(righe, [], 'tornato a com\'era, il cambio se ne va');
});
