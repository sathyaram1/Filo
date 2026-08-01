// #416 — quando una funzione non ha un modello impostato, non deve partire su un
// modello scelto dal codice: deve fermarsi e dire QUALE funzione è scoperta e
// dove si imposta. Le altre funzioni, configurate bene, continuano a funzionare.
//
// Il test gira nel processo reale dell'app con una configurazione personale
// esplicita (niente default condivisi, niente rete): un registry con UN SOLO
// nickname, e tre funzioni messe apposta in tre stati diversi.
//
// Cosa asserisce (successo, non assenza di errore):
//   1. la funzione configurata bene RISPONDE, e risponde con il modello scelto;
//   2. la funzione senza modello NON chiama nessun modello e il messaggio nomina
//      la funzione e dice dove si imposta;
//   3. la funzione che cita una scorciatoia inesistente si comporta uguale, e il
//      messaggio nomina la scorciatoia mancante;
//   4. la catena di ripiego fra modelli CONFIGURATI resta: se il primo fallisce
//      si passa al secondo.
//
// Senza il fix i punti 2 e 3 fallirebbero: la richiesta partiva comunque, sul
// registry scritto nel codice (nickname 'flash' → un modello Gemini), quindi
// `calledModels` conterrebbe un modello e non verrebbe sollevato nessun errore.

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

test('una funzione senza modello si ferma e lo dice; le altre continuano a funzionare', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await shell.waitForLoadState('domcontentloaded');
  await waitForBoot(app);

  const out = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const MSG = globalThis.SN_MSG.MSG;

    // Registry configurato: due nickname, nessuno di quelli integrati nel codice.
    // 'flash' e 'flash-or' (le catene scritte nelle costanti) qui NON esistono.
    const registry = {
      mio: { provider: 'openrouter', model: 'test/modello-uno' },
      'mio-2': { provider: 'openrouter', model: 'test/modello-due' },
    };
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: registry,
      models: {
        [C.ACTIONS.EXPLAIN]: 'mio',            // configurata bene
        [C.ACTIONS.TRANSLATE_SELECTION]: '',   // nessun modello impostato
        [C.ACTIONS.EXPLAIN_LINK]: 'fantasma',  // scorciatoia inesistente
        [C.ACTIONS.CATEGORIZE]: 'mio, mio-2',  // catena di ripiego voluta
      },
    });

    // Stub del provider: registra ogni modello realmente chiamato. Il primo
    // modello della catena fallisce, così si vede se il ripiego voluto scatta.
    const calledModels = [];
    const origComplete = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
      for (const a of attempts) {
        calledModels.push(a.model);
        if (a.model === 'test/modello-uno' && globalThis.__failFirst) continue;
        return { text: 'risposta', model: a.model, provider: a.provider, usage: {} };
      }
      throw new Error('tutti i tentativi falliti');
    };

    const run = async (action, payload) => {
      const before = calledModels.length;
      try {
        const r = await globalThis.SN_HANDLE_MESSAGE(
          { type: MSG.AI_REQUEST, action, payload: payload || {} }, {},
        );
        return { ok: true, text: r && r.text, model: r && r.model, calls: calledModels.slice(before) };
      } catch (e) {
        return {
          ok: false, message: String(e && e.message), code: e && e.code,
          calls: calledModels.slice(before),
        };
      }
    };

    let res;
    try {
      res = {
        configurata: await run(C.ACTIONS.EXPLAIN, { selection: 'ciao', sentence: 'ciao mondo' }),
        senzaModello: await run(C.ACTIONS.TRANSLATE_SELECTION, { text: 'hello' }),
        fantasma: await run(C.ACTIONS.EXPLAIN_LINK, { url: 'https://example.com', text: 'x' }),
      };
      globalThis.__failFirst = true;
      res.ripiego = await run(C.ACTIONS.CATEGORIZE, { url: 'https://example.com', title: 't' });
    } finally {
      globalThis.__failFirst = false;
      globalThis.SN_PROVIDERS.completeWithFallback = origComplete;
    }

    res.labelTranslate = C.actionLabel(C.ACTIONS.TRANSLATE_SELECTION);
    res.labelLink = C.actionLabel(C.ACTIONS.EXPLAIN_LINK);
    return res;
  });

  // 1. La funzione configurata risponde, e con il modello scelto.
  expect(out.configurata.ok, `la funzione configurata deve funzionare: ${out.configurata.message}`).toBe(true);
  expect(out.configurata.text).toBe('risposta');
  expect(out.configurata.model).toBe('test/modello-uno');

  // 2. Senza modello: nessuna chiamata a nessun modello, e il messaggio dice
  //    quale funzione è scoperta e dove si imposta.
  expect(out.senzaModello.ok).toBe(false);
  expect(out.senzaModello.calls).toEqual([]);
  expect(out.senzaModello.code).toBe('NO_MODEL_FOR_ACTION');
  expect(out.senzaModello.message).toContain(out.labelTranslate);
  expect(out.senzaModello.message).toMatch(/Opzioni/i);

  // 3. Scorciatoia inesistente: stesso comportamento, e il messaggio la nomina.
  expect(out.fantasma.ok).toBe(false);
  expect(out.fantasma.calls).toEqual([]);
  expect(out.fantasma.code).toBe('NO_MODEL_FOR_ACTION');
  expect(out.fantasma.message).toContain(out.labelLink);
  expect(out.fantasma.message).toContain('fantasma');

  // 4. La catena di ripiego fra modelli configurati è intatta.
  expect(out.ripiego.ok, `il ripiego fra modelli configurati deve restare: ${out.ripiego.message}`).toBe(true);
  expect(out.ripiego.model).toBe('test/modello-due');
  expect(out.ripiego.calls).toEqual(['test/modello-uno', 'test/modello-due']);
});
