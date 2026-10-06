// Prova del giro 1 (verifica locale, orchestratore): col limite d'uso che riparte fra tre giorni (quello settimanale) il
// lavoro aspetta, come chiesto senza tetti di tempo; non si ferma subito con una nota che dice «dopo 12 ore di attesa».

import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const importa = (p) => import(pathToFileURL(resolve(ROOT, p)).href);
const dormi = (ms) => new Promise((ok) => setTimeout(ok, ms));

function dipendenze(pratiche) {
  const s = { coda: pratiche.map((p) => p.num), pratiche: Object.fromEntries(pratiche.map((p) => [p.num, p])) };
  const fatti = new Set();
  const d = {
    istanze: 0,
    note: [],
    store: { leggi: () => JSON.parse(JSON.stringify(s)), salvaPratica: (p) => { s.pratiche[p.num] = JSON.parse(JSON.stringify(p)); } },
    esegui: async (cmd, args) => {
      const a = args.join(' ');
      if (cmd === 'git' && /rev-parse --verify/.test(a)) return { code: 1, out: '', stdout: '' };
      if (cmd === 'git' && /rev-list --count/.test(a)) return { code: 0, out: '1', stdout: '1' };
      return { code: 0, out: '', stdout: '' };
    },
    claude: async () => {
      d.istanze += 1;
      return { ok: false, testo: '', costo: 0, errore: `Claude AI usage limit reached|${Math.floor(Date.now() / 1000) + 3 * 86400}` };
    },
    verifica: () => ({}),
    pubblica: async () => ({ code: 0, out: '' }),
    filoAperto: async () => false,
    carico: async () => ({ cpu: 5, liberaGB: 8 }),
    // Un'attesa lunga resta appesa come nella realtà; le pause brevi del giro passano subito.
    dormi: (ms) => dormi(ms > 60_000 ? 10 * 60_000 : 20),
    log: () => {},
    ora: () => new Date().toISOString(),
    percorsi: { radice: 'R', wt: (sl) => `R/wt/${sl}`, serverRadice: '', wtServer: () => '', note: 'N', regole: '' },
    fs: { esiste: (p) => fatti.has(p), collega: (v, l) => fatti.add(l), scollega: (l) => fatti.delete(l) },
    annota: async (rif, testo) => { d.note.push(testo); return { ok: true }; },
    richiestaDi: async (n) => `richiesta ${n}`,
  };
  return { d, s };
}

test('r2 col limite d’uso che riparte fra tre giorni il lavoro aspetta e non si ferma con una nota falsa', async () => {
  const { creaMotore, nuovaPratica } = await importa('scripts/lib/orchestratore.mjs');
  const { d, s } = dipendenze([nuovaPratica({ num: 1, richiesta: 'a' }), nuovaPratica({ num: 2, richiesta: 'b' })]);
  const motore = creaMotore(d, { pausaMs: 20 });
  const fine = motore.avvia();
  await dormi(1500);
  const fermi = Object.values(s.pratiche).filter((p) => p.fase === 'fermo').map((p) => `#${p.num}: ${p.fermo.motivo}`);
  motore.smetti('subito');
  await Promise.race([fine, dormi(3000)]);
  expect(fermi).toEqual([]);
  expect(d.note).toEqual([]);
});
