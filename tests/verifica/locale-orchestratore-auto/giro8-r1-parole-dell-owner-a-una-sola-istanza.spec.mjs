// Giro 8, rilievo 1: quello che l'owner scrive (risposta a riprendi, --richiesta di aggiungi) arriva sia al lavoratore sia al verificatore.
import { test, expect } from '@playwright/test';
import { creaMotore, nuovaPratica, riprendi } from '../../../scripts/lib/orchestratore.mjs';
import { withRequest, withCritique } from '../../../scripts/verify-local.mjs';

const RAMO = 'claude/lavoro-8';
const CAPS = { cap3: 5, cap2: 4, cap1: 3, cap0: 1 };
const RISPOSTA = 'Tieni il bordo grigio freddo: è voluto, non è un difetto.';

function finti({ critiche, pratica }) {
  const s = { coda: [8], pratiche: { 8: pratica } };
  let stato = withRequest({}, RAMO, { request: pratica.richiesta || 'x', sha: 'a' });
  let giro = 0;
  const prompt = { lavoratore: [], verificatore: [] };
  return {
    prompt,
    store: { leggi: () => JSON.parse(JSON.stringify(s)), salvaPratica: (q) => { s.pratiche[q.num] = JSON.parse(JSON.stringify(q)); } },
    esegui: async (cmd, args) => {
      const a = args.join(' ');
      if (/rev-list --count origin\/main\.\.HEAD/.test(a)) return { code: 0, out: '2', stdout: '2' };
      if (/rev-list --count/.test(a)) return { code: 0, out: '0', stdout: '0' };
      if (/verify-local\.mjs start/.test(a)) {
        // Come verify-local start: senza testo la richiesta resta quella registrata, e il compito la riporta.
        stato = withRequest(stato, RAMO, { request: args[2] && !args[2].startsWith('--') ? args[2] : stato[RAMO].request, sha: 'a' });
        return { code: 0, out: `compito: ${stato[RAMO].request}`, stdout: `compito: ${stato[RAMO].request}` };
      }
      return { code: 0, out: '', stdout: '' };
    },
    claude: async ({ ruolo, prompt: testo }) => {
      prompt[ruolo].push(testo);
      if (ruolo === 'verificatore') {
        stato = withCritique(stato, RAMO, { critique: critiche[giro], sha: `s${giro}`, at: `t${giro}`, caps: CAPS }).state;
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

test('l’owner risponde a una scelta col punto di domanda: la risposta arriva anche al verificatore del giro dopo', async () => {
  const pratica = { ...nuovaPratica({ num: 8, slug: 'lavoro-8', richiesta: 'Rendi il riquadro più leggibile' }), fase: 'verifica' };
  const d = finti({
    pratica,
    critiche: [
      'Provato il riquadro con dati finti: si legge.\n[2i?] Il bordo è grigio freddo: caldo come il resto di Filo? Scelta di gusto.',
      'Provato il riquadro con dati finti: si legge.',
    ],
  });
  const fermo = (await creaMotore(d, { pausaMs: 0 }).avvia()).pratiche[8];
  expect(fermo.fase).toBe('fermo');
  d.store.salvaPratica(riprendi(fermo, RISPOSTA));
  const fine = (await creaMotore(d, { pausaMs: 0 }).avvia()).pratiche[8];
  expect(fine.fase).toBe('fuso');
  expect(d.prompt.lavoratore.at(-1)).toContain(RISPOSTA);
  // Senza la risposta il verificatore rimette in discussione la scelta già fatta e il lavoro torna a fermarsi sulla stessa domanda.
  expect(d.prompt.verificatore.at(-1)).toContain(RISPOSTA);
});

test('aggiungi con --richiesta: il lavoratore riceve la stessa richiesta su cui viene giudicato', async () => {
  const RICHIESTA = 'Solo la parte del menu del tasto destro: il resto del feedback lo lascio a dopo.';
  const pratica = { ...nuovaPratica({ num: 8, slug: 'lavoro-8', richiesta: RICHIESTA }), fase: 'lavoro' };
  const d = finti({ pratica, critiche: ['Provato il menu con dati finti: funziona.'] });
  const fine = (await creaMotore(d, { pausaMs: 0 }).avvia()).pratiche[8];
  expect(fine.fase).toBe('fuso');
  expect(d.prompt.verificatore[0]).toContain(RICHIESTA);
  expect(d.prompt.lavoratore[0]).toContain(RICHIESTA);
});
