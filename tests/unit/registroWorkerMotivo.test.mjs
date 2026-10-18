// Il registro dei worker porta fino alla pagina il motivo del lancio (#532): senza, un rebase dopo un conflitto
// di fusione si legge «Correzione» come una bocciatura. Una voce senza motivo resta della forma di sempre.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const Defaults = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'defaultsStore.js'));

const voce = (campi) => ({ mapValue: { fields: Object.fromEntries(Object.entries(campi).map(([k, v]) => [k, { stringValue: v }])) } });

test('getWorkerLog tiene il motivo del lancio, e solo quando c\'è', async () => {
  const orig = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /config\/automation/);
    return {
      ok: true, status: 200,
      async json() {
        return { fields: { workerLog: { arrayValue: { values: [
          voce({ role: 'fixer', num: '#509', startedAt: '2026-10-18T10:00:00.000Z', motivo: 'riallineamento' }),
          voce({ role: 'fixer', num: '#510', startedAt: '2026-10-18T11:00:00.000Z' }),
          voce({ role: 'verifier', num: '#511', startedAt: '2026-10-18T12:00:00.000Z', motivo: '   ' }),
        ] } } } };
      },
      async text() { return ''; },
    };
  };
  try {
    const voci = await Defaults.getWorkerLog('token');
    assert.equal(voci.length, 3);
    const per = Object.fromEntries(voci.map((v) => [v.num, v]));
    assert.equal(per['#509'].motivo, 'riallineamento');
    assert.deepEqual(Object.keys(per['#510']).sort(), ['num', 'role', 'startedAt']);
    assert.equal(Object.hasOwn(per['#511'], 'motivo'), false, 'un motivo vuoto non è un motivo');
  } finally {
    global.fetch = orig;
  }
});
