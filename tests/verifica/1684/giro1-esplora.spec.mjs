// Verifica #1684, giro 1: le strade del pacchetto scaricamenti che il caso felice non percorre.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PDF = Buffer.from('%PDF-1.4\n% finto pdf di prova\n' + 'x'.repeat(4096));
const EXE = Buffer.from('MZ finto eseguibile di prova\n' + 'z'.repeat(2048));

async function apriServer() {
  const falliti = new Map();
  const usati = new Set();
  let gettone = 0;
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const nome = decodeURIComponent(u.pathname.split('/').pop() || 'file.pdf');
    const corpo = nome.endsWith('.pdf') ? PDF : EXE;
    const tipo = nome.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
    const testa = (len) => ({ 'Content-Type': tipo, 'Content-Length': len, 'Content-Disposition': `attachment; filename="${nome}"` });
    if (u.pathname.startsWith('/pagina/')) {
      const dove = u.searchParams.get('verso') || 'file';
      const link = nome.split(',').map((n, i) => `<a id="l${i}" download href="/${dove}/${n}">${n}</a>`).join(' ');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body style="padding:40px">${link}</body></html>`);
      return;
    }
    // Il link cliccato rimanda a un indirizzo firmato che vale una volta sola, come fanno i siti dei file grandi.
    if (u.pathname.startsWith('/rimando/')) {
      gettone += 1;
      res.writeHead(302, { Location: `/firmato/${encodeURIComponent(nome)}?t=${gettone}` });
      res.end();
      return;
    }
    if (u.pathname.startsWith('/firmato/')) {
      const t = u.searchParams.get('t');
      if (usati.has(t)) { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('firma scaduta'); return; }
      usati.add(t);
      const volte = (falliti.get(nome) || 0) + 1;
      falliti.set(nome, volte);
      if (volte === 1) { res.writeHead(503, { 'Content-Type': 'text/plain' }); res.end('occupato'); return; }
      res.writeHead(200, testa(corpo.length));
      res.end(corpo);
      return;
    }
    // Le prime `n` richieste di quel nome falliscono, poi il file.
    if (u.pathname.startsWith('/fallisce/')) {
      const n = Number(u.searchParams.get('n') || 1);
      const volte = (falliti.get(nome) || 0) + 1;
      falliti.set(nome, volte);
      if (volte <= n) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('non ancora'); return; }
      res.writeHead(200, testa(corpo.length));
      res.end(corpo);
      return;
    }
    if (u.pathname.startsWith('/insieme/')) {
      res.writeHead(200, testa(corpo.length));
      res.flushHeaders();
      setTimeout(() => res.end(corpo), 1500);
      return;
    }
    // Metà in fretta, poi la rete si ferma per `ferma` ms, poi il resto.
    if (u.pathname.startsWith('/stallo/')) {
      const pezzo = Buffer.alloc(64 * 1024, 0x61);
      const pezzi = 20;
      const ferma = Number(u.searchParams.get('ferma') || 20000);
      res.writeHead(200, testa(pezzo.length * pezzi));
      let n = 0;
      const t = setInterval(() => {
        if (res.destroyed) { clearInterval(t); return; }
        res.write(pezzo);
        n += 1;
        if (n === pezzi / 2) {
          clearInterval(t);
          setTimeout(() => {
            const t2 = setInterval(() => {
              if (res.destroyed) { clearInterval(t2); return; }
              res.write(pezzo);
              if (++n >= pezzi) { clearInterval(t2); res.end(); }
            }, 100);
          }, ferma);
        }
      }, 250);
      return;
    }
    res.writeHead(200, testa(corpo.length));
    res.end(corpo);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

const elenco = async (shell) => ((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];
const voce = async (shell, prova) => (await elenco(shell)).find(prova) || null;
const cartella = (app) => app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
const contenuto = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

async function paginaDelServer(openTab, url) {
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

test('«Riprova» di un file servito da un link firmato riparte dal link cliccato e arriva', async ({ app, shell, openTab, avvisi }) => {
  test.setTimeout(60_000);
  const srv = await apriServer();
  try {
    const dir = await cartella(app);
    const page = await paginaDelServer(openTab, `${srv.base}/pagina/estratto.pdf?verso=rimando`);
    await page.locator('#l0').click();
    let primo = null;
    await expect.poll(async () => {
      primo = await voce(shell, (x) => /\/firmato\/estratto\.pdf/.test(x.url));
      return primo && primo.state;
    }, { timeout: 30000 }).toBe('interrupted');
    const vista = await avvisi();
    const carta = vista.locator('.shell-notif', { hasText: 'Scaricamento non riuscito' }).last();
    await expect(carta).toBeVisible({ timeout: 10000 });
    await carta.locator('.shell-notif-action', { hasText: 'Riprova' }).click();
    await expect.poll(async () => (await voce(shell, (x) => x.id === primo.id))?.state, { timeout: 40000 }).toBe('completed');
    expect(contenuto(dir)).toContain('estratto.pdf');
  } finally { await srv.close(); }
});

test('mentre la rete è ferma la riga non continua a dire la velocità di prima', async ({ shell, openTab }) => {
  test.setTimeout(90_000);
  const srv = await apriServer();
  try {
    const page = await paginaDelServer(openTab, `${srv.base}/pagina/fermo.pdf?verso=stallo`);
    await page.locator('#l0').click();
    await expect.poll(async () => (await voce(shell, (x) => x.filename === 'fermo.pdf'))?.velocita || 0, { timeout: 15000 }).toBeGreaterThan(0);
    const dl = await openTab('filo://downloads/downloads.html');
    const meta = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'fermo.pdf' }) }).locator('.dl-meta');
    await expect(meta).toHaveText(/KB\/s/, { timeout: 10000 });
    // A metà la rete si ferma per 20 s: dopo 10 s di fermo la riga non può dire ancora «… KB/s · ancora 2 s».
    await expect.poll(async () => (await voce(shell, (x) => x.filename === 'fermo.pdf'))?.receivedBytes || 0, { timeout: 15000 }).toBe(10 * 64 * 1024);
    await dl.waitForTimeout(10000);
    expect((await voce(shell, (x) => x.filename === 'fermo.pdf')).state).toBe('progressing');
    await expect(meta).not.toHaveText(/ancora \d+ s$/);
  } finally { await srv.close(); }
});

test('tre copie dello stesso programma avviate insieme, confermate tutte, arrivano tutte', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  const srv = await apriServer();
  try {
    const dir = await cartella(app);
    const page = await paginaDelServer(openTab, `${srv.base}/pagina/setup.exe?verso=insieme`);
    await page.evaluate(() => { for (let i = 0; i < 3; i++) document.getElementById('l0').click(); });
    const attesa = async () => (await elenco(shell)).filter((r) => r.url.endsWith('/insieme/setup.exe') && r.state === 'pending');
    await expect.poll(async () => (await attesa()).length, { timeout: 15000 }).toBe(3);
    for (const r of await attesa()) await shell.evaluate((id) => window.filoShell.downloads.confirm(id, true), r.id);
    const finiti = async () => (await elenco(shell)).filter((r) => r.url.endsWith('/insieme/setup.exe') && r.state === 'completed');
    await expect.poll(async () => (await finiti()).length, { timeout: 20000 }).toBe(3);
    const nomi = (await finiti()).map((r) => r.filename).sort();
    expect(nomi).toEqual(['setup (2).exe', 'setup (3).exe', 'setup.exe']);
    for (const n of nomi) expect(statSync(join(dir, n)).size).toBe(EXE.length);
  } finally { await srv.close(); }
});

test('due copie dello stesso file fallite insieme, riprovate insieme, arrivano tutte e due', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  const srv = await apriServer();
  try {
    const dir = await cartella(app);
    const page = await paginaDelServer(openTab, `${srv.base}/pagina/doppia.pdf?verso=fallisce`);
    await page.evaluate(() => { document.querySelectorAll('a').forEach((a) => { a.href += '?n=2'; }); });
    await page.locator('#l0').click();
    await page.locator('#l0').click();
    const rotti = async () => (await elenco(shell)).filter((r) => r.url.includes('/fallisce/doppia.pdf') && r.state === 'interrupted');
    await expect.poll(async () => (await rotti()).length, { timeout: 30000 }).toBe(2);
    const ids = (await rotti()).map((r) => r.id);
    await Promise.all(ids.map((id) => shell.evaluate((i) => window.filoShell.downloads.riprova(i), id)));
    await expect.poll(async () => {
      const l = await elenco(shell);
      return ids.map((id) => l.find((r) => r.id === id)?.state).join(',');
    }, { timeout: 30000 }).toBe('completed,completed');
    const l = await elenco(shell);
    expect(l.filter((r) => r.url.includes('/fallisce/doppia.pdf')).length).toBe(2);
    expect(contenuto(dir).filter((n) => n.startsWith('doppia')).sort()).toEqual(['doppia (2).pdf', 'doppia.pdf']);
  } finally { await srv.close(); }
});
