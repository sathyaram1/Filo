import { test, expect } from './fixtures/electron.mjs';

test('probe: tema salvato dark — dashboard vs editor', async ({ openTab }) => {
  // 1) apri la dashboard e imposta il tema salvato a dark
  const dash = await openTab('filo://newtab/');
  await dash.evaluate(() => new Promise((res) => {
    chrome.storage.local.set({ settings: { theme: 'dark' } }, () => res());
    setTimeout(res, 300);
  }));
  // ricarica la dashboard così applica il tema salvato
  await dash.reload();
  await dash.waitForTimeout(500);
  const dashTheme = await dash.evaluate(() => document.documentElement.dataset.snTheme);

  // 2) apri l'editor (stesso storage userData) e leggi il tema risolto
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForSelector('#doc');
  await ed.waitForTimeout(400);
  const edTheme = await ed.evaluate(() => document.documentElement.dataset.snTheme);

  console.log('DASHBOARD THEME:', dashTheme, '| EDITOR THEME:', edTheme);
  await ed.screenshot({ path: 'tests/.smoke/_editor-darkpref.png' }).catch(() => {});

  // Il tema dell'editor DOVREBBE coincidere con quello salvato (dark), come la dashboard.
  expect(edTheme, 'editor dovrebbe rispettare il tema salvato come la dashboard').toBe(dashTheme);
});
