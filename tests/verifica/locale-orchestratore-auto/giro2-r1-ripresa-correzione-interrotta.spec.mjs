// Giro 2, rilievo 1: un lavoratore interrotto mentre correggeva si riprende dalla correzione, non da una verifica che verify-local rifiuta.
import { test, expect } from '@playwright/test';
import { creaMotore, nuovaPratica, riprendi } from '../../../scripts/lib/orchestratore.mjs';

const sospesa = { ok: false, entry: { request: 'x', verdict: 'fix-pending', pending: { findings: [{ level: 2, sede: 'i', text: 'il pulsante Salva non salva col titolo vuoto' }] } } };

// verify-local start rifiuta un ramo con una correzione in sospeso, come fa davvero.
function finti(stato, claude) {
  const s = JSON.parse(JSON.stringify(stato));
  const prompt = [];
  return {
    prompt,
    store: { leggi: () => JSON.parse(JSON.stringify(s)), salvaPratica: (p) => { s.pratiche[p.num] = JSON.parse(JSON.stringify(p)); } },
    esegui: async (cmd, args) => {
      const a = args.join(' ');
      if (/verify-local\.mjs start/.test(a)) return { code: 1, out: "C'è una correzione in sospeso su questo ramo: prima chi corregge consegna", stdout: '' };
      if (/rev-list --count origin\/main\.\.HEAD/.test(a)) return { code: 0, out: '2', stdout: '2' };
      if (/rev-list --count/.test(a)) return { code: 0, out: '0', stdout: '0' };
      return { code: 0, out: '', stdout: '' };
    },
    claude: async ({ ruolo, prompt: testo }) => { prompt.push({ ruolo, testo }); return claude.length ? claude.shift() : { ok: true, testo: 'fatto', costo: 1 }; },
    verifica: () => sospesa,
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

test('correzione interrotta dal tetto di spesa: riprendi rilancia la correzione coi rilievi', async () => {
  const p = { ...nuovaPratica({ num: 7, richiesta: 'x' }), giri: 1, giriTotali: 1, fase: 'fermo',
    fermo: { motivo: 'il verificatore ha registrato la critica ma non ha consegnato la correzione', dove: 'verifica', correzione: '- il pulsante Salva non salva col titolo vuoto' } };
  // Primo tentativo di correzione: l'istanza esce col tetto di spesa per istanza.
  const d1 = finti({ coda: [7], pratiche: { 7: riprendi(p, '') } }, [{ ok: false, testo: '', costo: 5, errore: 'error_max_budget_usd' }]);
  const fermo = (await creaMotore(d1, { pausaMs: 0 }).avvia()).pratiche[7];
  expect(fermo.fase).toBe('fermo');

  // L'owner riprende senza testo: deve ripartire la correzione, coi rilievi davanti.
  const d2 = finti({ coda: [7], pratiche: { 7: riprendi(fermo, '') } }, []);
  const fine = (await creaMotore(d2, { pausaMs: 0, tetto: 2 }).avvia()).pratiche[7];
  expect(d2.prompt.map((x) => x.ruolo)).toContain('lavoratore');
  expect(d2.prompt[0].testo).toContain('il pulsante Salva non salva col titolo vuoto');
  expect(fine.fermo && fine.fermo.motivo).not.toMatch(/verify-local start non è partito/);
});

test('correzione interrotta, l’owner risponde: chi riprende può ancora consegnare la correzione', async () => {
  const p = { ...nuovaPratica({ num: 7, richiesta: 'x' }), giri: 1, giriTotali: 1, fase: 'fermo',
    fermo: { motivo: 'il verificatore ha registrato la critica ma non ha consegnato la correzione', dove: 'verifica', correzione: '- il pulsante Salva non salva col titolo vuoto' } };
  const d1 = finti({ coda: [7], pratiche: { 7: riprendi(p, '') } }, [{ ok: false, testo: '', costo: 5, errore: 'error_max_budget_usd' }]);
  const fermo = (await creaMotore(d1, { pausaMs: 0 }).avvia()).pratiche[7];
  const d2 = finti({ coda: [7], pratiche: { 7: riprendi(fermo, 'riprova pure') } }, []);
  await creaMotore(d2, { pausaMs: 0, tetto: 2 }).avvia();
  expect(d2.prompt[0].ruolo).toBe('lavoratore');
  expect(d2.prompt[0].testo).toContain('il pulsante Salva non salva col titolo vuoto');
  expect(d2.prompt[0].testo).toContain('verify-local.mjs corretto');
});
