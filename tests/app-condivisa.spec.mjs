// L'azzeramento di tests/helpers/appCondivisa.mjs: dopo una prova che sporca tutto ciò che sa togliere, l'app è quella
// appena aperta. Sporca e controlla nella stessa prova: un rerun su un'app nuova passerebbe senza provare niente.

import { appCondivisa } from './helpers/appCondivisa.mjs';
import { comandaBarra, statoBarra } from './helpers/barra.mjs';

const { test, expect, azzera } = appCondivisa();

const PAGINA = '<!doctype html><title>Da archiviare</title><body>pagina di prova</body>';

const statoNelMain = (app) => app.evaluate(async ({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().filter((x) => x._filoTabs).sort((a, b) => a.id - b.id)[0];
  const s = await globalThis.SN_STORAGE.getSettings();
  const raw = await globalThis.chrome.storage.local.get(null);
  return {
    finestre: BrowserWindow.getAllWindows().filter((x) => x._filoTabs).length,
    schede: w._filoTabs.tabs.map((t) => t.url),
    useDefaultModels: s.useDefaultModels,
    openWeightsOnly: s.openWeightsOnly,
    dizionario: raw.sn_personal_dict ?? null,
    cambi: JSON.stringify(await globalThis.SN_REGISTRO_CAMBI.lista()),
    archivio: (await globalThis.SN_ARCHIVED_TABS.list()).length,
    triage: globalThis.SN_TAB_TRIAGE_DECIDE.toString().includes('finto'),
    provider: globalThis.SN_PROVIDERS.completeWithFallback.toString().includes('finto'),
    sporco: typeof globalThis.__sporco,
  };
});

test('dopo l\'azzeramento schede, impostazioni, archivio, rattoppi del main e script iniettati sono come appena aperta', async ({ app, shell, openTab, testServer }) => {
  const fresca = await statoNelMain(app);
  expect(fresca.schede).toEqual(['filo://newtab/']);

  await app.context().addInitScript(() => { window.__iniettato = 'sì'; });
  const sito = await testServer.openReady(openTab, PAGINA);
  expect(await sito.evaluate(() => window.__iniettato)).toBe('sì');
  await openTab('filo://options/options.html');
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, openWeightsOnly: true });
    await globalThis.chrome.storage.local.set({ sn_personal_dict: ['Parolaccia'] });
    globalThis.SN_TAB_TRIAGE_DECIDE = async () => 'finto';
    globalThis.SN_PROVIDERS.completeWithFallback = async () => 'finto';
    globalThis.__sporco = 1;
  });
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.find((t) => t.url.startsWith('http')).id);
  await shell.evaluate((x) => window.filoShell.tabs.close(x), id);
  await comandaBarra(app, 'clic');
  await expect.poll(async () => (await statoNelMain(app)).archivio).toBe(1);
  expect((await statoBarra(app)).aperta).toBe(true);

  await azzera();

  expect(await statoNelMain(app)).toEqual(fresca);
  expect((await statoBarra(app)).aperta).toBe(false);
  await expect(shell.locator('.tab')).toHaveCount(1);
  const home = await openTab('filo://newtab/');
  expect(await home.evaluate(() => window.__iniettato ?? null)).toBe(null);
});
