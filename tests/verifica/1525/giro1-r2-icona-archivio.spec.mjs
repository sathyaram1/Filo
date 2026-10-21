// #1525 giro 1 — l'icona di una scheda chiusa la sceglie il sito, come indirizzo e titolo: nell'archivio delle schede
// chiuse non deve entrare senza misura (un'icona data: di un mega diventa un mega per ogni chiusura).

import { test, expect } from '../../fixtures/electron.mjs';

test('r2 l’icona di un sito, lunga un mega, non entra intera nell’archivio delle schede chiuse', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const icona = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><!--' + 'a'.repeat(1_000_000) + '--></svg>');
  const url = testServer.html(`<!doctype html><title>Icona lunga</title><link rel="icon" href="${icona}"><p>x</p>`);
  await openTab(url);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => (x.title || '') === 'Icona lunga');
      if (t) return (t.faviconUrl || '').length;
    }
    return 0;
  }), { timeout: 10_000 }).toBeGreaterThan(100_000);
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => (x.title || '') === 'Icona lunga');
      if (t) w._filoTabs.closeTab(t.id);
    }
  });
  let voce = null;
  await expect.poll(async () => {
    voce = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).find((t) => t.title === 'Icona lunga') || null);
    return Boolean(voce);
  }, { timeout: 10_000 }).toBe(true);
  expect((voce.favicon || '').length).toBeLessThanOrEqual(8192);
});
