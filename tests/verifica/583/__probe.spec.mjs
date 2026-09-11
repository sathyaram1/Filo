import { test } from './../../fixtures/electron.mjs';
test('probe', async ({ app, openTab }) => {
  const shape = await app.evaluate(async ({ ipcMain }) => {
    const mappa = ipcMain._invokeHandlers;
    const vero = mappa.get('filo:message');
    globalThis.__catturato = null;
    mappa.set('filo:message', async (e, ...args) => {
      const res = await vero(e, ...args);
      if (args[0] && args[0].type === 'auth_status') {
        globalThis.__catturato = { tipo: typeof res, chiavi: res && typeof res === 'object' ? Object.keys(res) : String(res) };
      }
      return res;
    });
    return 'installato';
  });
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  const r = await page.evaluate(() => window.filo.message({ type: 'auth_status' }));
  const cat = await app.evaluate(async () => globalThis.__catturato);
  console.log('PROBE', JSON.stringify({ shape, r, cat }));
});
