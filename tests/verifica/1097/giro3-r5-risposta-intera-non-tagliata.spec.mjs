// #1097 giro 3 — il recupero del testo da un involucro tagliato non deve tagliare in silenzio una risposta arrivata intera
// ma scritta male (virgolette non protette dentro il testo).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/chatErrors.js');
require('../../../src/shared/scryfallQuery.js');
const Q = globalThis.SN_SCRYFALL_Q;

test('r5 chat dei mazzi: nomi di carte fra virgolette in una risposta intera non la troncano alla prima virgoletta', () => {
  const reply = Q.parseAgentReply('{"reply": "Ti consiglio "Sol Ring" e "Arcane Signet" per la rampa", "query": ""}').reply;
  expect(reply).toContain('Sol Ring');
  expect(reply).toContain('rampa');
});

test('r5 chat dei mazzi: una risposta in prosa che cita un esempio fra graffe resta intera', () => {
  const reply = Q.parseAgentReply('Prova a scrivere {"reply": "ciao"} oppure altro, così vedi.').reply;
  expect(reply).toContain('così vedi');
});
