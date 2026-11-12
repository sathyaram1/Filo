// #1127 — alla riapertura la scheda in vista si carica da sola, poi le altre al massimo due alla volta partendo dalle
// vicine; una scheda aperta dall'utente mentre aspetta si carica subito, e la coda si chiude anche con pagine appese.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CodaRiapertura, perVicinanza } = require('../../src/main/tabs/codaRiapertura.js');

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

function prova({ tetto = 60_000, rifiuta = new Set() } = {}) {
  const partite = [];
  let picco = 0;
  const coda = new CodaRiapertura({
    tetto,
    carica: (t) => {
      if (rifiuta.has(t)) return false;
      partite.push(t);
      return true;
    },
  });
  const misura = () => { picco = Math.max(picco, coda.volo.size); };
  const caricata = (t) => { coda.caricata(t); misura(); };
  return { coda, partite, caricata, misura, picco: () => picco };
}

test('le vicine prima: a pari distanza la destra, poi la sinistra, fino ai bordi', () => {
  const s = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(perVicinanza(s, 'c'), ['c', 'd', 'b', 'e', 'a', 'f']);
  assert.deepEqual(perVicinanza(s, 'f'), ['f', 'e', 'd', 'c', 'b', 'a']);
  assert.deepEqual(perVicinanza(s, 'a'), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(perVicinanza(s, 'z'), s, 'senza scheda in vista l\'ordine resta quello della barra');
  assert.deepEqual(perVicinanza([], null), []);
});

test('la scheda in vista si carica da sola; le altre partono dopo, mai più di due insieme, fino all\'ultima', () => {
  const { coda, partite, caricata, misura, picco } = prova();
  const schede = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'];
  coda.accoda(perVicinanza(schede, 's4'));
  assert.deepEqual(partite, [], 'mettere in coda non carica niente');
  coda.subito('s4');
  coda.avanti();
  misura();
  assert.deepEqual(partite, ['s4'], 'finché quella in vista carica, le altre aspettano');
  caricata('s4');
  assert.deepEqual(partite, ['s4', 's5', 's3']);
  while (coda.volo.size) caricata([...coda.volo.keys()][0]);
  assert.deepEqual(partite, ['s4', 's5', 's3', 's6', 's2', 's7', 's1', 's8', 's0', 's9']);
  assert.equal(picco(), 2);
  assert.equal(coda.inCoda('s9'), false);
});

test('una scheda aperta mentre aspetta si carica subito, e prima che finisca non ne parte un\'altra', () => {
  const { coda, partite, caricata } = prova();
  const schede = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  coda.accoda(perVicinanza(schede, 'a'));
  coda.subito('a');
  caricata('a');
  assert.deepEqual(partite, ['a', 'b', 'c']);
  assert.equal(coda.subito('g'), true);
  assert.deepEqual(partite, ['a', 'b', 'c', 'g'], 'la scheda aperta non aspetta le due in sottofondo');
  caricata('b');
  caricata('c');
  assert.deepEqual(partite, ['a', 'b', 'c', 'g'], 'la scheda in vista finisce prima che ne parta un\'altra');
  caricata('g');
  assert.deepEqual(partite, ['a', 'b', 'c', 'g', 'd', 'e']);
});

test('aprire una scheda che sta già caricando in sottofondo non la ricarica: la fa passare davanti alle altre', () => {
  const { coda, partite, caricata } = prova();
  coda.accoda(['a', 'b', 'c', 'd']);
  coda.subito('a');
  caricata('a');
  assert.equal(coda.subito('b'), true);
  caricata('c');
  assert.deepEqual(partite, ['a', 'b', 'c'], 'con b davanti la coda non va avanti');
  caricata('b');
  assert.deepEqual(partite, ['a', 'b', 'c', 'd']);
});

test('una scheda chiusa mentre aspetta non si carica, e una chiusa mentre carica libera il suo posto', async () => {
  const { coda, partite, caricata } = prova();
  coda.accoda(['a', 'b', 'c', 'd', 'e']);
  coda.subito('a');
  caricata('a');
  assert.deepEqual(partite, ['a', 'b', 'c']);
  coda.pota(['a', 'c', 'e']);
  assert.deepEqual(partite, ['a', 'b', 'c', 'e'], 'b chiusa mentre caricava: il suo posto va a e, d non c\'è più');
  coda.togli('c');
  caricata('e');
  let finita = false;
  await coda.finita().then(() => { finita = true; });
  assert.equal(finita, true);
});

test('una scheda già caricata da un\'altra strada si salta senza tenere un posto', () => {
  const b = 'b';
  const { coda, partite, caricata } = prova({ rifiuta: new Set([b]) });
  coda.accoda(['a', b, 'c', 'd']);
  coda.subito('a');
  caricata('a');
  assert.deepEqual(partite, ['a', 'c', 'd']);
  assert.equal(coda.volo.size, 2);
});

// In Filo loadURL emette did-start-loading anche in modo sincrono, e la barra che si aggiorna pota la coda: chi parte
// deve già contare come in volo, o la coda si dice finita (e il riordino legge) con l'ultima pagina appena partita.
test('una scheda che rientra nella coda mentre parte non la fa dire finita, né fa partire le altre prima della sua ora', async () => {
  const partite = [];
  let vive = ['a', 'b'];
  const coda = new CodaRiapertura({ carica: (t) => { partite.push(t); coda.pota(vive); return true; } });
  coda.accoda(['a', 'b']);
  coda.subito('a');
  let finita = false;
  const fine = coda.finita().then(() => { finita = true; });
  coda.caricata('a');
  await pausa(0);
  assert.deepEqual(partite, ['a', 'b']);
  assert.equal(finita, false, 'b sta ancora caricando');
  coda.caricata('b');
  await fine;
  assert.equal(coda.volo.size, 0);

  // Una scheda chiusa proprio mentre parte quella aperta dall'utente: il posto liberato non fa partire le altre.
  partite.length = 0;
  vive = ['p', 'q', 'r', 's', 't'];
  coda.accoda(vive);
  coda.subito('p');
  coda.caricata('p');
  assert.deepEqual(partite, ['p', 'q', 'r']);
  vive = ['p', 'q', 's', 't'];
  coda.subito('t');
  assert.deepEqual(partite, ['p', 'q', 'r', 't'], 'finché quella in vista carica, s aspetta');
});

test('una pagina che non finisce mai di caricarsi libera il posto al tetto, e la coda arriva in fondo', async () => {
  const { coda, partite } = prova({ tetto: 30 });
  coda.accoda(['a', 'b', 'c', 'd']);
  coda.subito('a');
  coda.avanti();
  const fine = coda.finita();
  await pausa(10);
  assert.deepEqual(partite, ['a']);
  // I timer del tetto non tengono vivo il processo (in Filo non devono tenerlo aperto): qui lo tiene la prova.
  const vivo = setInterval(() => {}, 1000);
  try { await fine; } finally { clearInterval(vivo); }
  assert.deepEqual(partite, ['a', 'b', 'c', 'd']);
  assert.equal(coda.volo.size, 0);
});

test('finita() aspetta la fine della coda; a coda vuota si risolve subito; chiusa la finestra non parte più niente', async () => {
  const { coda, partite, caricata } = prova();
  await coda.finita();
  coda.accoda(['a', 'b', 'c']);
  coda.subito('a');
  let finita = false;
  const p = coda.finita().then(() => { finita = true; });
  caricata('a');
  await pausa(0);
  assert.equal(finita, false);
  coda.chiudi();
  await p;
  assert.equal(finita, true);
  coda.avanti();
  coda.accoda(['x']);
  coda.avanti();
  assert.deepEqual(partite, ['a', 'b', 'c']);
});
