// Regola dell'owner (06/10/2026, #1059): chi produce un modello a pesi aperti è escluso come fornitore, i suoi pesi
// si usano solo se li serve qualcun altro. Ogni modello di serie del repo ha il produttore nella lista di esclusione,
// salvo Anthropic e i modelli stretti: un produttore nuovo diventa rosso qui invece di passare in silenzio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'tests', 'fixtures', 'testModels.js'));
const { OWNER_SLOT_DEFAULTS } = require(join(ROOT, 'src', 'main', 'services', 'resolveSupportModel.js'));

const C = globalThis.SN_CONST;
const LISTA = C.DEFAULT_EXCLUDED_PROVIDERS;

// I programmi di prova con un modello (tests/agent) lo scrivono come opzione di partenza: «model: 'autore/nome'».
function modelliDegliAgenti() {
  const dir = join(ROOT, 'tests', 'agent');
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const testo = readFileSync(join(dir, f), 'utf8');
    for (const m of testo.matchAll(/\b(?:model|fallback)\s*:\s*'([a-z0-9][\w.-]*\/[\w.:-]+)'/g)) out.push([`tests/agent/${f}`, m[1]]);
  }
  return out;
}

function modelliDiSerie() {
  const out = [];
  for (const [nick, e] of Object.entries(globalThis.SN_TEST_MODELS.registry)) out.push([`registro di prova «${nick}»`, e.model]);
  for (const [vecchio, nuovo] of Object.entries(C.DEPRECATED_MODELS)) out.push([`sostituto di ${vecchio}`, nuovo]);
  for (const [slot, id] of Object.entries(OWNER_SLOT_DEFAULTS)) if (id) out.push([`funzione dell'owner ${slot}`, id]);
  for (const id of Object.keys(C.NOTIONAL_PRICING)) out.push(['listino', id]);
  for (const id of Object.keys(C.DEFAULT_SETTINGS.pricing || {})) out.push(['prezzi di serie', id]);
  out.push(...modelliDegliAgenti());
  return out;
}

test('ogni modello di serie ha il produttore fra i fornitori esclusi (Anthropic e i modelli stretti a parte)', () => {
  const modelli = modelliDiSerie();
  assert.ok(modelli.length > 15, `trovati solo ${modelli.length} modelli: la raccolta non legge più le sue fonti`);
  assert.ok(modelli.some(([dove]) => dove.startsWith('tests/agent/')), 'i modelli dei programmi di prova non si leggono più');
  for (const [dove, id] of modelli) {
    assert.ok(C.modelProducer(id), `${dove}: «${id}» non dice chi l'ha prodotto (manca il prefisso «autore/»)`);
    const nome = C.unexcludedProducer(id, LISTA);
    assert.equal(nome, '', `${dove}: «${id}» è di ${nome}, che non è fra i fornitori esclusi: `
      + 'aggiungilo a DEFAULT_EXCLUDED_PROVIDERS (e alla copia del server), o al nome in MODEL_AUTHOR_PROVIDERS se lo è già con un altro nome');
  }
});

test('il giudice MiMo della segnalazione non può più arrivare a Xiaomi', () => {
  assert.equal(C.unexcludedProducer('xiaomi/mimo-v2.6-flash', LISTA), '');
  assert.ok(C.isProviderExcluded('Xiaomi', LISTA));
  const senza = LISTA.filter((x) => x !== 'Xiaomi');
  assert.equal(C.unexcludedProducer('xiaomi/mimo-v2.6-flash', senza), 'Xiaomi', 'senza la voce il produttore deve risultare scoperto');
});

test('il produttore si riconosce anche quando il prefisso non ripete il nome del fornitore', () => {
  assert.equal(C.unexcludedProducer('meta-llama/llama-4-maverick', ['Meta']), '');
  assert.equal(C.unexcludedProducer('moonshotai/kimi-k2.6', ['Moonshot AI']), '');
  assert.equal(C.unexcludedProducer('z-ai/glm-5.2', ['Z.AI']), '');
  assert.equal(C.unexcludedProducer('x-ai/grok-5', ['xAI']), '');
  assert.equal(C.unexcludedProducer('mistralai/mistral-medium', ['Mistral']), '');
  assert.equal(C.unexcludedProducer('qwen/qwen3-coder', ['Qwen']), '');
  assert.equal(C.unexcludedProducer('Z-AI/GLM-5.2:thinking', ['z.ai']), '', 'maiuscole e varianti non contano');
  // E scoperto quando la lista non lo nomina, col nome giusto per l'avviso.
  assert.equal(C.unexcludedProducer('moonshotai/kimi-k2.6', ['Google']), 'Moonshot AI');
  assert.equal(C.unexcludedProducer('acme-labs/acme-1', ['Google']), 'acme-labs', 'un produttore mai visto è scoperto, non ignorato');
});

test('Anthropic, i modelli stretti, il router e un id senza autore non chiedono esclusioni', () => {
  assert.equal(C.unexcludedProducer('anthropic/claude-haiku-4.5', []), '');
  assert.equal(C.unexcludedProducer('~anthropic/claude-sonnet-latest', []), '');
  assert.equal(C.unexcludedProducer('typesafe/jev-1.13', []), '');
  assert.equal(C.unexcludedProducer('openrouter/auto', []), '');
  assert.equal(C.unexcludedProducer('kimi-k2.6', []), '');
  assert.equal(C.modelProducer('kimi-k2.6'), null);
  assert.equal(C.unexcludedProducer('', []), '');
  assert.equal(C.unexcludedProducer(null, null), '');
  // L'interruttore dei pesi aperti spegne gli stessi produttori di modelli stretti che qui si lasciano passare.
  for (const r of C.NARROW_MODEL_PRODUCERS) assert.ok(C.effectiveExcludedProviders([], true).includes(r.nome), r.nome);
});

test('col catalogo degli host: chi non ospita niente non va escluso, e vale il nome del catalogo', () => {
  const CATALOGO = [
    { name: 'Xiaomi', slug: 'xiaomi' },
    { name: 'DeepInfra', slug: 'deepinfra' },
    { name: 'NVIDIA NIM', slug: 'nvidia' },
  ];
  assert.equal(C.unexcludedProducer('xiaomi/mimo-v2.6-flash', ['Google'], CATALOGO), 'Xiaomi');
  assert.equal(C.unexcludedProducer('xiaomi/mimo-v2.6-flash', ['Xiaomi'], CATALOGO), '');
  assert.equal(C.unexcludedProducer('hexgrad/kokoro-82m', ['Google'], CATALOGO), '', 'Hexgrad non è fra gli host');
  assert.equal(C.unexcludedProducer('nvidia/nemotron-x', ['Google'], CATALOGO), 'NVIDIA NIM', 'il bottone deve scrivere il nome che il router conosce');
  assert.equal(C.unexcludedProducer('nvidia/nemotron-x', ['NVIDIA NIM'], CATALOGO), '');
  assert.equal(C.unexcludedProducer('xiaomi/mimo-v2.6-flash', ['Google'], []), '', 'catalogo vuoto: nessun host da escludere');
});
