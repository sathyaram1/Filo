// Verifica locale, giro 1 (ramo claude/rilasci-fermi): due guasti diversi aprono due feedback, e il titolo di
// ciascuno dice quale guasto è, invece dello stesso titolo fisso per tutti. Esegue i passi veri dei workflow in bash.

import { test, expect } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { corsa, creaMain, eseguiBash, oreFa, passi, preparaGh, serverAllarmi, trovaBash } from './aiuti-rilascio.mjs';

const BASH = trovaBash();

const casoRosso = (file, titolo) => ({
  title: file, file, specs: [{ title: titolo, file, tests: [{ status: 'unexpected', results: [{ status: 'failed' }] }] }],
});
const tap = (file, titolo) => [
  'TAP version 13',
  `not ok 1 - ${titolo}`,
  '  ---',
  '  duration_ms: 3.1',
  `  location: 'D:\\\\a\\\\Filo\\\\Filo\\\\tests\\\\unit\\\\${file}:12:3'`,
  "  failureType: 'testCodeFailure'",
  '  ...',
  '1..1',
  '# fail 1',
].join('\n');

test('due guasti in tempi diversi: due feedback, e il titolo di ciascuno nomina il suo', async () => {
  test.skip(!BASH, 'bash non trovato: i passi dei workflow sono scritti in bash');
  const tmp = cartellaTemporanea('rilasci-fermi-');
  const repo = join(tmp, 'main');
  const server = await serverAllarmi();
  try {
    const [, verde] = creaMain(repo, [
      { ore: 30, msg: 'release: v0.2.228 [skip ci]' },
      { ore: 20, msg: 'merge-gate: #1 via server' },
      { ore: 1, msg: 'merge-gate: #2 via server' },
    ], 'v0.2.228');
    const env = {
      ...preparaGh(tmp, repo, { pubblicata: oreFa(30), runs: [corsa(verde, 'success', 19)] }),
      GITHUB_REPOSITORY: 'o/r',
      GH_TOKEN: 'finto',
      FILO_BUILD_PASSPHRASE: 'finta',
      FILO_ROUTINE_API: server.url,
      SUITE_OUTCOME: 'failure',
      ESECUZIONE: 'https://github.com/o/r/actions/runs/1',
    };
    const suite = passi('suite.yml', 'suite');
    const verdetto = suite.find((p) => p.id === 'verdetto').run;
    const allarmeSuite = suite.find((p) => /main/.test(p.name || '') && /build-alarm/.test(p.run || '')).run;
    const allarmeUnit = passi('release.yml', 'release').find((p) => /build-alarm/.test(p.run || '')).run;

    for (const [file, titolo] of [['wallet-credits.spec.mjs', 'riscattato l’invito'], ['board-offline-error.spec.mjs', 'Riprova recupera']]) {
      writeFileSync(join(repo, 'suite-risultati.json'), JSON.stringify({ suites: [casoRosso(file, titolo)], errors: [] }));
      await eseguiBash(BASH, verdetto, repo, env);
      await eseguiBash(BASH, allarmeSuite, repo, env);
    }
    for (const [file, titolo] of [['fineRigaLf.test.mjs', 'fine riga LF'], ['patchNotes.test.mjs', 'il changelog non promette']]) {
      writeFileSync(join(repo, 'unit.log'), tap(file, titolo));
      await eseguiBash(BASH, allarmeUnit, repo, env);
    }

    const nomi = server.aperti.map((a) => a.name);
    expect(nomi.length, `quattro guasti indipendenti, feedback aperti: ${nomi.length}`).toBe(4);
    const [walletCredits, board, fineRiga, patchNotes] = nomi;
    for (const [nome, guasto] of [[walletCredits, 'wallet-credits'], [board, 'board-offline-error'],
      [fineRiga, 'fineRigaLf'], [patchNotes, 'patchNotes']]) {
      expect(nome, `il titolo del feedback non dice quale guasto è (${guasto}); titoli: ${JSON.stringify(nomi)}`).toContain(guasto);
    }
  } finally {
    await server.chiudi();
    rmSync(tmp, { recursive: true, force: true });
  }
});
