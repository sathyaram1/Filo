// #1500 giro 2: una chiave nuova che il bake scrive solo quando la sua fonte è piena, con una fonte fuori dalle convenzioni, deve far rossa la sentinella.
// Si prova su una copia del repo: il bake vero e la sentinella vera, col bake ritoccato come lo ritoccherebbe un lavoro futuro.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SENTINELLA = 'tests/unit/chiaviNelPacchettoPubblico.test.mjs';

// Esce 0 se la sentinella resta verde; solo i due casi sul bake vero, perché il ritocco sposta i punti che le altre prove ritoccano a loro volta.
function sentinellaSulBakeRitoccato(ritocco) {
  const copia = cartellaTemporanea('filo-1500-g2-');
  try {
    cpSync(join(RADICE, 'scripts'), join(copia, 'scripts'), { recursive: true });
    cpSync(join(RADICE, 'tests', 'helpers'), join(copia, 'tests', 'helpers'), { recursive: true });
    mkdirSync(join(copia, 'tests', 'unit'), { recursive: true });
    cpSync(join(RADICE, SENTINELLA), join(copia, SENTINELLA));
    mkdirSync(join(copia, 'src', 'main', 'config'), { recursive: true });
    cpSync(join(RADICE, 'src', 'main', 'config', 'default-keys.js'), join(copia, 'src', 'main', 'config', 'default-keys.js'));
    cpSync(join(RADICE, 'package.json'), join(copia, 'package.json'));
    symlinkSync(join(RADICE, 'node_modules'), join(copia, 'node_modules'), 'junction');
    const bake = join(copia, 'scripts', 'bake-default-config.mjs');
    const prima = readFileSync(bake, 'utf8');
    const dopo = ritocco(prima);
    expect(dopo, 'il ritocco del bake non ha trovato il punto').not.toBe(prima);
    writeFileSync(bake, dopo, 'utf8');
    const env = { ...process.env };
    for (const n of Object.keys(env)) if (n.startsWith('FILO_DEFAULT_') || n === 'GOOGLE_MAPS_KEY') delete env[n];
    try {
      execFileSync(process.execPath, ['--test', '--test-name-pattern=scrive tutte le ammesse', SENTINELLA], { cwd: copia, env, stdio: 'pipe' });
      return 0;
    } catch (e) {
      return typeof e.status === 'number' ? e.status : 1;
    }
  } finally {
    togliCartella(copia);
  }
}

test('r1 una chiave scritta solo se piena, letta da una variabile del job con un altro nome, fa rossa la sentinella', () => {
  const uscita = sentinellaSulBakeRitoccato((s) => s.replace(
    'JSON.stringify({ apiKeys, safeBrowsingKey, bakedAt',
    'JSON.stringify({ apiKeys, safeBrowsingKey, ...(process.env.GOOGLE_MAPS_KEY ? { mapsKey: process.env.GOOGLE_MAPS_KEY } : {}), bakedAt',
  ));
  expect(uscita, 'la sentinella resta verde con una chiave fuori elenco nel bake').not.toBe(0);
});

test('r1 una chiave scritta solo se piena, col nome della variabile composto a pezzi, fa rossa la sentinella', () => {
  const uscita = sentinellaSulBakeRitoccato((s) => s.replace(
    'JSON.stringify({ apiKeys, safeBrowsingKey, bakedAt',
    "JSON.stringify({ apiKeys, safeBrowsingKey, ...Object.fromEntries(['MAPS'].map((n) => [n.toLowerCase() + 'Key', envKey(`FILO_DEFAULT_${n}_KEY`)]).filter(([, v]) => v)), bakedAt",
  ));
  expect(uscita, 'la sentinella resta verde con una chiave fuori elenco nel bake').not.toBe(0);
});
