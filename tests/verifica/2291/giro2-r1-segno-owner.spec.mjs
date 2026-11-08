// #2291 giro 2: la priorità cambiata dall'owner in Gestione deve lasciare sul feedback il segno di chi l'ha scritta,
// come ogni altra scrittura; senza, il segno nomina l'automazione di prima e «chi l'ha cambiata» si legge sbagliato.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
require(join(ROOT, 'src', 'shared', 'feedbackPublicKey.js'));
require(join(ROOT, 'src', 'shared', 'feedbackCrypto.js'));
require(join(ROOT, 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

test('r1 la priorità scelta dall\'owner in Gestione scrive il segno «owner» e le regole lo lasciano passare', async () => {
  let call = null;
  globalThis.fetch = async (url, opts) => { call = { url: String(url), opts }; return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; };
  const prima = Date.now();
  await FB.updateStatus('fb-2291', { priority: 1, priorityManual: true });
  expect(call, 'la scrittura deve partire').toBeTruthy();
  const mask = new URLSearchParams(call.url.split('?')[1] || '').getAll('updateMask.fieldPaths');
  const fields = JSON.parse(call.opts.body || '{}').fields || {};
  expect(mask, 'la scrittura dell\'owner deve portare anche il segno').toContain('prioritaScritta');
  const segno = fields.prioritaScritta && fields.prioritaScritta.mapValue && fields.prioritaScritta.mapValue.fields;
  expect(segno && segno.chi && segno.chi.stringValue).toMatch(/^owner/);
  const at = Number((segno.atMs && (segno.atMs.integerValue ?? segno.atMs.doubleValue)) || 0);
  expect(at).toBeGreaterThanOrEqual(prima);

  // La scrittura dell'owner passa dalla regola di triage: un campo fuori dal suo elenco la fa respingere intera.
  const regole = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
  const triage = regole.slice(regole.indexOf('// Triage admin (pieno)'));
  const elenco = triage.slice(triage.indexOf('.hasOnly(['), triage.indexOf('])', triage.indexOf('.hasOnly([')));
  expect(elenco).toContain('\'prioritaScritta\'');
});
