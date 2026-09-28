// Verifica #586 giro 12, rilievo 8: Sicurezza aperta da una finestra incognito non mostra le scelte di sempre.
import { test, expect } from '../../fixtures/electron.mjs';

const riga = (shell) => shell.locator('#perm-bar .perm-row');

const PAGINA = `<!doctype html><html><head><title>Notifiche</title></head><body>
<script>window.chiedi = () => Notification.requestPermission();</script></body></html>`;

test('Sicurezza aperta in incognito elenca anche le scelte date nella finestra normale', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA);
  const host = new URL(testServer.origin).host;
  await page.evaluate(() => { window.__e = null; window.chiedi().then((r) => { window.__e = r; }); });
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled();
  await shell.locator('#perm-bar .perm-si').click();
  await expect.poll(() => page.evaluate(() => window.__e)).toBe('granted');

  await shell.evaluate(() => window.filoShell.openIncognito());
  let inc = null;
  await expect.poll(() => { inc = app.windows().find((w) => w.url().includes('incognito=1')); return !!inc; }).toBe(true);
  await inc.waitForLoadState('domcontentloaded');
  await inc.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  let sec = null;
  await expect.poll(() => { sec = app.windows().find((w) => w.url().startsWith('filo://security/')); return !!sec; }).toBe(true);
  await sec.waitForLoadState('domcontentloaded');
  await expect(sec.locator('#perm-list'), 'da incognito l’elenco dice che nessun sito ha chiesto niente').toContainText(host, { timeout: 5_000 });
});
