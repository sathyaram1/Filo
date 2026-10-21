// Il testo della chat arriva a pezzi che si spezzano dove capita (#1398): a metà parola, a metà lettera accentata, a
// metà riga SSE. Il testo che Filo tiene e mostra deve restare identico, lettera per lettera, a quello del fornitore.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'main', 'services', 'providers', 'openrouter.js'));
const OpenRouter = globalThis.SN_PROVIDER_OPENROUTER;

// Le frasi della segnalazione scritte giuste, più accenti, apostrofi tipografici, virgolette basse e un'emoji a 4 byte.
const RISPOSTA = 'Fatto: da adesso ti do del tu, e spendiamo le parole che servono. '
  + 'Buon ascolto, e io sono sempre qui, quando vuoi. Perché è già così? «Sì», più città, l’ultima volta… 😀 ok.';
const ARGOMENTI = JSON.stringify({ testo: 'Ho riletto la pagina: è più chiara, però l’ultimo passo non c’è. 🙂' });

// Delta del fornitore tagliati ogni `passo` unità UTF-16: cadono a metà parola e anche a metà della coppia dell'emoji.
function aPezzi(s, passo) {
  const out = [];
  for (let i = 0; i < s.length; i += passo) out.push(s.slice(i, i + passo));
  return out;
}

function eventi({ fineRiga = '\n', ultimaSenzaACapo = false } = {}) {
  const ev = (obj) => `data: ${JSON.stringify(obj)}${fineRiga}${fineRiga}`;
  const parti = [`: OPENROUTER PROCESSING${fineRiga}${fineRiga}`];
  parti.push(ev({ id: 'gen-1', choices: [{ delta: { role: 'assistant', content: '' } }] }));
  const args = aPezzi(ARGOMENTI, 4);
  parti.push(ev({ id: 'gen-1', choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'INVIA_FEEDBACK', arguments: args[0] } }] } }] }));
  for (const a of args.slice(1)) parti.push(ev({ id: 'gen-1', choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: a } }] } }] }));
  // Senza a capo finale l'ultimo evento porta anche l'ultimo pezzo di testo: è quello che si perderebbe.
  const testo = aPezzi(RISPOSTA, 3);
  const coda = ultimaSenzaACapo ? testo.pop() : '';
  for (const d of testo) parti.push(ev({ id: 'gen-1', choices: [{ delta: { content: d } }] }));
  const ultimo = { id: 'gen-1', choices: [{ delta: coda ? { content: coda } : {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 50 } };
  if (ultimaSenzaACapo) parti.push(`data: ${JSON.stringify(ultimo)}`);
  else parti.push(ev(ultimo), `data: [DONE]${fineRiga}${fineRiga}`);
  return new TextEncoder().encode(parti.join(''));
}

// La rete consegna i byte nei pezzi dati, esattamente come arrivano.
function risposta(pezzi) {
  let i = 0;
  const body = { getReader: () => ({ read: () => Promise.resolve(i < pezzi.length ? { done: false, value: pezzi[i++] } : { done: true, value: undefined }) }) };
  return { ok: true, body, status: 200, headers: { get: () => null }, text: async () => '' };
}

async function leggi(pezzi) {
  const orig = global.fetch;
  global.fetch = () => Promise.resolve(risposta(pezzi));
  const delta = [];
  try {
    const r = await OpenRouter.streamComplete({
      apiKey: 'k', model: 'x/y', messages: [{ role: 'user', content: 'ciao' }], onDelta: (d) => delta.push(d),
    });
    return { ...r, inDiretta: delta.join('') };
  } finally {
    global.fetch = orig;
  }
}

function controlla(r, etichetta) {
  assert.equal(r.text, RISPOSTA, `testo finale diverso dal ricevuto (${etichetta})`);
  assert.equal(r.inDiretta, RISPOSTA, `testo in diretta diverso dal ricevuto (${etichetta})`);
  assert.equal(r.toolCalls.length, 1, etichetta);
  assert.equal(r.toolCalls[0].arguments, ARGOMENTI, `argomenti dello strumento diversi (${etichetta})`);
}

test('un taglio di rete in qualunque byte lascia il testo identico a quello del fornitore', async () => {
  const byte = eventi();
  for (let i = 1; i < byte.length; i++) {
    controlla(await leggi([byte.subarray(0, i), byte.subarray(i)]), `taglio al byte ${i}`);
  }
});

test('un byte per volta, e righe chiuse da \\r\\n', async () => {
  const byte = eventi();
  controlla(await leggi(Array.from(byte, (_, i) => byte.subarray(i, i + 1))), 'un byte per pezzo');
  const crlf = eventi({ fineRiga: '\r\n' });
  controlla(await leggi([crlf.subarray(0, 101), crlf.subarray(101, 333), crlf.subarray(333)]), 'CRLF');
});

test('l’ultimo evento senza a capo finale non si perde', async () => {
  const byte = eventi({ ultimaSenzaACapo: true });
  const r = await leggi([byte.subarray(0, byte.length - 7), byte.subarray(byte.length - 7)]);
  controlla(r, 'ultimo evento senza a capo');
  assert.equal(r.finishReason, 'stop');
  assert.equal(r.usage.completionTokens, 50);
});
