// Verifica #732 giro 2: il tasto destro non avvisa sui domini di servizio dei marchi stessi (file, immagini, font, allegati).
import { test, expect } from '../../fixtures/electron.mjs';

const LINK = [
  'https://raw.githubusercontent.com/microsoft/vscode/main/README.md',
  'https://lh3.googleusercontent.com/a/foto.jpg',
  'https://fonts.googleapis.com/css2?family=Inter',
  'https://cdn.discordapp.com/attachments/1/2/foto.png',
];

for (const href of LINK) {
  test(`r1 tasto destro su ${new URL(href).hostname}: nessun «Controlla l'indirizzo»`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
      <p><a id="lnk" href="${href}">Il file</a></p></body></html>`);
    await page.locator('#lnk').click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.locator('.sn-menu .sn-menu-link-warn')).toHaveCount(0);
  });
}
