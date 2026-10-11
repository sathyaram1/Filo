// Il deposito a sole aggiunte su cui sta l'archivio delle schede (#825).
//
// Asserisce ciò che l'archivio promette all'utente: niente tetto (6000 record
// tornano tutti, in ordine, dopo un riavvio), un'aggiunta accoda una riga e non
// riscrive il file, una cancellazione toglie davvero il dato dal disco, e un
// arresto a metà riga non guasta le aggiunte dopo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { spiaDiscoSincrono } from '../helpers/spiaDisco.mjs';

const require = createRequire(import.meta.url);
const { creaDeposito } = require('../../src/main/services/depositoAggiunte.js');

const meseDi = (r) => String(r.closedAt || '').slice(0, 7);

function nuovo() {
  const cartella = join(cartellaTemporanea('filo-deposito-'), 'archivio');
  return { cartella, d: creaDeposito({ cartella, meseDi }) };
}

async function riapri(cartella) {
  const d = creaDeposito({ cartella, meseDi });
  await d.carica();
  return d;
}

function testoDiTutto(cartella) {
  return readdirSync(cartella).map((n) => readFileSync(join(cartella, n), 'latin1')).join('\n');
}

const scheda = (i, mese = '2026-01') => ({
  id: `id-${i}`,
  url: `https://sito-${i}.test/pagina`,
  title: `Scheda ${i}`,
  closedAt: `${mese}-15T10:00:00.000Z`,
  summary: `riassunto ${i}`,
  embedding: [i % 127, -(i % 127), 3],
});

test('6000 record: tornano tutti dopo un riavvio, dal più recente, coi vettori', async () => {
  const { cartella, d } = nuovo();
  for (let i = 0; i < 6000; i++) d.aggiungi(scheda(i, i < 3000 ? '2026-01' : '2026-02'));
  const r = await riapri(cartella);
  const tutti = r.tutti();
  assert.equal(tutti.length, 6000);
  assert.equal(tutti[0].id, 'id-5999');
  assert.equal(tutti[5999].id, 'id-0');
  assert.deepEqual(tutti[5999].embedding, [0, 0, 3]);
  assert.equal(tutti[5999].summary, 'riassunto 0');
  togliCartella(cartella);
});

test('aggiungere e aggiornare accodano una riga: il file non si riscrive', async () => {
  const { cartella, d } = nuovo();
  for (let i = 0; i < 500; i++) d.aggiungi(scheda(i));
  const file = join(cartella, '2026-01.jsonl');
  const prima = readFileSync(file, 'utf8');
  // Contato, non cronometrato: con 500 record un'aggiunta e un aggiornamento sono una riga in coda ciascuno (#1063).
  const visto = await spiaDiscoSincrono(cartella, () => {
    d.aggiungi(scheda(500));
    d.aggiorna('id-0', { summary: 'nuovo riassunto', embedding: [9, 9, 9], embedModel: 'm' });
  });
  assert.deepEqual(visto.map(({ n, righe }) => [n, righe]), [['appendFileSync', 1], ['appendFileSync', 1]], JSON.stringify(visto));
  const dopo = readFileSync(file, 'utf8');
  assert.ok(dopo.startsWith(prima), 'le righe di prima restano identiche, in testa al file');
  assert.equal(dopo.slice(prima.length).split('\n').filter(Boolean).length, 2);
  const r = await riapri(cartella);
  assert.equal(r.prendi('id-0').summary, 'nuovo riassunto');
  assert.deepEqual(r.prendi('id-0').embedding, [9, 9, 9]);
  assert.equal(r.prendi('id-0').url, 'https://sito-0.test/pagina');
  togliCartella(cartella);
});

test('togliere cancella il record dai file, e anche le sue righe di aggiornamento', async () => {
  const { cartella, d } = nuovo();
  for (let i = 0; i < 50; i++) d.aggiungi(scheda(i, i % 2 ? '2026-03' : '2026-04'));
  d.aggiorna('id-7', { summary: 'segreto-sette' });
  assert.equal(d.togli(['id-7', 'id-8', 'inesistente']), 2);
  const disco = testoDiTutto(cartella);
  assert.ok(!disco.includes('sito-7.test'));
  assert.ok(!disco.includes('segreto-sette'));
  assert.ok(!disco.includes('sito-8.test'));
  const r = await riapri(cartella);
  assert.equal(r.numero(), 48);
  assert.equal(r.prendi('id-7'), null);
  assert.equal(r.prendi('id-9').title, 'Scheda 9');
  togliCartella(cartella);
});

test('togliere con ripulisci riscrive anche i record che restano', async () => {
  const { cartella, d } = nuovo();
  d.aggiungi({ ...scheda(1, '2026-05'), coOpenUrls: [] });
  d.aggiungi({ ...scheda(2, '2026-06'), coOpenUrls: ['https://sito-1.test/pagina', 'https://altro.test/'] });
  d.togli(['id-1'], (r) => (r.coOpenUrls?.includes('https://sito-1.test/pagina')
    ? { ...r, coOpenUrls: r.coOpenUrls.filter((u) => u !== 'https://sito-1.test/pagina') } : r));
  assert.ok(!testoDiTutto(cartella).includes('sito-1.test'));
  const r = await riapri(cartella);
  assert.deepEqual(r.prendi('id-2').coOpenUrls, ['https://altro.test/']);
  togliCartella(cartella);
});

test('svuota toglie tutti i file; togliere l\'ultimo record di un mese toglie il file', async () => {
  const { cartella, d } = nuovo();
  d.aggiungi(scheda(1, '2026-07'));
  d.aggiungi(scheda(2, '2026-08'));
  d.togli(['id-1']);
  assert.deepEqual(readdirSync(cartella), ['2026-08.jsonl']);
  d.svuota();
  assert.deepEqual(readdirSync(cartella), []);
  assert.equal((await riapri(cartella)).numero(), 0);
  togliCartella(cartella);
});

test('in coda: migrazione e importazione finiscono dietro ai presenti, nel loro ordine', async () => {
  const { cartella, d } = nuovo();
  d.aggiungi(scheda(0));
  d.aggiungiMolti([scheda(1), scheda(2), scheda(0)], { inCoda: true });
  d.aggiungi(scheda(3));
  const ordine = ['id-3', 'id-0', 'id-1', 'id-2'];
  assert.deepEqual(d.tutti().map((x) => x.id), ordine);
  assert.deepEqual((await riapri(cartella)).tutti().map((x) => x.id), ordine);
  togliCartella(cartella);
});

test('una riga troncata da un arresto non si incolla alla prossima aggiunta', async () => {
  const { cartella, d } = nuovo();
  d.aggiungi(scheda(1));
  appendFileSync(join(cartella, '2026-01.jsonl'), '{"s":99,"r":{"id":"mez');
  const r = await riapri(cartella);
  assert.equal(r.numero(), 1);
  r.aggiungi(scheda(2));
  const r2 = await riapri(cartella);
  assert.deepEqual(r2.tutti().map((x) => x.id), ['id-2', 'id-1']);
  togliCartella(cartella);
});

test('molti aggiornamenti: il mese si ricompatta e non perde niente', async () => {
  const { cartella, d } = nuovo();
  for (let i = 0; i < 20; i++) d.aggiungi(scheda(i));
  for (let k = 0; k < 10; k++) for (let i = 0; i < 20; i++) d.aggiorna(`id-${i}`, { embedModel: `m${k}` });
  const righe = readFileSync(join(cartella, '2026-01.jsonl'), 'utf8').split('\n').filter(Boolean).length;
  assert.ok(righe <= 2 * 20 + 64 + 1, `righe nel file: ${righe}`);
  const r = await riapri(cartella);
  assert.equal(r.numero(), 20);
  assert.ok(r.tutti().every((x) => x.embedModel === 'm9' && x.summary));
  togliCartella(cartella);
});

test('un file scritto da mano con un mese strano non rompe il caricamento', async () => {
  const { cartella, d } = nuovo();
  d.aggiungi({ ...scheda(1), closedAt: 'non una data' });
  d.aggiungi({ ...scheda(2), closedAt: '+275760-09-13T00:00:00.000Z' });
  writeFileSync(join(cartella, 'appunti.txt'), 'non mio');
  const r = await riapri(cartella);
  assert.equal(r.numero(), 2);
  assert.ok(readdirSync(cartella).every((n) => /^\d{4}-\d{2}\.jsonl$/.test(n) || n === 'appunti.txt'));
  togliCartella(cartella);
});
