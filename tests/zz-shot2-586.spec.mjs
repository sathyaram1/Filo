// Sonda visiva temporanea #586 — da cancellare.
import { test } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

test('scatto impostazioni', async ({ app, openTab }) => {
  mkdirSync('tests/agent/.out', { recursive: true });
  await app.evaluate(async () => {
    await globalThis.SN_HANDLE_MESSAGE(
      {
        type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS,
        settings: {
          security: {
            sitePermissions: {
              'https://meet.esempio.it': { fotocamera: 'allow', microfono: 'allow' },
              'https://news.esempio.it': { notifiche: 'deny', posizione: 'deny' },
            },
          },
        },
      },
      { url: 'filo://security/security.html' },
    );
  });
  const page = await openTab('filo://security/');
  await page.waitForSelector('#perms-list li', { timeout: 8000 });
  await page.locator('#sec-permissions').scrollIntoViewIfNeeded();
  await page.locator('#sec-permissions').screenshot({ path: 'tests/agent/.out/586-imp-chiaro.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400);
  await page.locator('#sec-permissions').screenshot({ path: 'tests/agent/.out/586-imp-scuro.png' });
});
