// "Chiudi = archivia" + pagina archivio (spec §3.1 / §3.3 / §4).
//
// ASSERISCE il successo: chiudendo una scheda web i suoi metadati finiscono
// nell'archivio e la pagina filo://archive li mostra (raggruppati per giorno,
// con il colore identità per l'ordine cromatico) e permette di riaprirli.
// Senza il fix la tab chiusa spariva del tutto.

import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><head><title>Sito Archivio</title>
  <meta name="theme-color" content="rgb(200, 40, 60)">
</head><body style="margin:0"><div style="height:1200px;background:#fff"></div></body></html>`;

test('chiudere una scheda la archivia e la pagina archivio la mostra', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGE);

  // Aspetta che il colore identità sia stato catturato (così finisce in archivio
  // e abilita l'ordine cromatico).
  const tabId = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.activeId;
  });
  await expect.poll(async () => shell.evaluate(async (id) => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => x.id === id);
    return (t && t.identityColor) || null;
  }, tabId), { timeout: 8_000 }).toMatch(/rgb\(200, 40, 60\)/);

  // Chiudi la scheda → deve essere archiviata.
  await shell.evaluate(async (id) => window.filoShell.tabs.close(id), tabId);

  // Apri la pagina archivio e verifica che la scheda chiusa compaia.
  const archive = await openTab('filo://archive/archive.html');
  await archive.waitForLoadState('domcontentloaded');

  // La riga della scheda archiviata compare, con titolo e URL.
  const row = archive.locator('.arc-tab', { hasText: 'Sito Archivio' });
  await expect(row).toBeVisible({ timeout: 8_000 });
  await expect(row.locator('.arc-url')).toContainText('127.0.0.1');

  // Metadato cromatico preservato: la riga porta il colore identità (--arc-color),
  // usato per l'ordine arcobaleno dentro il giorno.
  const arcColor = await row.evaluate((el) => el.style.getPropertyValue('--arc-color'));
  expect(arcColor).toContain('rgb(200, 40, 60)');

  // È raggruppata sotto un giorno, e oggi → etichetta "Oggi".
  await expect(archive.locator('.arc-day-label', { hasText: 'Oggi' })).toBeVisible();

  // Le pagine interne filo:// NON vengono archiviate (privacy/utilità).
  const hasInternal = await archive.evaluate(() =>
    [...document.querySelectorAll('.arc-url')].some((e) => /filo:\/\//.test(e.textContent || '')));
  expect(hasInternal).toBe(false);

  // "Riapri" riapre l'URL come nuova scheda.
  await row.getByRole('button', { name: 'Riapri' }).click();
  await expect.poll(async () => shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.tabs.some((t) => /127\.0\.0\.1/.test(t.url || ''));
  }), { timeout: 8_000 }).toBe(true);
});
