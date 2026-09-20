// Scatto di servizio del giro 9: l'avviso e il tasto «Fallo adesso» nei due
// temi. Non è una prova: si cancella prima di registrare la critica.
import { test, expect } from '../../fixtures/electron.mjs';
import fs from 'node:fs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('scatto avviso', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await app.evaluate(async (_e, script) => {
    globalThis.__captured = []; let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const step = script[Math.min(i++, script.length - 1)];
      globalThis.__captured.push(1);
      await new Promise((r) => setTimeout(r, 40));
      if (step.text) { try { onDelta && onDelta(step.text); } catch (_) {} }
      return { text: step.text || '', toolCalls: [], reasoningDetails: [], model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, [{ text: 'Ecco la frase senza quella parola:\n\nIl gatto dorme sul divano.\n\nTe l\'ho tolta.' }]);
  await page.locator('#input').fill('nella frase «il gatto grigio dorme sul divano» togli la parola grigio');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
  fs.mkdirSync('tests/.shots', { recursive: true });
  const n = await app.evaluate(() => globalThis.__captured.length);
  const testo = await page.locator('.dash-bubble-avviso').textContent().catch(() => '(nessuno)');
  const tasti = await page.getByRole('button', { name: /Fallo adesso/ }).count();
  const log = await page.evaluate(() => Array.from(document.querySelectorAll('*'))
    .filter((e) => e.children.length === 0 && /rifatt|rilett/i.test(e.textContent || ''))
    .map((e) => e.textContent.trim()).slice(0, 3));
  console.log('CHIAMATE=', n, '| AVVISO=', testo, '| TASTI=', tasti, '| LOG=', JSON.stringify(log));
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `tests/.shots/517-giro9-${tema}.png`, fullPage: false });
  }
});
