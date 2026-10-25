// La cadenza dei compiti ricorrenti (#1153, SPEC-DOMANDE.md §4.1): ora italiana coi cambi d'orario, la prossima
// istanza strettamente dopo, il testo per la scheda, i campi controllati coi tetti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'ricorrenti.js'));
const R = globalThis.SN_RICORRENTI;
const iso = (ms) => new Date(ms).toISOString();

test('la prossima istanza è in ora italiana, d’estate e d’inverno, e mai l’istante stesso', () => {
  const lun = { giorni: [1], ora: '01:00' };
  assert.equal(iso(R.prossimaIl(lun, Date.parse('2026-10-25T00:30:00Z'))), '2026-10-26T00:00:00.000Z', 'dopo il ritorno all’ora solare: +1');
  assert.equal(iso(R.prossimaIl({ giorni: [3], ora: '12:00' }, Date.parse('2026-07-01T09:59:00Z'))), '2026-07-01T10:00:00.000Z', 'ora legale: +2');
  assert.equal(iso(R.prossimaIl({ giorni: [3], ora: '12:00' }, Date.parse('2026-07-01T10:00:00Z'))), '2026-07-08T10:00:00.000Z', 'all’istante dell’istanza vale la settimana dopo');
  assert.equal(iso(R.prossimaIl({ giorni: [0, 1, 2, 3, 4, 5, 6], ora: '06:00' }, Date.parse('2026-10-25T05:30:00Z'))), '2026-10-26T05:00:00.000Z');
});

test('nell’ora che salta vale l’ora dopo, in quella che si ripete la prima', () => {
  assert.equal(iso(R.prossimaIl({ giorni: [0], ora: '02:30' }, Date.parse('2026-03-28T12:00:00Z'))), '2026-03-29T01:30:00.000Z');
  assert.equal(iso(R.prossimaIl({ giorni: [0], ora: '02:30' }, Date.parse('2026-10-24T12:00:00Z'))), '2026-10-25T00:30:00.000Z');
});

test('la cadenza si dice come la direbbe l’owner, con la domenica in fondo', () => {
  assert.equal(R.cadenzaTesto({ giorni: [6, 5, 4, 3, 2, 1, 0], ora: '06:00' }), 'ogni giorno alle 06:00');
  assert.equal(R.cadenzaTesto({ giorni: [1], ora: '01:00' }), 'il lunedì alle 01:00');
  assert.equal(R.cadenzaTesto({ giorni: [0], ora: '00:30' }), 'la domenica alle 00:30');
  assert.equal(R.cadenzaTesto({ giorni: [1, 2, 3, 4, 5], ora: '08:00' }), 'dal lunedì al venerdì alle 08:00');
  assert.equal(R.cadenzaTesto({ giorni: [0, 4, 1], ora: '09:30' }), 'lunedì, giovedì e domenica alle 09:30');
  assert.equal(R.cadenzaTesto({ giorni: [], ora: '09:30' }), '');
});

test('i campi: nome e testo obbligatori, tetti rifiutati col numero, cadenza ripulita', () => {
  const base = { nome: ' Riordino ', testo: ' fai ', giorni: [1, 1, 0], ora: '01:00' };
  assert.deepEqual(R.validaCampi(base), { ok: true, campi: { nome: 'Riordino', testo: 'fai', domandaFineTurno: '', attivo: true, giorni: [0, 1], ora: '01:00' } });
  assert.equal(R.validaCampi(Object.assign({}, base, { nome: '   ' })).errore, 'nome_mancante');
  assert.equal(R.validaCampi(Object.assign({}, base, { testo: '' })).errore, 'testo_mancante');
  const lungo = R.validaCampi(Object.assign({}, base, { testo: 'x'.repeat(R.TETTI.testo + 1) }));
  assert.equal(lungo.errore, 'troppo_lungo');
  assert.match(lungo.dettaglio, /40001 caratteri, il massimo è 40000/);
  assert.equal(R.validaCampi(Object.assign({}, base, { ora: '24:00' })).errore, 'ora_non_valida');
  assert.equal(R.validaCampi(Object.assign({}, base, { giorni: [7] })).errore, 'giorni_non_validi');
  assert.equal(R.validaCampi(Object.assign({}, base, { giorni: [] })).errore, 'giorni_mancanti');
  assert.equal(R.validaCampi(Object.assign({}, base, { attivo: 'si' })).errore, 'attivo_non_valido');
  assert.equal(R.validaCampi(Object.assign({}, base, { attivo: false })).campi.attivo, false);
});

test('quando: giorno, data e ora italiana', () => {
  assert.equal(R.quandoTesto(Date.parse('2026-10-26T00:00:00Z')), 'lun 26/10 01:00');
  assert.equal(R.quandoTesto(0), '');
});
