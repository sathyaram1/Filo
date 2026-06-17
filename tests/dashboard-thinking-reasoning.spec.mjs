// #156 / #priorità1: "voglio che venga mostrato il reasoning. deve essere
// scritto su tre righe che scorrono diventando sempre meno visibili man mano
// che salgono. devono esserci massimo 3 righe visibili." → seguito: "il
// followup era per chiedere di inserire il reasoning VERO non queste frasi
// generiche."
//
// Mentre Filo elabora la risposta nella newtab/dashboard compare l'indicatore
// di reasoning: esattamente 3 righe, che scorrono verso l'alto e con opacità
// decrescente verso l'alto (slot 0 < 1 < 2). Quando il modello restituisce il
// RAGIONAMENTO VERO in streaming, le 3 righe mostrano QUEL testo (non più le
// frasi indicative).
//
// Asserisce il SUCCESSO della feature: il testo del ragionamento emesso dal
// (finto) modello compare davvero nelle righe — testo che NON è tra le frasi
// indicative, quindi senza il fix (instradamento del reasoning vero alla
// dashboard) questo assert sarebbe rosso.

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

test('dashboard: il reasoning VERO scorre su 3 righe che sfumano, poi lascia il posto alla risposta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  // Stub del provider in STREAMING (il cammino usato dalla chat quando il client
  // apre il canale del reasoning): emette il ragionamento vero a pezzi con un
  // ritardo, così l'indicatore resta ispezionabile, poi ritorna la risposta.
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreProvider = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onReasoning, onDelta }) => {
      // Frasi NON presenti tra le THINKING_PHRASES indicative: se compaiono nelle
      // righe vuol dire che è davvero il reasoning del modello a essere mostrato.
      const thoughts = [
        'Per prima cosa interpreto la domanda dell’utente.',
        'Poi confronto le informazioni che ho a disposizione.',
        'Quindi soppeso le possibili risposte una per una.',
        'Infine scelgo la formulazione più chiara e utile.',
      ];
      for (const t of thoughts) {
        try { onReasoning && onReasoning(t + ' '); } catch (_) {}
        await new Promise((r) => setTimeout(r, 500));
      }
      const text = JSON.stringify({ text: 'Ecco la risposta finale.', actions: [] });
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });

  await page.locator('#input').fill('ciao filo');
  await page.locator('#sendBtn').click();

  // L'indicatore di reasoning compare con ESATTAMENTE 3 righe.
  const lines = page.locator('.dash-thinking .dash-thinking-line');
  await expect(lines).toHaveCount(3, { timeout: 3_000 });

  // Il RAGIONAMENTO VERO compare nelle righe: cerchiamo una delle frasi emesse
  // dal modello finto (non è tra le frasi indicative). Questo è l'assert che
  // distingue "reasoning vero" da "frasi generiche animate".
  await expect.poll(async () => {
    return page.evaluate(() => document.querySelector('.dash-thinking')?.textContent || '');
  }, { timeout: 4_000, intervals: [100] }).toContain('soppeso le possibili risposte');

  // L'opacità decresce salendo: slot 2 (in basso, fresca) più visibile di slot 0.
  await expect.poll(async () => {
    return page.evaluate(() => {
      const get = (slot) => {
        const el = document.querySelector(`.dash-thinking .dash-thinking-line[data-slot="${slot}"]`);
        return el ? parseFloat(getComputedStyle(el).opacity) : null;
      };
      const top = get(0), mid = get(1), bottom = get(2);
      return bottom > mid && mid > top;
    });
  }, { timeout: 3_000, intervals: [100] }).toBe(true);

  // Quando la risposta arriva, l'indicatore sparisce e compare la bolla finale.
  await expect(page.locator('.dash-thinking')).toHaveCount(0, { timeout: 6_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco la risposta finale.' })).toBeVisible({ timeout: 3_000 });

  await app.evaluate(() => { try { globalThis.__restoreProvider?.(); } catch (_) {} });
});

test('dashboard: senza reasoning del modello restano le 3 righe indicative che scorrono', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  // Provider in streaming che NON emette reasoning (modello che non ragiona):
  // l'indicatore deve comunque animare le frasi indicative come fallback.
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreProvider2 = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      await new Promise((r) => setTimeout(r, 2500));
      const text = JSON.stringify({ text: 'Risposta senza reasoning.', actions: [] });
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });

  await page.locator('#input').fill('ciao filo');
  await page.locator('#sendBtn').click();

  const lines = page.locator('.dash-thinking .dash-thinking-line');
  await expect(lines).toHaveCount(3, { timeout: 3_000 });

  // Le frasi indicative scorrono: la riga in cima cambia col tempo.
  const topBefore = await lines.nth(0).textContent();
  await page.waitForTimeout(1100);
  const topAfter = await lines.nth(0).textContent();
  expect(topAfter).not.toBe(topBefore);

  await expect(page.locator('.dash-thinking')).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta senza reasoning.' })).toBeVisible({ timeout: 3_000 });

  await app.evaluate(() => { try { globalThis.__restoreProvider2?.(); } catch (_) {} });
});
