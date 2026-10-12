import { test } from '../../fixtures/electron.mjs';

test('aspetto della Cronologia AI con molte voci', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    for (let i = 0; i < 400; i++) {
      await globalThis.SN_HISTORY.append({
        action: i % 2 ? 'explain_selection' : 'filo_chat', provider: 'openrouter', model: 'deepseek/deepseek-v4-pro',
        input: i % 2 ? { selection: `parola ${i}` } : { threadMessages: [{ role: 'user', content: `A che ora apre il museo ${i}?` }] },
        output: `Risposta numero ${i}, con qualche riga di testo.`, origin: 'https://esempio.test/', costEur: 0.001,
      });
    }
  });
  const page = await openTab('filo://history/history.html');
  await page.waitForSelector('.sn-history-item');
  await page.screenshot({ path: 'tests/.shots/1065-giro4-chiaro.png' });
  await page.locator('.sn-history-item').last().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/1065-giro4-fondo.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/1065-giro4-scuro.png' });
});
