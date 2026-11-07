// `--segnala` sul canale delle routine non c'è più (#1790): anche senza file la frase
// dice di scrivere la domanda in JSON (come dispatch --record-*), non chiede «un testo».
// Gli altri campi di testo senza valore dicono ancora «un testo».

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANALE = join(__dirname, '..', '..', 'scripts', 'routine-channel.mjs');

test('deliver fixed --segnala senza file: dice di scrivere la domanda, e non consegna', () => {
  const r = spawnSync(process.execPath, [CANALE, 'deliver', 'fixed', '--segnala'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--segnala non c'è più: il server non compone domande/);
  assert.match(r.stderr, /--domanda <file\.json>/);
  assert.doesNotMatch(r.stderr, /vuole un testo/);
});

test('gli altri campi di testo senza valore dicono ancora «un testo»', () => {
  const r = spawnSync(process.execPath, [CANALE, 'deliver', 'fixed', '--report'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--report vuole un testo dopo di sé/);
});
