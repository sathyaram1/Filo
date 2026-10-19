// Voce e dettatura: il router ignora il blocco `provider` sugli endpoint audio (#713),
// quindi la lista di esclusione si applica prima di chiamare, sugli host che il
// router dichiara. Si parte solo con host noti e TUTTI ammessi (#1141); se no l'errore dice perché.

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

// `hosts`: modello → risposta dell'elenco host (o funzione che la costruisce). `zdr`: il catalogo a ritenzione zero
// (#831), che conta perché qui paga Filo; 'tutti' (di serie) dichiara ogni host elencato, null non risponde.
async function zdrDiTutti(hosts) {
  const data = [];
  for (const [model, h] of Object.entries(hosts)) {
    if (!h || typeof h === 'function') continue;
    const body = await h.json();
    for (const e of (body && body.data && body.data.endpoints) || []) data.push({ model_id: model, provider_name: e.provider_name, tag: e.tag });
  }
  return { data };
}

async function withRouter(hosts, run, { zdr = 'tutti' } = {}) {
  const real = global.fetch;
  const calls = { endpoints: [], audio: [], zdr: 0 };
  global.fetch = async (url) => {
    const u = String(url);
    if (u === OR.ZDR_ENDPOINT) {
      calls.zdr++;
      if (zdr === 'tutti') return jsonRes(await zdrDiTutti(hosts));
      return zdr ? jsonRes(zdr) : jsonRes({ error: 'not found' }, 404);
    }
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
        assert.match(e.message, /lo serve solo OpenAI,/);
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
      (e) => e.code === 'NO_ALLOWED_HOST' && /lo servono solo OpenAI e Azure,/.test(e.message),
    );
    assert.deepEqual(calls.audio, []);
  });
});

test('host tutti ammessi: voce e dettatura partono, e l\'elenco host si legge una volta sola', async () => {
  const model = 'hexgrad/kokoro-82m';
  await withRouter({ [model]: endpoints(['DeepInfra', 'deepinfra/fp16'], ['Together', 'together']) }, async (calls) => {
    const [a, b] = await Promise.all([
      OR.synthesizeSpeech({ apiKey: 'k', model, text: 'Uno', providerRouting: ROUTING }),
      OR.synthesizeSpeech({ apiKey: 'k', model, text: 'Due', providerRouting: ROUTING }),
    ]);
    assert.ok(a.audioBase64 && b.audioBase64);
    await OR.synthesizeSpeech({ apiKey: 'k', model, text: 'Tre', providerRouting: ROUTING });
    const r = await OR.transcribe({ apiKey: 'k', model, audioBase64: 'QUJD', format: 'wav', providerRouting: ROUTING });
    assert.equal(r.text, 'ciao');
    assert.equal(calls.audio.length, 4);
    assert.equal(calls.endpoints.length, 1, 'le chiamate in parallelo e quelle dopo usano lo stesso elenco');
  });
});

test('host misti (escluso e ammesso): né voce né dettatura partono, e l\'errore nomina l\'escluso', async () => {
  const model = 'openai/whisper-large-v3';
  await withRouter({ [model]: endpoints(['OpenAI', 'openai'], ['Groq', 'groq']) }, async (calls) => {
    for (const run of [
      () => OR.transcribe({ apiKey: 'k', model, audioBase64: 'QUJD', format: 'wav', providerRouting: ROUTING }),
      () => OR.synthesizeSpeech({ apiKey: 'k', model, text: 'Ciao', providerRouting: ROUTING }),
    ]) {
      await assert.rejects(run(), (e) => {
        assert.equal(e.code, 'NO_ALLOWED_HOST');
        assert.equal(e.reason, 'mixed');
        assert.deepEqual(e.hosts, ['OpenAI'], 'solo l\'escluso, non Groq');
        assert.match(e.message, /«openai\/whisper-large-v3» lo serve anche OpenAI, che Filo esclude/);
        assert.match(e.message, /Non ho mandato niente/);
        return true;
      });
    }
    assert.deepEqual(calls.audio, [], 'nessuna richiesta audio è partita');
  });
  await withRouter({ 'acme/tre': endpoints(['OpenAI', 'openai'], ['Azure', 'azure'], ['Groq', 'groq']) }, async () => {
    await assert.rejects(
      OR.transcribe({ apiKey: 'k', model: 'acme/tre', audioBase64: 'QUJD', format: 'wav', providerRouting: { ignore: ['OpenAI', 'Azure'] } }),
      (e) => e.code === 'NO_ALLOWED_HOST' && /lo servono anche OpenAI e Azure,/.test(e.message),
    );
  });
});

test('una variante del nome del produttore è esclusa come la forma base', async () => {
  const model = 'google/gemini-tts';
  await withRouter({ [model]: endpoints(['Google AI Studio', 'google-ai-studio'], ['Google Vertex', 'google-vertex/global']) }, async (calls) => {
    await assert.rejects(
      OR.synthesizeSpeech({ apiKey: 'k', model, text: 'x', providerRouting: ROUTING }),
      (e) => e.code === 'NO_ALLOWED_HOST' && /lo servono solo Google AI Studio e Google Vertex,/.test(e.message),
    );
    assert.deepEqual(calls.audio, []);
  });
});

test('host sconosciuti (errore, 404, elenco vuoto, tempo scaduto): né voce né dettatura partono', async () => {
  const unknown = (e) => e.code === 'NO_ALLOWED_HOST' && e.reason === 'unknown' && /^Non so chi serve il modello «acme\//.test(e.message);
  await withRouter({ 'acme/rotto': () => jsonRes({ error: 'boom' }, 500) }, async (calls) => {
    await assert.rejects(OR.synthesizeSpeech({ apiKey: 'k', model: 'acme/rotto', text: 'x', providerRouting: ROUTING }), unknown);
    await assert.rejects(OR.transcribe({ apiKey: 'k', model: 'acme/rotto', audioBase64: 'QUJD', format: 'wav', providerRouting: ROUTING }), unknown);
    assert.deepEqual(calls.audio, []);
  });
  await withRouter({}, async (calls) => {
    await assert.rejects(OR.synthesizeSpeech({ apiKey: 'k', model: 'acme/assente', text: 'x', providerRouting: ROUTING }), unknown);
    assert.deepEqual(calls.audio, []);
  });
  await withRouter({ 'acme/vuoto': endpoints() }, async (calls) => {
    await assert.rejects(OR.transcribe({ apiKey: 'k', model: 'acme/vuoto', audioBase64: 'QUJD', format: 'wav', providerRouting: ROUTING }), unknown);
    assert.deepEqual(calls.audio, []);
  });
  await withRouter({ 'acme/lento': () => { throw new Error('The operation was aborted due to timeout'); } }, async (calls) => {
    await assert.rejects(OR.transcribe({ apiKey: 'k', model: 'acme/lento', audioBase64: 'QUJD', format: 'wav', providerRouting: ROUTING }), unknown);
    assert.deepEqual(calls.audio, []);
  });
});

test('id che non si può chiedere (non in forma a/b): host null, né voce né dettatura partono', async () => {
  await withRouter({}, async (calls) => {
    for (const model of ['kokoro', 'a/b/c']) {
      await assert.rejects(OR.synthesizeSpeech({ apiKey: 'k', model, text: 'x', providerRouting: ROUTING }), (e) => e.code === 'NO_ALLOWED_HOST');
      await assert.rejects(
        OR.transcribe({ apiKey: 'k', model, audioBase64: 'QUJD', format: 'wav', providerRouting: ROUTING }),
        (e) => e.code === 'NO_ALLOWED_HOST',
      );
    }
    assert.deepEqual(calls.endpoints, []);
    assert.deepEqual(calls.audio, []);
  });
});

test('una lettura fallita non si ripete a ogni frase, ma si ritenta presto: tornata la rete, la voce riparte', async () => {
  const model = 'acme/voce-nuova';
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  try {
    let n = 0;
    await withRouter({
      [model]: () => { n++; return n === 1 ? jsonRes({ error: 'boom' }, 500) : endpoints(['DeepInfra', 'deepinfra']); },
    }, async (calls) => {
      for (const text of ['x', 'y']) {
        await assert.rejects(OR.synthesizeSpeech({ apiKey: 'k', model, text, providerRouting: ROUTING }), (e) => e.code === 'NO_ALLOWED_HOST');
      }
      assert.equal(n, 1, 'due frasi di fila, una lettura sola');
      offset = 60 * 1000;
      await OR.synthesizeSpeech({ apiKey: 'k', model, text: 'z', providerRouting: ROUTING });
      assert.equal(n, 2);
      assert.equal(calls.audio.length, 1);
    }, { zdr: { data: [{ model_id: model, provider_name: 'DeepInfra', tag: 'deepinfra' }] } });
  } finally {
    Date.now = realNow;
  }
});

test('un id che uscirebbe dal percorso non diventa una richiesta a un altro endpoint', async () => {
  await withRouter({}, async (calls) => {
    for (const model of ['../credits', 'a/../../auth/key', 'a/b/c', '..', '']) {
      await assert.rejects(OR.synthesizeSpeech({ apiKey: 'k', model, text: 'x', providerRouting: ROUTING }), (e) => e.code === 'NO_ALLOWED_HOST');
    }
    assert.deepEqual(calls.endpoints, []);
    assert.deepEqual(calls.audio, []);
  });
  assert.equal(
    (await withRouter({ 'a b/c?d': endpoints(['DeepInfra', 'deepinfra']) }, async (calls) => {
      await OR.synthesizeSpeech({ apiKey: 'k', model: 'a b/c?d', text: 'x', providerRouting: ROUTING });
      return calls.endpoints[0];
    })),
    'https://openrouter.ai/api/v1/models/a%20b/c%3Fd/endpoints',
  );
});

test('senza lista di esclusione né vincolo di produttore, con la chiave propria non si chiede niente in più', async () => {
  globalThis.SN_WALLET_MAIN = { keySourceOf: async (k) => (k === 'mia' ? 'own' : 'personal') };
  try {
    const model = 'hexgrad/kokoro-82m';
    await withRouter({ [model]: endpoints(['DeepInfra', 'deepinfra']) }, async (calls) => {
      await OR.synthesizeSpeech({ apiKey: 'mia', model, text: 'x', providerRouting: null });
      assert.deepEqual(calls.endpoints, []);
      assert.equal(calls.zdr, 0);
      assert.equal(calls.audio.length, 1);
      // Coi crediti di Filo resta la ritenzione zero (#831): si leggono host e catalogo.
      await OR.synthesizeSpeech({ apiKey: 'k', model, text: 'x', providerRouting: null });
      assert.equal(calls.endpoints.length, 1);
      assert.equal(calls.zdr, 1);
      assert.equal(calls.audio.length, 2);
    });
  } finally {
    delete globalThis.SN_WALLET_MAIN;
  }
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
    }, { zdr: { data: [{ model_id: model, provider_name: 'DeepInfra', tag: 'deepinfra' }] } });
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

test('hostVerdict: ok, misti, tutti esclusi, ignoti; senza niente da escludere non legge gli host', async () => {
  await withRouter({
    'a/ok': endpoints(['DeepInfra', 'deepinfra'], ['Groq', 'groq']),
    'a/misto': endpoints(['DeepInfra', 'deepinfra'], ['OpenAI', 'openai'], ['OpenAI', 'openai/fast']),
    'a/escluso': endpoints(['OpenAI', 'openai']),
  }, async (calls) => {
    const v = (model, providerRouting = ROUTING) => OR.hostVerdict({ apiKey: 'k', model, providerRouting });
    assert.deepEqual(await v('a/ok'), { ok: true });
    assert.deepEqual(await v('a/misto'), { ok: false, reason: 'mixed', excluded: ['OpenAI'] });
    assert.deepEqual(await v('a/escluso'), { ok: false, reason: 'excluded', excluded: ['OpenAI'] });
    assert.deepEqual(await v('a/assente'), { ok: false, reason: 'unknown', excluded: [] });
    const prima = calls.endpoints.length;
    assert.deepEqual(await v('a/misto', null), { ok: true });
    assert.equal(calls.endpoints.length, prima);
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
