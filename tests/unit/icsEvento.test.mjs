// Un evento di calendario è un file .ics vero, non una riga in chat che dice
// «Evento creato» mentre non esiste niente (#533, ottavo giro di verifica).
// Il titolo lo scrive il modello dopo aver letto una pagina: dentro il file non
// deve poter aprire righe per conto suo.

import test from 'node:test';
import assert from 'node:assert/strict';

await import('../../src/shared/icsEvento.js');
const ICS = globalThis.SN_ICS;

test('un evento diventa un file che un calendario sa importare', () => {
  const r = ICS.costruisci({ data: '2026-10-02', ora: '15:00', titolo: 'Dentista', durataMin: 30 });
  assert.equal(r.ok, true);
  assert.match(r.testo, /^BEGIN:VCALENDAR\r\n/);
  assert.match(r.testo, /\r\nEND:VCALENDAR\r\n$/);
  assert.match(r.testo, /\r\nDTSTART:20261002T150000\r\n/);
  assert.match(r.testo, /\r\nDTEND:20261002T153000\r\n/);
  assert.match(r.testo, /\r\nSUMMARY:Dentista\r\n/);
  assert.equal(r.nome, 'Dentista.ics');
  assert.equal(r.quando, '02/10 alle 15:00');
});

test('un titolo con dentro degli a capo non riscrive il file', () => {
  const r = ICS.costruisci({
    data: '2026-10-02',
    ora: '09:05',
    titolo: 'Riunione\r\nDTSTART:19700101T000000\r\nSUMMARY:altro',
    dettagli: 'punto uno; punto due, tre\\quattro',
  });
  assert.equal(r.ok, true);
  const righe = r.testo.split('\r\n');
  assert.equal(righe.filter((l) => l.startsWith('DTSTART:')).length, 1, 'il titolo ha aperto una riga sua');
  assert.equal(righe.filter((l) => l.startsWith('SUMMARY:')).length, 1);
  assert.match(r.testo, /punto uno\\; punto due\\, tre\\\\quattro/);
});

test('una riga lunga viene piegata come vuole il formato', () => {
  const r = ICS.costruisci({ data: '2026-10-02', ora: '15:00', titolo: 'x'.repeat(200) });
  assert.equal(r.ok, true);
  for (const riga of r.testo.split('\r\n')) {
    assert.ok(riga.length <= 75, `riga da ${riga.length} caratteri`);
  }
});

test('senza una data o un\'ora valide non si inventa niente', () => {
  assert.equal(ICS.costruisci({ data: 'giovedì', ora: '15:00', titolo: 'x' }).ok, false);
  assert.equal(ICS.costruisci({ data: '2026-10-02', ora: '25:00', titolo: 'x' }).ok, false);
  assert.equal(ICS.costruisci({ data: '2026-10-02', ora: '15:00', titolo: '   ' }).ok, false);
  assert.equal(ICS.costruisci({}).ok, false);
});

test('il nome del file non esce dalla sua cartella', () => {
  assert.equal(ICS.nomeFile('../../fuori/evento'), 'fuori evento.ics');
  assert.equal(ICS.nomeFile('C:\\Users\\agenti AI\\x'), 'C Users agenti AI x.ics');
  assert.equal(ICS.nomeFile(''), 'evento.ics');
});
