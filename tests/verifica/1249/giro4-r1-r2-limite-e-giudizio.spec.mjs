// Giro 4 della verifica #1249: la scelta dell'owner (D-107, opzione C) è scritta come limite deciso, e il
// giudice cieco degli esperimenti ha un ambito suo nella tabella. Non apre Filo.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const spec = () => readFileSync(join(ROOT, 'SPEC-DOMANDE.md'), 'utf8').replace(/\r\n/g, '\n');
const sezione = (titolo) => {
  const t = spec();
  const i = t.indexOf(`\n${titolo}`);
  if (i < 0) throw new Error(`sezione assente: ${titolo}`);
  const resto = t.slice(i + titolo.length + 1);
  const fine = resto.search(/\n#{2,3} /);
  return (fine < 0 ? resto : resto.slice(0, fine)).replace(/\s+/g, ' ');
};

test('r1 il lavoro su un feedback riservato è un limite deciso, non un punto aperto', () => {
  const regole = sezione('### 5.1');
  expect(regole).not.toMatch(/da decidere dall'owner|punto aperto/i);
  expect(regole).toMatch(/Limite accettato dall'owner/);
  expect(regole).toMatch(/ingannati due agenti/);
});

test('r2 il giudice cieco degli esperimenti lavora con un ambito della tabella', () => {
  const esperimenti = sezione('### 4.6');
  const m = esperimenti.match(/giudice cieco, un compito con ambito `(\w+)`/);
  expect(m, 'ambito del giudice nel § 4.6').toBeTruthy();
  const riga = spec().split('\n').find((l) => l.startsWith(`| \`${m[1]}\``));
  expect(riga, `riga dell'ambito \`${m[1]}\` nel § 5.2`).toBeTruthy();
});
