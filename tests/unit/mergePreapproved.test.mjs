// «Fondi senza chiedermelo» (`mergePreapproved`) non si scrive più (#1148, SPEC-DOMANDE.md §1.5): il lavoro fidato
// si fonde da sé e il sì dell'owner prima del lavoro è «Segna fidato», che scrive il server. Nessuna strada del
// client lo scrive: né la dashboard, né le regole, né lo script dell'owner. Il server lo legge solo per i rami di prima.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
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

test('la dashboard non scrive più il segno, nemmeno se un messaggio vecchio lo porta', async () => {
  await FB.updateStatus('doc-1', { starred: true, mergePreapproved: { by: 'owner@esempio', at: '2026-09-13T08:00:00.000Z' } }, { idToken: 'x' });
  assert.deepEqual(mask(), ['starred', 'updatedAt']);
  assert.equal('mergePreapproved' in fields(), false);
  await FB.updateStatus('doc-1', { starred: true, senderProof: 'admin' }, { idToken: 'x' });
  assert.equal(mask().includes('senderProof'), false, 'la prova del mittente non si dà più da qui («È mio» è sparito)');
});

test('le regole: nessun ramo di scrittura del feedback nomina mergePreapproved, se non per vietarlo', () => {
  const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
  const da = RULES.indexOf('match /feedback/{doc}');
  const a = RULES.indexOf('match /feedback-public/{');
  const blocco = RULES.slice(da, a).replace(/\/\/[^\n]*/g, ' ');
  for (const m of blocco.matchAll(/allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g)) {
    const cond = m[2];
    if (!/mergePreapproved/.test(cond)) continue;
    assert.match(cond, /!request\.resource\.data\.keys\(\)\.hasAny\(\[[^\]]*'mergePreapproved'/, `un ramo ammette il segno: ${cond.slice(0, 120)}`);
  }
});

test('lo script dell’owner non offre più il segno, e il CHI del segno locale viene dal token', async () => {
  const of = await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);
  assert.equal(typeof of.segnaPreapprovazione, 'undefined');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  assert.equal(of.chiScrive(`${b64({ alg: 'RS256' })}.${b64({ email: 'owner@esempio', sub: '1' })}.firma`), 'owner@esempio');
  assert.equal(of.chiScrive('ya29.token-di-accesso-opaco'), 'owner (script)');
  assert.equal(of.chiScrive(''), 'owner (script)');
});
