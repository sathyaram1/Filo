// Verifica #2091 giro 2, rilievo 1: lo scambio dell'Aiuto riletto dalla sua riga nella home tiene il gettone della
// scheda lasciata, senza i segni ⟦ ⟧.

import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
const idPerUrl = async (shell, url) => (await schede(shell)).find((t) => t.url === url)?.id;

test('r1 lo scambio dell\'Aiuto aperto dalla sua riga nella home mostra il gettone, non i segni', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const url = testServer.html('<title>Articolo sulla Tesla</title><p>La Tesla Roadster è volata su un Falcon Heavy.</p>');
  await openTab(url);
  const sorgente = await idPerUrl(shell, url);
  const sito = await openTab(testServer.html('<title>Un sito</title><p>un sito qualunque'));
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, sito);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });

  const r = await aiuto.locator('.sn-sidebar-input textarea').evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + Math.min(24, b.width / 2), y: b.top + b.height / 2 };
  });
  const v = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    const s = tm.riquadri.strati.get(t.view.webContents);
    return { b: s.perIlVuoto.getBounds(), z: s.vista.webContents.getZoomFactor() || 1, zs: w.webContents.getZoomFactor() || 1 };
  });
  const verso = { x: (v.b.x + r.x * v.z) / v.zs, y: (v.b.y + r.y * v.z) / v.zs };
  const da = await shell.evaluate((i) => {
    const b = document.querySelector(`.tab[data-id="${i}"]`).getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, sorgente);
  await shell.mouse.move(da.x, da.y);
  await shell.mouse.down();
  await shell.mouse.move(da.x + 8, da.y, { steps: 2 });
  await shell.mouse.move(verso.x, verso.y, { steps: 8 });
  await shell.mouse.up();
  await expect(aiuto.locator('.sn-gettoni-fondo .sn-gettone')).toHaveCount(1, { timeout: 5000 });

  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { [C.ACTIONS.HELP]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry });
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts }) => ({ text: '{"message":"Con un razzo.","suggestions":[],"issues":[]}', model: attempts[0].model, provider: attempts[0].provider, usage: {} });
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
  });
  await aiuto.locator('.sn-sidebar-input textarea').focus();
  await aiuto.keyboard.press('End');
  await aiuto.keyboard.type('come ha fatto?');
  await aiuto.keyboard.press('Enter');
  await expect(aiuto.locator('.sn-sidebar-msg-user .sn-bolla-gettone')).toHaveCount(1, { timeout: 15_000 });

  const nuova = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const casa = await home(app, { scheda: nuova?.id });
  const riga = casa.locator('.dash-riga-app').first();
  await expect(riga).toBeVisible({ timeout: 15_000 });
  await riga.locator('.dash-riga-app-testa').click();
  const domanda = riga.locator('.dash-riga-app-msg-user').filter({ hasText: 'come ha fatto?' });
  await expect(domanda).toBeVisible({ timeout: 10_000 });
  await expect(domanda).not.toContainText('⟦');
  await expect(domanda.locator('.sn-bolla-gettone')).toContainText('Articolo sulla Tesla');
});
