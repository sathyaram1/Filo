// Unit test per SN_MANAGE_REVIEW.searchFeedbackFallback — il ripiego per
// sottostringa della ricerca feedback (dashboard di gestione), usato quando la
// ricerca semantica LLM non è disponibile. Gira via `npm run test:unit` senza
// Electron né rete. Feedback #378: la ricerca deve comunque trovare il feedback
// giusto anche senza modello (asserire il SUCCESSO: il feedback atteso è tra i
// risultati, in cima).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = join(__dirname, '..', '..', 'src', 'shared');
require(join(shared, 'feedbackStatus.js'));
require(join(shared, 'feedback.js'));
require(join(shared, 'manageReview.js'));

const MR = globalThis.SN_MANAGE_REVIEW;

const FBS = [
  { _id: 'a', name: 'Colori delle schede', text: 'Vorrei poter cambiare il colore delle tab.', createdAt: '2026-01-01T00:00:00Z' },
  { _id: 'b', name: 'Riorganizza le sezioni', text: "dividere le sezioni per l'owner riorganizzandole in un'unica icona con le sotto voci", createdAt: '2026-02-01T00:00:00Z' },
  { _id: 'c', name: 'Lettura ad alta voce', text: 'Il TTS non parte su alcune pagine.', createdAt: '2026-03-01T00:00:00Z' },
];

test('searchFeedbackFallback è esposto', () => {
  assert.equal(typeof MR.searchFeedbackFallback, 'function');
});

test('trova il feedback per parole del testo (dividere sezioni)', () => {
  const res = MR.searchFeedbackFallback(FBS, 'dividere le sezioni per owner');
  assert.ok(res.length >= 1);
  assert.equal(res[0]._id, 'b'); // il più pertinente in cima
});

test('trova anche per parole del titolo e pesa il titolo più del testo', () => {
  const res = MR.searchFeedbackFallback(FBS, 'colore schede');
  assert.equal(res[0]._id, 'a');
});

test('query di soli caratteri singoli (nessun token utile) → nessun risultato', () => {
  assert.deepEqual(MR.searchFeedbackFallback(FBS, 'a e o'), []);
  assert.deepEqual(MR.searchFeedbackFallback(FBS, ''), []);
});

test('nessuna corrispondenza → lista vuota (non l\'intera lista)', () => {
  assert.deepEqual(MR.searchFeedbackFallback(FBS, 'criptovalute blockchain'), []);
});

test('a parità di punteggio ordina per recenza (più recente prima)', () => {
  const items = [
    { _id: 'vecchio', name: 'nota audio', text: '', createdAt: '2026-01-01T00:00:00Z' },
    { _id: 'nuovo', name: 'nota audio', text: '', createdAt: '2026-05-01T00:00:00Z' },
  ];
  const res = MR.searchFeedbackFallback(items, 'audio');
  assert.deepEqual(res.map((f) => f._id), ['nuovo', 'vecchio']);
});

test('usa fallbackName quando il feedback non ha name', () => {
  const items = [{ _id: 'x', text: 'parola-unica-cercabile e altro testo', createdAt: '2026-01-01T00:00:00Z' }];
  const res = MR.searchFeedbackFallback(items, 'parola-unica-cercabile');
  assert.equal(res.length, 1);
  assert.equal(res[0]._id, 'x');
});
