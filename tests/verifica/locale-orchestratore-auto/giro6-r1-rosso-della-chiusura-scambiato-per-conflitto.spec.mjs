// Giro 6, rilievo 1: un rosso dei controlli di npm run finish non è un conflitto con main.
import { test, expect } from '@playwright/test';
import { creaMotore, nuovaPratica } from '../../../scripts/lib/orchestratore.mjs';

// Righe che npm run finish stampa davvero: la nota sul ramo indietro esce prima dei controlli, e gli unit elencano anche le prove verdi.
const NOTA = '▸ Il ramo è indietro di 4 commit rispetto alla linea principale, ma la fusione non va in conflitto: proseguo.';
const CONTROLLI = [
  '▸ Controlli di logica',
  "ok 220 - nel mezzo di un conflitto l'hook si astiene",
  'ok 503 - la sentinella dei collegamenti riconosce ogni forma di node, e non la prosa',
  'not ok 3462 - Linux: senza «capacity» la carica si conta da energia o carica; un fisso non ha batteria',
  '',
  '✗ Controlli di logica rossi: non pubblico. Sistema e rilancia.',
].join('\n');

function finti(rosso) {
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
      if (/finish-local/.test(a)) return { code: 1, out: rosso, stdout: rosso };
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

for (const [caso, rosso] of [
  ['ramo indietro rispetto a main', `${NOTA}\n\n${CONTROLLI}`],
  ['ramo pari, con una prova verde che parla di conflitti', CONTROLLI],
]) {
  test(`finish rosso nei controlli, ${caso}: niente lavoratore di riallineamento, fermo coi controlli rossi`, async () => {
    const d = finti(rosso);
    const fine = (await creaMotore(d, { pausaMs: 0 }).avvia()).pratiche[7];
    expect(d.comandi.filter((c) => c.startsWith('claude '))).toEqual([]);
    // Il rosso è una prova di logica, non la rete né il carico: rilanciare finish non lo cambia.
    expect(d.comandi.filter((c) => /finish-local/.test(c)).length).toBe(1);
    expect(fine.fase).toBe('fermo');
    expect(fine.fermo.motivo).not.toMatch(/conflitto con main/);
  });
}
