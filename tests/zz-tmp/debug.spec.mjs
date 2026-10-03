import { test, expect } from '../fixtures/electron.mjs';

function nelMondo(app, page, code) {
  return app.evaluate(async ({ BrowserWindow }, { u, code }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const tab = (win._filoTabs?.tabs || []).find((t) => { try { return t.view?.webContents?.getURL() === u; } catch (_) { return false; } });
      if (tab) return tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }]);
    }
    return null;
  }, { u: page.url(), code });
}

test('debug', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), 'segreto');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px"><input id="campo" style="width:320px"></body></html>`);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu-paste-main')).toBeVisible();
  for (let i = 0; i < 6; i++) {
    console.log('T', i, JSON.stringify(await nelMondo(app, page, `(() => {
      const V = globalThis.SN_VISTO; const b = document.querySelector('.sn-menu-paste-main');
      const ospite = [...document.documentElement.children].map((n) => n.tagName + '.' + (n.className||'') + (n.getAttribute('data-sn-ui') ? '[ui]' : '')).join(' ');
      const d = globalThis.__vd; return { risp: JSON.stringify(d.risposteViste.slice(0,3)), dbg: [...d.voci.values()].map((r) => r.voce.className + ' ' + r.dbg.slice(0,4).map(Math.round).join(',') + ' disp=' + r.sonda.style.display), sonde: [...d.voci.values()].slice(0,2).map((r) => r.sonda.style.cssText + ' conn=' + r.sonda.isConnected + ' rn=' + (r.sonda.getRootNode() === document)), attivo: V && V.ATTIVO, stato: V && V._test.stato(b), pronta: V && V._test.pronta(b), figli: ospite, menuZ: getComputedStyle(document.querySelector('.sn-menu')).zIndex };
    })()`)));
    await page.waitForTimeout(150);
  }
  await page.locator('.sn-menu-paste-main').click();
  await page.waitForTimeout(500);
  console.log('VAL', await page.locator('#campo').inputValue(), await page.locator('.sn-toast').allTextContents());
});
