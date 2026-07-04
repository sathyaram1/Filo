// Unit test per src/shared/scryfallQuery.js — logica pura del client Scryfall:
// vincolo automatico di color identity sulle query (§4), parsing dei costi di
// mana, semplificazione delle carte (incluse le due facce), TTL cache.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'scryfallQuery.js'));

const Q = globalThis.SN_SCRYFALL_Q;

// ── identityCode / buildSearchQuery ──────────────────────────────────────────

test('identityCode: ordina in WUBRG, scarta ignoti, incolore → C', () => {
  assert.equal(Q.identityCode(['R', 'U']), 'UR');
  assert.equal(Q.identityCode(['G', 'W', 'B']), 'WBG');
  assert.equal(Q.identityCode([]), 'C');
  assert.equal(Q.identityCode(['X', 'u']), 'U');
});

test('buildSearchQuery: aggiunge id<= con l\'identity del commander (§4)', () => {
  assert.equal(Q.buildSearchQuery('haste', ['U', 'R']), 'haste id<=UR');
  assert.equal(Q.buildSearchQuery('t:artifact cmc<3', []), 't:artifact cmc<3 id<=C');
});

test('buildSearchQuery: un vincolo id esplicito dell\'utente passa invariato', () => {
  assert.equal(Q.buildSearchQuery('t:goblin id:R', ['U', 'R']), 't:goblin id:R');
  assert.equal(Q.buildSearchQuery('ramp id<=G', ['W']), 'ramp id<=G');
  assert.equal(Q.buildSearchQuery('draw identity<=UB', ['W']), 'draw identity<=UB');
});

test('buildSearchQuery: senza identity (nessun commander) la query resta libera', () => {
  assert.equal(Q.buildSearchQuery('sol ring', null), 'sol ring');
  assert.equal(Q.buildSearchQuery('sol ring', undefined), 'sol ring');
});

// ── parseManaCost ────────────────────────────────────────────────────────────

test('parseManaCost: {2}{U}{R} → [2, U, R]; ibridi e X inclusi', () => {
  assert.deepEqual(Q.parseManaCost('{2}{U}{R}'), ['2', 'U', 'R']);
  assert.deepEqual(Q.parseManaCost('{X}{G/W}{G/W}'), ['X', 'G/W', 'G/W']);
  assert.deepEqual(Q.parseManaCost(''), []);
  assert.deepEqual(Q.parseManaCost(null), []);
});

// ── simplifyCard ─────────────────────────────────────────────────────────────

const API_CARD = {
  id: 'abc-123',
  name: 'Niv-Mizzet, Parun',
  mana_cost: '{U}{U}{U}{R}{R}{R}',
  cmc: 6,
  type_line: 'Legendary Creature — Dragon Wizard',
  colors: ['U', 'R'],
  color_identity: ['U', 'R'],
  image_uris: { normal: 'https://cards/normal.jpg', art_crop: 'https://cards/art.jpg' },
  prices: { eur: '3.21' },
  legalities: { commander: 'legal' },
  scryfall_uri: 'https://scryfall.com/card/x',
};

test('simplifyCard: campi essenziali estratti e tipizzati', () => {
  const c = Q.simplifyCard(API_CARD);
  assert.equal(c.id, 'abc-123');
  assert.equal(c.manaCost, '{U}{U}{U}{R}{R}{R}');
  assert.equal(c.cmc, 6);
  assert.deepEqual(c.colorIdentity, ['U', 'R']);
  assert.equal(c.image, 'https://cards/normal.jpg');
  assert.equal(c.artCrop, 'https://cards/art.jpg');
  assert.equal(c.priceEur, 3.21);
  assert.equal(c.legalCommander, true);
});

test('simplifyCard: carta a due facce — immagini e costo dalle card_faces', () => {
  const c = Q.simplifyCard({
    id: 'dfc-1',
    name: 'Delver of Secrets // Insectile Aberration',
    cmc: 1,
    color_identity: ['U'],
    card_faces: [
      { name: 'Delver of Secrets', mana_cost: '{U}', type_line: 'Creature — Human Wizard',
        colors: ['U'], image_uris: { normal: 'https://cards/front.jpg', art_crop: 'https://cards/front-art.jpg' } },
      { name: 'Insectile Aberration', mana_cost: '', type_line: 'Creature — Human Insect',
        image_uris: { normal: 'https://cards/back.jpg' } },
    ],
    prices: {},
    legalities: { commander: 'legal' },
  });
  assert.equal(c.manaCost, '{U}');
  assert.equal(c.typeLine, 'Creature — Human Wizard');
  assert.equal(c.image, 'https://cards/front.jpg');
  assert.equal(c.artCrop, 'https://cards/front-art.jpg');
  assert.equal(c.priceEur, null, 'prezzo assente → null, non NaN');
});

test('simplifyCard: banned/non legale → legalCommander false; input rotto → null', () => {
  const banned = Q.simplifyCard({ ...API_CARD, legalities: { commander: 'banned' } });
  assert.equal(banned.legalCommander, false);
  assert.equal(Q.simplifyCard(null), null);
  assert.equal(Q.simplifyCard({ name: 'senza id' }), null);
});

// ── isFresh (TTL cache) ──────────────────────────────────────────────────────

test('isFresh: dentro il TTL sì, oltre no, timestamp rotto no', () => {
  const now = Date.parse('2026-07-02T12:00:00.000Z');
  const ttl = 6 * 60 * 60 * 1000;
  assert.equal(Q.isFresh('2026-07-02T11:00:00.000Z', ttl, now), true);
  assert.equal(Q.isFresh('2026-07-02T05:00:00.000Z', ttl, now), false);
  assert.equal(Q.isFresh(now - 1000, ttl, now), true, 'accetta anche epoch ms');
  assert.equal(Q.isFresh('boh', ttl, now), false);
  assert.equal(Q.isFresh(null, ttl, now), false);
});

// ── parseAgentReply (chat unificata §3): JSON tollerante ─────────────────────

const NONE = { reply: '', query: '', cards: [], hasBudget: false, budget: null, prob: null, evaluate: '', tagWith: [] };

test('parseAgentReply: JSON pulito → campi normalizzati', () => {
  const r = Q.parseAgentReply('{"reply":"Ecco","query":"o:haste","cards":["a","b"]}');
  assert.deepEqual(r, { ...NONE, reply: 'Ecco', query: 'o:haste', cards: ['a', 'b'] });
});

test('parseAgentReply: tollera fence ```json e testo attorno', () => {
  const fenced = 'Certo!\n```json\n{"query":"t:dragon"}\n```\ngrazie';
  assert.equal(Q.parseAgentReply(fenced).query, 't:dragon');
  const attorno = 'premessa {"reply":"ok","cards":[]} coda';
  assert.equal(Q.parseAgentReply(attorno).reply, 'ok');
});

test('parseAgentReply: non-JSON → il testo grezzo diventa reply', () => {
  const r = Q.parseAgentReply('Non ho capito la richiesta');
  assert.deepEqual(r, { ...NONE, reply: 'Non ho capito la richiesta' });
});

test('parseAgentReply: campi mancanti/tipi sbagliati → default sicuri', () => {
  assert.deepEqual(Q.parseAgentReply('{"query":42,"cards":"no"}'), NONE);
  assert.deepEqual(Q.parseAgentReply(''), NONE);
  assert.deepEqual(Q.parseAgentReply(null), NONE);
});

test('parseAgentReply: budget — numero imposta, null rimuove, spazzatura si ignora', () => {
  assert.deepEqual(Q.parseAgentReply('{"budget":40}'), { ...NONE, hasBudget: true, budget: 40 });
  assert.deepEqual(Q.parseAgentReply('{"budget":"25"}'), { ...NONE, hasBudget: true, budget: 25 });
  assert.deepEqual(Q.parseAgentReply('{"budget":null}'), { ...NONE, hasBudget: true, budget: null });
  assert.deepEqual(Q.parseAgentReply('{"budget":"boh"}'), NONE);
  assert.deepEqual(Q.parseAgentReply('{"budget":-5}'), NONE);
});

test('parseAgentReply: prob — needs come oggetto o array, tag normalizzati, invalidi scartati', () => {
  const asObj = Q.parseAgentReply('{"prob":{"turn":10,"needs":{"Ramp":2,"terre":3}}}');
  assert.deepEqual(asObj.prob, { turn: 10, needs: [{ tag: 'ramp', n: 2 }, { tag: 'terre', n: 3 }] });
  const asArr = Q.parseAgentReply('{"prob":{"turn":"4","needs":[{"tag":"Draw","n":"1"}]}}');
  assert.deepEqual(asArr.prob, { turn: 4, needs: [{ tag: 'draw', n: 1 }] });
  assert.equal(Q.parseAgentReply('{"prob":{"turn":0,"needs":{"a":1}}}').prob, null);
  assert.equal(Q.parseAgentReply('{"prob":{"turn":5,"needs":{"a":0}}}').prob, null);
  assert.equal(Q.parseAgentReply('{"prob":"domani"}').prob, null);
});

test('parseAgentReply: evaluate — "deck"/"results" passano, true legacy → deck, altro si scarta', () => {
  assert.equal(Q.parseAgentReply('{"evaluate":"deck"}').evaluate, 'deck');
  assert.equal(Q.parseAgentReply('{"evaluate":"results"}').evaluate, 'results');
  assert.equal(Q.parseAgentReply('{"evaluate":true}').evaluate, 'deck');
  assert.equal(Q.parseAgentReply('{"evaluate":"tutto"}').evaluate, '');
  assert.equal(Q.parseAgentReply('{}').evaluate, '');
});

test('parseAgentReply: tagWith — tag normalizzati minuscoli, spazzatura scartata', () => {
  assert.deepEqual(Q.parseAgentReply('{"tagWith":["Ramp"," DRAW ",""]}').tagWith, ['ramp', 'draw']);
  assert.deepEqual(Q.parseAgentReply('{"tagWith":"ramp"}').tagWith, []);
});

// ── proseSegments ([[Nome Carta]] §3.5) ──────────────────────────────────────

test('proseSegments: spezza la prosa sui marcatori [[...]]', () => {
  assert.deepEqual(Q.proseSegments('Prova [[Sol Ring]] e [[Arcane Signet]].'), [
    { type: 'text', text: 'Prova ' },
    { type: 'card', name: 'Sol Ring' },
    { type: 'text', text: ' e ' },
    { type: 'card', name: 'Arcane Signet' },
    { type: 'text', text: '.' },
  ]);
});

test('proseSegments: testo senza marcatori / vuoto / marcatore vuoto', () => {
  assert.deepEqual(Q.proseSegments('solo testo'), [{ type: 'text', text: 'solo testo' }]);
  assert.deepEqual(Q.proseSegments(''), []);
  assert.deepEqual(Q.proseSegments('a [[ ]] b'), [
    { type: 'text', text: 'a ' },
    { type: 'text', text: '[[ ]]' },
    { type: 'text', text: ' b' },
  ]);
});
