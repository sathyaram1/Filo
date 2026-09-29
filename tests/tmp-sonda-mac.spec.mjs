import { test, expect } from './fixtures/electron.mjs';

test('sonda: si può far credere alla pagina di essere su Mac?', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await expect(page.locator('#doc')).toBeVisible();
  const r = await page.evaluate(() => {
    const d = Object.getOwnPropertyDescriptor(window, 'filo');
    let ok = false;
    try {
      const vero = window.filo;
      Object.defineProperty(window, 'filo', { value: new Proxy(vero, { get: (t, k) => (k === 'sistema' ? 'darwin' : t[k]) }), configurable: true });
      ok = window.SN_TASTI.suMac();
    } catch (e) { ok = 'errore ' + e.message; }
    return { conf: d && d.configurable, writable: d && d.writable, ok, proc: typeof process };
  });
  console.log(JSON.stringify(r));
});
