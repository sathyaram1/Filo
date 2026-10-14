// #1097 giro 1, rilievo 1: quando il fornitore rifiuta la chiamata per il tetto della risposta, l'utente deve leggere
// che è il tetto (e dove cambiarlo), non un guasto generico né «il modello non sa usare gli strumenti».
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/chatErrors.js');
require('../../../src/main/services/providers/index.js');
require('../../../src/main/services/providers/openrouter.js');
const OR = globalThis.SN_PROVIDER_OPENROUTER;
const CE = globalThis.SN_CHAT_ERRORS;

const NESSUN_HOST = '{"error":{"message":"No endpoints found that can handle the requested parameters. To learn more about provider routing, visit: https://openrouter.ai/docs/provider-routing","code":404}}';
const OLTRE_CONTESTO = '{"error":{"message":"This endpoint\'s maximum context length is 163840 tokens. However, you requested about 300000 tokens (37616 of text input, 262144 in the output). Please reduce the length of either one, or use the \\"middle-out\\" transform to compress your prompt automatically.","code":400}}';

test('r1 tetto portato oltre la finestra del modello: il messaggio nomina il tetto', async () => {
  const e = await OR.httpError(new Response(OLTRE_CONTESTO, { status: 400 }), { maxTokens: 262144, tools: true });
  expect(CE.friendly(e)).toMatch(/tetto/i);
});

test('r1 nessun host regge i parametri della chat: il tetto è fra le cause dette', async () => {
  const e = await OR.httpError(new Response(NESSUN_HOST, { status: 404 }), { maxTokens: 16384, tools: true });
  expect(CE.friendly(e)).toMatch(/tetto/i);
});
