// Verifica locale clone-worker, giro 1: i lanci di Electron a mano che CLAUDE.md e i ruoli chiedono nel contenitore.
// `xvfb-run -a` senza base parte da :99 in ogni worker: due lanci insieme prendono lo stesso display e il secondo non parte.
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

test('r3 ogni lancio a mano di xvfb-run chiesto dalle ricette porta la base di display del worker', () => {
  const file = ['CLAUDE.md', ...readdirSync(join(ROOT, 'routines', 'roles')).filter((f) => f.endsWith('.md')).map((f) => `routines/roles/${f}`)];
  const senzaBase = [];
  for (const f of file) {
    readFileSync(join(ROOT, f), 'utf8').split(/\r?\n/).forEach((riga, i) => {
      if (/xvfb-run\s+-a\b/.test(riga) && !/\s-n\s/.test(riga)) senzaBase.push(`${f}:${i + 1}: ${riga.trim().slice(0, 120)}`);
    });
  }
  expect(senzaBase, 'righe che fanno partire ogni worker dallo stesso display virtuale').toEqual([]);
});
