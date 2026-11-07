// #1097.3 — il filtro della ricerca dei mazzi a servizio occupato: le sue attese contano anche quelle che ogni chiamata
// fa già da sé, e un lotto tagliato o rifiutato per il tetto non si ripaga.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/chatErrors.js');
require('../../src/shared/scryfallQuery.js');
require('../../src/shared/deckOpinions.js');
globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
require('../../src/main/services/deckOpinions.js');
const S = globalThis.SN_DECK_OPINIONS_SVC;

const carte = { a: { id: 'a', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' } };
const filtra = (handleAIRequest) => S.filterSearch({ criterion: 'artefatti', cardIds: ['a'], cards: carte, handleAIRequest });

test('un servizio occupato che fa già aspettare ogni chiamata non allunga le attese oltre quelle previste', async () => {
  const ora = Date.now;
  let avanti = 0;
  Date.now = () => ora() + avanti;
  let chiamate = 0;
  try {
    const r = await filtra(async () => {
      chiamate += 1;
      // Ogni chiamata ha già ritentato da sé dopo l'attesa chiesta dal servizio.
      avanti += 6000;
      throw Object.assign(new Error('OpenRouter 429: rate limited'), { status: 429 });
    });
    assert.ok(r.error, 'il servizio giù si dice');
    assert.ok(chiamate <= 3, `chiamate: ${chiamate}`);
  } finally {
    Date.now = ora;
  }
});

test('un lotto fermato dal tetto della risposta non si ripaga', async () => {
  let chiamate = 0;
  const r = await filtra(async () => {
    chiamate += 1;
    throw globalThis.SN_CHAT_ERRORS.erroreTagliata('length');
  });
  assert.equal(chiamate, 1);
  assert.equal(r.error.code, 'RISPOSTA_TAGLIATA');
});

// #1302: venti lotti a servizio occupato. Deciso che è giù, i lotti rimasti non chiamano più (prima ognuno faceva la sua
// chiamata con la sua attesa: cinquanta-ottanta secondi prima di dirlo), e le loro carte restano non controllate.
test('a servizio giù i lotti rimasti non chiamano più', async () => {
  const molte = {};
  for (let i = 0; i < 1000; i++) molte[`c${i}`] = { id: `c${i}`, name: `Carta ${i}`, type_line: 'Artifact', oracle_text: '{T}: Add {C}.' };
  const ora = Date.now;
  let avanti = 0;
  Date.now = () => ora() + avanti;
  let chiamate = 0;
  try {
    const r = await S.filterSearch({
      criterion: 'artefatti che danno mana', cardIds: Object.keys(molte), cards: molte,
      handleAIRequest: async ({ signal }) => {
        chiamate += 1;
        avanti += 6000;
        await new Promise((ok) => setTimeout(ok, 20));
        if (signal && signal.aborted) throw Object.assign(new Error('fermata'), { name: 'AbortError' });
        throw Object.assign(new Error('OpenRouter 429: rate limited'), { status: 429 });
      },
    });
    assert.ok(r.error, 'il servizio giù si dice');
    assert.equal(r.unverifiedIds.length, 1000, 'nessuna carta sparisce');
    assert.ok(chiamate < 20, `chiamate: ${chiamate}`);
  } finally {
    Date.now = ora;
  }
});
