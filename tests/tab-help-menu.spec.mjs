// Voce "Aiuto" del menu tasto destro su una tab (spec §4).
//
// ASSERISCE il successo: invocare Aiuto su una scheda apre la sidebar Aiuto SU
// quella pagina, e l'agente riceve il contesto "invocata da click sulla tab"
// (url + titolo), così sa da dove parte.

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><head><title>Pagina Aiuto Test</title></head>
<body style="padding:40px;font:16px sans-serif"><h1>Contenuto</h1></body></html>`;

test('Aiuto dal menu tab apre la sidebar sulla pagina con il contesto della tab', async ({ shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);

  // Id della scheda attiva (è la pagina di test appena aperta).
  const id = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.activeId;
  });
  expect(id).toBeTruthy();

  // All'inizio nessuna sidebar.
  await expect(page.locator('.sn-sidebar')).toHaveCount(0);

  // Invoca "Aiuto" come fa il menu tasto destro.
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);

  // La sidebar Aiuto compare sulla pagina, marcata come invocata da una tab:
  // è la prova che il contesto ha attraversato shell→main→preload→content→sidebar
  // (e, accanto, la riga di contesto è stata iniettata nella storia per l'LLM).
  await expect(page.locator('.sn-sidebar[data-invoked-from="tab"]')).toBeVisible({ timeout: 8_000 });
});

test('Aiuto dal menu Filo della pagina apre la sidebar SENZA marcatura tab', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  // Percorso base: tasto destro sulla pagina → menu Filo → voce "Aiuto".
  await page.locator('h1').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 8_000 });
  await page.locator('.sn-menu').getByText('Aiuto', { exact: true }).click();
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  // Nessun contesto tab in questo cammino.
  expect(await page.locator('.sn-sidebar').getAttribute('data-invoked-from')).toBeNull();
});
