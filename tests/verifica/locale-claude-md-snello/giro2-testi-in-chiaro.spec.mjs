// Giro 2 della verifica di «CLAUDE.md snello»: chi consegna deve sapere quale dei testi resta privato.
// Non apre Filo: si leggono i testi che ogni agente riceve (CLAUDE.md, pattern, ruoli).
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leggi = (p) => readFileSync(join(ROOT, p), 'utf8');
const cartella = (d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith('.md')).map((f) => leggi(join(d, f)));
const tutto = () => [leggi('CLAUDE.md'), ...cartella('routines/roles')].join('\n');

test('i testi di consegna dicono che il report per l\'owner è cifrato e la frase per chi ha segnalato no', () => {
  expect(tutto(), 'il report per l\'owner è privato: la regola è sparita').toMatch(/owner[^\n]{0,40}cifrat|cifrat[oa][^\n]{0,40}solo lui/i);
  expect(tutto(), 'la frase per chi ha segnalato viaggia in chiaro: la regola è sparita')
    .toMatch(/segnalato[^\n]{0,40}in chiaro|in chiaro[^\n]{0,60}segnalato/i);
});
