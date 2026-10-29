// Verifica #1476 giro 8: porte nuove della riapertura (Ctrl/Cmd+Shift+T) e di Ctrl/Cmd+L.
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function info(app, incognito = false) {
  return app.evaluate(({ BrowserWindow }, incognito) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === incognito);
    const t = w._filoTabs;
    const attiva = t.tabs.find((x) => x.id === t.activeId) || null;
    return { urls: t.tabs.map((x) => x.url), count: t.tabs.length, activeId: t.activeId, activeUrl: attiva ? attiva.url : null };
  }, incognito);
}

function premi(app, keyCode, modifiers, incognito = false) {
  return app.evaluate(({ BrowserWindow }, { keyCode, modifiers, incognito }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === incognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  }, { keyCode, modifiers, incognito });
}

function apriEAspetta(app, url, incognito = false) {
  return app.evaluate(async ({ BrowserWindow }, { url, incognito }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === incognito);
    const tm = w._filoTabs;
    const id = tm.openTab(url);
    const t0 = Date.now();
    while (Date.now() - t0 < 10_000) {
      const tab = tm.tabs.find((t) => t.id === id);
      if (tab && tab.url === url && !tab.loading) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return id;
  }, { url, incognito });
}

test('tre chiusure, tre Ctrl+Shift+T di fila senza aspettare: la fila torna com\'era', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const [a, b, c] = ['A', 'B', 'C'].map((n) => testServer.html(`<title>${n}</title><h1>${n}</h1>`));
  await apriEAspetta(app, a);
  await apriEAspetta(app, b);
  await apriEAspetta(app, c);
  const prima = await info(app);
  for (const u of [b, a, c]) {
    await app.evaluate(({ BrowserWindow }, u) => {
      const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
      tm.activate(tm.tabs.find((t) => t.url === u).id);
    }, u);
    await premi(app, 'W', ['control']);
    await expect.poll(() => info(app).then((i) => i.urls.includes(u)), { timeout: 8_000 }).toBe(false);
  }
  await premi(app, 'T', ['control', 'shift']);
  await premi(app, 'T', ['control', 'shift']);
  await premi(app, 'T', ['control', 'shift']);
  await expect.poll(() => info(app).then((i) => i.urls), { timeout: 10_000 }).toEqual(prima.urls);
});

test('la voce della barra dei menu riapre e si conta', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const a = testServer.html('<title>A</title><h1>A</h1>');
  await apriEAspetta(app, a);
  await premi(app, 'W', ['control']);
  await expect.poll(() => info(app).then((i) => i.urls.includes(a)), { timeout: 8_000 }).toBe(false);
  const trovata = await app.evaluate(({ Menu }) => {
    const barra = Menu.getApplicationMenu();
    if (!barra) return 'nessuna barra';
    const cerca = (voci) => {
      for (const v of voci) {
        if (v.label === 'Riapri scheda chiusa') return v;
        if (v.submenu) { const d = cerca(v.submenu.items); if (d) return d; }
      }
      return null;
    };
    const v = cerca(barra.items);
    if (!v) return 'nessuna voce';
    v.click();
    return 'ok';
  });
  expect(trovata).toBe('ok');
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(a);
});

test('scorrimento e zoom tornano con la scheda', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const lunga = testServer.html('<title>Lunga</title>' + Array.from({ length: 400 }, (_, i) => `<p>riga ${i}</p>`).join(''));
  const id = await apriEAspetta(app, lunga);
  const pagina = await paginaDellaScheda(app, id);
  await pagina.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    tm.tabs.find((t) => t.id === tm.activeId).view.webContents.setZoomLevel(2);
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return tm.tabs.find((t) => t.id === tm.activeId).scrollPct;
  }), { timeout: 8_000 }).toBeGreaterThan(20);
  await premi(app, 'W', ['control']);
  await expect.poll(() => info(app).then((i) => i.urls.includes(lunga)), { timeout: 8_000 }).toBe(false);
  await premi(app, 'T', ['control', 'shift']);
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(lunga);
  const nuova = (await info(app)).activeId;
  let p2 = null;
  await expect.poll(async () => Boolean(p2 = await paginaDellaScheda(app, nuova)), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => p2.evaluate(() => Math.round(100 * window.scrollY / (document.documentElement.scrollHeight - innerHeight))), { timeout: 10_000 }).toBeGreaterThan(20);
  expect(await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return tm.tabs.find((t) => t.id === tm.activeId).view.webContents.getZoomLevel();
  })).toBe(2);
});

test('Ctrl+Shift+T mentre si scrive nella home: la scheda torna e nel campo non entra niente', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const a = testServer.html('<title>A</title><h1>A</h1>');
  await apriEAspetta(app, a);
  await premi(app, 'W', ['control']);
  await expect.poll(() => info(app).then((i) => i.urls.includes(a)), { timeout: 8_000 }).toBe(false);
  const { activeId } = await info(app);
  let home = null;
  await expect.poll(async () => Boolean(home = await paginaDellaScheda(app, activeId, (p) => p.url().startsWith('filo://newtab/'))), { timeout: 10_000 }).toBe(true);
  await home.locator('#input').fill('ciao');
  await home.locator('#input').focus();
  await premi(app, 'T', ['control', 'shift']);
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(a);
  expect(await home.locator('#input').inputValue()).toBe('ciao');
});

test('una scheda chiusa in incognito non torna nella finestra normale', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    !!BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)), { timeout: 15_000 }).toBe(true);
  const privata = testServer.html('<title>Privata</title><h1>p</h1>');
  await apriEAspetta(app, privata, true);
  await premi(app, 'W', ['control'], true);
  await expect.poll(() => info(app, true).then((i) => i.urls.includes(privata)), { timeout: 10_000 }).toBe(false);
  const prima = (await info(app)).count;
  await premi(app, 'T', ['control', 'shift']);
  await sleep(1500);
  expect((await info(app)).urls).not.toContain(privata);
  expect((await info(app)).count).toBe(prima);
});

test('chiusa dal pulsante della scheda nella barra, torna con Ctrl+Shift+T dalla barra', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const a = testServer.html('<title>A</title><h1>A</h1>');
  const id = await apriEAspetta(app, a);
  await shell.evaluate((id) => window.filoShell.tabs.close(id), id);
  await expect.poll(() => info(app).then((i) => i.urls.includes(a)), { timeout: 8_000 }).toBe(false);
  await shell.keyboard.press('Control+Shift+T');
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(a);
});
