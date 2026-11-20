// #2377 — bloccare il computer (src/main/services/bloccaComputer.js): un ramo per Windows, Mac e Linux, e nelle prove
// la macchina di chi le lancia non si blocca mai. La lettera e la chat ci passano tutte e due.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const B = require('../../src/main/services/bloccaComputer.js');

test('un ramo per ogni sistema, il primo tentativo è quello che non chiede permessi', () => {
  assert.deepEqual(B.tentativi('win32'), [['rundll32.exe', ['user32.dll,LockWorkStation']]]);
  const mac = B.tentativi('darwin');
  assert.equal(mac[0][0], 'osascript');
  assert.match(mac[0][1].join(' '), /SACLockScreenImmediate/);
  assert.deepEqual(mac[mac.length - 1], ['pmset', ['displaysleepnow']]);
  const linux = B.tentativi('linux');
  assert.deepEqual(linux[0], ['loginctl', ['lock-session']]);
  assert.ok(linux.length >= 3, 'i desktop che non ascoltano logind hanno il loro strumento');
  assert.deepEqual(B.tentativi('aix'), []);
});

test('nelle prove non si blocca niente; il finto risponde, e un errore ha la sua frase', async () => {
  const prima = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    assert.deepEqual(await B.blocca({ piattaforma: 'win32' }), { ok: false, errore: 'prove' });
    const chiesti = [];
    B._perProve.usaFinto((p) => { chiesti.push(p); return { ok: true }; });
    assert.deepEqual(await B.blocca({ piattaforma: 'linux' }), { ok: true });
    assert.deepEqual(chiesti, ['linux']);
  } finally {
    B._perProve.usaFinto(null);
    process.env.NODE_ENV = prima;
  }
  assert.match(B.frase('non-supportato'), /non sa bloccare/);
  assert.match(B.frase('qualunque'), /non si è bloccato/);
});

test('la lettera B e lo strumento della chat chiamano la stessa funzione', () => {
  const lettere = readFileSync(new URL('../../src/main/lettereDiFilo.js', import.meta.url), 'utf8');
  const chat = readFileSync(new URL('../../src/main/services/azioni/sistema.js', import.meta.url), 'utf8');
  assert.match(lettere, /require\('\.\/services\/bloccaComputer'\)[\s\S]{0,40}\.blocca\(\)/);
  assert.match(chat, /require\('\.\.\/bloccaComputer'\)[\s\S]{0,40}\.blocca\(\)/);
});
