// Verifica #1683 giro 1, rilievo 1: su un disco NTFS o exFAT ogni documento ha il permesso d'esecuzione, e la frase
// che comincia col suo percorso deve restare un messaggio per Filo, come quella col documento di un disco Linux.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

test.skip(process.platform === 'win32', 'il permesso d\'esecuzione è dei dischi montati su Linux e Mac');

test('r1 un documento col permesso d\'esecuzione dopo la barra va a Filo, non alla shell', async ({ app }) => {
  const dir = cartellaTemporanea('filo-1683-r1-');
  mkdirSync(path.join(dir, 'Chiavetta'));
  const pdf = path.join(dir, 'Chiavetta', 'lettera.pdf');
  writeFileSync(pdf, '%PDF-1.4\n%fine\n');
  chmodSync(pdf, 0o777);

  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    return Boolean(page);
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => page.evaluate(() => window.SN_DASH_TERMINALE?.isEnabled?.() === true), { timeout: 8_000 }).toBe(true);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const text = 'Risposta r1 di Filo.';
      try { onDelta && onDelta(text); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
  const input = page.locator('#input');
  await input.fill(`/cd "${dir}"`);
  await input.press('Enter');
  await expect(page.locator('.dash-term-controls')).toHaveCount(0, { timeout: 12_000 });
  const comandi = await page.locator('.dash-term-cmd').count();

  await input.fill("/Chiavetta/lettera.pdf che cos'è?");
  await expect(input, 'mentre si scrive non è un programma').toHaveClass(/is-cmd-unknown/, { timeout: 8_000 });
  await input.press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta r1 di Filo.' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  await expect(page.locator('.dash-term-cmd'), 'niente è andato alla shell').toHaveCount(comandi);
});
