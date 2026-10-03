// Il feedback di un utente approvato come lavoro locale (#913) si chiude senza consegna di routine: la frase per chi
// l'ha mandato la scrive la sessione, e la presa, la chiusura e l'aiuto di finish glielo dicono. Rete finta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);
const MR = globalThis.SN_MANAGE_REVIEW;

const SEGNO = { by: 'owner@esempio', at: 1790000000000 };
const segnoFs = { mapValue: { fields: { by: { stringValue: SEGNO.by }, at: { integerValue: String(SEGNO.at) } } } };
const campo = (v) => (typeof v === 'string' ? { stringValue: v } : v);
function documento(id, f) {
  const fields = {};
  for (const [k, v] of Object.entries(f)) if (v !== undefined) fields[k] = campo(v);
  return { name: `projects/p/databases/(default)/documents/feedback/${id}`, fields };
}
async function conRete(doc, fn) {
  const patch = [];
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'PATCH') {
      patch.push({ url: String(url), body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }
    const u = new URL(String(url));
    const maschera = u.searchParams.getAll('mask.fieldPaths');
    const fields = maschera.length ? Object.fromEntries(Object.entries(doc.fields).filter(([k]) => maschera.includes(k))) : doc.fields;
    return { ok: true, status: 200, json: async () => ({ name: doc.name, fields }), text: async () => '' };
  };
  try { return await fn(patch); } finally { globalThis.fetch = vero; }
}
const OPTS = { bearer: 'tok-finto' };
const utente = (extra = {}) => documento('u1', { clientId: 'utente-7', status: 'working', statusPublic: 'open', localOnly: segnoFs, localApproval: segnoFs, ...extra });

test('la regola: solo l’utente approvato senza frase', () => {
  assert.equal(MR.fraseAttesa({ clientId: 'utente-7', localApproval: SEGNO }), true);
  assert.equal(MR.fraseAttesa({ clientId: 'local:claude', localApproval: SEGNO }), true, 'un prefisso senza prova vale come un utente');
  assert.equal(MR.fraseAttesa({ clientId: 'utente-7', localApproval: SEGNO, userNote: 'Ora parte' }), false);
  assert.equal(MR.fraseAttesa({ clientId: 'routine:worker', senderProof: 'server', localApproval: SEGNO }), false, 'una routine non legge la bacheca');
  assert.equal(MR.fraseAttesa({ clientId: 'local:claude', senderProof: 'admin', localOnly: SEGNO }), false, 'lavoro di una sessione: nessuno da avvisare');
  assert.equal(MR.fraseAttesa({ clientId: 'utente-7' }), false);
});

test('presa e chiusura della pratica ricordano la frase, e il comando che la scrive', async () => {
  await conRete(utente(), async () => {
    for (const o of [OPTS, { ...OPTS, allaChiusura: true }]) {
      const r = await mod.praticaPerLaSessione('u1', o);
      assert.equal(r.ok, true);
      assert.match(r.avviso, /frase/);
      assert.match(r.avviso, /npm run feedback -- u1 --frase/);
    }
    // finish e server:fondi passano «#950»: incollato, il cancelletto aprirebbe un commento della shell.
    assert.match(await mod.fraseDaScrivere('u1', '#950', OPTS), /npm run feedback -- 950 --frase/);
  });
  await conRete(utente({ userNote: 'Ora il terminale parte' }), async () => {
    assert.equal((await mod.praticaPerLaSessione('u1', OPTS)).avviso, '');
    assert.equal(await mod.fraseDaScrivere('u1', 'u1', OPTS), '');
  });
});

test('--frase da sola scrive solo la frase, e dice di no a vuota, troppo lunga o dai Ricevuti', async () => {
  await conRete(utente(), async (patch) => {
    assert.deepEqual(await mod.scriviFrase('u1', '  Ora il terminale parte  ', OPTS), { ok: true });
    assert.equal(patch.length, 1);
    assert.match(patch[0].url, /updateMask\.fieldPaths=userNote$/);
    assert.deepEqual(patch[0].body.fields, { userNote: { stringValue: 'Ora il terminale parte' } });
    const lunga = await mod.scriviFrase('u1', 'a'.repeat(501), OPTS);
    assert.equal(lunga.ok, false);
    assert.match(lunga.motivo, /501/);
    assert.equal((await mod.scriviFrase('u1', '   ', OPTS)).ok, false);
    assert.equal(patch.length, 1, 'i rifiuti non scrivono');
  });
  await conRete(documento('d1', { clientId: 'utente-7', status: 'design', statusPublic: 'open' }), async (patch) => {
    assert.equal((await mod.scriviFrase('d1', 'x', OPTS)).ok, false);
    assert.equal(patch.length, 0);
  });
});

test('l’aiuto di npm run finish dice dove si scrive la frase', () => {
  const aiuto = execFileSync(process.execPath, [join(ROOT, 'scripts', 'finish-local.mjs'), '--help'], { encoding: 'utf8', timeout: 60000 });
  assert.match(aiuto, /npm run feedback -- <N> --frase/);
});
