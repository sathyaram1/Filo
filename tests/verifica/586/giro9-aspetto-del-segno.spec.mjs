// Cattura visiva del segno sulla scheda (#586 giro 9), nei due temi.
import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0">
<script>window.__chiedi = () => navigator.mediaDevices.getUserMedia({ audio: true, video: true })
  .then(() => 'ok', (e) => 'no');</script></body></html>`;

for (const tema of ['light', 'dark']) {
  test(`aspetto del segno sulla scheda — ${tema}`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(120_000);
    await app.evaluate(async (_e, t) => {
      await globalThis.SN_HANDLE_MESSAGE(
        { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } },
        { url: 'filo://security/security.html' },
      );
    }, tema);
    await shell.waitForTimeout(600);
    const page = await testServer.openReady(openTab, HTML);
    const esito = page.evaluate(() => window.__chiedi());
    await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
    await shell.locator('.perm-chip .perm-chip-allow').first().click();
    await esito;
    await expect(shell.locator('.tab .sensor-ind')).toHaveCount(1, { timeout: 15_000 });
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    await shell.waitForTimeout(1500);
    console.log(`[586 g9] ${tema} — schede col segno:`, await shell.locator('.tab .sensor-ind').count(),
      'etichetta:', await shell.locator('.tab .sensor-ind').first().getAttribute('aria-label'));
    await shell.locator('.tabs, #tabs').first().screenshot({ path: `tests/.shots/586-giro9-segno-scheda-${tema}.png` })
      .catch(async () => { await shell.screenshot({ path: `tests/.shots/586-giro9-segno-scheda-${tema}.png` }); });
  });
}
