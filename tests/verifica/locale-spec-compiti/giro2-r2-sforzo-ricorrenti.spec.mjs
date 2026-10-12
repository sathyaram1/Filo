// Giro 2, rilievo 2: il ricorrente porta modello e sforzo, ma la tabella dei ricorrenti dà solo il modello iniziale.
// Il compito decide modello e sforzo (decisione del 12/10): manca il valore di partenza dello sforzo. Non apre Filo.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const spec = () => readFileSync(join(ROOT, 'SPEC-DOMANDE.md'), 'utf8').replace(/\r\n/g, '\n');
const sezione = (titolo) => {
  const t = spec();
  const i = t.indexOf(titolo);
  if (i < 0) throw new Error(`sezione assente: ${titolo}`);
  const resto = t.slice(i + titolo.length);
  const fine = resto.search(/\n#{2,3} /);
  return fine < 0 ? resto : resto.slice(0, fine);
};

test('r2 ogni ricorrente della tabella ha uno sforzo iniziale accanto al modello', () => {
  const s = sezione('### 4.1');
  const righe = s.split('\n').filter((l) => /^\| (ogni giorno|lunedì|domenica)/.test(l));
  expect(righe.length).toBeGreaterThan(0);
  const intestazione = s.split('\n').find((l) => l.startsWith('| Quando')) || '';
  const conColonna = /sforzo/i.test(intestazione);
  for (const r of righe) {
    if (!conColonna) expect(r, `sforzo iniziale per: ${r}`).toMatch(/\b(low|medium|high|xhigh|max)\b/);
  }
  expect(conColonna || righe.every((r) => /\b(low|medium|high|xhigh|max)\b/.test(r))).toBe(true);
});
