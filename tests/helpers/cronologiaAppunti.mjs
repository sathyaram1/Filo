// Il pannello della cronologia degli appunti sta in uno shadow root chiuso (#589.8): i locator non ci entrano.
// Lo si legge dall'hook SN_MENU._test nel mondo dei content script: quello isolato sui siti, la pagina su filo://.

import { expect } from '../fixtures/electron.mjs';

const MONDO_CONTENT_SCRIPT = 999;

// { voci: [{ testo, incolla, rimuovi }], vuoto, cerca, svuota, riquadro, lista, sfondo } | null se chiuso.
export async function statoCronologia(app, page) {
  const url = page.url();
  if (url.startsWith('filo://')) return page.evaluate(() => globalThis.SN_MENU?._test?.cronologia() ?? null);
  return app.evaluate(async ({ BrowserWindow }, { u, mondo }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const tab = (win._filoTabs?.tabs || []).find((t) => {
        try { return t.view?.webContents?.getURL() === u; } catch (_) { return false; }
      });
      if (tab) {
        return tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [
          { code: 'globalThis.SN_MENU?._test?.cronologia() ?? null' },
        ]);
      }
    }
    return null;
  }, { u: url, mondo: MONDO_CONTENT_SCRIPT });
}

// Tasto destro vero sul campo, poi la freccetta di Incolla: ritorna lo stato del pannello aperto.
export async function apriCronologia(app, page, campo) {
  await page.locator(campo).click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible();
  const freccia = page.locator('.sn-menu-paste-arrow');
  await expect(freccia).toBeVisible();
  await freccia.click();
  await expect.poll(() => statoCronologia(app, page), { timeout: 5000 }).not.toBeNull();
  return statoCronologia(app, page);
}

// Testi delle voci visibili, quando sono `n` (comodo con expect.poll).
export async function testiCronologia(app, page) {
  const s = await statoCronologia(app, page);
  return s ? s.voci.map((v) => v.testo) : null;
}
