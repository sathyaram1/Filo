// #1004 — gli elenchi delle pagine delicate (posta, banche, sanità) si cambiano dall'editor dell'owner: le categorie
// salvate arrivano nella config di tutti, e quelle non toccate seguono il codice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

globalThis.self = globalThis;
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'pagineDelicate.js'));
require(join(ROOT, 'tests', 'fixtures', 'testModels.js'));
const Defaults = require(join(ROOT, 'src', 'main', 'services', 'defaultsStore.js'));
const PD = globalThis.SN_PAGINE_DELICATE;

test('una categoria salvata dall\'owner arriva a tutti, le altre restano quelle del codice', async () => {
  const realFetch = global.fetch;
  const server = { fields: {} };
  let maschera = '';
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('config/models') && opts && opts.method === 'PATCH') {
      maschera = u;
      Object.assign(server.fields, JSON.parse(opts.body).fields);
      return { ok: true, status: 200, async json() { return {}; }, async text() { return ''; } };
    }
    if (u.includes('config/models')) return { ok: true, status: 200, async json() { return server; } };
    return { ok: true, status: 200, async json() { return { fields: {} }; }, async text() { return ''; } };
  };
  try {
    const prima = Defaults.getPublicForAdmin();
    assert.deepEqual(prima.sitiDelicati.banche, PD.PREDEFINITI.banche);
    assert.deepEqual(prima.sitiDelicatiDiSerie.posta, PD.PREDEFINITI.posta);

    const cfg = await Defaults.update({ sitiDelicati: { banche: [' BancaProva.it ', 'intesasanpaolo.com', 'bancaprova.it', 7] } }, 'tok');
    assert.ok(maschera.includes('fieldPaths=sitiDelicati'));
    assert.deepEqual(cfg.sitiDelicati.banche, ['bancaprova.it', 'intesasanpaolo.com']);
    assert.deepEqual(cfg.sitiDelicati.posta, PD.PREDEFINITI.posta, 'la posta non toccata segue il codice');
    const elenco = PD.elenco(Defaults.get().sitiDelicati);
    assert.equal(PD.classifica('https://online.bancaprova.it/conto', { elenco }), 'banche');
    assert.equal(PD.classifica('https://www.unicredit.it/', { elenco }), null);
  } finally {
    global.fetch = realFetch;
  }
});
