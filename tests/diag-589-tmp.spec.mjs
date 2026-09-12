import { test, expect } from '/home/user/Filo/tests/fixtures/electron.mjs';

test('diag blocklist', async ({ app, shell, openTab, testServer }) => {
  const url = testServer.html('<h1>pagina</h1>').replace('127.0.0.1', 'blocked.test');
  const web = await openTab(url);
  await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { blocklist: ['blocked.test'] } }));
  const dopo = await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' }));
  console.log('BLOCKLIST SALVATA:', JSON.stringify(dopo?.settings?.blocklist));
  console.log('URL PAGINA:', web.url());
  const r = await web.evaluate(async () => {
    document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await new Promise((x) => setTimeout(x, 600));
    return { host: location.hostname, menu: !!document.querySelector('.sn-menu') };
  });
  console.log('PAGINA:', JSON.stringify(r));
});
