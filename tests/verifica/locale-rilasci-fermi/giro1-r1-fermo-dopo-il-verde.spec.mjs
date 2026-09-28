// Verifica locale, giro 1 (ramo claude/rilasci-fermi): senza versioni nuove da più di 48 ore parte un allarme anche
// quando un commit verde c'è ma la pubblicazione si ferma dopo averlo scelto (cancello unit, numero, costruzione).
// Esegue il passo di scelta di release.yml, dove sta il controllo delle 48 ore; se la rete si sposta, la prova la segue.

import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { corsa, creaMain, eseguiNode, oreFa, passi, preparaGh, serverAllarmi } from './aiuti-rilascio.mjs';

test('ultima versione di 100 ore fa, verde di 68 ore fa mai uscito: parte un allarme', async () => {
  const tmp = cartellaTemporanea('rilasci-fermi-');
  const repo = join(tmp, 'main');
  const server = await serverAllarmi();
  try {
    const [, verde, rosso] = creaMain(repo, [
      { ore: 100, msg: 'release: v0.2.228 [skip ci]' },
      { ore: 70, msg: 'merge-gate: #1 via server' },
      { ore: 2, msg: 'merge-gate: #2 via server' },
    ], 'v0.2.228');
    const env = {
      ...preparaGh(tmp, repo, {
        pubblicata: oreFa(100),
        runs: [corsa(rosso, 'failure', 1), corsa(verde, 'success', 68)],
      }),
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_OUTPUT: join(tmp, 'output.txt'),
      GITHUB_STEP_SUMMARY: join(tmp, 'riassunto.md'),
      GITHUB_RUN_ID: '1',
      GH_TOKEN: 'finto',
      FILO_BUILD_PASSPHRASE: 'finta',
      FILO_ROUTINE_API: server.url,
    };
    // Il guasto a valle è già in coda (come #569): il suo allarme, a ogni giro, è un doppione.
    server.aperti.push({ num: '#569', name: 'Controlli automatici rossi', alarmKeys: ['unit:tests/unit/fineRigaLf.test.mjs'] });

    const righe = passi('release.yml', 'scegli')
      .flatMap((p) => String(p.run || '').split('\n'))
      .filter((r) => /^\s*node\s/.test(r));
    expect(righe.length, 'il job di scelta non esegue più nessuno script').toBeGreaterThan(0);
    const esiti = [];
    for (const r of righe) esiti.push(await eseguiNode(r, repo, env));

    const registro = esiti.map((e) => e.stdout + e.stderr).join('\n');
    expect(server.richieste.length,
      `100 ore senza versioni e un commit verde fermo da 68 ore: nessun allarme è partito.\n${registro}`).toBeGreaterThan(0);
  } finally {
    await server.chiudi();
    rmSync(tmp, { recursive: true, force: true });
  }
});
