// Verifica #256, quarto giro: le altre porte che portano alla stessa lista
// vecchia — copiare mentre la pagina Sicurezza è sotto gli occhi.

import { test, expect } from './fixtures/electron.mjs';

async function stored(app) {
  return app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const res = await globalThis.SN_HANDLE_MESSAGE(
      { type: MSG.GET_CLIPBOARD_HISTORY },
      { url: 'filo://security/security.html' },
    );
    return (res.items || []).map((e) => (e.type === 'image' ? 'IMG' : e.text));
  });
}

test('#256 copia fatta DENTRO la pagina Sicurezza: la lista sotto gli occhi si aggiorna?', async ({ app, shell, openTab }) => {
  void shell;
  const page = await openTab('filo://security/');
  await expect(page.locator('#sec-clip-desc')).toBeVisible({ timeout: 10_000 });

  // L'utente seleziona un pezzo di testo della pagina e lo copia.
  await page.evaluate(() => {
    const el = document.getElementById('sec-clip-desc');
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(1200);

  const disco = await stored(app);
  console.log('[#256] cronologia dopo copia nella pagina:', JSON.stringify(disco).slice(0, 200));
  const inPagina = await page.locator('#sec-clip-list').textContent();
  console.log('[#256] la lista mostra la copia appena fatta:', disco.length > 0 && inPagina.includes((disco[0] || '').slice(0, 20)));
  console.log('[#256] righe in pagina:', await page.locator('#sec-clip-list .sn-clip-item').count());
});
