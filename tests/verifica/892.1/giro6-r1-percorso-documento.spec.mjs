// #892.1 giro 6 r1 — una barra seguita dal percorso di un documento o di una cartella (o da una faccina che comincia
// coi due punti) non è un programma: resta un messaggio per Filo, e mentre la si scrive la casella è rossa.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function newtabPage(app) {
  let win = null;
  await expect.poll(() => {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    return Boolean(win);
  }, { timeout: 10_000 }).toBe(true);
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#input')).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => win.evaluate(() => window.SN_DASH_TERMINALE?.isEnabled?.() === true), { timeout: 8_000 }).toBe(true);
  return win;
}

test('r1 il percorso di un documento, di una cartella o una faccina dopo la barra va a Filo', async ({ app }) => {
  const dir = cartellaTemporanea('filo-892-1-g6-');
  mkdirSync(path.join(dir, 'Documenti'));
  writeFileSync(path.join(dir, 'Documenti', 'lettera.pdf'), 'x');
  const page = await newtabPage(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__n892g6 = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      globalThis.__n892g6 += 1;
      const text = `Risposta ${globalThis.__n892g6} di Filo.`;
      try { onDelta && onDelta(text); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
  // Il terminale lavora nella cartella dove sta il documento, come dopo un «cd».
  await page.locator('#input').fill(`/cd "${dir}"`);
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-term-controls')).toHaveCount(0, { timeout: 12_000 });

  const frasi = ["/Documenti/lettera.pdf che cos'è?", '/Documenti/', '/:) grazie mille'];
  for (const [i, frase] of frasi.entries()) {
    await page.locator('#input').fill(frase);
    await expect(page.locator('#input'), `${frase}: rossa prima dell'invio`).toHaveClass(/is-cmd-unknown/, { timeout: 8_000 });
    await page.locator('#input').press('Enter');
    await expect(page.locator('.dash-bubble-filo', { hasText: `Risposta ${i + 1} di Filo.` }), frase).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  }
});
