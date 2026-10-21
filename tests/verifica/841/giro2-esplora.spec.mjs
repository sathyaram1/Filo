// Verifica #841 giro 2: l'interruttore dell'Aiuto rifatto coi passi dell'utente (chat, Preferenze, menu, Alt+H).
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina } from '../../helpers/chatFinta.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots/verifica-841';
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const HTML = `<!doctype html><html><head><title>Pagina prova</title></head>
<body style="padding:40px;font:16px sans-serif"><h1>Contenuto</h1><p>Un paragrafo.</p></body></html>`;

const aiutoFlag = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).featureFlags?.help);

function altH(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.focus();
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'H', modifiers: ['alt'] });
    t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'H', modifiers: ['alt'] });
  });
}

async function vociMenuPagina(page) {
  await page.mouse.click(5, 5);
  await page.locator('h1').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 8_000 });
  const t = await page.locator('.sn-menu').innerText();
  await page.keyboard.press('Escape');
  return t;
}

async function vociMenuLinguetta(app, shell, page) {
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active') || document.querySelector('.tab');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
  });
  let popup = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try { if (await w.evaluate(() => document.body && /Duplica/.test(document.body.innerText))) { popup = w; return true; } } catch (_) {}
    }
    return false;
  }, { timeout: 8_000 }).toBe(true);
  const testo = await popup.evaluate(() => [...document.querySelectorAll('button.item')].map((b) => b.textContent.trim()).join('|'));
  await popup.keyboard.press('Escape').catch(() => {});
  await page.bringToFront().catch(() => {});
  return testo;
}

test('a parole: «spegni l\'Aiuto» toglie voce, voce linguetta e Alt+H; «riaccendilo» li rimette; Preferenze segue', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  mkdirSync(SHOTS, { recursive: true });
  const chat = await home(app);
  const page = await testServer.openReady(openTab, HTML);
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#aiutoAcceso')).toBeChecked({ timeout: 8_000 });
  await expect(pref.locator('#correttoreAcceso')).toBeChecked();
  await expect(pref.locator('#categorieAutomatiche')).not.toBeChecked();

  // Di serie: c'è tutto.
  await page.bringToFront();
  await shell.evaluate(async () => { const s = await window.filoShell.tabs.snapshot(); return s.activeId; });
  const idPagina = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.find((t) => /127\.0\.0\.1/.test(t.url)).id;
  });
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), idPagina);
  expect(await vociMenuPagina(page)).toMatch(/\bAiuto\b/);
  expect(await vociMenuLinguetta(app, shell, page)).toMatch(/Aiuto/);

  // In chat: «spegni l'Aiuto».
  await modelloFinto(app, [
    { toolCalls: [{ id: 'a1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'aiuto', valore: 'spento' }) }] },
    { text: 'Fatto, l\'Aiuto è spento.' },
  ]);
  await chat.bringToFront();
  await chat.locator('#input').fill('spegni l\'aiuto');
  await chat.locator('#sendBtn').click();
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Fatto, l\'Aiuto è spento.' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => aiutoFlag(app), { timeout: 8_000 }).toBe(false);
  await chat.screenshot({ path: `${SHOTS}/chat-spento.png` });
  // Preferenze aperta in un'altra scheda segue.
  await expect(pref.locator('#aiutoAcceso')).not.toBeChecked({ timeout: 8_000 });

  await shell.evaluate((id) => window.filoShell.tabs.activate(id), idPagina);
  await page.bringToFront();
  expect(await vociMenuPagina(page)).not.toMatch(/\bAiuto\b/);
  expect(await vociMenuLinguetta(app, shell, page)).not.toMatch(/Aiuto/);
  await altH(app);
  await pausa(1500);
  await expect(page.locator('.sn-sidebar')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/pagina-alth-spento.png` });

  // In chat: «riaccendi l'Aiuto».
  await ripristina(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'a2', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'aiuto', valore: 'accendi' }) }] },
    { text: 'Riacceso.' },
  ]);
  await chat.bringToFront();
  await chat.locator('#input').fill('riaccendi l\'aiuto');
  await chat.locator('#sendBtn').click();
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Riacceso.' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => aiutoFlag(app), { timeout: 8_000 }).toBe(true);
  await expect(pref.locator('#aiutoAcceso')).toBeChecked({ timeout: 8_000 });

  await shell.evaluate((id) => window.filoShell.tabs.activate(id), idPagina);
  await page.bringToFront();
  expect(await vociMenuPagina(page)).toMatch(/\bAiuto\b/);
  expect(await vociMenuLinguetta(app, shell, page)).toMatch(/Aiuto/);
  await altH(app);
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
});

test('da Preferenze: l\'interruttore spegne l\'Aiuto, il pannello aperto si chiude, e si riaccende', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  mkdirSync(SHOTS, { recursive: true });
  const page = await testServer.openReady(openTab, HTML);
  await altH(app);
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });

  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#aiutoAcceso')).toBeChecked({ timeout: 8_000 });
  await pref.locator('#sec-funzioni').scrollIntoViewIfNeeded();
  await pref.screenshot({ path: `${SHOTS}/preferenze-funzioni.png` });
  await pref.locator('#aiutoAcceso').uncheck();
  await expect.poll(() => aiutoFlag(app), { timeout: 8_000 }).toBe(false);
  await pref.locator('#correttoreAcceso').uncheck();
  await expect.poll(async () => (await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).featureFlags?.spellcheck)), { timeout: 8_000 }).toBe(false);
  await pref.locator('#categorieAutomatiche').check();
  await expect.poll(async () => (await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).featureFlags?.categorize)), { timeout: 8_000 }).toBe(true);

  // Il pannello aperto prima si è chiuso.
  await expect(page.locator('.sn-sidebar:visible')).toHaveCount(0, { timeout: 8_000 });

  // Ricaricata, Preferenze mostra le scelte.
  await pref.reload();
  await expect(pref.locator('#aiutoAcceso')).not.toBeChecked({ timeout: 8_000 });
  await expect(pref.locator('#correttoreAcceso')).not.toBeChecked();
  await expect(pref.locator('#categorieAutomatiche')).toBeChecked();

  // Alt+H su una pagina interna (le Preferenze) non apre niente.
  await altH(app);
  await pausa(1000);
  await expect(pref.locator('.sn-sidebar:visible')).toHaveCount(0);
  await pref.screenshot({ path: `${SHOTS}/preferenze-alth-spento.png` });

  await pref.locator('#aiutoAcceso').check();
  await expect.poll(() => aiutoFlag(app), { timeout: 8_000 }).toBe(true);
  const idPagina = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.find((t) => /127\.0\.0\.1/.test(t.url)).id;
  });
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), idPagina);
  await page.bringToFront();
  await altH(app);
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
});

test('spento, una scheda aperta dopo e un riquadro incorporato non hanno l\'Aiuto', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ featureFlags: { help: false } }); });
  const interno = testServer.html(`<!doctype html><html><body><h2 id="dentro">Dentro il riquadro</h2></body></html>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:20px"><h1>Fuori</h1>
    <iframe id="f" src="${interno}" style="width:500px;height:300px"></iframe></body></html>`);
  expect(await vociMenuPagina(page)).not.toMatch(/\bAiuto\b/);
  const frame = page.frameLocator('#f');
  await expect(frame.locator('#dentro')).toBeVisible({ timeout: 8_000 });
  await pausa(800);
  await frame.locator('#dentro').click({ button: 'right' });
  await pausa(800);
  const menu = page.locator('.sn-menu');
  const inFrame = frame.locator('.sn-menu');
  const testi = [];
  if (await menu.count()) testi.push(await menu.innerText());
  if (await inFrame.count()) testi.push(await inFrame.innerText());
  expect(testi.length).toBeGreaterThan(0);
  for (const t of testi) expect(t).not.toMatch(/\bAiuto\b/);
});

test('spento nella finestra normale: anche l\'incognito non ha l\'Aiuto, né nel menu né con Alt+H', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => { await globalThis.__filoHandlers.executeFiloAction({ type: 'IMPOSTA_PREFERENZA', chiave: 'aiuto', valore: 'spento' }); });
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito && w._filoTabs)), { timeout: 10_000 }).toBe(true);
  const url = testServer.html(HTML.replace('Pagina prova', 'Pagina segreta'));
  await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab(u), url);
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url() === url); return !!page; }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  expect(await vociMenuPagina(page)).not.toMatch(/\bAiuto\b/);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.focus();
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'H', modifiers: ['alt'] });
    t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'H', modifiers: ['alt'] });
  });
  await pausa(1500);
  await expect(page.locator('.sn-sidebar')).toHaveCount(0);
});
