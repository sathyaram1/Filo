// Il feedback di un utente approvato come lavoro locale (#913) si chiude senza consegna di routine: la frase per chi
// l'ha mandato la scrive la sessione, e la presa, la chiusura e l'aiuto di finish glielo dicono. Rete finta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';

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
    assert.match(patch[0].url, /updateMask\.fieldPaths=userNote&updateMask\.fieldPaths=updatedAt$/);
    const { updatedAt, ...resto } = patch[0].body.fields;
    assert.ok(updatedAt && updatedAt.timestampValue, 'la scrittura firma l\'ora (#676)');
    assert.deepEqual(resto, { userNote: { stringValue: 'Ora il terminale parte' } });
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

test('un passaggio di stato con una frase oltre i 500 caratteri è rifiutato col numero, mai tagliato', async () => {
  await conRete(utente(), async (patch) => {
    const r = await mod.scrivi('u1', 'done', 'finito', { ...OPTS, attore: 'routine', frase: 'a'.repeat(620) });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /620/);
    assert.equal(patch.length, 0);
    const giusta = await mod.scrivi('u1', 'done', 'finito', { ...OPTS, attore: 'routine', frase: 'a'.repeat(500) });
    assert.equal(giusta.ok, true);
    assert.equal(patch[0].body.fields.userNote.stringValue.length, 500);
  });
});

test('chiusa a mano senza frase, npm run feedback la ricorda; con la frase no', () => {
  const dir = cartellaTemporanea('frase-913-');
  const finto = join(dir, 'rete.mjs');
  writeFileSync(finto, `
const doc = ${JSON.stringify(utente())};
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (!/firestore/.test(u.hostname)) return new Response(JSON.stringify({ id_token: 'finto', expires_in: '3600' }), { status: 200 });
  if ((opts.method || 'GET') !== 'GET') return new Response('{}', { status: 200 });
  const m = u.searchParams.getAll('mask.fieldPaths');
  const fields = m.length ? Object.fromEntries(Object.entries(doc.fields).filter(([k]) => m.includes(k))) : doc.fields;
  return new Response(JSON.stringify({ name: doc.name, fields }), { status: 200 });
};`);
  const lancia = (...extra) => spawnSync(process.execPath, ['--import', pathToFileURL(finto).href, join(ROOT, 'scripts', 'owner-feedback.mjs'), 'u1', 'done', 'finito', '--come-routine', ...extra], {
    encoding: 'utf8', timeout: TETTO_ATTESA_MS, env: { ...process.env, FILO_ADMIN_REFRESH_TOKEN: 'finto', FILO_SA_KEY: '', GOOGLE_APPLICATION_CREDENTIALS: '' },
  });
  const senza = lancia();
  assert.equal(senza.status, 0, senza.stderr);
  assert.match(senza.stdout, /npm run feedback -- u1 --frase/);
  const con = lancia('--frase', 'Ora il terminale parte');
  assert.equal(con.status, 0, con.stderr);
  assert.doesNotMatch(con.stdout, /--frase/);
});

test('l’aiuto di npm run finish dice dove si scrive la frase', () => {
  const aiuto = execFileSync(process.execPath, [join(ROOT, 'scripts', 'finish-local.mjs'), '--help'], { encoding: 'utf8', timeout: TETTO_ATTESA_MS });
  assert.match(aiuto, /npm run feedback -- <N> --frase/);
});
