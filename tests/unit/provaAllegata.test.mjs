// La prova da utente allegata alla consegna (#2539): la cartella di tests/agent/prova.mjs arriva al server con l'esito
// intero e le schermate caricate nell'ordine dei passi, e chi consegna legge se l'owner la trova. Il deposito è finto;
// la CLI vera parla con un server finto su HTTP locale.

import '../helpers/senzaSessione.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';
import { provaDaAllegare, ordineSchermate, testoProvaConsegnata, moduloAllegati } from '../../scripts/lib/prova-allegata.mjs';
import { resoconto } from '../agent/provaRegole.mjs';
import { leggiOpzioniRegistrazione, fixedPayload } from '../../scripts/dispatch.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANALE = join(__dirname, '..', '..', 'scripts', 'routine-channel.mjs');
const BIGLIETTO = 'p'.repeat(43);
const BASE = cartellaTemporanea('filo-prova-allegata-');
let n = 0;

// La cartella come la scrive la prova vera: il resoconto di provaRegole e le schermate coi nomi di prova.mjs.
function cartella({ passi = 2, finale = true, extra = {} } = {}) {
  const dir = join(BASE, `prova-${++n}`);
  mkdirSync(dir, { recursive: true });
  const lista = Array.from({ length: passi }, (_, i) => ({ n: i + 1, vedo: `schermata ${i + 1}`, mossa: { azione: 'clic', x: 1, y: 1 }, schermata: `passo-${String(i + 1).padStart(2, '0')}.png` }));
  const esito = { esito: 'riuscito', codice: 0, riga: `Riuscito in ${passi} passi: fatto` };
  writeFileSync(join(dir, 'esito.md'), resoconto({
    opzioni: { compito: 'salva una nota', modo: 'utente', modello: 'haiku' }, esito, passi: lista,
    servito: { modelli: ['haiku'], fornitore: 'anthropic' }, costo: 0, secondi: 30, finale: finale ? 'finale.png' : '',
  }));
  for (const p of lista) writeFileSync(join(dir, p.schermata), Buffer.from(`png ${p.n}`));
  if (finale) writeFileSync(join(dir, 'finale.png'), Buffer.from('png finale'));
  writeFileSync(join(dir, 'esito.json'), '{}');
  for (const [nome, byte] of Object.entries(extra)) writeFileSync(join(dir, nome), byte);
  return dir;
}

const caricaFinta = (registro = []) => async (byte, nome) => {
  registro.push({ nome, byte: byte.toString() });
  return `https://deposito.test/${nome}`;
};

test('la cartella di una prova: esito intero, schermate nell\'ordine dei passi con la finale in fondo, file non immagine fuori', async () => {
  const dir = cartella({ passi: 3, extra: { 'aaa-prima.png': Buffer.from('in più') } });
  const caricate = [];
  const r = await provaDaAllegare(dir, { carica: caricaFinta(caricate) });
  assert.equal(r.ok, true, r.errore);
  assert.match(r.prova.esito, /^# Prova da utente: riuscito/);
  assert.match(r.prova.esito, /Riuscito in 3 passi/);
  assert.deepEqual(r.prova.schermate.map((s) => s.nome), ['passo-01.png', 'passo-02.png', 'passo-03.png', 'finale.png', 'aaa-prima.png']);
  assert.deepEqual(r.prova.schermate.map((s) => s.url), r.prova.schermate.map((s) => `https://deposito.test/${s.nome}`));
  assert.equal(caricate.find((c) => c.nome === 'passo-02.png').byte, 'png 2', 'ogni schermata sale coi suoi byte');
});

test('l\'ordine segue i rimandi dell\'esito, anche con un percorso davanti, senza doppioni', () => {
  const esito = '![b](./b.png) ![a](sotto/a.png) ![b di nuovo](b.png) ![manca](z.png)';
  assert.deepEqual(ordineSchermate(esito, ['a.png', 'b.png', 'c.png']), ['b.png', 'a.png', 'c.png']);
});

test('senza esito.md la cartella non è una prova: niente sale nel deposito', async () => {
  const dir = join(BASE, 'vuota');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'passo-01.png'), 'x');
  const caricate = [];
  const r = await provaDaAllegare(dir, { carica: caricaFinta(caricate) });
  assert.equal(r.ok, false);
  assert.match(r.errore, /non leggo esito\.md/);
  assert.match(r.errore, /Non ho consegnato niente/);
  assert.deepEqual(caricate, []);
});

test('una schermata oltre il tetto del deposito ferma tutto col suo nome e i numeri, prima di caricare', async () => {
  const tetto = moduloAllegati().TETTO_ALLEGATO;
  const dir = cartella({ extra: { 'enorme.png': Buffer.alloc(tetto + 1) } });
  const caricate = [];
  const r = await provaDaAllegare(dir, { carica: caricaFinta(caricate) });
  assert.equal(r.ok, false);
  assert.match(r.errore, /enorme\.png è di 4\.0 MB, il deposito ne prende al più 4\.0 per schermata/);
  assert.deepEqual(caricate, []);
});

test('una schermata che non sale ferma la consegna: la prova arriva intera o non parte', async () => {
  const dir = cartella();
  const r = await provaDaAllegare(dir, {
    carica: async (_b, nome) => { if (nome === 'passo-02.png') throw new Error('upload storage fallito (503)'); return `https://deposito.test/${nome}`; },
  });
  assert.equal(r.ok, false);
  assert.match(r.errore, /1 schermate su 3 non sono salite nel deposito: passo-02\.png \(upload storage fallito \(503\)\)/);
  assert.match(r.errore, /consegna senza --prova/);
});

test('la riga dopo la consegna dice se l\'owner trova la prova, e cosa fare se no', () => {
  const inviata = { esito: 'x', schermate: [{ nome: 'a.png', url: 'u' }, { nome: 'b.png', url: 'u' }] };
  assert.match(testoProvaConsegnata(inviata, { ok: true, schermate: 2 }), /Prova allegata al report per l'owner: esito e 2 schermate/);
  assert.match(testoProvaConsegnata(inviata, { ok: false, detail: 'feedback sparito' }), /registrata ma la prova no \(feedback sparito\): mandala con deliver note/);
  assert.match(testoProvaConsegnata(inviata, undefined), /server vecchio\?/);
  assert.equal(testoProvaConsegnata(null, undefined), '');
});

test('dispatch --record-fixed --prova: la cartella è un\'opzione sua e viaggia nella consegna', () => {
  const o = leggiOpzioniRegistrazione(['--record-fixed', 'abc', 'report', '--prova', 'tests/agent/.out/prova-1']);
  assert.equal(o.error, '');
  assert.equal(o.valori['--prova'], 'tests/agent/.out/prova-1');
  assert.deepEqual(o.args, ['--record-fixed', 'abc', 'report']);
  assert.match(leggiOpzioniRegistrazione(['--record-fixed', 'abc', 'r', '--prova']).error, /--prova vuole la cartella della prova/);
  assert.match(leggiOpzioniRegistrazione(['--record-verifier', 'abc', 'r', '--prova', 'x']).error, /--prova non vale con --record-verifier/);
  const prova = { esito: 'e', schermate: [] };
  assert.deepEqual(fixedPayload({ report: 'r', prova }).prova, prova);
  assert.ok(!('prova' in fixedPayload({ report: 'r' })));
});

let server;
let base = '';
let arrivate = [];
let risposta = {};
before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      arrivate.push({ path: req.url, body: JSON.parse(raw || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(risposta));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); });

function lancia(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CANALE, ...args], { env: { ...process.env, FILO_ROUTINE_API: base, FILO_ROUTINE_TICKET: '' }, encoding: 'utf8', timeout: TETTO_ATTESA_MS },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

test('deliver note --prova: al server va l\'esito della cartella, e chi consegna legge che l\'owner la trova', async () => {
  arrivate = [];
  risposta = { ok: true, prova: { ok: true, schermate: 0 } };
  const dir = cartella({ passi: 0, finale: false });
  const r = await lancia(['deliver', BIGLIETTO, 'note', '--notes', 'la prova del lavoro', '--prova', dir]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Prova allegata al report per l'owner: esito e 0 schermate/);
  assert.equal(arrivate.length, 1);
  assert.equal(arrivate[0].body.intent, 'note');
  assert.match(arrivate[0].body.data.prova.esito, /# Prova da utente: riuscito/);
  assert.deepEqual(arrivate[0].body.data.prova.schermate, []);
  assert.equal(arrivate[0].body.data.notes, 'la prova del lavoro');
});

test('deliver --prova: fuori da status, fixed e note, o senza cartella, si ferma prima del server', async () => {
  arrivate = [];
  const piano = await lancia(['deliver', BIGLIETTO, 'piano', '--piano', join(BASE, 'x.md'), '--prova', BASE]);
  assert.equal(piano.code, 1);
  assert.match(piano.stderr, /--prova vale solo con deliver status, fixed, note/);
  const senza = await lancia(['deliver', BIGLIETTO, 'note', '--notes', 'x', '--prova']);
  assert.equal(senza.code, 1);
  assert.match(senza.stderr, /--prova vuole la cartella della prova da utente/);
  const sbagliata = await lancia(['deliver', BIGLIETTO, 'note', '--notes', 'x', '--prova', join(BASE, 'non-ce')]);
  assert.equal(sbagliata.code, 1);
  assert.match(sbagliata.stderr, /non leggo esito\.md/);
  assert.equal(arrivate.length, 0);
});
