// L'evento che Filo propone in chat diventa un file .ics che il calendario
// del computer deve saper aprire: qui si controlla quello che il calendario
// rifiuterebbe in silenzio — una data inventata, un titolo con i caratteri che
// in .ics vogliono la barra rovesciata, una riga troppo lunga, la durata che
// scavalca la mezzanotte.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'calendarEvent.js'));

const C = globalThis.SN_CALENDAR;

test('un evento completo diventa un .ics con inizio, fine e titolo', () => {
  const ev = C.normalize({ data: '2026-09-21', ora: '10:00', titolo: 'Dentista', dettagli: 'Portare la ricetta' });
  assert.equal(ev.inizio, '20260921T100000');
  assert.equal(ev.fine, '20260921T110000'); // senza durata, un'ora
  assert.equal(ev.quando, '21/09/2026 alle 10:00');
  const ics = C.buildIcs(ev, { now: Date.UTC(2026, 8, 20, 4, 35, 42), uid: 'x@filo' });
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20260921T100000\r\n/);
  assert.match(ics, /DTEND:20260921T110000\r\n/);
  assert.match(ics, /SUMMARY:Dentista\r\n/);
  assert.match(ics, /DTSTAMP:20260920T043542Z\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test('una data o un\'ora che non esistono non diventano un evento', () => {
  for (const cattivo of [
    { data: '2026-02-31', ora: '10:00', titolo: 'x' },
    { data: '21/09/2026', ora: '10:00', titolo: 'x' },
    { data: '2026-09-21', ora: '25:00', titolo: 'x' },
    { data: '2026-09-21', ora: 'domattina', titolo: 'x' },
    { data: '2026-02-30', titolo: 'x' },
    { data: '2026-09-21', ora: '10:00', titolo: '   ' },
  ]) assert.equal(C.normalize(cattivo), null, JSON.stringify(cattivo));
});

test('la durata regge la mezzanotte e i valori assurdi', () => {
  const notte = C.normalize({ data: '2026-12-31', ora: '23:30', titolo: 'Brindisi', durata_min: 60 });
  assert.equal(notte.fine, '20270101T003000');
  // Durata non numerica o negativa → l'ora di default, mai un evento che finisce prima di cominciare.
  for (const d of ['mezz\'ora', -10, 0, null]) {
    const ev = C.normalize({ data: '2026-09-21', ora: '10:00', titolo: 'x', durata_min: d });
    assert.equal(ev.fine, '20260921T110000', `durata ${d}`);
  }
});

test('i caratteri che l\'.ics si mangerebbe sono protetti, e gli a capo non spezzano il file', () => {
  const ev = C.normalize({
    data: '2026-09-21', ora: '10:00',
    titolo: 'Cena; con Anna, Luca',
    dettagli: 'Primo\nSecondo\\terzo',
  });
  const ics = C.buildIcs(ev, { uid: 'x@filo' });
  assert.match(ics, /SUMMARY:Cena\\; con Anna\\, Luca\r\n/);
  assert.match(ics, /DESCRIPTION:Primo\\nSecondo\\\\terzo\r\n/);
  // Nessuna riga vera contiene un a capo solitario: il file resta leggibile.
  for (const riga of ics.split('\r\n')) assert.ok(!riga.includes('\n'), riga);
});

test('nessuna riga supera i 75 ottetti: le lunghe si piegano con uno spazio', () => {
  const ev = C.normalize({ data: '2026-09-21', ora: '10:00', titolo: `Riunione ${'è'.repeat(120)}` });
  const ics = C.buildIcs(ev, { uid: 'x@filo' });
  const righe = ics.split('\r\n').filter(Boolean);
  for (const r of righe) assert.ok(Buffer.byteLength(r, 'utf8') <= 75, `riga da ${Buffer.byteLength(r, 'utf8')} ottetti: ${r}`);
  assert.ok(righe.some((r) => r.startsWith(' ')), 'nessuna riga di continuazione: il titolo lungo non è stato piegato');
});

test('un evento già normalizzato ci ripassa uguale: dal bottone della chat torna al main così com\'è', () => {
  const uno = C.normalize({ data: '2026-09-21', ora: '9:05', titolo: 'Call', durata_min: 45, luogo: 'Ufficio' });
  const due = C.normalize(uno);
  assert.deepEqual(due, uno);
  assert.equal(uno.ora, '09:05');
});

test('il nome del file è scrivibile su qualunque disco, e non è mai vuoto', () => {
  assert.equal(C.fileName({ titolo: 'Cena: da Anna/Luca' }), 'Cena-da-Anna-Luca.ics');
  assert.equal(C.fileName({ titolo: '🎉' }), 'evento.ics');
  assert.equal(C.fileName(null), 'evento.ics');
  assert.ok(!/[\\/:*?"<>|]/.test(C.fileName({ titolo: 'a\\b:c*d?e"f<g>h|i' })));
});

// Lo stesso appuntamento riaperto col bottone deve tornare al calendario con lo
// stesso UID: con un'identità nuova il calendario lo prende per un secondo
// appuntamento e la cena finisce scritta due volte (#567).
test('lo stesso evento ha sempre la stessa identità, uno diverso no', () => {
  const uno = C.normalize({ titolo: 'Cena con Anna', data: '2026-10-02', ora: '20:30', durata_min: 90 });
  const bis = C.normalize({ titolo: 'Cena con Anna', data: '2026-10-02', ora: '20:30', durata_min: 90 });
  const altro = C.normalize({ titolo: 'Cena con Anna', data: '2026-10-03', ora: '20:30', durata_min: 90 });
  assert.equal(C.uidPer(uno), C.uidPer(bis));
  assert.notEqual(C.uidPer(uno), C.uidPer(altro));
  assert.match(C.buildIcs(uno, { uid: `${C.uidPer(uno)}@filo` }), new RegExp(`UID:${C.uidPer(uno)}@filo`));
});

// Un compleanno un'ora non ce l'ha: occupa la giornata, invece di un'ora
// inventata che lo mette in mezzo agli impegni (#567, settimo giro).
test('senza ora l\'evento è di tutto il giorno, e il calendario lo legge come tale', () => {
  for (const ora of [undefined, '', '  ']) {
    const ev = C.normalize({ data: '2026-12-31', ora, titolo: 'Compleanno di Anna' });
    assert.equal(ev.tuttoIlGiorno, true, JSON.stringify(ora));
    assert.equal(ev.inizio, '20261231');
    assert.equal(ev.fine, '20270101'); // la fine è il giorno dopo, anche a cavallo d'anno
    assert.equal(ev.quando, '31/12/2026, tutto il giorno');
    const ics = C.buildIcs(ev, { uid: 'x@filo' });
    assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\n/);
    assert.match(ics, /DTEND;VALUE=DATE:20270101\r\n/);
  }
  const segnato = C.normalize({ data: '2026-10-12', ora: '09:00', titolo: 'Ferie', tutto_il_giorno: true });
  assert.equal(segnato.tuttoIlGiorno, true);
  // Dal bottone della chat torna al main così com'è, e resta di tutto il giorno.
  assert.deepEqual(C.normalize(segnato), segnato);
  assert.equal(C.uidPer(C.normalize(segnato)), C.uidPer(segnato));
});

// Le ferie dal 10 al 15 sono sei giorni: ridotte in silenzio al primo, nel
// calendario l'utente ne trovava uno solo (#567, ottavo giro).
test('l\'evento senza ora che dura più giorni li occupa tutti, detto con la durata o con l\'ultimo giorno', () => {
  const perDurata = C.normalize({ titolo: 'Ferie', data: '2026-08-10', durata_min: 6 * 24 * 60 });
  const perFine = C.normalize({ titolo: 'Ferie', data: '2026-08-10', data_fine: '2026-08-15' });
  for (const ev of [perDurata, perFine]) {
    assert.equal(ev.tuttoIlGiorno, true);
    assert.equal(ev.inizio, '20260810');
    assert.equal(ev.fine, '20260816'); // la fine del .ics è esclusiva: il giorno dopo l'ultimo
    assert.equal(ev.quando, 'dal 10/08/2026 al 15/08/2026, tutto il giorno');
    assert.match(C.buildIcs(ev, { uid: 'x@filo' }), /DTEND;VALUE=DATE:20260816\r\n/);
    // Dal bottone della chat torna al main così com'è, con tutti i suoi giorni.
    assert.deepEqual(C.normalize(ev), ev);
  }
  assert.equal(C.uidPer(perDurata), C.uidPer(perFine));
  // A cavallo d'anno, e una durata che non fa giorni interi arrotonda in su.
  const capodanno = C.normalize({ titolo: 'Neve', data: '2026-12-30', durata_min: 2 * 24 * 60 + 1 });
  assert.equal(capodanno.fine, '20270102');
  // L'ultimo giorno vince sulla durata; uno prima dell'inizio non accorcia niente.
  assert.equal(C.normalize({ titolo: 'F', data: '2026-08-10', data_fine: '2026-08-11', durata_min: 9999 }).fine, '20260812');
  assert.equal(C.normalize({ titolo: 'F', data: '2026-08-10', data_fine: '2026-08-01' }).fine, '20260811');
  // Oltre un anno non è un evento vero: si rifiuta invece di tagliarlo.
  assert.equal(C.normalize({ titolo: 'F', data: '2026-08-10', data_fine: '2028-08-10' }), null);
  // Con l'ora, la durata resta quella di prima.
  assert.equal(C.normalize({ titolo: 'Cena', data: '2026-08-10', ora: '20:00', durata_min: 90 }).fine, '20260810T213000');
  // Né tagliata a una settimana: un viaggio di dieci giorni con l'ora resta di dieci giorni.
  assert.equal(C.normalize({ titolo: 'Viaggio', data: '2026-08-01', ora: '09:00', durata_min: 10 * 24 * 60 }).fine, '20260811T090000');
  assert.equal(C.normalize({ titolo: 'Viaggio', data: '2026-08-01', ora: '09:00', durata_min: 400 * 24 * 60 }), null);
});
