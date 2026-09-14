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
const auth = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'firestore-auth.mjs')).href);
const publicOf = globalThis.SN_FEEDBACK && globalThis.SN_FEEDBACK.statusToPublic;

// Il primo caso si ferma PRIMA delle credenziali, quindi gira ovunque. Il
// secondo le attraversa: `acquireBearer()` è pensato per una riga di comando e
// senza credenziali chiude il processo (`process.exit(1)`), che in un unit test
// non è un'eccezione da catturare — è il file intero che muore. Sulla macchina
// dell'owner le credenziali ci sono e il caso gira davvero; dove non ci sono
// (il contenitore delle routine, una macchina qualunque) si salta, invece di
// far cadere `npm run test:unit` per un motivo che col codice non c'entra.
const CREDENZIALI = !!(auth.loadServiceAccount() || auth.findAdminRefreshToken());

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

test('--chiedi-prima insieme a uno stato che chiude passa il controllo (si ferma dopo, sulla rete)', { skip: CREDENZIALI ? false : 'servono le credenziali dell\'owner (FILO_SA_KEY / FILO_ADMIN_REFRESH_TOKEN)' }, async () => {
  // Con le credenziali la scrittura arriva alla rete e si ferma lì: qui basta
  // che il rifiuto NON sia quello della pratica chiusa.
  let r;
  try { r = await mod.scrivi('id-qualunque', 'done', 'nota', { preapprova: false }); }
  catch (e) { r = { ok: false, motivo: String(e && e.message) }; }
  assert.equal(r.ok, false);
  assert.doesNotMatch(String(r.motivo), /chiude la pratica/);
});
