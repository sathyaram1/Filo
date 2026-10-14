// Giro 4, rilievo 1: un allarme della pubblicazione del server chiuso dall'owner (dopo aver pubblicato dal PC, come gli
// dicono l'avviso del PC e il testo dell'allarme) non deve tornare al giro dopo per la stessa corsa o lo stesso main.
// Il giro del server è il codice vero; GitHub e il database sono finti. Non apre Filo.

import { test, expect } from '@playwright/test';
import { SERVER, richiediServer, sha } from './aiuti-giro2.mjs';

const ORA = Date.UTC(2026, 9, 14, 12);
const ORE = 3600e3;

/** Main del server su M; l'ultima corsa di deploy.yml è rossa su M, quella prima verde su un commit vecchio. */
function mondo() {
  const M = sha('a');
  const V = sha('b');
  let stato = null;
  let aperti = [];
  const creati = [];
  const runs = (wf) => (String(wf).includes('deploy')
    ? [{ id: 2, status: 'completed', conclusion: 'failure', headSha: M, url: 'https://github.com/x/2', createdAt: '2026-10-14T12:00:00Z' },
      { id: 1, status: 'completed', conclusion: 'success', headSha: V, url: 'https://github.com/x/1', createdAt: '2026-10-13T12:00:00Z' }]
    : [{ id: 3, status: 'completed', conclusion: 'success', headSha: sha('c'), url: 'https://github.com/x/3', createdAt: '2026-10-14T11:17:00Z' }]);
  const deps = (nowMs) => ({
    nowMs,
    github: {
      workflowRuns: async (wf) => ({ ok: true, runs: runs(wf) }),
      branchHead: async () => ({ ok: true, sha: M }),
      confronta: async () => ({ ok: true, status: 'behind' }),
    },
    listaAttesa: async () => [],
    readFeedbackDoc: async () => null,
    readState: async () => ({}),
    scriviFeedback: async () => {},
    leggiStato: async () => stato,
    scriviStato: async (s) => { stato = { ...stato, ...s }; },
    fondiDalServer: async () => ({}),
    listOpen: async () => aperti,
    createFeedback: async (f) => {
      const num = `#${900 + creati.length}`;
      creati.push({ num, name: f.name, keys: f.alarmKeys });
      aperti.push({ id: num, num, seq: 900 + creati.length, subSeq: 0, status: 'unlabeled', alarmKeys: f.alarmKeys });
      return { ok: true, num };
    },
  });
  return { deps, creati, chiudiTutto: () => { aperti = []; } };
}

test.describe('r1 allarmi della pubblicazione del server', () => {
  test.skip(!SERVER, 'il worktree di filo-security accanto a questo non c’è');

  test('r1 chiusi dopo la pubblicazione dal PC, non tornano per la stessa corsa rossa e lo stesso main', async () => {
    const { runServerPubblica } = richiediServer('src/routine/serverPubblica.js');
    const m = mondo();
    await runServerPubblica(m.deps(ORA));
    await runServerPubblica(m.deps(ORA + 3 * ORE));
    const nomi = m.creati.map((c) => c.name);
    expect(nomi, 'la corsa rossa e il main fermo aprono i due allarmi').toEqual([
      'Pubblicazione del server rossa su GitHub', 'Server su main ma non pubblicato',
    ]);

    // L'owner pubblica dal PC (npm run server:pubblica, come dicono l'avviso del PC e l'allarme) e chiude i due allarmi.
    m.chiudiTutto();
    await runServerPubblica(m.deps(ORA + 3 * ORE + 10 * 60e3));
    await runServerPubblica(m.deps(ORA + 3 * ORE + 20 * 60e3));
    expect(m.creati.map((c) => `${c.num} ${c.name}`), 'dopo la chiusura nessun allarme nuovo per la stessa corsa e lo stesso main')
      .toHaveLength(2);
  });
});
