// Giro 1 della verifica #1249: le parti nuove della gestione del lavoro (esperimenti, rapporti delle
// istanze) devono stare con il resto della spec: urgenza, segnalazioni, rimandi. Non apre Filo.
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

test('r2 gli esperimenti e il loro giudice cieco hanno un\'urgenza come ogni altro compito', () => {
  const urgenza = sezione('### 6.3');
  expect(urgenza).toMatch(/esperiment/i);
  expect(urgenza).toMatch(/giudic/i);
});

test('r3 la segnalazione libera e la domanda di fine turno dicono cosa vale per un esperimento, che non apre feedback né domande', () => {
  const segnalazioni = sezione('### 5.4');
  const esperimenti = sezione('### 4.6');
  expect(/esperiment/i.test(segnalazioni) || /segnal|fine turno/i.test(esperimenti)).toBe(true);
});

test('r4 il rapporto con cui chiude ogni istanza rimanda a una sezione che lo descrive', () => {
  const ricorrenti = sezione('### 4.1');
  const m = ricorrenti.match(/chiude con un rapporto \(§ (\d+\.\d+)\)/);
  if (!m) return;
  expect(sezione(`### ${m[1]}`)).toMatch(/istanz[ae] successiv|alla successiva|prossima istanza|ogni istanza/i);
});
