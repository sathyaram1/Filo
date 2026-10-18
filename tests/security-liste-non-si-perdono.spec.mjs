// #590.2 — Sicurezza: un dominio scritto in una lista vale anche se subito dopo
// si cambia scheda o si chiude la pagina, senza aver cliccato altrove.
// Ctrl+W passa da sendInputEvent (la tastiera di Playwright non tocca il
// before-input-event del main, che è dove la scheda si chiude davvero).

import { test, expect } from './fixtures/electron.mjs';

const BLOCCATO = 'blocked.test'; // il fixture lo risolve sul server locale

const impostazioni = async (shell) => (await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' }))).settings;

async function apriSicurezza(shell, openTab) {
  // Le liste pubbliche scaricherebbero dalla rete: qui conta solo quella scritta a mano.
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: [] }, downloads: { confirmExecutables: true, trustedSites: [] } } },
  }));
  const page = await openTab('filo://security/security.html');
  await page.waitForSelector('#sec-siteblock-blacklist', { timeout: 8000 });
  await expect(page.locator('#sec-siteblock-lists')).not.toBeChecked();
  return page;
}

// Ctrl+W come arriva da una tastiera: prima il Ctrl da solo, poi la lettera.
async function ctrlW(app) {
  const premi = (tasti) => app.evaluate(({ BrowserWindow }, t) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tab = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    for (const e of t) tab.view.webContents.sendInputEvent(e);
  }, tasti);
  await premi([{ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] }]);
  await new Promise((r) => setTimeout(r, 60));
  await premi([{ type: 'keyDown', keyCode: 'W', modifiers: ['control'] }]);
}

const schedaSicurezzaAperta = (shell) => shell.evaluate(async () =>
  (await window.filoShell.tabs.snapshot()).tabs.some((t) => t.url.startsWith('filo://security')));

test('scritto un sito e passato subito a un\'altra scheda, il sito è bloccato', async ({ shell, openTab, testServer, avvisi }) => {
  const sicurezza = await apriSicurezza(shell, openTab);
  await sicurezza.locator('#sec-siteblock-blacklist').click();
  await sicurezza.keyboard.type(BLOCCATO);

  const target = testServer.html('<!doctype html><meta charset="utf-8"><h1>SITO</h1>').replace('127.0.0.1', BLOCCATO);
  const partenza = testServer.html(`<!doctype html><meta charset="utf-8"><a id="go" href="${target}">vai</a>`);
  const page = await openTab(partenza);
  await page.waitForSelector('#go', { timeout: 8000 });

  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 })
    .toEqual([BLOCCATO]);
  await page.evaluate(() => document.getElementById('go').click());
  await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' })).toHaveCount(1, { timeout: 6000 });
  await expect((await avvisi()).locator('.shell-notif', { hasText: 'Sito bloccato' })).toBeVisible({ timeout: 6000 });
  expect(page.url()).toBe(partenza);
});

test('Ctrl+W subito dopo aver scritto: la riga resta nella lista e si rivede riaprendo', async ({ app, shell, openTab }) => {
  const sicurezza = await apriSicurezza(shell, openTab);
  await sicurezza.locator('#sec-siteblock-blacklist').click();
  await sicurezza.keyboard.type(BLOCCATO);
  await ctrlW(app);

  await expect.poll(() => schedaSicurezzaAperta(shell), { timeout: 5000 }).toBe(false);
  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 })
    .toEqual([BLOCCATO]);

  const riaperta = await openTab('filo://security/security.html');
  await expect(riaperta.locator('#sec-siteblock-blacklist')).toHaveValue(BLOCCATO, { timeout: 8000 });
});

test('una riga cancellata e Ctrl+W subito dopo: il sito esce dalla lista', async ({ app, shell, openTab }) => {
  await shell.evaluate((d) => window.filoShell.message({ type: 'update_settings', settings: { security: { siteBlock: { blacklist: [d, 'resta.it'] } } } }), BLOCCATO);
  const sicurezza = await openTab('filo://security/security.html');
  const lista = sicurezza.locator('#sec-siteblock-blacklist');
  await expect(lista).toHaveValue(`${BLOCCATO}\nresta.it`, { timeout: 8000 });
  await lista.click();
  await sicurezza.keyboard.press('Control+Home');
  await sicurezza.keyboard.press('Shift+End');
  await sicurezza.keyboard.press('Delete');
  await ctrlW(app);

  await expect.poll(() => schedaSicurezzaAperta(shell), { timeout: 5000 }).toBe(false);
  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 })
    .toEqual(['resta.it']);
});

test('ricaricata la pagina subito dopo aver scritto, la riga c\'è ancora', async ({ shell, openTab }) => {
  const sicurezza = await apriSicurezza(shell, openTab);
  await sicurezza.locator('#sec-siteblock-blacklist').click();
  await sicurezza.keyboard.type(BLOCCATO);
  await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.reload(snap.tabs.find((t) => t.url.startsWith('filo://security')).id);
  });

  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 })
    .toEqual([BLOCCATO]);
  await expect(sicurezza.locator('#sec-siteblock-blacklist')).toHaveValue(BLOCCATO, { timeout: 8000 });
});

test('i siti fidati per i programmi non si perdono con Ctrl+W', async ({ app, shell, openTab }) => {
  const sicurezza = await apriSicurezza(shell, openTab);
  await sicurezza.locator('#sec-dl-trusted').click();
  await sicurezza.keyboard.type('https://www.Mozilla.org/it/');
  await ctrlW(app);

  await expect.poll(() => schedaSicurezzaAperta(shell), { timeout: 5000 }).toBe(false);
  await expect.poll(async () => (await impostazioni(shell)).security.downloads.trustedSites, { timeout: 4000 })
    .toEqual(['mozilla.org']);
});

test('una riga a metà non accende l\'avviso mentre si scrive; uscendo dal campo sì', async ({ shell, openTab }) => {
  const sicurezza = await apriSicurezza(shell, openTab);
  const lista = sicurezza.locator('#sec-siteblock-blacklist');
  const avviso = sicurezza.locator('#sec-siteblock-blacklist-error');
  await lista.click();
  await sicurezza.keyboard.type('esempio.it\nfaceb');

  // Dopo la pausa la riga completa è già in vigore, quella a metà non grida.
  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 })
    .toEqual(['esempio.it']);
  await expect(avviso).toBeHidden();

  await sicurezza.locator('#sec-siteblock-lists').focus();
  await expect(avviso).toBeVisible();
  await expect(avviso).toContainText('faceb');

  await lista.click();
  await sicurezza.keyboard.type('ook.com');
  await expect(avviso).toBeHidden();
  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 })
    .toEqual(['esempio.it', 'facebook.com']);
});

// Una riga che non è un dominio non blocca niente: se si esce senza cliccare nella pagina deve
// restare scritta e tornare con l'avviso, non sparire in silenzio.
test('«facebook» e Ctrl+W subito: riaprendo la riga c\'è ancora, con l\'avviso', async ({ app, shell, openTab }) => {
  const sicurezza = await apriSicurezza(shell, openTab);
  await sicurezza.locator('#sec-siteblock-blacklist').click();
  await sicurezza.keyboard.type(`${BLOCCATO}\nfacebook`);
  await ctrlW(app);
  await expect.poll(() => schedaSicurezzaAperta(shell), { timeout: 5000 }).toBe(false);
  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 })
    .toEqual([BLOCCATO]);

  const riaperta = await openTab('filo://security/security.html');
  await riaperta.waitForSelector('#sec-siteblock-blacklist', { timeout: 8000 });
  await expect(riaperta.locator('#sec-siteblock-blacklist')).toHaveValue(`${BLOCCATO}\nfacebook`);
  await expect(riaperta.locator('#sec-siteblock-blacklist-error')).toBeVisible();
  await expect(riaperta.locator('#sec-siteblock-blacklist-error')).toContainText('facebook');
});

test('«facebook», Ctrl+Tab e ritorno: la riga ha l\'avviso', async ({ app, shell, openTab }) => {
  const sicurezza = await apriSicurezza(shell, openTab);
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const qui = snap.activeId;
  await sicurezza.locator('#sec-siteblock-blacklist').click();
  await sicurezza.keyboard.type('facebook');
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tab = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    tab.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] });
  });
  await new Promise((r) => setTimeout(r, 60));
  const altra = snap.tabs.find((t) => t.id !== qui).id;
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), altra);
  await expect.poll(async () => (await shell.evaluate(() => window.filoShell.tabs.snapshot())).activeId).toBe(altra);

  await shell.evaluate((id) => window.filoShell.tabs.activate(id), qui);
  await expect(sicurezza.locator('#sec-siteblock-blacklist-error')).toBeVisible({ timeout: 4000 });
  await expect(sicurezza.locator('#sec-siteblock-blacklist-error')).toContainText('facebook');
});

// Chi incolla e chiude tiene il Ctrl giù da prima dell'incolla: nessun Ctrl nuovo arriva alla pagina
// fra la modifica e la chiusura, quindi la modifica deve partire da sola (#590.2).
const premi = (app, tasti) => app.evaluate(({ BrowserWindow }, t) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const tab = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  for (const e of t) tab.view.webContents.sendInputEvent(e);
}, tasti);
const conCtrl = (keyCode) => [{ type: 'keyDown', keyCode, modifiers: ['control'] }, { type: 'keyUp', keyCode, modifiers: ['control'] }];

test('Ctrl+V e Ctrl+W senza lasciare il Ctrl: il sito incollato resta nella lista', async ({ app, shell, openTab }) => {
  await app.evaluate(({ clipboard }, d) => clipboard.writeText(d), BLOCCATO);
  const sicurezza = await apriSicurezza(shell, openTab);
  await sicurezza.locator('#sec-siteblock-blacklist').click();
  await premi(app, [{ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] }]);
  await premi(app, conCtrl('V'));
  await new Promise((r) => setTimeout(r, 120));
  await premi(app, [{ type: 'keyDown', keyCode: 'W', modifiers: ['control'] }]);

  await expect.poll(() => schedaSicurezzaAperta(shell), { timeout: 5000 }).toBe(false);
  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 })
    .toEqual([BLOCCATO]);
  const riaperta = await openTab('filo://security/security.html');
  await expect(riaperta.locator('#sec-siteblock-blacklist')).toHaveValue(BLOCCATO, { timeout: 8000 });
});

test('una parola tolta con Ctrl+Backspace e Ctrl+W senza lasciare il Ctrl: la lista è quella corretta', async ({ app, shell, openTab }) => {
  await shell.evaluate((d) => window.filoShell.message({ type: 'update_settings', settings: { security: { siteBlock: { blacklist: [d, 'resta.it'] } } } }), BLOCCATO);
  const sicurezza = await openTab('filo://security/security.html');
  const lista = sicurezza.locator('#sec-siteblock-blacklist');
  await expect(lista).toHaveValue(`${BLOCCATO}\nresta.it`, { timeout: 8000 });
  await lista.click();
  await sicurezza.keyboard.press('Control+End');
  await premi(app, [{ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] }]);
  for (let i = 0; i < 4; i++) await premi(app, conCtrl('Backspace'));
  await expect(lista).toHaveValue(BLOCCATO);
  await new Promise((r) => setTimeout(r, 120));
  await premi(app, [{ type: 'keyDown', keyCode: 'W', modifiers: ['control'] }]);

  await expect.poll(() => schedaSicurezzaAperta(shell), { timeout: 5000 }).toBe(false);
  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 })
    .toEqual([BLOCCATO]);
});

test('riaprendo la pagina le righe scartate tornano al posto in cui erano scritte', async ({ shell, openTab }) => {
  const sicurezza = await apriSicurezza(shell, openTab);
  await sicurezza.locator('#sec-siteblock-blacklist').click();
  await sicurezza.keyboard.type(`facebook\n${BLOCCATO}\nyoutube\nresta.it`);
  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 })
    .toEqual([BLOCCATO, 'resta.it']);
  await sicurezza.reload();
  await expect(sicurezza.locator('#sec-siteblock-blacklist')).toHaveValue(`facebook\n${BLOCCATO}\nyoutube\nresta.it`, { timeout: 8000 });
  await expect(sicurezza.locator('#sec-siteblock-blacklist-error')).toContainText('facebook, youtube');
});

// La casella dei siti fidati per i cookie ha «Aggiungi», ma chiudere o cambiare scheda senza premerlo non deve
// perdere il sito: vale come le due liste sopra.
async function apriFidatiCookie(shell, openTab) {
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { security: { cookies: { mode: 'privacy', trustedSites: [], bozza: '' } } },
  }));
  const page = await openTab('filo://security/security.html');
  await expect(page.locator('#cookie-wl-input')).toBeEnabled({ timeout: 8000 });
  await page.locator('#cookie-wl-input').click();
  return page;
}

test('fidati per i cookie: un sito scritto senza «Aggiungi» e Ctrl+W subito è nell\'elenco riaprendo', async ({ app, shell, openTab }) => {
  const sicurezza = await apriFidatiCookie(shell, openTab);
  await sicurezza.keyboard.type('esempio.it');
  await ctrlW(app);

  await expect.poll(() => schedaSicurezzaAperta(shell), { timeout: 5000 }).toBe(false);
  await expect.poll(async () => (await impostazioni(shell)).security.cookies.trustedSites, { timeout: 4000 }).toEqual(['esempio.it']);
  const riaperta = await openTab('filo://security/security.html');
  await expect(riaperta.locator('#cookie-wl-list')).toContainText('esempio.it', { timeout: 8000 });
  await expect(riaperta.locator('#cookie-wl-input')).toHaveValue('');
});

test('fidati per i cookie: «gmail» e Ctrl+W, riaprendo il testo è nella casella con l\'avviso', async ({ app, shell, openTab }) => {
  const sicurezza = await apriFidatiCookie(shell, openTab);
  await sicurezza.keyboard.type('gmail');
  await ctrlW(app);

  await expect.poll(() => schedaSicurezzaAperta(shell), { timeout: 5000 }).toBe(false);
  const riaperta = await openTab('filo://security/security.html');
  await expect(riaperta.locator('#cookie-wl-input')).toHaveValue('gmail', { timeout: 8000 });
  await expect(riaperta.locator('#cookie-wl-error')).toBeVisible();
  expect((await impostazioni(shell)).security.cookies.trustedSites).toEqual([]);
});

test('fidati per i cookie: un sito scritto, Ctrl+Tab e ritorno, è nell\'elenco come con «Aggiungi»', async ({ app, shell, openTab }) => {
  const sicurezza = await apriFidatiCookie(shell, openTab);
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const qui = snap.activeId;
  await sicurezza.keyboard.type('esempio.it');
  await premi(app, [{ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] }]);
  const altra = snap.tabs.find((t) => t.id !== qui).id;
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), altra);
  await expect.poll(async () => (await shell.evaluate(() => window.filoShell.tabs.snapshot())).activeId).toBe(altra);
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), qui);

  await expect(sicurezza.locator('#cookie-wl-list')).toContainText('esempio.it', { timeout: 4000 });
  await expect(sicurezza.locator('#cookie-wl-input')).toHaveValue('');
  expect((await impostazioni(shell)).security.cookies.trustedSites).toEqual(['esempio.it']);
});

test('un dominio con lettere accentate si rivede come è stato scritto, e si salva nella forma della rete', async ({ shell, openTab }) => {
  const sicurezza = await apriSicurezza(shell, openTab);
  await sicurezza.locator('#sec-siteblock-blacklist').click();
  await sicurezza.keyboard.insertText('caffè.it');
  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 })
    .toEqual(['xn--caff-8oa.it']);
  await sicurezza.reload();
  await expect(sicurezza.locator('#sec-siteblock-blacklist')).toHaveValue('caffè.it', { timeout: 8000 });
});
