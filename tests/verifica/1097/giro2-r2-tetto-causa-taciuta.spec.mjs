// Verifica #1097, giro 2: quando il rifiuto del fornitore nasce dal tetto di lunghezza, la frase per l'utente lo nomina.
// Senza Electron: i moduli di errore e del fornitore girano in Node come nel processo main.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/chatErrors.js');
require('../../../src/main/services/providers/index.js');
require('../../../src/main/services/providers/openrouter.js');
const OR = globalThis.SN_PROVIDER_OPENROUTER;
const CE = globalThis.SN_CHAT_ERRORS;

const risposta = (status, corpo) => ({ status, ok: false, text: async () => corpo, headers: { get: () => null } });

test('r2 modello da 32k, testo lungo e tetto di partenza: la frase nomina il tetto, non un guasto da riprovare', async () => {
  const corpo = JSON.stringify({ error: { message: "This endpoint's maximum context length is 32768 tokens. However, you requested about 40000 tokens (23616 of text input, 16384 in the output)." } });
  const e = await OR.httpError(risposta(400, corpo), { tools: false, maxTokens: 16384 });
  const frase = CE.sentence(e);
  expect(frase).toMatch(/tetto/);
  expect(frase).not.toMatch(/Riprova/);
});
