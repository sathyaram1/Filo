// #2272 — la strada vera di un'immagine creata in chat: il cancello dei modelli chiede a OpenRouter un'uscita in
// immagini e legge le immagini dalla sua risposta. Solo la rete è finta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/capabilities.js');
require('../../src/shared/constants.js');
require('../../src/shared/contenutoEsterno.js');
require('../../src/shared/filoContesto.js');
require('../../src/shared/filoTrattoVivo.js');
require('../../src/shared/guardianoStatico.js');
require('../../src/main/services/providers/openrouter.js');
require('../../src/main/services/providers/index.js');
require('../../src/main/services/modelGate.js');

const { ACTIONS } = globalThis.SN_CONST;
const PITTORE = 'prova/pittore-aperto';
const PNG64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');

async function conRete(risposta, fn) {
  const corpi = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const corpo = opts && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    if (corpo && Array.isArray(corpo.messages)) corpi.push(corpo);
    return { ok: true, status: 200, json: async () => risposta, text: async () => JSON.stringify(risposta), headers: new Map() };
  };
  try { return { r: await fn(), corpi }; } finally { globalThis.fetch = orig; }
}

function cancello() {
  return globalThis.SN_MODEL_GATE.create({
    getSettings: async () => ({}),
    buildChain: () => [{ provider: 'openrouter', apiKey: 'k', model: PITTORE }],
    modelFor: () => 'pittore',
    costs: { isOverLimit: async () => false, record: async () => 0 },
  });
}

test('la richiesta chiede immagini e testo, e le immagini della risposta tornano come data: URL', async () => {
  const { r, corpi } = await conRete({
    choices: [{
      message: {
        content: 'Ecco il gatto.',
        images: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG64}` } },
          { type: 'image_url', image_url: { url: 'https://esempio.example/non-un-dato.png' } },
          { type: 'image_url' },
        ],
      },
    }],
    usage: { prompt_tokens: 20, completion_tokens: 1300 },
  }, () => cancello().complete({ action: ACTIONS.IMAGE_GEN, messages: [{ role: 'user', content: 'un gatto astronauta' }], modalities: ['image', 'text'] }));
  assert.equal(corpi.length, 1);
  assert.deepEqual(corpi[0].modalities, ['image', 'text']);
  assert.equal(corpi[0].model, PITTORE);
  assert.deepEqual(r.images, [`data:image/png;base64,${PNG64}`], 'solo le immagini date come dato, non indirizzi da scaricare');
  assert.equal(r.text, 'Ecco il gatto.');
});

test('una chiamata che non chiede immagini non manda il campo', async () => {
  const { corpi } = await conRete({ choices: [{ message: { content: 'ok' } }], usage: {} },
    () => cancello().complete({ action: ACTIONS.IMAGE_GEN, messages: [{ role: 'user', content: 'ciao' }] }));
  assert.equal(corpi[0].modalities, undefined);
});
