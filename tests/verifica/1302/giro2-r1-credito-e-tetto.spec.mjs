// Verifica #1302, giro 2, rilievo 1: col tetto di serie largo, a chi resta poco credito il router rifiuta la richiesta
// («requires more credits, or fewer max_tokens… can only afford N»): Filo dice crediti finiti invece di scendere a N.
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

const PUO = 20000;
const rifiuto = (chiesti) => JSON.stringify({ error: { code: 402, message: `This request requires more credits, or fewer max_tokens. You requested up to ${chiesti} tokens, but can only afford ${PUO}. To increase, visit https://openrouter.ai/settings/keys and create a key with a higher total limit` } });

test('r1 credito che regge 20.000 token di risposta: la chat risponde, come col tetto di prima', async () => {
  OR.forgetModelHosts();
  const orig = globalThis.fetch;
  const chiesti = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/endpoints')) return new Response('{}', { status: 500 });
    const b = JSON.parse(init.body);
    chiesti.push(b.max_tokens || 0);
    if (!b.max_tokens || b.max_tokens > PUO) return new Response(rifiuto(b.max_tokens || 262144), { status: 402 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Ecco la risposta.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 3 } }), { status: 200 });
  };
  let esito = null;
  let errore = null;
  try {
    esito = await OR.complete({ apiKey: 'k', model: 'acme/x', messages: [{ role: 'user', content: 'ciao' }], maxTokens: LR.DI_SERIE.conversazioni });
  } catch (e) { errore = e; } finally { globalThis.fetch = orig; }
  // Se la risposta non arriva, almeno non si dice che i crediti sono finiti: ce n'erano per 20.000 token.
  if (errore) expect(CE.friendly(errore)).not.toMatch(/crediti sono finiti|non ha più credito/i);
  expect(esito && esito.text).toBe('Ecco la risposta.');
});
