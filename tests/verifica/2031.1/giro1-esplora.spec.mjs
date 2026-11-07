// Verifica #2031.1, giro 1: invito da fuori a finestra principale chiusa, porte non coperte dalle prove esistenti.

import { test, expect } from '../../fixtures/electron.mjs';

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const vive = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const normali = vive.filter((w) => w._filoTabs && !w._filoIncognito);
  const normale = normali[0];
  const url = (t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } };
  return {
    quante: normali.length,
    normale: normale ? {
      schede: normale._filoTabs.tabs.map(url),
      davanti: url(normale._filoTabs.tabs.find((t) => t.id === normale._filoTabs.activeId) || {}),
    } : null,
  };
});

const sessioneSalvata = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, null);
  return (s && s.tabs) || [];
});

async function preparaSchede(app, openTab, testServer, quante = 3) {
  const salvate = [];
  for (let i = 0; i < quante; i++) {
    const p = await testServer.openReady(openTab, `<title>Pagina ${i}</title><h1>Pagina ${i}</h1>`);
    salvate.push(p.url());
  }
  await expect.poll(() => sessioneSalvata(app), { timeout: 10000 }).toEqual(expect.arrayContaining(salvate));
  return salvate;
}

// Fuori da Mac Filo resta acceso a principale chiusa solo con un'altra finestra viva: qui una vuota fa da Mac.
async function chiudiPrincipale(app) {
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__tieniVivo = new BrowserWindow({ show: false });
    BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).close();
  });
  await expect.poll(async () => (await stato(app)).normale, { timeout: 10000 }).toBeNull();
}

async function attendiCreditiDavanti(app, salvate, msg) {
  await expect.poll(async () => (await stato(app)).normale?.davanti || '', { message: `${msg}: Crediti non è davanti`, timeout: 15000 })
    .toMatch(/^filo:\/\/credits\//);
  await new Promise((r) => setTimeout(r, 3000));
  const s = await stato(app);
  expect(s.quante, `${msg}: finestre normali`).toBe(1);
  expect(s.normale.davanti, `${msg}: Crediti è finita dietro`).toMatch(/^filo:\/\/credits\//);
  expect(s.normale.schede, `${msg}: schede salvate non tornate`).toEqual(expect.arrayContaining(salvate));
  expect(s.normale.schede.filter((u) => u.startsWith('filo://credits/')).length, `${msg}: Crediti doppia`).toBe(1);
}

test('Windows/Linux: con la sola incognito aperta, invito da fuori: Crediti davanti nella principale rinata', async ({ app, shell, openTab, testServer }) => {
  const salvate = await preparaSchede(app, openTab, testServer);
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w._filoIncognito).length), { timeout: 10000 }).toBe(1);
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(async () => (await stato(app)).normale, { timeout: 10000 }).toBeNull();
  await app.evaluate(({ app: a }) => { a.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd()); });
  await attendiCreditiDavanti(app, salvate, 'incognito');
});

test('Mac: icona del Dock e subito dopo il collegamento d\'invito, a finestra in riapertura: Crediti davanti', async ({ app, shell, openTab, testServer }) => {
  const salvate = await preparaSchede(app, openTab, testServer);
  await chiudiPrincipale(app);
  await app.evaluate(({ app: a }) => {
    a.emit('activate', {}, false);
    setTimeout(() => a.emit('open-url', { preventDefault() {} }, 'filo://invito/ABCD'), 20);
  });
  await attendiCreditiDavanti(app, salvate, 'activate+open-url');
});

test('Crediti era già fra le schede salvate, non davanti: l\'invito da fuori la porta davanti senza doppione', async ({ app, openTab, testServer }) => {
  const shellUrl = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.openTab('filo://credits/credits.html', { activate: true });
    return true;
  });
  expect(shellUrl).toBe(true);
  const salvate = await preparaSchede(app, openTab, testServer, 2);
  await expect.poll(() => sessioneSalvata(app), { timeout: 10000 }).toEqual(expect.arrayContaining(['filo://credits/credits.html']));
  await chiudiPrincipale(app);
  await app.evaluate(({ app: a }) => { a.emit('open-url', { preventDefault() {} }, 'filo://invito/ABCD'); });
  await attendiCreditiDavanti(app, salvate, 'crediti già salvata');
});
