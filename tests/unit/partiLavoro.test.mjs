// Un lavoro locale con app e server (#915): la pratica si chiude quando tutte le parti sono su main. Qui le regole
// lato sessione: parte tardiva, parte del server che manca, cosa legge chi lancia finish, forma nelle regole Firestore.
// La metà del server (ownerMerge, localWork) ha la sua prova in filo-security, test/lavori-locali-parti-915.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PARTI, FINESTRA_PARTE_TARDIVA_MS, partiDaCampi, parteTardiva, partiServerInSospeso,
} from '../../scripts/lib/parti-lavoro.mjs';
import { classifyOwnerMerge, messageForOwnerMerge, askServerMerge } from '../../scripts/lib/owner-merge.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORA = Date.parse('2026-10-03T10:00:00Z');
const ORE = 3600 * 1000;

test('le parti fuse dai campi REST: solo app e server, solo numeri positivi', () => {
  const campi = (m) => ({ localMerges: { mapValue: { fields: m } } });
  assert.deepEqual(partiDaCampi(campi({ app: { integerValue: '5' }, server: { integerValue: '0' }, altro: { integerValue: '9' } })), { app: 5 });
  assert.deepEqual(partiDaCampi(campi({ server: { integerValue: '5' }, solo: { stringValue: 'server' } })), { server: 5, solo: 'server' });
  assert.deepEqual(partiDaCampi(campi({ server: { integerValue: '5' }, solo: { stringValue: 'tutto' } })), { server: 5 });
  assert.deepEqual(partiDaCampi(campi({ app: { integerValue: '5' }, ramo: { stringValue: 'claude/x' } })), { app: 5, ramo: 'claude/x' });
  assert.deepEqual(partiDaCampi(campi({ app: { integerValue: '5' }, ramo: { stringValue: 'main' } })), { app: 5 });
  assert.deepEqual(partiDaCampi({}), {});
  assert.deepEqual(partiDaCampi(undefined), {});
  assert.deepEqual([...PARTI], ['app', 'server']);
  assert.equal(FINESTRA_PARTE_TARDIVA_MS, 48 * ORE);
});

test('parte tardiva: solo a pratica chiusa dall’altra parte da meno di 48 ore, locale, una volta per parte, dallo stesso ramo', () => {
  const base = { status: 'done', parti: { app: ORA - ORE, ramo: 'claude/lavoro' }, parte: 'server', ramo: 'claude/lavoro', locale: true, ora: ORA };
  assert.deepEqual(parteTardiva(base), { ok: true, altra: 'app', at: ORA - ORE });
  const no = [
    [{ status: 'working' }, /non è chiusa/],
    [{ parti: { app: ORA - 49 * ORE, ramo: 'claude/lavoro' } }, /più di 48 ore/],
    [{ parti: { app: ORA + ORE, ramo: 'claude/lavoro' } }, /più di 48 ore/],
    [{ parti: { app: ORA - ORE, server: ORA - ORE, ramo: 'claude/lavoro' } }, /già su main/],
    [{ parti: {} }, /non l’ha chiusa/],
    [{ parti: { app: ORA - ORE, solo: 'app', ramo: 'claude/lavoro' } }, /stava tutto lì/],
    // Un altro lavoro che cita la pratica: ramo diverso, nessun ramo registrato, o il lavoro detto tutto in questa parte.
    [{ ramo: 'claude/un-altro-lavoro' }, /l’ha chiusa la fusione di claude\/lavoro.*stesso nome/],
    [{ parti: { app: ORA - ORE } }, /non dice quale ramo/],
    [{ solo: true }, /non è di questo lavoro/],
    [{ locale: false }, /solo in locale/],
    [{ parte: 'altro' }, /sconosciuta/],
  ];
  for (const [cambio, motivo] of no) {
    const r = parteTardiva({ ...base, ...cambio });
    assert.equal(r.ok, false, JSON.stringify(cambio));
    assert.match(r.motivo, motivo);
  }
});

test('la parte del server che manca: il ramo omonimo in filo-security, finché non è su origin/main del server', () => {
  const cartellaServer = join('/x', 'filo-security', 'functions');
  const radice = dirname(cartellaServer);
  const chiamate = [];
  const fai = (esiste, fuso) => (cwd, args) => {
    chiamate.push({ cwd, args });
    if (args[0] === 'rev-parse') return esiste.includes(args[3]) ? 'x' : null;
    return fuso ? '' : null;
  };
  assert.deepEqual(partiServerInSospeso('claude/lavoro', { cartellaServer, git: fai(['refs/remotes/origin/claude/lavoro'], false) }),
    [{ part: 'server', branch: 'claude/lavoro' }]);
  assert.ok(chiamate.every((c) => c.cwd === radice), 'git gira nella radice del server, non in functions');
  assert.deepEqual(partiServerInSospeso('claude/lavoro', { cartellaServer, git: fai(['refs/heads/claude/lavoro'], true) }), [], 'già su main');
  assert.deepEqual(partiServerInSospeso('claude/lavoro', { cartellaServer, git: fai([], false) }), [], 'nessun ramo del server');
  assert.deepEqual(partiServerInSospeso('claude/lavoro', { cartellaServer: '', git: fai(['refs/heads/claude/lavoro'], false) }), []);
  assert.deepEqual(partiServerInSospeso('main', { cartellaServer, git: fai(['refs/heads/main'], false) }), []);
});

test('finish manda al server le parti del server che mancano, solo con la pratica', async () => {
  const src = readFileSync(join(ROOT, 'scripts', 'finish-local.mjs'), 'utf8');
  assert.match(src, /partiServerInSospeso\(branch, \{ cartellaServer: cartellaDelServer\(ROOT\) \}\)/);
  assert.match(src, /askServerMerge\(\{ branch, sha: cur, feedbackId: [^}]*pendingParts \}\)/);

  process.env.FILO_ADMIN_REFRESH_TOKEN = 'refresh-finto';
  const corpi = [];
  const fetchImpl = async (url, opts) => {
    if (String(url).includes('securetoken')) return { ok: true, status: 200, json: async () => ({ id_token: 'id' }), text: async () => '' };
    corpi.push(JSON.parse(opts.body).data);
    return { status: 200, text: async () => JSON.stringify({ result: { ok: true, result: 'merged', sha: 'f' } }) };
  };
  const vero = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const parti = [{ part: 'server', branch: 'claude/x' }];
    await askServerMerge({ branch: 'claude/x', sha: 'a'.repeat(40), feedbackId: 'fid', pendingParts: parti, fetchImpl, url: 'https://esempio/ownerMerge' });
    await askServerMerge({ branch: 'claude/x', sha: 'a'.repeat(40), feedbackId: '', pendingParts: parti, fetchImpl, url: 'https://esempio/ownerMerge' });
    await askServerMerge({ branch: 'claude/x', sha: 'a'.repeat(40), feedbackId: 'fid', pendingParts: [], fetchImpl, url: 'https://esempio/ownerMerge' });
  } finally {
    globalThis.fetch = vero;
    delete process.env.FILO_ADMIN_REFRESH_TOKEN;
  }
  assert.deepEqual(corpi[0].pendingParts, [{ part: 'server', branch: 'claude/x' }]);
  assert.equal(corpi[1].pendingParts, undefined, 'senza pratica non c’è niente da tenere aperto');
  assert.equal(corpi[2].pendingParts, undefined);
});

test('cosa legge chi lancia finish: la parte che manca e come chiuderla, o la pratica già chiusa dall’altra parte', () => {
  const fuso = (local) => classifyOwnerMerge(200, { result: { ok: true, result: 'merged', sha: 'abcdef12', local } });
  const base = { feedbackId: 'fid', eligible: true, num: '#915', skippedL5: false };

  const aperta = messageForOwnerMerge(fuso({ ...base, closed: false, pending: [{ part: 'server', branch: 'claude/x' }], noted: true }), 'claude/x', { feedbackId: 'fid' });
  assert.match(aperta, /La pratica #915 resta aperta: manca la parte del server \(claude\/x\), non ancora su main/);
  assert.match(aperta, /La chiude: npm run server:fondi -- claude\/x --feedback 915/);
  assert.doesNotMatch(aperta, /NON si è chiusa/, 'aperta di proposito non è un guasto');

  const senzaNota = messageForOwnerMerge(fuso({ ...base, closed: false, pending: [{ part: 'server', branch: 'claude/x' }], noted: false }), 'claude/x');
  assert.match(senzaNota, /nota nella pratica NON si è scritta/);

  const tardiva = messageForOwnerMerge(fuso({ ...base, closed: true, late: { part: 'server', at: '2026-10-03T08:00:00.000Z' }, noted: true }), 'claude/x');
  assert.match(tardiva, /l’aveva chiusa la fusione della parte del server dello stesso lavoro \(2026-10-03T08:00:00\.000Z\)/);
  assert.doesNotMatch(tardiva, /Pratica #915 chiusa\./);

  const sola = messageForOwnerMerge(fuso({ ...base, closed: true }), 'claude/x');
  assert.match(sola, /Pratica #915 chiusa\./, 'un lavoro di una parte sola si chiude come prima');
});

test('regole: localMerges lo scrive solo l’admin, nella forma { app?, server?, solo?, ramo? } con interi positivi', () => {
  const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8').replace(/\/\/[^\n]*/g, '');
  const m = /function localMergesValido\(d\) \{([\s\S]*?)\n\s*\}/.exec(rules);
  assert.ok(m, 'funzione localMergesValido non trovata');
  const corpo = m[1].replace(/\s+/g, ' ');
  assert.match(corpo, /!\('localMerges' in d\)/);
  assert.match(corpo, /keys\(\)\.hasOnly\(\['app', 'server', 'solo', 'ramo'\]\)/);
  assert.match(corpo, /d\.localMerges\.ramo is string && d\.localMerges\.ramo\.size\(\) <= 200 && d\.localMerges\.ramo\.matches\('\^claude\//);
  assert.match(corpo, /d\.localMerges\.solo in \['app', 'server'\]/);
  assert.match(corpo, /d\.localMerges\.app is int && d\.localMerges\.app > 0/);
  assert.match(corpo, /d\.localMerges\.server is int && d\.localMerges\.server > 0/);

  const blocco = rules.slice(rules.indexOf('match /feedback/{'), rules.indexOf('match /feedback-public/{'));
  const rami = [...blocco.matchAll(/allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g)].map((x) => x[2].replace(/\s+/g, ' ').trim());
  const conCampo = rami.filter((c) => c.includes('localMerges'));
  assert.equal(conCampo.length, 1, 'un solo ramo nomina localMerges');
  assert.match(conCampo[0], /^isAdmin\(\)/);
  assert.match(conCampo[0], /localMergesValido\(request\.resource\.data\)/);
});
