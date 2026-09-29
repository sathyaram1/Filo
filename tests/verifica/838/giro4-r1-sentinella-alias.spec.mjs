// #838 giro 4, rilievo 1: la sentinella delle scorciatoie di sistema deve accorgersi di
// un Alt+lettera registrato anche quando il registro è preso con un altro nome.
// Si copia la sentinella in un progetto finto con un solo sorgente colpevole e la si lancia.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

for (const [nome, sorgente] of [
  ['col nome cambiato nella destrutturazione',
    "const { app, globalShortcut: scorciatoie } = require('electron');\nscorciatoie.register('Alt+E', () => {});\n"],
  ['con un nome tutto suo',
    "const { globalShortcut: gs } = require('electron');\ngs.register('Alt+S', () => {});\n"],
]) {
  test(`la sentinella vede Alt+lettera di sistema registrato ${nome}`, () => {
    const finto = cartellaTemporanea('filo-sentinella-');
    try {
      mkdirSync(join(finto, 'tests', 'unit'), { recursive: true });
      mkdirSync(join(finto, 'src'), { recursive: true });
      copyFileSync(join(ROOT, 'tests', 'unit', 'scorciatoieSoloInFilo.test.mjs'),
        join(finto, 'tests', 'unit', 'scorciatoieSoloInFilo.test.mjs'));
      writeFileSync(join(finto, 'src', 'finto.js'), sorgente);
      const r = spawnSync(process.execPath, ['--test', join('tests', 'unit', 'scorciatoieSoloInFilo.test.mjs')],
        { cwd: finto, encoding: 'utf8' });
      expect(`${r.stdout}\n${r.stderr}`).toContain('finto.js');
    } finally {
      rmSync(finto, { recursive: true, force: true });
    }
  });
}
