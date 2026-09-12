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
  // Un PNG minuscolo vero, messo negli appunti come immagine. Se gli appunti
  // del computer non tengono un'immagine — nel contenitore senza schermo delle
  // routine non la tengono, e la prova era rossa lì e verde altrove senza che
  // nessuno l'avesse scritto (#586, giro 7) — non c'è niente da guardare e la
  // prova si ferma qui invece di mentire.
  const appunti = await app.evaluate(({ clipboard, nativeImage }) => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR4nGP8//8/AzZgYsAB'
      + 'RiQGABGvAgP1L1XAAAAAAElFTkSuQmCC';
    clipboard.writeImage(nativeImage.createFromDataURL('data:image/png;base64,' + png));
    const letta = clipboard.readImage();
    return { vuota: !letta || letta.isEmpty() };
  });
  console.log('[586 g6] gli appunti tengono un\'immagine:', !appunti.vuota);
  test.skip(appunti.vuota, 'gli appunti di questo computer non tengono un\'immagine');

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
  test(`la riga «ho smesso di chiedere» si legge col tema ${tema}`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(180_000);
    // Il tema si cambia per la strada vera, il canale delle impostazioni. Qui
    // c'era una funzione della cornice che non esiste, quindi questa prova era
    // rossa da quando è stata scritta e non ha mai guardato niente (#586,
    // giro 7).
    await app.evaluate(async (_e, t) => {
      await globalThis.SN_HANDLE_MESSAGE(
        { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } },
        { url: 'filo://security/security.html' },
      );
    }, tema);
    await shell.emulateMedia({ colorScheme: tema }).catch(() => {});
    await shell.waitForTimeout(800);

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

    // E il tema è davvero quello chiesto: senza questo controllo la prova
    // girava due volte sullo stesso aspetto e nessuno se ne accorgeva.
    const scuro = await shell.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
    console.log(`[586 g6] tema ${tema} → scuro nella cornice:`, scuro);
    expect(scuro, `la cornice doveva essere in tema ${tema}`).toBe(tema === 'dark');
  });
}
