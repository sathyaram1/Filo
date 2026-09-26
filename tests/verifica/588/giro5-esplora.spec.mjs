// Verifica #588, giro 5: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const EXE = Buffer.from('MZ finto eseguibile di prova\n' + 'z'.repeat(2048));
const SHOTS = join(process.cwd(), 'tests', '.shots', 'verifica-588');

async function server(pagine) {
  const srv = createServer((req, res) => {
    const p = String(req.url || '').split('?')[0];
    if (pagine[p]) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(pagine[p]);
      return;
    }
    if (p === '/lento.exe') {
      const tot = 64 * 1024 * 200;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': tot, 'Content-Disposition': 'attachment; filename="lento.exe"' });
      let mandati = 0;
      const t = setInterval(() => {
        if (mandati >= tot || res.destroyed) { clearInterval(t); res.end(); return; }
        res.write(Buffer.alloc(64 * 1024, 1)); mandati += 64 * 1024;
      }, 100);
      return;
    }
    const nome = p.split('/').pop() || 'x.exe';
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': EXE.length, 'Content-Disposition': `attachment; filename="${nome}"` });
    res.end(EXE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  return { porta, async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

const elenco = (shell) => shell.evaluate(() => window.filoShell.downloads.list());
const voce = async (shell, nome) => ((await elenco(shell))?.items || []).find((it) => it.filename === nome) || null;
const statoDi = async (shell, nome) => (await voce(shell, nome))?.state ?? null;
const contenuto = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

test('un programma da un riquadro di terzi (data:) dentro un sito: a chi viene attribuito, e il sito fidato', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  const pagine = {};
  const srv = await server(pagine);
  try {
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    pagine['/top.html'] = `<!doctype html><html><body><h1>Forum</h1>
      <iframe id="ad" src="http://127.0.0.1:${srv.porta}/ad.html" width="400" height="200"></iframe></body></html>`;
    pagine['/ad.html'] = `<!doctype html><html><body>
      <a id="data" download="dalriquadro.exe" href="data:application/octet-stream;base64,TVoBAgME">data</a>
      <a id="http" href="/dalriquadro-http.exe">http</a></body></html>`;

    const page = await openTab(`http://blocked.test:${srv.porta}/top.html`);
    const ad = page.frameLocator('#ad');
    await ad.locator('#data').click();
    await expect.poll(() => statoDi(shell, 'dalriquadro.exe'), { timeout: 20000 }).not.toBeNull();
    const r1 = await voce(shell, 'dalriquadro.exe');
    console.log('SENZA FIDUCIA data: dal riquadro 127.0.0.1 →', r1.state, 'site=', r1.site);

    // Ora l'utente si fida del sito che visita.
    const sec = await openTab('filo://security/');
    await sec.locator('#sec-dl-trusted').fill('blocked.test');
    await sec.locator('#sec-dl-trusted').press('Tab');
    await expect.poll(() => sec.evaluate(() => window.SN_STORAGE.getSettings().then((x) => x.security.downloads.trustedSites)), { timeout: 10000 }).toEqual(['blocked.test']);
    await sec.close?.();

    const page2 = await openTab(`http://blocked.test:${srv.porta}/top.html?2`);
    const ad2 = page2.frameLocator('#ad');
    await ad2.locator('#http').click();
    await expect.poll(() => statoDi(shell, 'dalriquadro-http.exe'), { timeout: 20000 }).not.toBeNull();
    const r2 = await voce(shell, 'dalriquadro-http.exe');
    console.log('FIDUCIA blocked.test, http dal riquadro →', r2.state, 'site=', r2.site);

    await ad2.locator('#data').click();
    await expect.poll(async () => ((await elenco(shell)).items || []).filter((x) => /^dalriquadro( \(\d+\))?\.exe$/.test(x.filename)).length, { timeout: 20000 }).toBe(2);
    await shell.waitForTimeout(1500);
    const tutti = ((await elenco(shell)).items || []).filter((x) => /^dalriquadro/.test(x.filename));
    console.log('FIDUCIA blocked.test, data: dal riquadro →', JSON.stringify(tutti.map((x) => [x.filename, x.state, x.site])));
    console.log('cartella Download:', contenuto(dir));
    const bypass = tutti.find((x) => x.filename !== 'dalriquadro.exe' || x.id !== r1.id);
    expect(r2.state, 'http dal riquadro di terzi deve chiedere').toBe('pending');
    expect(bypass.state, 'data: dal riquadro di terzi: stesso file, stessa terza parte, deve chiedere come l\'http').toBe('pending');
  } finally { await srv.close(); }
});

test('«Scarica» mentre il programma scende lento: quanti clic vanno a vuoto', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  const pagine = {};
  const srv = await server(pagine);
  try {
    pagine['/p.html'] = `<!doctype html><html><body style="padding:40px"><a id="l" href="/lento.exe">lento</a></body></html>`;
    const page = await openTab(`http://127.0.0.1:${srv.porta}/p.html`);
    await page.locator('#l').click();
    const riga = shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: 'lento.exe' });
    const si = riga.locator('.dl-row-btn', { hasText: /^Scarica$/ });
    await expect(si).toBeEnabled({ timeout: 10000 });
    // Quanto spesso il pulsante viene rifatto.
    await shell.evaluate(() => {
      window.__rifatti = 0;
      const l = document.querySelector('#dl-panel-list');
      new MutationObserver(() => { window.__rifatti++; }).observe(l, { childList: true });
    });
    await shell.waitForTimeout(3000);
    const rifatti = await shell.evaluate(() => window.__rifatti);
    console.log('ricostruzioni in 3 s:', rifatti);
    await shell.screenshot({ path: join(SHOTS, 'lento-chiaro.png') }).catch(() => {});
    let tentativi = 0;
    while (tentativi < 8 && (await statoDi(shell, 'lento.exe')) === 'pending') {
      tentativi++;
      const b = await si.boundingBox();
      if (!b) break;
      await app.evaluate(async ({ BrowserWindow }, [x, y]) => {
        const w = BrowserWindow.getAllWindows().find((z) => z._filoTabs);
        w.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        w.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        await new Promise((r) => setTimeout(r, 180));
        w.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      }, [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]);
      await shell.waitForTimeout(700);
    }
    const stato = await statoDi(shell, 'lento.exe');
    console.log('clic necessari per «Scarica»:', tentativi, 'stato finale:', stato);
    expect(tentativi, 'il primo clic su «Scarica» deve bastare').toBe(1);
  } finally { await srv.close(); }
});

test('aspetto della domanda: chiaro, scuro, nome lunghissimo', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  mkdirSync(SHOTS, { recursive: true });
  const pagine = {};
  const srv = await server(pagine);
  try {
    const lungo = 'Aggiornamento_urgente_del_driver_della_scheda_video_versione_finale_definitiva_2026_installer_completo_per_tutti.exe';
    pagine['/p.html'] = `<!doctype html><html><body style="padding:40px"><a id="l" href="/${lungo}">lungo</a> <a id="c" href="/setup.exe">corto</a></body></html>`;
    const page = await openTab(`http://127.0.0.1:${srv.porta}/p.html`);
    await page.locator('#c').click();
    await page.locator('#l').click();
    await expect(shell.locator('#dl-panel .dl-row[data-chiede="1"]')).toHaveCount(2, { timeout: 15000 });
    await shell.waitForTimeout(1300);
    await shell.screenshot({ path: join(SHOTS, 'domanda-chiaro.png') });
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
    await shell.waitForTimeout(800);
    await shell.screenshot({ path: join(SHOTS, 'domanda-scuro.png') });
    const pann = await shell.locator('#dl-panel').boundingBox();
    const win = await shell.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    console.log('pannello', JSON.stringify(pann), 'finestra', JSON.stringify(win));
    expect(pann.x + pann.width).toBeLessThanOrEqual(win.w + 1);
  } finally { await srv.close(); }
});
