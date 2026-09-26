// Verifica #588 giro 4 — un doppio clic su un elemento della pagina non deve
// rispondere «Scarica» alla domanda che il primo clic ha fatto comparire lì sotto.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';

const EXE = Buffer.from('MZ finto\n' + 'z'.repeat(4096));

async function apriServer() {
  const srv = createServer((req, res) => {
    const nome = decodeURIComponent(String(req.url || '').split('?')[0].split('/').pop()) || 'x';
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': EXE.length,
      'Content-Disposition': `attachment; filename="${nome}"` });
    res.end(EXE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { base, async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

const elenco = async (shell) => ((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];
const statoDi = async (shell, nome) => (await elenco(shell)).find((x) => x.filename === nome)?.state ?? null;
const riga = (shell, nome) => shell.locator('#dl-panel .dl-row', { hasText: nome });

async function vistaPagina(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w && w._filoTabs;
    const t = tm && tm.tabs.find((x) => x.id === tm.activeId);
    return t ? t.view.getBounds() : null;
  });
}
test('doppio clic: il «Scarica» del pannello compare sotto il cursore di chi ha cliccato la pagina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0">
      <a id="p" style="display:block;margin:200px" href="${srv.base}/prova.exe">p</a>
      <a id="t" href="${srv.base}/trappola.exe" style="position:absolute;left:-100px;top:-100px;width:10px;height:10px;background:#c00;display:block"></a></body>`);
    const v0 = await vistaPagina(app);
    await page.locator('#p').click();
    const r0 = riga(shell, 'prova.exe');
    const btn0 = r0.locator('.dl-row-btn', { hasText: /^Scarica$/ });
    await expect(btn0).toBeVisible({ timeout: 10000 });
    const b = await btn0.boundingBox();
    await r0.locator('.dl-row-btn', { hasText: 'Non scaricare' }).click();
    await expect.poll(() => statoDi(shell, 'prova.exe')).toBe('cancelled');
    await shell.locator('#dl-indicator').click();
    await expect(shell.locator('#dl-panel')).toBeHidden();
    await expect.poll(async () => (await vistaPagina(app)).y).toBe(v0.y);
    // la trappola della pagina esattamente dove comparirà «Scarica»
    const px = Math.round(b.x + b.width / 2 - v0.x); const py = Math.round(b.y + b.height / 2 - v0.y);
    await page.evaluate(([x, y]) => { const t = document.getElementById('t'); t.style.left = (x - 5) + 'px'; t.style.top = (y - 5) + 'px'; }, [px, py]);
    const t0 = Date.now();
    await page.mouse.click(px, py);
    const btn = riga(shell, 'trappola.exe').locator('.dl-row-btn', { hasText: /^Scarica$/ });
    let ms = -1;
    for (let i = 0; i < 400; i++) {
      const bb = await btn.boundingBox().catch(() => null);
      if (bb && bb.x <= b.x + b.width / 2 && b.x + b.width / 2 <= bb.x + bb.width && bb.y <= b.y + b.height / 2 && b.y + b.height / 2 <= bb.y + bb.height) { ms = Date.now() - t0; break; }
      await shell.waitForTimeout(10);
    }
    expect(ms, 'la domanda non è comparsa').toBeGreaterThan(-1);
    // secondo clic dello stesso doppio clic, stesso punto della finestra: ora è la barra a riceverlo
    const cx = Math.round(b.x + b.width / 2); const cy = Math.round(b.y + b.height / 2);
    await app.evaluate(({ BrowserWindow }, [x, y]) => {
      const w = BrowserWindow.getAllWindows().find((z) => z._filoTabs);
      w.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      w.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    }, [cx, cy]);
    await shell.waitForTimeout(1500);
    // Il secondo clic di un doppio clic sulla pagina non è una risposta letta:
    // il programma deve restare in attesa.
    expect(await statoDi(shell, 'trappola.exe')).toBe('pending');
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    expect(existsSync(dir) ? readdirSync(dir) : []).not.toContain('trappola.exe');
  } finally { await srv.close(); }
});
