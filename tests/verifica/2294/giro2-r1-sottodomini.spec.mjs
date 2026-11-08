// Verifica #2294 giro 2: la pagina che salta fra i sottodomini dello stesso sito fa una domanda per indirizzo, e il no
// (o il tetto dei cento file in attesa) vale solo per l'indirizzo, non per il sito.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { readdirSync, existsSync } from 'node:fs';

test.use({ hostInPiu: ['*.scarica.test'] });

const DATI = Buffer.from('dati di prova '.repeat(20));

// `/salta?n=K&fino=M`: scarica il file K da sola e passa, da sola, al sottodominio s<K+1> finché K < M.
async function apriServer() {
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/file-')) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': DATI.length, 'Content-Disposition': `attachment; filename="${u.pathname.slice(1)}"` });
      res.end(DATI);
      return;
    }
    const n = Number(u.searchParams.get('n') || 0);
    const fino = Number(u.searchParams.get('fino') || 0);
    const passo = Number(u.searchParams.get('passo') || 1200);
    const porta = srv.address().port;
    const dopo = n < fino ? `http://s${n + 1}.scarica.test:${porta}/salta?n=${n + 1}&fino=${fino}&passo=${passo}` : '';
    const corpo = `<h1>Pagina ${n}</h1><script>
      setTimeout(() => { const a = document.createElement('a'); a.href = '/file-salto-${n}.bin'; a.download = ''; document.body.appendChild(a); a.click(); }, 150);
      ${dopo ? `setTimeout(() => { location.href = ${JSON.stringify(dopo)}; }, ${passo});` : ''}
    </script>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>Salta</title></head><body>${corpo}</body></html>`);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { porta: srv.address().port, async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

const cartella = (app) => app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
const arrivati = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.includes('salto')) : []);
const inAttesa = (shell) => shell.evaluate(async () => {
  const r = await window.filoShell.downloads.list();
  return ((r && r.items) || []).filter((it) => String(it.filename || '').includes('salto') && it.state === 'pending').length;
});

test('r1 un no alla domanda del sito toglie tutti i file del sito in attesa, e la pagina che continua a saltare non chiede più', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await cartella(app);
    const page = await openTab(`http://s0.scarica.test:${srv.porta}/salta?n=0&fino=5`);
    await expect.poll(() => inAttesa(shell), { timeout: 30_000 }).toBe(5);
    const barra = shell.locator('#permesso-bar');
    await expect(barra).toBeVisible({ timeout: 10_000 });
    await barra.locator('.permesso-no').click();
    await expect.poll(() => inAttesa(shell), { timeout: 10_000 }).toBeLessThan(5);
    await page.waitForTimeout(3_000);
    expect.soft(await inAttesa(shell), 'file del sito ancora in attesa dopo il no').toBe(0);
    const prima = await inAttesa(shell);
    // Il sito ha avuto un no: altre tre pagine dello stesso sito non scaricano e non chiedono.
    await page.goto(`http://s6.scarica.test:${srv.porta}/salta?n=6&fino=8`);
    await page.waitForTimeout(5_000);
    await shell.screenshot({ path: 'tests/.shots/2294-v2-dopo-il-no.png' });
    expect.soft(await inAttesa(shell) - prima, 'file nuovi in attesa dopo il no al sito').toBe(0);
    await expect.soft(barra, 'la domanda torna dopo il no al sito').toBeHidden();
    expect(arrivati(dir)).toEqual(['file-salto-0.bin']);
  } finally {
    await srv.close();
  }
});

test('r1 il tetto dei cento file in attesa vale per il sito: una pagina che salta fra i sottodomini non lo supera', async ({ shell, openTab }) => {
  test.setTimeout(240_000);
  const srv = await apriServer();
  try {
    await openTab(`http://s0.scarica.test:${srv.porta}/salta?n=0&fino=110&passo=500`);
    await expect.poll(() => shell.evaluate(() => document.title), { timeout: 5_000 }).toBeTruthy();
    // La pagina fa 110 salti: aspetta che l'ultimo sia arrivato, poi conta.
    await expect.poll(async () => shell.evaluate(async () => {
      const r = await window.filoShell.downloads.list();
      return ((r && r.items) || []).some((it) => String(it.filename || '').includes('salto-110'));
    }).catch(() => false), { timeout: 200_000, intervals: [2_000] }).toBe(true).catch(() => {});
    const n = await inAttesa(shell);
    expect(n, `file del sito in attesa: ${n}`).toBeLessThanOrEqual(100);
  } finally {
    await srv.close();
  }
});
