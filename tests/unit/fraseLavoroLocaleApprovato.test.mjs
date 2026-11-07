// Il feedback di un utente approvato come lavoro locale (#913) si chiude senza consegna di routine: la frase per chi
// l'ha mandato la scrive la sessione, e la presa, la chiusura e l'aiuto di finish glielo dicono. Rete finta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';
import { PULITO, reteFinta } from '../helpers/bigliettoFinto.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);
const MR = globalThis.SN_MANAGE_REVIEW;
// Una sessione col biglietto pulito: la nota su un fidato da una sessione sporca ha le sue prove in notaTogliFiducia.test.mjs.
mod.sessione.biglietto = async () => PULITO;

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
const utente = (extra = {}) => documento('u1', { clientId: 'utente-7', status: 'working', statusPublic: 'open', localOnly: segnoFs, localApproval: segnoFs, fiducia: 'fidato', ...extra });

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
  const rete = reteFinta(cartellaTemporanea('frase-913-'), { doc: utente() });
  const lancia = (...extra) => spawnSync(process.execPath, [...rete.importa, join(ROOT, 'scripts', 'owner-feedback.mjs'), 'u1', 'done', 'finito', '--come-routine', ...extra], {
    encoding: 'utf8', timeout: TETTO_ATTESA_MS, env: rete.env,
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

// La frase di un pacchetto scritta dopo la chiusura: le unite chiuse da lui avevano preso quella di ripiego.
test('la frase scritta su un pacchetto raggiunge le unite che ha chiuso, e il promemoria vale anche per lui', async () => {
  const unisce = { arrayValue: { values: ['u812', 'u815', 'u816'].map((id, i) => ({ mapValue: { fields: { id: { stringValue: id }, num: { stringValue: String([812, 815, 816][i]) } } } })) } };
  const docs = {
    P: documento('P', { clientId: 'local:claude', senderProof: 'admin', status: 'done', statusPublic: 'closed', unisce }),
    u812: documento('u812', { status: 'done', statusReason: 'pacchetto', userNote: 'Risolto insieme ad altre segnalazioni.' }),
    u815: documento('u815', { status: 'archived', statusReason: '' }),
    u816: documento('u816', { status: 'todo' }),
  };
  const patch = [];
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const id = decodeURIComponent(u.pathname.split('/').pop());
    if ((opts.method || 'GET') === 'PATCH') {
      patch.push({ id, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }
    const doc = docs[id];
    if (!doc) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    const maschera = u.searchParams.getAll('mask.fieldPaths');
    const fields = maschera.length ? Object.fromEntries(Object.entries(doc.fields).filter(([k]) => maschera.includes(k))) : doc.fields;
    return { ok: true, status: 200, json: async () => ({ name: doc.name, fields }), text: async () => '' };
  };
  try {
    const promemoria = await mod.fraseDaScrivere('P', '#900', OPTS);
    assert.match(promemoria, /È un pacchetto senza frase/);
    assert.match(promemoria, /npm run feedback -- 900 --frase/);
    const r = await mod.scriviFrase('P', 'Il menu adesso si apre anche sulle immagini.', OPTS);
    assert.equal(r.ok, true);
    assert.deepEqual(r.unite, { aggiornate: ['812'], fallite: [] }, 'solo l\'unita chiusa dal pacchetto; quella archiviata e quella in coda no');
    assert.deepEqual(patch.map((p) => [p.id, p.body.fields.userNote.stringValue]), [
      ['P', 'Il menu adesso si apre anche sulle immagini.'],
      ['u812', 'Il menu adesso si apre anche sulle immagini.'],
    ]);
    assert.deepEqual(mod.righeFraseUnite(r.unite, 'x'), ['La stessa frase sulle unite già chiuse dal pacchetto: #812.']);
    assert.match(mod.righeFraseUnite({ aggiornate: [], fallite: [{ num: '815', motivo: 'giù' }] }, 'Ora va')[0], /FRASE NON SCRITTA su #815.*npm run feedback -- 815 --frase "Ora va"/);
  } finally { globalThis.fetch = vero; }
  assert.equal(mod.avvisoFrase({ clientId: 'local:claude', senderProof: 'admin', unite: 2, userNote: 'scritta' }, '#900'), '', 'con la frase niente promemoria');
});

// La frase di un pacchetto arriva alle unite a ogni livello, per ogni strada che la scrive (SN_FB_ATTESE.uniteDellaFrase).
const listaFs = (l) => ({ arrayValue: { values: l.map(([id, num]) => ({ mapValue: { fields: { id: { stringValue: id }, num: { stringValue: num } } } })) } });
async function conDocs(docs, fn) {
  const patch = [];
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const id = decodeURIComponent(u.pathname.split('/').pop());
    if ((opts.method || 'GET') === 'PATCH') {
      patch.push(id);
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }
    const doc = docs[id];
    if (!doc) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    const m = u.searchParams.getAll('mask.fieldPaths');
    const fields = m.length ? Object.fromEntries(Object.entries(doc.fields).filter(([k]) => m.includes(k))) : doc.fields;
    return { ok: true, status: 200, json: async () => ({ name: doc.name, fields }), text: async () => '' };
  };
  try { return await fn(patch); } finally { globalThis.fetch = vero; }
}
const pacchettiAnnidati = () => ({
  P: documento('P', { clientId: 'local:claude', senderProof: 'admin', status: 'done', statusPublic: 'closed', resolvedInVersion: '1.2.3',
    unisce: listaFs([['Q', '901'], ['V', '903'], ['W', '904']]) }),
  // Q è un pacchetto dentro P; la sua unita U aspetta P, perché aprire P ha spostato su P le attese verso Q.
  Q: documento('Q', { status: 'done', statusReason: 'pacchetto', resolvedInVersion: '1.2.3', waitsFor: listaFs([['P', '900']]), unisce: listaFs([['U', '902'], ['Z', '905']]) }),
  U: documento('U', { status: 'done', statusReason: 'pacchetto', resolvedInVersion: '1.2.3', waitsFor: listaFs([['P', '900']]) }),
  Z: documento('Z', { status: 'done', statusReason: 'pacchetto', waitsFor: listaFs([['X', '700']]) }),
  V: documento('V', { status: 'done', statusReason: 'pacchetto', resolvedInVersion: '1.2.0' }),
  W: documento('W', { status: 'done', statusReason: 'pacchetto' }),
});

test('la frase scritta dopo su un pacchetto scende nei pacchetti dentro, e salta le unite chiuse da un altro', async () => {
  await conDocs(pacchettiAnnidati(), async (patch) => {
    const r = await mod.scriviFrase('P', 'Ora il menu si apre.', OPTS);
    assert.equal(r.ok, true);
    assert.deepEqual(r.unite, { aggiornate: ['901', '904', '902'], fallite: [] },
      '#905 aspetta un altro pacchetto e #903 ha la versione di un\'altra chiusura: le ha chiuse qualcun altro');
    assert.deepEqual(patch, ['P', 'Q', 'W', 'U']);
  });
});

test('la frase scritta su un pacchetto insieme a un cambio di stato arriva anche alle unite, a ogni livello', async () => {
  await conDocs(pacchettiAnnidati(), async (patch) => {
    const r = await mod.scrivi('P', 'archived', '', { frase: 'Ora il menu si apre.', bearer: 'tok-finto' });
    assert.equal(r.ok, true, r.motivo);
    assert.deepEqual(r.unite.aggiornate.slice().sort(), ['901', '902', '904']);
    assert.deepEqual(patch.slice().sort(), ['P', 'Q', 'U', 'W']);
  });
});
