import { test } from '../../fixtures/electron.mjs';
import { apriCronologia } from '../../helpers/cronologiaAppunti.mjs';

test('shot', async ({ app, shell, openTab, testServer }) => {
  for (const t of ['una password: pw-Segreta-589', 'https://esempio.test/articolo-lungo-che-supera-i-quaranta-caratteri-abcdef', 'ciao']) {
    await shell.evaluate((x) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text: x } }), t);
  }
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px"><input id="c" style="width:320px"></body></html>`);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  await apriCronologia(app, page, '#c');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/589-8-cronologia.png' });
});
