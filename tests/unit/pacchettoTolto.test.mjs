// #2270: le unioni hanno una strada sola, il pacchetto del manutentore. `feedback:apri --pacchetto` non apre niente e
// dice dove si chiedono; il client non scrive più `unisce`, e le regole lo vietano alla nascita come `unitoIn`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SCRIPT = await import('../../scripts/claude-feedback.mjs');
const FB = globalThis.SN_FEEDBACK;
SCRIPT.credenziale.ottieni = async () => ({ idToken: 'tok-test' });
SCRIPT.ambiente.routine = () => false;

test('feedback:apri --pacchetto non apre niente e dice che le unioni le chiede il manutentore', async () => {
  const orig = { submit: FB.submit, err: console.error, log: console.log };
  const err = [];
  let aperti = 0;
  FB.submit = async () => { aperti += 1; return { id: 'x', seq: 1, senderProof: 'admin' }; };
  console.error = (...a) => err.push(a.join(' '));
  console.log = () => {};
  try {
    for (const args of [['t', 'spec', '--non-locale', '--pacchetto', '812,815'], ['t', 'spec', '--locale', '--pacchetto=812,815', '--dry-run']]) {
      assert.equal(await SCRIPT.main(args), SCRIPT.EXIT.USO, args.join(' '));
    }
  } finally { FB.submit = orig.submit; console.error = orig.err; console.log = orig.log; }
  assert.equal(aperti, 0, 'nessun feedback aperto');
  assert.match(err.join('\n'), /le unioni le chiede il manutentore \(npm run manutentore -- pacchetto 812,815\)/);
});

test('pacchetto: la lista scritta con lo spazio dopo la virgola è la forma nuova; due parole senza virgola la vecchia', async () => {
  const { datiDelPacchetto } = await import('../../scripts/manutentore.mjs');
  assert.deepEqual(datiDelPacchetto(['812,', '815']), { unisce: ['812', '815'] });
  assert.deepEqual(datiDelPacchetto(['812,', '815,', '816', '--server']), { unisce: ['812', '815', '816'] });
  assert.equal(datiDelPacchetto(['812', '815,816']).numero, '812', 'la forma vecchia va al server, che la rifiuta col motivo');
});

test('chi lavora un pacchetto sa che la riga di changelog porta i numeri delle unite', () => {
  const unite = readFileSync(new URL('../../routines/roles/_unite.md', import.meta.url), 'utf8');
  assert.match(unite, /segnalazione: \[/);
});

test('il client non scrive `unisce`, e le regole lo vietano alla creazione come `unitoIn`', () => {
  const src = readFileSync(new URL('../../src/shared/feedback.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /fields\.unisce/);
  const regole = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  assert.doesNotMatch(regole, /unisceValido/);
  assert.match(regole, /allow create: if isAdmin\(\)[\s\S]*?hasAny\(\[[^\]]*'unisce', 'unitoIn'\]\)/);
});
