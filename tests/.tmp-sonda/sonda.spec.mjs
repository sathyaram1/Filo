import { test, expect } from '../fixtures/electron.mjs';
test('sonda', async ({ shell, openTab }) => {
  const visti = new Set();
  let vivo = true;
  const giro = (async () => {
    while (vivo) {
      try {
        const s = (await shell.evaluate(async () => window.filoShell.tabs.snapshot())).tabs.map((t) => t.identityColor || null);
        visti.add(JSON.stringify(s));
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 30));
    }
  })();
  const dash = await openTab('filo://newtab/');
  await expect(dash.locator('#input')).toBeVisible({ timeout: 8_000 });
  await new Promise((r) => setTimeout(r, 3000));
  vivo = false; await giro;
  console.log('VISTI', [...visti].join(' | '));
});
