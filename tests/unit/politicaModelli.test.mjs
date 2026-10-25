// La politica sui modelli è una sola (#1520): il server la incorpora col bake per giudicare il consumo delle chiavi dei
// crediti, l'app la applica prima della chiamata. Qui: gira da sola come sul server, le pagine la caricano prima di
// constants.js, SN_CONST espone le stesse funzioni, e il giudizio sull'uso riconosce i casi della segnalazione.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = join(ROOT, 'src', 'shared', 'politicaModelli.js');
require(join(ROOT, 'src', 'shared', 'constants.js'));
const C = globalThis.SN_CONST;
const P = globalThis.SN_POLITICA_MODELLI;

test('gira da sola, come quando il server la incorpora: niente require, niente altri moduli', () => {
  const sorgente = readFileSync(FILE, 'utf8');
  assert.doesNotMatch(sorgente, /\brequire\s*\(/, 'un require spegne il bake del server');
  const altri = [...new Set(sorgente.match(/\bSN_[A-Z_]+/g))].filter((n) => n !== 'SN_POLITICA_MODELLI');
  assert.deepEqual(altri, [], 'il server non ha gli altri moduli dell\'app');
  const sb = {};
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(sorgente, sb);
  const S = sb.SN_POLITICA_MODELLI;
  assert.equal(S.creditsUsageViolation({ model: 'openai/gpt-5', provider: 'Azure' }), 'model');
  assert.equal(S.creditsUsageViolation({ model: 'deepseek/deepseek-v4-pro', provider: 'DeepInfra' }), '');
});

function pagine(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) pagine(p, acc);
    else if (e.endsWith('.html')) acc.push(p);
  }
  return acc;
}

test('ogni pagina che carica constants.js carica prima la politica sui modelli', () => {
  const con = pagine(join(ROOT, 'src')).filter((p) => readFileSync(p, 'utf8').includes('shared/constants.js'));
  assert.ok(con.length > 10, `trovate solo ${con.length} pagine: la ricerca non legge più le sue fonti`);
  for (const p of con) {
    const html = readFileSync(p, 'utf8');
    const politica = html.indexOf('shared/politicaModelli.js');
    assert.ok(politica >= 0 && politica < html.indexOf('shared/constants.js'),
      `${relative(ROOT, p)}: senza politicaModelli.js prima di constants.js la pagina non ha SN_CONST`);
  }
});

test('SN_CONST espone le stesse funzioni e le stesse liste, non una copia', () => {
  for (const nome of ['DEFAULT_EXCLUDED_PROVIDERS', 'normalizeProviderName', 'isProviderExcluded', 'PRODUCER_ONLY_MODELS',
    'producerOnlyRule', 'servedPolicyViolation', 'NARROW_MODEL_PRODUCERS', 'PRODUCER_DIRECT_PROVIDERS',
    'OPEN_WEIGHT_MODEL_FAMILIES', 'registraCatalogoPesi', 'registraCaricatoreCatalogo', 'aggiornaCatalogoPesi',
    'isOpenWeightsModelId', 'isOpenWeightsEntry', 'creditsAllowModel', 'creditsAllowModelLetto']) {
    assert.equal(C[nome], P[nome], nome);
  }
});

test('l\'uso pagato coi crediti: modello chiuso da un rivenditore, produttore che serve i suoi pesi, Anthropic fuori casa', () => {
  const v = (model, provider, excluded) => P.creditsUsageViolation({ model, provider }, excluded);
  assert.equal(v('openai/gpt-5', 'Azure'), 'model', 'GPT da Azure: il guardrail per fornitore non lo ferma');
  assert.equal(v('openai/gpt-5', 'OpenAI'), 'model');
  assert.equal(v('deepseek/deepseek-v4-pro', 'DeepInfra'), '');
  assert.equal(v('deepseek/deepseek-v4-pro', 'DeepSeek'), 'excluded');
  assert.equal(v('google/gemma-4-31b-it', 'Google Vertex'), 'excluded');
  assert.equal(v('anthropic/claude-haiku-4.5', 'Anthropic'), '');
  assert.equal(v('anthropic/claude-haiku-4.5', 'Amazon Bedrock'), 'not-producer');
  assert.equal(v('typesafe/jev-1.13', 'TypeSafe'), '');
  assert.equal(v('qwen/qwen3-max', 'Together'), 'model', 'una variante chiusa di una famiglia aperta resta chiusa');
  assert.equal(v('', 'DeepInfra'), 'model', 'un uso senza modello non si dà per buono');
  assert.equal(v('~DeepSeek/DeepSeek-V4-Pro', 'DeepInfra'), '');
});

test('l\'uso si giudica con la lista dell\'owner quando c\'è, coi pesi dichiarati dal registro condiviso', () => {
  assert.equal(P.creditsUsageViolation({ model: 'deepseek/deepseek-v4-pro', provider: 'Novita' }, ['DeepSeek']), '');
  assert.equal(P.creditsUsageViolation({ model: 'deepseek/deepseek-v4-pro', provider: 'Novita' }), 'excluded');
  assert.equal(P.creditsUsageViolation({ model: 'acme/modello-nuovo', provider: 'DeepInfra' }), 'model');
  assert.equal(P.creditsUsageViolation({ model: 'acme/modello-nuovo', provider: 'DeepInfra', weights: 'open' }), '');
});

test('un modello aperto che solo il catalogo del router riconosce non è fuori politica, se il catalogo è registrato', () => {
  const id = 'acme/scoiattolo-7b';
  assert.equal(P.creditsUsageViolation({ model: id, provider: 'DeepInfra' }), 'model');
  P.registraCatalogoPesi([{ id, hugging_face_id: 'acme/scoiattolo-7b' }]);
  try {
    assert.equal(P.creditsUsageViolation({ model: id, provider: 'DeepInfra' }), '');
  } finally {
    P.registraCatalogoPesi([]);
  }
});
