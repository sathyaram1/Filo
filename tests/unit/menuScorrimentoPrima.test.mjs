// Sentinella (#2452, #2586): un menu delle pagine di Filo che si chiude allo scorrimento chiede a
// SN_MENU.fotoDelloScorrimento se lo scorrimento ha spostato qualcosa, così quello finito prima dell'apertura non lo
// chiude. La prova nell'app: tests/menu-scorrimento-prima.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CARTELLE = ['src/pages', 'src/shared'];

function js(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...js(p));
    else if (nome.endsWith('.js')) out.push(p);
  }
  return out;
}

test('ogni ascolto dello scorrimento in cattura nelle pagine di Filo passa dalla foto dello scorrimento', () => {
  const senza = [];
  for (const file of CARTELLE.flatMap((c) => js(join(ROOT, c)))) {
    const testo = readFileSync(file, 'utf8');
    if (!/addEventListener\('scroll',\s*\w+,\s*true\)/.test(testo)) continue;
    if (!testo.includes('fotoDelloScorrimento')) senza.push(relative(ROOT, file));
  }
  assert.deepEqual(senza, [], 'questi file chiudono qualcosa su uno scroll in cattura senza la foto dello scorrimento');
});

test('nessun menu passa la sua chiusura dritta all\'ascolto dello scorrimento', () => {
  const dritti = [];
  for (const file of CARTELLE.flatMap((c) => js(join(ROOT, c)))) {
    const testo = readFileSync(file, 'utf8');
    for (const m of testo.matchAll(/addEventListener\('scroll',\s*(\w+),\s*true\)/g)) {
      if (/^(close|chiudi)/i.test(m[1])) dritti.push(`${relative(ROOT, file)}: ${m[1]}`);
    }
  }
  assert.deepEqual(dritti, []);
});
