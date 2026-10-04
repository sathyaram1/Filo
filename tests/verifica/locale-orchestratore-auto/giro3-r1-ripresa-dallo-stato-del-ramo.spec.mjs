// Giro 3, rilievo 1: ripresa e rilanci guardano il verdetto già registrato sul ramo, non solo cosa stava girando.
import { test, expect } from '@playwright/test';
import { creaMotore, nuovaPratica, riprendi } from '../../../scripts/lib/orchestratore.mjs';

function finti(pratica, { verdetto, claude = [] }) {
  const s = { coda: [pratica.num], pratiche: { [pratica.num]: JSON.parse(JSON.stringify(pratica)) } };
  const stato = { v: verdetto };
  const chiamate = [];
  const ruoli = [];
  return {
    chiamate,
    ruoli,
    stato,
    store: { leggi: () => JSON.parse(JSON.stringify(s)), salvaPratica: (p) => { s.pratiche[p.num] = JSON.parse(JSON.stringify(p)); } },
    esegui: async (cmd, args) => {
      const a = args.join(' ');
      chiamate.push(`${cmd} ${a}`);
      if (/verify-local\.mjs start/.test(a)) { stato.v = { ok: false, entry: { request: 'x' } }; return { code: 0, out: 'compito', stdout: 'compito' }; }
      if (/rev-list --count origin\/main\.\.HEAD/.test(a)) return { code: 0, out: '2', stdout: '2' };
      if (/rev-list --count/.test(a)) return { code: 0, out: '0', stdout: '0' };
      if (/diff --name-only/.test(a)) return { code: 0, out: 'scripts/x.mjs', stdout: 'scripts/x.mjs' };
      return { code: 0, out: '', stdout: '' };
    },
    claude: async ({ ruolo }) => {
      ruoli.push(ruolo);
      const r = claude.length ? claude.shift() : { ok: true, testo: 'fatto', costo: 1 };
      if (typeof r === 'function') return r(stato);
      return r;
    },
    verifica: () => stato.v,
    pubblica: async () => ({ code: 0, out: '' }),
    carico: async () => ({ cpu: 0, liberaGB: 99 }),
    dormi: () => new Promise((ok) => setImmediate(ok)),
    log: () => {},
    ora: () => '2026-10-04T00:00:00Z',
    percorsi: { radice: '/r', wt: (x) => `/r/wt/${x}`, serverRadice: '', wtServer: () => '', note: '/cartella-note', regole: 'REGOLE' },
    fs: { esiste: () => true, collega: () => {}, scollega: () => {} },
    annota: async () => {},
    richiestaDi: async () => 'richiesta',
  };
}

const superata = { ok: true, entry: { request: 'x', verdict: 'pass', derived: [] } };

test('superata con file lasciati in giro: l’owner li toglie e riprende, si chiude senza rifare la verifica', async () => {
  const p = { ...nuovaPratica({ num: 7, richiesta: 'x' }), giri: 1, giriTotali: 1, fase: 'fermo',
    fermo: { motivo: 'modifiche non salvate nel worktree dopo il verdetto', dove: 'verifica' } };
  const d = finti(riprendi(p, ''), { verdetto: superata });
  const fine = (await creaMotore(d, { pausaMs: 0 }).avvia()).pratiche[7];
  expect(d.chiamate.some((c) => /verify-local\.mjs start/.test(c))).toBe(false);
  expect(d.ruoli).not.toContain('verificatore');
  expect(fine.fase).toBe('fuso');
});

test('orchestratore riavviato dopo che il verificatore ha registrato il superato: si chiude, la verifica non riparte', async () => {
  const p = { ...nuovaPratica({ num: 7, richiesta: 'x' }), giri: 1, giriTotali: 1, fase: 'verifica' };
  const d = finti(p, { verdetto: superata });
  const fine = (await creaMotore(d, { pausaMs: 0 }).avvia()).pratiche[7];
  expect(d.chiamate.some((c) => /verify-local\.mjs start/.test(c))).toBe(false);
  expect(fine.fase).toBe('fuso');
});

test('verificatore che cade sul limite d’uso dopo aver registrato la critica: non si rilancia un verificatore sullo stesso giro', async () => {
  const p = { ...nuovaPratica({ num: 7, richiesta: 'x' }), giri: 0, giriTotali: 0, fase: 'verifica' };
  const registraEcade = (st) => {
    st.v = { ok: false, entry: { request: 'x', verdict: 'fix-pending', pending: { findings: [{ level: 2, sede: 'i', text: 'il pulsante Salva non salva' }] } } };
    return { ok: false, testo: '', costo: 3, errore: 'Claude AI usage limit reached|1759550000' };
  };
  const d = finti(p, { verdetto: {}, claude: [registraEcade] });
  await creaMotore(d, { pausaMs: 0, tetto: 1 }).avvia();
  expect(d.ruoli.filter((r) => r === 'verificatore')).toHaveLength(1);
});
