// #2378 — il testo scritto nei campi dei siti che non si perde: la pagina, la firma dei campi e il loro abbinamento al
// ritorno, scadenza e tetti, e il magazzino del main con chi è ammesso (incognito, Privacy, delicate, sito spento).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const R = require('../../src/shared/testoDeiCampi.js');

const firma = (x = {}) => R.firmaPulita({ tag: 'textarea', ordine: 0, ...x });
const DAY = 24 * 60 * 60 * 1000;

test('la pagina si ritrova senza ancora; fuori dal web non c\'è pagina', () => {
  assert.equal(R.chiavePagina('https://esempio.it/post/12?x=1#commenti'), 'https://esempio.it/post/12?x=1');
  assert.equal(R.chiavePagina('http://esempio.it'), 'http://esempio.it/');
  for (const u of ['filo://newtab/', 'file:///c/a.html', 'about:blank', '', null, 'non un indirizzo']) assert.equal(R.chiavePagina(u), '');
});

test('la firma descrive solo i campi di testo libero', () => {
  assert.deepEqual(R.firmaPulita({ tag: 'INPUT', id: 'a', nome: 'n', etichetta: 'Nome', ordine: 2 }),
    { tag: 'input', tipo: 'text', id: 'a', nome: 'n', etichetta: 'Nome', ordine: 2 });
  assert.equal(R.firmaPulita({ tag: 'textarea', tipo: 'qualunque' }).tipo, '');
  for (const tipo of ['password', 'date', 'checkbox', 'hidden', 'file', 'color']) assert.equal(R.firmaPulita({ tag: 'input', tipo }), null, tipo);
  assert.equal(R.firmaPulita({ tag: 'div' }), null);
  assert.equal(R.firmaPulita(null), null);
  assert.equal(R.firmaPulita({ tag: 'input', id: 'x'.repeat(5000) }).id.length, 200);
});

test('al ritorno ogni testo va nel suo campo: per id, per nome nell\'ordine della pagina, per etichetta', () => {
  const salvati = [
    { firma: firma({ tag: 'input', id: 'oggetto', ordine: 0 }), valore: 'Oggetto' },
    { firma: firma({ nome: 'commento', ordine: 1 }), valore: 'secondo commento' },
    { firma: firma({ nome: 'commento', ordine: 0 }), valore: 'primo commento' },
    { firma: firma({ etichetta: 'Scrivi un messaggio', ordine: 2 }), valore: 'messaggio' },
  ];
  // La pagina rinata: altri ordini e un campo in più, ma gli stessi nomi.
  const presenti = [
    { indice: 0, firma: firma({ tag: 'input', id: 'oggetto', ordine: 3 }) },
    { indice: 1, firma: firma({ nome: 'commento', ordine: 5 }) },
    { indice: 2, firma: firma({ nome: 'commento', ordine: 7 }) },
    { indice: 3, firma: firma({ etichetta: 'Scrivi un messaggio', ordine: 9 }) },
    { indice: 4, firma: firma({ nome: 'altro', ordine: 10 }) },
  ];
  const fatti = R.abbina(salvati, presenti).sort((a, b) => a.indice - b.indice);
  assert.deepEqual(fatti.map((f) => [f.indice, f.valore, f.da]), [
    [0, 'Oggetto', 0], [1, 'primo commento', 2], [2, 'secondo commento', 1], [3, 'messaggio', 3],
  ]);
});

test('un campo senza id, nome ed etichetta torna solo se di quel tipo ce n\'è uno solo, prima e adesso', () => {
  const uno = [{ firma: firma({ ordine: 0 }), valore: 'testo' }];
  assert.deepEqual(R.abbina(uno, [{ indice: 7, firma: firma({ ordine: 3 }) }]).map((f) => f.indice), [7]);
  // Due aree anonime adesso: il testo potrebbe finire in quella sbagliata, e resta da parte.
  assert.deepEqual(R.abbina(uno, [{ indice: 1, firma: firma({ ordine: 0 }) }, { indice: 2, firma: firma({ ordine: 1 }) }]), []);
  // Un tipo diverso non si scambia.
  assert.deepEqual(R.abbina(uno, [{ indice: 1, firma: firma({ tag: 'input', ordine: 0 }) }]), []);
  assert.deepEqual(R.abbina(null, null), []);
});

test('scaduto, vuoto o oltre il tetto non resta; il resto sì, per quanto sia', () => {
  const ora = 1_800_000_000_000;
  const pagina = (t, valore) => ({ t, campi: [{ firma: firma(), valore, t }] });
  const dati = {
    'https://a.it/': pagina(ora - 8 * DAY, 'vecchio'),
    'https://b.it/': pagina(ora - DAY, 'recente'),
    'https://c.it/': pagina(ora, ''),
    'https://d.it/': pagina(ora, 'x'.repeat(R.VALORE_MAX + 1)),
    'filo://newtab/': pagina(ora, 'di Filo'),
  };
  assert.deepEqual(Object.keys(R.pota(dati, ora, 7)), ['https://b.it/']);
  assert.deepEqual(Object.keys(R.pota(dati, ora, 30)).sort(), ['https://a.it/', 'https://b.it/']);
  assert.deepEqual(Object.keys(R.pota(dati, ora, 1)), []);
  assert.equal(R.pesoTotale(R.pota(dati, ora, 30)), 'vecchio'.length + 'recente'.length);
});

test('un campo si aggiorna al suo posto e se ne va col valore vuoto', () => {
  let p = R.aggiorna(null, firma({ nome: 'a' }), 'uno', 1);
  p = R.aggiorna(p, firma({ nome: 'b' }), 'due', 2);
  p = R.aggiorna(p, firma({ nome: 'a' }), 'uno bis', 3);
  assert.deepEqual(p.campi.map((c) => c.valore), ['due', 'uno bis']);
  p = R.aggiorna(p, firma({ nome: 'a' }), '', 4);
  p = R.aggiorna(p, firma({ nome: 'b' }), '', 5);
  assert.equal(p, null);
});

test('di serie acceso, una settimana; una durata fuori elenco torna quella di serie', () => {
  assert.deepEqual(R.opzioni({}), { attivo: true, giorni: 7 });
  assert.deepEqual(R.opzioni({ testoDeiCampi: { attivo: false, giorni: 30 } }), { attivo: false, giorni: 30 });
  assert.equal(R.opzioni({ testoDeiCampi: { giorni: 365 } }).giorni, 7);
  const C = require('../../src/shared/constants.js');
  assert.deepEqual(R.opzioni((C.DEFAULT_SETTINGS || globalThis.SN_CONST.DEFAULT_SETTINGS)), { attivo: true, giorni: R.GIORNI_DI_SERIE });
});

// ── Il magazzino del main ────────────────────────────────────────────────────────────────────────────────────────────
let impostazioni = {};
globalThis.SN_STORAGE = { getSettings: async () => impostazioni };
const Testo = require('../../src/main/services/testoDeiCampi.js');
const cartella = mkdtempSync(join(tmpdir(), 'filo-testo-campi-'));
const FILE = join(cartella, 'testo-dei-campi.json');
process.on('exit', () => { try { rmSync(cartella, { recursive: true, force: true }); } catch (_) {} });

let ultimoWc = 0;
const mittente = (url, { persistente = true, incognito = false, wc = null } = {}) => ({
  url, isIncognito: incognito, frame: { url },
  wc: wc || { id: ++ultimoWc, session: { isPersistent: () => persistente } },
});
const scrivi = (s, campi) => Testo.daContenuto({ fase: 'scrivi', campi }, s);
const leggi = (s) => Testo.daContenuto({ fase: 'leggi' }, s);
const campo = (valore, x = {}) => ({ firma: { tag: 'textarea', nome: 'messaggio', ordine: 0, ...x }, valore });

test('il testo scritto torna alla pagina, anche dopo un riavvio, e la pagina con l\'ancora è la stessa', async () => {
  impostazioni = {};
  Testo._test.usaFile(FILE);
  const url = 'https://forum.esempio.it/discussione/7';
  assert.deepEqual(await scrivi(mittente(url), [campo('Ciao a tutti, volevo chiedere…')]), { ok: true, segui: true, troppo: 0 });
  Testo.scriviSubito();
  assert.ok(existsSync(FILE));
  assert.match(readFileSync(FILE, 'utf8'), /volevo chiedere/);
  // Riavvio: memoria vuota, si rilegge dal file.
  Testo._test.usaFile(FILE);
  const r = await leggi(mittente(`${url}#risposte`));
  assert.equal(r.segui, true);
  assert.deepEqual(r.campi.map((c) => c.valore), ['Ciao a tutti, volevo chiedere…']);
  assert.deepEqual(await Testo.stato(), { ok: true, pagine: 1, campi: 1 });
});

test('svuotato (anche solo spazi) il campo se ne va; oltre il tetto non si tiene e la pagina lo sa', async () => {
  impostazioni = {};
  Testo._test.usaFile(join(cartella, 'svuota.json'));
  const s = mittente('https://esempio.it/modulo');
  await scrivi(s, [campo('qualcosa'), campo('altro', { nome: 'oggetto' })]);
  await scrivi(s, [campo('   \n ')]);
  assert.deepEqual((await leggi(s)).campi.map((c) => c.valore), ['altro']);
  const r = await scrivi(s, [campo('z'.repeat(R.VALORE_MAX + 1), { nome: 'oggetto' })]);
  assert.equal(r.troppo, 1);
  assert.deepEqual((await leggi(s)).campi, []);
});

test('niente da incognito, sessioni che non restano, pagine delicate, siti dove Filo è spento, Filo stesso, o spento', async () => {
  Testo._test.usaFile(join(cartella, 'esclusi.json'));
  const casi = [
    [{}, mittente('https://esempio.it/a', { incognito: true })],
    [{}, mittente('https://esempio.it/a', { persistente: false })],
    [{}, mittente('https://mail.google.com/mail/u/0/')],
    [{}, mittente('https://www.intesasanpaolo.com/')],
    [{}, mittente('https://www.inps.it/servizi')],
    [{ security: { pagineDelicate: { siti: ['mio-sito.it'] } } }, mittente('https://mio-sito.it/')],
    [{ blocklist: ['esempio.it'] }, mittente('https://www.esempio.it/a')],
    [{ testoDeiCampi: { attivo: false } }, mittente('https://esempio.it/a')],
    [{}, { ...mittente('filo://newtab/'), url: 'filo://newtab/' }],
    [{}, mittente('file:///tmp/pagina.html')],
  ];
  for (const [s, m] of casi) {
    impostazioni = s;
    assert.deepEqual(await scrivi(m, [campo('segreto')]), { ok: true, segui: false }, JSON.stringify([s, m.frame.url, m.isIncognito]));
    assert.equal((await leggi(m)).segui, false);
  }
  impostazioni = {};
  assert.deepEqual(await Testo.stato(), { ok: true, pagine: 0, campi: 0 });
  // La regola delle delicate spenta dall'utente: nessuna pagina è delicata, nemmeno qui.
  impostazioni = { security: { pagineDelicate: { enabled: false } } };
  assert.equal((await scrivi(mittente('https://mail.google.com/'), [campo('x')])).segui, true);
});

test('cancellare li toglie tutti, dal disco; spegnere la voce li toglie già', async () => {
  impostazioni = {};
  const f = join(cartella, 'cancella.json');
  Testo._test.usaFile(f);
  await scrivi(mittente('https://uno.it/'), [campo('uno')]);
  await scrivi(mittente('https://due.it/'), [campo('due'), campo('tre', { nome: 'x' })]);
  assert.deepEqual(await Testo.stato(), { ok: true, pagine: 2, campi: 3 });
  assert.deepEqual(await Testo.cancellaTutto(), { ok: true, pagine: 0, campi: 0 });
  assert.doesNotMatch(readFileSync(f, 'utf8'), /uno|due|tre/);
  await scrivi(mittente('https://uno.it/'), [campo('di nuovo')]);
  Testo.impostazioni({ testoDeiCampi: { attivo: false } });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(await Testo.stato(), { ok: true, pagine: 0, campi: 0 });
  assert.doesNotMatch(readFileSync(f, 'utf8'), /di nuovo/);
});

test('una durata accorciata toglie subito il testo che è già oltre', async () => {
  impostazioni = { testoDeiCampi: { giorni: 30 } };
  Testo._test.usaFile(join(cartella, 'durata.json'));
  const s = mittente('https://esempio.it/vecchio');
  const vero = Date.now;
  try {
    Date.now = () => vero() - 3 * DAY;
    await scrivi(s, [campo('di tre giorni fa')]);
  } finally { Date.now = vero; }
  assert.equal((await Testo.stato()).campi, 1);
  impostazioni = { testoDeiCampi: { giorni: 1 } };
  Testo.impostazioni(impostazioni);
  assert.deepEqual((await leggi(s)).campi, []);
});
