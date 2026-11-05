// Verifica #2191, giro 1: invito su finestra rinata (Crediti davanti) e sessione non riscritta da una finestra chiusa.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, aspettaFinestra } from '../../fixtures/electron.mjs';

const stato = (app, accesso = '') => app.evaluate(({ BrowserWindow }, base) => {
  const vive = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const normale = vive.find((w) => w._filoTabs && !w._filoIncognito);
  const url = (t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } };
  return {
    accesso: base ? vive.filter((w) => !w._filoTabs && w.webContents.getURL().startsWith(base)).length : 0,
    normale: normale ? {
      schede: normale._filoTabs.tabs.map(url),
      davanti: url(normale._filoTabs.tabs.find((t) => t.id === normale._filoTabs.activeId) || {}),
      ripristino: !normale._filoTabs._sessioneDaLeggere,
    } : null,
    errori: globalThis.__errori2191 || [],
  };
}, accesso);

const sessioneSalvata = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, null);
  return (s && s.tabs) || [];
});

async function filoSenzaFinestra(app, shell, openTab, testServer, quante = 2) {
  await app.evaluate(() => {
    globalThis.__errori2191 = [];
    process.on('uncaughtException', (e) => globalThis.__errori2191.push(String((e && e.stack) || e)));
  });
  const accesso = `${testServer.html('<title>Accedi</title><h1>Passkey</h1>')}?client_id=1&redirect_uri=x`;
  const salvate = [];
  for (let i = 0; i < quante; i++) {
    const p = await testServer.openReady(openTab, `<title>Pagina ${i}</title><h1>Pagina ${i}</h1>`);
    salvate.push(p.url());
  }
  const negozio = `<title>Negozio</title><button id="b" style="width:220px;height:60px"
    onclick="window.open(${JSON.stringify(accesso).replace(/"/g, '&quot;')},'login','width=420,height=520')">Accedi</button>`;
  const page = await testServer.openReady(openTab, negozio);
  salvate.push(page.url());
  await page.click('#b');
  const base = accesso.split('?')[0];
  await expect.poll(async () => (await stato(app, base)).accesso, { timeout: 10000 }).toBe(1);
  await expect.poll(() => sessioneSalvata(app), { timeout: 10000 }).toEqual(expect.arrayContaining(salvate));
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(async () => (await stato(app, base)).normale, { timeout: 10000 }).toBeNull();
  return { base, salvate };
}

async function chiudiRinata(app, base) {
  const barra = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la barra della finestra rinata non c\'è');
  await barra.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(async () => (await stato(app, base)).normale, { timeout: 10000 }).toBeNull();
}

test('invito da fuori a finestra chiusa: Crediti è la scheda davanti, e le schede salvate tornano (Windows/Linux e Mac)', async ({ app, shell, openTab, testServer }) => {
  const { base, salvate } = await filoSenzaFinestra(app, shell, openTab, testServer);
  for (const via of ['second-instance', 'open-url']) {
    if (via === 'second-instance') await app.evaluate(({ app: a }) => { a.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd()); });
    else await app.evaluate(({ app: a }) => { a.emit('open-url', { preventDefault() {} }, 'filo://invito/ABCD'); });
    await expect.poll(async () => (await stato(app, base)).normale?.davanti || '', { message: `${via}: Crediti non è davanti`, timeout: 15000 })
      .toMatch(/^filo:\/\/credits\//);
    // Resta davanti anche a coda della riapertura finita.
    await new Promise((r) => setTimeout(r, 2500));
    const s = await stato(app, base);
    expect(s.normale.davanti, `${via}: Crediti è finita dietro dopo la riapertura`).toMatch(/^filo:\/\/credits\//);
    expect(s.normale.schede, `${via}: le schede salvate non sono tornate`).toEqual(expect.arrayContaining(salvate));
    expect(s.normale.schede.filter((u) => u.startsWith('filo://credits/')).length, `${via}: Crediti doppia`).toBe(1);
    expect(s.errori).toEqual([]);
    await chiudiRinata(app, base);
  }
});

test('due inviti di fila a finestra chiusa: una finestra sola, Crediti davanti', async ({ app, shell, openTab, testServer }) => {
  const { base, salvate } = await filoSenzaFinestra(app, shell, openTab, testServer);
  await app.evaluate(({ app: a }) => {
    a.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd());
    a.emit('open-url', { preventDefault() {} }, 'filo://invito/EFGH');
  });
  await expect.poll(async () => (await stato(app, base)).normale?.davanti || '', { timeout: 15000 }).toMatch(/^filo:\/\/credits\//);
  await new Promise((r) => setTimeout(r, 2000));
  const n = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w._filoTabs && !w._filoIncognito).length);
  expect(n).toBe(1);
  const s = await stato(app, base);
  expect(s.normale.davanti).toMatch(/^filo:\/\/credits\//);
  expect(s.normale.schede).toEqual(expect.arrayContaining(salvate));
  expect(s.errori).toEqual([]);
});

test('finestra rinata chiusa subito dopo una scheda nuova: alla riapertura ci sono le salvate e la nuova, sei volte di fila', async ({ app, shell, openTab, testServer }) => {
  const { base, salvate } = await filoSenzaFinestra(app, shell, openTab, testServer);
  const nuove = [];
  for (let giro = 0; giro < 6; giro++) {
    await app.evaluate(({ app: a }) => { a.emit('activate', {}, true); });
    await expect.poll(async () => (await stato(app, base)).normale?.schede || [], { message: `giro ${giro}: schede salvate non tornate`, timeout: 15000 })
      .toEqual(expect.arrayContaining([...salvate, ...nuove]));
    const nuova = testServer.html(`<title>Nuova ${giro}</title>`);
    // Scheda nuova e chiusura a pochi ms: dentro il ritardo del salvataggio.
    await app.evaluate(({ BrowserWindow }, u) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
      w._filoTabs.openTab(u, { activate: true });
      setTimeout(() => w.close(), 30);
    }, nuova);
    nuove.push(nuova);
    await expect.poll(async () => (await stato(app, base)).normale, { timeout: 10000 }).toBeNull();
    await new Promise((r) => setTimeout(r, 1200));
    const salvata = await sessioneSalvata(app);
    expect(salvata, `giro ${giro}: la sessione scritta dopo la chiusura ha perso schede`).toEqual(expect.arrayContaining([...salvate, ...nuove]));
  }
  expect((await stato(app, base)).errori).toEqual([]);
});

test('finestra rinata chiusa subito dopo un cambio di scheda e una chiusura di scheda: la sessione resta quella a finestra chiusa', async ({ app, shell, openTab, testServer }) => {
  const { base, salvate } = await filoSenzaFinestra(app, shell, openTab, testServer, 3);
  await app.evaluate(({ app: a }) => { a.emit('activate', {}, true); });
  await expect.poll(async () => (await stato(app, base)).normale?.schede || [], { timeout: 15000 }).toEqual(expect.arrayContaining(salvate));
  const attese = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
    const tm = w._filoTabs;
    tm.activate(tm.tabs[0].id);
    tm.closeTab(tm.tabs[1].id);
    const atteso = tm.sessionState();
    w.close();
    return atteso;
  });
  await expect.poll(async () => (await stato(app, base)).normale, { timeout: 10000 }).toBeNull();
  await new Promise((r) => setTimeout(r, 1500));
  const s = await app.evaluate(async () => globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, null));
  expect(s.tabs).toEqual(attese.tabs);
  expect(s.activeIndex).toBe(attese.activeIndex);
  // Riaperta, torna la stessa scheda davanti.
  await app.evaluate(({ app: a }) => { a.emit('activate', {}, true); });
  await expect.poll(async () => (await stato(app, base)).normale?.davanti || '', { timeout: 15000 }).toBe(attese.tabs[attese.activeIndex]);
});

test('dopo la chiusura della finestra rinata nessuna scrittura delle schede diversa da quelle a finestra chiusa', async ({ app, shell, openTab, testServer }) => {
  const { base, salvate } = await filoSenzaFinestra(app, shell, openTab, testServer, 4);
  for (let giro = 0; giro < 4; giro++) {
    await app.evaluate(({ app: a }) => { a.emit('activate', {}, true); });
    await expect.poll(async () => (await stato(app, base)).normale?.schede || [], { timeout: 15000 }).toEqual(expect.arrayContaining(salvate));
    await new Promise((r) => setTimeout(r, 300 + giro * 300));
    const nuova = testServer.html(`<title>N${giro}</title>`);
    await app.evaluate(({ BrowserWindow }, u) => {
      const S = globalThis.SN_STORAGE;
      const key = globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS;
      if (!S.__spia2191) {
        const orig = S.setRaw.bind(S);
        S.__spia2191 = [];
        S.setRaw = (k, v) => { if (k === key) S.__spia2191.push({ t: Date.now(), tabs: v.tabs.slice(), dopo: !!globalThis.__chiusa2191 }); return orig(k, v); };
      }
      globalThis.__chiusa2191 = false;
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
      w.once('closed', () => { globalThis.__chiusa2191 = true; globalThis.__allaChiusura2191 = w._filoTabs.tabs.map((t) => t.url); });
      w._filoTabs.openTab(u, { activate: true });
      w.close();
    }, nuova);
    await expect.poll(async () => (await stato(app, base)).normale, { timeout: 10000 }).toBeNull();
    await new Promise((r) => setTimeout(r, 1500));
    const dopo = await app.evaluate(() => globalThis.SN_STORAGE.__spia2191.filter((s) => s.dopo));
    for (const s of dopo) expect(s.tabs, `giro ${giro}: una scrittura dopo la chiusura ha perso schede`).toEqual(expect.arrayContaining([...salvate, nuova]));
    salvate.push(nuova);
    await app.evaluate(() => { globalThis.SN_STORAGE.__spia2191.length = 0; });
  }
});

test('Mac: finestra chiusa, poi esci da Filo: sul disco restano le schede della finestra chiusa', async ({ app, shell, openTab, testServer }) => {
  const { base, salvate } = await filoSenzaFinestra(app, shell, openTab, testServer);
  await app.evaluate(({ app: a }) => { a.emit('activate', {}, true); });
  await expect.poll(async () => (await stato(app, base)).normale?.schede || [], { timeout: 15000 }).toEqual(expect.arrayContaining(salvate));
  const nuova = testServer.html('<title>Ultima</title>');
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
    w._filoTabs.openTab(u, { activate: true });
    w.close();
  }, nuova);
  await expect.poll(async () => (await stato(app, base)).normale, { timeout: 10000 }).toBeNull();
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const chiusa = app.waitForEvent('close', { timeout: 20000 });
  await app.evaluate(({ app: a }) => { setTimeout(() => a.quit(), 10); });
  await chiusa;
  const disco = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8')).sn_open_tabs;
  expect(disco.tabs).toEqual(expect.arrayContaining([...salvate, nuova]));
});
