// Verifica #1959 giro 5, r2: una riga dei worker con la segnalazione non sparisce dalla riscrittura del redattore:
// o la tiene una riga riscritta (che ne porta il numero), o la riscrittura si rifiuta.
import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r2 una riga con la segnalazione non coperta da nessuna riga riscritta non passa', async () => {
  const { controllaNovita } = await import(pathToFileURL(resolve(REPO, 'scripts', 'manutentore.mjs')).href);
  const blocco = {
    version: '0.2.256',
    features: ['Allegare documenti Word in chat.', { testo: 'Le schede si spostano col trascinamento.', segnalazione: 1956 }],
    fixes: [{ testo: 'Il menu del tasto destro non si chiude più da solo.', segnalazione: 1940 }],
  };
  const r = controllaNovita({ versione: '0.2.256', features: [{ testo: 'Word in chat.', da: [1] }] }, { blocco, schede: [] });
  const tenute = r.ok ? [...r.novita.features, ...r.novita.fixes].map((x) => (x && typeof x === 'object' ? x.segnalazione : null)) : [1956, 1940];
  expect(tenute.filter(Boolean).sort(), 'la riscrittura passa e le segnalazioni 1940 e 1956 spariscono dalle Novità').toEqual([1940, 1956]);
});
