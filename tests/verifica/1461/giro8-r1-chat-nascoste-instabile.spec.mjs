// Verifica #1461 giro 8, rilievo 1: la prova «nascondere e rimettere una conversazione dal tasto destro contano
// l'attesa dell'azione» fa il clic destro sulla bolla appena compare, mentre la home la sposta ancora di circa 200 px:
// il clic cade nel vuoto e il menu non si apre (3 volte su 10 nel contenitore). Qui la si ripete: rossa finché è instabile.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('r1 la prova del tasto destro sulle conversazioni passa dieci volte su dieci', async () => {
  test.setTimeout(420_000);
  const r = spawnSync('npx', ['playwright', 'test', 'tests/chat-nascoste.spec.mjs', '-g', 'contano l’attesa dell’azione',
    '--repeat-each=10', '--retries=0', '--reporter=line'], { cwd: RADICE, encoding: 'utf8', timeout: 400_000, env: process.env });
  const uscita = `${r.stdout || ''}${r.stderr || ''}`;
  const falliti = (uscita.match(/(\d+) failed/) || [])[1] || '0';
  expect(falliti, uscita.slice(-1500)).toBe('0');
  expect(r.status, uscita.slice(-1500)).toBe(0);
});
