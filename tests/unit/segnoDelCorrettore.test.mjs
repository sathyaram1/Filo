// #1509 — `data-filo-native-word` sull'html del sito è la parola sbagliata dell'utente: serve solo agli spec. Il main lo
// chiede solo nelle prove, e il content script lo scrive solo se chiesto. Il riquadro lo prova tests/spellcheck.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leggi = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test('il main chiede il segno del correttore solo nelle prove', () => {
  const tabs = leggi('src/main/tabs.js');
  const i = tabs.indexOf("type: '_spell:native'");
  assert.ok(i > 0);
  assert.match(tabs.slice(i, i + 400), /segnoPerLeProve: process\.env\.NODE_ENV === 'test'/);
});

test('il content script scrive il segno solo se il main lo chiede, e mai da un riquadro di Filo', () => {
  const s = leggi('src/content/spellcheck.js');
  const scritture = [...s.matchAll(/dataset\.filoNativeWord\s*=/g)];
  assert.equal(scritture.length, 1);
  const prima = s.slice(Math.max(0, scritture[0].index - 300), scritture[0].index);
  assert.match(prima, /m\.segnoPerLeProve === true && !global\.SN_FILO_UI\?\.eRiquadro\?\.\(document\.activeElement\)/);
});
