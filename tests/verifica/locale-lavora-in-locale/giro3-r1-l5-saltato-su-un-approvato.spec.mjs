// Verifica locale, giro 3, rilievo 1: il feedback di un utente approvato come lavoro locale, fuso sopra L5, non
// si racconta come «mittente provato». Dalla risposta vera del server alla riga che l'owner legge a fine lavoro.
// Il server sta nel suo repo: FILO_SECURITY_FUNCTIONS, o il worktree gemello di questo, o la copia principale.

import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const candidati = [
  process.env.FILO_SECURITY_FUNCTIONS,
  resolve('../../../../filo-security/.claude/worktrees/lavora-in-locale/functions'),
  resolve('../filo-security/functions'),
].filter(Boolean);
const FUNCTIONS = candidati.find((p) => existsSync(resolve(p, 'src/routine/ownerMerge.js')));

const SEGNO = { by: 'owner@esempio', at: 1790000000000 };
const diffFor = (file, riga) => [`diff --git a/${file} b/${file}`, 'index 0000000..1111111 100644', `--- a/${file}`, `+++ b/${file}`, '@@ -1,1 +1,2 @@', ' contesto', `+${riga}`].join('\n');

test('approvato come lavoro locale e fuso sopra L5: nota della pratica e riga del finish dicono il sì dell’owner, non la prova', async () => {
  expect(FUNCTIONS, `server non trovato fra: ${candidati.join(' · ')}`).toBeTruthy();
  const { runOwnerMerge } = require(resolve(FUNCTIONS, 'src/routine/ownerMerge.js'));
  const OM = await import(pathToFileURL(resolve('scripts/lib/owner-merge.mjs')).href);
  let nota = '';
  const reply = await runOwnerMerge({
    admin: true, who: 'owner@esempio', branch: 'claude/x', feedbackId: 'fid950',
    github: {
      branchHead: async () => ({ ok: true, sha: 'a'.repeat(40) }),
      compareDiff: async () => ({ ok: true, diff: diffFor('firestore.rules', 'allow read, write: if true;') }),
      mergeSha: async () => ({ ok: true, sha: 'b'.repeat(40) }),
    },
    readFeedback: async () => ({ _id: 'fid950', clientId: 'utente-7', status: 'working', seq: 950, localOnly: SEGNO, localApproval: SEGNO }),
    recordSkipped: async () => 'rec-1',
    closeLocal: async (_id, o) => { nota = o.nota; return true; },
  });
  expect(reply.result).toBe('merged');
  expect(reply.local).toMatchObject({ eligible: true, skippedL5: true });

  expect(nota).not.toMatch(/mittente[^.]*provato/i);
  expect(nota).toMatch(/approvat/i);

  const riga = OM.messageForOwnerMerge(OM.classifyOwnerMerge(200, { result: reply }), 'claude/x', { feedbackNum: '950', feedbackId: 'fid950' });
  expect(riga).toContain('L5 saltato');
  expect(riga).not.toMatch(/mittente provato/i);
  expect(riga).toMatch(/approvat/i);
});
