// Giro 5, rilievo 1: un lavoro fermo nei primi passi (prima del worktree, o al primo avvio della verifica) riprende dal passo che manca davvero.
import { test, expect } from '@playwright/test';
import { creaMotore, nuovaPratica, riprendi } from '../../../scripts/lib/orchestratore.mjs';

function finti({ richieste = ['x'], start = [] } = {}) {
  let s = { coda: [7], pratiche: { 7: nuovaPratica({ num: 7, slug: 'lavoro-7' }) } };
  const esistono = new Set();
  const comandi = [];
  let v = {};
  const dep = {
    comandi,
    imposta: (p) => { s = { coda: [7], pratiche: { 7: JSON.parse(JSON.stringify(p)) } }; },
    store: { leggi: () => JSON.parse(JSON.stringify(s)), salvaPratica: (p) => { s.pratiche[p.num] = JSON.parse(JSON.stringify(p)); } },
    esegui: async (cmd, args, { cwd } = {}) => {
      const a = args.join(' ');
      comandi.push(`${cmd} ${a}`);
      if (cwd && cwd.startsWith('/r/wt/') && !esistono.has(cwd)) return { code: 1, out: `spawn ENOENT (manca ${cwd})`, stdout: '' };
      if (/worktree add/.test(a)) { esistono.add('/r/wt/lavoro-7'); return { code: 0, out: '', stdout: '' }; }
      if (/rev-parse --verify/.test(a)) return { code: 1, out: '', stdout: '' };
      if (/rev-list --count origin\/main\.\.HEAD/.test(a)) return { code: 0, out: '2', stdout: '2' };
      if (/rev-list --count/.test(a)) return { code: 0, out: '0', stdout: '0' };
      if (/verify-local\.mjs start/.test(a)) {
        const c = start.length ? start.shift() : 0;
        if (c) return { code: c, out: 'Auth: token scaduto, rifai il login', stdout: '' };
        v = { ok: false, entry: { request: 'x' } };
        return { code: 0, out: 'compito', stdout: 'compito' };
      }
      return { code: 0, out: '', stdout: '' };
    },
    claude: async ({ ruolo, cwd }) => {
      comandi.push(`claude ${ruolo} in ${cwd}${esistono.has(cwd) ? '' : ' (worktree assente)'}`);
      if (!esistono.has(cwd)) return { ok: false, testo: '', costo: 0, errore: 'spawn ENOENT' };
      if (ruolo === 'verificatore') v = { ok: true, entry: { request: 'x', verdict: 'pass', derived: [] } };
      return { ok: true, testo: 'fatto', costo: 1 };
    },
    verifica: (wt) => (esistono.has(wt) ? v : {}),
    pubblica: async () => ({ code: 0, out: '' }),
    carico: async () => ({ cpu: 0, liberaGB: 99 }),
    dormi: () => new Promise((ok) => setImmediate(ok)),
    log: () => {},
    ora: () => '2026-10-04T00:00:00Z',
    percorsi: { radice: '/r', wt: (x) => `/r/wt/${x}`, serverRadice: '', wtServer: () => '', note: '/cartella-note', regole: 'REGOLE' },
    fs: { esiste: (p) => esistono.has(p) || p.endsWith('/node_modules'), collega: () => {}, scollega: () => {} },
    annota: async () => {},
    richiestaDi: async () => (richieste.length ? richieste.shift() : 'x'),
  };
  return dep;
}

test('richiesta non letta al primo passo: l’owner riprende e il lavoro crea il worktree e parte', async () => {
  const d = finti({ richieste: ['', 'x'] });
  const fermo = (await creaMotore(d, { pausaMs: 0 }).avvia()).pratiche[7];
  expect(fermo.fase).toBe('fermo');
  d.imposta(riprendi(fermo, ''));
  const fine = (await creaMotore(d, { pausaMs: 0, tetto: 1 }).avvia()).pratiche[7];
  expect(d.comandi.some((c) => /worktree add/.test(c))).toBe(true);
  expect(d.comandi.filter((c) => /worktree assente/.test(c))).toEqual([]);
  expect(String(fine.fermo && fine.fermo.motivo)).not.toMatch(/lavoratore non ha finito/);
});

test('primo avvio della verifica rifiutato (accesso scaduto): l’owner rifà l’accesso e riprende, parte la verifica e non un altro lavoratore', async () => {
  const d = finti({ start: [1] });
  const fermo = (await creaMotore(d, { pausaMs: 0, ritenta: 0 }).avvia()).pratiche[7];
  expect(fermo.fase).toBe('fermo');
  expect(fermo.fermo.motivo).toMatch(/verify-local start/);
  const prima = d.comandi.filter((c) => c.startsWith('claude ')).length;
  d.imposta(riprendi(fermo, ''));
  await creaMotore(d, { pausaMs: 0, tetto: 1 }).avvia();
  const dopo = d.comandi.filter((c) => c.startsWith('claude ')).slice(prima);
  expect(dopo[0]).toMatch(/^claude verificatore/);
});
