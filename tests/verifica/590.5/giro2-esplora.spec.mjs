// Verifica #590.5 giro 2: esplorazione (porte non ancora provate).
import { test, expect } from '../../fixtures/electron.mjs';

const impostazioni = async (shell) => (await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' }))).settings;

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

// Clic sulla X della scheda col mouse: il fuoco va alla shell, poi il main chiude la scheda.
async function chiudiColMouse(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    (w._filoTabs.shellView ? w._filoTabs.shellView.webContents : w.webContents).focus();
  });
  await new Promise((r) => setTimeout(r, 80));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w._filoTabs.closeTab(w._filoTabs.activeId);
  });
}

async function scriviAlPostoDi(page, selettore, testo) {
  await page.locator(selettore).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(testo);
}

test('Modelli: limite 7 e chiusa col mouse', async ({ app, shell, openTab }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { monthlyLimitEur: 5 } }));
  const modelli = await openTab('filo://options/options.html');
  await expect(modelli.locator('#monthlyLimit')).toHaveValue('5', { timeout: 8000 });
  await scriviAlPostoDi(modelli, '#monthlyLimit', '7');
  await chiudiColMouse(app);
  await expect.poll(async () => (await impostazioni(shell)).monthlyLimitEur, { timeout: 4000 }).toBe(7);
});

test('Altro: dominio e chiusa col mouse', async ({ app, shell, openTab }) => {
  const altro = await openTab('filo://options/altro.html');
  await altro.waitForSelector('#blocklist', { timeout: 8000 });
  await altro.locator('#blocklist').click();
  await altro.keyboard.type('mouse.example');
  await chiudiColMouse(app);
  await expect.poll(async () => (await impostazioni(shell)).blocklist, { timeout: 4000 }).toEqual(['mouse.example']);
});

test('Modelli: un modello accettato scritto nella catena e Ctrl+W: salvato', async ({ app, shell, openTab }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { useDefaultModels: false } }));
  const modelli = await openTab('filo://options/options.html');
  await expect(modelli.locator('#modelsGrid .sn-chain input').first()).toBeVisible({ timeout: 8000 });
  const idx = await modelli.evaluate(() => window.SN_MODEL_CHAIN.actionLabels().findIndex(([a]) => a === 'describe_image'));
  const prima = (await impostazioni(shell)).models.describe_image;
  console.log('prima', prima);
  const regs = await modelli.evaluate(() => [...document.querySelectorAll('#modelsGrid datalist option, datalist option')].map((o) => o.value).slice(0, 40));
  console.log('opzioni', regs.join(' | '));
  const altro = prima.split(',').map((s) => s.trim())[1] || 'kimi';
  await scriviAlPostoDi(modelli, `#modelsGrid .sn-chain >> nth=${idx} >> input >> nth=0`, altro);
  await ctrlW(app);
  await new Promise((r) => setTimeout(r, 1200));
  const dopo = (await impostazioni(shell)).models.describe_image;
  console.log('dopo', dopo);
  expect(dopo.split(',')[0].trim()).toBe(altro);
});

test('Altro: nome categoria, pausa lunga, poi si continua a scrivere: fuoco e testo restano', async ({ app, openTab }) => {
  const leggi = (page) => page.evaluate(async () => ((await chrome.storage.local.get('categories')).categories || []).map((c) => c.name));
  const altro = await openTab('filo://options/altro.html');
  await altro.waitForLoadState('domcontentloaded');
  await altro.evaluate(async () => { await chrome.storage.local.set({ categories: [{ id: 'cat-v', name: 'Lavoro' }] }); });
  await altro.reload();
  await expect(altro.locator('.sn-cat-row input')).toHaveValue('Lavoro', { timeout: 8000 });
  await scriviAlPostoDi(altro, '.sn-cat-row input', 'Casa');
  await new Promise((r) => setTimeout(r, 3600));
  await expect.poll(() => leggi(altro), { timeout: 3000 }).toEqual(['Casa']);
  await altro.keyboard.type(' mia');
  await expect(altro.locator('.sn-cat-row input')).toHaveValue('Casa mia');
  await ctrlW(app);
  const altra = await openTab('filo://options/altro.html');
  await expect.poll(() => leggi(altra), { timeout: 5000 }).toEqual(['Casa mia']);
});

test('Preferenze: voce personalizzata e cambio scheda', async ({ shell, openTab }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#autoArchiveIdleHours')).not.toHaveValue('', { timeout: 8000 });
  const ok = await pref.evaluate(() => {
    const sel = document.getElementById('ttsModelVoice');
    const opt = [...sel.options].find((o) => o.value && document.getElementById('ttsModelVoiceCustom') && /custom|__/i.test(o.value));
    if (!opt) return [...sel.options].map((o) => o.value).join(',');
    sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  });
  console.log('select', ok);
  await pref.locator('#ttsModelVoiceCustom').click();
  await pref.keyboard.type('Aurora');
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const altra = snap.tabs.find((t) => t.id !== snap.activeId).id;
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), altra);
  await expect.poll(async () => JSON.stringify(await impostazioni(shell)).includes('Aurora'), { timeout: 4000 }).toBe(true);
});
