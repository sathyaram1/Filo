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

test('il classificatore della ricerca mai impostato parte con Jev; svuotato resta spento (#1118)', async () => {
  for (const getter of [cfg({ manageSearchClassifier: null }), async () => null, async () => { throw new Error('giù'); }]) {
    const s = await settingsForOwnerAction(EFFECTIVE, A.MANAGE_SEARCH_CLASSIFY, getter);
    assert.equal(s.models[A.MANAGE_SEARCH_CLASSIFY], 'typesafe/jev-1.13');
    const attempts = C.buildModelAttempts(C.parseModelRefs(s.models[A.MANAGE_SEARCH_CLASSIFY]), s.modelRegistry, ['openrouter'], s.apiKeys);
    assert.deepEqual(attempts.map((a) => a.model), ['typesafe/jev-1.13']);
  }
  const spento = await settingsForOwnerAction(EFFECTIVE, A.MANAGE_SEARCH_CLASSIFY, cfg({ manageSearchClassifier: '' }));
  assert.equal(spento.models[A.MANAGE_SEARCH_CLASSIFY], '');
  const scelto = await settingsForOwnerAction(EFFECTIVE, A.MANAGE_SEARCH_CLASSIFY, cfg({ manageSearchClassifier: 'altro/clf' }));
  assert.equal(scelto.models[A.MANAGE_SEARCH_CLASSIFY], 'altro/clf');
  // Una scelta già fatta per quella funzione fuori dallo slot vince sulla scelta iniziale.
  const prima = { ...EFFECTIVE, models: { ...EFFECTIVE.models, [A.MANAGE_SEARCH_CLASSIFY]: 'mio/clf' } };
  assert.equal((await settingsForOwnerAction(prima, A.MANAGE_SEARCH_CLASSIFY, cfg({}))).models[A.MANAGE_SEARCH_CLASSIFY], 'mio/clf');
  // L'editor mostra quello che la ricerca usa davvero, come lettura e non come scelta.
  const ed = fillMovedSlots({ manageSearch: '' }, EFFECTIVE);
  assert.equal(ed.manageSearchClassifier, 'typesafe/jev-1.13');
  assert.deepEqual(ed.movedUnset, ['manageSearchClassifier']);
});

test('le funzioni di tutti non leggono gli slot di supporto', async () => {
  let letto = false;
  const s = await settingsForOwnerAction(EFFECTIVE, A.EXPLAIN, async () => { letto = true; return {}; });
  assert.equal(s, EFFECTIVE);
  assert.equal(letto, false);
});

test('l\'editor mostra la catena in uso negli slot spostati mai salvati, e non tocca quelli salvati', () => {
  const mai = fillMovedSlots({ sanitizer: '', manageSearch: null, manageSearchClassifier: '' }, EFFECTIVE);
  assert.equal(mai.manageSearch, 'vecchio');
  assert.equal(mai.sanitizer, '');
  assert.equal(fillMovedSlots({ manageSearch: '' }, EFFECTIVE).manageSearch, '');
  assert.equal(fillMovedSlots({ manageSearch: 'nuovo' }, EFFECTIVE).manageSearch, 'nuovo');
  assert.equal(fillMovedSlots({ manageSearch: null }, null).manageSearch, '');
  // Solo quelli riempiti sono una lettura, non una scelta: l'editor non li riscrive se non cambiano.
  assert.deepEqual(mai.movedUnset, ['manageSearch']);
  assert.deepEqual(fillMovedSlots({ manageSearch: '', manageSearchClassifier: 'jev' }, EFFECTIVE).movedUnset, []);
  // Anche il classificatore della ricerca (#1118) è uno slot dell'app: mai salvato, si legge dalla catena in uso.
  assert.deepEqual(fillMovedSlots({ manageSearch: '' }, EFFECTIVE).movedUnset, ['manageSearchClassifier']);
});

test('lo store distingue lo slot mai scritto (null) da quello svuotato (\'\')', async () => {
  const auth = require(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
  const orig = { token: auth.getIdToken, admin: auth.isAdmin, profilo: auth.getProfile, fetch: global.fetch };
  let campi = {};
  auth.getIdToken = async () => 'finto-id-token';
  auth.isAdmin = () => true;
  auth.getProfile = () => ({ email: 'owner@esempio' });
  global.fetch = async () => ({ ok: true, status: 200, async json() { return { fields: campi }; }, async text() { return ''; } });
  try {
    SupportModels.invalidaCache();
    campi = { sanitizer: { stringValue: 'kimi' } };
    assert.equal((await SupportModels.get()).manageSearch, null);
    SupportModels.invalidaCache();
    campi = { manageSearch: { stringValue: '' } };
    assert.equal((await SupportModels.get()).manageSearch, '');
    SupportModels.invalidaCache();
    campi = { manageSearch: { stringValue: 'cerca' } };
    assert.equal((await SupportModels.get()).manageSearch, 'cerca');
  } finally {
    auth.getIdToken = orig.token; auth.isAdmin = orig.admin; auth.getProfile = orig.profilo; global.fetch = orig.fetch;
    SupportModels.invalidaCache();
  }
});
