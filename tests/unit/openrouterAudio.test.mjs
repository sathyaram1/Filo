// Unit test — voce, dettatura e indicizzazione via il router (OpenRouter).
//
// Verifica la FORMA delle richieste e delle risposte, con fetch finto:
//   - ogni chiamata porta la lista di esclusione dei fornitori (politica sui
//     modelli): senza, un host escluso potrebbe servire l'audio;
//   - la lettura chiede PCM grezzo e riporta l'id della generazione, con cui
//     si chiede dopo chi ha servito;
//   - la dettatura manda l'audio in base64 (non un data URL) col formato, e
//     riporta secondi e costo in dollari;
//   - l'indicizzazione chiede vettori corti e, se ne arrivano di più lunghi,
//     li taglia — così i vettori hanno tutti la stessa lunghezza;
//   - il riscontro "chi ha servito" risponde null finché il router non ha il
//     dato (404), e poi il nome del fornitore.
// Senza queste funzioni il provider non sapeva fare nessuna delle tre cose.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'main', 'services', 'providers', 'openrouter.js'));
const OR = globalThis.SN_PROVIDER_OPENROUTER;

const ROUTING = { ignore: ['Google', 'OpenAI'] };

function withFetch(impl, run) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), init, body });
    return impl({ url: String(url), init, body, n: calls.length });
  };
  return Promise.resolve().then(() => run(calls)).finally(() => { global.fetch = real; });
}

function jsonRes(obj, headers = {}, status = 200) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (k) => headers[k.toLowerCase()] || null },
    async json() { return obj; },
    async text() { return JSON.stringify(obj); },
    async arrayBuffer() { return new ArrayBuffer(0); },
  };
}

test('lettura ad alta voce: PCM grezzo, voce e velocità, lista di esclusione, id della generazione', async () => {
  await withFetch(({ url }) => {
    assert.equal(url, OR.SPEECH_ENDPOINT);
    const bytes = Buffer.from([1, 2, 3, 4]);
    return {
      ok: true, status: 200,
      headers: { get: (k) => ({ 'content-type': 'audio/pcm;rate=24000;channels=1', 'x-generation-id': 'gen-tts-1' })[k.toLowerCase()] || null },
      async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
      async text() { return ''; },
    };
  }, async (calls) => {
    const r = await OR.synthesizeSpeech({ apiKey: 'k', model: 'hexgrad/kokoro-82m', text: 'Ciao', voice: 'if_sara', speed: 1.2, providerRouting: ROUTING });
    assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
    assert.deepEqual(calls[0].body.provider.ignore, ['Google', 'OpenAI'], 'la lista di esclusione viaggia con la richiesta');
    assert.equal(calls[0].body.response_format, 'pcm');
    assert.equal(calls[0].body.voice, 'if_sara');
    assert.equal(calls[0].body.speed, 1.2);
    assert.equal(calls[0].body.input, 'Ciao');
    assert.equal(r.audioBase64, Buffer.from([1, 2, 3, 4]).toString('base64'));
    assert.match(r.mimeType, /rate=24000/);
    assert.equal(r.generationId, 'gen-tts-1');
  });
});

test('lettura ad alta voce: velocità 1 non si manda, audio vuoto è un errore', async () => {
  await withFetch(() => ({
    ok: true, status: 200, headers: { get: () => null },
    async arrayBuffer() { return new ArrayBuffer(0); }, async text() { return ''; },
  }), async (calls) => {
    await assert.rejects(
      OR.synthesizeSpeech({ apiKey: 'k', model: 'm', text: 'x', speed: 1 }),
      /audio vuoto/,
    );
    assert.equal(calls[0].body.speed, undefined);
    assert.equal(calls[0].body.provider, undefined, 'senza politica non si manda un blocco vuoto');
  });
});

test('dettatura: audio in base64 col formato, lingua, secondi e costo dal router', async () => {
  await withFetch(({ url }) => {
    assert.equal(url, OR.TRANSCRIPTIONS_ENDPOINT);
    return jsonRes({ text: ' Ciao, sono Filo. ', usage: { seconds: 2.5, cost: 0.00001 } }, { 'x-generation-id': 'gen-stt-1' });
  }, async (calls) => {
    const r = await OR.transcribe({ apiKey: 'k', model: 'openai/whisper-large-v3-turbo', audioBase64: 'QUJD', format: 'wav', language: 'it', providerRouting: ROUTING });
    assert.deepEqual(calls[0].body.input_audio, { data: 'QUJD', format: 'wav' });
    assert.equal(calls[0].body.language, 'it');
    assert.deepEqual(calls[0].body.provider.ignore, ['Google', 'OpenAI']);
    assert.equal(r.text, ' Ciao, sono Filo. ');
    assert.equal(r.usage.seconds, 2.5);
    assert.equal(r.usage.costUsd, 0.00001);
    assert.equal(r.generationId, 'gen-stt-1');
    assert.equal(r.servedBy, null, 'il router non lo dice nella risposta: si chiede dopo');
  });
});

test('dettatura: un errore HTTP porta status e fornitore strutturati', async () => {
  await withFetch(() => jsonRes({ error: 'no' }, {}, 429), async () => {
    await assert.rejects(
      OR.transcribe({ apiKey: 'k', model: 'm', audioBase64: 'QUJD', format: 'wav' }),
      (e) => e.status === 429 && e.provider === 'openrouter',
    );
  });
});

test('indicizzazione: vettori nell\'ordine dei testi, accorciati alla lunghezza chiesta, con chi ha servito', async () => {
  await withFetch(({ url }) => {
    assert.equal(url, OR.EMBEDDINGS_ENDPOINT);
    return jsonRes({
      provider: 'DeepInfra',
      data: [
        { index: 1, embedding: [0.4, 0.5, 0.6, 0.7] },
        { index: 0, embedding: [0.1, 0.2, 0.3, 0.9] },
      ],
      usage: { prompt_tokens: 6, cost: 0.0000001 },
    });
  }, async (calls) => {
    const r = await OR.embed({ apiKey: 'k', model: 'qwen/qwen3-embedding-8b', texts: ['a', 'b'], dim: 3, providerRouting: ROUTING });
    assert.deepEqual(calls[0].body.input, ['a', 'b']);
    assert.equal(calls[0].body.dimensions, 3);
    assert.deepEqual(calls[0].body.provider.ignore, ['Google', 'OpenAI']);
    assert.deepEqual(r.vectors, [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]], 'ordine dei testi e taglio alla lunghezza chiesta');
    assert.equal(r.servedBy, 'DeepInfra');
    assert.equal(r.usage.promptTokens, 6);
    assert.equal(r.usage.costUsd, 0.0000001);
  });
});

test('chi ha servito, a posteriori: null finché il router non ce l\'ha, poi il nome', async () => {
  await withFetch(({ url, n }) => {
    assert.ok(url.startsWith(OR.GENERATION_ENDPOINT + '?id=gen-tts-1'));
    if (n === 1) return jsonRes({ error: { code: 404 } }, {}, 404);
    return jsonRes({ data: { provider_name: 'Together', total_cost: 0.000112 } });
  }, async () => {
    assert.equal(await OR.lookupServedBy({ apiKey: 'k', generationId: 'gen-tts-1' }), null);
    assert.deepEqual(await OR.lookupServedBy({ apiKey: 'k', generationId: 'gen-tts-1' }), { servedBy: 'Together', costUsd: 0.000112 });
    assert.equal(await OR.lookupServedBy({ apiKey: 'k', generationId: '' }), null);
  });
});
