// #1176, giro 1: nel terminale della dashboard un comando valido che prende il posto di uno rosso resta rosso per
// tutto il controllo «esiste?» (secondi, con la macchina carica), prima di sapere se esiste.
import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function terminale(app, page) {
  await app.evaluate(async ({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes('newtab') || url.includes('dashboard')) {
        wc.send('filo:broadcast', { type: 'settings_updated', settings: { terminal: { enabled: true, shell: 'bash' } } });
      }
    }
  });
  await expect.poll(() => page.evaluate(() => window.SN_DASH_TERMINALE.isEnabled()), { timeout: 8_000 }).toBe(true);
}

// Il controllo finto risponde quando lo dice la prova: è il controllo lento di una macchina carica.
async function whichAComando(page) {
  await page.evaluate(() => {
    const W = { chiamate: [] };
    window.__which = W;
    window.filo.shellWhich = ({ command }) => new Promise((rispondi) => W.chiamate.push({ command, rispondi }));
  });
}
const chiamate = (page, c) => page.evaluate((c) => window.__which.chiamate.filter((x) => x.command === c).length, c);
const rispondi = (page, c, exists) => page.evaluate(({ c, exists }) => {
  const chiamata = window.__which.chiamate.find((x) => x.command === c && !x.fatta);
  chiamata.fatta = true;
  chiamata.rispondi({ ok: true, exists });
}, { c, exists });
const scrivi = (page, v) => page.evaluate((v) => {
  const i = document.getElementById('input');
  i.value = v;
  i.dispatchEvent(new Event('input', { bubbles: true }));
}, v);

test('r1 un comando incollato al posto di uno rosso non è rosso finché il controllo non dice «non esiste»', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });
  await terminale(app, page);
  await whichAComando(page);

  await scrivi(page, '/gti status');
  await expect.poll(() => chiamate(page, 'gti'), { timeout: 8_000 }).toBe(1);
  await rispondi(page, 'gti', false);
  await expect(input).toHaveClass(/is-cmd-unknown/);

  // L'utente corregge il refuso incollando la riga giusta: il controllo è lento (macchina carica).
  await scrivi(page, '/git status');
  await expect.poll(() => chiamate(page, 'git'), { timeout: 8_000 }).toBe(1);
  await page.waitForTimeout(1500);
  await expect(input).not.toHaveClass(/is-cmd-unknown/);
});
