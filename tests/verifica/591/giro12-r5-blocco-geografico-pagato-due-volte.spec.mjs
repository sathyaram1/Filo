// Verifica #591, giro 12 — la stessa pagina ambigua si paga due volte al riconoscimento del blocco geografico.
// La scheda campiona la pagina appena caricata e di nuovo due secondi dopo; il ricordo si scrive solo quando la risposta
// del modello arriva, quindi con un modello più lento di due secondi il secondo campione richiama il modello.
// Niente Electron: il classificatore è quello vero, il modello è finto e lento.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const Classifier = require_(join(REPO, 'src/main/services/geoBlockClassifier.js'));

const PAGINA = { title: 'Forbidden', text: 'Access denied', statusCode: 403, host: 'video.esempio-giro12.it', url: 'https://video.esempio-giro12.it/v/1' };

test('due campioni della stessa pagina, col primo ancora in viaggio, costano una chiamata sola', async () => {
  const cache = Classifier.createCache();
  let chiamate = 0;
  const complete = async () => {
    chiamate++;
    await new Promise((r) => setTimeout(r, 300));
    return { text: 'geo_block' };
  };
  const primo = Classifier.classify(PAGINA, { complete, cache });
  await new Promise((r) => setTimeout(r, 100));
  const secondo = Classifier.classify(PAGINA, { complete, cache });
  const [a, b] = await Promise.all([primo, secondo]);
  expect(a.class).toBe('geo_block');
  expect(b.class).toBe('geo_block');
  expect(chiamate, 'la stessa pagina non deve pagare due giudizi del modello').toBe(1);
});

test('caso di riscontro: il secondo campione dopo la risposta usa il ricordo', async () => {
  const cache = Classifier.createCache();
  let chiamate = 0;
  const complete = async () => { chiamate++; return { text: 'geo_block' }; };
  await Classifier.classify(PAGINA, { complete, cache });
  const b = await Classifier.classify(PAGINA, { complete, cache });
  expect(b.cached).toBe(true);
  expect(chiamate).toBe(1);
});
