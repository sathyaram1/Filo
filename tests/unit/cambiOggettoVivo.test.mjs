// #1088 — lo storage prestava il valore vivo: addTimer/setProxyRule mutavano la lista letta prima di set(), e il
// registro dei cambi vedeva prima == dopo. Dal secondo timer in poi niente segno né annullo, dopo un riavvio
// nemmeno il primo, e «Annulla l'ultimo cambio» toglieva il timer sbagliato. Qui con lo storage vero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const userData = cartellaTemporanea('filo-cambi-vivo-');
process.env.FILO_USER_DATA = userData;
// Un timer già su disco: è il caso «dopo un riavvio», in cui sbagliava anche il primo.
const giaSalvato = { id: 'vecchio', label: 'forno', startedAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3600e3).toISOString(), paused: false };
writeFileSync(join(userData, 'storage.json'), JSON.stringify({ filo_timers: [giaSalvato], filo_proxy_rules: { 'gia.example': { country: 'it', tier: null, ts: '2026-01-01T00:00:00.000Z' } } }));

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
const FM = globalThis.SN_FILO_MEMORY;
const K = globalThis.SN_CONST.STORAGE_KEYS;
Registro.avvia();

async function eventi(tipo) {
  return (await Registro.lista()).filter((e) => e.tipo === tipo);
}

test('ogni timer aggiunto è un cambio suo, anche il primo dopo un riavvio, e l\'annullo toglie l\'ultimo', async () => {
  const uno = await FM.addTimer({ label: 'pasta', seconds: 600 });
  const due = await FM.addTimer({ label: 'tè', seconds: 300 });
  const timer = await eventi('timer');
  assert.deepEqual(timer.map((e) => e.cambi.map((c) => c.chiave)), [[`timer:${uno.id}`], [`timer:${due.id}`]]);

  const r = await Registro.annulla(null, { via: 'chat' });
  assert.equal(r.ok, true);
  const rimasti = (await FM.listTimers()).map((t) => t.id).sort();
  assert.deepEqual(rimasti, [uno.id, 'vecchio'].sort(), 'l\'annullo toglie il tè, l\'ultimo aggiunto');

  await FM.pauseTimer(uno.id);
  await FM.resumeTimer(uno.id);
  const sveglia = await FM.addAlarm({ label: 'palestra', time: '07:30', repeat: ['mon'] });
  const ultimo = (await eventi('timer')).at(-1);
  assert.deepEqual(ultimo.cambi.map((c) => c.chiave), [`timer:${sveglia.id}`]);
});

test('due regole del proxy sono due cambi, e toglierne una è un cambio anch\'esso', async () => {
  await FM.setProxyRule('uno.example', { country: 'de' });
  await FM.setProxyRule('due.example', { country: 'fr' });
  await FM.removeProxyRule('gia.example');
  const proxy = await eventi('proxy');
  assert.deepEqual(proxy.map((e) => e.cambi.map((c) => c.chiave)), [['proxy:uno.example'], ['proxy:due.example'], ['proxy:gia.example']]);
});

test('una chiave osservata non si presta viva: mutare ciò che si è letto non cambia lo storage', async () => {
  const a = (await Disco.get(K.FILO_TIMERS))[K.FILO_TIMERS];
  a.length = 0;
  const b = (await Disco.get([K.FILO_TIMERS]))[K.FILO_TIMERS];
  assert.ok(b.length > 0);
  const tutto = await Disco.get(null);
  tutto[K.FILO_PROXY_RULES]['finto.example'] = { country: 'xx' };
  assert.ok(!('finto.example' in (await FM.listProxyRules())));

  const scritta = [{ id: 'x', label: 'x', endsAt: new Date(Date.now() + 60e3).toISOString() }];
  await Disco.set({ [K.FILO_TIMERS]: scritta });
  scritta.push({ id: 'y' });
  assert.deepEqual((await FM.listTimers()).map((t) => t.id), ['x'], 'nemmeno ciò che si è scritto resta legato');
});
