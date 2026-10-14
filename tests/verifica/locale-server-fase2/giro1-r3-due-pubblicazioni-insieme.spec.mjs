// Verifica #1222, giro 1, rilievo 3: con deploy.yml già su main di filo-security ma senza ancora una sua corsa verde,
// il PC che fonde un lavoro server spinge main (e GitHub parte a pubblicare quella spinta) e subito lancia la sua
// pubblicazione dello stesso commit: due deploy delle stesse funzioni insieme. Atteso: una pubblicazione sola per spinta.
import { test, expect } from '@playwright/test';
import { fusioniServer } from '../../../scripts/lib/fusioni-server.mjs';

function dep({ deployDaActions, app = 2 }) {
  const visti = { pubblica: 0, fineAttesa: [] };
  return {
    visti,
    attese: async () => ({ pratiche: [{ feedbackId: 'p1', seq: 1300, subSeq: 0, branch: 'claude/prova-server', parti: {} }], deployDaActions }),
    esegui: async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'rev-list') return { code: 0, out: String(app) };
      // server-fondi-pratica: il ramo del server è su main di filo-security, spinto dal PC.
      return { code: 0, out: '' };
    },
    pubblica: async () => { visti.pubblica += 1; return { code: 0, out: '' }; },
    puntaServer: async () => 'e'.repeat(40),
    fineAttesa: async (id, o) => { visti.fineAttesa.push([id, o || null]); },
    log: () => {},
    radice: '.',
  };
}

test('r3 deploy.yml su main e nessuna sua corsa ancora verde: la spinta del PC non fa partire anche la pubblicazione dal PC', async () => {
  // Il server ha letto le corse di deploy.yml (il file c'è): nessuna verde ancora, come al primo giro della fase 2.
  const d = dep({ deployDaActions: { verdiDiFila: 0, affidabile: false, ultimoVerde: '', lettoIl: Date.now() } });
  const esito = await fusioniServer(d);
  expect(esito.fuse.length).toBe(1);
  expect(d.visti.pubblica, 'il PC ha lanciato server:pubblica sulla stessa spinta che GitHub sta già pubblicando').toBe(0);
});

test('r3 senza deploy.yml su main (il server non legge corse) il PC pubblica ancora lui', async () => {
  const d = dep({ deployDaActions: null });
  const esito = await fusioniServer(d);
  expect(esito.fuse.length).toBe(1);
  expect(d.visti.pubblica).toBe(1);
});
