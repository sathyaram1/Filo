// Giro 7, rilievo 1: un rilievo messo da parte in un giro diventa un feedback una volta sola, anche se i giri dopo ne mettono da parte altri.
import { test, expect } from '@playwright/test';
import { creaMotore, nuovaPratica } from '../../../scripts/lib/orchestratore.mjs';
import { withRequest, withCritique, withFixed } from '../../../scripts/verify-local.mjs';

const RAMO = 'claude/lavoro-7';
const CAPS = { cap3: 5, cap2: 0, cap1: 3, cap0: 1 };
const CRITICHE = [
  'Provato il giro normale con dati finti: quasi tutto funziona.\n[2i] Il riepilogo ALFA non si aggiorna dopo la ripresa.\n[1i] Il pulsante GAMMA non ha il suo suggerimento.',
  'Provato di nuovo il giro normale: quasi tutto funziona.\n[2i] La coda BETA perde l’ordine dopo un riavvio.\n[1i] La riga EPSILON è tagliata a destra.',
  'Provato tutto il giro normale con dati finti: funziona.',
];

function finti() {
  const p = { ...nuovaPratica({ num: 7, slug: 'lavoro-7', richiesta: 'x' }), fase: 'verifica' };
  const s = { coda: [7], pratiche: { 7: p } };
  let stato = withRequest({}, RAMO, { request: 'x', sha: 'a' });
  let giro = 0;
  const aperti = [];
  return {
    aperti,
    store: { leggi: () => JSON.parse(JSON.stringify(s)), salvaPratica: (q) => { s.pratiche[q.num] = JSON.parse(JSON.stringify(q)); } },
    esegui: async (cmd, args, opts = {}) => {
      const a = args.join(' ');
      if (/rev-list --count origin\/main\.\.HEAD/.test(a)) return { code: 0, out: '2', stdout: '2' };
      if (/rev-list --count/.test(a)) return { code: 0, out: '0', stdout: '0' };
      if (/claude-feedback/.test(a)) { aperti.push(String(opts.input || '')); return { code: 0, out: `Aperto #${900 + aperti.length}`, stdout: '' }; }
      if (/verify-local\.mjs start/.test(a)) return { code: 0, out: 'compito', stdout: 'compito' };
      return { code: 0, out: '', stdout: '' };
    },
    claude: async ({ ruolo }) => {
      if (ruolo === 'verificatore') {
        const r = withCritique(stato, RAMO, { critique: CRITICHE[giro], sha: `s${giro}`, at: `t${giro}`, caps: CAPS });
        stato = r.state;
        // Come risponde il server: la correzione la fa lo stesso verificatore, poi consegna.
        if (r.outcome === 'fix') stato = withFixed(stato, RAMO, { report: 'corretto', sha: `f${giro}`, at: `u${giro}` }).state;
        giro += 1;
      }
      return { ok: true, testo: 'fatto', costo: 1 };
    },
    verifica: () => ({ ok: (stato[RAMO] || {}).verdict === 'pass', entry: stato[RAMO], dirty: false }),
    pubblica: async () => ({ code: 0, out: '' }),
    carico: async () => ({ cpu: 0, liberaGB: 99 }),
    dormi: () => new Promise((ok) => setImmediate(ok)),
    log: () => {},
    ora: () => '2026-10-04T00:00:00Z',
    percorsi: { radice: '/r', wt: (x) => `/r/wt/${x}`, serverRadice: '', wtServer: () => '', note: '/note', regole: '' },
    fs: { esiste: () => true, collega: () => {}, scollega: () => {} },
    annota: async () => {},
    richiestaDi: async () => 'x',
  };
}

test('due giri mettono da parte un rilievo ciascuno: ogni rilievo finisce in un feedback solo', async () => {
  const d = finti();
  const fine = (await creaMotore(d, { pausaMs: 0 }).avvia()).pratiche[7];
  console.log(JSON.stringify(fine.fermo), d.aperti.map((t) => t.slice(0, 300)));
  expect(fine.fase).toBe('fuso');
  expect(d.aperti.filter((t) => t.includes('BETA')).length).toBe(1);
  expect(d.aperti.filter((t) => t.includes('ALFA')).length).toBe(1);
});
