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

test('scritture in raffica non producono flush falliti e il file finale è integro', async () => {
  const errors = [];
  const realError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); };
  try {
    // Raffica di set() che si accavallano coi flush in volo: senza
    // serializzazione due flush condividono il .tmp e la rename perde (ENOENT).
    // Il payload grande allunga la scrittura e rende l'overlap quasi certo.
    const big = 'x'.repeat(2 * 1024 * 1024);
    for (let i = 0; i < 8; i++) {
      await Storage.set({ [`chiave${i}`]: big, contatore: i });
      // Lascia scattare il timer di debounce (100ms) così parte un flush vero
      // mentre le scritture successive ne accodano altri.
      await new Promise((r) => setTimeout(r, i % 2 ? 120 : 10));
    }
    // Attende la quiete in modo DETERMINISTICO (nessuna scadenza a orologio).
    // Prima si aspettava fino a 15 secondi che 16 MB arrivassero su disco: a
    // macchina scarica bastavano, con la suite completa in parallelo no — e il
    // test cadeva ogni tanto lamentando dati incoerenti invece dell'attesa
    // scaduta. La raffica concorrente qui sopra resta identica: è lì che si
    // riproduce la collisione fra flush, ed è quella che il test deve cogliere.
    await Storage.whenSettled();
  } finally {
    console.error = realError;
  }

  const flushErrors = errors.filter((e) => e.includes('flush failed'));
  assert.deepEqual(flushErrors, [], `flush falliti: ${flushErrors.join(' | ')}`);

  // Il file su disco deve esistere, essere JSON valido e contenere l'ULTIMO stato.
  const onDisk = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
  assert.equal(onDisk.contatore, 7);
  assert.equal(onDisk.chiave7.length, 2 * 1024 * 1024);
});
