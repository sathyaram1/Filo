// Verifica #630 giro 1, rilievo 1: tasto destro su un avviso dentro la pagina. Come per quelli della
// barra, il menu deve parlare dell'avviso (almeno «Chiudi»), non della pagina che sta sotto.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGE = `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif;height:100vh">
  <h1>Pagina</h1><a id="link" href="https://example.com/articolo">Un collegamento di prova</a>
</body></html>`;

// «Copia URL» dal tasto destro vero sul link: produce «Copiato» nella pila della pagina.
async function copiaUrl(page) {
  const menu = page.locator('.sn-menu');
  for (let i = 0; i < 6; i++) {
    await page.locator('#link').click({ button: 'right', position: { x: 8, y: 8 } });
    const voce = menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'immagine' });
    try {
      await voce.first().waitFor({ state: 'visible', timeout: 1500 });
      await voce.first().click();
      await expect(menu).toHaveCount(0);
      return;
    } catch (_) { await page.waitForTimeout(200); }
  }
  throw new Error('voce «Copia URL» non raggiungibile');
}

test('tasto destro su «Copiato» in una pagina web: il menu offre «Chiudi» e chiude l’avviso', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  await copiaUrl(page);
  const avviso = page.locator('.sn-toast');
  await expect(avviso).toHaveClass(/sn-toast-visible/);
  await page.waitForTimeout(300);
  const b = await avviso.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const chiudi = page.locator('.sn-menu button', { hasText: /^Chiudi/ });
  await expect(chiudi, 'il menu del tasto destro sull’avviso è quello della pagina: niente «Chiudi»').toHaveCount(1, { timeout: 2000 });
  await chiudi.click();
  await expect(avviso).toHaveCount(0, { timeout: 1500 });
});
