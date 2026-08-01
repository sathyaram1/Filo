// #366.2 — Gli importi crediti decisi dall'owner valgono davvero, nell'APP VERA.
//
// Qui non si testa la logica pura (già coperta da tests/unit/creditConfig.test.mjs):
// si esercita il cammino COMPLETO dentro Electron — lettura del documento di
// configurazione globale → registrazione sul motore crediti → importo davvero
// accreditato/addebitato — perché è lì che vive il bug che questo spec protegge.
//
// La rete verso Firestore è stubbata nel processo main: il documento globale
// viene consegnato dal test, tutto il resto (parsing, normalizzazione, motore,
// handler IPC, pagina) è codice reale.
//
// PRE-CONDIZIONE (senza il fix questi assert sono ROSSI):
//   - premi di risoluzione 50/0/0/0 → l'app pagava 50 anche alle fasce azzerate
//     (ripiego sulla fascia 0), cioè accreditava crediti disattivati apposta;
//   - un si'/no o uno spazio al posto di un importo → diventava 0/1 (riapertura
//     GRATIS per tutti, ricarica azzerata) invece di ricadere sull'importo storico.

import { test, expect } from './fixtures/electron.mjs';

const BOARD = 'filo://board/board.html';

// Consegna al main un documento di configurazione globale (formato Firestore) e
// lo fa adottare dal motore crediti esattamente come farebbe una lettura vera.
// Ritorna la config EFFETTIVA in vigore + gli importi che il motore userebbe.
async function applyRemoteConfig(app, doc) {
  return app.evaluate(async (_electron, fields) => {
    // `__filoDefaults` è lo STESSO modulo che usa l'app (esposto solo in test).
    const Defaults = globalThis.__filoDefaults;

    const realFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('config/credits') || u.includes('config%2Fcredits')) {
        return {
          ok: true, status: 200,
          async json() { return { fields }; },
          async text() { return ''; },
        };
      }
      return realFetch(url, opts);
    };
    try {
      await Defaults.refresh();               // lettura reale (rete stubbata)
    } finally {
      global.fetch = realFetch;
    }

    const Credits = globalThis.SN_CREDITS;
    Credits.setActiveConfig(Defaults.getCreditConfig());
    return {
      config: Credits.config(),
      // Gli importi che l'app userebbe DAVVERO: `rewardForPriority` è la stessa
      // chiamata che fa l'accredito alla risoluzione di un feedback, e
      // `config().boardReopen` è lo stesso valore che la bacheca addebita.
      premiRisoluzione: [0, 1, 2, 3].map((p) => Credits.rewardForPriority(p)),
      saldoBenvenuto: Credits.freshState('2026-06-17').balance,
      ricaricaUnGiorno: Credits.applyRefill(
        { ...Credits.freshState('2026-06-16'), balance: 0 }, '2026-06-17',
      ).added,
    };
  }, doc);
}

// Rimette il motore sugli importi integrati (i test non devono influenzarsi).
async function resetConfig(app) {
  await app.evaluate(async () => { globalThis.SN_CREDITS.setActiveConfig(null); });
}

const intero = (n) => ({ integerValue: String(n) });
const tabella = (v) => ({ mapValue: { fields: {
  0: intero(v[0]), 1: intero(v[1]), 2: intero(v[2]), 3: intero(v[3]),
} } });

test('azzerando il premio di UNA fascia l\'app non paga più quella fascia', async ({ app }) => {
  try {
    const r = await applyRemoteConfig(app, { feedbackResolveByPriority: tabella([50, 0, 0, 0]) });
    // Il documento è stato recepito così com'è…
    expect(r.config.feedbackResolveByPriority).toEqual({ 0: 50, 1: 0, 2: 0, 3: 0 });
    // …e gli importi DAVVERO accreditati sono quelli, non l'importo di un'altra
    // fascia (prima del fix: [50, 50, 50, 50]).
    expect(r.premiRisoluzione).toEqual([50, 0, 0, 0]);
  } finally { await resetConfig(app); }
});

test('fasce miste: ognuna paga il suo importo, gli zeri restano zero', async ({ app }) => {
  try {
    const r = await applyRemoteConfig(app, { feedbackResolveByPriority: tabella([7, 0, 9, 0]) });
    expect(r.premiRisoluzione).toEqual([7, 0, 9, 0]);
  } finally { await resetConfig(app); }
});

test('un si\'/no o uno spazio al posto di un importo NON azzera nulla', async ({ app }) => {
  try {
    const r = await applyRemoteConfig(app, {
      boardReopen: { booleanValue: false },   // prima: riapertura GRATIS per tutti
      boardVote: { booleanValue: true },      // prima: premio voto = 1
      dailyRefill: { stringValue: '   ' },    // prima: ricarica giornaliera azzerata
      initial: { arrayValue: { values: [] } },// prima: saldo di benvenuto azzerato
    });
    // Tutti gli importi restano quelli storici: un valore di tipo sbagliato viene
    // ignorato, mai convertito in uno zero silenzioso.
    expect(r.config.boardReopen).toBe(5);
    expect(r.config.boardVote).toBe(10);
    expect(r.config.dailyRefill).toBe(100);
    expect(r.config.initial).toBe(1000);
    expect(r.saldoBenvenuto).toBe(1000);
    expect(r.ricaricaUnGiorno).toBe(100);
  } finally { await resetConfig(app); }
});

test('gli importi validi valgono davvero (e lo zero esplicito è rispettato)', async ({ app }) => {
  try {
    const r = await applyRemoteConfig(app, {
      initial: intero(2500), dailyRefill: intero(250), maxRefillDays: intero(3),
      boardVote: intero(0), boardReopen: intero(123),
      feedbackResolveByPriority: tabella([11, 22, 33, 44]),
    });
    expect(r.saldoBenvenuto).toBe(2500);
    expect(r.ricaricaUnGiorno).toBe(250);
    expect(r.premiRisoluzione).toEqual([11, 22, 33, 44]);
    expect(r.config.boardVote).toBe(0);       // premio voto disattivabile
    expect(r.config.boardReopen).toBe(123);
  } finally { await resetConfig(app); }
});

test('senza documento globale l\'app usa esattamente gli importi di sempre', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const Credits = globalThis.SN_CREDITS;
    Credits.setActiveConfig(null);
    return {
      config: Credits.config(),
      premi: [0, 1, 2, 3].map((p) => Credits.rewardForPriority(p)),
      saldo: Credits.freshState('2026-06-17').balance,
    };
  });
  expect(r.premi).toEqual([50, 100, 200, 300]);
  expect(r.saldo).toBe(1000);
  expect(r.config.dailyRefill).toBe(100);
  expect(r.config.maxRefillDays).toBe(30);
  expect(r.config.feedbackSend).toBe(5);
  expect(r.config.boardVote).toBe(10);
  expect(r.config.boardReopen).toBe(5);
});

test('la bacheca mostra il costo di riapertura DAVVERO in vigore', async ({ app, openTab }) => {
  try {
    await applyRemoteConfig(app, { boardReopen: intero(123) });
    const page = await openTab(BOARD);
    await page.waitForLoadState('domcontentloaded');

    // La pagina chiede al main gli importi in vigore: la cifra che mostra deve
    // essere la stessa che verrebbe addebitata.
    const r = await page.evaluate(() => window.filo.message({ type: 'credits_get_config' }));
    expect(r.ok).toBe(true);
    expect(r.config.boardReopen).toBe(123);
  } finally { await resetConfig(app); }
});

test('salvare un importo di tipo sbagliato viene RIFIUTATO, non convertito', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const Defaults = globalThis.__filoDefaults;
    const chiamate = [];
    const realFetch = global.fetch;
    global.fetch = async (url, opts = {}) => {
      chiamate.push({ url: String(url), method: (opts.method || 'GET').toUpperCase() });
      return { ok: true, status: 200, async json() { return { fields: {} }; }, async text() { return ''; } };
    };
    let errore = '';
    try {
      await Defaults.updateCreditConfig({ boardReopen: false, dailyRefill: 100 }, 'token-finto');
    } catch (e) {
      errore = String(e?.message || e);
    } finally {
      global.fetch = realFetch;
    }
    return {
      errore,
      haScritto: chiamate.some((c) => c.method === 'PATCH' && c.url.includes('config/credits')),
    };
  });
  // Errore chiaro che nomina il campo sbagliato…
  expect(esito.errore).toMatch(/boardReopen/);
  // …e NIENTE è stato salvato: meglio non scrivere nulla che scrivere metà.
  expect(esito.haScritto).toBe(false);
});
