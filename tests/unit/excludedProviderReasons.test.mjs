// Fornitori esclusi (#541): il perché di ogni voce viaggia e torna, e un nome
// che non copre nessun fornitore dello smistatore (un refuso) si riconosce.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'tests', 'fixtures', 'testModels.js'));
const Defaults = require(join(ROOT, 'src', 'main', 'services', 'defaultsStore.js'));
const auth = require(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
const C = globalThis.SN_CONST;

const CATALOG = [
  { name: 'NovitaAI', slug: 'novita' },
  { name: 'Google Vertex', slug: 'google-vertex' },
  { name: 'Google AI Studio', slug: 'google-ai-studio' },
  { name: 'Together', slug: 'together' },
  { name: 'Z.AI', slug: 'z-ai' },
];

test('ogni voce di serie ha un motivo, e Novita è fra chi serve male', () => {
  const reasons = C.excludedProviderReasons(C.DEFAULT_EXCLUDED_PROVIDERS, [], C.DEFAULT_EXCLUDED_PROVIDER_REASONS);
  assert.equal(reasons.length, C.DEFAULT_EXCLUDED_PROVIDERS.length);
  for (const r of reasons) assert.ok(C.EXCLUDED_PROVIDER_KINDS.includes(r.kind), `${r.name} senza motivo`);
  assert.equal(reasons.find((r) => r.name === 'Novita').kind, 'unreliable');
  assert.equal(reasons.find((r) => r.name === 'Google').kind, 'producer');
});

test('il motivo scritto dall\'owner vince su quello di serie, a prescindere dalle maiuscole', () => {
  const r = C.excludedProviderReasons(['novita', 'Nuovo'], [
    { name: 'NOVITA', kind: 'producer', note: '  cambiato  ' },
    { name: 'nuovo', kind: 'inventato', note: 42 },
  ], C.DEFAULT_EXCLUDED_PROVIDER_REASONS);
  assert.deepEqual(r, [
    { name: 'novita', kind: 'producer', note: 'cambiato' },
    { name: 'Nuovo', kind: '', note: '' },
  ]);
});

test('un nome che copre un fornitore del catalogo, per nome o per slug, vale', () => {
  assert.equal(C.providerCoversCatalog('Google', CATALOG), true);
  assert.equal(C.providerCoversCatalog('novita', CATALOG), true);
  assert.equal(C.providerCoversCatalog('Z.AI', CATALOG), true);
});

test('un refuso non copre niente e ha la correzione suggerita', () => {
  assert.equal(C.providerCoversCatalog('Novtia', CATALOG), false);
  assert.equal(C.closestCatalogProvider('Novtia', CATALOG), 'NovitaAI');
  assert.equal(C.closestCatalogProvider('Togther', CATALOG), 'Together');
  // Troppo lontano da tutto: meglio nessun suggerimento che uno a caso.
  assert.equal(C.closestCatalogProvider('Qwen', CATALOG), '');
  assert.equal(C.closestCatalogProvider('x'.repeat(10000), CATALOG), '');
  assert.equal(C.providerCoversCatalog('   ', CATALOG), false);
});

test('col catalogo, il nome del catalogo copre la voce del codice che esclude lo stesso fornitore', () => {
  // «NovitaAI» è ciò che il menu e il «Forse …?» scrivono per Novita.
  assert.deepEqual(C.missingExcludedProviders(['Novita'], ['NovitaAI'], CATALOG), []);
  assert.deepEqual(C.missingExcludedProviders(['Novita'], ['novita'], CATALOG), []);
  // Coprire una parte dei fornitori della voce non basta.
  assert.deepEqual(C.missingExcludedProviders(['Google'], ['Google Vertex'], CATALOG), ['Google']);
  assert.deepEqual(C.missingExcludedProviders(['Google'], ['Google Vertex', 'Google AI Studio'], CATALOG), []);
  // Un altro fornitore non copre niente; una voce assente dal catalogo resta alla regola del nome.
  assert.deepEqual(C.missingExcludedProviders(['Novita'], ['Together'], CATALOG), ['Novita']);
  assert.deepEqual(C.missingExcludedProviders(['Qwen'], ['NovitaAI'], CATALOG), ['Qwen']);
  // Senza catalogo vale la regola del nome di sempre.
  assert.deepEqual(C.missingExcludedProviders(['Novita'], ['NovitaAI']), ['Novita']);
});

test('i motivi si salvano in un campo a parte e tornano nella config dell\'editor', async () => {
  const realFetch = global.fetch;
  const realToken = auth.getIdToken;
  const server = { fields: {} };
  let lastMask = '';
  auth.getIdToken = async () => 'tok';
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('config/models') && opts && opts.method === 'PATCH') {
      lastMask = u;
      Object.assign(server.fields, JSON.parse(opts.body).fields);
      return { ok: true, status: 200, async json() { return {}; }, async text() { return ''; } };
    }
    if (u.includes('config/models')) return { ok: true, status: 200, async json() { return server; } };
    return { ok: true, status: 200, async json() { return { fields: {} }; }, async text() { return ''; } };
  };
  try {
    const cfg = await Defaults.update({
      excludedProviderReasons: [
        { name: 'Novita', kind: 'unreliable', note: 'risposte scambiate' },
        { name: '  ', kind: 'producer' },
      ],
    }, 'tok');
    assert.ok(lastMask.includes('excludedProviderReasons'));
    assert.ok(!lastMask.includes('fieldPaths=excludedProviders&') && !/fieldPaths=excludedProviders$/.test(lastMask),
      'toccare solo i motivi non deve riscrivere la lista');
    const novita = cfg.excludedProviderReasons.find((r) => r.name === 'Novita');
    assert.deepEqual(novita, { name: 'Novita', kind: 'unreliable', note: 'risposte scambiate' });
    assert.equal(cfg.excludedProviderReasons.find((r) => r.name === 'Google').kind, 'producer');
    // La lista dei nomi resta un array di stringhe: i client che leggono solo quella non cambiano.
    assert.ok(cfg.excludedProviders.every((x) => typeof x === 'string'));
  } finally {
    global.fetch = realFetch;
    auth.getIdToken = realToken;
  }
});
