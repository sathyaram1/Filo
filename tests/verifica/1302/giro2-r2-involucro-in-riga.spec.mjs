// Verifica #1302, giro 2, rilievo 2: una risposta intera con l'involucro giusto e una frase sulla stessa riga
// («Certo! {…}», «{…} Spero ti sia utile!») si mostrava e si eseguiva; ora si vede l'involucro grezzo e le azioni si perdono.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'tests', 'unit', 'x.mjs'));
for (const f of ['constants', 'chatErrors', 'scryfallQuery']) require(`../../src/shared/${f}.js`);
const Q = globalThis.SN_SCRYFALL_Q;

const src = readFileSync(join(process.cwd(), 'src', 'content', 'sidebar.js'), 'utf8');
const i = src.indexOf('  function parseAssistantOutput(');
let j = src.indexOf('{', src.indexOf(')', i));
for (let k = j, d = 0; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && !--d) { j = k + 1; break; } }
// eslint-disable-next-line no-unused-vars
const azioniDiPagina = () => ({});
const aiuto = eval(`(${src.slice(i, j).trim()})`);

test('r2 Aiuto: «Certo! {…}» mostra il testo e indica il pulsante', async () => {
  const r = aiuto('Certo! {"text":"Clicca su Salva in alto a destra.","highlight":{"selector":"#salva"},"status":"waiting"}', 'stop');
  expect(r.display).toBe('Clicca su Salva in alto a destra.');
  expect(r.highlight).toBeTruthy();
});

test('r2 mazzi: una frase sulla stessa riga dell\'involucro non spegne la ricerca', async () => {
  const prima = Q.parseAgentReply('Certo! {"reply":"Ecco gli artefatti che danno mana.","query":"t:artifact"}', 'stop');
  expect(prima.reply).toBe('Ecco gli artefatti che danno mana.');
  expect(prima.query).toBe('t:artifact');
  const dopo = Q.parseAgentReply('{"reply":"Ecco gli artefatti.","query":"t:artifact"} Spero ti sia utile!', 'stop');
  expect(dopo.query).toBe('t:artifact');
});
