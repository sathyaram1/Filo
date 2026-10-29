// #1680 giro 5, rilievo 5: nel contesto del manutentore una scheda che toglie lavoro («non valido») e che Opus non ha
// riletto, o scritta su una versione vecchia del feedback, non deve presentarsi come una scheda buona.

import { test, expect } from '@playwright/test';
import { testoContesto } from '../../../scripts/manutentore.mjs';

const indice = [
  { id: 'A', num: '812', stato: 'todo', priorita: 1, aggiornato: '2026-10-28T00:00:00Z' },
  { id: 'B', num: '813', stato: 'todo', priorita: 1, aggiornato: '2026-10-28T00:00:00Z' },
];
const scheda = (numero, extra) => ({ numero, titolo_breve: 'Menu', riassunto: 'Il menu non si apre.', tipo: 'bug', area: 'home', valido: 'no', prova: 'già corretto', file_probabili: [], ...extra });
const riga = (testo, n) => testo.split('\n').find((r) => r.startsWith(`#${n} `)).replace(`#${n} `, '#N ');

test('r5 un «non valido» non riletto si distingue da uno riletto', () => {
  const testo = testoContesto({
    ruolo: 'ruolo', indice, rami: [],
    schede: [
      scheda('812', { riletta: 'confermata', _riletta: { at: '2026-10-28T01:00:00Z', modello: 'opus' }, _fonte: { id: 'A', aggiornato: '2026-10-28T00:00:00Z' } }),
      scheda('813', { _fonte: { id: 'B', aggiornato: '2026-10-28T00:00:00Z' } }),
    ],
  });
  expect(riga(testo, '813')).not.toBe(riga(testo, '812'));
});

test('r5 una scheda scritta su una versione vecchia del feedback si distingue da una aggiornata', () => {
  const testo = testoContesto({
    ruolo: 'ruolo', indice, rami: [],
    schede: [
      scheda('812', { valido: 'si', _fonte: { id: 'A', aggiornato: '2026-10-28T00:00:00Z' } }),
      scheda('813', { valido: 'si', _fonte: { id: 'B', aggiornato: '2026-10-01T00:00:00Z' } }),
    ],
  });
  expect(riga(testo, '813')).not.toBe(riga(testo, '812'));
});
