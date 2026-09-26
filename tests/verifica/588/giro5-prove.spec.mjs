// Verifica #588, giro 5: i tre rilievi interni del giro, ognuno rosso finché
// non è curato. Si rilanciano con: npx playwright test tests/verifica/588
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';

const EXE = Buffer.from('MZ finto eseguibile di prova\n' + 'z'.repeat(2048));

// Pagine su richiesta, `/lento.exe` che scende in una ventina di secondi, e
// qualunque altro nome come programma allegato.
async function server(pagine) {
  const srv = createServer((req, res) => {
    const p = String(req.url || '').split('?')[0];
    if (pagine[p]) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(pagine[p]); return; }
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

const elenco = async (shell) => ((await shell.evaluate(() => window.filoShell.downloads.list()))?.items || []);
const voce = async (shell, nome) => (await elenco(shell)).find((it) => it.filename === nome) || null;
const statoDi = async (shell, nome) => (await voce(shell, nome))?.state ?? null;
const contenuto = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

// Un riquadro di terzi (la pubblicità) dentro un sito: il programma che fa
// scaricare viene da lui, qualunque sia il modo in cui lo consegna.
test('giro 5: un programma consegnato come data: da un riquadro di terzi non prende il nome né la fiducia del sito che lo ospita', async ({ app, shell, openTab }) => {
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

    // L'utente si fida del sito che visita (blocked.test risolve sul loopback).
    const sec = await openTab('filo://security/');
    await sec.locator('#sec-dl-trusted').fill('blocked.test');
    await sec.locator('#sec-dl-trusted').press('Tab');
    await expect.poll(() => sec.evaluate(() => window.SN_STORAGE.getSettings().then((x) => x.security.downloads.trustedSites)), { timeout: 10000 }).toEqual(['blocked.test']);

    const page = await openTab(`http://blocked.test:${srv.porta}/top.html`);
    const ad = page.frameLocator('#ad');

    // Col collegamento normale il riquadro è riconosciuto: chiede, e dice da dove.
    await ad.locator('#http').click();
    await expect.poll(() => statoDi(shell, 'dalriquadro-http.exe'), { timeout: 20000 }).toBe('pending');
    expect((await voce(shell, 'dalriquadro-http.exe')).site).toBe('127.0.0.1');

    // Stesso riquadro, stesso programma, consegnato come data:.
    await ad.locator('#data').click();
    await expect.poll(() => voce(shell, 'dalriquadro.exe'), { timeout: 20000 }).not.toBeNull();
    await shell.waitForTimeout(1500);
    const r = await voce(shell, 'dalriquadro.exe');
    expect(contenuto(dir), 'il programma del riquadro è entrato in Download senza domanda').not.toContain('dalriquadro.exe');
    expect(r.state).toBe('pending');
    expect(r.site, 'la domanda attribuisce il programma al sito che ospita il riquadro').not.toBe('blocked.test');
  } finally { await srv.close(); }
});

// Un programma vero pesa decine di megabyte: mentre l'utente legge la domanda
// sta ancora scendendo, e la riga si rifà a ogni avanzamento.
test('giro 5: «Scarica» risponde al primo clic anche mentre il programma sta ancora scendendo', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  const pagine = {};
  const srv = await server(pagine);
  try {
    pagine['/p.html'] = '<!doctype html><html><body style="padding:40px"><a id="l" href="/lento.exe">scarica</a></body></html>';
    const page = await openTab(`http://127.0.0.1:${srv.porta}/p.html`);
    await page.locator('#l').click();
    const si = shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: 'lento.exe' }).locator('.dl-row-btn', { hasText: /^Scarica$/ });
    await expect(si).toBeEnabled({ timeout: 10000 });
    await shell.waitForTimeout(1500);
    const b = await si.boundingBox();
    // Un clic lento ma umano: il tasto resta giù più a lungo di un avanzamento
    // (così il rosso non dipende dalla fortuna; a 120 ms va a vuoto uno su due).
    await app.evaluate(async ({ BrowserWindow }, [x, y]) => {
      const w = BrowserWindow.getAllWindows().find((z) => z._filoTabs);
      w.webContents.sendInputEvent({ type: 'mouseMove', x, y });
      w.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 650));
      w.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    }, [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]);
    await expect.poll(() => statoDi(shell, 'lento.exe'), { timeout: 3000, message: 'il primo clic su «Scarica» è andato a vuoto' }).not.toBe('pending');
  } finally { await srv.close(); }
});

test('giro 5: un nome lungo senza spazi si legge tutto nella domanda, senza scorrere di lato', async ({ shell, openTab }) => {
  test.setTimeout(150_000);
  const pagine = {};
  const srv = await server(pagine);
  try {
    const lungo = 'Aggiornamento_urgente_del_driver_della_scheda_video_versione_finale_2026_installer_completo.exe';
    pagine['/p.html'] = `<!doctype html><html><body style="padding:40px"><a id="l" href="/${lungo}">scarica</a></body></html>`;
    const page = await openTab(`http://127.0.0.1:${srv.porta}/p.html`);
    await page.locator('#l').click();
    const ask = shell.locator('#dl-panel .dl-row[data-chiede="1"] .dl-row-ask');
    await expect(ask).toBeVisible({ timeout: 15000 });
    const misure = await shell.evaluate(() => {
      const a = document.querySelector('#dl-panel .dl-row[data-chiede="1"] .dl-row-ask');
      const l = document.querySelector('#dl-panel-list');
      return { ask: [a.scrollWidth, a.clientWidth], lista: [l.scrollWidth, l.clientWidth] };
    });
    expect(misure.ask[0], 'il nome esce dal bordo della domanda').toBeLessThanOrEqual(misure.ask[1] + 1);
    expect(misure.lista[0], 'il pannello scorre di lato').toBeLessThanOrEqual(misure.lista[1] + 1);
  } finally { await srv.close(); }
});
