// Verifica #2285 giro 1: con due schede dallo stesso indirizzo il punto sullo schermo è quello della scheda chiesta,
// e un rilascio col mouse vero nella casella della home davanti ci arriva.

import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import * as Gesti from '../../helpers/gestiVeri.mjs';

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);

async function cadeSu(app, page, punto, sel) {
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const tm = w._filoTabs;
    const vb = tm.tabs.find((x) => x.id === tm.activeId).view.getBounds();
    const cb = w.getContentBounds();
    return { x: cb.x + vb.x, y: cb.y + vb.y };
  });
  return page.evaluate(({ x, y, s }) => {
    const el = document.elementFromPoint(x, y);
    return Boolean(el && document.querySelector(s)?.contains(el));
  }, { x: punto.x - o.x, y: punto.y - o.y, s: sel });
}

test('due siti dallo stesso indirizzo: il punto cade nel campo di quello davanti', async ({ app, openTab, testServer }) => {
  const url = testServer.html('<title>Doppio</title><textarea id="t" style="margin:60px 40px;width:300px;height:80px"></textarea>');
  await openTab(url);
  const davanti = await openTab(url);
  await expect(davanti.locator('#t')).toBeVisible();
  const punto = await Gesti.sulloSchermo(app, davanti, davanti, '#t');
  expect(await cadeSu(app, davanti, punto, '#t')).toBe(true);
});

test.describe('col mouse vero', () => {
  test.skip(!Gesti.disponibili(), 'servono un display X e XTest');

  test('con due home aperte una scheda lasciata nella casella della home davanti diventa un gettone', async ({ app, shell, openTab, testServer }) => {
    const url = testServer.html('<title>Articolo sul vulcano</title><p>Etna</p>');
    await openTab(url);
    const sorgente = (await schede(shell)).find((t) => t.url === url).id;
    await home(app);
    const davanti = await openTab('filo://newtab/');
    await expect(davanti.locator('#input')).toBeVisible({ timeout: 8000 });
    await Gesti.finestraASchermo(app);
    const linguetta = await shell.evaluate((i) => {
      const r = document.querySelector(`.tab[data-id="${i}"]`).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, sorgente);
    const o = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
      const cb = w.getContentBounds();
      return { x: cb.x, y: cb.y };
    });
    const campo = await Gesti.sulloSchermo(app, davanti, davanti, '#input');
    Gesti.trascina({ x: Math.round(o.x + linguetta.x), y: Math.round(o.y + linguetta.y) }, campo);
    await expect(davanti.locator('.sn-gettoni-fondo .sn-gettone')).toContainText('Articolo sul vulcano', { timeout: 5000 });
  });
});
