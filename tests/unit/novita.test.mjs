// La pagina Novità sul registro vero e su registri finti: versioni uscite dalla più recente, filtro che regge
// maiuscole, accenti e un errore di battitura, righe legate a una segnalazione (#1956).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'patchNotes.js'));
require(join(ROOT, 'src', 'shared', 'novita.js'));
const PN = globalThis.SN_PATCH_NOTES;
const N = globalThis.SN_NOVITA;
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const FINTO = [
  { version: '0.3.2', date: '2026-11-02', features: ['Ancora da uscire'], fixes: [] },
  { version: '0.3.1', date: '2026-11-01', features: [{ testo: 'La pagina Novità elenca tutte le versioni.', segnalazione: 1956 }],
    fixes: ['Il download riparte dopo un\'interruzione.'] },
  { version: '0.3.0', date: '2026-10-05', features: ['Le schede si riordinano per colore.'],
    fixes: ['L\'aggiornamento non chiude più le finestre aperte.'] },
];

test('le versioni uscite arrivano dalla più recente, senza il blocco della prossima', () => {
  const v = N.uscite(FINTO, '0.3.1');
  assert.deepEqual(v.map((x) => x.version), ['0.3.1', '0.3.0']);
  assert.deepEqual(v[0].features[0], { testo: 'La pagina Novità elenca tutte le versioni.', segnalazione: 1956 });
  assert.deepEqual(v[0].fixes[0], { testo: 'Il download riparte dopo un\'interruzione.', segnalazione: null });
});

test('sul registro vero ci sono almeno due versioni, e nessuna sopra quella installata', () => {
  const v = N.uscite(null, pkg.version);
  assert.ok(v.length >= 2);
  for (let i = 1; i < v.length; i++) assert.ok(PN.cmpVersion(v[i - 1].version, v[i].version) > 0);
  assert.ok(v.every((x) => PN.cmpVersion(x.version, pkg.version) <= 0));
  assert.ok(v.every((x) => [...x.features, ...x.fixes].every((r) => typeof r.testo === 'string' && r.testo)));
});

test('il filtro tiene le sole righe con tutte le parole, senza badare a maiuscole e accenti', () => {
  const v = N.uscite(FINTO, '0.3.1');
  const r = N.filtra(v, 'NOVITA versioni');
  assert.equal(r.righe, 1);
  assert.equal(r.versioni[0].features[0].segnalazione, 1956);
  assert.deepEqual(r.approssimati, []);
  assert.equal(N.filtra(v, '   ').righe, 4, 'un campo di soli spazi non filtra niente');
  assert.equal(N.filtra(v, 'novità colore').righe, 0, 'due parole di righe diverse non fanno una riga');
});

test('si cerca anche per numero di versione e per mese', () => {
  const v = N.uscite(FINTO, '0.3.1');
  assert.deepEqual(N.filtra(v, '0.3.0').versioni.map((x) => x.version), ['0.3.0']);
  assert.deepEqual(N.filtra(v, 'ottobre').versioni.map((x) => x.version), ['0.3.0']);
});

test('una parola sbagliata di una lettera trova lo stesso, e la risposta lo dice', () => {
  const v = N.uscite(FINTO, '0.3.1');
  const r = N.filtra(v, 'agiornamento');
  assert.equal(r.righe, 1);
  assert.match(r.versioni[0].fixes[0].testo, /aggiornamento/);
  assert.deepEqual(r.approssimati, ['agiornamento']);
  assert.equal(N.filtra(v, 'scehde').righe, 1, 'due lettere scambiate');
  assert.equal(N.filtra(v, 'xqzw').righe, 0, 'una parola corta che non c\'è non pesca a caso');
});

test('i tratti da evidenziare cadono sulle lettere giuste, anche con gli accenti', () => {
  const testo = 'La pagina Novità elenca le novità.';
  const r = N.filtra([{ version: '1.0.0', date: '', features: [{ testo, segnalazione: null }], fixes: [] }], 'novita');
  const tratti = N.tratti(testo, r.termini);
  assert.deepEqual(tratti.map(([a, b]) => testo.slice(a, b)), ['Novità', 'novità']);
});

test('HTML ed emoji nel campo restano testo da cercare', () => {
  const v = N.uscite(FINTO, '0.3.1');
  assert.equal(N.filtra(v, '<img src=x onerror=alert(1)>').righe, 0);
  assert.equal(N.filtra(v, '🎉').righe, 0);
  assert.equal(N.filtra(v, 'x'.repeat(5000)).righe, 0);
});

test('la data si legge in italiano e il testo copiato di una versione ha titolo e righe', () => {
  assert.equal(N.dataLeggibile('2026-10-31'), '31 ottobre 2026');
  assert.equal(N.dataLeggibile('boh'), '');
  const [v] = N.uscite(FINTO, '0.3.1');
  assert.equal(N.testoVersione(v),
    'Filo 0.3.1 (1 novembre 2026)\n\nNuove funzioni:\n• La pagina Novità elenca tutte le versioni.\n\nCorrezioni:\n• Il download riparte dopo un\'interruzione.');
});

test('una riga legata a una segnalazione resta testo per il recap e le impronte', () => {
  const salvate = PN.NOTES.splice(0, PN.NOTES.length, ...FINTO);
  try {
    const recap = PN.since('0.3.0', '0.3.1');
    assert.deepEqual(recap[0].features, ['La pagina Novità elenca tutte le versioni.']);
    assert.equal(PN.impronta(FINTO[1].features[0]), PN.impronta('La pagina Novità elenca tutte le versioni.'));
    const foto = PN.fotografia('0.3.0');
    assert.deepEqual(PN.recap('0.3.0', '0.3.1', foto)[0].features, ['La pagina Novità elenca tutte le versioni.']);
  } finally {
    PN.NOTES.splice(0, PN.NOTES.length, ...salvate);
  }
});

test('ogni riga del registro è testo, o un oggetto con testo e numero di segnalazione', () => {
  for (const n of PN.NOTES) {
    for (const r of [...(n.features || []), ...(n.fixes || [])]) {
      if (typeof r === 'string') continue;
      assert.equal(typeof r.testo, 'string', `${n.version}: riga senza testo`);
      assert.ok(Number.isInteger(r.segnalazione) && r.segnalazione > 0, `${n.version}: «${r.testo.slice(0, 60)}» ha un numero di segnalazione non valido`);
      assert.deepEqual(Object.keys(r).sort(), ['segnalazione', 'testo'], `${n.version}: campi in più`);
    }
  }
});

// Le righe uscite portano il numero ritrovato nelle fusioni del registro: senza, «Apri la segnalazione» non
// comparirebbe su nessuna riga vera. Una riscrittura del registro che perde i numeri si ferma qui.
test('una parte vera delle righe uscite si apre sulla sua segnalazione', () => {
  const righe = N.uscite(null, pkg.version).flatMap((v) => [...v.features, ...v.fixes]);
  const collegate = righe.filter((r) => r.segnalazione);
  assert.ok(collegate.length >= Math.ceil(righe.length / 10), `${collegate.length} righe collegate su ${righe.length}`);
});
