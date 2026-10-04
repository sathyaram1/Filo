// Prova del giro 2, rilievo 1 (verifica locale, letture-delta): gli unit del giro dei cambiati con l'orologio
// spostato devono essere verdi a ogni corsa, o la fusione locale si ferma. Non apre Filo.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('gli unit dell\'ora del server passano in cinque corse di fila', async () => {
  test.setTimeout(180000);
  const rossi = [];
  for (let i = 0; i < 5; i += 1) {
    const r = spawnSync(process.execPath, ['--test', 'tests/unit/feedbackGiroOraServer.test.mjs'], { cwd: ROOT, encoding: 'utf8' });
    for (const riga of String(r.stdout || '').split('\n')) if (/^not ok/.test(riga)) rossi.push(`corsa ${i + 1}: ${riga}`);
  }
  expect(rossi, 'casi rossi').toEqual([]);
});
