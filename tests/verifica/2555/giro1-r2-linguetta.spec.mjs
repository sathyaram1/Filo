// Verifica #2555 giro 1, rilievo 2: il tasto destro su una linguetta delle schede è ancora un elenco di voci scritte,
// mentre il resto del tasto destro di Filo è a icone.

import { test, expect } from '../../fixtures/electron.mjs';

test('r2 il menu della linguetta è a icone, senza righe di testo', async ({ app, shell, openTab }) => {
  await openTab('filo://options/options.html');
  await shell.locator('.tab .title', { hasText: 'Modelli' }).first().waitFor({ timeout: 8_000 });
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active') || document.querySelector('.tab');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
    }));
  });
  let popup = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try {
        const c = await w.evaluate(() => document.querySelectorAll('button.item, .sn-menu-row-btn').length);
        const t = await w.evaluate(() => /Duplica/.test(document.body.innerHTML));
        if (c && t) { popup = w; return true; }
      } catch (_) {}
    }
    return false;
  }, { timeout: 8_000 }).toBe(true);
  const righe = await popup.evaluate(() => [...document.querySelectorAll('button.item, .sn-menu-row-btn')]
    .filter((b) => b.getClientRects().length && b.innerText.trim()).map((b) => b.innerText.trim()));
  expect(righe, 'voci scritte nel menu della linguetta').toEqual([]);
});
