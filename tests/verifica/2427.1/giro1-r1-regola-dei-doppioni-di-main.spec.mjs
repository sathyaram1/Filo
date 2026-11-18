// Prova del giro 1 su #2427.1: mentre il ramo univa le due copie della chiusura «già risolto», main ha cambiato la
// regola dei doppioni in tutte e due (riconsegna una volta, fusione dopo l'ultima riapertura). Il pezzo condiviso
// deve portarla, e solo lui: né persa nel riallineamento, né rientrata come copia in uno dei due ruoli.

import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRoleInstructions } from '../../../scripts/dispatch.mjs';

const RUOLI = join(dirname(fileURLToPath(import.meta.url)), '../../../routines/roles');
const piatto = (t) => t.replace(/\s+/g, ' ');

test('r1 primo lavoro e ripresa ricevono la regola dei doppioni di main, una volta', () => {
  for (const [chi, testo] of [['primo lavoro', readRoleInstructions('new-work')], ['ripresa', readRoleInstructions('fixer', { caso: 'ripresa' })]]) {
    const t = piatto(testo);
    expect((t.match(/riconsegna una volta/g) || []).length, `${chi}: riconsegna con la fusione indicata dal server`).toBe(1);
    expect((t.match(/dopo l'ultima riapertura/g) || []).length, `${chi}: fusione dopo l'ultima riapertura`).toBe(1);
  }
});

test('r1 la regola dei doppioni sta solo nel pezzo condiviso', () => {
  const dove = readdirSync(RUOLI).filter((n) => n.endsWith('.md'))
    .filter((n) => piatto(readFileSync(join(RUOLI, n), 'utf8')).includes('riconsegna una volta'));
  expect(dove).toEqual(['_chiudi-gia-risolto.md']);
});
