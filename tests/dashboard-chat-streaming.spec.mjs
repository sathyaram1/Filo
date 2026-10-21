// #420 — "La risposta non compare mentre viene scritta": nella chat della home
// il testo e le azioni viaggiavano in un unico blocco JSON che andava ricevuto
// INTERO prima di mostrare anche solo la prima parola. Con un modello che ragiona
// e risposte lunghe erano secondi di schermo fermo.
//
// Fix: il main estrae il campo "text" dal JSON mentre arriva e pusha i delta alla
// scheda; la bolla si riempie mano a mano, le azioni arrivano in coda.
//
// Questi test asseriscono il SUCCESSO della feature:
//  (A) mentre il (finto) modello sta ancora scrivendo, in chat compare GIÀ una
//      parte della risposta (un frammento iniziale) ma NON ancora la coda — cosa
//      impossibile senza lo streaming del testo. Poi, a turno chiuso, il testo è
//      completo e l'azione in coda è cliccabile.
//  (B) una risposta di SOLA azione (text vuoto) NON lascia una bolla di testo
//      vuota che poi si riempie.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function configureModel(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

test('la risposta compare MENTRE viene scritta, poi l’azione arriva in coda', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  // Un sito del server di prova: con un sito vero il turno aspettava la rete (#1212.2).
  const sito = testServer.html('<title>Esempio</title><p>esempio</p>', { pubblico: true });

  // Provider in streaming: emette il JSON A PEZZI. Il campo "text" esce a
  // frammenti PRIMA che il blocco "actions" (in coda) arrivi, e a metà il
  // modello si ferma finché la prova non ha visto la bolla parziale: la finestra
  // «parte del testo c'è, la coda no» resta aperta quanto serve, non 500 ms.
  await app.evaluate(async (_, { sito: url }) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreStream = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    const vista = new Promise((r) => { globalThis.__metaVista = r; });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const full = JSON.stringify({
        text: 'PRIMA-FRASE. In mezzo scorre altro testo. ULTIMA-FRASE.',
        actions: [{ type: 'NAVIGA', url, label: 'Esempio' }],
      });
      const cut1 = full.indexOf('In mezzo');
      const cut2 = full.indexOf('ULTIMA-FRASE');
      try { onDelta && onDelta(full.slice(0, cut1)); } catch (_) {}
      try { onDelta && onDelta(full.slice(cut1, cut2)); } catch (_) {}
      await vista;
      try { onDelta && onDelta(full.slice(cut2)); } catch (_) {}
      return { text: full, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, { sito });

  await page.locator('#input').fill('ciao filo, aprimi https://example.com');
  await page.locator('#sendBtn').click();

  // SUCCESSO (streaming): mentre il modello scrive ancora, in chat c'è GIÀ il
  // frammento iniziale ma NON ancora la coda. Senza il fix la bolla comparirebbe
  // solo a fine turno, con tutto insieme → questo assert sarebbe rosso.
  await expect.poll(async () => {
    return page.evaluate(() => {
      const b = document.querySelector('.dash-bubble-streaming');
      if (!b) return null;
      const t = b.textContent || '';
      return { hasHead: t.includes('PRIMA-FRASE'), hasTail: t.includes('ULTIMA-FRASE') };
    });
  }, { timeout: 10_000 }).toEqual({ hasHead: true, hasTail: false });
  await expect(page.locator('#stopBtn')).toBeVisible();
  await app.evaluate(() => globalThis.__metaVista());

  // A turno chiuso (torna il tasto d'invio): il testo è completo e l'azione in coda è un bottone cliccabile. Il turno
  // finisce dopo l'apertura della pagina, che il main aspetta fino a 5 s (esitoApertura): il tetto la copre.
  await expect(page.locator('#stopBtn')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#sendBtn')).toBeVisible();
  await expect(page.locator('.dash-bubble-streaming')).toHaveCount(0);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'ULTIMA-FRASE' })).toBeVisible();
  await expect(page.locator('.dash-bubble-actions .dash-action-btn', { hasText: 'Esempio' })).toBeVisible();

  try { await page.screenshot({ path: 'tests/.shots/dashboard-chat-streaming.png' }); } catch (_) {}
  await app.evaluate(() => { try { globalThis.__restoreStream?.(); } catch (_) {} });
});

test('risposta di sola azione (text vuoto): niente bolla di testo vuota', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await app.evaluate(async () => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreStream2 = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      await new Promise((r) => setTimeout(r, 300));
      // Solo azione, nessun testo: apre un link (il caso del feedback). URL
      // interno + secondo piano → deterministico, niente rete e niente focus rubato.
      const full = JSON.stringify({
        text: '',
        actions: [{ type: 'NAVIGA', url: 'filo://newtab/', label: 'Home', background: true }],
      });
      try { onDelta && onDelta(full); } catch (_) {}
      return { text: full, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });

  await page.locator('#input').fill('apri la home');
  await page.locator('#sendBtn').click();

  // L'azione compare a turno finito, e il turno aspetta fino a 5 s che la scheda aperta arrivi (esitoApertura)…
  await expect(page.locator('.dash-bubble-actions .dash-action-btn').first()).toBeVisible({ timeout: 20_000 });
  // …e non è mai rimasta a schermo una bolla di testo in streaming vuota.
  await expect(page.locator('.dash-bubble-streaming')).toHaveCount(0, { timeout: 3_000 });
  // La bolla di Filo non porta testo visibile (è "solo azioni").
  const filoText = await page.evaluate(() => {
    const bubbles = Array.from(document.querySelectorAll('.dash-bubble-filo'));
    // Escludi la riga azioni: guarda solo il testo diretto della bolla.
    return bubbles.map((b) => {
      const clone = b.cloneNode(true);
      clone.querySelectorAll('.dash-bubble-actions').forEach((n) => n.remove());
      return (clone.textContent || '').trim();
    }).join('|');
  });
  expect(filoText).toBe('');

  await app.evaluate(() => { try { globalThis.__restoreStream2?.(); } catch (_) {} });
});
