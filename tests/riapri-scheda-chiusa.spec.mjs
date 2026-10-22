// #1476: Ctrl/Cmd+Shift+T riapre l'ultima scheda chiusa, come nei browser, da una pagina e dalla barra; ripetuto va
// a ritroso, finita la sessione scende nell'archivio, e senza niente da riaprire lo dice. Ctrl+L porta il cursore
// nel campo della home dove si scrive l'indirizzo. Logica della pila: tests/unit/schedeChiuse.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { paginaDellaScheda } from './helpers/schede.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function info(app, incognito = false) {
  return app.evaluate(({ BrowserWindow }, incognito) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === incognito);
    const t = w._filoTabs;
    const attiva = t.tabs.find((x) => x.id === t.activeId) || null;
    return { urls: t.tabs.map((x) => x.url), count: t.tabs.length, activeId: t.activeId, activeUrl: attiva ? attiva.url : null };
  }, incognito);
}

// Il tasto vero passa da qui: before-input-event della scheda attiva, anche con un campo della pagina a fuoco.
function premi(app, keyCode, modifiers, incognito = false) {
  return app.evaluate(({ BrowserWindow }, { keyCode, modifiers, incognito }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === incognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  }, { keyCode, modifiers, incognito });
}

const chiudi = (app) => premi(app, 'W', ['control']);
const riapri = (app, incognito) => premi(app, 'T', ['control', 'shift'], incognito);

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

test('Ctrl+Shift+T da una pagina riapre la scheda chiusa nel suo posto, con Indietro', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<title>A</title><h1 id="ok">A</h1>');
  const b1 = testServer.html('<title>B1</title><h1 id="ok">B1</h1>');
  const b2 = testServer.html('<title>B2</title><h1 id="ok">B2</h1>');
  const c = testServer.html('<title>C</title><h1 id="ok">C</h1>');
  await openTab(a);
  const pb = await openTab(b1);
  await pb.evaluate((u) => { location.href = u; }, b2);
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(b2);
  await openTab(c);
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    tm.activate(tm.tabs.find((t) => t.url === u).id);
  }, b2);
  const prima = await info(app);
  const posto = prima.urls.indexOf(b2);
  expect(posto).toBeGreaterThan(0);
  expect(posto).toBeLessThan(prima.count - 1);

  await chiudi(app);
  await expect.poll(() => info(app).then((i) => i.urls.includes(b2)), { timeout: 10_000 }).toBe(false);

  await riapri(app);
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(b2);
  const dopo = await info(app);
  expect(dopo.count).toBe(prima.count);
  expect(dopo.urls.indexOf(b2)).toBe(posto);
  const pagina = await paginaDellaScheda(app, dopo.activeId);
  await expect(pagina.locator('#ok')).toHaveText('B2');

  // La cronologia è tornata con lei: Indietro porta alla pagina di prima.
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    tm.goBack(tm.activeId);
  });
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(b1);
});

test('ripetuto va a ritroso, pagine di Filo comprese, poi scende nell\'archivio e alla fine lo dice', async ({ app, shell, avvisi, testServer }) => {
  // Due schede chiuse in una sessione di Filo precedente: stanno solo nell'archivio.
  const vecchia = testServer.html('<title>Vecchia</title><h1>v</h1>');
  const vecchissima = testServer.html('<title>Vecchissima</title><h1>vv</h1>');
  await app.evaluate(async (_e, { vecchia, vecchissima }) => {
    await globalThis.SN_ARCHIVED_TABS.archive({ url: vecchissima, title: 'Vecchissima', closedAt: '2026-10-01T10:00:00.000Z' });
    await globalThis.SN_ARCHIVED_TABS.archive({ url: vecchia, title: 'Vecchia', closedAt: '2026-10-02T10:00:00.000Z' });
  }, { vecchia, vecchissima });

  const sito = testServer.html('<title>Sito</title><h1>s</h1>');
  const interna = 'filo://history/history.html';
  await apriEAspetta(app, sito);
  await chiudi(app);
  await apriEAspetta(app, interna);
  await chiudi(app);
  await expect.poll(() => info(app).then((i) => i.urls.some((u) => u === sito || u.startsWith('filo://history'))), { timeout: 10_000 }).toBe(false);
  const base = (await info(app)).count;

  await riapri(app);
  await expect.poll(() => info(app).then((i) => String(i.activeUrl)), { timeout: 10_000 }).toContain('filo://history/');
  // Dalla pagina di Filo appena riaperta il tasto vale lo stesso.
  await riapri(app);
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(sito);
  // Finita la sessione, l'archivio: prima la più recente. Dalla barra a fuoco, stavolta.
  await shell.keyboard.press('Control+Shift+T');
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(vecchia);
  await riapri(app);
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(vecchissima);
  expect((await info(app)).count).toBe(base + 4);

  // Niente più da riaprire: nessuna scheda nuova, e un avviso lo dice.
  await riapri(app);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'Nessuna scheda chiusa da riaprire' })).toHaveCount(1, { timeout: 10_000 });
  await sleep(500);
  expect((await info(app)).count).toBe(base + 4);
});

test('una scheda cancellata dall\'archivio non torna con Ctrl+Shift+T', async ({ app, testServer }) => {
  const via = testServer.html('<title>Da dimenticare</title><h1>x</h1>');
  const resta = testServer.html('<title>Resta</title><h1>r</h1>');
  await apriEAspetta(app, resta);
  await chiudi(app);
  await apriEAspetta(app, via);
  await chiudi(app);
  await expect.poll(() => app.evaluate(async (_e, u) =>
    (await globalThis.SN_ARCHIVED_TABS.list()).some((t) => t.url === u), via), { timeout: 8_000 }).toBe(true);
  await app.evaluate(async (_e, u) => {
    const ids = (await globalThis.SN_ARCHIVED_TABS.list()).filter((t) => t.url === u).map((t) => t.id);
    await globalThis.SN_ARCHIVED_TABS.removeMany(ids);
  }, via);

  await riapri(app);
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(resta);
  expect((await info(app)).urls).not.toContain(via);
});

test('in incognito riapre le schede chiuse in quella finestra, senza archivio', async ({ app, shell, testServer }) => {
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    !!BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)), { timeout: 15_000 }).toBe(true);
  const privata = testServer.html('<title>Privata</title><h1>p</h1>');
  await apriEAspetta(app, privata, true);
  await premi(app, 'W', ['control'], true);
  await expect.poll(() => info(app, true).then((i) => i.urls.includes(privata)), { timeout: 10_000 }).toBe(false);

  await riapri(app, true);
  await expect.poll(() => info(app, true).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(privata);
  // La finestra normale non la vede.
  expect((await info(app)).urls).not.toContain(privata);
});

// Il menu del tasto destro è una finestra a parte che si chiude da sola sul blur: si guarda l'esito, non il clic.
async function testoDelMenu(app, ago) {
  for (const w of app.windows()) {
    try {
      const t = await w.evaluate((n) => (document.body && document.body.innerText.includes(n) ? document.body.innerText : null), ago);
      if (t != null) return t;
    } catch (_) {}
  }
  return null;
}
function tastoDestroSullaScheda(shell) {
  return shell.evaluate(() => {
    const el = document.querySelector('.tab.active') || document.querySelector('.tab');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
  });
}

test('il tasto destro su una scheda ha «Riapri scheda chiusa» solo quando c\'è qualcosa da riaprire', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const sito = testServer.html('<title>Menu</title><h1 id="ok">m</h1>');
  await openTab(sito);
  let testo = null;
  await expect.poll(async () => {
    await tastoDestroSullaScheda(shell);
    await sleep(200);
    testo = await testoDelMenu(app, 'Duplica');
    return testo != null;
  }, { timeout: 15_000 }).toBe(true);
  expect(testo).not.toContain('Riapri scheda chiusa');
  await shell.keyboard.press('Escape');

  await chiudi(app);
  await expect.poll(() => info(app).then((i) => i.urls.includes(sito)), { timeout: 10_000 }).toBe(false);

  await expect.poll(async () => {
    if ((await info(app)).urls.includes(sito)) return true;
    if (!(await testoDelMenu(app, 'Riapri scheda chiusa'))) { await tastoDestroSullaScheda(shell); await sleep(200); }
    for (const w of app.windows()) {
      try {
        await w.evaluate(() => {
          const b = [...document.querySelectorAll('button.item')].find((x) => /Riapri scheda chiusa/.test(x.textContent));
          if (b) b.click();
        });
      } catch (_) {}
    }
    await sleep(200);
    return (await info(app)).urls.includes(sito);
  }, { timeout: 25_000, intervals: [200, 300, 500, 800, 1000] }).toBe(true);
  expect((await info(app)).activeUrl).toBe(sito);
});

test('Ctrl+L da una pagina porta alla home col cursore nel campo dove si scrive', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html('<title>SITO</title><input id="campo"><script>document.getElementById("campo").focus()</script>'));
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('campo');
  const { activeId } = await info(app);

  await premi(app, 'L', ['control']);
  await expect.poll(() => info(app).then((i) => String(i.activeUrl)), { timeout: 10_000 }).toContain('filo://newtab/');
  let home = null;
  await expect.poll(async () => Boolean(home = await paginaDellaScheda(app, activeId, (p) => p.url().startsWith('filo://newtab/'))), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => home.evaluate(() => document.activeElement && document.activeElement.id), { timeout: 10_000 }).toBe('input');

  // Quello che si scrive subito dopo finisce lì.
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    for (const ch of 'esempio.it') wc.sendInputEvent({ type: 'char', keyCode: ch });
  });
  await expect(home.locator('#input')).toHaveValue('esempio.it');
});
