// #1500 giro 1: una chiave nuova aggiunta al bake con la sua fonte deve far diventare rossa la sentinella dell'elenco chiuso.
// Si prova su una copia del repo: il bake vero e la sentinella vera, col bake ritoccato come lo ritoccherebbe un lavoro futuro.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SENTINELLA = 'tests/unit/chiaviNelPacchettoPubblico.test.mjs';

function sentinellaSulBakeRitoccato(ritocco) {
  const copia = cartellaTemporanea('filo-1500-');
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
    for (const n of Object.keys(env)) if (n.startsWith('FILO_DEFAULT_')) delete env[n];
    try {
      execFileSync(process.execPath, ['--test', SENTINELLA], { cwd: copia, env, stdio: 'pipe' });
      return 0;
    } catch (e) {
      return typeof e.status === 'number' ? e.status : 1;
    }
  } finally {
    togliCartella(copia);
  }
}

test('r1 una chiave nuova fra quelle del pacchetto, con la sua variabile del job, fa rossa la sentinella', () => {
  const uscita = sentinellaSulBakeRitoccato((s) => s.replace(
    "{ nome: 'tavily', env: 'FILO_DEFAULT_TAVILY_KEY', server: 'config/secrets.apiKeys.tavily' },",
    "$&\n  { nome: 'anthropic', env: 'FILO_DEFAULT_ANTHROPIC_KEY', server: 'config/secrets.apiKeys.anthropic' },",
  ));
  expect(uscita, 'la sentinella resta verde con una chiave fuori elenco nel bake').not.toBe(0);
});

test('r1 una chiave nuova fuori dalla mappa delle chiavi, con la sua variabile del job, fa rossa la sentinella', () => {
  const uscita = sentinellaSulBakeRitoccato((s) => s.replace(
    'JSON.stringify({ apiKeys, safeBrowsingKey, bakedAt',
    "JSON.stringify({ apiKeys, safeBrowsingKey, mapsKey: envKey('FILO_DEFAULT_MAPS_KEY'), bakedAt",
  ));
  expect(uscita, 'la sentinella resta verde con una chiave fuori elenco nel bake').not.toBe(0);
});
