// Ogni messaggio che manda a rimettere la parola della costruzione nomina lo stesso posto, l'ambiente «rilascio»:
// i lavori la leggono da lì, e una rimessa fra i segreti del repo non cambia niente (#1210).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOVE_VA_LA_PAROLA } from '../../scripts/build-alarm.mjs';
import { messageForBump } from '../../scripts/release-bump.mjs';
import { descriviEsitoServer } from '../../scripts/bake-default-config.mjs';

test('aumento di versione rifiutato: rimanda all\'ambiente «rilascio», non al segreto del repo', () => {
  const msg = messageForBump({ outcome: 'denied' });
  assert.ok(msg.includes(DOVE_VA_LA_PAROLA), msg);
  assert.doesNotMatch(msg, /segreto FILO_BUILD_PASSPHRASE del repo/);
});

test('chiavi di default rifiutate: dice dove ricopiare la parola', () => {
  const msg = descriviEsitoServer({ stato: 'rifiutato', reason: 'bad_passphrase' });
  assert.ok(msg.includes(DOVE_VA_LA_PAROLA), msg);
});

test('il posto nominato è l\'ambiente «rilascio»', () => {
  assert.match(DOVE_VA_LA_PAROLA, /ambiente «rilascio»/);
});
