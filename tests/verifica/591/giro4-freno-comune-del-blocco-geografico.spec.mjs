// Verifica #591 — giro 4. Il freno nuovo del riconoscimento del blocco
// geografico ha, accanto al conto di chi possiede il sito, un conto COMUNE a
// tutti i siti: sessanta chiamate per finestra di tempo. Anche questo è una
// risorsa condivisa, e una sola pagina ostile la consuma tutta.
//
// Da lì in poi, per un'ora, il riconoscimento non parte più per NESSUN sito —
// compreso quello legittimo che l'utente apre subito dopo e che il paese
// blocca davvero: la proposta di riaprirlo da un altro paese non arriva, e
// niente lo dice.
//
// Logica pura: la chiamata al modello è finta.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const GB = require_(join(REPO, 'src/main/services/geoBlockClassifier.js'));

// La pagina bloccata dal paese che l'utente apre dopo la raffica.
const LEGITTIMO = {
  statusCode: 403,
  text: 'Questo contenuto non è disponibile nel tuo paese',
  host: 'esempio-tv-591-g4.it',
  url: 'https://esempio-tv-591-g4.it/diretta',
};

function banco() {
  const chiamate = [];
  const complete = async () => { chiamate.push(1); return 'geo_block'; };
  return { chiamate, cache: GB.createCache(), complete };
}

// Una pagina ostile che si porta da sola su percorsi e sotto-indirizzi sempre
// nuovi: ognuno è una risposta ambigua, e ognuno spende un gettone comune.
async function raffica(b, quanti) {
  for (let i = 1; i <= quanti; i++) {
    await GB.classify({
      statusCode: 403,
      text: 'vietato',
      host: `esca-${i}.pages.dev`,
      url: `http://esca-${i}.pages.dev/p${i}`,
    }, { complete: b.complete, cache: b.cache });
  }
}

test('una sola pagina ostile consuma il freno comune e spegne il riconoscimento per tutti', async () => {
  const b = banco();
  await raffica(b, GB.FRENO_TOTALE);
  expect(b.chiamate.length, 'le esche devono consumare davvero il freno comune').toBeGreaterThan(0);

  const r = await GB.classify(LEGITTIMO, { complete: b.complete, cache: b.cache });
  expect(r.rinunciato, 'il sito legittimo non deve pagare il freno consumato da un altro').toBeFalsy();
  expect(r.class, 'il blocco geografico va riconosciuto').toBe(GB.CLASSES.GEO_BLOCK);
  expect(r.route.proxy, 'senza riconoscimento la proposta di riaprirlo da un altro paese non arriva').toBe(true);
});

test('caso di riscontro: col freno intatto lo stesso sito viene riconosciuto', async () => {
  const b = banco();
  const r = await GB.classify(LEGITTIMO, { complete: b.complete, cache: b.cache });
  expect(r.class).toBe(GB.CLASSES.GEO_BLOCK);
  expect(r.route.proxy).toBe(true);
});
