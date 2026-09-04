// #418 — "Le risposte di Filo perdono la formattazione e i link": nella chat
// della home il testo del modello veniva mostrato grezzo (asterischi, parentesi
// quadre) e i link non erano cliccabili.
//
// Fix: a fine turno la risposta viene renderizzata con la formattazione leggera
// condivisa (grassetto/corsivo/codice/elenchi + LINK). I link sono contenuto NON
// FIDATO: solo http/https/mailto diventano cliccabili e aprono in nuova scheda;
// un link verso una pagina interna (filo://) resta testo, non un <a>.
//
// SUCCESSO asserito:
//  (A) il grassetto diventa <strong> e un link markdown diventa un <a> cliccabile
//      con href e target giusti;
//  (B) cliccando quel link si APRE davvero una nuova scheda su quell'indirizzo;
//  (C) un link filo:// interno NON diventa cliccabile (nessun <a>), ma il testo
//      resta visibile.

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
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
  });
}

test('la risposta di Filo mostra grassetto e link cliccabili; il link interno resta testo', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  // Pagina locale reale a cui punterà il link (niente rete esterna).
  const linkUrl = testServer.html('<!doctype html><title>Meta</title><h1>meta</h1>');
  const linkHost = new URL(linkUrl).host;
  // Grassetto + un link markdown esterno + un link interno filo:// (da scartare).
  const responseText = `Ecco un punto **importante**. Vedi [la fonte](${linkUrl}) e le [impostazioni](filo://preferences/preferences.html).`;

  await app.evaluate(async (_e, responseText) => {
    globalThis.__mockText = responseText;
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreMd = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const full = JSON.stringify({ text: globalThis.__mockText, actions: [] });
      try { onDelta && onDelta(full); } catch (_) {}
      return { text: full, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, responseText);

  await page.locator('#input').fill('spiegami');
  await page.locator('#sendBtn').click();

  // (A) bolla renderizzata: grassetto in <strong>, link esterno in <a.filo-md-link>.
  const bubble = page.locator('.dash-bubble-filo.dash-bubble-md').last();
  await expect(bubble).toBeVisible({ timeout: 8_000 });
  await expect(bubble.locator('strong', { hasText: 'importante' })).toBeVisible();
  const link = bubble.locator(`a.filo-md-link[href="${linkUrl}"]`);
  await expect(link).toBeVisible();
  await expect(link).toHaveText('la fonte');
  await expect(link).toHaveAttribute('target', '_blank');

  // (C) il link interno filo:// NON è un <a> (contenuto non fidato), ma il testo
  // "impostazioni" resta visibile.
  await expect(bubble.locator('a[href^="filo://"]')).toHaveCount(0);
  await expect(bubble).toContainText('impostazioni');

  // (B) cliccando il link si apre una NUOVA scheda su quell'indirizzo.
  const before = shell.locator('.tab');
  const beforeCount = await before.count();
  await link.click();
  await expect(shell.locator('.tab')).toHaveCount(beforeCount + 1, { timeout: 8_000 });
  await expect.poll(async () => {
    return app.windows().some((w) => { try { return new URL(w.url()).host === linkHost; } catch (_) { return false; } });
  }, { timeout: 8_000, intervals: [100] }).toBe(true);

  try { await page.screenshot({ path: 'tests/.shots/dashboard-chat-markdown.png' }); } catch (_) {}
  await app.evaluate(() => { try { globalThis.__restoreMd?.(); } catch (_) {} });
});
