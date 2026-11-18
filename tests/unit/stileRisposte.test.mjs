// #2388: le regole di stile delle risposte e le spiegazioni al passaggio stanno in ogni prompt delle chat di Filo,
// scritte una volta sola, e il marcatore che insegnano è quello che il renderer riconosce.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/politicaModelli.js');
require('../../src/shared/constants.js');
require('../../src/shared/filoMarkdown.js');
const P = globalThis.SN_CONST.PROMPTS;

const prompt = {
  'chat della home': P.filoChatStatic(),
  Aiuto: P.helpStatic(),
  Mazzi: P.decksChatStatic(),
  'Spiega (popup)': P.explain({ selection: 'x', sentence: 'y', fxLine: '' }),
  'Spiega a fondo (popup)': P.explainDeep({ selection: 'x', sentence: 'y', fxLine: '' }),
};

const RIGHE = [
  /Il grassetto solo per la cosa che l'utente deve trovare scorrendo, al massimo una per risposta/,
  /Nessun titolo: una risposta che ha bisogno di titoli è un documento, e un documento va in una pagina/,
  /Elenchi solo per cose davvero in sequenza \(passi, opzioni\); il resto in prosa/,
  /Al massimo un'immagine nel testo, quella che è la risposta/,
  /lo scrivi \{\{termine\|spiegazione\}\}/,
  /per QUESTO utente/,
  /\(profilo, preferenze, memorie\)/,
  /breve \(una o due frasi\)/,
  /Con parsimonia: mai su parole comuni/,
];

test('#2388 ogni prompt delle chat porta le regole di stile e le spiegazioni al passaggio, una volta', () => {
  for (const [dove, testo] of Object.entries(prompt)) {
    for (const r of RIGHE) assert.match(testo, r, `${dove}: manca ${r}`);
    assert.equal(testo.split('Spiegazioni al passaggio:').length - 1, 1, dove);
    assert.doesNotMatch(testo, /markdown leggero: grassetto, elenchi/, dove);
  }
});

test('#2388 il marcatore che il prompt insegna è quello che il renderer disegna', () => {
  const esempio = /lo scrivi (\{\{termine\|spiegazione\}\})/.exec(prompt['chat della home'])[1];
  assert.match(globalThis.SN_MARKDOWN.render(`Un ${esempio}.`), /<span class="filo-spiega" data-spiega="0" tabindex="0">termine<\/span>/);
});
