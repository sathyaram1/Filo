// Verifica #1343 giro 17, rilievo 2: la prova dell'app «un'icona spostata lascia l'azione nel filo» (arrivata con #1561)
// sposta l'icona con un messaggio che il ramo ha tolto, ed è rossa. Ogni messaggio che manda deve esistere ancora.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('r2 i messaggi che la prova delle azioni nel filo manda a Filo esistono ancora', () => {
  const prova = readFileSync('tests/filo-accaduti.spec.mjs', 'utf8');
  const messaggi = readFileSync('src/shared/messages.js', 'utf8');
  const mandati = [...prova.matchAll(/manda\(\w+, \{ type: '([a-z_]+)'/g)].map((m) => m[1]);
  expect(mandati.length).toBeGreaterThan(0);
  const spariti = mandati.filter((t) => !messaggi.includes(`'${t}'`));
  expect(spariti, 'messaggi che Filo non conosce più').toEqual([]);
});
