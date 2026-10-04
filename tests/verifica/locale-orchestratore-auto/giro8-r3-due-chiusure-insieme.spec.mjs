// Giro 8, rilievo 3: due lavori che arrivano alla chiusura insieme non lanciano due npm run finish nello stesso momento.
import { test, expect } from '@playwright/test';
import { creaMotore, nuovaPratica } from '../../../scripts/lib/orchestratore.mjs';

test('due lavori superano la verifica a pochi secondi l’uno dall’altro: le chiusure vanno una per volta', async () => {
  const pr = (num) => ({ ...nuovaPratica({ num, slug: `lavoro-${num}`, richiesta: 'x' }), fase: 'chiusura' });
  const s = { coda: [21, 22], pratiche: { 21: pr(21), 22: pr(22) } };
  let dentro = 0;
  let massimo = 0;
  const attendi = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const d = {
    store: { leggi: () => JSON.parse(JSON.stringify(s)), salvaPratica: (q) => { s.pratiche[q.num] = JSON.parse(JSON.stringify(q)); } },
    esegui: async (cmd, args, { cwd } = {}) => {
      const a = args.join(' ');
      if (/rev-list --count origin\/main\.\.HEAD/.test(a)) return { code: 0, out: '2', stdout: '2' };
      if (/rev-list --count/.test(a)) return { code: 0, out: '0', stdout: '0' };
      if (/diff --name-only/.test(a)) return { code: 0, out: `scripts/${cwd.split('/').pop()}.mjs`, stdout: '' };
      if (/finish-local/.test(a)) {
        dentro += 1; massimo = Math.max(massimo, dentro);
        await attendi(50);
        dentro -= 1;
        return { code: 0, out: '', stdout: '' };
      }
      return { code: 0, out: '', stdout: '' };
    },
    claude: async () => ({ ok: true, testo: 'fatto', costo: 0 }),
    verifica: () => ({ ok: true, entry: { request: 'x', verdict: 'pass', derived: [] }, dirty: false }),
    pubblica: async () => ({ code: 0, out: '' }),
    // Come la misura vera: il carico si legge in un paio di secondi.
    carico: async () => { await attendi(20); return { cpu: 0, liberaGB: 99 }; },
    dormi: (ms) => attendi(Math.min(ms, 5)),
    log: () => {},
    ora: () => '2026-10-04T00:00:00Z',
    percorsi: { radice: '/r', wt: (x) => `/r/wt/${x}`, serverRadice: '', wtServer: () => '', note: '/note', regole: '' },
    fs: { esiste: () => true, collega: () => {}, scollega: () => {} },
    annota: async () => {},
    richiestaDi: async () => 'x',
  };
  const fine = await creaMotore(d, { pausaMs: 5, tieniWorktree: true }).avvia();
  expect(fine.pratiche[21].fase).toBe('fuso');
  expect(fine.pratiche[22].fase).toBe('fuso');
  expect(massimo).toBe(1);
});
