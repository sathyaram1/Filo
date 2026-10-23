// #413 — quali schede chiude CHIUDI_SCHEDE: i numeri dell'elenco che il modello aveva davanti, un sito, o tutte tranne
// alcune; la scheda della chat resta sempre, e un «tutte» lascia il testo non inviato e i siti tenuti sempre aperti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const { risolvi } = require('../../src/main/services/chiudiSchede.js');
require('../../src/shared/actionLevels.js');
const AL = globalThis.SN_ACTION_LEVELS;

// La finestra: la chat (1) davanti, poi le pagine nell'ordine dell'elenco.
const SCHEDE = [
  { id: 1, url: 'filo://newtab/' },
  { id: 2, url: 'https://www.youtube.com/watch?v=a' },
  { id: 3, url: 'https://mail.google.com/mail/u/0/' },
  { id: 4, url: 'https://m.youtube.com/watch?v=b' },
  { id: 5, url: 'https://example.com/' },
];
const VISTE = [1, 2, 3, 4, 5];
const base = { schede: SCHEDE, viste: VISTE, chat: 1 };
const ids = (r) => r.chiudere.map((t) => t.id);

test('«chiudi tutte tranne questa»: restano solo la chat', () => {
  const r = risolvi({ tutte: true }, base);
  assert.deepEqual(ids(r), [2, 3, 4, 5]);
  assert.deepEqual(r.restano, []);
});

test('«tutte tranne Gmail»: i numeri di `tranne` restano, anche senza `tutte`', () => {
  assert.deepEqual(ids(risolvi({ tutte: true, tranne: [3] }, base)), [2, 4, 5]);
  assert.deepEqual(ids(risolvi({ tranne: [3] }, base)), [2, 4, 5]);
  assert.deepEqual(ids(risolvi({ tutte: 'true', tranne: '3' }, base)), [2, 4, 5]);
});

test('per numero: quelle dette, nell\'ordine dell\'elenco e non della barra', () => {
  const viste = [1, 5, 4, 3, 2];
  assert.deepEqual(ids(risolvi({ schede: [2, 4] }, { ...base, viste })), [5, 3]);
  assert.deepEqual(ids(risolvi({ schede: '2, 4' }, { ...base, viste })), [5, 3]);
  assert.deepEqual(ids(risolvi({ schede: 2 }, { ...base, viste })), [5]);
});

test('per sito: tutte le sue schede, sottodomini compresi, col nome o col dominio', () => {
  assert.deepEqual(ids(risolvi({ sito: 'youtube.com' }, base)), [2, 4]);
  assert.deepEqual(ids(risolvi({ sito: 'YouTube' }, base)), [2, 4]);
  assert.deepEqual(ids(risolvi({ sito: 'https://www.youtube.com/feed' }, base)), [2, 4]);
  const nessuna = risolvi({ sito: 'netflix.com' }, base);
  assert.deepEqual(ids(nessuna), []);
  assert.equal(nessuna.sito, 'netflix.com');
});

test('la scheda della chat non si chiude mai, e se era stata nominata lo si dice', () => {
  const r = risolvi({ schede: [1, 2] }, base);
  assert.deepEqual(ids(r), [2]);
  assert.deepEqual(r.restano.map((x) => [x.tab.id, x.perche]), [[1, 'chat']]);
  assert.deepEqual(risolvi({ tutte: true }, base).restano, [], 'in un «tutte» la chat resta in silenzio');
});

test('in blocco restano il testo non inviato e, a «tutte», i siti sempre aperti; per numero si chiudono', () => {
  const resta = (tab, modo) => (tab.id === 3 ? 'testo' : tab.id === 5 && modo === 'tutte' ? 'sempre' : '');
  const tutte = risolvi({ tutte: true }, { ...base, resta });
  assert.deepEqual(ids(tutte), [2, 4]);
  assert.deepEqual(tutte.restano.map((x) => [x.tab.id, x.perche]), [[3, 'testo'], [5, 'sempre']]);
  assert.deepEqual(ids(risolvi({ schede: [3, 5] }, { ...base, resta })), [3, 5]);
  assert.deepEqual(ids(risolvi({ sito: 'example.com' }, { ...base, resta })), [5]);
});

test('una scheda aperta dopo l\'elenco non la prende un «tutte»', () => {
  const schede = [...SCHEDE, { id: 9, url: 'https://nuova.example/' }];
  const r = risolvi({ tutte: true }, { ...base, schede });
  assert.deepEqual(ids(r), [2, 3, 4, 5]);
  assert.deepEqual(r.restano.map((x) => [x.tab.id, x.perche]), [[9, 'nuova']]);
});

test('una scheda del numero già chiusa si dice, senza toccarne un\'altra', () => {
  const r = risolvi({ schede: [2] }, { ...base, schede: SCHEDE.filter((t) => t.id !== 2) });
  assert.deepEqual(ids(r), []);
  assert.deepEqual(r.restano, [{ tab: null, numero: 2, perche: 'chiusa' }]);
});

test('numeri fuori elenco, numeri finti o nessuna indicazione: errore che dice come rimediare', () => {
  assert.match(risolvi({ schede: [7] }, base).errore, /non c'è il numero 7.*da 1 a 5/);
  assert.match(risolvi({ schede: [13] }, { ...base, viste: Array.from({ length: 20 }, (_, i) => i + 1), numerate: 12 }).errore, /da 1 a 12/);
  assert.match(risolvi({ schede: ['la terza'] }, base).errore, /numero/);
  assert.match(risolvi({ schede: [0] }, base).errore, /numero/);
  assert.match(risolvi({ tranne: [2.5] }, base).errore, /numero/);
  assert.match(risolvi({}, base).errore, /indica quali/);
  assert.match(risolvi({ tutte: false, schede: [] }, base).errore, /indica quali/);
});

test('costo: una scheda si disfa, più d\'una insieme è il freno dei colpi multipli', () => {
  assert.equal(AL.costoFor({ type: 'CHIUDI_SCHEDE', _targets: ['YouTube'] }), 1);
  assert.equal(AL.costoFor({ type: 'CHIUDI_SCHEDE', _targets: ['YouTube', 'Gmail'] }), 2);
  assert.equal(AL.costoFor({ type: 'CHIUDI_SCHEDE', tutte: true }), 2, 'senza il conto del main vale il caso prudente');
});

test('il popup nomina le schede dentro il riquadro e dice dove ritrovarle', () => {
  const parti = AL.describeParts({ type: 'CHIUDI_SCHEDE', _targets: ['YouTube', 'Gmail'] });
  assert.ok(parti.some((p) => p && Array.isArray(p.elenco) && p.elenco.includes('YouTube')));
  assert.match(AL.describe({ type: 'CHIUDI_SCHEDE', _targets: ['YouTube', 'Gmail'] }), /queste 2 schede[\s\S]*filo della home/);
  const molte = Array.from({ length: 20 }, (_, i) => `pagina ${i + 1}`);
  assert.match(AL.describe({ type: 'CHIUDI_SCHEDE', _targets: molte }), /…e altre 5/);
  assert.equal(AL.describeDone({ type: 'CHIUDI_SCHEDE', _output: { chiuse: 3 } }), 'Chiuse 3 schede: restano nel filo della home');
  assert.equal(AL.describeDone({ type: 'CHIUDI_SCHEDE', _output: { chiuse: 1 }, _inIncognito: true }), 'Chiusa una scheda');
});
