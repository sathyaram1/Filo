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

  // La sidebar Aiuto compare sulla pagina.
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });

  // L'agente ha ricevuto il contesto "tab" con url + titolo della scheda…
  const ctx = await page.evaluate(() => window.SN_SIDEBAR?.getInvocationContext?.() || null);
  expect(ctx).toBeTruthy();
  expect(ctx.source).toBe('tab');
  expect(ctx.title).toContain('Pagina Aiuto Test');

  // …e la riga di contesto è entrata nella storia inviata all'LLM.
  const hist = await page.evaluate(() => window.SN_SIDEBAR?._debugHistory?.() || []);
  const note = hist.find((h) => /tasto destro sulla scheda/.test(h.content || ''));
  expect(note, 'la storia deve contenere la nota di invocazione da tab').toBeTruthy();
});

test('Aiuto via Alt+H (senza contesto tab) continua a funzionare', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  // Apertura diretta senza contesto: nessuna nota di invocazione, sidebar aperta.
  await page.evaluate(() => window.SN_SIDEBAR.open());
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  const ctx = await page.evaluate(() => window.SN_SIDEBAR?.getInvocationContext?.() || null);
  expect(ctx).toBeNull();
});
