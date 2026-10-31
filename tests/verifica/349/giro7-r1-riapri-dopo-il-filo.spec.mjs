// Verifica #349 giro 7: «Riapri» dell'avviso della pulizia su una scheda che l'utente ha già riaperto dal filo della
// home e poi richiuso. Riaprirla dal filo è un'altra porta delle riaperture: dopo, «Riapri» non la deve ridare.

import { test, expect, aspettaFinestra } from '../../fixtures/electron.mjs';

test('r1 una scheda riaperta dal filo della home e richiusa non torna due volte fra «Riapri» e la scorciatoia', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const titoli = () => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.title));
  const url = testServer.html('<!doctype html><title>Uno</title><h1>Uno</h1>');
  await openTab(url);
  await openTab(testServer.html('<!doctype html><title>Altra</title><h1>Altra</h1>'));
  await openTab('filo://history/history.html');
  const home = app.windows().find((w) => { try { return w.url().startsWith('filo://history'); } catch (_) { return false; } });
  await home.waitForLoadState('domcontentloaded');

  // La pulizia chiude «Uno» e l'avviso offre «Riapri».
  const esito = await app.evaluate(async ({ BrowserWindow }) => {
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({ decisions: tabs.map((t, i) => ({ i, action: /Uno/.test(t.title || '') ? 'archive' : 'keep', reason: 'test' })) });
    return BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.runAutoTriage({ trigger: 'manual' });
  });
  expect(esito.archived).toBe(1);
  const vista = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/avvisi.html'), 'la vista degli avvisi non è nata');
  await expect(vista.locator('.shell-notif.show', { hasText: 'chiusa' }).locator('.shell-notif-action', { hasText: 'Riapri' })).toBeEnabled({ timeout: 10_000 });

  // L'utente la riapre dal filo della home, la guarda e la richiude.
  let voce = null;
  await expect.poll(async () => {
    voce = await app.evaluate(async (_e, u) => (await globalThis.SN_ARCHIVED_TABS.list()).find((t) => t.url === u) || null, url);
    return !!voce;
  }, { timeout: 8000 }).toBe(true);
  await home.evaluate((id) => chrome.runtime.sendMessage({ type: 'reopen_archived_tab', id }), voce.id);
  await expect.poll(titoli, { timeout: 15_000 }).toContain('Uno');
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    t.closeTab(t.tabs.find((x) => /Uno/.test(x.title || '')).id, { via: 'x' });
  }, null);
  await expect.poll(titoli, { timeout: 10_000 }).not.toContain('Uno');

  // «Riapri» sull'avviso (con la durata degli avvisi a «finché non lo chiudo» resta lì), poi la scorciatoia.
  await app.evaluate(async ({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    return t.riapriPulizia(t._ultimaPulizia && t._ultimaPulizia.id);
  }, null);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.riapriChiusa(), null);
  await new Promise((r) => setTimeout(r, 3000));
  expect((await titoli()).filter((t) => t === 'Uno'), 'la scheda torna due volte: «Riapri» non sa che era già stata riaperta dal filo').toHaveLength(1);
});
