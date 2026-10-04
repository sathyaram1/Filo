// Giro 6, rilievo 1: un rosso dei controlli di npm run finish su un ramo indietro rispetto a main non è un conflitto.
import { test, expect } from '@playwright/test';
import { creaMotore, nuovaPratica } from '../../../scripts/lib/orchestratore.mjs';

// Le righe che npm run finish stampa davvero: la nota sul ramo indietro esce prima dei controlli.
const NOTA = '▸ Il ramo è indietro di 4 commit rispetto alla linea principale, ma la fusione non va in conflitto: proseguo.';
const ROSSO = `${NOTA}\n\n▸ Controlli di logica\nnot ok 12 - una prova di logica\n\n✗ Controlli di logica rossi: non pubblico. Sistema e rilancia.`;

function finti() {
  const p = { ...nuovaPratica({ num: 7, slug: 'lavoro-7', richiesta: 'x' }), fase: 'chiusura', giri: 1, giriTotali: 1 };
  const s = { coda: [7], pratiche: { 7: p } };
  const comandi = [];
  return {
    comandi,
    store: { leggi: () => JSON.parse(JSON.stringify(s)), salvaPratica: (q) => { s.pratiche[q.num] = JSON.parse(JSON.stringify(q)); } },
    esegui: async (cmd, args) => {
      const a = args.join(' ');
      comandi.push(`${cmd} ${a}`);
      if (/rev-list --count origin\/main\.\.HEAD/.test(a)) return { code: 0, out: '2', stdout: '2' };
      if (/rev-list --count/.test(a)) return { code: 0, out: '0', stdout: '0' };
      if (/diff --name-only/.test(a)) return { code: 0, out: 'scripts/x.mjs', stdout: 'scripts/x.mjs' };
      if (/merge-base/.test(a)) return { code: 1, out: '', stdout: '' };
      if (/finish-local/.test(a)) return { code: 1, out: ROSSO, stdout: ROSSO };
      if (/verify-local\.mjs start/.test(a)) return { code: 0, out: 'compito', stdout: 'compito' };
      return { code: 0, out: '', stdout: '' };
    },
    claude: async ({ ruolo }) => { comandi.push(`claude ${ruolo}`); return { ok: true, testo: 'fatto', costo: 1 }; },
    verifica: () => ({ ok: true, entry: { request: 'x', verdict: 'pass', derived: [] } }),
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

test('finish rosso nei controlli su un ramo indietro: niente lavoratore di riallineamento, fermo coi controlli rossi', async () => {
  const d = finti();
  const fine = (await creaMotore(d, { pausaMs: 0 }).avvia()).pratiche[7];
  expect(d.comandi.filter((c) => c.startsWith('claude '))).toEqual([]);
  expect(fine.fase).toBe('fermo');
  expect(fine.fermo.motivo).not.toMatch(/conflitto con main/);
});
