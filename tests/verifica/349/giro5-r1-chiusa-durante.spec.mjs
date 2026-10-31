// Verifica #349, giro 5: una scheda che l'utente chiude da sé mentre la pulizia della riapertura aspetta il modello
// non è una scheda chiusa dalla pulizia: l'avviso non la conta e «Riapri» non la riporta.
import { test, expect } from '../../fixtures/electron.mjs';

const pagina = (titolo, colore) => `<!doctype html><html><head><title>${titolo}</title>`
  + `<meta name="theme-color" content="${colore}"></head><body><h1>${titolo}</h1></body></html>`;

test.use({ hostInPiu: ['blu.test', 'verde.test', 'rosso.test'] });

test('r1 la scheda chiusa a mano durante la pulizia della riapertura non entra nel conto né nel «Riapri»', async ({ app, shell, testServer }) => {
  const su = (host, html) => testServer.html(html).replace('127.0.0.1', host);
  const titoli = async () => (await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs
    .map((t) => ({ id: t.id, url: t.url || '', title: t.title }))))
    .filter((t) => /\.test:/.test(t.url));
  await app.evaluate(async ({ BrowserWindow }, urls) => {
    await globalThis.SN_STORAGE.updateSettings({ autoArchive: { enabled: true, onClose: true, onIdle: false, idleHours: 6 } });
    globalThis.__decide = 0;
    // Un modello deciso che archivia tutto quello che riceve, col tempo di una risposta vera.
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => {
      globalThis.__decide += 1;
      await new Promise((r) => setTimeout(r, 4000));
      return { decisions: tabs.map((_, i) => ({ i, action: 'archive', reason: 'test' })) };
    };
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    globalThis.__toast = [];
    const wc = tm.win.webContents;
    const send = wc.send.bind(wc);
    wc.send = (canale, ...resto) => { if (canale === 'shell:toast') globalThis.__toast.push(resto[0] && resto[0].text); return send(canale, ...resto); };
    await globalThis.SN_STORAGE.setRaw(tm._sessionKey(), { tabs: urls, colors: ['rgb(40, 80, 200)', 'rgb(40, 200, 80)', 'rgb(200, 40, 40)'], activeIndex: 0 });
    await tm.restoreSession();
  }, [su('blu.test', pagina('Blu', 'rgb(40,80,200)')), su('verde.test', pagina('Verde', 'rgb(40,200,80)')), su('rosso.test', pagina('Rosso', 'rgb(200,40,40)'))]);

  await expect.poll(() => app.evaluate(() => globalThis.__decide), { timeout: 40_000 }).toBe(1);
  // L'utente chiude da sé la scheda Verde mentre il modello pensa.
  const verde = (await titoli()).find((t) => /verde\.test/.test(t.url));
  await shell.evaluate((id) => window.filoShell.tabs.close(id), verde.id);
  await expect.poll(async () => (await titoli()).map((t) => t.title)).not.toContain('Verde');

  // La pulizia ha chiuso solo Rosso: Blu è quella in vista, Verde l'ha chiusa l'utente.
  await expect.poll(async () => (await app.evaluate(() => globalThis.__toast)).length, { timeout: 20_000 }).toBeGreaterThan(0);
  expect.soft(await app.evaluate(() => globalThis.__toast), 'l’avviso conta anche la scheda chiusa dall’utente')
    .toContain('Schede riordinate, 1 chiusa. La ritrovi nel filo della home');

  const tm = await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return t._ultimaPulizia ? t._ultimaPulizia.id : null;
  });
  await app.evaluate(async ({ BrowserWindow }, id) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    if (t._ultimaPulizia && t._ultimaPulizia.id === id) await t.riapriPulizia(id);
  }, tm);
  // «Riapri» riporta Rosso; Verde l'utente l'aveva chiusa e non deve tornare.
  await expect.poll(async () => (await titoli()).map((t) => new URL(t.url).hostname), { timeout: 15_000 }).toContain('rosso.test');
  await new Promise((r) => setTimeout(r, 1500));
  expect((await titoli()).map((t) => new URL(t.url).hostname), '«Riapri» ha riportato la scheda che l’utente aveva chiuso da sé').not.toContain('verde.test');
});

test('r1 la scheda ripresa dall’utente mentre il modello decide non viene chiusa dalla pulizia della sessione di prima', async ({ app, shell, testServer }) => {
  const su = (host, html) => testServer.html(html).replace('127.0.0.1', host);
  const schede = async () => (await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs
    .map((t) => ({ id: t.id, url: t.url || '' })))).filter((t) => /\.test:/.test(t.url));
  await app.evaluate(async ({ BrowserWindow }, urls) => {
    await globalThis.SN_STORAGE.updateSettings({ autoArchive: { enabled: true, onClose: true, onIdle: false, idleHours: 6 } });
    globalThis.__decide = 0;
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => {
      globalThis.__decide += 1;
      await new Promise((r) => setTimeout(r, 4000));
      return { decisions: tabs.map((_, i) => ({ i, action: 'archive', reason: 'test' })) };
    };
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    await globalThis.SN_STORAGE.setRaw(tm._sessionKey(), { tabs: urls, colors: ['rgb(40, 80, 200)', 'rgb(40, 200, 80)', 'rgb(200, 40, 40)'], activeIndex: 0 });
    await tm.restoreSession();
  }, [su('blu.test', pagina('Blu', 'rgb(40,80,200)')), su('verde.test', pagina('Verde', 'rgb(40,200,80)')), su('rosso.test', pagina('Rosso', 'rgb(200,40,40)'))]);

  await expect.poll(() => app.evaluate(() => globalThis.__decide), { timeout: 40_000 }).toBe(1);
  // Mentre il modello pensa l'utente passa a Rosso, la guarda, e torna a Blu.
  const prima = await schede();
  const rosso = prima.find((t) => /rosso\.test/.test(t.url));
  const blu = prima.find((t) => /blu\.test/.test(t.url));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), rosso.id);
  await new Promise((r) => setTimeout(r, 800));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), blu.id);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return !tm._triageRunning;
  }), { timeout: 20_000 }).toBe(true);
  const dopo = (await schede()).map((t) => new URL(t.url).hostname);
  expect(dopo, 'la scheda appena ripresa dall’utente è stata chiusa come sessione di prima').toContain('rosso.test');
});
