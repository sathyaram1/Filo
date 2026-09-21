// Prove del giro 4 (verifica locale) sul lavoro «testi dei ruoli delle
// routine»: le due cose cambiate dopo il giro 3.
//
// 1. Il server accompagna OGNI conflitto di fusione con una critica sua: una
//    busta di riallineamento che porta una critica deve essere lavorabile, e
//    il testo consegnato deve dire che si sta facendo un rebase.
// 2. Gli agganci che salvano il lavoro e sorvegliano il ramo servono anche a
//    una macchina che il repo lo clona adesso: qualcosa di registrato in git
//    deve dichiararli, o su quella macchina non partono e nessuno lo vede.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { buildPayload, checkEnvelope, readRoleInstructions } from '../../../scripts/dispatch.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const criticaDelServer = 'FAIL tecnico, non di qualità: la fusione su main è fallita '
  + 'per un CONFLITTO. Va RIALLINEATO il ramo su main e riconsegnato.';

test('un riallineamento con la critica del server parte, e il testo dice che è un rebase', () => {
  const busta = {
    role: 'fixer',
    id: 'abc',
    num: '700',
    branch: 'claude/x',
    payload: { role: 'fixer', feedback: { text: 'non salva' }, critique: criticaDelServer },
  };
  expect(checkEnvelope(busta), 'la busta del riallineamento viene rifiutata').toBeNull();

  const dato = buildPayload(
    { role: 'fixer', id: busta.id, num: busta.num, branch: busta.branch, serverCritique: criticaDelServer },
    { feedback: busta.payload.feedback },
  );
  expect(dato.case).toBe('riallineamento');

  const testo = readRoleInstructions('fixer');
  expect(testo, 'chi riallinea non sa che sta riallineando').toMatch(/stai facendo un rebase/i);
  expect(testo, 'il rebase non dice cosa scriverne nel report').toMatch(/Nel report scrivi.*dove c'erano i conflitti/s);
});

test('gli agganci che salvano il lavoro arrivano anche a chi clona il repo adesso', () => {
  const tracciati = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  const registrano = tracciati.filter((f) => {
    if (!/\.json$/.test(f)) return false;
    let testo = '';
    try { testo = readFileSync(resolve(ROOT, f), 'utf8'); } catch (_) { return false; }
    return /"PostToolUse"/.test(testo) && /auto-commit-merge\.sh/.test(testo);
  });
  expect(registrano, 'nessun file registrato in git aggancia il salvataggio automatico: '
    + 'su una macchina che clona adesso (i contenitori delle routine) gli agganci non partono, '
    + 'e un ramo smette di salvarsi in silenzio').not.toEqual([]);
});
