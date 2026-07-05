// Unit test dell'handler di import/export testuale e dell'import via chat
// (src/main/services/handlers/scryfall.js, DECK-BUILDER-SPEC.md §11). Stesso
// harness di tests/unit/testDefaultModel.test.mjs: si registra l'handler con
// `on`/`ctx` finti e si stubbano SN_SCRYFALL/SN_DECK_STORE — niente rete, niente
// Electron. Copre il percorso reale (main→handler→modello) che gli unit test di
// deckImportExport.js e decks.js (puri) non toccano.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'messages.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'decks.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'scryfallQuery.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'deckImportExport.js'));

const { MSG } = globalThis.SN_MSG;
const Decks = globalThis.SN_DECKS;

// Mini catalogo Scryfall finto, risolto per nome (SN_SCRYFALL.named) o id.
const CATALOG = [
  { id: 'sol-ring', name: 'Sol Ring', manaCost: '{1}', cmc: 1, typeLine: 'Artifact', colors: [], colorIdentity: [], image: '', artCrop: '', priceEur: 1.5, producedMana: [], oracleText: '', legalCommander: true, scryfallUri: '' },
  { id: 'forest', name: 'Forest', manaCost: '', cmc: 0, typeLine: 'Basic Land — Forest', colors: [], colorIdentity: ['G'], image: '', artCrop: '', priceEur: 0.1, producedMana: ['G'], oracleText: '', legalCommander: true, scryfallUri: '' },
  { id: 'niv-1', name: 'Niv-Mizzet, Parun', manaCost: '{U}{U}{U}{R}{R}{R}', cmc: 6, typeLine: 'Legendary Creature — Dragon Wizard', colors: ['U', 'R'], colorIdentity: ['U', 'R'], image: '', artCrop: '', priceEur: 3, producedMana: [], oracleText: '', legalCommander: true, scryfallUri: '' },
];
const byName = (n) => CATALOG.find((c) => c.name.toLowerCase() === String(n).trim().toLowerCase()) || null;
const byId = (id) => CATALOG.find((c) => c.id === id) || null;

globalThis.SN_SCRYFALL = {
  named: async (name) => byName(name),
  card: async (id) => byId(id),
  cards: async (ids) => {
    const out = {};
    for (const id of (ids || [])) { const c = byId(id); if (c) out[id] = c; }
    return out;
  },
  search: async () => ({ cards: [], hasMore: false, query: '' }),
};

// Store in-memory: get/put/list, come deckStore.js reale ma senza disco.
const db = new Map();
globalThis.SN_DECK_STORE = {
  get: async (id) => db.get(id) || null,
  put: async (deck) => { db.set(deck.id, deck); return deck; },
  list: async () => [...db.values()],
};

let aiReply = '{}';
const registerScryfall = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'handlers', 'scryfall.js'));
const handlers = new Map();
registerScryfall((type, fn) => handlers.set(type, fn), {
  MSG,
  handleAIRequest: async () => ({ text: aiReply }),
});
const call = (type, msg) => handlers.get(type)(msg);

function seedDeck() {
  const d = Decks.newDeck({ nome: 'Test' });
  db.set(d.id, d);
  return d;
}

beforeEach(() => { db.clear(); aiReply = '{}'; });

// ── DECKS_IMPORT_PREVIEW ─────────────────────────────────────────────────────

test('DECKS_IMPORT_PREVIEW: risolve nomi validi, segnala non-trovati e righe sporche separatamente', async () => {
  const deck = seedDeck();
  const r = await call(MSG.DECKS_IMPORT_PREVIEW, {
    id: deck.id,
    text: '1 Sol Ring\n10 Forest\n1 Nome Che Non Esiste\nriga senza quantità',
  });
  assert.equal(r.ok, true);
  assert.equal(r.entries.length, 3);
  assert.equal(r.entries[0].card.id, 'sol-ring');
  assert.equal(r.entries[1].card.id, 'forest');
  assert.equal(r.entries[1].qty, 10);
  assert.equal(r.entries[2].card, null); // "Nome Che Non Esiste": non risolto, ma NON sporco (era ben formato)
  assert.deepEqual(r.dirtyLines, ['riga senza quantità']);
});

test('DECKS_IMPORT_PREVIEW: mazzo inesistente → errore, non crash', async () => {
  const r = await call(MSG.DECKS_IMPORT_PREVIEW, { id: 'ghost', text: '1 Sol Ring' });
  assert.equal(r.ok, false);
});

// ── DECKS_IMPORT_APPLY ───────────────────────────────────────────────────────

test('DECKS_IMPORT_APPLY: scrive le carte confermate; NON sovrascrive un commander già impostato', async () => {
  const deck = seedDeck();
  const withCommander = Decks.setCommander(deck, 'niv-1', { name: 'Niv-Mizzet, Parun', colors: ['U', 'R'], artCrop: '' });
  db.set(withCommander.id, withCommander);

  const r = await call(MSG.DECKS_IMPORT_APPLY, {
    id: withCommander.id,
    entries: [{ scryfallId: 'sol-ring', qty: 1 }, { scryfallId: 'forest', qty: 10 }],
    commanderId: 'sol-ring', // candidato diverso: deve essere ignorato, il mazzo ha già un commander
  });
  assert.equal(r.ok, true);
  assert.equal(r.addedCount, 2);
  assert.equal(r.updatedCount, 0);
  assert.equal(r.deck.commander, 'niv-1');
  assert.equal(r.deck.carte.length, 2);
});

test('DECKS_IMPORT_APPLY: imposta il commander SOLO se il mazzo non ne ha uno; non diventa anche una entry', async () => {
  const deck = seedDeck();
  const r = await call(MSG.DECKS_IMPORT_APPLY, {
    id: deck.id,
    entries: [{ scryfallId: 'sol-ring', qty: 1 }],
    commanderId: 'niv-1',
  });
  assert.equal(r.ok, true);
  assert.equal(r.deck.commander, 'niv-1');
  assert.equal(r.deck.commanderMeta.name, 'Niv-Mizzet, Parun');
  assert.ok(!r.deck.carte.some((c) => c.scryfall_id === 'niv-1'), 'il commander non deve comparire come riga del mazzo (§8.4)');
});

test('DECKS_IMPORT_APPLY: re-importare aggiorna la qty di una carta già presente', async () => {
  const deck = seedDeck();
  const { deck: withCard } = Decks.importCards(deck, [{ scryfall_id: 'forest', qty: 5 }]);
  db.set(withCard.id, withCard);
  const r = await call(MSG.DECKS_IMPORT_APPLY, { id: withCard.id, entries: [{ scryfallId: 'forest', qty: 12 }] });
  assert.equal(r.ok, true);
  assert.equal(r.addedCount, 0);
  assert.equal(r.updatedCount, 1);
  assert.equal(r.deck.carte.find((c) => c.scryfall_id === 'forest').qty, 12);
});

// ── DECKS_EXPORT ─────────────────────────────────────────────────────────────

test('DECKS_EXPORT: stesso formato testuale dell\'import, round trip completo', async () => {
  const deck = seedDeck();
  const withCommander = Decks.setCommander(deck, 'niv-1', { name: 'Niv-Mizzet, Parun', colors: ['U', 'R'], artCrop: '' });
  const { deck: withCards } = Decks.importCards(withCommander, [
    { scryfall_id: 'sol-ring', qty: 1 }, { scryfall_id: 'forest', qty: 10 },
  ]);
  db.set(withCards.id, withCards);

  const exp = await call(MSG.DECKS_EXPORT, { id: withCards.id });
  assert.equal(exp.ok, true);
  assert.equal(exp.text, 'Commander\n1 Niv-Mizzet, Parun\n\nDeck\n10 Forest\n1 Sol Ring');

  // Round trip: l'export si re-importa nello stesso mazzo (o in uno nuovo)
  // recuperando commander e carte, nessuna riga sporca.
  const fresh = Decks.newDeck({ nome: 'Reimport' });
  db.set(fresh.id, fresh);
  const preview = await call(MSG.DECKS_IMPORT_PREVIEW, { id: fresh.id, text: exp.text });
  assert.equal(preview.commander.card.id, 'niv-1');
  assert.equal(preview.entries.length, 2);
  assert.deepEqual(preview.dirtyLines, []);
});

// ── DECKS_CHAT: import via LLM (§11.2) ───────────────────────────────────────

test('DECKS_CHAT: una lista incollata risolta dall\'LLM torna come CardList di conferma, mai aggiunta da sola', async () => {
  const deck = seedDeck();
  aiReply = JSON.stringify({
    reply: '',
    import: [{ name: 'Sol Ring', qty: 1 }, { name: 'Carta Inventata Che Non Esiste', qty: 2 }],
    commander: 'Niv-Mizzet, Parun',
  });
  const r = await call(MSG.DECKS_CHAT, { deckId: deck.id, text: '1 Sol Ring\n2 Carta Inventata Che Non Esiste', history: [] });
  assert.equal(r.ok, true);
  assert.ok(r.importPending, 'la risposta deve portare importPending per il bottone "Aggiungi tutte"');
  // Sol Ring + il commander risolto sono nella CardList; la carta inventata no.
  assert.equal(r.cardIds.includes('sol-ring'), true);
  assert.equal(r.cardIds.includes('niv-1'), true);
  assert.equal(r.cardIds.length, 2);
  assert.equal(r.importPending.commanderId, 'niv-1');
  assert.equal(r.importPending.qtyById['sol-ring'], 1);
  // Il mazzo NON è stato toccato: l'aggiunta è un'azione esplicita dell'utente.
  const stillEmpty = await call(MSG.DECKS_GET_UNUSED_PLACEHOLDER || 'noop', {}).catch(() => null);
  const raw = await globalThis.SN_DECK_STORE.get(deck.id);
  assert.equal(raw.carte.length, 0);
  assert.equal(raw.commander, '');
});

test('DECKS_CHAT: import senza commander e senza corrispondenze segnala i nomi non trovati', async () => {
  const deck = seedDeck();
  aiReply = JSON.stringify({ import: [{ name: 'Boh Non Esiste', qty: 1 }] });
  const r = await call(MSG.DECKS_CHAT, { deckId: deck.id, text: 'lista strana', history: [] });
  assert.equal(r.ok, true);
  assert.equal(r.cardIds.length, 0);
  assert.match(r.reply, /Boh Non Esiste/);
});
