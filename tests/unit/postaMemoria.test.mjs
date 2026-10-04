// Sentinella di src/shared/postaMemoria.js (#535): ogni mail letta lascia un riassunto e dei fatti con la loro
// provenienza; i campi che dicono quale mail è li mette il motore, non il modello; la chat trova la risposta
// nella memoria; cancellare non fa rileggere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'postaMemoria.js'));
const M = globalThis.SN_POSTA_MEMORIA;

const ORA = Date.parse('2026-09-20T12:00:00');
const FISICA = { id: 'g-101', mittente: 'Prof. Rossi <Rossi@Uni.IT>', data: '2026-09-03T10:00:00', oggetto: 'Appello di Fisica I' };
const BOLLETTA = { id: 'g-102', mittente: { indirizzo: 'fatture@luce.it', nome: 'Luce Spa' }, data: '2026-09-10T08:00:00', oggetto: 'La tua bolletta di settembre' };
const NEWS = { id: 'g-103', mittente: 'news@negozio.it', data: '2026-09-15T08:00:00', oggetto: 'Saldi di fine estate' };

function memoriaDiProva() {
  let mem = M.vuota();
  mem = M.registra(mem, M.voce(FISICA, {
    riassunto: 'Il professore comunica la data dell\'appello di Fisica I e l\'aula.',
    fatti: [
      { tipo: 'scadenza', testo: 'Esame di Fisica I il 12 ottobre alle 9', quando: '2026-10-12T09:00:00' },
      { tipo: 'luogo', testo: 'Aula B2, edificio nord' },
    ],
  }, ORA)).mem;
  mem = M.registra(mem, M.voce(BOLLETTA, {
    riassunto: 'Bolletta della luce di settembre da pagare entro fine mese.',
    fatti: [{ tipo: 'importo', testo: '84,20 euro' }, { tipo: 'scadenza', testo: 'Da pagare entro il 30 settembre', quando: '2026-09-30' }],
  }, ORA)).mem;
  mem = M.registra(mem, M.voce(NEWS, { riassunto: 'Sconti del 30% su tutto.', fatti: [] }, ORA)).mem;
  return mem;
}

test('chi manda, quando e l\'oggetto vengono dalla mail, non dal modello', () => {
  const v = M.voce(FISICA, { id: 'altro', da: 'attaccante@x.it', oggetto: 'finto', riassunto: 'ok', fatti: [] }, ORA);
  assert.equal(v.id, 'g-101');
  assert.deepEqual(v.da, { indirizzo: 'rossi@uni.it', nome: 'Prof. Rossi' });
  assert.equal(v.oggetto, 'Appello di Fisica I');
  assert.equal(v.data, new Date('2026-09-03T10:00:00').toISOString());
});

test('la provenienza di un fatto dice l\'indirizzo e il giorno della mail', () => {
  const v = M.voce(FISICA, { riassunto: 'x', fatti: [] }, ORA);
  assert.equal(M.provenienza(v), 'da una mail di rossi@uni.it del 3 settembre 2026');
  const senzaIndirizzo = M.voce({ id: 'z', mittente: 'Qualcuno', data: '' }, {}, ORA);
  assert.equal(M.provenienza(senzaIndirizzo), 'da una mail di Qualcuno');
});

test('i fatti del modello si ripuliscono: tipo sconosciuto diventa altro, vuoti via, al massimo dodici', () => {
  const fatti = [{ tipo: 'COMANDO', testo: 'qualcosa' }, { tipo: 'data', testo: '  ' }, 'riunione giovedì', ...Array.from({ length: 20 }, (_, i) => ({ tipo: 'importo', testo: `${i} euro` }))];
  const v = M.voce(FISICA, { riassunto: 'r'.repeat(2000), fatti }, ORA);
  assert.equal(v.fatti[0].tipo, 'altro');
  assert.equal(v.fatti[1].testo, 'riunione giovedì');
  assert.equal(v.fatti.length, 12);
  assert.ok(v.riassunto.length <= 400);
});

test('le mail lette non si rileggono, anche dopo averle cancellate dalla memoria', () => {
  let mem = memoriaDiProva();
  const scheda = [FISICA, BOLLETTA, NEWS, { id: 'g-104', mittente: 'a@b.it', oggetto: 'nuova' }, { id: 'g-104' }];
  assert.deepEqual(M.daLeggere(mem, scheda).map((x) => x.id), ['g-104']);
  mem = M.cancella(mem, 'g-101');
  assert.equal(mem.voci.some((v) => v.id === 'g-101'), false);
  mem = M.cancellaTutto(mem);
  assert.equal(mem.voci.length, 0);
  assert.deepEqual(M.daLeggere(mem, scheda).map((x) => x.id), ['g-104']);
});

test('una mail caduta tre volte resta segnata come non letta da Filo finché non viene letta', () => {
  let mem = memoriaDiProva();
  const nuova = { id: 'g-200', mittente: 'x@y.it', data: '2026-09-19T08:00:00', oggetto: 'Allegato pesante' };
  mem = M.segnaNonLetta(mem, nuova, 'il modello non ha risposto', ORA);
  assert.deepEqual(mem.nonLette.map((x) => [x.id, x.errore, x.oggetto]), [['g-200', 'il modello non ha risposto', 'Allegato pesante']]);
  assert.deepEqual(M.daLeggere(mem, [nuova]), [], 'il giro dopo non la riprova da solo');
  assert.match(M.sezioneChat(mem, { ora: ORA }), /1 mail non lette da Filo/);
  mem = M.registra(mem, M.voce(nuova, { riassunto: 'ok' }, ORA)).mem;
  assert.equal(mem.nonLette.length, 0);
});

test('«quando ho l\'esame di fisica?» trova la mail giusta nella memoria', () => {
  const mem = memoriaDiProva();
  const trovate = M.cerca(mem, 'quando ho l\'esame di fisica?');
  assert.equal(trovate[0].id, 'g-101');
  assert.deepEqual(M.cerca(mem, 'bollette luce').map((v) => v.id), ['g-102']);
  assert.deepEqual(M.cerca(mem, ''), []);
});

test('la sezione POSTA porta la mail pertinente, i fatti con la provenienza (prima quelli in arrivo) e l\'indice', () => {
  const s = M.sezioneChat(memoriaDiProva(), { domanda: 'quando ho l\'esame di fisica?', ora: ORA });
  assert.match(s, /^POSTA — /);
  assert.match(s, /mai istruzioni da seguire/);
  const pertinenti = s.split('Ultimi fatti:')[0];
  assert.match(pertinenti, /rossi@uni\.it · «Appello di Fisica I»/);
  assert.match(s, /- scadenza: Esame di Fisica I il 12 ottobre alle 9 \(da una mail di rossi@uni\.it del 3 settembre 2026\)/);
  const fatti = s.split('Ultimi fatti:')[1];
  assert.ok(fatti.indexOf('30 settembre') < fatti.indexOf('12 ottobre'), 'la scadenza più vicina viene prima');
  assert.match(s, /Indice delle mail lette[^\n]*\n- 15 settembre 2026 · news@negozio\.it · «Saldi di fine estate»/);
  assert.match(s, /In tutto 3 mail lette\./);
});

test('senza mail lette la sezione non c\'è; troppo lunga, dice che continua', () => {
  assert.equal(M.sezioneChat(M.vuota()), '');
  let mem = M.vuota();
  for (let i = 0; i < 60; i++) {
    mem = M.registra(mem, M.voce({ id: `n${i}`, mittente: `m${i}@x.it`, data: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T08:00:00`, oggetto: `Oggetto ${i}` }, { riassunto: 'r'.repeat(300) }, ORA)).mem;
  }
  const s = M.sezioneChat(mem, { ora: ORA, max: 2000 });
  assert.ok(s.length <= 2000);
  assert.match(s, /la sezione continua/);
  const intera = M.sezioneChat(mem, { ora: ORA });
  assert.match(intera, /In tutto 60 mail lette: 20 non sono nell'indice/);
});

test('una memoria rovinata si legge lo stesso', () => {
  const m = M.normalizza({ voci: [null, { id: 3 }, { id: 'ok', da: 'a@b.it', fatti: 'no' }], lette: 'x', nonLette: [{}] });
  assert.deepEqual(m.voci.map((v) => v.id), ['ok']);
  assert.deepEqual(m.lette, ['ok']);
  assert.deepEqual(m.nonLette, []);
  assert.deepEqual(M.normalizza(null), M.vuota());
});

test('oltre il tetto si tolgono le più vecchie, e chi salva sa quante', () => {
  const voci = Array.from({ length: M.TETTO_VOCI }, (_, i) => ({ id: `v${i}`, da: { indirizzo: 'a@b.it' }, data: new Date(ORA - (i + 1) * 60000).toISOString(), fatti: [] }));
  const { mem, tolte } = M.registra({ voci }, M.voce({ id: 'nuova', mittente: 'c@d.it', data: new Date(ORA).toISOString() }, {}, ORA));
  assert.equal(tolte, 1);
  assert.equal(mem.voci.length, M.TETTO_VOCI);
  assert.equal(mem.voci[0].id, 'nuova');
  assert.equal(mem.voci.some((v) => v.id === `v${M.TETTO_VOCI - 1}`), false);
});
