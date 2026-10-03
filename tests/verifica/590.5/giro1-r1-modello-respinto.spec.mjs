// Verifica #590.5 giro 1, rilievo 1: un modello che l'azione respinge, lasciato col clic torna indietro; lasciato
// con Ctrl+W (o cambiando scheda) finisce salvato lo stesso. Le due uscite devono salvare la stessa cosa.
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

async function segmentoDescriviImmagine(modelli) {
  await expect(modelli.locator('#modelsGrid .sn-chain input').first()).toBeVisible({ timeout: 8000 });
  const idx = await modelli.evaluate(() => window.SN_MODEL_CHAIN.actionLabels().findIndex(([a]) => a === 'describe_image'));
  return modelli.locator('#modelsGrid .sn-chain').nth(idx).locator('input').first();
}

test('un modello di solo testo scritto in «descrivi immagine»: col clic altrove e con Ctrl+W resta fuori', async ({ app, shell, openTab }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { useDefaultModels: false } }));
  const modelli = await openTab('filo://options/options.html');
  const seg = await segmentoDescriviImmagine(modelli);
  const prima = (await impostazioni(shell)).models.describe_image;
  expect(prima.split(',')[0].trim()).not.toBe('deepseek-flash');

  await seg.click();
  await modelli.keyboard.press('Control+A');
  await modelli.keyboard.type('deepseek-flash');
  await modelli.keyboard.press('Escape');
  await modelli.locator('h1').first().click();
  await expect(seg).not.toHaveValue('deepseek-flash', { timeout: 3000 });
  expect((await impostazioni(shell)).models.describe_image).toBe(prima);

  await seg.click();
  await modelli.keyboard.press('Control+A');
  await modelli.keyboard.type('deepseek-flash');
  await ctrlW(app);
  await new Promise((r) => setTimeout(r, 1500));
  expect((await impostazioni(shell)).models.describe_image).toBe(prima);
});
