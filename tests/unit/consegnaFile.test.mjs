// I pezzi grossi del payload di dispatch vanno in file fuori dal repo, interi; la stampa resta corta.
// Rosso se il diff torna nella stampa, se un file perde un pezzo, o se un file sopravvive al ruolo dopo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { scaricaPayload, cartellaConsegna, PAYLOAD_IN_STAMPA_MAX } from '../../scripts/lib/consegna-file.mjs';

const BASE = cartellaTemporanea('filo-consegna-test-');
const ROOT = resolve(BASE, 'progetto');
test.after(() => rmSync(BASE, { recursive: true, force: true }));

test('il diff esce sempre dalla stampa e il file lo contiene tutto', () => {
  const diff = `diff --git a/x b/x\n${'+riga àèì\n'.repeat(9000)}`;
  const p = scaricaPayload({ branch: 'worker/a', diff, id: 'a' }, { root: ROOT, base: BASE, sempre: ['diff'] });
  assert.equal(p.diff, undefined);
  assert.ok(isAbsolute(p.diffFile), p.diffFile);
  assert.equal(readFileSync(p.diffFile, 'utf8'), diff, 'nessun troncamento');
  assert.equal(p.diffCaratteri, diff.length);
  assert.equal(p.branch, 'worker/a');
  assert.ok(JSON.stringify(p).length < PAYLOAD_IN_STAMPA_MAX);
});

test('un diff piccolo esce lo stesso: il ruolo lo cerca sempre nello stesso posto', () => {
  const p = scaricaPayload({ diff: 'diff --git a/y b/y\n+1' }, { root: ROOT, base: BASE, sempre: ['diff'] });
  assert.equal(readFileSync(p.diffFile, 'utf8'), 'diff --git a/y b/y\n+1');
});

test('un altro campo enorme esce in un file, citato al suo posto e in fileEsterni', () => {
  const testo = 'spec lunga '.repeat(3000);
  const entrata = { feedback: { text: testo, num: '#5' }, history: [{ critique: 'corta' }] };
  const p = scaricaPayload(entrata, { root: ROOT, base: BASE });
  const f = p.fileEsterni['feedback.text'];
  assert.ok(isAbsolute(f));
  assert.equal(readFileSync(f, 'utf8'), testo);
  assert.ok(p.feedback.text.includes(f) && p.feedback.text.includes(String(testo.length)));
  assert.equal(p.feedback.num, '#5');
  assert.equal(p.history[0].critique, 'corta', 'i pezzi corti restano in stampa');
  assert.equal(entrata.feedback.text, testo, 'il payload passato non si tocca');
  assert.ok(JSON.stringify(p).length < PAYLOAD_IN_STAMPA_MAX);
});

test('un payload che sta nella stampa non cambia', () => {
  const entrata = { feedback: { text: 'breve' }, scope: 'pieno' };
  assert.deepEqual(scaricaPayload(entrata, { root: ROOT, base: BASE }), entrata);
});

test('la consegna dopo cancella i file di quella prima: un ruolo non eredita il materiale di un altro', () => {
  const primo = scaricaPayload({ feedback: { text: 'segreto '.repeat(2000) } }, { root: ROOT, base: BASE });
  const f = primo.fileEsterni['feedback.text'];
  assert.ok(existsSync(f));
  scaricaPayload({ diff: 'diff' }, { root: ROOT, base: BASE, sempre: ['diff'] });
  assert.equal(existsSync(f), false);
});

test('tanti pezzi corti che sommati sforano escono in gruppo, come JSON intero', () => {
  const decisioni = Array.from({ length: 40 }, (_, i) => ({ domanda: `domanda ${i} `.repeat(30), risposta: 'sì' }));
  const p = scaricaPayload({ feedback: { text: 'corto' }, decisioni }, { root: ROOT, base: BASE });
  assert.ok(JSON.stringify(p).length < PAYLOAD_IN_STAMPA_MAX, `payload di ${JSON.stringify(p).length}`);
  const f = p.fileEsterni.decisioni;
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), decisioni);
  assert.match(p.decisioni, /di JSON/);
});

test('con `misura` conta la stampa intera: un testo fisso accanto al payload riduce lo spazio', () => {
  const fisso = 'istruzioni '.repeat(2000);
  const entrata = { feedback: { text: 'x'.repeat(6000) } };
  const misura = (q) => JSON.stringify({ instructions: fisso, payload: q }, null, 2).length;
  assert.deepEqual(scaricaPayload(entrata, { root: ROOT, base: BASE }), entrata, 'da solo il payload sta nel tetto');
  const p = scaricaPayload(entrata, { root: ROOT, base: BASE, max: 25000, misura });
  assert.ok(misura(p) <= 25000, `stampa di ${misura(p)}`);
  assert.equal(readFileSync(p.fileEsterni['feedback.text'], 'utf8'), entrata.feedback.text);
});

test('due progetti diversi non condividono la cartella', () => {
  assert.notEqual(cartellaConsegna(ROOT, BASE), cartellaConsegna(resolve(BASE, 'altro'), BASE));
});
