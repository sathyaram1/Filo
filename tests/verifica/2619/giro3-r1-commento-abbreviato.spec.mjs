// #2619 giro 3 — dopo il riallineamento con #2621: l'opzione del commento scritta abbreviata non deve far passare
// per chiave il suo valore, come su main.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;
const CTX = { home: '/home/u', cwd: '/home/u/proj', shell: 'bash' };

test('r1 il comando del trasporto scritto dietro un commento abbreviato chiede conferma come il programma', () => {
  expect(C.classify('./evil.sh', CTX)).toBe(3);
  for (const cmd of [
    'git config --comm user.name core.sshCommand ./evil.sh',
    'git config --comme user.name core.sshCommand ./evil.sh',
    'git config --global --comm user.name core.pager ./evil.sh',
  ]) {
    expect(C.classify(cmd, CTX), cmd).toBe(3);
  }
});
