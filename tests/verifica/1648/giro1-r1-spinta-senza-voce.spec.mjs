// Verifica #1648, giro 1, rilievo 1: nella chiusura app più server l'orchestratore spinge il ramo del server prima di
// finish; se la chiusura si ferma prima che finish scriva la voce, la punta spinta resta fuori dal registro.
import { test, expect } from '@playwright/test';
import { creaMotore, nuovaPratica } from '../../../scripts/lib/orchestratore.mjs';

function banco(risposte = []) {
  const p = nuovaPratica({ num: 7, slug: 'sette', richiesta: 'fai X' });
  const stato = { coda: [7], pratiche: { 7: p } };
  const chiamate = [];
  const per = {};
  const punta = {};
  const alberi = new Set();
  const collegamenti = new Set();
  const dep = {
    store: { leggi: () => JSON.parse(JSON.stringify(stato)), salvaPratica: (x) => { stato.pratiche[x.num] = JSON.parse(JSON.stringify(x)); } },
    esegui: async (cmd, args, o = {}) => {
      const riga = `${cmd} ${args.join(' ')}`;
      chiamate.push(riga);
      if (/^git worktree add /.test(riga)) alberi.add(args[2]);
      if (/^git worktree remove /.test(riga)) alberi.delete(args[2]);
      for (const [re, r] of risposte) if (re.test(riga)) return { stdout: r.out || '', ...r, out: r.out || '' };
      if (/verify-local\.mjs start/.test(riga)) {
        per[o.cwd] = { entry: { request: 'fai X', feedbackId: 'fid7' }, ok: false };
        return { code: 0, stdout: 'COMPITO', out: 'COMPITO' };
      }
      if (/rev-list --count origin\/main\.\.HEAD/.test(riga)) return { code: 0, out: '2', stdout: '2' };
      if (/rev-list --count origin\/main\.\.refs/.test(riga)) return { code: 0, out: '1', stdout: '' };
      if (/diff --name-only/.test(riga)) return { code: 0, out: 'scripts/a.mjs', stdout: '' };
      return { code: 0, out: '', stdout: '' };
    },
    claude: async ({ ruolo, cwd }) => {
      chiamate.push(`claude ${ruolo}`);
      if (ruolo === 'lavoratore') punta[cwd] = (punta[cwd] || 0) + 1;
      if (ruolo === 'verificatore') per[cwd] = { entry: { ...(per[cwd].entry || {}), verdict: 'pass', derived: [], sha: punta[cwd] || 0 } };
      return { ok: true, testo: 'fatto', costo: 0 };
    },
    verifica: (wt) => {
      const x = per[wt];
      if (!x) return {};
      return { ...x, ok: !!x.entry && x.entry.verdict === 'pass' && x.entry.sha === (punta[wt] || 0) };
    },
    pubblica: async () => ({ code: 0, out: '' }),
    carico: async () => ({ cpu: 10, liberaGB: 16 }),
    dormi: () => new Promise((ok) => setImmediate(ok)),
    log: () => {},
    ora: () => '2026-10-28T10:00:00Z',
    percorsi: { radice: '/r', serverRadice: '/s', note: '/n', regole: 'REGOLE', wt: (s) => `/r/.claude/worktrees/${s}`, wtServer: (s) => `/s/.claude/worktrees/${s}` },
    fs: {
      esiste: (x) => collegamenti.has(x) || alberi.has(x),
      collega: (v, l) => { collegamenti.add(l); },
      scollega: (l) => { collegamenti.delete(l); },
    },
    annota: async () => {},
    richiestaDi: async () => 'richiesta letta',
  };
  return { motore: creaMotore(dep, { pausaMs: 0, ritenta: 0 }), chiamate };
}

const SPINTA = /^git push origin refs\/heads\/claude\/sette:refs\/heads\/claude\/sette$/;

// Il ramo del server è su GitHub dopo la spinta: qualcuno deve scrivere la sua voce anche se la chiusura si ferma.
for (const [nome, risposte] of [
  ['finish rosso', [[/finish-local/, { code: 1, out: 'unit rossi' }]]],
  ['ramo del server senza main del server', [[/merge-base --is-ancestor refs\/remotes\/origin\/main refs\/heads\/claude\/sette/, { code: 1, out: '' }]]],
]) {
  test(`r1 ${nome}: la punta del server spinta entra nel registro`, async () => {
    const b = banco(risposte);
    await b.motore.avvia();
    const righe = b.chiamate;
    const spinta = righe.findIndex((r) => SPINTA.test(r));
    expect(spinta, righe.join('\n')).toBeGreaterThanOrEqual(0);
    // finish rosso esce prima della voce: conta solo un registra dopo la spinta.
    const registra = righe.findIndex((r, i) => i > spinta && /verify-local\.mjs registra/.test(r));
    expect(registra, `la punta spinta non è mai stata registrata:\n${righe.slice(spinta).join('\n')}`).toBeGreaterThan(spinta);
  });
}
