// Il segno «fondi senza chiedermelo» sulla pratica (`mergePreapproved`).
//
// Tre cose devono restare vere, e ognuna ha il suo rosso senza il fix:
//   a. la dashboard SCRIVE il segno come mappa { by, at } e lo TOGLIE
//      cancellando il campo (maschera senza valore) — un `null` scritto come
//      valore resterebbe sul documento e le regole lo respingerebbero;
//   b. le regole Firestore ammettono il campo SOLO nel ramo dell'owner, con la
//      forma { by, at } — i rami degli utenti (voti, riaperture) no;
//   c. lo script dell'owner scrive il CHI leggendolo dal token, non a mano.
//
// Le regole si leggono come testo (come tests/unit/firestoreRulesConfigSecrets):
// il rischio non è il motore delle regole, è che qualcuno tolga o allarghi la
// riga.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const require = createRequire(import.meta.url);

require(join(ROOT, 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

let lastCall = null;
beforeEach(() => {
  lastCall = null;
  globalThis.fetch = async (url, opts) => {
    lastCall = { url: String(url), opts };
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  };
});
const mask = () => new URLSearchParams((lastCall.url.split('?')[1] || '')).getAll('updateMask.fieldPaths');
const fields = () => (JSON.parse(lastCall.opts.body || '{}').fields || {});

// ── a. la scrittura ─────────────────────────────────────────────────────────

test('mettere il segno scrive la mappa { by, at } e la nomina nella maschera', async () => {
  await FB.updateStatus('doc-1', { mergePreapproved: { by: 'owner@esempio', at: '2026-09-13T08:00:00.000Z' } }, { idToken: 'x' });
  assert.deepEqual(mask(), ['mergePreapproved']);
  assert.deepEqual(fields().mergePreapproved, {
    mapValue: { fields: { by: { stringValue: 'owner@esempio' }, at: { stringValue: '2026-09-13T08:00:00.000Z' } } },
  });
});

test('togliere il segno CANCELLA il campo: maschera sì, valore no', async () => {
  await FB.updateStatus('doc-1', { mergePreapproved: null }, { idToken: 'x' });
  assert.deepEqual(mask(), ['mergePreapproved']);
  assert.equal('mergePreapproved' in fields(), false, 'un null scritto come valore resterebbe sul documento');
});

test('senza il segno nel messaggio non si tocca niente (retrocompat)', async () => {
  await FB.updateStatus('doc-1', { starred: true }, { idToken: 'x' });
  assert.equal(mask().includes('mergePreapproved'), false);
});

// ── b. le regole ────────────────────────────────────────────────────────────

const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

/** Il blocco `match /feedback/{doc}` intero. */
function bloccoFeedback() {
  const i = RULES.indexOf('match /feedback/{doc}');
  assert.ok(i >= 0, 'il blocco dei feedback deve esistere');
  const j = RULES.indexOf('\n    match /', i + 10);
  return RULES.slice(i, j === -1 ? undefined : j);
}

/** Gli `allow update` del blocco, ognuno col suo testo di condizione. */
function ramiUpdate(testo) {
  const out = [];
  // I commenti via PRIMA: un `;` dentro un commento chiuderebbe il ramo a metà.
  const pulito = testo.replace(/\/\/[^\n]*/g, ' ');
  const re = /allow\s+update\s*:\s*if\s+([\s\S]*?);/g;
  let m;
  while ((m = re.exec(pulito)) !== null) out.push(m[1].replace(/\s+/g, ' ').trim());
  return out;
}

test('le regole: il campo è ammesso SOLO nel ramo admin, e con la forma { by, at }', () => {
  const rami = ramiUpdate(bloccoFeedback());
  assert.ok(rami.length >= 2, 'ci si aspetta almeno il ramo admin e uno utente');
  const conCampo = rami.filter((r) => /mergePreapproved/.test(r));
  assert.equal(conCampo.length, 1, 'un ramo solo deve nominare il campo');
  const admin = conCampo[0];
  assert.match(admin, /isAdmin\(\)/, 'quel ramo deve essere quello dell’owner');
  assert.match(admin, /hasOnly\(\[[^\]]*'mergePreapproved'[^\]]*\]\)/, 'il campo deve stare nella lista hasOnly');
  assert.match(admin, /mergePreapproved is map/);
  assert.match(admin, /mergePreapproved\.keys\(\)\.hasOnly\(\['by', 'at'\]\)/);
  assert.match(admin, /mergePreapproved\.get\('by', ''\)\.size\(\) > 0/, 'un segno senza chi l’ha messo non vale');
  assert.match(admin, /!\('mergePreapproved' in request\.resource\.data\)/, 'toglierlo (campo assente) deve passare');
});

// ── c. lo script dell'owner ─────────────────────────────────────────────────

test('lo script scrive il CHI leggendolo dal token, e non finge un’identità se il token non la porta', async () => {
  const { chiScrive } = await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  assert.equal(chiScrive(`${b64({ alg: 'RS256' })}.${b64({ email: 'owner@esempio', sub: '1' })}.firma`), 'owner@esempio');
  assert.equal(chiScrive('ya29.token-di-accesso-opaco'), 'owner (script)');
  assert.equal(chiScrive(''), 'owner (script)');
});
