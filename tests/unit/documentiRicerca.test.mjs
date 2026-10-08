// La ricerca nei documenti dell'utente (#947): l'indice locale legge la cartella, e la richiesta a parole trova il
// documento giusto anche quando il file si chiama «scan_00231.pdf». Disco vero, nessun modello, nessun Electron.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { rmSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { cartellaDellaProva, BOLLETTA_MARZO, pdf, docx } from '../helpers/documentiFinti.mjs';

const require = createRequire(import.meta.url);
require('../../src/shared/contenutoEsterno.js');
const Ricerca = require('../../src/main/services/documentiRicerca.js');
const Indice = require('../../src/main/services/documentiIndice.js');
const Testo = require('../../src/main/services/documentiTesto.js');

let CASA;
let DOC;
let DATI;
let cartelle;
before(() => {
  CASA = cartellaTemporanea('filo-documenti-');
  DOC = join(CASA, 'Documenti');
  DATI = join(CASA, 'dati');
  cartellaDellaProva(DOC);
  cartelle = [DOC];
  Indice._azzera();
  Indice.configura({
    impostazioni: async () => ({ documenti: { cartelle } }),
    cartellaDati: () => DATI,
    estrai: (p) => Testo.estrai(p),
  });
});
after(() => { if (CASA) rmSync(CASA, { recursive: true, force: true }); });

test('le idee della richiesta: le parole di contorno restano fuori, i sinonimi entrano', () => {
  const c = Ricerca.concetti('Mi serve la bolletta della luce di marzo. Dov\'è?');
  assert.deepEqual(c.map((x) => x.nome), ['bolletta', 'luce', 'marzo']);
  assert.ok(c[1].forme.includes('energia elettrica'));
  assert.ok(c[1].forme.includes('kwh'));
  assert.equal(c[2].mese, 2);
  assert.deepEqual(Ricerca.concetti('   '), []);
  assert.deepEqual(Ricerca.concetti('<b>dov\'è</b> il 🔥'), []);
});

test('il mese si riconosce anche scritto in numeri, e «mar» non combacia con «mare»', () => {
  assert.equal(Ricerca.contaDateDelMese('Periodo 01/03/2026 - 31/03/2026', 2), 2);
  assert.equal(Ricerca.contaDateDelMese('scadenza 03/2026, emessa 2026-03-04', 2), 2);
  assert.equal(Ricerca.contaDateDelMese('il 13/12/2026', 2), 0);
  assert.equal(Ricerca.conta(Ricerca.piano('al mare'), 'mar'), 0);
  assert.equal(Ricerca.conta(Ricerca.piano('bollette e bolletta'), 'bolletta'), 2);
});

test('la prova della segnalazione: «mi serve la bolletta della luce di marzo» dà la bolletta come primo risultato', async () => {
  const r = await Indice.cerca('mi serve la bolletta della luce di marzo');
  assert.ok(r.risultati.length >= 3, 'servono anche gli altri candidati, per il modello che sceglie');
  assert.equal(r.risultati[0].nome, BOLLETTA_MARZO);
  assert.equal(r.risultati[0].cartella, DOC);
  assert.match(r.risultati[0].squarcio, /energia elettrica|kWh|03\/2026/i);
  assert.deepEqual(r.risultati[0].trovati.sort(), ['bolletta', 'luce', 'marzo']);
  // Le due bollette vicine (luce di febbraio, gas di marzo) restano dietro.
  const nomi = r.risultati.map((x) => x.nome);
  assert.ok(nomi.indexOf('scan_00198.pdf') > 0 && nomi.indexOf('doc_8812.pdf') > 0);
  assert.equal(r.indice.documenti, 20);
  assert.equal(r.indice.scansioni, 1);
});

test('anche con le parole che passerebbe il modello, e con gli altri esempi della segnalazione', async () => {
  assert.equal((await Indice.cerca('bolletta luce energia elettrica marzo 2026')).risultati[0].nome, BOLLETTA_MARZO);
  assert.equal((await Indice.cerca('il contratto d\'affitto')).risultati[0].nome, 'documento (3).docx');
  assert.equal((await Indice.cerca('la ricevuta dell\'assicurazione')).risultati[0].nome, 'xyz123.pdf');
  assert.equal((await Indice.cerca('estratto conto')).risultati[0].nome, 'file.pdf');
  assert.equal((await Indice.cerca('BUSTA PAGA di Marzo')).risultati[0].nome, 'stampa.pdf');
});

test('un PDF senza testo si trova per nome e dice che è una scansione', async () => {
  const r = await Indice.cerca('IMG_20260312');
  assert.equal(r.risultati[0].nome, 'IMG_20260312_0001.pdf');
  assert.equal(r.risultati[0].scansione, true);
});

test('richieste vuote o senza parole utili non trovano niente, e non rompono', async () => {
  for (const q of ['', '   ', 'dov\'è?', '😀😀', '<img src=x onerror=alert(1)>'.repeat(50), 'x'.repeat(20000)]) {
    const r = await Indice.cerca(q);
    assert.ok(Array.isArray(r.risultati));
  }
  assert.equal((await Indice.cerca('')).risultati.length, 0);
});

test('un file nuovo si trova alla ricerca dopo, uno cancellato sparisce, uno cambiato si rilegge', async () => {
  writeFileSync(join(DOC, 'z_nuovo.docx'), docx(['Preventivo del falegname per la libreria in rovere']));
  Indice._azzera();
  assert.equal((await Indice.cerca('preventivo falegname')).risultati[0].nome, 'z_nuovo.docx');
  unlinkSync(join(DOC, 'z_nuovo.docx'));
  Indice._azzera();
  assert.ok(!(await Indice.cerca('preventivo falegname')).risultati.some((x) => x.nome === 'z_nuovo.docx'));
});

test('l\'indice resta su disco: dopo un riavvio i documenti già letti non si rileggono', async () => {
  let letti = 0;
  Indice._azzera();
  Indice.configura({ estrai: (p) => { letti += 1; return Testo.estrai(p); } });
  await Indice.cerca('bolletta');
  assert.equal(letti, 0, 'tutti i documenti erano già nell\'indice su disco');
  Indice.configura({ estrai: (p) => Testo.estrai(p) });
});

test('una cartella tolta dall\'elenco esce dalla ricerca e dal disco; una cartella in più si legge per l\'occasione', async () => {
  const altra = join(CASA, 'Lavoro');
  mkdirSync(altra, { recursive: true });
  writeFileSync(join(altra, 'q1.pdf'), pdf([['Relazione trimestrale vendite', 'primo trimestre 2026']]));
  const r = await Indice.cerca('relazione trimestrale', { cartella: altra });
  assert.equal(r.risultati[0].nome, 'q1.pdf');
  const solo = await Indice.cerca('bolletta', { cartella: altra });
  assert.equal(solo.risultati.length, 0, 'con una cartella si cerca solo lì');
  assert.match((await Indice.cerca('bolletta', { cartella: join(CASA, 'non-esiste') })).cartellaMancante, /non-esiste/);
  cartelle = [];
  Indice._azzera();
  const vuota = await Indice.cerca('bolletta');
  assert.equal(vuota.risultati.length, 0);
  assert.equal(vuota.indice.documenti, 0);
  cartelle = [DOC];
  Indice._azzera();
});

test('fermata durante la lettura: la ricerca torna subito, e il giro continua in sottofondo', async () => {
  rmSync(DATI, { recursive: true, force: true });
  Indice._azzera();
  const ctrl = new AbortController();
  let visti = 0;
  Indice.configura({ estrai: async (p) => { visti += 1; if (visti === 3) ctrl.abort(); await new Promise((ok) => setTimeout(ok, 20)); return Testo.estrai(p); } });
  const stati = [];
  const r = await Indice.cerca('bolletta luce marzo', { segnale: ctrl.signal, avanzamento: (s) => stati.push(s) });
  assert.equal(r.fermata, true);
  assert.ok(stati.some((s) => s.fase === 'lettura' && s.totali === 20 && s.nome), 'l\'attesa dice cosa sta leggendo e quanto manca');
  await Indice.aggiorna();
  Indice.configura({ estrai: (p) => Testo.estrai(p) });
  assert.equal((await Indice.cerca('bolletta luce marzo')).risultati[0].nome, BOLLETTA_MARZO);
});

test('il testo dei tipi chiesti: PDF con testo, Word, txt e md; un .doc vecchio resta cercabile per nome', async () => {
  assert.match((await Testo.estrai(join(DOC, BOLLETTA_MARZO))).testo, /212 kWh/);
  assert.match((await Testo.estrai(join(DOC, 'documento (3).docx'))).testo, /locazione/);
  assert.match((await Testo.estrai(join(DOC, 'note_2.md'))).testo, /Ricette/);
  assert.equal((await Testo.estrai(join(DOC, 'IMG_20260312_0001.pdf'))).vuoto, true);
  writeFileSync(join(CASA, 'vecchio.doc'), 'binario');
  assert.equal((await Testo.estrai(join(CASA, 'vecchio.doc'))).errore, 'tipo');
  writeFileSync(join(CASA, 'rotto.pdf'), 'non sono un pdf');
  assert.equal((await Testo.estrai(join(CASA, 'rotto.pdf'))).errore, 'illeggibile');
});
