// #849 giro 3: la sentinella dei servizi esterni, girata su una copia di src/ cambiata come la cambierebbe un lavoro futuro.
// r1: un host nuovo che arriva alla chiamata per una strada non prevista deve far rossa la sentinella.
// r2: un cambio vero in src/ deve accendere i controlli della sentinella, mai le sue prove interne.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, collegaCartella, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SENTINELLA = join('tests', 'unit', 'serviziEsterni.test.mjs');

function sentinellaSu(modifica) {
  const dir = cartellaTemporanea('filo-849-');
  try {
    cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
    cpSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
    mkdirSync(join(dir, 'tests', 'unit'), { recursive: true });
    cpSync(join(ROOT, SENTINELLA), join(dir, SENTINELLA));
    collegaCartella(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    modifica(dir);
    const r = spawnSync(process.execPath, ['--test', SENTINELLA], { cwd: dir, encoding: 'utf8' });
    return { rossa: r.status !== 0, falliti: r.stdout.match(/^not ok .*$/gm) || [] };
  } finally { togliCartella(dir); }
}

const aggiungi = (file, testo) => (dir) => {
  const p = join(dir, file);
  writeFileSync(p, readFileSync(p, 'utf8') + testo);
};
const SCRYFALL = 'src/main/services/scryfall.js';

test('controllo: la copia senza modifiche è verde', () => {
  expect(sentinellaSu(() => {}).rossa).toBe(false);
});

test('r1 opzioni della richiesta preparate in una variabile, con l’host in una costante, in un file già elencato', () => {
  const s = sentinellaSu(aggiungi(SCRYFALL,
    "\nconst HOST_NUOVO = 'nuovo-servizio.example';\nconst opzioni = { hostname: HOST_NUOVO, path: '/api' };\nrequire('node:https').request(opzioni);\n"));
  expect(s.rossa, 'la sentinella resta verde con un servizio nuovo').toBe(true);
});

test('r1 indirizzo montato a pezzi con join, in un file già elencato', () => {
  const s = sentinellaSu(aggiungi(SCRYFALL,
    "\nconst HOST_NUOVO = 'nuovo-servizio.example';\nfetch(['https://', HOST_NUOVO, '/api'].join(''));\n"));
  expect(s.rossa, 'la sentinella resta verde con un servizio nuovo').toBe(true);
});

test('r2 un file nuovo che chiama un host nuovo accende la sentinella, non le sue prove interne', () => {
  const s = sentinellaSu((dir) => writeFileSync(join(dir, 'src', 'main', 'services', 'meteo.js'),
    "module.exports = () => fetch('https://api.meteo.example/v1');\n"));
  expect(s.rossa).toBe(true);
  expect(s.falliti.filter((x) => /- prova:/.test(x))).toEqual([]);
});

test('r2 una seconda richiesta ai cambi, verso lo stesso servizio già dichiarato, lascia verde la sentinella', () => {
  const s = sentinellaSu(aggiungi('src/main/services/fxRates.js',
    "\nrequire('node:https').get('https://api.frankfurter.dev/v1/currencies');\n"));
  expect(s.falliti).toEqual([]);
});
