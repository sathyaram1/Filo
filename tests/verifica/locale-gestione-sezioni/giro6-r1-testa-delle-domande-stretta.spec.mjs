// Giro 6, r1: con la finestra stretta la pillola di Applica il consiglio copre il titolo della colonna delle Domande.
import { test, expect } from '../../fixtures/electron.mjs';
import { installa, apri, sezione, domanda } from './aiuto-g6.mjs';

test('r1 a finestra stretta Applica il consiglio non copre «Da rispondere»', async ({ app, openTab }) => {
  await installa(app, { domande: [domanda(1), domanda(2), domanda(3)] });
  const page = await apri(openTab);
  await sezione(page, 'domande').click();
  await page.locator('.mg-domanda[data-id="D-1"] .mg-dom-sel').check();
  const btn = page.locator('#mgDomandeConsiglioSel');
  await expect(btn).toBeVisible();
  // Metà dello schermo dell'owner (1920 px al 125%): una finestra affiancata a un'altra.
  await page.setViewportSize({ width: 768, height: 760 });
  await page.waitForTimeout(300);
  const coperti = await page.evaluate(() => {
    const b = document.getElementById('mgDomandeConsiglioSel');
    const r = b.getBoundingClientRect();
    const out = [];
    const tw = document.createTreeWalker(b.parentElement, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (b.contains(n) || !n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const q of rg.getClientRects()) {
        if (q.right > r.left + 1 && q.left < r.right - 1 && q.bottom > r.top + 1 && q.top < r.bottom - 1) out.push(n.textContent.trim());
      }
    }
    return out;
  });
  expect(coperti, 'testo della testa della colonna sotto il pulsante').toEqual([]);
});
