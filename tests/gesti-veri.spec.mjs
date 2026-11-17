// L'aiuto dei gesti veri (tests/helpers/gestiVeri.mjs): il punto sullo schermo che calcola deve cadere sul nodo chiesto
// anche dove l'indirizzo non basta a dire quale scheda è (#2285). Gira anche senza XTest: qui non si muove il mouse.

import { test, expect } from './fixtures/electron.mjs';
import { home } from './helpers/chatFinta.mjs';
import * as Gesti from './helpers/gestiVeri.mjs';

// Il punto dello schermo riportato nei px della scheda davanti, e se lì sotto c'è il nodo `sel`.
async function cadeSu(app, page, punto, sel) {
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const tm = w._filoTabs;
    const cb = w.getContentBounds();
    const vb = tm.tabs.find((x) => x.id === tm.activeId).view.getBounds();
    return { x: cb.x + vb.x, y: cb.y + vb.y };
  });
  return page.evaluate(({ x, y, s }) => {
    const el = document.elementFromPoint(x, y);
    return Boolean(el && document.querySelector(s)?.contains(el));
  }, { x: punto.x - o.x, y: punto.y - o.y, s: sel });
}

test('#2285 con due home aperte il punto cade nella casella della home davanti', async ({ app, openTab }) => {
  const dietro = await home(app);
  const davanti = await openTab('filo://newtab/');
  expect(davanti).not.toBe(dietro);
  await expect(davanti.locator('#input')).toBeVisible({ timeout: 8000 });
  const punto = await Gesti.sulloSchermo(app, davanti, davanti, '#input');
  expect(await cadeSu(app, davanti, punto, '#input')).toBe(true);
});

test('#2285 la home rimasta dietro non dà un punto sbagliato: lo dice', async ({ app, openTab }) => {
  const dietro = await home(app);
  await openTab('filo://newtab/');
  await expect(Gesti.sulloSchermo(app, dietro, dietro, '#input')).rejects.toThrow('non è a schermo');
});
