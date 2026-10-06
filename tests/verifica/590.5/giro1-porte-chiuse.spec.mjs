// Verifica #590.5 giro 1: porte vicine alla segnalazione, provate e chiuse (ricarica, navigazione nella stessa
// scheda, via e ritorno, Ctrl+Tab, categoria, stile della chat, token estetici).
import { test, expect } from '../../fixtures/electron.mjs';

const impostazioni = async (shell) => (await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' }))).settings;
const snap = (shell) => shell.evaluate(() => window.filoShell.tabs.snapshot());

const premi = (app, tasti) => app.evaluate(({ BrowserWindow }, t) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const tab = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  for (const e of t) tab.view.webContents.sendInputEvent(e);
}, tasti);

async function ctrlW(app) {
  await premi(app, [{ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] }]);
  await new Promise((r) => setTimeout(r, 60));
  await premi(app, [{ type: 'keyDown', keyCode: 'W', modifiers: ['control'] }]);
}

async function scriviAlPostoDi(page, selettore, testo) {
  await page.locator(selettore).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(testo);
}

test('Modelli: limite 7 e F5 subito, dopo la ricarica è 7', async ({ app, shell, openTab }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { monthlyLimitEur: 5 } }));
  const modelli = await openTab('filo://options/options.html');
  await expect(modelli.locator('#monthlyLimit')).toHaveValue('5', { timeout: 8000 });
  await scriviAlPostoDi(modelli, '#monthlyLimit', '7');
  await premi(app, [{ type: 'keyDown', keyCode: 'F5' }, { type: 'keyUp', keyCode: 'F5' }]);
  await expect.poll(async () => (await impostazioni(shell)).monthlyLimitEur, { timeout: 5000 }).toBe(7);
});

test('Modelli: limite 7 e navigato altrove nella stessa scheda: è 7', async ({ shell, openTab }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { monthlyLimitEur: 5 } }));
  const modelli = await openTab('filo://options/options.html');
  await expect(modelli.locator('#monthlyLimit')).toHaveValue('5', { timeout: 8000 });
  await scriviAlPostoDi(modelli, '#monthlyLimit', '7');
  const id = (await snap(shell)).activeId;
  await shell.evaluate((i) => window.filoShell.tabs.navigate(i, 'filo://history/history.html'), id);
  await expect.poll(async () => (await impostazioni(shell)).monthlyLimitEur, { timeout: 5000 }).toBe(7);
});

test('Modelli: via e ritorno, poi un altro numero e Ctrl+W: vale l\'ultimo', async ({ app, shell, openTab }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { monthlyLimitEur: 5 } }));
  const modelli = await openTab('filo://options/options.html');
  await expect(modelli.locator('#monthlyLimit')).toHaveValue('5', { timeout: 8000 });
  await scriviAlPostoDi(modelli, '#monthlyLimit', '7');
  const s = await snap(shell);
  const qui = s.activeId;
  const altra = s.tabs.find((t) => t.id !== qui).id;
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), altra);
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), qui);
  await expect.poll(async () => (await impostazioni(shell)).monthlyLimitEur, { timeout: 4000 }).toBe(7);
  await modelli.locator('#monthlyLimit').click();
  await modelli.keyboard.press('End');
  await modelli.keyboard.type('0');
  await ctrlW(app);
  await expect.poll(async () => (await impostazioni(shell)).monthlyLimitEur, { timeout: 4000 }).toBe(70);
});

test('Altro: un dominio escluso e Ctrl+Tab: è salvato', async ({ shell, openTab }) => {
  const altro = await openTab('filo://options/altro.html');
  await altro.waitForSelector('#blocklist', { timeout: 8000 });
  await altro.locator('#blocklist').click();
  await altro.keyboard.type('tab.example');
  const s = await snap(shell);
  const altra = s.tabs.find((t) => t.id !== s.activeId).id;
  await altro.keyboard.down('Control');
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), altra);
  await altro.keyboard.up('Control');
  await expect.poll(async () => (await impostazioni(shell)).blocklist, { timeout: 4000 }).toEqual(['tab.example']);
});

test('Altro: nome di categoria e Ctrl+W subito: rinominata', async ({ app, openTab }) => {
  const leggi = (page) => page.evaluate(async () => ((await chrome.storage.local.get('categories')).categories || []).map((c) => c.name));
  const altro = await openTab('filo://options/altro.html');
  await altro.waitForLoadState('domcontentloaded');
  await altro.evaluate(async () => { await chrome.storage.local.set({ categories: [{ id: 'cat-v', name: 'Lavoro' }] }); });
  await altro.reload();
  await expect(altro.locator('.sn-cat-row input')).toHaveValue('Lavoro', { timeout: 8000 });
  await scriviAlPostoDi(altro, '.sn-cat-row input', 'Casa');
  await ctrlW(app);
  const altra = await openTab('filo://options/altro.html');
  await expect.poll(() => leggi(altra), { timeout: 5000 }).toEqual(['Casa']);
});

test('Preferenze: stile personalizzato e Ctrl+W subito: salvato', async ({ app, shell, openTab }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#autoArchiveIdleHours')).not.toHaveValue('', { timeout: 8000 });
  await pref.locator('#agentStyleText').click();
  await pref.keyboard.press('Control+A');
  await pref.keyboard.type('Rispondi in rima');
  await ctrlW(app);
  await expect.poll(async () => (await impostazioni(shell)).agentStyle, { timeout: 4000 }).toBe('Rispondi in rima');
});

test('Preferenze: un token estetico scritto e Ctrl+W subito: salvato', async ({ app, shell, openTab }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  const casella = pref.locator('.sn-token-input').first();
  await expect(casella).toBeAttached({ timeout: 8000 });
  const id = await casella.getAttribute('id');
  await pref.evaluate((i) => { const el = document.getElementById(i); el.scrollIntoView(); el.closest('details')?.setAttribute('open', ''); }, id);
  await casella.click({ force: true });
  await pref.keyboard.press('Control+A');
  await pref.keyboard.type('#123456');
  await ctrlW(app);
  await expect.poll(async () => JSON.stringify(await impostazioni(shell)).includes('#123456'), { timeout: 4000 }).toBe(true);
});
