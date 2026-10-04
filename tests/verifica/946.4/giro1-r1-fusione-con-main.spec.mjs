// #946.4 giro 1: il ramo fuso con main di oggi deve dare strumenti di fusione che si caricano.
// Main ha già curato la stessa chiave per conto suo: il ramo, così com'è, va in conflitto e,
// risolto il conflitto, la libreria della prova sulla fusione dichiara due volte lo stesso nome.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LIB = 'scripts/lib/unit-sulla-fusione.mjs';
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('il ramo si fonde con main senza conflitti e la libreria fusa si carica', async () => {
  git(['fetch', '--quiet', 'origin', 'main']);
  let albero = '';
  let conflitto = '';
  try {
    albero = git(['merge-tree', '--write-tree', '--name-only', 'origin/main', 'HEAD']).split('\n')[0].trim();
  } catch (e) {
    conflitto = String(e.stdout || e.message);
    albero = conflitto.split('\n')[0].trim();
  }
  expect(conflitto, 'la fusione con main va in conflitto').toBe('');

  // La libreria fusa, messa accanto all'originale perché i suoi import relativi si risolvano.
  const fusa = join(ROOT, 'scripts', 'lib', `.prova-fusione-${process.pid}.mjs`);
  writeFileSync(fusa, git(['show', `${albero}:${LIB}`]));
  try {
    let errore = '';
    try { await import(pathToFileURL(fusa).href); } catch (e) { errore = String(e && e.message); }
    expect(errore, 'la libreria fusa non si carica').toBe('');
  } finally {
    rmSync(fusa, { force: true });
  }
});
