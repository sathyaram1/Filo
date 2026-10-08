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
  assert.equal(Ricerca.contaDateDelMese('rata 03/2026, verbale del 2026-03-04', 2), 2);
  // Emissione (anche come «n. … del»), scadenza e lettura non dicono di che mese parla un documento.
  assert.equal(Ricerca.contaDateDelMese('Bolletta del 06/03/2026. Da pagare entro il 26/03/2026, lettura rilevata il 02/03/2026', 2), 0);
  assert.equal(Ricerca.contaDateDelMese('Fattura n. 33 del 05/03/2026; Bolletta n. 4100223344 del 06/03/2026', 2), 0);
  assert.equal(Ricerca.contaDateDelMese('Verbale della riunione del 14/03/2026', 2), 1);
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

test('una cartella che il sistema non lascia leggere (il «Non consentire» del Mac) non passa per vuota: si dice, col modo di dare il permesso', async () => {
  // Come macOS dopo un rifiuto: la cartella esiste, ma elencarla dà EPERM.
  const vero = fsp.readdir;
  fsp.readdir = async (dir, opz) => {
    if (join(String(dir)) === join(DOC)) { const e = new Error('EPERM: operation not permitted, scandir'); e.code = 'EPERM'; throw e; }
    return vero.call(fsp, dir, opz);
  };
  try {
    Indice._azzera();
    const r = await Indice.cerca('bolletta luce marzo');
    assert.equal(r.risultati.length, 0);
    assert.equal(r.indice.cartelle[0].esiste, true);
    assert.equal(r.indice.cartelle[0].negata, true);
    assert.deepEqual(r.indice.negate.map((c) => c.percorso), [DOC]);
    assert.ok(r.indice.comePermesso);
    assert.equal((await Indice.stato()).cartelle[0].negata, true, 'anche la pagina Preferenze lo sa');
  } finally {
    fsp.readdir = vero;
  }
  // Dato il permesso, la ricerca torna a trovare e il segno sparisce.
  const r = await Indice.cerca('bolletta luce marzo');
  assert.equal(r.risultati[0].nome, BOLLETTA_MARZO);
  assert.equal(r.indice.cartelle[0].negata, false);
  assert.deepEqual(r.indice.negate, []);
  // Un ramo per sistema, scritto intero.
  assert.match(Indice.comeDarePermesso('darwin'), /Privacy e sicurezza › File e cartelle/);
  assert.match(Indice.comeDarePermesso('win32'), /Sicurezza/);
  assert.match(Indice.comeDarePermesso('linux'), /controlla i permessi/);
});

test('l\'esempio dato al modello per cercare un documento non porta un anno scritto fisso, che invecchia e vince sull\'ultimo', () => {
  // Con l'anno nella richiesta vince quell'anno (è voluto): un «marzo 2026» ricopiato nel 2027 darebbe la bolletta vecchia.
  require('../../src/shared/actionTools.js');
  const def = globalThis.SN_ACTION_TOOLS.definitions({}).find((d) => d.function.name === 'CERCA_DOCUMENTI');
  const testo = `${def.function.description}\n${JSON.stringify(def.function.parameters)}`;
  assert.doesNotMatch(testo, /\b(?:19|20)\d\d\b/);
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

// Il periodo di una bolletta vera è scritto in molti modi: ognuno deve far vincere marzo, e lo squarcio deve dirlo.
test('il periodo si riconosce comunque sia scritto, e fra bollette vicine vince marzo con ogni grafia', () => {
  const grafie = {
    'dal 1 al 28 febbraio 2026': ['dal 1 al 28 febbraio 2026', 'dal 1 al 31 marzo 2026', 'dal 1 al 30 aprile 2026'],
    'dal 1 febbraio al 28 febbraio 2026': ['dal 1 febbraio al 28 febbraio 2026', 'dal 1 marzo al 31 marzo 2026', 'dal 1 aprile al 30 aprile 2026'],
    'unite dal trattino': ['01/02/2026-28/02/2026', '01/03/2026-31/03/2026', '01/04/2026-30/04/2026'],
    'in colonna': ['01/02/2026 28/02/2026', '01/03/2026 31/03/2026', '01/04/2026 30/04/2026'],
    'Dal Al': ['Dal Al\n01/02/2026\n28/02/2026', 'Dal Al\n01/03/2026\n31/03/2026', 'Dal Al\n01/04/2026\n30/04/2026'],
    'ISO con la barra': ['2026-02-01 / 2026-02-28', '2026-03-01 / 2026-03-31', '2026-04-01 / 2026-04-30'],
    'dal 01/02 al 28/02/2026': ['dal 01/02 al 28/02/2026', 'dal 01/03 al 31/03/2026', 'dal 01/04 al 30/04/2026'],
  };
  for (const [nome, [feb, mar, apr]] of Object.entries(grafie)) {
    const docs = [
      { id: 'feb', nome: 'scan_00198.pdf', testo: bollettaVera({ periodo: feb, emessa: '06/03/2026', scadenza: '26/03/2026', lettura: '02/03/2026' }) },
      { id: 'mar', nome: 'scan_00231.pdf', testo: bollettaVera({ periodo: mar, emessa: '08/04/2026', scadenza: '28/04/2026', lettura: '01/04/2026' }) },
      { id: 'apr', nome: 'scan_00250.pdf', testo: bollettaVera({ periodo: apr, emessa: '07/05/2026', scadenza: '27/05/2026', lettura: '02/05/2026' }) },
    ];
    const r = Ricerca.ordina(docs, 'mi serve la bolletta della luce di marzo');
    assert.equal(r[0].id, 'mar', `${nome}: ${r.map((x) => x.id).join(', ')}`);
    assert.ok(Ricerca.squarcioMigliore(docs[1].testo, 'mi serve la bolletta della luce di marzo').replace(/\s+/g, ' ').includes(mar.replace(/\s+/g, ' ')), nome);
  }
  const mesi = (t) => Ricerca.periodi(t).map((x) => x.mesi);
  assert.deepEqual(mesi('Periodo: gennaio - febbraio 2026'), [[0, 1]]);
  assert.deepEqual(mesi('Periodo: dicembre-gennaio 2026'), [[11, 0]]);
  assert.deepEqual(mesi('consumi 1-28 febbraio 2026'), [[1]]);
  // Emissione e scadenza affiancate in tabella non sono un periodo, nemmeno sotto la riga del periodo vero.
  assert.deepEqual(mesi('Periodo di fatturazione 01/02/2026 - 28/02/2026 Data emissione Data scadenza 06/03/2026 26/03/2026'), [[1]]);
  assert.deepEqual(mesi('Data emissione Data scadenza\n06/03/2026 26/03/2026'), []);
  // Due date affiancate senza la parola che annuncia un periodo restano due date.
  assert.deepEqual(mesi('Ricevuta 06/03/2026 26/03/2026'), []);
});

// #947 giro 4: la regola è una, non una grafia in più. Quello che segue la parola che annuncia il periodo è il periodo,
// comunque sia scritto; un mese accanto a emissione, numero del documento, scadenza o «prossima» non lo è mai.
test('il periodo è quello che segue la sua etichetta, comunque sia scritto; le date amministrative non contano mai', () => {
  const grafie = {
    'dal 1° al 28 febbraio 2026': ['dal 1° al 28 febbraio 2026', 'dal 1° al 31 marzo 2026', 'dal 1° al 30 aprile 2026'],
    '1°-28 febbraio 2026': ['1°-28 febbraio 2026', '1°-31 marzo 2026', '1°-30 aprile 2026'],
    'febbraio-2026': ['febbraio-2026', 'marzo-2026', 'aprile-2026'],
    'febbraio - Anno 2026': ['febbraio - Anno 2026', 'marzo - Anno 2026', 'aprile - Anno 2026'],
    'Feb 1, 2026 - Feb 28, 2026': ['Feb 1, 2026 - Feb 28, 2026', 'Mar 1, 2026 - Mar 31, 2026', 'Apr 1, 2026 - Apr 30, 2026'],
  };
  const q = 'mi serve la bolletta della luce di marzo';
  for (const [nome, [feb, mar, apr]] of Object.entries(grafie)) {
    // Stessa data del file per tutte: a decidere deve essere il periodo, non l'ordine in cui sono arrivate.
    const docs = [
      { id: 'feb', nome: 'scan_00198.pdf', testo: bollettaVera({ periodo: feb, emessa: '06/03/2026', scadenza: '26/03/2026', lettura: '02/03/2026' }), data: 1 },
      { id: 'mar', nome: 'scan_00231.pdf', testo: bollettaVera({ periodo: mar, emessa: '08/04/2026', scadenza: '28/04/2026', lettura: '01/04/2026' }), data: 1 },
      { id: 'apr', nome: 'scan_00250.pdf', testo: bollettaVera({ periodo: apr, emessa: '07/05/2026', scadenza: '27/05/2026', lettura: '02/05/2026' }), data: 1 },
    ];
    for (const ordine of [docs, docs.slice().reverse()]) {
      const r = Ricerca.ordina(ordine, q);
      assert.equal(r[0].id, 'mar', `${nome}: ${r.map((x) => x.id).join(', ')}`);
    }
    if (!nome.startsWith('Feb')) assert.ok(Ricerca.squarcioMigliore(docs[1].testo, q).includes(mar), nome);
  }
  // Senza anno: «Bolletta di marzo», «Mese di riferimento: marzo».
  const senzaAnno = (m, em) => `Enel Energia\nBolletta n. 1 del ${em}\nFornitura di energia elettrica\nBolletta di ${m}`;
  const r = Ricerca.ordina([{ id: 'feb', nome: 'a.pdf', testo: senzaAnno('febbraio', '06/03/2026') }, { id: 'mar', nome: 'b.pdf', testo: senzaAnno('marzo', '08/04/2026') }], q);
  assert.equal(r[0].id, 'mar');
  assert.deepEqual(Ricerca.periodi('Mese di riferimento: Marzo').map((x) => x.mesi), [[2]]);
  // Un mese con l'anno che parla d'altro non è un secondo periodo.
  const prossima = (per, em, sc, x) => `Bolletta n. 1 del ${em}\nFornitura di energia elettrica\nTotale da pagare entro il ${sc}\nPeriodo di fatturazione: ${per}\nProssima lettura prevista a ${x}`;
  assert.deepEqual(Ricerca.periodi(prossima('01/02/2026 - 28/02/2026', '06/03/2026', '26/03/2026', 'marzo 2026')).map((x) => x.mesi), [[1]]);
  const docs = [
    { id: 'feb', nome: 'a.pdf', testo: prossima('01/02/2026 - 28/02/2026', '06/03/2026', '26/03/2026', 'marzo 2026'), data: 1 },
    { id: 'mar', nome: 'b.pdf', testo: prossima('01/03/2026 - 31/03/2026', '08/04/2026', '28/04/2026', 'aprile 2026'), data: 1 },
  ];
  assert.equal(Ricerca.ordina(docs, q)[0].id, 'mar');
  assert.equal(Ricerca.ordina(docs.slice().reverse(), q)[0].id, 'mar');
  // L'etichetta senza un mese dopo non inventa niente, e una scadenza nella riga sotto resta una scadenza.
  assert.deepEqual(Ricerca.periodi('Periodo di fatturazione\nTotale da pagare entro il 26/03/2026'), []);
  assert.deepEqual(Ricerca.periodi('Periodo di validità: fino al 31/12/2026'), []);
  assert.deepEqual(Ricerca.periodi('Codice di riferimento 0612345'), []);
});

test('senza un periodo dichiarato, le date di emissione, scadenza e lettura non fanno di febbraio una bolletta di marzo', () => {
  const docs = [
    { id: 'feb', nome: 'a.pdf', testo: 'Bolletta luce di febbraio. Emessa il 06/03/2026, da pagare entro il 26/03/2026, lettura del 02/03/2026. 240 kWh' },
    { id: 'mar', nome: 'b.pdf', testo: 'Bolletta luce di marzo. Emessa il 08/04/2026, da pagare entro il 28/04/2026, lettura del 01/04/2026. 250 kWh' },
  ];
  assert.equal(Ricerca.ordina(docs, 'bolletta luce marzo')[0].id, 'mar');
});

test('a parità di punteggio viene prima il documento più recente: il periodo dichiarato, se no la data del file', () => {
  const bolletta = (y) => `Bolletta del 08/04/${y}\nFornitura di energia elettrica, 240 kWh\nPeriodo di fatturazione: 01/03/${y} - 31/03/${y}`;
  const docs = [{ id: '2024', nome: 'a.pdf', testo: bolletta(2024) }, { id: '2026', nome: 'c.pdf', testo: bolletta(2026) }, { id: '2025', nome: 'b.pdf', testo: bolletta(2025) }];
  assert.deepEqual(Ricerca.ordina(docs, 'mi serve la bolletta della luce di marzo').map((x) => x.id), ['2026', '2025', '2024']);
  const contratti = [
    { id: 'vecchio', nome: 'x.docx', testo: 'Contratto di locazione, Via Roma 12', data: Date.UTC(2022, 5, 1) },
    { id: 'nuovo', nome: 'y.docx', testo: 'Contratto di locazione, Via Roma 12', data: Date.UTC(2025, 5, 1) },
  ];
  assert.deepEqual(Ricerca.ordina(contratti, 'contratto affitto').map((x) => x.id), ['nuovo', 'vecchio']);
  // Il più recente non scavalca un documento che combacia di più.
  const piu = [{ id: 'giusto', nome: 'g.pdf', testo: 'Bolletta luce, energia elettrica, kWh. Periodo 01/03/2024 - 31/03/2024' }, { id: 'recente', nome: 'r.pdf', testo: 'Bolletta gas, Smc. Periodo 01/03/2026 - 31/03/2026' }];
  assert.equal(Ricerca.ordina(piu, 'bolletta luce marzo')[0].id, 'giusto');
});

// #947 giro 5: con un mese, l'anno chiesto è l'anno del periodo. Lo storico dei consumi di una bolletta di marzo 2026
// nomina il 2025 nove volte, il consumo annuo va da aprile 2025 a marzo 2026: nessuno dei due la fa diventare di marzo 2025.
test('l\'anno chiesto col mese è l\'anno del periodo, non una parola qualsiasi del testo', () => {
  const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const storico = (y) => `Storico consumi: ${Array.from({ length: 12 }, (_, k) => `${MESI[(3 + k) % 12]} ${k < 9 ? y - 1 : y} ${100 + k} kWh`).join(' ')}`;
  const bolletta = (y, extra) => ['Enel Energia S.p.A.', `Bolletta n. 41 del 08/04/${y}`, 'Fornitura di energia elettrica',
    `Totale da pagare entro il 28/04/${y}`, `Periodo di fatturazione: 01/03/${y} - 31/03/${y}`, extra(y)].join('\n');
  const annuo = (y) => `Consumo annuo 2.700 kWh dal 01/04/${y - 1} al 31/03/${y}`;
  for (const extra of [storico, annuo]) {
    const docs = [{ id: '2025', nome: 'a.pdf', data: 1, testo: bolletta(2025, extra) }, { id: '2026', nome: 'b.pdf', data: 1, testo: bolletta(2026, extra) }];
    for (const ordine of [docs, docs.slice().reverse()]) {
      for (const q of ['la bolletta della luce di marzo 2025', 'bolletta luce energia elettrica kWh marzo 2025']) {
        assert.equal(Ricerca.ordina(ordine, q)[0].id, '2025', `${extra.name}: ${q}`);
      }
      assert.equal(Ricerca.ordina(ordine, 'bolletta luce marzo 2026')[0].id, '2026', extra.name);
      assert.equal(Ricerca.ordina(ordine, 'mi serve la bolletta della luce di marzo')[0].id, '2026', extra.name);
    }
  }
  // Un periodo senza anno vale per ogni anno; senza un mese l'anno resta una parola del testo.
  assert.equal(Ricerca.ordina([{ id: 'x', nome: 'x.pdf', testo: 'Bolletta luce. Bolletta di marzo' }], 'bolletta luce marzo 2025')[0].trovati.includes('marzo'), true);
  assert.deepEqual(Ricerca.ordina([{ id: 'c', nome: 'c.docx', testo: 'Contratto di locazione firmato nel 2025' }], 'contratto 2025')[0].trovati, ['contratto', '2025']);
});

// #947 giro 7: al modello va solo il testo dei candidati necessari. La busta paga e la lettera di dimissioni combaciano
// con la bolletta della luce di marzo solo per «marzo», la lista della spesa solo per «luce».
test('i candidati lontani dal migliore, trovati per una parola sola, non arrivano al modello', async () => {
  const nomi = (await Indice.cerca('mi serve la bolletta della luce di marzo')).risultati.map((x) => x.nome);
  assert.equal(nomi[0], BOLLETTA_MARZO);
  for (const via of ['stampa.pdf', 'Documento1.docx', 'Nuovo documento.docx']) assert.ok(!nomi.includes(via), `${via}: ${nomi.join(', ')}`);
  assert.ok(nomi.includes('scan_00198.pdf') && nomi.includes('doc_8812.pdf'), 'le bollette vicine restano, il modello sceglie fra loro');
  assert.deepEqual((await Indice.cerca('la busta paga di marzo')).risultati.map((x) => x.nome), ['stampa.pdf']);
});

// #947 giro 7: la ricerca chiesta mentre l'indice legge in sottofondo non si accontenta di quel giro, che ha elencato le
// cartelle prima che la bolletta arrivasse.
test('un file salvato mentre l\'indice sta leggendo si trova alla ricerca chiesta subito dopo', async () => {
  const nuovo = join(DOC, 'scan_00777.txt');
  Indice._azzera();
  rmSync(DATI, { recursive: true, force: true });
  Indice.configura({ estrai: async (p) => { await new Promise((ok) => setTimeout(ok, 15)); return Testo.estrai(p); } });
  try {
    const sottofondo = Indice.aggiorna();
    for (let i = 0; i < 200 && !(await Indice.stato()).inCorso; i++) await new Promise((ok) => setTimeout(ok, 5));
    assert.ok((await Indice.stato()).inCorso, 'il giro in sottofondo sta leggendo');
    writeFileSync(nuovo, 'Bolletta per la fornitura di energia elettrica\nPeriodo di fatturazione: 01/03/2027 - 31/03/2027\nConsumo 199 kWh');
    const stati = [];
    const r = await Indice.cerca('bolletta luce marzo 2027', { avanzamento: (s) => stati.push(s) });
    assert.equal(r.risultati[0] && r.risultati[0].nome, 'scan_00777.txt');
    assert.ok(stati.some((s) => s.fase === 'lettura' && s.nome === 'scan_00777.txt'), 'l\'attesa segue anche il giro che legge il file nuovo');
    await sottofondo;
  } finally {
    unlinkSync(nuovo);
    Indice.configura({ estrai: (p) => Testo.estrai(p) });
  }
});

// #947 giro 7: il bottone del file dice dove sta coi nomi delle cartelle di Filo, mai con la cartella dell'account.
test('dove sta un file: le cartelle di serie col loro nome, niente cartella dell\'account', async () => {
  const prima = process.env.FILO_DOWNLOAD_DIR;
  const scaricati = join(CASA, 'Downloads');
  process.env.FILO_DOWNLOAD_DIR = scaricati;
  try {
    assert.equal(await Indice.doveSta(join(scaricati, 'scan_00231.pdf')), 'Download');
    assert.equal(await Indice.doveSta(join(scaricati, 'Scansioni', 'scan_00231.pdf')), 'Download › Scansioni');
    assert.equal(await Indice.doveSta(join(scaricati, 'Casa', 'Bollette', '2026', 'a.pdf')), 'Download › … › 2026');
    assert.equal(await Indice.doveSta(join(DOC, 'scan_00231.pdf')), 'Documenti', 'una cartella dell\'elenco col suo nome');
    const casa = (await import('node:os')).homedir();
    assert.equal(await Indice.doveSta(join(casa, 'Lavoro', 'Fatture', 'f.pdf')), 'Lavoro › Fatture');
    assert.equal(await Indice.doveSta(join(casa, 'f.pdf')), 'Cartella personale');
  } finally {
    if (prima == null) delete process.env.FILO_DOWNLOAD_DIR; else process.env.FILO_DOWNLOAD_DIR = prima;
  }
});
