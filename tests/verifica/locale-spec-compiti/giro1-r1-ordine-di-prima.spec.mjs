// Giro 1, rilievo 1: fuori dal capitolo dei compiti la spec tiene ancora l'ordine di prima del 12/10.
// Chi lavora un punto legge solo la sua sezione: lì la regola deve essere quella decisa. Non apre Filo.
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

test('r1 nella fiducia la precedenza dei rami in revisione non «resta» contro la priorità 3', () => {
  // Con quella regola un feedback a priorità 0 in verifica passa davanti a uno nuovo a priorità 3.
  expect(sezione('### 1.6')).not.toMatch(/REVIEW_RANK`?\)?\s+resta\b/);
});

test('r1 il punto 1 dell\'ordine di lavoro non costruisce uno spareggio senza dire che il punto 5 lo sostituisce', () => {
  const ordine = sezione('## 13. Ordine di lavoro');
  const punto1 = ordine.split(/\n(?=\d+\. )/).find((p) => /^1\. /.test(p.trim())) || '';
  expect(punto1).toBeTruthy();
  if (/spareggio/i.test(punto1)) expect(punto1).toMatch(/provvisori|fino al punto 5|§ 6\.3|urgenza/i);
});

test('r1 nei crediti l\'ordine di spesa non mette i compiti fidati davanti ai feedback a priorità 3', () => {
  expect(sezione('### 8.2')).not.toMatch(/1\.\s+i compiti fidati[\s\S]*?2\.\s+i feedback per priorità/);
});

test('r1 nei dati della fiducia il campo sta anche sui compiti', () => {
  const dati = sezione('### 1.7');
  const voce = dati.split('\n').find((l) => l.includes('`fiducia` su')) || '';
  expect(voce).toMatch(/compiti/);
});
