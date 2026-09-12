// Verifica #586, giro 6 — due controlli sulla correzione di questo giro.
//
// 1. L'Incolla di Filo adesso legge gli appunti dal processo principale invece
//    che dal mondo della pagina. Un'IMMAGINE negli appunti deve continuare ad
//    arrivare, anche su un sito con una politica di sicurezza stretta.
// 2. La riga «ho smesso di chiedere», col suo «Chiedimelo di nuovo», si deve
//    leggere nei due temi.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'; connect-src 'self'">
</head><body style="margin:0;padding:20px">
<div id="ce" contenteditable="true" style="min-height:120px;border:1px solid #999"></div>
</body></html>`;

test('un\'immagine negli appunti si incolla anche dove il sito è severo', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  // Un PNG minuscolo vero, messo negli appunti come immagine.
  await app.evaluate(({ clipboard, nativeImage }) => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR4nGP8//8/AzZgYsAB'
      + 'RiQGABGvAgP1L1XAAAAAAElFTkSuQmCC';
    clipboard.writeImage(nativeImage.createFromDataURL('data:image/png;base64,' + png));
  });

  const page = await testServer.openReady(openTab, PAGINA);
  await page.click('#ce');
  await page.click('#ce', { button: 'right' });
  await page.waitForTimeout(900);
  const voce = page.locator('.sn-menu-paste-main').first();
  expect(await voce.count(), 'la voce «Incolla» deve esserci').toBeGreaterThan(0);
  await voce.click();
  await page.waitForTimeout(2500);

  const immagini = await page.evaluate(() => {
    const ce = document.getElementById('ce');
    return [...ce.querySelectorAll('img')].map((i) => (i.src || '').slice(0, 30));
  });
  console.log('[586 g6] immagini incollate:', JSON.stringify(immagini));
  expect(
    immagini.length,
    'l\'immagine negli appunti non è arrivata: leggendola dal processo principale il data URL '
    + 'va aperto a mano, perché una fetch verso data: la blocca la politica di sicurezza del sito',
  ).toBeGreaterThan(0);
});

for (const tema of ['light', 'dark']) {
  test(`la riga «ho smesso di chiedere» si legge col tema ${tema}`, async ({ shell, openTab, testServer }) => {
    test.setTimeout(180_000);
    await shell.evaluate((t) => window.filoShell.settings.update({ theme: t }), tema);
    await shell.waitForTimeout(600);

    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
<script>
  window.__fotocamera = () => navigator.mediaDevices.getUserMedia({ video: true })
    .then((s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return 'ok'; },
          (e) => 'no:' + e.name);
</script></body></html>`);

    for (let i = 0; i < 3; i++) {
      const p = page.evaluate(() => window.__fotocamera());
      await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
      await shell.locator('.perm-chip .perm-chip-x').click();
      await p;
      await shell.waitForTimeout(250);
    }
    await page.evaluate(() => window.__fotocamera());

    const avviso = shell.locator('.perm-live[data-notizia]').first();
    await expect(avviso).toHaveCount(1, { timeout: 20_000 });
    const riquadro = await avviso.boundingBox();
    console.log(`[586 g6] avviso ${tema}:`, JSON.stringify(await avviso.innerText()), JSON.stringify(riquadro));
    await shell.screenshot({ path: `tests/.shots/586-giro6-ho-smesso-${tema}.png` });

    expect(riquadro, 'l\'avviso deve avere un riquadro visibile').toBeTruthy();
    expect(riquadro.y, 'l\'avviso non deve finire sotto il bordo alto della finestra').toBeGreaterThanOrEqual(0);
    expect(riquadro.width, 'l\'avviso non deve essere schiacciato').toBeGreaterThan(200);
  });
}
