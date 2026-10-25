// Verifica #1273 giro 10, porta del giro 9 provata e chiusa: se la copia dell'icona non si scrive (cartella sparita, disco pieno, file bloccato),
// la scheda chiusa deve finire lo stesso nell'archivio e «Salva per dopo» deve salvare lo stesso, senza icona.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { rmSync, writeFileSync } from 'node:fs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const NOMI = ['archiviata.test', 'salvata.test'];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4YaMBAAL8AS3/gzpXAAAAAElFTkSuQmCC', 'base64');

async function sito() {
  const s = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    if (req.url === '/icona.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Pagina di ${host}</title><link rel="icon" href="/icona.png"></head>`
      + `<body style="margin:0;height:100vh"><h1>${host}</h1></body></html>`);
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { porta: s.address().port, close: () => new Promise((r) => { s.closeAllConnections?.(); s.close(r); }) };
}

const iconaArrivata = (app, host) => expect.poll(() => app.evaluate(({ BrowserWindow }, h) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w && w._filoTabs.tabs.find((x) => { try { return new URL(x.url).hostname === h; } catch (_) { return false; } });
  return /^data:image\/png/.test((t && t.favicon) || '');
}, host), { timeout: 15_000 }).toBe(true);

test.describe('copia dell\'icona non scritta', () => {
  test.use({ hostInPiu: NOMI });

  test('la scheda chiusa va nell\'archivio e «Salva per dopo» salva anche se la copia dell\'icona non si scrive', async ({ app, shell, openTab }) => {
    test.setTimeout(90_000);
    const s = await sito();
    try {
      // La cartella delle copie c'era, poi è sparita mentre Filo era aperto: la prossima copia non si scrive.
      const cartella = await app.evaluate(async () => {
        const C = globalThis.__filoCopieIcone;
        await C.conserva('data:image/gif;base64,R0lGODlhAQABAAAAACw=');
        return C.cartella();
      });
      rmSync(cartella, { recursive: true, force: true });
      // Al posto della cartella un file: la copia non si scrive nemmeno rifacendo la cartella.
      writeFileSync(cartella, 'x');

      await openTab(`http://archiviata.test:${s.porta}/a`);
      await iconaArrivata(app, 'archiviata.test');
      const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)
        ._filoTabs.tabs.find((t) => /archiviata\.test/.test(t.url || '')).id);
      await shell.evaluate((i) => window.filoShell.tabs.close(i), id);
      // Morbida: anche «Salva per dopo» si prova, se l'archivio manca.
      await expect.soft(async () => expect(await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).map((t) => t.title)), 'la scheda chiusa non è nell\'archivio')
        .toContain('Pagina di archiviata.test')).toPass({ timeout: 10_000 });

      const pagina = await openTab(`http://salvata.test:${s.porta}/b`);
      await iconaArrivata(app, 'salvata.test');
      await pagina.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
      await pagina.click('body', { button: 'right', position: { x: 300, y: 200 } });
      const salva = menuDi(pagina).locator('.sn-menu [data-sn-icon-id="saveForLater"]');
      await expect(salva).toBeVisible();
      await salva.click();
      await expect.poll(() => app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).map((p) => p.title)), { timeout: 10_000, message: '«Salva per dopo» non ha salvato' })
        .toContain('Pagina di salvata.test');
    } finally {
      await s.close();
    }
  });
});
