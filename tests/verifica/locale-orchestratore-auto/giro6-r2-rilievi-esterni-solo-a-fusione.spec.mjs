// Giro 6, rilievo 2: un rilievo esterno registrato dalla verifica diventa un feedback anche se il lavoro si ferma.
import { test, expect } from '@playwright/test';
import { creaMotore, nuovaPratica } from '../../../scripts/lib/orchestratore.mjs';
import { withRequest, withCritique } from '../../../scripts/verify-local.mjs';

const RAMO = 'claude/lavoro-7';
const CRITICA = [
  'Provato tutto il giro normale con dati finti: funziona quasi tutto come chiesto dalla richiesta.',
  '[2i?] Il bordo del riquadro va scelto: grigio o caldo, decide l’owner.',
  '[1e] La pagina delle preferenze taglia le etichette lunghe: c’era già su main.',
].join('\n');

function finti() {
  const p = { ...nuovaPratica({ num: 7, slug: 'lavoro-7', richiesta: 'x' }), fase: 'verifica' };
  const s = { coda: [7], pratiche: { 7: p } };
  let stato = withRequest({}, RAMO, { request: 'x', sha: 'a' });
  const comandi = [];
  return {
    comandi,
    store: { leggi: () => JSON.parse(JSON.stringify(s)), salvaPratica: (q) => { s.pratiche[q.num] = JSON.parse(JSON.stringify(q)); } },
    esegui: async (cmd, args) => {
      const a = args.join(' ');
      comandi.push(`${cmd} ${a}`);
      if (/rev-list --count origin\/main\.\.HEAD/.test(a)) return { code: 0, out: '2', stdout: '2' };
      if (/rev-list --count/.test(a)) return { code: 0, out: '0', stdout: '0' };
      if (/claude-feedback/.test(a)) return { code: 0, out: 'Aperto #999', stdout: 'Aperto #999' };
      if (/verify-local\.mjs start/.test(a)) return { code: 0, out: 'compito', stdout: 'compito' };
      return { code: 0, out: '', stdout: '' };
    },
    claude: async ({ ruolo }) => {
      comandi.push(`claude ${ruolo}`);
      if (ruolo === 'verificatore') {
        stato = withCritique(stato, RAMO, { critique: CRITICA, sha: 'a', at: 't', caps: { cap3: 5, cap2: 4, cap1: 3, cap0: 1 } }).state;
      }
      return { ok: true, testo: 'fatto', costo: 1 };
    },
    verifica: () => ({ ok: false, entry: stato[RAMO], dirty: false }),
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

test('la verifica ferma il lavoro per una scelta dell’owner: il rilievo esterno della stessa critica è già un feedback', async () => {
  const d = finti();
  const fine = (await creaMotore(d, { pausaMs: 0 }).avvia()).pratiche[7];
  expect(fine.fase).toBe('fermo');
  expect(d.comandi.filter((c) => /claude-feedback/.test(c)).length).toBe(1);
});
