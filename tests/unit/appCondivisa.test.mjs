// Sentinella: l'app condivisa (tests/helpers/appCondivisa.mjs) si lancia come la fixture, che non si tocca (#238):
// stesse opzioni, stesse regole dei nomi, stesse variabili d'ambiente. Chi le cambia nella fixture le ritrova qui rosse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lancio, OPZIONI_FIXTURE, REGOLE_HOST } from '../helpers/appCondivisa.mjs';
import { argomentiScala } from '../helpers/scala.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'electron.mjs');
const codice = readFileSync(FIXTURE, 'utf8').split('\n').filter((r) => !/^\s*\/\//.test(r)).join('\n');

test('le opzioni di lancio sono quelle della fixture, coi loro valori predefiniti', () => {
  const opzioni = [...codice.matchAll(/^\s+(\w+): \[(.*), \{ option: true \}\],?$/gm)].map(([, nome, val]) => [nome, JSON.parse(val)]);
  assert.ok(opzioni.length, 'la fixture non dichiara più le opzioni come prima: rileggila e aggiorna questa prova');
  assert.deepEqual(Object.fromEntries(opzioni), { ...OPZIONI_FIXTURE });
});

test('le regole dei nomi sono quelle della fixture, nello stesso ordine', () => {
  const m = codice.match(/--host-resolver-rules=([^`$]*)\$\{/);
  assert.ok(m, 'la fixture non scrive più --host-resolver-rules come prima: rileggila e aggiorna questa prova');
  assert.deepEqual([...REGOLE_HOST], m[1].split(',').map((r) => r.trim()).filter(Boolean));
  const { args } = lancio('/dati', { ...OPZIONI_FIXTURE, hostInPiu: ['example.org'], argomentiInPiu: ['--x'] }, {});
  assert.ok(args.includes(`--host-resolver-rules=${[...REGOLE_HOST, 'MAP example.org 127.0.0.1'].join(', ')}`));
  assert.deepEqual(args.slice(0, argomentiScala.length), argomentiScala, 'la manopola della scala apre il lancio, come nella fixture');
  assert.ok(args.indexOf('--x') < args.findIndex((a) => a.startsWith('--host-resolver-rules=')));
  assert.equal(args.at(-1), '.');
});

test('l\'ambiente del lancio porta le stesse variabili della fixture', () => {
  const inizio = codice.indexOf('electron.launch');
  const blocco = codice.slice(inizio, codice.indexOf('registraUsciteApp(app)', inizio));
  const nomi = [...new Set([...blocco.matchAll(/\b(FILO_[A-Z_]+|NODE_ENV)\s*:/g)].map((m) => m[1]))].sort();
  assert.ok(nomi.includes('FILO_USER_DATA'), 'la fixture non lancia più come prima: rileggila e aggiorna questa prova');
  const tutte = lancio('/dati', { ...OPZIONI_FIXTURE, riservaNuovaScheda: true }, {}).env;
  assert.deepEqual(Object.keys(tutte).sort(), nomi);
  assert.equal(lancio('/dati', { ...OPZIONI_FIXTURE, accoglienzaFatta: false }, {}).env.FILO_TEST_ACCOLTO, '0');
  assert.equal(lancio('/dati', OPZIONI_FIXTURE, {}).env.FILO_RISERVA_NUOVA_SCHEDA, undefined);
});
