// Verifica #1302, giro 1, rilievo 2: quando il tetto finisce nel ragionamento, la decisione vuole la nota e un
// «Continua» con più spazio. Bolla vuota: oggi è un errore senza seguito. Host già al massimo: il seguito ha lo stesso tetto.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'tests', 'unit', 'x.mjs'));
for (const f of ['constants', 'chatErrors', 'scryfallQuery', 'lunghezzaRisposte', 'filoContesto']) require(`../../src/shared/${f}.js`);
require('../../src/main/services/providers/index.js');
require('../../src/main/services/providers/openrouter.js');
const OR = globalThis.SN_PROVIDER_OPENROUTER;
const CE = globalThis.SN_CHAT_ERRORS;
const LR = globalThis.SN_LUNGHEZZA_RISPOSTE;

test('r2 la chat che ha speso tutto il tetto ragionando non finisce in un errore: resta la strada del seguito', async () => {
  const fine = CE.motivoFine('length', { reasoningTokens: 65536, completionTokens: 65536 });
  expect(fine).toBe('tetto_ragionamento');
  // Senza `intera` (la chat): oggi esce «alza il tetto in Preferenze e riprova», senza «Continua».
  expect(CE.erroreDelTaglio({ text: '', toolCalls: [], finishReason: fine })).toBeNull();
});

test('r2 «Continuando avrà più spazio»: con gli host al massimo il seguito ha davvero più spazio, o la nota non lo promette', async () => {
  const NO_PARAMS = 'No endpoints found that can handle the requested parameters.';
  const endpoints = [{ provider_name: 'Google AI Studio', tag: 'google-ai-studio', supported_parameters: ['tools', 'max_tokens'], max_completion_tokens: 65535 }];
  const usato = async (tetto) => {
    OR.forgetModelHosts();
    const orig = globalThis.fetch;
    let ultimo = null;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/endpoints')) return new Response(JSON.stringify({ data: { endpoints } }), { status: 200 });
      if (String(url).includes('zdr')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      const b = JSON.parse(init.body);
      ultimo = b.max_tokens;
      if (b.max_tokens > 65535) return new Response(JSON.stringify({ error: { message: NO_PARAMS } }), { status: 404 });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
    };
    try { await OR.complete({ apiKey: 'k', model: 'google/gemini-2.5-flash', messages: [{ role: 'user', content: 'x' }], maxTokens: tetto }); } finally { globalThis.fetch = orig; }
    return ultimo;
  };
  const prima = await usato(LR.DI_SERIE.conversazioni);
  const seguito = await usato(LR.perSeguito(LR.DI_SERIE.conversazioni));
  const nota = CE.rispostaInterrotta('tetto_ragionamento');
  expect(seguito > prima || !/più spazio/i.test(nota)).toBe(true);
});
