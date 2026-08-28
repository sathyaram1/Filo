// Unit test del cancello di verifica locale.
//
// PERCHÉ CONTA
//   È l'unica cosa che impedisce a chi ha scritto il codice di pubblicarlo senza
//   che nessun altro l'abbia provato. Se questa logica sbaglia in senso
//   permissivo, il cancello c'è ma non chiude — che è peggio di non averlo,
//   perché dà l'impressione che qualcuno abbia controllato.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const {
  checkVerdict, withRequest, withVerdict, buildVerifierBrief,
  realignPlan, afterRebase,
} = await import('../../scripts/verify-local.mjs');

const SHA = 'a'.repeat(40);
const ALTRO_SHA = 'b'.repeat(40);

test('checkVerdict: senza verifica non si pubblica', () => {
  assert.equal(checkVerdict(undefined, SHA).ok, false);
  assert.equal(checkVerdict(null, SHA).ok, false);
  // Verifica avviata ma mai conclusa: vale come non fatta.
  assert.equal(checkVerdict({ request: 'fai X', requestedSha: SHA }, SHA).ok, false);
});

test('checkVerdict: una bocciatura blocca, e dice perché', () => {
  const r = checkVerdict({ verdict: 'fail', critique: 'il pulsante non salva', sha: SHA }, SHA);
  assert.equal(r.ok, false);
  assert.match(r.reason, /il pulsante non salva/);
});

test('checkVerdict: approvato sullo STESSO contenuto → si pubblica', () => {
  assert.equal(checkVerdict({ verdict: 'pass', sha: SHA }, SHA).ok, true);
});

// Il buco che questo cancello deve chiudere: farsi approvare una versione e
// pubblicarne un'altra. Senza il confronto sul contenuto, questo test passa
// anche col codice cambiato dopo il PASS.
test('checkVerdict: se il codice cambia dopo il PASS, l’esito decade', () => {
  const r = checkVerdict({ verdict: 'pass', sha: SHA }, ALTRO_SHA);
  assert.equal(r.ok, false);
  assert.match(r.reason, /cambiato dopo la verifica/);
  // E un verdetto senza contenuto associato non vale come approvazione.
  assert.equal(checkVerdict({ verdict: 'pass', sha: '' }, SHA).ok, false);
  assert.equal(checkVerdict({ verdict: 'pass', sha: SHA }, '').ok, false);
});

// Il secondo modo di farsi approvare una versione e pubblicarne un'altra: non
// serve nemmeno un commit nuovo, bastano modifiche non ancora salvate — e il
// confronto sul commit non le vede. Capitato davvero, su questo stesso lavoro.
test('checkVerdict: modifiche non salvate invalidano l’approvazione', () => {
  assert.equal(checkVerdict({ verdict: 'pass', sha: SHA }, SHA, false).ok, true);
  const sporco = checkVerdict({ verdict: 'pass', sha: SHA }, SHA, true);
  assert.equal(sporco.ok, false);
  assert.match(sporco.reason, /modifiche non salvate/);
});

test('withRequest / withVerdict: lo stato è per ramo e non si calpesta', () => {
  let s = withRequest({}, 'claude/uno', { request: 'fai X', sha: SHA, at: 't0' });
  s = withRequest(s, 'claude/due', { request: 'fai Y', sha: ALTRO_SHA, at: 't0' });
  s = withVerdict(s, 'claude/uno', { verdict: 'pass', critique: 'ok', sha: SHA, at: 't1' });

  assert.equal(s['claude/uno'].verdict, 'pass');
  assert.equal(s['claude/uno'].request, 'fai X');   // la richiesta non si perde
  assert.equal(s['claude/due'].verdict, undefined); // l'altro ramo resta com'era
  assert.equal(checkVerdict(s['claude/due'], ALTRO_SHA).ok, false);
});

test('withVerdict: qualunque cosa diversa da "pass" è una bocciatura', () => {
  const s = withVerdict({}, 'r', { verdict: 'boh', sha: SHA });
  assert.equal(s.r.verdict, 'fail');
  assert.equal(checkVerdict(s.r, SHA).ok, false);
});

// L'isolamento è il motivo per cui questa verifica vale qualcosa: se al
// verificatore arriva il diff, sta rileggendo il lavoro di un altro invece di
// provare la cosa chiesta.
test('buildVerifierBrief: consegna la richiesta e il ramo, e vieta il diff', () => {
  const brief = buildVerifierBrief({
    request: 'voglio poter rimuovere le immagini allegate',
    branch: 'claude/immagini',
    recipe: 'RECIPE-QUI',
  });
  assert.match(brief, /voglio poter rimuovere le immagini allegate/);
  assert.match(brief, /claude\/immagini/);
  assert.match(brief, /RECIPE-QUI/);
  // Il divieto è esplicito, non implicito.
  assert.match(brief, /niente diff/i);
  assert.match(brief, /niente report/i);
});
