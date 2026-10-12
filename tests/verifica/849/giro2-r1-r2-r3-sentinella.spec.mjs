// #849 giro 2 — la sentinella dei servizi esterni si accorge dei servizi nuovi e delle voci morte.
// Ogni caso copia src/ e la sentinella in una cartella temporanea, cambia un file come farebbe un lavoro
// futuro, e guarda se la sentinella diventa rossa (o, per r3, quale delle sue prove si accende).

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, collegaCartella, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function copia() {
  const dir = cartellaTemporanea('filo-849-');
  cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
  mkdirSync(join(dir, 'tests', 'unit'), { recursive: true });
  cpSync(join(ROOT, 'tests', 'unit', 'serviziEsterni.test.mjs'), join(dir, 'tests', 'unit', 'serviziEsterni.test.mjs'));
  collegaCartella(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

function sentinella(dir) {
  const r = spawnSync(process.execPath, ['--test', join('tests', 'unit', 'serviziEsterni.test.mjs')], { cwd: dir, encoding: 'utf8' });
  return { rossa: r.status !== 0, falliti: (r.stdout.match(/^not ok .*$/gm) || []) };
}

function cambia(dir, file, f) {
  const p = join(dir, file);
  writeFileSync(p, f(readFileSync(p, 'utf8')));
}

test('r1 una richiesta con l’host in una costante, scritta con le opzioni, in un file già elencato, fa rossa la sentinella', () => {
  const dir = copia();
  try {
    expect(sentinella(dir).rossa).toBe(false);
    cambia(dir, 'src/main/services/fxRates.js', (t) => t + "\nconst HOST_NUOVO = 'nuovo-servizio.example';\nrequire('node:https').request({ hostname: HOST_NUOVO, path: '/api' });\n");
    expect(sentinella(dir).rossa).toBe(true);
  } finally { togliCartella(dir); }
});

test('r2 togliere la chiamata ai cambi lasciando la costante dell’indirizzo fa rossa la voce dei cambi', () => {
  const dir = copia();
  try {
    cambia(dir, 'src/main/services/fxRates.js', (t) => t.replace(/\bfetch\s*\(/g, 'nonChiama('));
    const s = sentinella(dir);
    expect(s.falliti.some((x) => /ancora usata dal codice/.test(x))).toBe(true);
  } finally { togliCartella(dir); }
});

test('r3 un indirizzo nuovo in un file nuovo accende la sentinella, non le sue prove interne', () => {
  const dir = copia();
  try {
    writeFileSync(join(dir, 'src', 'main', 'services', 'zzNuovo.js'), "module.exports = () => fetch('https://nuovo-servizio.example/api');\n");
    const s = sentinella(dir);
    expect(s.rossa).toBe(true);
    expect(s.falliti.filter((x) => /- prova:/.test(x))).toEqual([]);
  } finally { togliCartella(dir); }
});
