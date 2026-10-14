// Giro 2, rilievo 2: il pass della verifica vale per il commit del server che la verifica ha provato. Un commit spinto
// sul ramo del server dopo il pass non va su main di filo-security senza una verifica che lo copra. Non apre Filo.

import { test, expect } from '@playwright/test';
import { SERVER, richiediServer, sha, statoPassato, registro, gitHubFinto, depsCancello } from './aiuti-giro2.mjs';

const RAMO = 'claude/verificato-prima';

test('r2 un commit spinto sul ramo del server dopo il pass della verifica non va su main senza una verifica nuova', async () => {
  test.skip(!SERVER, 'il worktree di filo-security accanto a questo non c’è');
  const { cancelloServer } = richiediServer('src/routine/fusioneServer.js');
  const provato = sha('5');
  const dopo = sha('6');
  const github = gitHubFinto({
    server: { main: sha('1'), punta: dopo, diff: 'diff --git a/functions/src/x.js b/functions/src/x.js\n' },
    app: { main: sha('3'), punta: sha('3') },
  });
  // Il verificatore prova `provato` e passa; poi, col suo biglietto ancora vivo, spinge `dopo` e lo registra; il
  // controllo di sicurezza legge la punta, `dopo`, e passa.
  const { deps } = depsCancello({
    github,
    stato: statoPassato({ app: sha('3'), server: provato, sicurezzaServer: dopo, ramo: RAMO }),
    reg: registro([['lavoratore', provato, 5_000], ['verificatore', dopo, 7_000]]),
  });
  const doc = { _id: 'fb-r2', localOnly: { by: 'owner', at: 1 }, fiducia: 'fidato', branch: RAMO, status: 'revision_security' };
  await cancelloServer({ feedbackId: 'fb-r2', doc, ramo: RAMO, deps });
  const fusioni = github.chiamate.filter((c) => c[0] === 'avanzaMain' && c[3] === 'server');
  expect(fusioni, 'main di filo-security avanza su un commit che nessuna verifica ha provato').toEqual([]);
});
