// #947 giro 5: chi chiede «la bolletta della luce di marzo 2025» vuole quella del periodo marzo 2025, anche se la
// bolletta di marzo 2026 nomina il 2025 nello storico dei consumi (come fanno le bollette vere). Logica pura.
import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Ricerca = require('../../../src/main/services/documentiRicerca.js');

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
// Gli ultimi dodici mesi fino a marzo dell'anno della bolletta, come nel grafico «andamento dei consumi».
const storico = (y) => `Storico consumi: ${Array.from({ length: 12 }, (_, k) => `${MESI[(3 + k) % 12]} ${k < 9 ? y - 1 : y} ${100 + k} kWh`).join(' ')}`;
const bolletta = (y) => [
  'Enel Energia S.p.A.', `Bolletta n. 41 del 08/04/${y}`, 'Fornitura di energia elettrica',
  `Totale da pagare entro il 28/04/${y}`, `Periodo di fatturazione: 01/03/${y} - 31/03/${y}`, storico(y),
].join('\n');

test('r2 «marzo 2025» dà la bolletta del periodo marzo 2025, non quella di marzo 2026', () => {
  const docs = [
    { id: 'mar2025', nome: 'a.pdf', data: 1, testo: bolletta(2025) },
    { id: 'mar2026', nome: 'b.pdf', data: 1, testo: bolletta(2026) },
  ];
  for (const q of ['la bolletta della luce di marzo 2025', 'bolletta luce energia elettrica kWh marzo 2025']) {
    for (const ordine of [docs, docs.slice().reverse()]) {
      expect(Ricerca.ordina(ordine, q)[0].id, q).toBe('mar2025');
    }
  }
  // E l'anno in corso continua a dare l'ultima.
  expect(Ricerca.ordina(docs, 'bolletta luce marzo 2026')[0].id).toBe('mar2026');
});
