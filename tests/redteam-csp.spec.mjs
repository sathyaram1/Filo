// #600: su un sito con CSP (WhatsApp Web) il pannello "Invia attacco" usciva senza stile, in fondo alla pagina.
// La CSP blocca il <link filo://style/>: il pannello, aperto dal tasto destro, deve stare lo stesso sopra la pagina
// come riquadro di Filo.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { apriRedteamATutti } from './helpers/redteam.mjs';
import { statoDi, neiRiquadri, tastieraDi } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const PAGE = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
  <div style="height:100vh;padding:40px" id="p">Chat del sito, tasto destro qui.</div>
  <div style="height:600px">fondo della pagina</div>
</body></html>`;
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'";

let server;
let origin;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}/`;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

test('su un sito con CSP il pannello "Invia attacco" aperto dal tasto destro è un riquadro di Filo sopra la pagina', async ({ app, shell }) => {
  await apriRedteamATutti(app);
  const port = new URL(origin).port;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origin);
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return new URL(w.url()).port === port; } catch (_) { return false; } });
    return !!page;
  }, { timeout: 12_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');

  // Il link filo://style/ è davvero bloccato: senza insertCSS la prova non direbbe niente.
  const linkBloccato = await page.evaluate(() => {
    const l = document.querySelector('link[href="filo://style/redteam-attack.css"]');
    try { return !l || !l.sheet || l.sheet.cssRules.length === 0; } catch (_) { return true; }
  });
  expect(linkBloccato).toBe(true);

  const voce = menuDi(page).voce('Invia attacco').first();
  await expect.poll(async () => {
    await page.keyboard.press('Escape');
    await page.locator('#p').click({ button: 'right', position: { x: 200, y: 120 } });
    return voce.isVisible();
  }, { timeout: 10_000 }).toBe(true);
  await voce.click();

  // Sui siti il pannello sta nello strato sopra la scheda (#1509.1): la CSP del sito non lo tocca.
  await expect.poll(async () => !!(await statoDi(app, page, '.sn-rt-overlay .sn-rt-modal'))?.visibile, { timeout: 5000 }).toBe(true);
  expect(await page.evaluate(() => document.querySelectorAll('[data-sn-riquadro], .sn-rt-overlay').length), 'niente nel documento del sito').toBe(0);
  const stile = await neiRiquadri(app, page, () => {
    const el = globalThis.SN_FILO_UI._test.trova('.sn-rt-overlay');
    const m = el.querySelector('.sn-rt-modal');
    const r = m.getBoundingClientRect();
    return {
      position: getComputedStyle(el).position,
      zIndex: Number(getComputedStyle(el).zIndex),
      sfondo: getComputedStyle(m).backgroundColor,
      dentroLoSchermo: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
    };
  });
  expect(stile.position, 'redteam-attack.css non applicato sul sito con CSP').toBe('fixed');
  expect(stile.zIndex, 'il pannello deve stare sopra la pagina').toBeGreaterThan(1000);
  expect(stile.sfondo).not.toBe('rgba(0, 0, 0, 0)');
  expect(stile.dentroLoSchermo, 'il pannello è finito fuori dallo schermo').toBe(true);
  // La finestra nascosta dei test non fa avanzare le animazioni: la dissolvenza d'entrata si chiude a mano per la foto.
  const strato = await tastieraDi(app, page);
  await strato.evaluate(() => document.getAnimations().forEach((a) => a.finish())).catch(() => {});
  await strato.screenshot({ path: 'tests/.shots/600-redteam-csp.png' });
});
