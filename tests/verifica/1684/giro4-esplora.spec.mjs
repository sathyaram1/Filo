import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.cwd(), 'tests', '.shots');

function pdfConTesto(righe) {
  const corpo = righe.map((r, i) => `${i ? '0 -24 Td\n' : ''}(${r}) Tj`).join('\n');
  const stream = `BT\n/F1 14 Tf\n40 700 Td\n${corpo}\nET\n`;
  const oggetti = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let out = '%PDF-1.4\n';
  const pos = [];
  oggetti.forEach((o, i) => { pos.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`
    + pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const BOLLETTA = pdfConTesto(['Bolletta luce Enel', 'Marzo 2026', 'Totale da pagare 54,20 euro']);
const EXE = Buffer.from('finto installatore\n' + 'z'.repeat(4096));
const GRANDE = Buffer.alloc(400 * 1024, 0x61);

async function apriServer() {
  const visti = new Map();
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const nome = decodeURIComponent(u.pathname.split('/').pop() || 'file.pdf');
    const volte = (visti.get(u.pathname) || 0) + 1;
    visti.set(u.pathname, volte);
    const pdf = nome.endsWith('.pdf');
    const corpo = pdf ? (u.pathname.startsWith('/taglia/') ? GRANDE : BOLLETTA) : EXE;
    const testa = (len) => ({ 'Content-Type': pdf ? 'application/pdf' : 'application/octet-stream', 'Content-Length': len, 'Content-Disposition': `attachment; filename="${nome}"` });
    if (u.pathname.startsWith('/pagina/')) {
      const dove = u.searchParams.get('verso') || 'file';
      const link = nome.split(',').map((n, i) => `<a id="l${i}" download href="/${dove}/${n}">${n}</a>`).join(' ');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body style="padding:40px">${link}</body></html>`);
      return;
    }
    if (u.pathname.startsWith('/insieme/')) {
      res.writeHead(200, testa(corpo.length));
      res.flushHeaders();
      setTimeout(() => res.end(corpo), 1500);
      return;
    }
    if (u.pathname.startsWith('/a-volte/') && volte === 1) { res.writeHead(404); res.end('no'); return; }
    if (u.pathname.startsWith('/taglia/') && volte === 1) {
      res.writeHead(200, testa(corpo.length));
      res.write(corpo.subarray(0, corpo.length / 2));
      setTimeout(() => res.socket.destroy(), 400);
      return;
    }
    if (u.pathname.startsWith('/lento/')) {
      const pezzi = 40;
      const pezzo = Buffer.alloc(Math.ceil(600 * 1024 / pezzi), 0x61);
      res.writeHead(200, testa(pezzo.length * pezzi));
      let n = 0;
      const t = setInterval(() => {
        if (res.destroyed) { clearInterval(t); return; }
        res.write(pezzo);
        if (++n >= pezzi) { clearInterval(t); res.end(); }
      }, 9000 / pezzi);
      return;
    }
    res.writeHead(200, testa(corpo.length));
    res.end(corpo);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({
    base: `http://127.0.0.1:${srv.address().port}`,
    close: async () => { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((ok) => srv.close(ok)); },
  })));
}

const elenco = async (shell) => ((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];
const cartella = (app) => app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
const contenuto = (dir) => (existsSync(dir) ? readdirSync(dir) : []);
async function paginaDelServer(openTab, url) {
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

async function modelloDeiNomi(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILE_NAME]: 'gemma', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      nomiSensati: { scaricamenti: true },
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
      await new Promise((r) => setTimeout(r, 300));
      return { text: '«Bolletta luce Enel Marzo 2026.pdf»', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
}

test('esplora A: tre copie dello stesso PDF anonimo insieme, col nome sensato acceso', async ({ app, shell, openTab, avvisi }) => {
  test.setTimeout(90_000);
  await modelloDeiNomi(app);
  const s = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).nomiSensati);
  console.log('nomiSensati', JSON.stringify(s));
  const srv = await apriServer();
  try {
    const dir = await cartella(app);
    const page = await paginaDelServer(openTab, `${srv.base}/pagina/scan_00231.pdf?verso=insieme`);
    await page.evaluate(() => { for (let i = 0; i < 3; i++) document.getElementById('l0').click(); });
    await expect.poll(async () => (await elenco(shell)).filter((r) => r.state === 'completed').length, { timeout: 20000 }).toBe(3);
    await new Promise((r) => setTimeout(r, 8000));
    const vista = await avvisi();
    const testi = await vista.locator('.shell-notif').allInnerTexts();
    console.log('DISCO', JSON.stringify(contenuto(dir)));
    console.log('VOCI', JSON.stringify((await elenco(shell)).map((r) => [r.filename, r.state, r.nomeOriginale])));
    console.log('AVVISI', JSON.stringify(testi));
  } finally { await srv.close(); }
});

test('esplora B: tre installatori uguali insieme, confermati, arrivano tutti', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const srv = await apriServer();
  try {
    const dir = await cartella(app);
    const page = await paginaDelServer(openTab, `${srv.base}/pagina/filo_1.0_amd64.deb?verso=insieme`);
    await page.evaluate(() => { for (let i = 0; i < 3; i++) document.getElementById('l0').click(); });
    await expect.poll(async () => (await elenco(shell)).filter((r) => r.state === 'pending').length, { timeout: 20000 }).toBe(3);
    for (let i = 0; i < 3; i++) {
      const scarica = shell.locator('#dl-panel .dl-row[data-chiede="1"] .dl-row-btn', { hasText: /^Scarica$/ }).first();
      await expect(scarica).toBeVisible({ timeout: 10000 });
      await expect(scarica).toBeEnabled({ timeout: 6000 });
      await scarica.click();
      await new Promise((r) => setTimeout(r, 500));
    }
    await expect.poll(async () => (await elenco(shell)).filter((r) => r.state === 'completed').length, { timeout: 20000 }).toBe(3);
    console.log('DISCO', JSON.stringify(contenuto(dir)));
    console.log('VOCI', JSON.stringify((await elenco(shell)).map((r) => [r.filename, r.state, r.savePath])));
  } finally { await srv.close(); }
});

test('esplora C: «Apri file» di un installatore dall’avviso, dalla pagina Download e dalla home chiede prima', async ({ app, shell, openTab, avvisi }) => {
  test.setTimeout(90_000);
  const srv = await apriServer();
  try {
    await app.evaluate(({ shell: s }) => {
      globalThis.__aperti = [];
      s.openPath = (p) => { globalThis.__aperti.push(p); return Promise.resolve(''); };
    });
    const page = await paginaDelServer(openTab, `${srv.base}/pagina/Filo.AppImage,filo.flatpakref,filo.rpm`);
    for (const [i, nome] of [[0, 'Filo.AppImage'], [1, 'filo.flatpakref'], [2, 'filo.rpm']]) {
      await page.locator(`#l${i}`).click();
      const scarica = shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: nome }).locator('.dl-row-btn', { hasText: /^Scarica$/ });
      await expect(scarica).toBeEnabled({ timeout: 10000 });
      await scarica.click();
      await expect.poll(async () => (await elenco(shell)).find((x) => x.filename === nome)?.state, { timeout: 15000 }).toBe('completed');
    }
    // dall'avviso
    const vista = await avvisi();
    const apri = vista.locator('.shell-notif', { hasText: 'filo.rpm' }).locator('.shell-notif-action', { hasText: 'Apri file' });
    await apri.click();
    await new Promise((r) => setTimeout(r, 2000));
    console.log('APERTI dopo avviso', JSON.stringify(await app.evaluate(() => globalThis.__aperti.slice())));
    await shell.screenshot({ path: join(SHOTS, 'giro4-avviso-apri.png') });
    console.log('PANNELLO', JSON.stringify(await shell.locator('#dl-panel').innerText().catch(() => '')));
    // dalla pagina Download
    const dl = await openTab('filo://downloads/downloads.html');
    const riga = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'Filo.AppImage' }) });
    console.log('RIGA', JSON.stringify(await riga.innerText()));
    await riga.locator('.dl-btn', { hasText: 'Apri file' }).click();
    await new Promise((r) => setTimeout(r, 2000));
    console.log('APERTI dopo pagina', JSON.stringify(await app.evaluate(() => globalThis.__aperti.slice())));
    await dl.screenshot({ path: join(SHOTS, 'giro4-pagina-apri.png') });
    // dalla home
    const home = await openTab('filo://newtab/');
    const carta = home.locator('.dash-carta', { hasText: 'flatpakref' });
    console.log('CARTA', JSON.stringify(await carta.first().innerText().catch(() => 'nessuna')));
    const az = carta.first().locator('.dash-carta-az', { hasText: 'Apri' });
    if (await az.count()) { await az.first().click(); await new Promise((r) => setTimeout(r, 2000)); }
    console.log('APERTI dopo home', JSON.stringify(await app.evaluate(() => globalThis.__aperti.slice())));
    await home.screenshot({ path: join(SHOTS, 'giro4-home-apri.png') });
  } finally { await srv.close(); }
});

test('esplora D: «Riprova» dopo una caduta a metà rifà il file col suo nome, senza avanzi', async ({ app, shell, openTab, avvisi }) => {
  test.setTimeout(90_000);
  const srv = await apriServer();
  try {
    const dir = await cartella(app);
    const page = await paginaDelServer(openTab, `${srv.base}/pagina/meta.pdf?verso=taglia`);
    await page.locator('#l0').click();
    await expect.poll(async () => (await elenco(shell)).find((x) => x.url.endsWith('/taglia/meta.pdf'))?.state, { timeout: 30000 }).toBe('interrupted');
    console.log('DISCO dopo caduta', JSON.stringify(contenuto(dir)));
    const vista = await avvisi();
    const riprova = vista.locator('.shell-notif', { hasText: 'meta.pdf' }).locator('.shell-notif-action', { hasText: 'Riprova' });
    await expect(riprova).toBeVisible({ timeout: 10000 });
    await riprova.click();
    await expect.poll(async () => (await elenco(shell)).find((x) => x.url.endsWith('/taglia/meta.pdf'))?.state, { timeout: 30000 }).toBe('completed');
    console.log('DISCO', JSON.stringify(contenuto(dir)));
    console.log('VOCI', JSON.stringify((await elenco(shell)).map((r) => [r.filename, r.state, r.receivedBytes])));
    for (const n of contenuto(dir)) console.log(n, statSync(join(dir, n)).size);
  } finally { await srv.close(); }
});

test('esplora E: «Riprova» su un installatore non riuscito', async ({ app, shell, openTab, avvisi }) => {
  test.setTimeout(90_000);
  const srv = await apriServer();
  try {
    const dir = await cartella(app);
    const page = await paginaDelServer(openTab, `${srv.base}/pagina/setup.deb?verso=a-volte`);
    await page.locator('#l0').click();
    await expect.poll(async () => (await elenco(shell)).find((x) => x.url.endsWith('/a-volte/setup.deb'))?.state, { timeout: 30000 }).toBe('interrupted');
    const vista = await avvisi();
    const riprova = vista.locator('.shell-notif', { hasText: 'setup.deb' }).locator('.shell-notif-action', { hasText: 'Riprova' });
    await expect(riprova).toBeVisible({ timeout: 10000 });
    await riprova.click();
    await new Promise((r) => setTimeout(r, 3000));
    console.log('VOCI dopo riprova', JSON.stringify((await elenco(shell)).map((r) => [r.filename, r.state])));
    const scarica = shell.locator('#dl-panel .dl-row[data-chiede="1"] .dl-row-btn', { hasText: /^Scarica$/ });
    if (await scarica.count()) { await expect(scarica.first()).toBeEnabled({ timeout: 6000 }); await scarica.first().click(); }
    await expect.poll(async () => (await elenco(shell)).find((x) => x.url.endsWith('/a-volte/setup.deb'))?.state, { timeout: 30000 }).toBe('completed');
    console.log('DISCO', JSON.stringify(contenuto(dir)));
  } finally { await srv.close(); }
});

test('esplora F: il pannello mostra velocità e tempo, e la pausa', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const srv = await apriServer();
  try {
    const page = await paginaDelServer(openTab, `${srv.base}/pagina/lungo.pdf?verso=lento`);
    await page.locator('#l0').click();
    const riga = shell.locator('#dl-panel .dl-row', { hasText: 'lungo.pdf' });
    await expect(riga.locator('.dl-row-meta')).toHaveText(/KB\/s · ancora/, { timeout: 15000 });
    console.log('META', await riga.locator('.dl-row-meta').innerText());
    await shell.locator('#dl-panel').screenshot({ path: join(SHOTS, 'giro4-pannello-velocita.png') });
    const pausa = riga.locator('.dl-row-btn', { hasText: /Pausa/ });
    if (await pausa.count()) {
      await pausa.click();
      await new Promise((r) => setTimeout(r, 2500));
      console.log('META in pausa', await riga.locator('.dl-row-meta').innerText());
      await riga.locator('.dl-row-btn', { hasText: 'Riprendi' }).click();
      await new Promise((r) => setTimeout(r, 1500));
      console.log('META ripreso', await riga.locator('.dl-row-meta').innerText());
    } else console.log('nessun pulsante pausa', await riga.innerText());
  } finally { await srv.close(); }
});
