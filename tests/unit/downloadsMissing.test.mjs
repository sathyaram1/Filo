// Unit test per src/main/services/downloads.js — la parte che riguarda il file
// SPARITO dopo lo scaricamento (#410.4): l'utente sposta o cestina il file, poi
// preme "Apri file" e non deve trovare silenzio.
//
// Qui si prova la logica pura (nessun Electron): a partire da un record, la
// forma pubblica che arriva alle superfici deve dire se il file è ancora sul
// disco. Senza quel dato la barra e la pagina elenco non possono attenuare la
// voce né togliere "Apri file".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const DL = require(join(ROOT, 'src', 'main', 'services', 'downloads.js'));

const dir = mkdtempSync(join(tmpdir(), 'filo-dl-'));

function rec(over) {
  return {
    id: 'x', filename: 'file.bin', url: 'http://x/file.bin', mime: '',
    totalBytes: 10, receivedBytes: 10, state: 'completed',
    savePath: join(dir, 'file.bin'), startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z', ...over,
  };
}

test('un file ancora sul disco non è "sparito"', () => {
  const p = join(dir, 'presente.bin');
  writeFileSync(p, 'ciao');
  const r = rec({ savePath: p });
  assert.equal(DL._isMissing(r), false);
  assert.equal(DL._publicRecord(r).missing, false);
});

test('se il file viene spostato o cancellato, la voce lo dichiara', () => {
  const p = join(dir, 'sparito.bin');
  writeFileSync(p, 'ciao');
  const r = rec({ savePath: p });
  assert.equal(DL._publicRecord(r).missing, false, 'parte da presente');
  unlinkSync(p);                       // l'utente cestina il file
  // La presenza su disco passa da una cache a scadenza breve (evita centinaia di
  // stat al secondo mentre una barra avanza); un'azione dell'utente la scavalca,
  // come fa "Apri file" nel main.
  DL._forgetExists(p);
  assert.equal(DL._isMissing(r), true);
  assert.equal(DL._publicRecord(r).missing, true);
});

test('uno scaricamento non completato non viene marcato "sparito"', () => {
  // Interrotto/annullato: il file completo non è MAI esistito. Dire "non c'è
  // più" sarebbe falso, e trasformerebbe ogni download fallito in un mistero.
  for (const state of ['interrupted', 'cancelled', 'progressing', 'paused']) {
    const r = rec({ state, savePath: join(dir, 'mai-esistito.bin') });
    assert.equal(DL._isMissing(r), false, `stato ${state}`);
    assert.equal(DL._publicRecord(r).missing, false, `stato ${state}`);
  }
});

test('una voce completata senza percorso vale come sparita', () => {
  const r = rec({ savePath: '' });
  assert.equal(DL._isMissing(r), true);
});

test('la frase mostrata all\'utente nomina il file, non un codice d\'errore', () => {
  assert.match(DL.MISSING_TEXT, /file/i);
  assert.match(DL.MISSING_TEXT, /spostat|cancellat/i);
});
