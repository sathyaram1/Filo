// `--segnala` sul canale delle routine vuole un FILE: senza, la frase deve
// dirlo (come dispatch --record-*), non chiedere «un testo» — chi la leggeva
// provava a passare la segnalazione sulla riga di comando e sbagliava due
// volte (verifica del ramo claude/livelli, giro 1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANALE = join(__dirname, '..', '..', 'scripts', 'routine-channel.mjs');

test('deliver fixed --segnala senza file: chiede il percorso di un file, e non consegna', () => {
  const r = spawnSync(process.execPath, [CANALE, 'deliver', 'fixed', '--segnala'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--segnala vuole il percorso di un file/);
  assert.doesNotMatch(r.stderr, /vuole un testo/);
});

test('gli altri campi di testo senza valore dicono ancora «un testo»', () => {
  const r = spawnSync(process.execPath, [CANALE, 'deliver', 'fixed', '--report'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--report vuole un testo dopo di sé/);
});
