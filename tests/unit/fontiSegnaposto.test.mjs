// #1448 — le fonti della ricerca di un segnaposto: dove si cerca e in che ordine, i paragrafi di Wikipedia che parlano
// della domanda, i numeri di Wikidata con la loro data, e la fonte citata che la mette il codice, non il modello.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const F = require('../../src/main/services/fontiSegnaposto.js');

test('prima le fonti gratuite, il web solo se acceso; un dato di adesso va dritto al web', () => {
  assert.deepEqual(F.giri('wiki:it', true), ['wiki:it', 'web']);
  assert.deepEqual(F.giri('wiki:it', false), ['wiki:it']);
  assert.deepEqual(F.giri('web', true), ['web']);
  assert.deepEqual(F.giri('web', false), ['wiki:en'], 'col web spento non esce nessuna ricerca a pagamento');
  assert.deepEqual(F.giri('https://x.example', true), ['wiki:en', 'web']);
});

test('dei paragrafi di una voce restano l\'inizio e quelli che parlano della domanda, nel loro ordine', () => {
  const voce = ['Il Nasdaq è una borsa.', '== Storia ==', 'Fondato nel 1971.', 'Nel marzo 2000 il rapporto prezzo utili medio del Nasdaq superò 100.', 'Ha sede a New York.'].join('\n');
  assert.equal(F.passaggi(voce, 'Nasdaq rapporto prezzo utili 2000'), 'Il Nasdaq è una borsa.\nNel marzo 2000 il rapporto prezzo utili medio del Nasdaq superò 100.');
  assert.ok(F.passaggi('a\n'.repeat(10) + 'x'.repeat(9000), 'x', 6000).length <= 6000);
  assert.equal(F.passaggi('', 'q'), '');
});

test('Wikidata: per ogni proprietà la preferita o la più recente, con l\'unità e la data', () => {
  const q = (amount, unit, al, rank = 'normal') => ({
    rank, mainsnak: { datavalue: { type: 'quantity', value: { amount, unit } } },
    qualifiers: al ? { P585: [{ datavalue: { value: { time: `+${al}-01-01T00:00:00Z`, precision: 9 } } }] } : undefined,
  });
  const claims = {
    P1082: [q('+2700000', '1', '2011'), q('+2761632', '1', '2023'), q('+1', '1', '2024', 'deprecated')],
    P2044: [q('+21', 'http://www.wikidata.org/entity/Q11573')],
    P571: [{ rank: 'normal', mainsnak: { datavalue: { type: 'time', value: { time: '-0753-04-21T00:00:00Z', precision: 11 } } } }],
    P31: [{ rank: 'normal', mainsnak: { datavalue: { type: 'wikibase-entityid', value: { id: 'Q515' } } } }],
  };
  const dati = F.datiWikidata(claims);
  assert.deepEqual(dati.map((d) => d.prop), ['P1082', 'P2044', 'P571'], 'solo numeri e date');
  const righe = F.righeWikidata(dati, { P1082: 'popolazione', P2044: 'altitudine', Q11573: 'metro', P571: 'fondazione' });
  assert.equal(righe, 'popolazione: 2761632 (al 2023)\naltitudine: 21 metro\nfondazione: -753-04-21');
});

test('la fonte citata è quella del numero, col suo nome e indirizzo; senza data del dato vale la voce o il giorno della ricerca', () => {
  const fonti = [
    { titolo: 'Wikipedia: Cristoforo Colombo', sito: 'it.wikipedia.org', url: 'https://it.wikipedia.org/wiki/Cristoforo_Colombo', data: '2026-10-01', testo: '' },
    { titolo: 'Alphabet PE ratio', sito: 'macrotrends.net', url: 'https://www.macrotrends.net/pe', data: '', testo: '' },
  ];
  const oggi = new Date(2026, 9, 21);
  assert.equal(F.ricomponi('[1492][Arrivo di Colombo][1][12 ottobre 1492]', fonti, oggi),
    '[1492][Arrivo di Colombo][Wikipedia: Cristoforo Colombo][12 ottobre 1492][https://it.wikipedia.org/wiki/Cristoforo_Colombo]');
  assert.equal(F.ricomponi('[1492][Arrivo][1][]', fonti, oggi).split('][')[3], 'voce del 1 ottobre 2026');
  assert.equal(F.ricomponi('[27][P/E di Alphabet][2][]', fonti, oggi),
    '[27][P/E di Alphabet][macrotrends.net][cercato il 21 ottobre 2026][https://www.macrotrends.net/pe]');
  assert.equal(F.ricomponi('[27][P/E][9][2026]', fonti, oggi), '', 'una fonte che non c\'era non si cita');
  assert.equal(F.ricomponi('[][][][nessuno]', fonti, oggi), '');
  assert.equal(F.ricomponi('niente', fonti, oggi), '');
});

test('Wikipedia si chiede solo nelle lingue della lista, e la domanda va nell\'indirizzo codificata', async () => {
  const chieste = [];
  const prima = globalThis.fetch;
  globalThis.fetch = async (url) => {
    chieste.push(String(url));
    const u = new URL(url);
    const json = u.searchParams.get('list') === 'search'
      ? { query: { search: [{ title: 'Nasdaq' }] } }
      : u.hostname === 'www.wikidata.org' ? { entities: {} }
        : { query: { pages: [{ title: 'Nasdaq', extract: 'Il Nasdaq.\nPrezzo utili 100.', pageprops: { wikibase_item: 'Q82059' }, revisions: [{ timestamp: '2026-09-30T10:00:00Z' }] }] } };
    return { ok: true, json: async () => json };
  };
  try {
    const fonti = await F.wikipedia('p/e & Nasdaq', 'evil.example/x');
    assert.ok(chieste.every((u) => /^https:\/\/(?:en\.wikipedia|www\.wikidata)\.org\//.test(u)), chieste.join('\n'));
    assert.ok(chieste[0].includes('srsearch=p%2Fe%20%26%20Nasdaq'));
    assert.equal(fonti.length, 1);
    assert.equal(fonti[0].titolo, 'Wikipedia: Nasdaq');
    assert.equal(fonti[0].url, 'https://en.wikipedia.org/wiki/Nasdaq');
    assert.equal(fonti[0].data, '2026-09-30');
    assert.ok(!('q' in fonti[0]));
  } finally {
    globalThis.fetch = prima;
  }
});

test('una ricerca web non riuscita è un errore, non «nessun risultato»: chi chiama la lascia rifare', async () => {
  const prima = globalThis.SN_WEB_SEARCH;
  try {
    globalThis.SN_WEB_SEARCH = { search: async () => ({ ok: false, results: [], reason: 'tutti i provider hanno fallito' }) };
    await assert.rejects(() => F.web('Alphabet P/E ratio', ''), /non riuscita/);
    globalThis.SN_WEB_SEARCH = { search: async () => ({ ok: true, results: [] }) };
    assert.deepEqual(await F.web('Alphabet P/E ratio', ''), []);
  } finally {
    globalThis.SN_WEB_SEARCH = prima;
  }
});
