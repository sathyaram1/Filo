// "Chiudi = archivia" (spec §3.1): chiudendo una scheda web i suoi metadati finiscono nell'archivio delle schede chiuse,
// col colore identità, e la scheda si ritrova e si riapre dalla ricerca del filo nella home. La pagina Cronologia non
// c'è più: il quaderno delle memorie ne ha preso il posto (#872). Senza l'archivio la tab chiusa spariva del tutto.

import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><head><title>Sito Archivio</title>
  <meta name="theme-color" content="rgb(200, 40, 60)">
</head><body style="margin:0"><div style="height:1200px;background:#fff"></div></body></html>`;

test('chiudere una scheda la archivia, e dalla ricerca del filo si ritrova e si riapre', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGE);
  const tabId = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await expect.poll(async () => shell.evaluate(async (id) => {
    const t = (await window.filoShell.tabs.snapshot()).tabs.find((x) => x.id === id);
    return (t && t.identityColor) || null;
  }, tabId), { timeout: 8_000 }).toMatch(/rgb\(200, 40, 60\)/);

  await shell.evaluate(async (id) => window.filoShell.tabs.close(id), tabId);
  await expect.poll(async () => (await app.evaluate(() => globalThis.SN_ARCHIVED_TABS.list()))
    .some((t) => t.title === 'Sito Archivio' && /rgb\(200, 40, 60\)/.test(t.identityColor || '')), { timeout: 8_000 }).toBe(true);

  const home = await openTab('filo://newtab/');
  // Le pagine interne filo:// non entrano nell'archivio.
  expect((await app.evaluate(() => globalThis.SN_ARCHIVED_TABS.list())).some((t) => /^filo:/.test(t.url))).toBe(false);
  await home.locator('#cercaInput').fill('Sito Archivio');
  const voce = home.locator('.dash-cerca-pagina', { hasText: 'Sito Archivio' });
  await expect(voce).toBeVisible({ timeout: 8_000 });
  await voce.click();
  await expect.poll(async () => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs
    .some((t) => /127\.0\.0\.1/.test(t.url || ''))), { timeout: 8_000 }).toBe(true);
});
