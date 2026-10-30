// Pacchetto scaricamenti #1684: tre copie dello stesso file avviate insieme arrivano tutte (#440); velocità e tempo che
// resta sulla riga, «Riprova» su avviso, riga e carta, la domanda chiudendo l'incognito (#1287); un file arrivato si
// trascina dall'avviso, dal pannello e dalla pagina (#588.8); gli installatori di Linux chiedono prima di aprirsi (#1399.4).
import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.cwd(), 'tests', '.shots');
const PDF = Buffer.from('%PDF-1.4\n% finto pdf di prova\n' + 'x'.repeat(4096));
const EXE = Buffer.from('MZ finto eseguibile di prova\n' + 'z'.repeat(2048));

// /insieme/<nome>: intestazioni subito, byte dopo un attimo (tre clic restano in volo insieme).
// /lento/<nome>?kb=&ms=: scende a pezzi nel tempo detto. /a-volte/<nome>: la prima volta 404 (un link con `download`
// fallisce subito, senza lasciare la pagina), poi il file.
async function apriServer() {
  const visti = new Map();
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const nome = decodeURIComponent(u.pathname.split('/').pop() || 'file.pdf');
    const tipo = nome.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
    const corpo = nome.endsWith('.pdf') ? PDF : EXE;
    const testa = (len) => ({ 'Content-Type': tipo, 'Content-Length': len, 'Content-Disposition': `attachment; filename="${nome}"` });
    if (u.pathname.startsWith('/insieme/')) {
      res.writeHead(200, testa(corpo.length));
      res.flushHeaders();
      setTimeout(() => res.end(corpo), 1500);
      return;
    }
    if (u.pathname.startsWith('/lento/')) {
      const kb = Number(u.searchParams.get('kb') || 512);
      const ms = Number(u.searchParams.get('ms') || 6000);
      const pezzi = 40;
      const pezzo = Buffer.alloc(Math.ceil((kb * 1024) / pezzi), 0x61);
      res.writeHead(200, testa(pezzo.length * pezzi));
      let n = 0;
      const t = setInterval(() => {
        if (res.destroyed) { clearInterval(t); return; }
        res.write(pezzo);
        if (++n >= pezzi) { clearInterval(t); res.end(); }
      }, ms / pezzi);
      return;
    }
    // Una pagina dello stesso sito coi link `download` ai file: da un altro sito Chromium il `download` lo ignora.
    if (u.pathname.startsWith('/pagina/')) {
      const dove = u.searchParams.get('verso') || 'a-volte';
      const link = nome.split(',').map((n, i) => `<a id="l${i}" download href="/${dove}/${n}">${n}</a>`).join(' ');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body style="padding:40px">${link}</body></html>`);
      return;
    }
    if (u.pathname.startsWith('/a-volte/')) {
      const volte = (visti.get(nome) || 0) + 1;
      visti.set(nome, volte);
      if (volte === 1) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('non ancora'); return; }
      res.writeHead(200, testa(corpo.length));
      res.end(corpo);
      return;
    }
    res.writeHead(200, testa(corpo.length));
    res.end(corpo);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return {
    base,
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

async function pagina(testServer, openTab, corpo) {
  return testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">${corpo}</body></html>`);
}

test('tre scaricamenti dello stesso file avviati insieme arrivano tutti, coi nomi numerati (#440)', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const srv = await apriServer();
  try {
    const dir = await cartella(app);
    // Tre clic nello stesso istante: nessuna delle tre copie è ancora sul disco quando parte la successiva.
    const page = await paginaDelServer(openTab, `${srv.base}/pagina/doppio.pdf?verso=insieme`);
    await page.evaluate(() => { for (let i = 0; i < 3; i++) document.getElementById('l0').click(); });
    const finiti = async () => (await elenco(shell)).filter((r) => r.url.endsWith('/insieme/doppio.pdf') && r.state === 'completed');
    await expect.poll(async () => (await finiti()).length, { timeout: 20000 }).toBe(3);
    const nomi = (await finiti()).map((r) => r.filename).sort();
    expect(nomi).toEqual(['doppio (2).pdf', 'doppio (3).pdf', 'doppio.pdf']);
    for (const n of nomi) {
      expect(contenuto(dir)).toContain(n);
      expect(statSync(join(dir, n)).size).toBe(PDF.length);
    }
  } finally { await srv.close(); }
});

test('mentre scende la riga dice quanto va veloce e quanto manca, nella pagina Download e nella carta della home (#1287)', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const srv = await apriServer();
  try {
    const page = await pagina(testServer, openTab, `<a id="l" href="${srv.base}/lento/grande.pdf?kb=600&ms=9000">Scarica</a>`);
    await page.locator('#l').click();
    await expect.poll(async () => {
      const r = await voce(shell, (x) => x.filename === 'grande.pdf');
      return r && r.state === 'progressing' && r.velocita > 0 && Number.isFinite(r.restano);
    }, { timeout: 15000 }).toBe(true);
    const dl = await openTab('filo://downloads/downloads.html');
    const meta = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'grande.pdf' }) }).locator('.dl-meta');
    await expect(meta).toHaveText(/In corso · \d+% · .+ · \d+ KB\/s · ancora \d+ (s|min)/, { timeout: 10000 });
    await dl.screenshot({ path: join(SHOTS, 'download-1287-velocita-pagina.png') });
    const home = await openTab('filo://newtab/');
    const stato = home.locator('.dash-carta', { hasText: 'grande.pdf' }).locator('.dash-carta-stato');
    await expect(stato).toHaveText(/KB\/s · ancora \d+/, { timeout: 10000 });
    // Arrivato in fondo, la velocità se ne va: la riga dice com'è finita.
    await expect.poll(async () => (await voce(shell, (x) => x.filename === 'grande.pdf'))?.state, { timeout: 20000 }).toBe('completed');
    const fine = await voce(shell, (x) => x.filename === 'grande.pdf');
    expect(fine.velocita).toBe(0);
    expect(fine.restano).toBeNull();
  } finally { await srv.close(); }
});

test('uno scaricamento non riuscito ha «Riprova» sull’avviso: riparte nella stessa voce e arriva (#1287)', async ({ app, shell, openTab, testServer, avvisi }) => {
  test.setTimeout(60_000);
  const srv = await apriServer();
  try {
    const dir = await cartella(app);
    const page = await paginaDelServer(openTab, `${srv.base}/pagina/fattura.pdf`);
    await page.locator('#l0').click();
    let primo = null;
    await expect.poll(async () => {
      primo = await voce(shell, (x) => x.url.endsWith('/a-volte/fattura.pdf'));
      return primo && primo.state;
    }, { timeout: 30000 }).toBe('interrupted');
    const vista = await avvisi();
    const carta = vista.locator('.shell-notif', { hasText: 'Scaricamento non riuscito' }).last();
    await expect(carta).toBeVisible({ timeout: 10000 });
    await carta.screenshot({ path: join(SHOTS, 'download-1287-riprova-avviso.png') });
    await carta.locator('.shell-notif-action', { hasText: 'Riprova' }).click();
    await expect.poll(async () => (await voce(shell, (x) => x.id === primo.id))?.state, { timeout: 20000 }).toBe('completed');
    const lista = (await elenco(shell)).filter((x) => x.url.endsWith('/a-volte/fattura.pdf'));
    expect(lista.length).toBe(1);
    expect(contenuto(dir)).toContain('fattura.pdf');
    expect(statSync(join(dir, 'fattura.pdf')).size).toBe(PDF.length);
  } finally { await srv.close(); }
});

test('«Riprova» sta anche sulla riga della pagina Download e sulla carta della home (#1287)', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const srv = await apriServer();
  try {
    const page = await paginaDelServer(openTab, `${srv.base}/pagina/uno.pdf,due.pdf`);
    await page.locator('#l0').click();
    await page.locator('#l1').click();
    for (const n of ['uno.pdf', 'due.pdf']) {
      await expect.poll(async () => (await voce(shell, (x) => x.url.endsWith(`/a-volte/${n}`)))?.state, { timeout: 30000 }).toBe('interrupted');
    }
    const dl = await openTab('filo://downloads/downloads.html');
    const riga = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'uno.pdf' }) });
    await riga.locator('.dl-btn', { hasText: 'Riprova' }).click();
    await expect(riga.locator('.dl-btn', { hasText: 'Apri file' })).toBeVisible({ timeout: 20000 });
    const home = await openTab('filo://newtab/');
    const carta = home.locator('.dash-carta', { hasText: 'due.pdf' });
    await carta.screenshot({ path: join(SHOTS, 'download-1287-riprova-carta.png') });
    await carta.locator('.dash-carta-az', { hasText: 'Riprova' }).click();
    await expect.poll(async () => (await voce(shell, (x) => x.url.endsWith('/a-volte/due.pdf')))?.state, { timeout: 20000 }).toBe('completed');
    expect((await elenco(shell)).filter((x) => /\/a-volte\/(uno|due)\.pdf$/.test(x.url)).length).toBe(2);
  } finally { await srv.close(); }
});

async function trovaPagina(app, prova, tetto = 15000) {
  const fine = Date.now() + tetto;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('pagina non trovata');
}

async function incognitoCheScarica(app, shell, url) {
  await shell.evaluate(() => window.filoShell.openIncognito());
  const incog = await trovaPagina(app, (u) => u.startsWith('filo://shell/') && u.includes('incognito=1'));
  await incog.waitForFunction(() => document.documentElement.dataset.incognito === '1');
  await app.evaluate(({ BrowserWindow }, u) => {
    BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab(u);
  }, url);
  const sito = await trovaPagina(app, (u) => u.startsWith('http://127.0.0.1') && u.includes('?pagina'));
  await sito.waitForLoadState('domcontentloaded');
  return { incog, sito };
}
const incognitoAperta = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito && !w.isDestroyed()));
const chiudiIncognito = (app) => app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((w) => w._filoIncognito).close(); });

for (const [scelta, arriva] of [['Annulla', false], ['Lascia finire', true]]) {
  test(`chiudendo l’incognito con un download in corso chiede, e «${scelta}» chiude la finestra (#1287)`, async ({ app, shell, testServer }) => {
    test.setTimeout(90_000);
    const srv = await apriServer();
    try {
      const dir = await cartella(app);
      const nome = scelta === 'Annulla' ? 'segreto-annullato.pdf' : 'segreto-finito.pdf';
      const url = testServer.html(`<!doctype html><html><body><a id="l" href="${srv.base}/lento/${nome}?kb=300&ms=7000">Scarica</a></body></html>`);
      const { incog, sito } = await incognitoCheScarica(app, shell, url.replace(/\/(\d+)$/, '/$1?pagina'));
      await sito.locator('#l').click();
      const nellIncognito = async () => ((await incog.evaluate(() => window.filoShell.downloads.list())).items || []).find((x) => x.filename === nome);
      await expect.poll(async () => (await nellIncognito())?.state, { timeout: 15000 }).toBe('progressing');

      await chiudiIncognito(app);
      const domanda = incog.locator('#dl-panel #dl-chiusura');
      await expect(domanda).toBeVisible({ timeout: 10000 });
      await expect(domanda).toContainText(nome);
      expect(await incognitoAperta(app)).toBe(true);
      await incog.locator('#dl-panel').screenshot({ path: join(SHOTS, `download-1287-chiusura-${arriva ? 'finire' : 'annulla'}.png`) });
      const bottone = domanda.locator('.dl-row-btn', { hasText: scelta });
      await expect(bottone).toBeEnabled({ timeout: 5000 });
      await bottone.click();
      await expect.poll(() => incognitoAperta(app), { timeout: 10000 }).toBe(false);
      if (arriva) {
        await expect.poll(() => contenuto(dir).includes(nome) && statSync(join(dir, nome)).size > 250 * 1024, { timeout: 30000 }).toBe(true);
      } else {
        await new Promise((r) => setTimeout(r, 1500));
        expect(contenuto(dir).filter((n) => n.startsWith(nome.replace('.pdf', '')))).toEqual([]);
      }
    } finally { await srv.close(); }
  });
}

test('chiudendo l’incognito, la domanda chiusa col pannello lascia la finestra aperta; senza download si chiude subito (#1287)', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  const srv = await apriServer();
  try {
    const url = testServer.html(`<!doctype html><html><body><a id="l" href="${srv.base}/lento/ripensato.pdf?kb=300&ms=5000">Scarica</a></body></html>`);
    const { incog, sito } = await incognitoCheScarica(app, shell, url.replace(/\/(\d+)$/, '/$1?pagina'));
    await sito.locator('#l').click();
    const stato = async () => ((await incog.evaluate(() => window.filoShell.downloads.list())).items || []).find((x) => x.filename === 'ripensato.pdf')?.state;
    await expect.poll(stato, { timeout: 15000 }).toBe('progressing');
    await chiudiIncognito(app);
    await expect(incog.locator('#dl-chiusura')).toBeVisible({ timeout: 10000 });
    await incog.locator('#dl-panel-close').click();
    await expect(incog.locator('#dl-panel')).toBeHidden();
    expect(await incognitoAperta(app)).toBe(true);
    await expect.poll(stato, { timeout: 20000 }).toBe('completed');
    await chiudiIncognito(app);
    await expect.poll(() => incognitoAperta(app), { timeout: 10000 }).toBe(false);
  } finally { await srv.close(); }
});

// La spia prende il posto del trascinamento di sistema: in un contenitore senza schermo non si può trascinare davvero.
async function spiaTrascinamento(app, quale) {
  await app.evaluate(({ BrowserWindow, webContents }, q) => {
    globalThis.__trascinati = [];
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const wcs = q === 'barra' ? [win.webContents]
      : q === 'avvisi' ? [win._filoTabs.avvisi.vista.webContents]
        : webContents.getAllWebContents().filter((w) => w.getURL().startsWith('filo://downloads/'));
    for (const wc of wcs) wc.startDrag = (o) => { globalThis.__trascinati.push({ q, file: o.file, icona: !!(o.icon && !o.icon.isEmpty()) }); };
  }, quale);
}
const trascinati = (app) => app.evaluate(() => globalThis.__trascinati.slice());

test('un file arrivato si trascina dall’avviso, dalla riga del pannello e dalla pagina Download (#588.8)', async ({ app, shell, openTab, testServer, avvisi }) => {
  test.setTimeout(60_000);
  const srv = await apriServer();
  try {
    const page = await pagina(testServer, openTab, `<a id="pdf" href="${srv.base}/file/contratto.pdf">PDF</a><a id="exe" href="${srv.base}/file/setup.exe">Programma</a>`);
    await page.locator('#pdf').click();
    await expect.poll(async () => (await voce(shell, (x) => x.filename === 'contratto.pdf'))?.state, { timeout: 15000 }).toBe('completed');
    const rec = await voce(shell, (x) => x.filename === 'contratto.pdf');

    // Dall'avviso «Scaricato».
    const vista = await avvisi();
    const carta = vista.locator('.shell-notif[data-trascina="1"]', { hasText: 'contratto.pdf' }).last();
    await expect(carta).toBeVisible({ timeout: 10000 });
    await spiaTrascinamento(app, 'avvisi');
    await carta.dispatchEvent('dragstart');
    await expect.poll(() => trascinati(app), { timeout: 5000 }).toEqual([{ q: 'avvisi', file: rec.savePath, icona: true }]);

    // Dalla riga del pannello, che si apre con la domanda sul programma.
    await page.locator('#exe').click();
    await expect(shell.locator('#dl-panel')).toBeVisible({ timeout: 10000 });
    const riga = shell.locator('#dl-panel .dl-row[data-trascina="1"]', { hasText: 'contratto.pdf' });
    await expect(riga).toBeVisible();
    await spiaTrascinamento(app, 'barra');
    await riga.dispatchEvent('dragstart');
    await expect.poll(() => trascinati(app), { timeout: 5000 }).toEqual([{ q: 'barra', file: rec.savePath, icona: true }]);

    // Dalla pagina Download.
    const dl = await openTab('filo://downloads/downloads.html');
    const voceDl = dl.locator('.dl-item[data-trascina="1"]', { has: dl.locator('.dl-name', { hasText: 'contratto.pdf' }) });
    await expect(voceDl).toBeVisible();
    await spiaTrascinamento(app, 'pagina');
    await voceDl.dispatchEvent('dragstart');
    await expect.poll(() => trascinati(app), { timeout: 5000 }).toEqual([{ q: 'pagina', file: rec.savePath, icona: true }]);
    // Un programma in attesa non è ancora sul computer: la sua riga non si trascina.
    await expect(shell.locator('#dl-panel .dl-row[data-state="pending"][data-trascina="1"]')).toHaveCount(0);
  } finally { await srv.close(); }
});

test('su Linux come altrove un installatore (.AppImage, .snap) è un «Programma» e «Apri file» chiede prima (#1399.4)', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const srv = await apriServer();
  try {
    await app.evaluate(({ shell: s }) => {
      globalThis.__aperti = [];
      s.openPath = (p) => { globalThis.__aperti.push(p); return Promise.resolve(''); };
    });
    const page = await pagina(testServer, openTab, `<a id="a" href="${srv.base}/file/Filo-1.2.3.AppImage">AppImage</a><a id="s" href="${srv.base}/file/filo_1.2.3.snap">Snap</a>`);
    for (const [sel, nome] of [['#a', 'Filo-1.2.3.AppImage'], ['#s', 'filo_1.2.3.snap']]) {
      await page.locator(sel).click();
      await expect.poll(async () => (await voce(shell, (x) => x.filename === nome))?.state, { timeout: 15000 }).toBe('pending');
      const domanda = shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: nome });
      await expect(domanda).toBeVisible({ timeout: 10000 });
      const scarica = domanda.locator('.dl-row-btn', { hasText: /^Scarica$/ });
      await expect(scarica).toBeEnabled({ timeout: 5000 });
      await scarica.click();
      await expect.poll(async () => (await voce(shell, (x) => x.filename === nome))?.state, { timeout: 15000 }).toBe('completed');
      const riga = shell.locator('#dl-panel .dl-row', { hasText: nome });
      await expect(riga.locator('.dl-row-tag')).toHaveText('Programma');
      await riga.locator('.dl-row-btn', { hasText: 'Apri file' }).click();
      const conferma = shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: nome }).filter({ hasText: 'eseguirlo' });
      await expect(conferma).toBeVisible({ timeout: 10000 });
      expect(await app.evaluate(() => globalThis.__aperti.slice())).toEqual([]);
      await conferma.locator('.dl-row-btn', { hasText: 'Annulla' }).click();
    }
  } finally { await srv.close(); }
});
