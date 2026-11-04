// #1302 — sentinella: le pagine che usano la risposta di un modello come dato la chiedono `intera`, così un pezzo
// fermato dal tetto torna come errore che lo dice (il main lo prova in tests/risposta-tagliata-come-dato.spec.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
// Il pezzo di sorgente dalla prima occorrenza di `da`, lungo quanto basta a contenere la sua richiesta.
const intorno = (testo, da, n = 600) => { const i = testo.indexOf(da); assert.ok(i >= 0, da); return testo.slice(i, i + n); };

test('descrizione di un\'immagine, riassunto e titolo dell\'Editor, ricerca della Gestione: chiedono la risposta intera', () => {
  assert.match(intorno(src('src/content/actions.js'), 'action: ACTIONS.DESCRIBE_IMAGE,'), /intera: true/);
  const editor = src('src/pages/editor/editor.js');
  assert.match(intorno(editor, "chiediSulDocumento(ACTIONS.EDITOR_SUMMARY", 200), /intera: true[\s\S]*intera: true/);
  assert.match(intorno(editor, "chiediSulDocumento(ACTIONS.EDITOR_TITLE", 200), /intera: true[\s\S]*intera: true/);
  assert.match(intorno(src('src/pages/manage/manage.js'), 'SN_CONST.ACTIONS.MANAGE_SEARCH', 400), /intera: true/);
  assert.match(intorno(src('src/main/services/handlers/scryfall.js'), 'payload: { messages: retryMessages }', 200), /intera: true/);
});

test('il canale delle pagine porta `intera` fino a chi chiama il modello', () => {
  const ai = src('src/main/services/handlers/ai.js');
  assert.match(ai, /const intera = msg && msg\.intera === true;/);
  assert.match(ai, /handleAIRequest\(\{ action: msg\.action, payload: msg\.payload, origin, sender, noCache, intera \}\)/);
});
