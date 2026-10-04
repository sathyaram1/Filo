// Giro 8, rilievo 2: un rilievo che non si apre al primo tentativo e si apre al secondo non resta segnato come «feedback non aperto».
import { test, expect } from '@playwright/test';
import { creaMotore, nuovaPratica, rigaStato } from '../../../scripts/lib/orchestratore.mjs';
import { withRequest, withCritique } from '../../../scripts/verify-local.mjs';

const RAMO = 'claude/lavoro-9';
const CAPS = { cap3: 5, cap2: 4, cap1: 3, cap0: 1 };

test('la rete cade al primo tentativo di aprire un rilievo esterno: a lavoro fuso lo stato non dice più che non si è aperto', async () => {
  const p = { ...nuovaPratica({ num: 9, slug: 'lavoro-9', richiesta: 'x' }), fase: 'verifica' };
  const s = { coda: [9], pratiche: { 9: p } };
  let stato = withRequest({}, RAMO, { request: 'x', sha: 'a' });
  let tentativi = 0;
  const d = {
    store: { leggi: () => JSON.parse(JSON.stringify(s)), salvaPratica: (q) => { s.pratiche[q.num] = JSON.parse(JSON.stringify(q)); } },
    esegui: async (cmd, args) => {
      const a = args.join(' ');
      if (/rev-list --count origin\/main\.\.HEAD/.test(a)) return { code: 0, out: '2', stdout: '2' };
      if (/rev-list --count/.test(a)) return { code: 0, out: '0', stdout: '0' };
      if (/claude-feedback/.test(a)) {
        tentativi += 1;
        return tentativi === 1 ? { code: 1, out: 'fetch failed', stdout: '' } : { code: 0, out: 'Aperto #951', stdout: '' };
      }
      if (/verify-local\.mjs start/.test(a)) return { code: 0, out: 'compito', stdout: 'compito' };
      return { code: 0, out: '', stdout: '' };
    },
    claude: async ({ ruolo }) => {
      if (ruolo === 'verificatore') {
        stato = withCritique(stato, RAMO, { critique: 'Provato con dati finti: funziona.\n[1e] La pagina Preferenze taglia le etichette lunghe: c’era già su main.', sha: 's', at: 't', caps: CAPS }).state;
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
  const fine = (await creaMotore(d, { pausaMs: 0 }).avvia()).pratiche[9];
  expect(fine.fase).toBe('fuso');
  expect(fine.derivatiAperti.map((x) => x.num)).toEqual([951]);
  expect(rigaStato(fine)).not.toContain('feedback non aperto');
});
