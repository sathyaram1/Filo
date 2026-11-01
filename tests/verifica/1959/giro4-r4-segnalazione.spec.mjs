// Verifica #1959 giro 4, r4: una riga riscritta dal redattore che nasce da una riga con la segnalazione ne tiene il
// numero, o il tasto destro nella pagina Novità non apre più la segnalazione.
import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r4 la segnalazione della riga d\'origine non si perde nella riscrittura', async () => {
  const { controllaNovita } = await import(pathToFileURL(resolve(REPO, 'scripts', 'manutentore.mjs')).href);
  const blocco = { version: '0.2.256', features: ['Allegare documenti Word in chat.', { testo: 'Le schede si spostano col trascinamento.', segnalazione: 1956 }], fixes: [] };
  const r = controllaNovita({ versione: '0.2.256', features: [{ testo: 'Word in chat, e schede che si trascinano.', da: [1, 2] }] }, { blocco, schede: [] });
  const persa = r.ok && !r.novita.features.some((x) => x && typeof x === 'object' && x.segnalazione === 1956);
  expect(persa, 'la riscrittura passa e la segnalazione 1956 sparisce').toBe(false);
});
