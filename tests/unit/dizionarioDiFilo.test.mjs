// #1585 — il dizionario del correttore è di Filo, lo stesso su Windows, Mac e Linux: su Windows il browser lascia
// l'italiano al sistema e alla pagina dice «giusta» a ogni parola. Questo file gira anche nel lavoro Windows della suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const MODULO = require.resolve('../../src/main/services/dizionarioDiFilo.js');
const Motore = require('../../src/main/services/dizionarioMotore.js');
const thread = require('node:worker_threads');

// Lo stato del dizionario è uno per processo, come nell'app: ogni prova ne carica uno suo.
function nuovo() {
  delete require.cache[MODULO];
  return require(MODULO);
}

// Il modulo col Worker sostituito, per vedere cosa fa quando il thread non parte o muore.
function conThread(Finto) {
  const vero = thread.Worker;
  thread.Worker = Finto;
  try { return nuovo(); } finally { thread.Worker = vero; }
}

const pronti = new Map();
async function dizionario(locale) {
  if (!pronti.has(locale)) {
    const D = nuovo();
    assert.equal(await D.prepara({ locale }), true, JSON.stringify(D.stato()));
    pronti.set(locale, D);
  }
  return pronti.get(locale);
}

const quali = async (D, parole) => {
  const r = await D.sbagliate(parole);
  return parole.filter((_, i) => r[i]);
};

test('una parola sbagliata solo in italiano: «andatto» sì, «andato» no', async () => {
  const D = await dizionario('it-IT');
  assert.deepEqual(D.stato().lingue, ['it-IT']);
  assert.deepEqual(await D.sbagliate(['andatto', 'andato', 'quseta', 'questa', 'qzxwvkjh']), [true, false, true, false, true]);
  assert.ok((await D.proposte('andatto')).includes('andato'), JSON.stringify(await D.proposte('andatto')));
  assert.deepEqual(await D.proposte('andato'), []);
});

test('accenti, apostrofi, maiuscole e le parole che Chromium aggiunge al suo dizionario', async () => {
  const D = await dizionario('it-IT');
  const giuste = ['perché', 'caffè', 'Perché', 'PERCHÉ', 'più', 'città', "l'albero", "dell'anno", "po'", 'Andato', 'ANDATO',
    'mangiarsela', 'Roma', 'Wikipedia', 'e-mail'];
  assert.deepEqual(await quali(D, giuste), []);
  assert.deepEqual(await D.sbagliate(['perche', 'giornno', 'citta']), [true, true, true]);
  assert.ok((await D.proposte('perche')).includes('perché'), 'le lettere accentate passano intere nelle proposte');
});

test('l\'apostrofo in fondo (imperativi, troncamenti, elisioni) e quello tipografico non fanno una parola sbagliata', async () => {
  const D = await dizionario('it-IT');
  const giuste = ["di'", "fa'", "va'", "sta'", "da'", "be'", "dell'", "Dell'", "sant'", "quell'", "un'", "tutt'", "nient'",
    'l’albero', 'c’è', 'po’', 'va’'];
  assert.deepEqual(await quali(D, giuste), []);
  const conProposte = [];
  for (const p of giuste) if ((await D.proposte(p)).length) conProposte.push(p);
  assert.deepEqual(conProposte, [], 'una parola giusta non ha proposte');
  assert.deepEqual(await D.sbagliate(["andatto'", 'andatto’', 'l’andatto', "qzxw'"]), [true, true, true, true]);
  assert.ok((await D.proposte('l’andatto')).length, 'una sbagliata con l\'apostrofo tipografico ha le sue proposte');
});

test('i limiti di Chromium: oltre 64 byte la parola non si controlla, oltre 24 niente proposte, al più cinque', async () => {
  const D = await dizionario('it-IT');
  assert.deepEqual(await D.sbagliate(['x'.repeat(65), 'è'.repeat(33), '', '   ']), [false, false, false, false]);
  assert.deepEqual(await D.proposte('precipitevolissimevolmentt'), []);
  assert.ok((await D.proposte('funzion')).length <= 5);
  assert.ok((await D.proposte('funzion')).includes('funzione'));
});

test('richieste storte: niente eccezioni, niente verdetti inventati', async () => {
  const D = await dizionario('it-IT');
  assert.equal(await D.sbagliate('andatto'), null);
  assert.equal(await D.sbagliate(null), null);
  assert.equal(await D.sbagliate(Array(20001).fill('a')), null, 'più di quante il correttore ne ricordi');
  assert.deepEqual(await D.sbagliate([42, null, { a: 1 }, '<b>andatto</b>']), [false, false, false, true]);
  assert.deepEqual(await D.proposte(null), []);
});

test('finché non è pronto risponde «non so», e una domanda fa partire il caricamento atteso', async () => {
  const D = nuovo();
  assert.equal(D.prepara({ locale: 'it-IT', dopoMs: 60_000 }), null);
  assert.equal(await D.sbagliate(['andatto']), null);
  assert.equal(await D.proposte('andatto'), null);
  assert.equal(D.stato().fase, 'in caricamento', 'la domanda non aspetta il minuto');
  assert.equal(await D.prepara(), true);
  assert.deepEqual(await D.sbagliate(['andatto']), [true]);
});

// La suite che guarda il processo principale fermo (safebrowse-link-prima-del-clic.spec.mjs) lo trovava fermo per il
// caricamento del dizionario, avviato da solo un secondo e mezzo dopo l'apertura (#1612).
test('il caricamento sta nel thread: il processo che lo chiede non si ferma', async () => {
  const misura = () => {
    const m = { max: 0, attivo: true };
    let prima = performance.now();
    const giro = () => {
      const ora = performance.now();
      m.max = Math.max(m.max, ora - prima);
      prima = ora;
      if (m.attivo) setTimeout(giro, 1);
    };
    setTimeout(giro, 1);
    return m;
  };
  // Il riferimento: lo stesso caricamento fatto qui.
  const qui = misura();
  const m = await Motore.carica(['it-IT', 'en-US']);
  qui.attivo = false;
  assert.deepEqual(m.lingue, ['it-IT', 'en-US']);

  const D = nuovo();
  const nelThread = misura();
  assert.equal(await D.prepara({ locale: 'en-US' }), true);
  nelThread.attivo = false;
  assert.equal(D.stato().dove, 'thread');
  assert.ok(nelThread.max < qui.max / 3, `fermo ${nelThread.max.toFixed(1)} ms col thread, ${qui.max.toFixed(1)} ms senza`);
  assert.deepEqual(await D.sbagliate(['house', 'andatto']), [false, true]);
});

test('se il thread non parte il dizionario si carica nel processo, e risponde lo stesso', async () => {
  const D = conThread(class { constructor() { throw new Error('thread non disponibile'); } });
  assert.equal(await D.prepara({ locale: 'it-IT' }), true, JSON.stringify(D.stato()));
  assert.equal(D.stato().dove, 'processo');
  assert.match(D.stato().errori.join(), /thread non disponibile/);
  assert.deepEqual(await D.sbagliate(['andatto', 'andato']), [true, false]);
  assert.ok((await D.proposte('andatto')).includes('andato'));
});

test('se il thread muore le pagine non aspettano: «non so», e la domanda dopo lo ricarica', async () => {
  const nati = [];
  const D = conThread(class extends thread.Worker { constructor(...a) { super(...a); nati.push(this); } });
  assert.equal(await D.prepara({ locale: 'it-IT' }), true);
  await nati[0].terminate();
  assert.equal(D.stato().fase, 'spento');
  assert.equal(await D.sbagliate(['andatto']), null);
  assert.equal(D.stato().fase, 'in caricamento');
  assert.equal(await D.prepara(), true);
  assert.equal(nati.length, 2);
  assert.deepEqual(await D.sbagliate(['andatto']), [true]);
});

test('le lingue sono quelle del correttore del browser fra quelle che Filo ha: italiano sempre, l\'inglese di sistema', () => {
  const D = nuovo();
  assert.deepEqual(D.LINGUE, ['en-GB', 'en-US', 'it-IT']);
  assert.deepEqual(D.scegli('it-IT'), ['it-IT']);
  assert.deepEqual(D.scegli('en-US'), ['it-IT', 'en-US']);
  assert.deepEqual(D.scegli('en-AU'), ['it-IT', 'en-GB']);
  assert.deepEqual(D.scegli('de-DE'), ['it-IT']);
  assert.deepEqual(D.scegli(''), ['it-IT']);
});

test('con l\'inglese di sistema una parola è sbagliata solo se nessuna delle due lingue la conosce', async () => {
  const D = await dizionario('en-US');
  assert.deepEqual(D.stato().lingue, ['it-IT', 'en-US']);
  assert.deepEqual(await D.sbagliate(['house', 'andato', 'andatto', 'housse']), [false, false, true, true]);
  const p = await D.proposte('housse');
  assert.ok(p.includes('house'), JSON.stringify(p));
  assert.equal(new Set(p).size, p.length, 'nessun doppione fra le lingue');
});

test('i file italiani restano Latin-9 con CRLF (GPL, com\'erano): la conversione li legge giusti', () => {
  const crudo = readFileSync(fileURLToPath(new URL('../../assets/dizionari/sorgenti/it_IT.aff', import.meta.url)));
  assert.match(crudo.toString('latin1'), /^SET ISO8859-15\r$/m);
  assert.equal(Motore.decodifica(Buffer.from([0xa4, 0xe8, 0x0d, 0x0a, 0xbd]), 'ISO8859-15'), '€è\nœ');
  assert.equal(Motore.decodifica(Buffer.from('﻿caffè\r\n', 'utf8'), 'UTF-8'), 'caffè\n');
  assert.throws(() => Motore.decodifica(Buffer.from('x'), 'KOI8-R'), /codifica/);
  const { aff, dic } = Motore.testiDi('it-IT');
  assert.match(aff, /^SET UTF-8$/m);
  assert.ok(!aff.includes('\r') && !dic.includes('\r'));
  assert.match(dic, /^caffè$/m);
  assert.match(dic, /^Wikipedia$/m, 'il delta di Chromium è dentro');
});

test('la pagina chiede al dizionario di Filo, in un viaggio solo; quello del browser solo finché Filo non sa', () => {
  const fai = require('../../src/preload/dizionario.js');
  const viaggi = [];
  let risposta = null;
  const ipc = { sendSync: (canale, dato) => { viaggi.push([canale, dato]); return typeof risposta === 'function' ? risposta(canale, dato) : risposta; } };
  // Il browser di Windows con l'italiano del sistema: ogni parola giusta, nessuna proposta.
  const browser = { isWordMisspelled: () => false, getWordSuggestions: () => [] };
  const D = fai(ipc, browser);

  risposta = (c, ps) => (c === 'filo:dizionario-sbagliate' ? ps.map((p) => p === 'andatto') : ['andato']);
  assert.deepEqual(D.sbagliate(['andato', 'andatto']), [false, true]);
  assert.equal(D.sbagliata('andatto'), true);
  assert.deepEqual(D.proposte('andatto'), ['andato']);
  assert.deepEqual(viaggi.map((v) => v[0]), ['filo:dizionario-sbagliate', 'filo:dizionario-sbagliate', 'filo:dizionario-proposte']);
  assert.deepEqual(D.sbagliate([]), [], 'niente da chiedere, nessun viaggio');
  assert.equal(viaggi.length, 3);

  risposta = null;
  const linux = fai(ipc, { isWordMisspelled: (p) => p === 'quseta', getWordSuggestions: () => ['questa'] });
  assert.deepEqual(linux.sbagliate(['quseta', 'questa']), [true, false], 'non pronto: risponde il browser');
  assert.deepEqual(linux.proposte('quseta'), ['questa']);

  const rotto = fai({ sendSync: () => { throw new Error('canale chiuso'); } }, null);
  assert.deepEqual(rotto.sbagliate(['andatto']), [false], 'senza nessun dizionario ogni parola è giusta');
  assert.deepEqual(rotto.proposte('andatto'), []);
});

test('il correttore nelle pagine e nelle pagine di Filo riceve il dizionario di Filo', () => {
  for (const f of ['src/preload/page-preload.js', 'src/preload/internal-preload.js']) {
    const testo = readFileSync(fileURLToPath(new URL(`../../${f}`, import.meta.url)), 'utf8');
    assert.match(testo, /require\('\.\/dizionario\.js'\)\(ipcRenderer, webFrame\)/, f);
  }
  const ipc = readFileSync(fileURLToPath(new URL('../../src/main/ipc.js', import.meta.url)), 'utf8');
  for (const c of ['filo:dizionario-sbagliate', 'filo:dizionario-proposte']) assert.ok(ipc.includes(`ipcMain.on('${c}'`), c);
});
