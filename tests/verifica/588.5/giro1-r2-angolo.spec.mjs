// Verifica #588.5 giro 1, rilievo 2: un avviso della barra e un avviso di Filo nella pagina
// («Copiato negli appunti») comparsi insieme non si coprono: l'angolo è uno solo.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const PDF = Buffer.from('%PDF-1.4\n% prova\n' + 'x'.repeat(2048));

test('«Scaricato» sopra la pagina non copre «Copiato negli appunti» della pagina', async ({ app, openTab, avvisi }) => {
  const srv = createServer((req, res) => {
    if (req.url === '/pagina') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
        <a id="pdf" href="/report.pdf">report</a><br><br>
        <a id="link" href="https://example.com/articolo">Un collegamento di prova</a></body></html>`);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': PDF.length,
      'Content-Disposition': 'attachment; filename="report.pdf"',
    });
    res.end(PDF);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const page = await openTab(`http://127.0.0.1:${srv.address().port}/pagina`);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

    await page.locator('#pdf').click();
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show .shell-notif-msg')).toHaveText('Scaricato: report.pdf', { timeout: 15_000 });

    // Un'azione di Filo sulla pagina, dal tasto destro, che risponde col suo avviso.
    const menu = page.locator('.sn-menu');
    let fatto = false;
    for (let i = 0; i < 6 && !fatto; i++) {
      await page.locator('#link').click({ button: 'right', position: { x: 8, y: 8 } });
      const voce = menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'immagine' });
      try {
        await voce.first().waitFor({ state: 'visible', timeout: 1500 });
        await voce.first().click();
        fatto = true;
      } catch (_) { await page.waitForTimeout(200); }
    }
    expect(fatto, 'voce «Copia URL» non raggiungibile').toBe(true);
    await expect(page.locator('.sn-toast')).toHaveCount(1, { timeout: 5000 });
    await expect(vista.locator('.shell-notif.show')).toHaveCount(1);

    const viste = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      const tm = win._filoTabs;
      const tab = tm.tabs.find((t) => t.id === tm.activeId);
      return { avvisi: tm.avvisi.vista.getBounds(), scheda: tab.view.getBounds() };
    });
    const toast = await page.evaluate(() => {
      const r = document.querySelector('.sn-toast').getBoundingClientRect();
      return { x: r.left, y: r.top, right: r.right, bottom: r.bottom };
    });
    const carta = await vista.evaluate(() => {
      const r = document.querySelector('.shell-notif').getBoundingClientRect();
      return { x: r.left, y: r.top, right: r.right, bottom: r.bottom };
    });
    // La carta della barra, nelle coordinate della pagina.
    const dx = viste.avvisi.x - viste.scheda.x;
    const dy = viste.avvisi.y - viste.scheda.y;
    const c = { x: carta.x + dx, y: carta.y + dy, right: carta.right + dx, bottom: carta.bottom + dy };
    const coperto = toast.x < c.right && c.x < toast.right && toast.y < c.bottom && c.y < toast.bottom;
    expect(coperto, `l'avviso della pagina ${JSON.stringify(toast)} sta sotto quello della barra ${JSON.stringify(c)}`).toBe(false);
  } finally {
    await new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); });
  }
});
