// Lo script dell'owner: «--preapprova» insieme a uno stato che CHIUDE la
// pratica viene rifiutato, come nella forma senza stato. Il segno vale solo a
// pratica aperta; scritto su una pratica che si chiude non conta, ma resta
// sul documento e tornerebbe a valere a una riapertura (verifica locale del
// 13/09/2026). Il rifiuto arriva prima di toccare la rete: qui non c'è.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const mod = await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);
const publicOf = globalThis.SN_FEEDBACK && globalThis.SN_FEEDBACK.statusToPublic;

test('--preapprova con uno stato che chiude la pratica: rifiuto, con la spiegazione', async () => {
  assert.equal(typeof publicOf, 'function');
  const chiusi = mod.ALLOWED.filter((s) => publicOf(s) === 'closed');
  assert.ok(chiusi.includes('done'), `stati chiusi: ${chiusi.join(', ')}`);
  for (const to of chiusi) {
    const r = await mod.scrivi('id-qualunque', to, 'nota', { preapprova: true });
    assert.equal(r.ok, false, `${to}: doveva rifiutare`);
    assert.match(r.motivo, /chiude la pratica/);
    assert.match(r.motivo, /chiedermelo/);
  }
});

test('--chiedi-prima insieme a uno stato che chiude passa il controllo (si ferma dopo, sulla rete)', async () => {
  // Senza credenziali la scrittura non può andare avanti: qui basta che il
  // rifiuto NON sia quello della pratica chiusa.
  let r;
  try { r = await mod.scrivi('id-qualunque', 'done', 'nota', { preapprova: false }); }
  catch (e) { r = { ok: false, motivo: String(e && e.message) }; }
  assert.equal(r.ok, false);
  assert.doesNotMatch(String(r.motivo), /chiude la pratica/);
});
