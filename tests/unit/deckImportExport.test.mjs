// Unit test per src/shared/deckImportExport.js — parser RIGIDO e deterministico
// import/export testuale del deck builder (DECK-BUILDER-SPEC.md §11). Il test
// centrale: righe valide con quantità si riconoscono, righe senza quantità o
// illeggibili si SEGNALANO come sporche (mai indovinate — quello è il lavoro
// del parser tollerante della chat, testato in scryfallQuery.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'deckImportExport.js'));

const IE = globalThis.SN_DECK_IMPORT_EXPORT;

test('deckImportExport si registra su globalThis con la sua API', () => {
  assert.ok(IE);
  for (const fn of ['parseDecklist', 'formatDecklist']) {
    assert.equal(typeof IE[fn], 'function', `manca ${fn}`);
  }
});

test('parseDecklist: righe valide "<qty> <nome>"', () => {
  const r = IE.parseDecklist('1 Sol Ring\n10 Forest\n1x Lightning Bolt\n2 x Arcane Signet');
  assert.deepEqual(r.entries, [
    { name: 'Sol Ring', qty: 1 },
    { name: 'Forest', qty: 10 },
    { name: 'Lightning Bolt', qty: 1 },
    { name: 'Arcane Signet', qty: 2 },
  ]);
  assert.equal(r.commanderName, null);
  assert.deepEqual(r.dirtyLines, []);
});

test('parseDecklist: righe senza quantità o illeggibili → sporche, MAI indovinate', () => {
  const r = IE.parseDecklist('Sol Ring\nqualcosa di strano ###\n\n1 Arcane Signet');
  assert.deepEqual(r.entries, [{ name: 'Arcane Signet', qty: 1 }]);
  assert.deepEqual(r.dirtyLines, ['Sol Ring', 'qualcosa di strano ###']);
});

test('parseDecklist: quantità 0 → NON inclusa, segnalata come sporca (0 non diventa 1)', () => {
  const r = IE.parseDecklist('Deck\n0 Sol Ring\n1 Arcane Signet');
  // La carta a quantità 0 NON deve entrare nel mazzo (né come 1 copia).
  assert.deepEqual(r.entries, [{ name: 'Arcane Signet', qty: 1 }]);
  // Deve comparire tra le righe segnalate all'utente, non sparire in silenzio.
  assert.deepEqual(r.dirtyLines, ['0 Sol Ring']);
  // Nessuna entry può avere qty <= 0.
  assert.ok(r.entries.every((e) => e.qty >= 1));
});

test('parseDecklist: righe vuote e commenti ignorati, non contano come sporchi', () => {
  const r = IE.parseDecklist('// commento\n1 Sol Ring\n\n# altro commento\n1 Arcane Signet\n');
  assert.equal(r.entries.length, 2);
  assert.deepEqual(r.dirtyLines, []);
});

test('parseDecklist: strip di set/collector number e marcatore foil in coda', () => {
  const r = IE.parseDecklist('1 Sol Ring (LEA) 162\n1 Lightning Bolt [2ED]\n1 Godzilla, King of the Monsters *F*');
  assert.deepEqual(r.entries, [
    { name: 'Sol Ring', qty: 1 },
    { name: 'Lightning Bolt', qty: 1 },
    { name: 'Godzilla, King of the Monsters', qty: 1 },
  ]);
});

test('parseDecklist: sezione "Commander" cattura SOLO la prima riga come commander', () => {
  const r = IE.parseDecklist('Commander\n1 Korvold, Fae-Cursed King\n1 Rograkh, Son of Rohgahh\n\n1 Sol Ring');
  assert.equal(r.commanderName, 'Korvold, Fae-Cursed King');
  // Il partner commander e il resto NON si perdono: diventano entries normali.
  assert.deepEqual(r.entries, [
    { name: 'Rograkh, Son of Rohgahh', qty: 1 },
    { name: 'Sol Ring', qty: 1 },
  ]);
});

test('parseDecklist: intestazione "Deck"/"Mainboard" riporta alla modalità mazzo', () => {
  const r = IE.parseDecklist('Commander\n1 Korvold, Fae-Cursed King\nDeck\n1 Sol Ring');
  assert.equal(r.commanderName, 'Korvold, Fae-Cursed King');
  assert.deepEqual(r.entries, [{ name: 'Sol Ring', qty: 1 }]);
});

test('parseDecklist: sezione "Sideboard" è ignorata (fuori scope alpha), non sporca', () => {
  const r = IE.parseDecklist('1 Sol Ring\n\nSideboard\n1 Some Card\n2 Other Card');
  assert.deepEqual(r.entries, [{ name: 'Sol Ring', qty: 1 }]);
  assert.deepEqual(r.dirtyLines, []);
});

test('parseDecklist: intestazioni con conteggio "(N)" (Archidekt/TappedOut) riconosciute', () => {
  const r = IE.parseDecklist(
    'Commander (1)\n1 Atraxa, Praetors\' Voice\n\nDeck (2)\n1 Sol Ring\n1 Arcane Signet\n\nMaybeboard (1)\n1 Some Maybe Card'
  );
  assert.equal(r.commanderName, 'Atraxa, Praetors\' Voice');
  assert.deepEqual(r.entries, [
    { name: 'Sol Ring', qty: 1 },
    { name: 'Arcane Signet', qty: 1 },
  ]);
  assert.deepEqual(r.dirtyLines, []);
});

test('parseDecklist: conteggio "(N)" combinato col ":" finale, in entrambi gli ordini', () => {
  const a = IE.parseDecklist('Commander (1):\n1 Korvold, Fae-Cursed King');
  assert.equal(a.commanderName, 'Korvold, Fae-Cursed King');
  const b = IE.parseDecklist('Sideboard: (3)\n1 Some Card\nDeck\n1 Sol Ring');
  assert.deepEqual(b.entries, [{ name: 'Sol Ring', qty: 1 }]);
  assert.deepEqual(b.dirtyLines, []);
});

test('parseDecklist: riga vuota DENTRO Sideboard/Maybeboard non riapre il mazzo', () => {
  const r = IE.parseDecklist(
    '1 Sol Ring\n\nMaybeboard (2)\n1 Some Card\n\n1 Other Card\n\nDeck (1)\n1 Arcane Signet'
  );
  // Le carte dopo la riga vuota nel maybeboard restano FUORI; si rientra nel
  // mazzo solo con un'intestazione esplicita.
  assert.deepEqual(r.entries, [
    { name: 'Sol Ring', qty: 1 },
    { name: 'Arcane Signet', qty: 1 },
  ]);
  assert.deepEqual(r.dirtyLines, []);
});

test('parseDecklist: testo vuoto → tutto vuoto, nessun crash', () => {
  assert.deepEqual(IE.parseDecklist(''), { commanderName: null, entries: [], dirtyLines: [] });
  assert.deepEqual(IE.parseDecklist(null), { commanderName: null, entries: [], dirtyLines: [] });
});

test('formatDecklist: con commander → intestazioni "Commander"/"Deck"', () => {
  const text = IE.formatDecklist({
    commanderName: 'Korvold, Fae-Cursed King',
    entries: [{ name: 'Sol Ring', qty: 1 }, { name: 'Forest', qty: 10 }],
  });
  assert.equal(text, 'Commander\n1 Korvold, Fae-Cursed King\n\nDeck\n1 Sol Ring\n10 Forest');
});

test('formatDecklist: senza commander → solo "Deck"', () => {
  const text = IE.formatDecklist({ entries: [{ name: 'Sol Ring', qty: 1 }] });
  assert.equal(text, 'Deck\n1 Sol Ring');
});

test('round-trip: formatDecklist → parseDecklist ricostruisce le stesse entries/commander', () => {
  const original = {
    commanderName: 'Niv-Mizzet, Parun',
    entries: [{ name: 'Sol Ring', qty: 1 }, { name: 'Island', qty: 12 }],
  };
  const parsed = IE.parseDecklist(IE.formatDecklist(original));
  assert.equal(parsed.commanderName, original.commanderName);
  assert.deepEqual(parsed.entries, original.entries);
  assert.deepEqual(parsed.dirtyLines, []);
});
