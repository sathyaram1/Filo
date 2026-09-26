// Giro 1 della verifica di «rilievi dello snellimento»: i tre rilievi restano chiusi.
// Non apre Filo: si leggono i testi che ogni agente riceve e le sentinelle.
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leggi = (p) => readFileSync(join(ROOT, p), 'utf8');
const PATTERN = 'patterns/le-prove-di-un-giro-stanno-nel-ramo-e-la-cartella-si-svuota.md';

test('la consegna dice quale testo è privato e quale in chiaro, e che il buco di sicurezza sta solo nel privato', () => {
  const claude = leggi('CLAUDE.md');
  const consegna = claude.slice(claude.indexOf('## Consegna'), claude.indexOf('## Fonti'));
  const report = consegna.slice(consegna.indexOf('Report per l'), consegna.indexOf('Frase per chi'));
  const frase = consegna.slice(consegna.indexOf('Frase per chi'), consegna.indexOf('Riga di changelog'));
  expect(report).toMatch(/cifrat/i);
  expect(frase).toMatch(/in chiaro/i);
  expect(frase).toMatch(/sicurezza/i);
});

test('le sentinelle delle prove dei giri rimandano al file di pattern, che esiste', () => {
  expect(existsSync(join(ROOT, PATTERN))).toBe(true);
  for (const f of ['tests/unit/proveDeiGiri.test.mjs', 'tests/helpers/proveDeiGiri.mjs']) {
    const testo = leggi(f);
    expect(testo, f).toContain(PATTERN);
    expect(testo, f).not.toMatch(/CLAUDE\.md\s*§\s*Verifica/);
  }
});
