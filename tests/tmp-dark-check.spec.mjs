// TEMPORANEO: controllo visivo al tema scuro. Da cancellare.
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

test('scuro', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.evaluate(() => {
    const host = document.querySelector('#bubbles') || document.body;
    window.__filoDashActions.renderActions(host, [
      { type: 'ESEGUI_COMANDO', _executed: false, _output: { command: 'ls -la', blocked: 'disabled' } },
      { type: 'EVENTO_CALENDARIO', _executed: false, _output: { proposta: true, evento: { titolo: 'Riunione team', data: '2026-09-24', ora: '15:00', quando: '24/09/2026 alle 15:00' } } },
      { type: 'COMANDO_FINESTRA', comando: 'home', _executed: true, _output: { window: 'home', already: true } },
    ], { onAck: () => {} });
  });
  await page.screenshot({ path: 'tests/agent/.out/tmp-scuro.png' });
});
