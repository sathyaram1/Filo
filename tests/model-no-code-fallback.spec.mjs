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
      res.ripiego = await run(C.ACTIONS.CATEGORIZE, {
        url: 'https://example.com', title: 't', existing: [],
      });
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

// #416 (2ª passata) — la descrizione automatica delle immagini (cronologia
// incolla) aveva un ripiego TUTTO SUO, scritto nel content script: se la
// richiesta falliva — anche per "nessun modello impostato" — ritentava da sola
// con un modello Gemini scritto nel codice, e la descrizione arrivava lo stesso.
// Il blocco lato main scattava e veniva ignorato un istante dopo.
//
// Qui esercitiamo la funzione REALE del content script su una pagina reale
// (filo://newtab, un solo mondo JS) e asseriamo:
//   1. configurata bene → la descrizione arriva DAVVERO, e dal modello scelto;
//   2. senza modello → nessuna chiamata a nessun modello, l'utente vede un
//      messaggio che nomina la funzione e dice dove si imposta, e la voce in
//      cronologia smette di promettere una descrizione che non arriverà;
//   3. configurata bene ma il modello fallisce → si tenta SOLO ciò che è
//      configurato: nessun modello scritto nel codice entra in gioco.
//
// Senza il fix i punti 2 e 3 falliscono: `calledModels` contiene
// 'google/gemini-2.0-flash-001' e al punto 2 la descrizione torna comunque.
const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('la descrizione delle immagini non ripiega su un modello scritto nel codice', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await shell.waitForLoadState('domcontentloaded');
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(
    () => typeof window.SN_ACTIONS?.requestImageDescription === 'function',
    null, { timeout: 10_000 },
  );

  // Spia lato main: registra OGNI modello realmente chiamato.
  const setup = async (modelsForImage, failAll) => app.evaluate(async ({ modelsForImage, failAll }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { mio: { provider: 'openrouter', model: 'test/modello-uno' } },
      models: { [C.ACTIONS.DESCRIBE_IMAGE]: modelsForImage },
    });
    globalThis.__called = [];
    globalThis.__failAll = failAll;
    if (!globalThis.__origComplete) {
      globalThis.__origComplete = globalThis.SN_PROVIDERS.completeWithFallback;
      globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
        for (const a of attempts) {
          globalThis.__called.push(a.model);
          if (globalThis.__failAll) continue;
          return { text: 'un gatto sul divano', model: a.model, provider: a.provider, usage: {} };
        }
        throw new Error('il modello configurato non risponde');
      };
    }
  }, { modelsForImage, failAll });

  const calledModels = () => app.evaluate(() => globalThis.__called.slice());

  // La funzione del content script, chiamata come la chiama Filo quando copi
  // un'immagine: prima la voce entra in cronologia, poi parte la descrizione.
  const run = async (dataUrl) => page.evaluate(async (url) => {
    window.__toasts = [];
    if (!window.SN_POPUP.__origToast) {
      window.SN_POPUP.__origToast = window.SN_POPUP.showToast;
      window.SN_POPUP.showToast = (t) => { window.__toasts.push(String(t)); };
    }
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.PUSH_CLIPBOARD_ENTRY,
      entry: { type: 'image', dataUrl: url, description: 'Descrizione…' },
    });
    const desc = await window.SN_ACTIONS.requestImageDescription(url);
    const hist = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY });
    const entry = (hist?.items || []).find((x) => x.dataUrl === url);
    return { desc, toasts: window.__toasts.slice(), entryDescription: entry?.description || null };
  }, dataUrl);

  // 1. Configurata bene: la descrizione arriva, e dal modello scelto.
  await setup('mio', false);
  const ok = await run(PNG_1X1 + '#a');
  expect(ok.desc).toBe('un gatto sul divano');
  expect(await calledModels()).toEqual(['test/modello-uno']);
  expect(ok.entryDescription).toBe('un gatto sul divano');

  // 2. Nessun modello impostato: NIENTE descrizione, nessun modello chiamato,
  //    e l'utente lo viene a sapere.
  await setup('', false);
  const senza = await run(PNG_1X1 + '#b');
  expect(senza.desc).toBe(null);
  expect(await calledModels(), 'nessun modello deve essere chiamato').toEqual([]);
  const label = await app.evaluate(() => globalThis.SN_CONST.actionLabel(globalThis.SN_CONST.ACTIONS.DESCRIBE_IMAGE));
  expect(senza.toasts.join(' | ')).toContain(label);
  expect(senza.toasts.join(' | ')).toMatch(/Opzioni/i);
  expect(senza.entryDescription).not.toBe('Descrizione…');

  // 3. Configurata bene ma il modello fallisce: si prova SOLO il configurato.
  await setup('mio', true);
  const rotto = await run(PNG_1X1 + '#c');
  expect(rotto.desc).toBe(null);
  expect(await calledModels()).toEqual(['test/modello-uno']);
});
