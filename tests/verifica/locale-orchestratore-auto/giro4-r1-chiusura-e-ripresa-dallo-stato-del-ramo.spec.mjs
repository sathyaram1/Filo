// Giro 4, rilievo 1: chiusura e ripresa guardano dove sta davvero il ramo (già su main, già con lavoro), non il passo registrato.
import { test, expect } from '@playwright/test';
import { creaMotore, nuovaPratica, riprendi } from '../../../scripts/lib/orchestratore.mjs';

function finti(pratica, { verdetto = {}, commitAvanti = 2, claude = [] } = {}) {
  const s = { coda: [pratica.num], pratiche: { [pratica.num]: JSON.parse(JSON.stringify(pratica)) } };
  const stato = { v: verdetto };
  const ruoli = [];
  const prompt = [];
  let deploy = 0;
  return {
    ruoli,
    prompt,
    deploy: () => deploy,
    store: { leggi: () => JSON.parse(JSON.stringify(s)), salvaPratica: (p) => { s.pratiche[p.num] = JSON.parse(JSON.stringify(p)); } },
    esegui: async (cmd, args) => {
      const a = args.join(' ');
      if (/verify-local\.mjs start/.test(a)) { stato.v = { ok: false, entry: { request: 'x' } }; return { code: 0, out: 'compito', stdout: 'compito' }; }
      if (/rev-list --count origin\/main\.\.HEAD/.test(a)) return { code: 0, out: String(commitAvanti), stdout: String(commitAvanti) };
      if (/rev-list --count/.test(a)) return { code: 0, out: '0', stdout: '0' };
      if (/diff --name-only/.test(a)) return { code: 0, out: commitAvanti ? 'src/shared/feedbackTransitions.js' : '', stdout: '' };
      if (/finish-local/.test(a)) return { code: 1, out: 'niente da fondere', stdout: '' };
      return { code: 0, out: '', stdout: '' };
    },
    claude: async ({ ruolo, prompt: testo }) => {
      ruoli.push(ruolo);
      prompt.push(testo);
      const r = claude.length ? claude.shift() : { ok: true, testo: 'fatto', costo: 1 };
      return typeof r === 'function' ? r(stato) : r;
    },
    verifica: () => stato.v,
    pubblica: async () => { deploy += 1; return { code: 0, out: '' }; },
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

test('fusione in attesa: l’owner approva in Filo (il server fonde) e riprende, il lavoro si chiude col deploy', async () => {
  const p = {
    ...nuovaPratica({ num: 7, richiesta: 'x' }), giri: 1, giriTotali: 1, fase: 'fermo',
    fileApp: ['src/shared/feedbackTransitions.js'],
    fermo: { motivo: 'la fusione aspetta la tua approvazione in Filo', dove: 'chiusura', attesaApprovazione: true },
  };
  // Dopo l'approvazione il server ha già fuso: il ramo sta dentro origin/main, nessun commit oltre.
  const d = finti(riprendi(p, ''), { verdetto: superata, commitAvanti: 0 });
  const fine = (await creaMotore(d, { pausaMs: 0 }).avvia()).pratiche[7];
  expect(fine.fermo && fine.fermo.motivo).toBeFalsy();
  expect(fine.fase).toBe('fuso');
  expect(d.deploy()).toBe(1);
});

test('lavoratore finito che ha lasciato solo file non salvati: l’owner li toglie e riprende, parte la verifica e non un altro lavoratore', async () => {
  const p = {
    ...nuovaPratica({ num: 7, richiesta: 'x' }), fase: 'fermo',
    fermo: { motivo: 'il lavoratore ha lasciato modifiche non salvate:\n?? appunti.txt', dove: 'lavoro' },
  };
  const d = finti(riprendi(p, ''), { commitAvanti: 2 });
  await creaMotore(d, { pausaMs: 0, tetto: 1 }).avvia();
  expect(d.ruoli[0]).toBe('verificatore');
  expect(d.ruoli).not.toContain('lavoratore');
});

test('lavoratore interrotto a metà del primo lavoro: chi riparte sa che il ramo ha già del lavoro', async () => {
  const p = {
    ...nuovaPratica({ num: 7, richiesta: 'x' }), fase: 'fermo',
    fermo: { motivo: 'il lavoratore non ha finito: tempo scaduto (240 min): processo fermato', dove: 'lavoro' },
  };
  const d = finti(riprendi(p, ''), { commitAvanti: 3, claude: [{ ok: false, testo: '', costo: 1, errore: 'errore finto' }] });
  await creaMotore(d, { pausaMs: 0, tetto: 1 }).avvia();
  expect(d.ruoli[0]).toBe('lavoratore');
  expect(d.prompt[0]).toMatch(/ramo ha già del lavoro|da dove è rimasto/);
});
