// Giro 2, rilievo 3: con regole.yml su main di filo-security le regole le pubblica GitHub ogni ora; chiuso un lavoro
// che le cambia, il PC non chiede più all'owner di pubblicarle a mano. Motore vero dell'orchestratore, dipendenze finte.

import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { ROOT } from './aiuti-giro2.mjs';

const { creaMotore, nuovaPratica } = await import(new URL(`file:///${join(ROOT, 'scripts', 'lib', 'orchestratore.mjs').replace(/\\/g, '/')}`).href);

test('r3 chiuso dal PC un lavoro che cambia le regole, l’avviso dice che le pubblica GitHub e non chiede il comando a mano', async () => {
  const p = nuovaPratica({ num: 4242, richiesta: 'cambia le regole del database', ora: '2026-10-14T10:00:00Z' });
  p.fase = 'chiusura';
  const pratiche = { [p.num]: p };
  const comandi = [];
  const esegui = async (cmd, args, { cwd } = {}) => {
    const a = args.join(' ');
    comandi.push(`${cmd} ${a}`);
    let out = '';
    if (cmd === 'git' && /^rev-list --count origin\/main\.\.HEAD/.test(a)) out = '1';
    else if (cmd === 'git' && /^rev-list --count/.test(a)) out = '0';
    else if (cmd === 'git' && /^diff --name-only/.test(a)) out = 'firestore.rules\nsrc/pages/manage/manage.js';
    else if (cmd === 'git' && /^merge-base/.test(a)) return { code: 1, out: '', stdout: '' };
    void cwd;
    return { code: 0, out, stdout: out };
  };
  const base = {
    store: { leggi: () => ({ coda: [p.num], pratiche }), salvaPratica: (q) => { pratiche[q.num] = q; } },
    esegui,
    claude: async () => ({ ok: true, testo: '', costo: 0 }),
    verifica: () => ({}),
    pubblica: async () => { comandi.push('server:pubblica'); return { code: 0, out: '' }; },
    carico: async () => ({ cpu: 0, liberaGB: 99 }),
    dormi: async () => {},
    log: () => {},
    ora: () => '2026-10-14T10:00:00Z',
    percorsi: { radice: '/filo', wt: (s) => `/filo/wt/${s}`, serverRadice: '/filo-security', wtServer: (s) => `/filo-security/wt/${s}`, note: '/note', regole: '' },
    fs: { esiste: () => false, collega() {}, scollega() {} },
    annota: async () => {},
    richiestaDi: async () => 'cambia le regole del database',
  };
  // Ogni domanda «lo fa GitHub?» risponde sì: deploy.yml e regole.yml sono su main di filo-security.
  const dep = new Proxy(base, { get: (t, k) => (k in t ? t[k] : (/github/i.test(String(k)) ? async () => true : undefined)) });
  const motore = creaMotore(dep, { paralleli: 1, tieniWorktree: true });
  const fine = await motore.guida(p);
  expect(fine.fase, `il lavoro si chiude: ${JSON.stringify(fine.fermo)}`).toBe('fuso');
  const manuali = (fine.avvisi || []).filter((a) => /regol/i.test(a) && /npm run regole:pubblica/.test(a) && !/GitHub|regole\.yml/.test(a));
  expect(manuali, 'avviso che chiede all’owner di pubblicare a mano le regole che GitHub pubblica da sé').toEqual([]);
});
