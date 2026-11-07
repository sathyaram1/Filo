import { test, expect } from '../../fixtures/electron.mjs';

test('debug riquadro', async ({ app, shell, openTab, testServer }) => {
  const sorgenteUrl = testServer.html('<title>Ricetta del pane</title><p>farina');
  await openTab(sorgenteUrl);
  const sorgente = (await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs)).find((t) => t.url === sorgenteUrl).id;
  const dentro = testServer.html('<title>commenti</title><textarea id="t" style="width:300px;height:80px">Commento:</textarea>', { pubblico: true });
  const pagina = await openTab(testServer.html(`<title>Blog</title><p>articolo</p><iframe src="${dentro}" style="margin:40px;width:400px;height:150px"></iframe>`));
  await pagina.waitForTimeout(1500);
  const frame = pagina.frames().find((f) => f.url() === dentro);
  pagina.on('console', (m) => { if (m.text().includes('[dbg]') || m.text().includes('Filo')) console.log('CONSOLE', m.text()); });
  await app.evaluate(() => {
    const M = process.mainModule.require(require('path').join(process.cwd(), 'src/main/schedaTrascinata.js'));
    globalThis.__log = [];
    const orig = M.nelRiquadro;
    M.nelRiquadro = (...a) => { const r = orig(...a); globalThis.__log.push({ d: a[3], r, figli: (a[2]?.frames || []).map((f) => f.url) }); return r; };
  }).catch((e) => console.log('patch', String(e).slice(0, 200)));
  const r = await frame.locator('#t').evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.left + 20, y: b.top + 20 }; });
  const off = await pagina.locator('iframe').evaluate((f) => { const b = f.getBoundingClientRect(); return { x: b.left + f.clientLeft, y: b.top + f.clientTop }; });
  const v = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const tm = w._filoTabs; const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { b: t.view.getBounds(), zs: w.webContents.getZoomFactor() || 1 };
  });
  const verso = { x: (v.b.x + r.x + off.x) / v.zs, y: (v.b.y + r.y + off.y) / v.zs };
  const da = await shell.evaluate((i) => { const b = document.querySelector(`.tab[data-id="${i}"]`).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sorgente);
  await shell.mouse.move(da.x, da.y);
  await shell.mouse.down();
  await shell.mouse.move(da.x + 8, da.y, { steps: 2 });
  await shell.mouse.move(verso.x, verso.y, { steps: 8 });
  await shell.mouse.up();
  await pagina.waitForTimeout(1000);
  console.log('log', JSON.stringify(await app.evaluate(() => globalThis.__log)));
  console.log('valore', await frame.locator('#t').inputValue());
  expect(1).toBe(2);
  console.log('top', await pagina.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.tagName; }, [r.x + off.x, r.y + off.y]));
});
