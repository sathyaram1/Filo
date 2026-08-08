// Unit test — i flush dello storage devono essere serializzati.
//
// Regressione reale: due flush concorrenti condividono lo stesso file .tmp
// (write-then-rename): il primo rinomina il tmp, la rename del secondo trova
// ENOENT e la scrittura va persa con "[Filo storage] flush failed" nel log.
// Succedeva a ogni avvio con storage grande (~5MB): la scrittura async dura
// più del debounce (100ms) e il flush successivo partiva mentre il precedente
// era ancora in volo.
//
// Electron è mockato (pattern di protocol.test.mjs); FILO_USER_DATA punta a un
// tempdir isolato.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const userData = mkdtempSync(join(tmpdir(), 'filo-storage-test-'));
process.env.FILO_USER_DATA = userData;

const electronMock = {
  app: { getPath: () => userData },
  safeStorage: { isEncryptionAvailable: () => false },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return origLoad.call(this, request, parent, isMain);
};

const Storage = require(join(__dirname, '..', '..', 'src', 'main', 'shim', 'storage.js'));

// ⚠️ Storia di questo test (2026-08-07). Nella forma precedente faceva una
// raffica di `set()` intervallati da attese, e poi aspettava FINO A 15 SECONDI
// che il file comparisse su disco. Due difetti:
//
//   1. non riproduceva il guasto: rimuovendo la serializzazione dei flush
//      passava IDENTICO. Poteva passare in entrambi gli stati, cioè non
//      verificava niente (vedi CLAUDE.md § "Test che servono davvero");
//   2. l'attesa a orologio bastava a macchina scarica e non sotto carico, quindi
//      cadeva a caso — lamentando dati incoerenti invece dell'attesa scaduta.
//
// Ora la collisione viene provocata direttamente — due scritture forzate senza
// attendere la prima — e l'attesa è deterministica.
test('due flush simultanei non si rubano il file temporaneo', async () => {
  const errors = [];
  const realError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); };
  try {
    // Payload grande: la scrittura dura abbastanza da tenere davvero in volo il
    // primo flush mentre parte il secondo.
    const big = 'x'.repeat(2 * 1024 * 1024);
    await Storage.set({ grande: big, contatore: 0 });

    // Le due scritture partono INSIEME (nessun await sulla prima). Senza
    // serializzazione condividono lo stesso file temporaneo: la prima lo
    // rinomina, la seconda non lo trova più e la scrittura va persa.
    await Storage.set({ contatore: 1 });
    const a = Storage.flushNow();
    const b = Storage.flushNow();
    await Promise.all([a, b]);

    await Storage.set({ contatore: 2 });
    await Storage.whenSettled();
  } finally {
    console.error = realError;
  }

  const flushErrors = errors.filter((e) => e.includes('flush failed'));
  assert.deepEqual(flushErrors, [], `flush falliti: ${flushErrors.join(' | ')}`);

  // Il file su disco deve esistere, essere JSON valido e contenere l'ULTIMO stato.
  const onDisk = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
  assert.equal(onDisk.contatore, 2);
  assert.equal(onDisk.grande.length, 2 * 1024 * 1024);
});
