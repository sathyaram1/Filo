// Unit test per la logica pura della ricerca "a senso" della dashboard di
// gestione (src/shared/manageSearch.js): costruzione candidati/prompt, parsing
// tollerante della classifica del modello e ripiego per parole. Gira via
// `npm run test:unit` senza Electron né rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
// feedback.js dà a manageSearch il fallbackName per i titoli senza nome.
require(join(__dirname, '..', '..', 'src', 'shared', 'feedback.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'manageSearch.js'));

const S = globalThis.SN_MANAGE_SEARCH;

const FBS = [
  { _id: 'a', name: 'Dividi sezioni per owner', text: 'Raggruppa le sezioni in un\'unica icona con sotto voci.', seq: 10 },
  { _id: 'b', name: 'Pulsante X rotto', text: 'Il tasto di chiusura non funziona.', seq: 11 },
  { _id: 'c', text: 'Vorrei poter cercare i feedback vecchi.', seq: 12 }, // senza name → fallbackName
  { _id: '', name: 'senza id', text: 'da scartare', seq: 13 },            // niente id → escluso
];

test('espone le funzioni attese', () => {
  for (const fn of ['buildCandidates', 'buildPrompt', 'buildMessages', 'parseRanking', 'keywordSearch']) {
    assert.equal(typeof S[fn], 'function', `manca ${fn}`);
  }
});

test('buildCandidates: salta chi non ha id, usa il fallbackName, tronca il testo', () => {
  const cands = S.buildCandidates(FBS);
  assert.equal(cands.length, 3); // il quarto (senza id) è escluso
  assert.deepEqual(cands.map((c) => c.id), ['a', 'b', 'c']);
  // Il terzo non ha `name` → titolo derivato dal testo (non "(senza titolo)").
  assert.ok(cands[2].title.length > 0);
  assert.notEqual(cands[2].title, '(senza titolo)');
  // Testo lungo troncato a MAX_TEXT.
  const long = S.buildCandidates([{ _id: 'x', name: 't', text: 'z'.repeat(2000) }]);
  assert.ok(long[0].text.length <= S.MAX_TEXT);
});

test('buildPrompt/buildMessages: contengono la query, gli id e chiedono JSON', () => {
  const cands = S.buildCandidates(FBS);
  const p = S.buildPrompt('ricordo dove chiedevo di unire le sezioni', cands);
  assert.ok(p.includes('ricordo dove chiedevo di unire le sezioni'));
  assert.ok(p.includes('id=a') && p.includes('id=b') && p.includes('id=c'));
  assert.ok(/JSON/i.test(p));
  const msgs = S.buildMessages('q', cands);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].role, 'user');
  assert.equal(typeof msgs[0].content, 'string');
});

test('parseRanking: array JSON semplice, filtra agli id validi e conserva l\'ordine', () => {
  const valid = new Set(['a', 'b', 'c']);
  const text = '[{"id":"c","reason":"parla di cercare"},{"id":"a","reason":"unisce sezioni"}]';
  const out = S.parseRanking(text, valid);
  assert.deepEqual(out.map((r) => r.id), ['c', 'a']);
  assert.equal(out[0].reason, 'parla di cercare');
});

test('parseRanking: tollera recinti markdown, testo attorno, {results:[...]} e id ignoti/duplicati', () => {
  const valid = new Set(['a', 'b']);
  const fenced = 'Ecco:\n```json\n{"results":[{"id":"b"},{"id":"zzz"},{"id":"b"},{"id":"a"}]}\n```\ngrazie';
  const out = S.parseRanking(fenced, valid);
  // zzz (ignoto) scartato, b non duplicato: resta [b, a].
  assert.deepEqual(out.map((r) => r.id), ['b', 'a']);
});

test('parseRanking: risposta non interpretabile → [] (il chiamante ripiegherà)', () => {
  assert.deepEqual(S.parseRanking('non è json', new Set(['a'])), []);
  assert.deepEqual(S.parseRanking('', new Set(['a'])), []);
  assert.deepEqual(S.parseRanking(null, new Set(['a'])), []);
});

test('keywordSearch: trova per parole titolo+testo, ordina per pertinenza', () => {
  const out = S.keywordSearch(FBS, 'sezioni owner');
  assert.ok(out.length >= 1);
  // Il feedback "a" (titolo contiene sia "sezioni" che "owner") è il più pertinente.
  assert.equal(out[0].id, 'a');
  assert.ok(out[0].reason.length > 0);
});

test('keywordSearch: nessuna parola utile o nessun match → []', () => {
  assert.deepEqual(S.keywordSearch(FBS, 'xyzzy'), []);
  assert.deepEqual(S.keywordSearch(FBS, 'a'), []); // token < 2 char scartati
  assert.deepEqual(S.keywordSearch([], 'sezioni'), []);
});
