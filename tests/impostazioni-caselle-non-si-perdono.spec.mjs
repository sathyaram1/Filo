// #590.5 — Altro, Modelli e Preferenze: un valore scritto in una casella vale anche se subito dopo si cambia
// scheda o si chiude la pagina, senza aver cliccato altrove. Ctrl+W passa da sendInputEvent (la tastiera di
// Playwright non tocca il before-input-event del main) e Playwright non fa mai perdere il fuoco alla pagina.

import { test, expect } from './fixtures/electron.mjs';

const impostazioni = async (shell) => (await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' }))).settings;

const premi = (app, tasti) => app.evaluate(({ BrowserWindow }, t) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const tab = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  for (const e of t) tab.view.webContents.sendInputEvent(e);
}, tasti);

// Come arriva da una tastiera: prima il Ctrl da solo, poi la lettera.
async function ctrlW(app) {
  await premi(app, [{ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] }]);
  await new Promise((r) => setTimeout(r, 60));
  await premi(app, [{ type: 'keyDown', keyCode: 'W', modifiers: ['control'] }]);
}

// Un clic su un'altra scheda: nessun tasto arriva alla pagina, solo il main che la toglie di vista.
async function altraSchedaEPoiQui(shell) {
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const qui = snap.activeId;
  const altra = snap.tabs.find((t) => t.id !== qui).id;
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), altra);
  await expect.poll(async () => (await shell.evaluate(() => window.filoShell.tabs.snapshot())).activeId).toBe(altra);
  return async () => {
    await shell.evaluate((id) => window.filoShell.tabs.activate(id), qui);
    await expect.poll(async () => (await shell.evaluate(() => window.filoShell.tabs.snapshot())).activeId).toBe(qui);
  };
}

const schedaAperta = (shell, prefisso) => shell.evaluate(async (p) =>
  (await window.filoShell.tabs.snapshot()).tabs.some((t) => t.url.startsWith(p)), prefisso);

async function scriviAlPostoDi(page, selettore, testo) {
  await page.locator(selettore).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(testo);
}

test('Altro: un dominio escluso scritto e un clic su un\'altra scheda, il dominio è salvato', async ({ shell, openTab }) => {
  const altro = await openTab('filo://options/altro.html');
  await altro.waitForSelector('#blocklist', { timeout: 8000 });
  await altro.locator('#blocklist').click();
  await altro.keyboard.type('esempio.it');
  await altraSchedaEPoiQui(shell);
  await expect.poll(async () => (await impostazioni(shell)).blocklist, { timeout: 4000 }).toEqual(['esempio.it']);
});

test('Altro: un dominio escluso e Ctrl+W subito, riaprendo la pagina c\'è', async ({ app, shell, openTab }) => {
  const altro = await openTab('filo://options/altro.html');
  await altro.waitForSelector('#blocklist', { timeout: 8000 });
  await altro.locator('#blocklist').click();
  await altro.keyboard.type('primo.it\nsecondo.it');
  await ctrlW(app);

  await expect.poll(() => schedaAperta(shell, 'filo://options/altro'), { timeout: 5000 }).toBe(false);
  await expect.poll(async () => (await impostazioni(shell)).blocklist, { timeout: 4000 }).toEqual(['primo.it', 'secondo.it']);
  const riaperta = await openTab('filo://options/altro.html');
  await expect(riaperta.locator('#blocklist')).toHaveValue('primo.it\nsecondo.it', { timeout: 8000 });
});

test('Altro: il nome nuovo di una categoria vale senza «Rinomina»; vuoto non la rinomina', async ({ shell, openTab }) => {
  const leggi = (page) => page.evaluate(async () => ((await chrome.storage.local.get('categories')).categories || []).map((c) => c.name));
  const altro = await openTab('filo://options/altro.html');
  await altro.waitForLoadState('domcontentloaded');
  await altro.evaluate(async () => { await chrome.storage.local.set({ categories: [{ id: 'cat-5905', name: 'Lavoro' }] }); });
  await altro.reload();
  const casella = altro.locator('.sn-cat-row input');
  await expect(casella).toHaveValue('Lavoro', { timeout: 8000 });

  await scriviAlPostoDi(altro, '.sn-cat-row input', 'Ufficio');
  // Il nome a metà non parte: la categoria cambia nome solo all'uscita.
  expect(await leggi(altro)).toEqual(['Lavoro']);
  const torna = await altraSchedaEPoiQui(shell);
  await expect.poll(() => leggi(altro), { timeout: 4000 }).toEqual(['Ufficio']);
  await torna();
  await expect(casella).toHaveValue('Ufficio');

  await scriviAlPostoDi(altro, '.sn-cat-row input', ' ');
  await altro.keyboard.press('Backspace');
  // Un clic sulla barra delle schede toglie prima il fuoco alla finestra: il nome vuoto parte lì, senza rinominare.
  await altro.evaluate(() => window.dispatchEvent(new Event('blur')));
  const torna2 = await altraSchedaEPoiQui(shell);
  await torna2();
  await expect(casella).toHaveValue('Ufficio', { timeout: 4000 });
  expect(await leggi(altro)).toEqual(['Ufficio']);
});

test('Modelli: il limite di spesa scritto e un clic su un\'altra scheda è quello nuovo, e a metà non parte', async ({ app, shell, openTab }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { monthlyLimitEur: 5 } }));
  const modelli = await openTab('filo://options/options.html');
  await expect(modelli.locator('#monthlyLimit')).toHaveValue('5', { timeout: 8000 });

  await scriviAlPostoDi(modelli, '#monthlyLimit', '7');
  await altraSchedaEPoiQui(shell);
  await expect.poll(async () => (await impostazioni(shell)).monthlyLimitEur, { timeout: 4000 }).toBe(7);

  const riaperta = await openTab('filo://options/options.html');
  await expect(riaperta.locator('#monthlyLimit')).toHaveValue('7', { timeout: 8000 });
  await scriviAlPostoDi(riaperta, '#monthlyLimit', '1');
  await new Promise((r) => setTimeout(r, 900));
  expect((await impostazioni(shell)).monthlyLimitEur).toBe(7);
  await riaperta.keyboard.type('5');
  await ctrlW(app);
  await expect.poll(async () => (await impostazioni(shell)).monthlyLimitEur, { timeout: 4000 }).toBe(15);
});

test('Modelli: una chiave scritta e Ctrl+W subito è salvata', async ({ app, shell, openTab }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { useDefaultModels: false, apiKeys: { openrouter: '', tavily: '' } } }));
  const modelli = await openTab('filo://options/options.html');
  await expect(modelli.locator('#apiKeyTavily')).toBeVisible({ timeout: 8000 });
  await modelli.locator('#apiKeyTavily').click();
  await modelli.keyboard.type('tvly-chiave-scritta');
  await ctrlW(app);

  await expect.poll(() => schedaAperta(shell, 'filo://options/options'), { timeout: 5000 }).toBe(false);
  await expect.poll(async () => (await impostazioni(shell)).apiKeys.tavily, { timeout: 4000 }).toBe('tvly-chiave-scritta');
});

test('Modelli: una riga del registro senza nickname non grida mentre si scrive; cambiata scheda e tornati sì', async ({ shell, openTab }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { useDefaultModels: false } }));
  const modelli = await openTab('filo://options/options.html');
  await expect(modelli.locator('#sec-model-registry')).toBeVisible({ timeout: 8000 });
  await modelli.locator('#addModelRow').click();
  const riga = modelli.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').last();
  await riga.locator('.sn-model-id').click();
  await modelli.keyboard.type('vendor/modello-nuovo');
  await new Promise((r) => setTimeout(r, 900));
  await expect(riga).not.toHaveClass(/sn-row-invalid/);
  await expect(modelli.locator('#savedHint')).not.toHaveClass(/sn-show/);

  const torna = await altraSchedaEPoiQui(shell);
  await torna();
  await expect(riga).toHaveClass(/sn-row-invalid/);
  await expect(riga.locator('.sn-model-row-msg')).not.toHaveText('');

  await riga.locator('.sn-model-nick').click();
  await modelli.keyboard.type('nuovo');
  await expect(riga).not.toHaveClass(/sn-row-invalid/, { timeout: 4000 });
  await expect.poll(async () => ((await impostazioni(shell)).modelRegistry.nuovo || {}).model, { timeout: 4000 }).toBe('vendor/modello-nuovo');
});

test('Preferenze: ore di inattività e Ctrl+W subito, durata notifiche e un clic su un\'altra scheda', async ({ app, shell, openTab }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#autoArchiveIdleHours')).not.toHaveValue('', { timeout: 8000 });

  await scriviAlPostoDi(pref, '#notifDuration', '30');
  await altraSchedaEPoiQui(shell);
  await expect.poll(async () => (await impostazioni(shell)).notifications.durationSec, { timeout: 4000 }).toBe(30);

  const riaperta = await openTab('filo://preferences/preferences.html');
  await expect(riaperta.locator('#notifDuration')).toHaveValue('30', { timeout: 8000 });
  await scriviAlPostoDi(riaperta, '#autoArchiveIdleHours', '12');
  await ctrlW(app);
  await expect.poll(async () => (await impostazioni(shell)).autoArchive.idleHours, { timeout: 4000 }).toBe(12);
});

test('Preferenze: un numero fuori scala, cambiata scheda e tornati, dice il valore in uso', async ({ shell, openTab }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#autoArchiveIdleHours')).not.toHaveValue('', { timeout: 8000 });
  await scriviAlPostoDi(pref, '#autoArchiveIdleHours', '500');
  const torna = await altraSchedaEPoiQui(shell);
  await expect.poll(async () => (await impostazioni(shell)).autoArchive.idleHours, { timeout: 4000 }).toBe(168);
  await torna();
  await expect(pref.locator('#autoArchiveIdleHours')).toHaveValue('168');
});

test('Preferenze: il nome della voce personalizzata e Ctrl+W subito è salvato', async ({ app, shell, openTab }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { tts: { modelVoice: 'voce-di-prima' } } }));
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#ttsModelVoiceCustom')).toHaveValue('voce-di-prima', { timeout: 10_000 });
  await scriviAlPostoDi(pref, '#ttsModelVoiceCustom', 'voce-nuova');
  await ctrlW(app);

  await expect.poll(() => schedaAperta(shell, 'filo://preferences'), { timeout: 5000 }).toBe(false);
  await expect.poll(async () => (await impostazioni(shell)).tts.modelVoice, { timeout: 4000 }).toBe('voce-nuova');
});
