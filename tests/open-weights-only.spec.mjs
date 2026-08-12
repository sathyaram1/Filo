// #461 — l'interruttore "solo modelli a pesi aperti" nel processo reale dell'app.
//
// La promessa della politica sui modelli è verificabile solo guardando cosa
// parte davvero: il test intercetta la catena di tentativi COSTRUITA dall'app
// (non una funzione pura) mentre si usano i CREDITI DI FILO, cioè con i modelli
// e le chiavi predefinite — il caso in cui prima l'utente non aveva voce.
//
// Cosa asserisce (successo, non assenza di errore):
//   1. a interruttore acceso una funzione che nasce su un modello proprietario
//      RISPONDE lo stesso, servita dal suo equivalente a pesi aperti;
//   2. nessun tentativo passa dall'API diretta del produttore né cita un modello
//      proprietario, e la richiesta porta con sé l'esclusione di Anthropic;
//   3. se il sostituto non risponde, la catena NON ripiega su un modello
//      proprietario: la richiesta fallisce e basta;
//   4. la funzione senza equivalente aperto si ferma dicendo perché, e non
//      chiama nessun modello;
//   5. chi ha SERVITO davvero la risposta viene controllato: se risulta escluso,
//      la voce di cronologia resta marchiata invece di passare inosservata;
//   6. a interruttore spento tutto torna come prima.
//
// Senza il fix: il punto 1 arriverebbe da un modello Gemini, i punti 2/3/4
// fallirebbero (la catena proprietaria resta intatta) e il 5 non esisterebbe.

// Chiavi predefinite finte: sono quelle che stanno dietro ai "crediti di Filo".
// Vanno impostate PRIMA che la fixture lanci l'app (le legge da process.env),
// altrimenti la richiesta si fermerebbe su "accedi con un profilo" e il test
// non arriverebbe mai a guardare la catena.
process.env.FILO_DEFAULT_OPENROUTER_KEY = 'k-test-openrouter';
process.env.FILO_DEFAULT_GEMINI_KEY = 'k-test-gemini';

import { test, expect } from './fixtures/electron.mjs';

async function waitForBoot(app) {
  const deadline = Date.now() + 10_000;
  let tab = null;
  while (Date.now() < deadline) {
    tab = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; }
    });
    if (tab) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (tab) await tab.waitForLoadState('domcontentloaded').catch(() => {});
}

test('solo modelli a pesi aperti: sostituisce, non ripiega, e lo dimostra', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await shell.waitForLoadState('domcontentloaded');
  await waitForBoot(app);

  const out = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const MSG = globalThis.SN_MSG.MSG;
    const Storage = globalThis.SN_STORAGE;
    const History = globalThis.SN_HISTORY;

    // Registra ogni tentativo costruito dall'app e risponde col primo, così si
    // vede ESATTAMENTE cosa sarebbe partito verso la rete.
    const seen = [];
    let servedByNext = 'DeepInfra';
    let failAll = false;
    const origComplete = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
      seen.push(attempts.map((a) => ({
        provider: a.provider,
        model: a.model,
        ignore: (a.providerRouting && a.providerRouting.ignore) || [],
      })));
      if (failAll) throw new Error('nessun fornitore disponibile');
      const a = attempts[0];
      return {
        text: 'risposta', model: a.model, provider: a.provider,
        servedBy: servedByNext, usage: {},
      };
    };

    const run = async (action, payload) => {
      const before = seen.length;
      try {
        const r = await globalThis.SN_HANDLE_MESSAGE(
          { type: MSG.AI_REQUEST, action, payload: payload || {} }, {},
        );
        return { ok: true, text: r && r.text, model: r && r.model, chain: seen[before] || [] };
      } catch (e) {
        return { ok: false, message: String(e && e.message), code: e && e.code, chain: seen[before] || null };
      }
    };

    const res = {};
    try {
      // Crediti di Filo: modelli e chiavi PREDEFINITI, interruttore acceso.
      await Storage.setSettings({ useDefaultModels: true, openWeightsOnly: true });
      try { await History.clear(); } catch (_) {}

      res.acceso = await run(C.ACTIONS.EXPLAIN, { selection: 'ciao', sentence: 'ciao mondo' });
      res.anthropic = await run(C.ACTIONS.EXPLAIN_DEEP, { selection: 'ciao', sentence: 'ciao mondo' });

      // Il sostituto non risponde: non deve esistere un tentativo proprietario dopo.
      failAll = true;
      res.tuttoGiu = await run(C.ACTIONS.EXPLAIN, { selection: 'ciao', sentence: 'ciao mondo' });
      failAll = false;

      // Funzione con un modello proprietario e NESSUN equivalente aperto
      // (configurazione personale: un modello Anthropic scelto a mano, che non
      // è uno di quelli con un sostituto previsto).
      await Storage.setSettings({
        useDefaultModels: false,
        apiKeys: { openrouter: 'k-test' },
        modelRegistry: { 'mio-claude': { provider: 'openrouter', model: 'anthropic/claude-3.7-sonnet' } },
        models: { [C.ACTIONS.EXPLAIN_LINK]: 'mio-claude' },
      });
      res.senzaEquivalente = await run(C.ACTIONS.EXPLAIN_LINK, { url: 'https://example.com', text: 'x' });
      await Storage.setSettings({ useDefaultModels: true });

      // Controprova sul SERVITO: se chi ha servito è escluso, la voce di
      // cronologia lo dice invece di far passare la cosa in silenzio.
      servedByNext = 'Google AI Studio';
      res.violazione = await run(C.ACTIONS.EXPLAIN, { selection: 'x', sentence: 'y' });
      const items = await History.list();
      res.ultimaVoce = items && items[0]
        ? { servedBy: items[0].servedBy, policyViolation: items[0].policyViolation }
        : null;
      servedByNext = 'DeepInfra';

      // Interruttore spento: la configurazione di prima torna intatta.
      await Storage.setSettings({ openWeightsOnly: false });
      res.spento = await run(C.ACTIONS.EXPLAIN, { selection: 'ciao', sentence: 'ciao mondo' });
    } finally {
      globalThis.SN_PROVIDERS.completeWithFallback = origComplete;
    }
    return res;
  });

  // 1. La funzione risponde davvero, e da un modello a pesi aperti.
  expect(out.acceso.ok, `la funzione deve continuare a funzionare: ${out.acceso.message}`).toBe(true);
  expect(out.acceso.text).toBe('risposta');
  expect(out.acceso.model).toBe('google/gemma-4-31b-it');

  // 2. Nessun tentativo proprietario, nessuna API diretta del produttore, e
  //    Anthropic esclusa nell'instradamento.
  const proprietari = /gemini|claude|gpt-|grok/i;
  for (const chain of [out.acceso.chain, out.anthropic.chain, out.spento.chain]) {
    expect(Array.isArray(chain)).toBe(true);
  }
  for (const a of out.acceso.chain.concat(out.anthropic.chain)) {
    expect(a.provider, 'l\'API diretta del produttore non deve comparire').toBe('openrouter');
    expect(a.model, `modello proprietario nella catena: ${a.model}`).not.toMatch(proprietari);
    expect(a.ignore.map((s) => s.toLowerCase())).toContain('anthropic');
    expect(a.ignore.map((s) => s.toLowerCase())).toContain('google');
  }
  // Anche la funzione che nasceva su Anthropic viene servita da pesi aperti.
  expect(out.anthropic.ok).toBe(true);
  expect(out.anthropic.model).toBe('deepseek/deepseek-v4-pro');

  // 3. Sostituto giù → nessun ripiego proprietario: la catena resta di soli
  //    modelli ammessi e la richiesta fallisce.
  expect(out.tuttoGiu.ok).toBe(false);
  for (const a of out.tuttoGiu.chain) {
    expect(a.model).not.toMatch(proprietari);
  }

  // 4. Funzione senza equivalente: si ferma, non chiama niente, e lo dice.
  expect(out.senzaEquivalente.ok).toBe(false);
  expect(out.senzaEquivalente.code).toBe('NO_OPEN_WEIGHTS_MODEL');
  expect(out.senzaEquivalente.chain).toBe(null);
  expect(out.senzaEquivalente.message).toMatch(/pesi aperti/i);

  // 5. Controprova su chi ha servito: marchiata, non silenziosa.
  expect(out.ultimaVoce).not.toBe(null);
  expect(out.ultimaVoce.servedBy).toBe('Google AI Studio');
  expect(out.ultimaVoce.policyViolation).toBe(true);

  // 6. Spento: si torna alla configurazione predefinita (modello Gemini).
  expect(out.spento.ok).toBe(true);
  expect(out.spento.model).toMatch(/gemini/i);
});
