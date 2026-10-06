// #824 giro 4, rilievo 2: il testo scritto nei riquadri di Filo dentro la pagina (qui il feedback,
// inviato e chiuso) non è testo della pagina e non deve proteggere la scheda dalla pulizia.

import { test, expect } from '../../fixtures/electron.mjs';

async function apriEsatta(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

const titoliAperti = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.title));

test('r2 un feedback a Filo inviato dal riquadro nella pagina non protegge la scheda', async ({ app, shell, testServer }) => {
  const page = await apriEsatta(app, shell, testServer.html('<!doctype html><html><head><title>Articolo</title></head><body><p>Un articolo qualunque.</p></body></html>'));
  // Niente cifratura nel contenitore: l'invio si accoda sul disco come per un utente vero.
  await app.evaluate(() => { globalThis.SN_FEEDBACK.encryptionUnavailable = () => ''; });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => /Articolo/.test(t.title || ''));
    tab.view.webContents.mainFrame.send('filo:broadcast', { type: 'top_frame_command', surface: 'feedback' });
  });
  await expect(page.locator('.sn-fb-text')).toBeVisible({ timeout: 6000 });
  await page.locator('.sn-fb-text').click();
  await page.keyboard.type('Il bottone non funziona');
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 8000 });
  await page.waitForTimeout(800);

  await apriEsatta(app, shell, testServer.html('<!doctype html><title>Altra</title><p>altra pagina'));
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'pulizia' })),
    });
    return win._filoTabs.runAutoTriage({ trigger: 'manual' });
  });
  expect(await titoliAperti(shell)).not.toContain('Articolo');
});
