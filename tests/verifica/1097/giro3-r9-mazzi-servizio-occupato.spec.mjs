// #1097 giro 3 — la ricerca dei mazzi col servizio occupato dice che è giù entro le attese previste (circa quindici
// secondi), anche su una ricerca larga in cui ogni chiamata spende già la sua attesa dentro il fornitore.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/constants.js');
require('../../../src/shared/chatErrors.js');
require('../../../src/shared/scryfallQuery.js');
require('../../../src/shared/deckOpinions.js');
globalThis.chrome = globalThis.chrome || { storage: { local: { get: async () => ({}), set: async () => {} } } };
require('../../../src/main/services/deckOpinions.js');
const S = globalThis.SN_DECK_OPINIONS_SVC;

test('r9 ricerca larga a servizio occupato: smette entro mezzo minuto e non chiama per ogni lotto rimasto', async () => {
  test.setTimeout(150_000);
  const cards = {}; const ids = [];
  for (let i = 0; i < 1050; i++) { const id = `c${i}`; ids.push(id); cards[id] = { id, name: `Card ${i}`, type_line: 'Artifact', oracle_text: `x${i}` }; }
  let chiamate = 0;
  const inizio = Date.now();
  const r = await S.filterSearch({
    criterion: 'artefatti che danno mana', cardIds: ids, cards,
    handleAIRequest: async () => {
      chiamate += 1;
      // Il ritentativo dentro il fornitore spende il Retry-After di qualche secondo prima di arrendersi.
      await new Promise((ok) => setTimeout(ok, 3000));
      throw Object.assign(new Error('OpenRouter 429: rate limited'), { status: 429 });
    },
  });
  expect(r.error).toBeTruthy();
  expect(Date.now() - inizio).toBeLessThan(30_000);
});
