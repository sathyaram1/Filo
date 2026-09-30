// La ricerca fra i feedback prende il modello da Gestione → Modelli di supporto
// (#465): slot impostato → quella catena, sul registro dei giudici sopra a
// quello effettivo; slot mai impostato → la scelta di prima; vuoto → nessuno.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SHARED = join(ROOT, 'src', 'shared');

require(join(SHARED, 'constants.js'));
require(join(SHARED, 'modelUsage.js'));
const C = globalThis.SN_CONST;
const A = C.ACTIONS;
const { settingsForOwnerAction, fillMovedSlots } = require(join(ROOT, 'src', 'main', 'services', 'resolveSupportModel.js'));
const SupportModels = require(join(ROOT, 'src', 'main', 'services', 'supportModelsStore.js'));

const EFFECTIVE = {
  apiKeys: { openrouter: 'k' },
  models: { [A.MANAGE_SEARCH]: 'vecchio', [A.EXPLAIN]: 'spiega' },
  modelRegistry: {
    vecchio: { provider: 'openrouter', model: 'vendor/vecchio' },
    comune: { provider: 'openrouter', model: 'vendor/comune' },
  },
};
const cfg = (over) => async () => ({ judgeRegistry: {}, ...over });

test('slot impostato: la ricerca usa la catena dello slot, risolta anche sul registro dei giudici', async () => {
  const s = await settingsForOwnerAction(EFFECTIVE, A.MANAGE_SEARCH, cfg({
    manageSearch: ' cerca, comune ',
    judgeRegistry: { cerca: { provider: 'openrouter', model: 'vendor/cerca' } },
  }));
  assert.equal(s.models[A.MANAGE_SEARCH], 'cerca, comune');
  const attempts = C.buildModelAttempts(C.parseModelRefs(s.models[A.MANAGE_SEARCH]), s.modelRegistry, ['openrouter'], s.apiKeys);
  assert.deepEqual(attempts.map((a) => a.model), ['vendor/cerca', 'vendor/comune']);
  // Le altre funzioni non si accorgono di niente.
  assert.equal(s.models[A.EXPLAIN], 'spiega');
  assert.equal(EFFECTIVE.models[A.MANAGE_SEARCH], 'vecchio', 'le impostazioni di partenza non si toccano');
});

test('il registro dei giudici vince su un nickname omonimo, come sul server', async () => {
  const s = await settingsForOwnerAction(EFFECTIVE, A.MANAGE_SEARCH, cfg({
    manageSearch: 'comune',
    judgeRegistry: { comune: { provider: 'openrouter', model: 'vendor/dei-giudici' } },
  }));
  assert.equal(s.modelRegistry.comune.model, 'vendor/dei-giudici');
});

test('slot mai impostato (null) o config illeggibile: resta la scelta fatta prima dello spostamento', async () => {
  for (const getter of [cfg({ manageSearch: null }), async () => null, async () => { throw new Error('giù'); }]) {
    const s = await settingsForOwnerAction(EFFECTIVE, A.MANAGE_SEARCH, getter);
    assert.equal(s.models[A.MANAGE_SEARCH], 'vecchio');
  }
});

test('slot svuotato di proposito: nessun modello, la scelta di prima non ritorna', async () => {
  const s = await settingsForOwnerAction(EFFECTIVE, A.MANAGE_SEARCH, cfg({ manageSearch: '' }));
  assert.equal(s.models[A.MANAGE_SEARCH], '');
});

test('le funzioni di tutti non leggono gli slot di supporto', async () => {
  let letto = false;
  const s = await settingsForOwnerAction(EFFECTIVE, A.EXPLAIN, async () => { letto = true; return {}; });
  assert.equal(s, EFFECTIVE);
  assert.equal(letto, false);
});

test('l\'editor mostra la catena in uso negli slot spostati mai salvati, e non tocca quelli salvati', () => {
  const vuoto = SupportModels.__test ? null : null; // lo store non si interroga: basta la forma di get()
  void vuoto;
  const mai = fillMovedSlots({ sanitizer: '', manageSearch: null }, EFFECTIVE);
  assert.equal(mai.manageSearch, 'vecchio');
  assert.equal(mai.sanitizer, '');
  assert.equal(fillMovedSlots({ manageSearch: '' }, EFFECTIVE).manageSearch, '');
  assert.equal(fillMovedSlots({ manageSearch: 'nuovo' }, EFFECTIVE).manageSearch, 'nuovo');
  assert.equal(fillMovedSlots({ manageSearch: null }, null).manageSearch, '');
});
