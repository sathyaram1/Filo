// Giro 2, rilievo 1: i compiti figli di un lavoro (§ 12.2) non stanno nel capitolo dei compiti, che vieta più di un
// compito aperto per feedback. Chi costruisce i compiti dal § 6 scrive una sentinella che poi li respinge. Non apre Filo.
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

test('r1 se un lavoro chiede compiti figli, il capitolo dei compiti dice da dove nascono e come stanno col compito aperto unico', () => {
  test.skip(!/compiti\s+figli/.test(sezione('### 12.2')), 'il § 12.2 non parla più di compiti figli');
  const s61 = sezione('### 6.1');
  expect(s61, 'il § 6.1 deve nominare i compiti figli fra le origini').toMatch(/figli/i);
  const invariante = s61.split(/\n\n/).find((p) => /al massimo un compito aperto/i.test(p)) || '';
  expect(invariante, 'l\'invariante deve dire come contano i figli').toMatch(/figli/i);
});
