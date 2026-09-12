// Verifica #586, giro 5 — com'è fatta la riga «non riesco a sapere dove sei»,
// nei due temi. È l'unico pezzo di interfaccia nuovo di questo giro.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<p>un sito che ti vuole trovare sulla mappa</p>
<script>
  window.__pos = () => new Promise((r) => navigator.geolocation.getCurrentPosition(
    () => r('coordinate'), (e) => r('errore ' + e.code), { timeout: 25000 }));
</script></body></html>`;

for (const tema of ['light', 'dark']) {
  test(`l'avviso della posizione si legge col tema ${tema}`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(180_000);
    await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t; }, tema);
    await shell.emulateMedia({ colorScheme: tema }).catch(() => {});
    await shell.waitForTimeout(600);
    const page = await testServer.openReady(openTab, HTML);
    page.evaluate(() => window.__pos()).catch(() => {});
    await shell.waitForTimeout(2000);
    const consenti = shell.locator('.perm-chip .perm-chip-allow');
    if (await consenti.count()) await consenti.first().click();

    const avviso = shell.locator('.perm-live[data-notizia]');
    await expect(avviso).toHaveCount(1, { timeout: 25_000 });
    const box = await avviso.first().boundingBox();
    console.log(`[586 g5] avviso ${tema}:`, JSON.stringify(await avviso.first().textContent()),
      'riquadro', JSON.stringify(box));
    await shell.screenshot({ path: `tests/.shots/586-giro5-avviso-${tema}.png` });

    // Deve stare dentro la finestra e non essere alto zero.
    const finestra = await shell.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    expect(box, 'l\'avviso non si vede').toBeTruthy();
    expect(box.x, 'l\'avviso esce dal bordo sinistro').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'l\'avviso esce dal bordo destro').toBeLessThanOrEqual(finestra.w + 1);
    expect(box.height, 'l\'avviso è alto zero').toBeGreaterThan(10);
    // E la frase non si tronca: nella pastiglia il testo è a riga singola.
    const troncato = await avviso.first().locator('.perm-chip-text')
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(troncato, 'la frase dell\'avviso si tronca').toBe(false);
  });
}
