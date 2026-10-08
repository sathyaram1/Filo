// La ricerca nei documenti dell'utente (#947): l'indice locale legge la cartella, e la richiesta a parole trova il
// documento giusto anche quando il file si chiama «scan_00231.pdf». Disco vero, nessun modello, nessun Electron.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { rmSync, unlinkSync, writeFileSync, mkdirSync, truncateSync, statSync, existsSync, symlinkSync } from 'node:fs';
import fsp from 'node:fs/promises';
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

test('un file che sta solo nel cloud (nessun blocco sul disco) non si scarica per leggerlo: si trova per nome', async (t) => {
  const p = join(DOC, 'scan_nuvola_00777.pdf');
  writeFileSync(p, '');
  truncateSync(p, 200 * 1024);
  if (statSync(p).blocks !== 0) { unlinkSync(p); t.skip('questo disco non fa file vuoti senza blocchi'); return; }
  const letti = [];
  Indice._azzera();
  Indice.configura({ estrai: (q) => { letti.push(q); return Testo.estrai(q); } });
  try {
    const r = await Indice.cerca('scan_nuvola_00777');
    assert.equal(r.risultati[0].nome, 'scan_nuvola_00777.pdf');
    assert.equal(r.risultati[0].senzaTesto, 'nuvola');
    assert.ok(!letti.includes(p), 'il file nel cloud non va aperto');
  } finally {
    unlinkSync(p);
    Indice.configura({ estrai: (q) => Testo.estrai(q) });
  }
});

test('su Mac le cartelle protette non si leggono in sottofondo prima della prima ricerca chiesta dall\'utente', async () => {
  const piattaforma = Object.getOwnPropertyDescriptor(process, 'platform');
  rmSync(DATI, { recursive: true, force: true });
  Indice._azzera();
  let letti = 0;
  Indice.configura({ estrai: (q) => { letti += 1; return Testo.estrai(q); } });
  try {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    Indice._giroInSottofondo();
    await new Promise((ok) => setTimeout(ok, 150));
    assert.equal(letti, 0, 'in sottofondo, prima di ogni ricerca, nessun documento si apre');
    assert.equal((await Indice.stato()).aggiornato, null);
    await Indice.cerca('bolletta');
    assert.ok(letti > 0, 'la prima ricerca legge');
    assert.ok(existsSync(join(DATI, 'documenti', 'indice.jsonl')));
    const nuovo = join(DOC, 'z_mac.txt');
    writeFileSync(nuovo, 'arrivato dopo');
    letti = 0;
    Indice._azzera();
    Indice._giroInSottofondo();
    for (let i = 0; i < 40 && !letti; i++) await new Promise((ok) => setTimeout(ok, 25));
    unlinkSync(nuovo);
    assert.equal(letti, 1, 'dopo la prima ricerca il giro in sottofondo parte da sé e legge il file nuovo');
    await Indice.aggiorna();
  } finally {
    Object.defineProperty(process, 'platform', piattaforma);
    Indice.configura({ estrai: (q) => Testo.estrai(q) });
  }
});

test('un file messo nella cartella da un altro programma subito dopo una ricerca si trova alla ricerca dopo', async () => {
  Indice._azzera();
  await Indice.cerca('bolletta');
  const nuovo = join(DOC, 'salvato_ora.txt');
  writeFileSync(nuovo, 'Preventivo idraulico per la caldaia');
  try {
    assert.equal((await Indice.cerca('preventivo idraulico')).risultati[0].nome, 'salvato_ora.txt');
  } finally {
    unlinkSync(nuovo);
  }
});

test('i segnaposto di OneDrive, che l\'elenco di Windows dà per collegamenti, si leggono; un collegamento vero resta fuori', async (t) => {
  const sotto = join(DOC, 'OneDrive_sotto');
  mkdirSync(sotto, { recursive: true });
  writeFileSync(join(sotto, 'scan_od_001.txt'), 'Bolletta del gas condominiale di novembre');
  writeFileSync(join(DOC, 'scan_od_002.txt'), 'Ricevuta del meccanico per il tagliando');
  const fuori = cartellaTemporanea('filo-documenti-fuori-');
  writeFileSync(join(fuori, 'segreto.txt'), 'Preventivo del giardiniere');
  let link = true;
  try { symlinkSync(fuori, join(DOC, 'collegamento'), 'junction'); } catch (_) { link = false; }
  // Come libuv su Windows: ogni voce con un reparse point (i segnaposto di OneDrive) esce come collegamento.
  const vero = fsp.readdir;
  fsp.readdir = async (dir, opz) => {
    const voci = await vero.call(fsp, dir, opz);
    if (!opz || !opz.withFileTypes) return voci;
    return voci.map((v) => (v.name === 'OneDrive_sotto' || v.name === 'scan_od_002.txt'
      ? Object.assign(Object.create(Object.getPrototypeOf(v)), v, { isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false })
      : v));
  };
  try {
    Indice._azzera();
    assert.equal((await Indice.cerca('bolletta gas condominiale novembre')).risultati[0].nome, 'scan_od_001.txt');
    assert.equal((await Indice.cerca('ricevuta meccanico tagliando')).risultati[0].nome, 'scan_od_002.txt');
    if (!link) { t.diagnostic('niente collegamenti su questo disco'); return; }
    assert.equal((await Indice.cerca('preventivo giardiniere')).risultati.length, 0, 'un collegamento vero porta fuori dalle cartelle scelte');
  } finally {
    fsp.readdir = vero;
    rmSync(sotto, { recursive: true, force: true });
    rmSync(join(DOC, 'scan_od_002.txt'), { force: true });
    rmSync(join(DOC, 'collegamento'), { force: true });
    rmSync(fuori, { recursive: true, force: true });
  }
});

// Una bolletta vera è emessa e scade il mese dopo il suo periodo: quella di febbraio è piena di date di marzo.
function bollettaVera({ periodo, emessa, scadenza, lettura }) {
  return [
    'Servizio Elettrico Nazionale S.p.A. - Società con socio unico', 'Sede legale Viale Regina Margherita 125 00198 Roma',
    'Gentile Cliente MARIO ROSSI - VIA ROMA 12 - 20100 MILANO', `Bolletta n. 4100223344 del ${emessa}`,
    'Fornitura di energia elettrica - Servizio di Maggior Tutela', 'Codice cliente 123456789 - POD IT001E12345678',
    `Totale da pagare 68,10 euro entro il ${scadenza}`, 'Il pagamento si fa con domiciliazione bancaria o bollettino postale.',
    `Quanto hai consumato: lettura rilevata il ${lettura}. Consumo fatturato 240 kWh`,
    'Spesa per la materia energia 40,10 euro; trasporto e gestione del contatore 15,00 euro', `Periodo di fatturazione: ${periodo}`,
  ].join('\n');
}

test('fra bollette di mesi vicini vince il periodo dichiarato, non le date di emissione e scadenza; e lo squarcio lo mostra', () => {
  const docs = [
    { id: 'feb', nome: 'scan_00198.pdf', testo: bollettaVera({ periodo: '01/02/2026 - 28/02/2026', emessa: '06/03/2026', scadenza: '26/03/2026', lettura: '02/03/2026' }) },
    { id: 'mar', nome: 'scan_00231.pdf', testo: bollettaVera({ periodo: '01/03/2026 - 31/03/2026', emessa: '08/04/2026', scadenza: '28/04/2026', lettura: '01/04/2026' }) },
    { id: 'apr', nome: 'scan_00250.pdf', testo: bollettaVera({ periodo: '01/04/2026 - 30/04/2026', emessa: '07/05/2026', scadenza: '27/05/2026', lettura: '02/05/2026' }) },
    { id: 'parole', nome: 'x.pdf', testo: 'Bolletta luce. Periodo di riferimento: febbraio 2026. Emessa il 05/03/2026, da pagare entro il 25/03/2026. 210 kWh' },
  ];
  for (const q of ['mi serve la bolletta della luce di marzo', 'bolletta luce energia elettrica kWh marzo 2026']) {
    const r = Ricerca.ordina(docs, q);
    assert.equal(r[0].id, 'mar', `${q}: ${r.map((x) => x.id).join(', ')}`);
    assert.ok(!r.find((x) => x.id === 'parole') || r.findIndex((x) => x.id === 'parole') > 0);
  }
  const q = 'mi serve la bolletta della luce di marzo';
  assert.match(Ricerca.squarcioMigliore(docs[1].testo, q), /Periodo di fatturazione: 01\/03\/2026 - 31\/03\/2026/);
  assert.match(Ricerca.squarcioMigliore(docs[0].testo, q), /Periodo di fatturazione: 01\/02\/2026 - 28\/02\/2026/);
  // Senza un periodo dichiarato le date contano come prima.
  assert.equal(Ricerca.ordina([{ id: 'v', nome: 'aaa.docx', testo: 'Verbale della riunione del 14/03/2026' }], 'verbale marzo')[0].trovati.length, 2);
});

test('i periodi di un documento: intervalli di date, mese con l\'anno; una data sola non è un periodo', () => {
  const p = (t) => Ricerca.periodi(t).map((x) => [x.testo, x.mesi]);
  assert.deepEqual(p('Periodo 01/02/2026 - 28/02/2026, emessa il 06/03/2026'), [['01/02/2026 - 28/02/2026', [1]]]);
  assert.deepEqual(p('dal 1 feb 2026 al 28 feb 2026'), [['1 feb 2026 al 28 feb 2026', [1]]]);
  assert.deepEqual(p('Periodo: 01/01/2026 - 31/03/2026'), [['01/01/2026 - 31/03/2026', [0, 1, 2]]]);
  assert.deepEqual(p('dal 01/12/2025 al 31/01/2026'), [['01/12/2025 al 31/01/2026', [11, 0]]]);
  assert.deepEqual(p('Cedolino del mese di marzo 2026'), [['marzo 2026', [2]]]);
  assert.deepEqual(p('Verbale del 14 marzo 2026'), []);
  assert.deepEqual(p('Fattura n. 2026/031544 del 04/04/2026'), []);
  assert.deepEqual(p(''), []);
});
