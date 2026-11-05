// Verifica #1302, giro 1, rilievo 3: il testo dell'Aiuto e della chat dei mazzi tirato fuori dall'involucro.
// Prosa con un esempio fra graffe valido, citazioni non escapate in una risposta tagliata, frase prima di un JSON tagliato.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'tests', 'unit', 'x.mjs'));
require('../../src/shared/constants.js');
require('../../src/shared/chatErrors.js');
require('../../src/shared/scryfallQuery.js');
const Q = globalThis.SN_SCRYFALL_Q;

// La funzione dell'Aiuto vive dentro la sidebar: la si prende dal sorgente com'è.
const src = readFileSync(join(process.cwd(), 'src', 'content', 'sidebar.js'), 'utf8');
const i = src.indexOf('  function parseAssistantOutput(');
let j = src.indexOf('{', src.indexOf(')', i));
for (let k = j, d = 0; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && !--d) { j = k + 1; break; } }
// eslint-disable-next-line no-unused-vars
const azioniDiPagina = () => ({});
const aiuto = eval(`(${src.slice(i, j).trim()})`);
const testoAiuto = (s, fr) => { const r = aiuto(s, fr); return r.display ?? r.text ?? ''; };

test('r3 Aiuto: una risposta intera in prosa con un esempio fra graffe si vede intera', async () => {
  const prosa = 'Il file package.json deve contenere {"type":"module"} per usare import.';
  expect(testoAiuto(prosa, 'stop')).toContain('per usare import');
  const conTesto = 'Nel corpo della richiesta metti {"text":"ciao"} e invia.';
  expect(testoAiuto(conTesto, 'stop')).toContain('Nel corpo della richiesta');
});

test('r3 mazzi: una risposta intera in prosa con un esempio fra graffe si vede intera e non propone azioni', async () => {
  const r = Q.parseAgentReply('Il formato di import è {"reply":"x","import":[{"name":"Sol Ring","qty":1}]} ma basta scrivere i nomi.', 'stop');
  expect(r.reply).toContain('basta scrivere i nomi');
  expect(r.import || []).toHaveLength(0);
});

test('r3 tagliata dal tetto con citazioni non escapate: resta il testo scritto, non la prima parola', async () => {
  const aiutoT = testoAiuto('{"text":"Clicca su "Salva" in alto e poi su "Chiudi", quindi', 'length');
  expect(aiutoT).toContain('in alto');
  const mazzi = Q.parseAgentReply('{"reply":"Ti consiglio "Sol Ring" e "Arcane Signet" per la rampa', 'length');
  expect(mazzi.reply).toContain('per la rampa');
});

test('r3 tagliata dal tetto con una frase prima del JSON: niente graffa né campo grezzo', async () => {
  const s = 'Ecco la risposta: {"text":"ciao a me';
  expect(testoAiuto(s, 'length')).not.toContain('{"text"');
  expect(Q.parseAgentReply(s, 'length').reply).not.toContain('{"text"');
});
