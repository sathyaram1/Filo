// Voce e dettatura: il router ignora il blocco `provider` sugli endpoint audio (#713),
// quindi la lista di esclusione si applica prima di chiamare, sugli host che il
// router dichiara. Senza un host ammesso la richiesta non parte e l'errore dice perché.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'i18n.js'));
require(join(ROOT, 'src', 'main', 'services', 'providers', 'openrouter.js'));
const C = globalThis.SN_CONST;
const OR = globalThis.SN_PROVIDER_OPENROUTER;

const ROUTING = { ignore: [...C.DEFAULT_EXCLUDED_PROVIDERS] };
const PCM = Buffer.from([1, 2, 3, 4]);

function jsonRes(obj, status = 200) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: () => null },
    async json() { return obj; },
    async text() { return JSON.stringify(obj); },
  };
}

function audioRes() {
  return {
    ok: true, status: 200,
    headers: { get: (k) => ({ 'content-type': 'audio/pcm;rate=24000', 'x-generation-id': 'gen-1' })[k.toLowerCase()] || null },
    async arrayBuffer() { return PCM.buffer.slice(PCM.byteOffset, PCM.byteOffset + PCM.byteLength); },
    async json() { return { text: 'ciao', usage: { seconds: 1 } }; },
    async text() { return ''; },
  };
}

const endpoints = (...hosts) => jsonRes({ data: { endpoints: hosts.map(([provider_name, tag]) => ({ provider_name, tag })) } });

// `hosts`: modello → risposta dell'elenco host (o funzione che la costruisce).
async function withRouter(hosts, run) {
  const real = global.fetch;
  const calls = { endpoints: [], audio: [] };
  global.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/endpoints')) {
      calls.endpoints.push(u);
      const model = decodeURIComponent(u.slice(`${OR.MODELS_ENDPOINT}/`.length, -'/endpoints'.length));
      const h = hosts[model];
      if (typeof h === 'function') return h();
      return h || jsonRes({ error: 'not found' }, 404);
    }
    calls.audio.push(u);
    return audioRes();
  };
  try { return await run(calls); } finally { global.fetch = real; }
}

beforeEach(() => OR.forgetModelHosts());

test('modello servito solo dal produttore escluso: la voce non parte e l\'errore lo spiega', async () => {
  const model = 'openai/gpt-4o-mini-tts';
  await withRouter({ [model]: endpoints(['OpenAI', 'openai']) }, async (calls) => {
    await assert.rejects(
      OR.synthesizeSpeech({ apiKey: 'k', model, text: 'Ciao', providerRouting: ROUTING }),
      (e) => {
        assert.equal(e.code, 'NO_ALLOWED_HOST');
        assert.match(e.message, /openai\/gpt-4o-mini-tts/);
        assert.match(e.message, /OpenAI/);
        assert.deepEqual(e.hosts, ['OpenAI']);
        return true;
      },
    );
    assert.deepEqual(calls.audio, [], 'nessuna richiesta audio è partita');
    assert.equal(calls.endpoints.length, 1);
  });
});

test('modello servito solo dal produttore escluso: la dettatura non parte', async () => {
  const model = 'openai/gpt-4o-transcribe';
  await withRouter({ [model]: endpoints(['OpenAI', 'openai'], ['Azure', 'azure']) }, async (calls) => {
    await assert.rejects(
      OR.transcribe({ apiKey: 'k', model, audioBase64: 'QUJD', format: 'wav', providerRouting: { ignore: ['OpenAI', 'Azure'] } }),
      (e) => e.code === 'NO_ALLOWED_HOST' && /OpenAI e Azure/.test(e.message),
    );
    assert.deepEqual(calls.audio, []);
  });
});

test('basta un host ammesso: la richiesta parte, e l\'elenco host si legge una volta sola', async () => {
  const model = 'hexgrad/kokoro-82m';
  await withRouter({ [model]: endpoints(['DeepInfra', 'deepinfra/fp16'], ['Together', 'together']) }, async (calls) => {
    const [a, b] = await Promise.all([
      OR.synthesizeSpeech({ apiKey: 'k', model, text: 'Uno', providerRouting: ROUTING }),
      OR.synthesizeSpeech({ apiKey: 'k', model, text: 'Due', providerRouting: ROUTING }),
    ]);
    assert.ok(a.audioBase64 && b.audioBase64);
    await OR.synthesizeSpeech({ apiKey: 'k', model, text: 'Tre', providerRouting: ROUTING });
    assert.equal(calls.audio.length, 3);
    assert.equal(calls.endpoints.length, 1, 'le chiamate in parallelo e quelle dopo usano lo stesso elenco');
  });
});

test('host misti (produttore e indipendente): la richiesta parte', async () => {
  const model = 'openai/whisper-large-v3';
  await withRouter({ [model]: endpoints(['OpenAI', 'openai'], ['Groq', 'groq']) }, async (calls) => {
    const r = await OR.transcribe({ apiKey: 'k', model, audioBase64: 'QUJD', format: 'wav', providerRouting: ROUTING });
    assert.equal(r.text, 'ciao');
    assert.equal(calls.audio.length, 1);
  });
});

test('una variante del nome del produttore è esclusa come la forma base', async () => {
  const model = 'google/gemini-tts';
  await withRouter({ [model]: endpoints(['Google AI Studio', 'google-ai-studio'], ['Google Vertex', 'google-vertex/global']) }, async (calls) => {
    await assert.rejects(
      OR.synthesizeSpeech({ apiKey: 'k', model, text: 'x', providerRouting: ROUTING }),
      (e) => e.code === 'NO_ALLOWED_HOST' && /Google AI Studio e Google Vertex/.test(e.message),
    );
    assert.deepEqual(calls.audio, []);
  });
});

test('host sconosciuti (errore, 404, elenco vuoto): si chiama, e una lettura fallita non si ripete a ogni frase', async () => {
  const model = 'acme/voce-nuova';
  let n = 0;
  await withRouter({ [model]: () => { n++; return jsonRes({ error: 'boom' }, 500); } }, async (calls) => {
    await OR.synthesizeSpeech({ apiKey: 'k', model, text: 'x', providerRouting: ROUTING });
    await OR.synthesizeSpeech({ apiKey: 'k', model, text: 'y', providerRouting: ROUTING });
    assert.equal(calls.audio.length, 2);
    assert.equal(n, 1);
  });
  await withRouter({ 'acme/vuoto': endpoints() }, async (calls) => {
    await OR.transcribe({ apiKey: 'k', model: 'acme/vuoto', audioBase64: 'QUJD', format: 'wav', providerRouting: ROUTING });
    assert.equal(calls.audio.length, 1);
  });
});

test('un id che uscirebbe dal percorso non diventa una richiesta a un altro endpoint', async () => {
  await withRouter({}, async (calls) => {
    for (const model of ['../credits', 'a/../../auth/key', 'a/b/c', '..', '']) {
      await OR.synthesizeSpeech({ apiKey: 'k', model, text: 'x', providerRouting: ROUTING }).catch(() => {});
    }
    assert.deepEqual(calls.endpoints, []);
  });
  assert.equal(
    (await withRouter({ 'a b/c?d': endpoints(['DeepInfra', 'deepinfra']) }, async (calls) => {
      await OR.synthesizeSpeech({ apiKey: 'k', model: 'a b/c?d', text: 'x', providerRouting: ROUTING });
      return calls.endpoints[0];
    })),
    'https://openrouter.ai/api/v1/models/a%20b/c%3Fd/endpoints',
  );
});

test('senza lista di esclusione né vincolo di produttore non si chiede niente in più', async () => {
  await withRouter({}, async (calls) => {
    await OR.synthesizeSpeech({ apiKey: 'k', model: 'hexgrad/kokoro-82m', text: 'x', providerRouting: null });
    assert.deepEqual(calls.endpoints, []);
    assert.equal(calls.audio.length, 1);
  });
});

test('un elenco scaduto si usa mentre si rilegge: niente attesa sulla lettura', async () => {
  const model = 'hexgrad/kokoro-82m';
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  try {
    let n = 0;
    let release;
    await withRouter({
      [model]: () => {
        n++;
        if (n === 1) return endpoints(['DeepInfra', 'deepinfra']);
        return new Promise((resolve) => { release = () => resolve(endpoints(['OpenAI', 'openai'])); });
      },
    }, async (calls) => {
      await OR.synthesizeSpeech({ apiKey: 'k', model, text: 'x', providerRouting: ROUTING });
      offset = 2 * 60 * 60 * 1000;
      await OR.synthesizeSpeech({ apiKey: 'k', model, text: 'y', providerRouting: ROUTING });
      assert.equal(calls.audio.length, 2, 'la seconda parte con l\'elenco vecchio');
      assert.equal(n, 2, 'e intanto l\'elenco si rilegge');
      release();
      await new Promise((r) => setTimeout(r, 10));
      await assert.rejects(
        OR.synthesizeSpeech({ apiKey: 'k', model, text: 'z', providerRouting: ROUTING }),
        (e) => e.code === 'NO_ALLOWED_HOST',
      );
    });
  } finally {
    Date.now = realNow;
  }
});

test('Claude servito solo da un rivenditore: rifiutato anche senza lista di esclusione', async () => {
  const model = 'anthropic/claude-voice';
  await withRouter({ [model]: endpoints(['Amazon Bedrock', 'amazon-bedrock']) }, async (calls) => {
    await assert.rejects(
      OR.synthesizeSpeech({ apiKey: 'k', model, text: 'x', providerRouting: null }),
      (e) => e.code === 'NO_ALLOWED_HOST',
    );
    assert.deepEqual(calls.audio, []);
  });
});

test('hostPolicyViolation: nome o slug, esclusione e vincolo di produttore', () => {
  const ex = ['OpenAI', 'Moonshot AI', 'Google'];
  assert.equal(C.hostPolicyViolation({ name: 'OpenAI', tag: 'openai' }, 'openai/x', ex), 'excluded');
  assert.equal(C.hostPolicyViolation({ name: 'Moonshot AI', tag: 'moonshotai' }, 'moonshotai/kimi', ex), 'excluded');
  assert.equal(C.hostPolicyViolation({ name: '', tag: 'google-vertex/us' }, 'google/x', ex), 'excluded');
  assert.equal(C.hostPolicyViolation({ name: 'DeepInfra', tag: 'deepinfra/fp8' }, 'openai/whisper', ex), '');
  assert.equal(C.hostPolicyViolation({ name: 'Amazon Bedrock', tag: 'amazon-bedrock' }, 'anthropic/claude-x', []), 'not-producer');
  assert.equal(C.hostPolicyViolation({ name: 'Anthropic', tag: 'anthropic' }, 'anthropic/claude-x', []), '');
  assert.equal(C.hostPolicyViolation({}, 'openai/x', ex), '');
});
