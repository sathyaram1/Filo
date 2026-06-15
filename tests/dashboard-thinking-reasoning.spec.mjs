// #156: "voglio che venga mostrato il reasoning. deve essere scritto su tre
// righe che scorrono diventando sempre meno visibili man mano che salgono.
// devono esserci massimo 3 righe visibili."
//
// Mentre Filo elabora la risposta nella newtab/dashboard, al posto della vecchia
// scritta statica "Filo sta pensando…" deve comparire un indicatore di reasoning:
// esattamente 3 righe, che scorrono verso l'alto (la frase in cima cambia mentre
// il tempo passa) e con opacità decrescente verso l'alto (slot 0 < 1 < 2).
//
// Asserisce il SUCCESSO della feature (3 righe presenti + scorrimento +
// opacità decrescente + sostituzione con la risposta), non l'assenza di un
// messaggio: senza il fix esisterebbe una sola bolla di testo statico e nessun
// `.dash-thinking-line`, quindi questi assert diventerebbero rossi.

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

test('dashboard: il reasoning è 3 righe che scorrono e sfumano, poi lascia il posto alla risposta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  // Stub del provider nel main: ritarda la risposta così l'indicatore di
  // "sta pensando" resta visibile abbastanza da poterlo ispezionare.
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const orig = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.__restoreProvider = () => { globalThis.SN_PROVIDERS.completeWithFallback = orig; };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
      await new Promise((r) => setTimeout(r, 2500));
      return {
        text: JSON.stringify({ text: 'Ecco la risposta finale.', actions: [] }),
        model: attempts[0].model,
        provider: attempts[0].provider,
        usage: {},
      };
    };
  });

  await page.locator('#input').fill('ciao filo');
  await page.locator('#sendBtn').click();

  // L'indicatore di reasoning compare con ESATTAMENTE 3 righe.
  const lines = page.locator('.dash-thinking .dash-thinking-line');
  await expect(lines).toHaveCount(3, { timeout: 3_000 });

  // L'opacità decresce salendo: slot 2 (in basso, fresca) più visibile di slot 0
  // (in cima, in uscita). Verifichiamo l'ordine effettivo a runtime.
  const op = await page.evaluate(() => {
    const get = (slot) => {
      const el = document.querySelector(`.dash-thinking .dash-thinking-line[data-slot="${slot}"]`);
      return el ? parseFloat(getComputedStyle(el).opacity) : null;
    };
    return { top: get(0), mid: get(1), bottom: get(2) };
  });
  expect(op.bottom).toBeGreaterThan(op.mid);
  expect(op.mid).toBeGreaterThan(op.top);

  // Scorrimento: la frase in cima cambia col tempo (le righe slittano verso l'alto).
  const topBefore = await lines.nth(0).textContent();
  await page.waitForTimeout(1100);
  const topAfter = await lines.nth(0).textContent();
  expect(topAfter).not.toBe(topBefore);

  // Quando la risposta arriva, l'indicatore sparisce e compare la bolla finale.
  await expect(page.locator('.dash-thinking')).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco la risposta finale.' })).toBeVisible({ timeout: 3_000 });

  await app.evaluate(() => { try { globalThis.__restoreProvider?.(); } catch (_) {} });
});
