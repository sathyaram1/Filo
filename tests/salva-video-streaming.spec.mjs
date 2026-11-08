// #1488 — «Salva video come…» su un video in streaming (un <video> che legge da MediaSource, come YouTube) salva il
// video invece di dire che non c'è un file. Il programma è un yt-dlp finto (tests/helpers/ytdlpFinto.mjs): quello
// vero non gira nelle prove. Logica, programmi e firma: ytdlp, strumentiVideo, salvaVideoStreaming in tests/unit/.

import { test, expect } from './fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { menuDi } from './helpers/menuContestuale.mjs';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const SHOTS = join(process.cwd(), 'tests', '.shots');
const base = cartellaTemporanea('filo-ytdlp-finto-');
const caso = join(base, 'caso.json');
const registro = join(base, 'registro.jsonl');
const ilCaso = (c) => writeFileSync(caso, JSON.stringify(c));

test.use({
  envInPiu: {
    // L'Electron delle prove fa da Node per lo script finto, come quello di Filo fa da runtime per yt-dlp.
    FILO_YTDLP_COMANDO: JSON.stringify([require('electron'), join(process.cwd(), 'tests', 'helpers', 'ytdlpFinto.mjs')]),
    FILO_YTDLP_FINTO_CASO: caso,
    FILO_YTDLP_FINTO_REGISTRO: registro,
  },
});

// Il lettore dei grandi siti: il <video> legge da un MediaSource, e il suo src è un blob: che fetch non apre.
const PAGINA = `<!doctype html><html><head><title>(2) Canzone della segnalazione - YouTube</title></head>
  <body style="margin:0;padding:24px;font:16px sans-serif">
  <video id="v" width="480" height="270" style="background:#222"></video>
  <script>const ms = new MediaSource(); document.getElementById('v').src = URL.createObjectURL(ms);</script>
  </body></html>`;

async function salvaDalMenu(page) {
  await expect.poll(() => page.evaluate(() => document.getElementById('v').src.startsWith('blob:'))).toBe(true);
  await page.locator('#v').click({ button: 'right', position: { x: 40, y: 40 } });
  const voce = menuDi(page).locator('.sn-menu button', { hasText: 'Salva video come' });
  await expect(voce).toBeVisible();
  await voce.click();
}

const elenco = async (shell) => ((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];

test.beforeAll(() => { mkdirSync(base, { recursive: true }); mkdirSync(SHOTS, { recursive: true }); });
test.afterAll(() => { togliCartella(base); });

test('dal tasto destro il video in streaming arriva nella cartella, col titolo del video', async ({ app, shell, openTab, testServer, avvisi }) => {
  test.setTimeout(60_000);
  ilCaso({ titolo: 'Canzone della segnalazione', pausaMs: 120, passi: 12 });
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  const page = await testServer.openReady(openTab, PAGINA);
  await salvaDalMenu(page);

  // Mentre scende, la pagina Download dice cosa sta facendo, con la percentuale.
  const dl = await openTab('filo://downloads/downloads.html');
  const riga = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'Canzone della segnalazione' }) });
  await expect(riga.locator('.dl-meta')).toHaveText(/(In corso|Unisco video e audio) · \d+% · /, { timeout: 15000 });
  await dl.screenshot({ path: join(SHOTS, 'salva-video-streaming-in-corso.png') });

  await expect.poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 30000 }).toContain('Canzone della segnalazione.mp4');
  expect(statSync(join(dir, 'Canzone della segnalazione.mp4')).size).toBe(360 * 1024);
  // La fine si dice nella finestra, con «Apri file», dovunque sia l'utente; la pagina non la ripete.
  const vista = await avvisi();
  const fatto = vista.locator('.shell-notif', { hasText: 'Scaricato: Canzone della segnalazione.mp4' }).last();
  await expect(fatto).toBeVisible({ timeout: 15000 });
  await expect(fatto.locator('.shell-notif-action', { hasText: 'Apri file' })).toBeVisible();
  await expect(page.locator('.sn-toast', { hasText: 'Video salvato' })).toHaveCount(0);
  const v = (await elenco(shell)).find((x) => x.filename === 'Canzone della segnalazione.mp4');
  expect(v.state).toBe('completed');
  expect(v.via).toBe('streaming');
  expect(v.url).toBe(page.url());
  await expect(riga.locator('.dl-btn', { hasText: 'Apri file' })).toBeVisible();
  // Niente cartelle di lavoro dimenticate fra i Download dell'utente.
  expect(readdirSync(dir).filter((n) => n.startsWith('.filo-video-'))).toEqual([]);
});

test('un video con limite d\'età dice perché non si salva, e da «Riprova» riparte nella stessa riga', async ({ app, shell, openTab, testServer, avvisi }) => {
  test.setTimeout(60_000);
  ilCaso({ errore: 'Sign in to confirm your age. This video may be inappropriate for some users. Use --cookies-from-browser or --cookies for the authentication.' });
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  const page = await testServer.openReady(openTab, PAGINA);
  await salvaDalMenu(page);
  const vista = await avvisi();
  const avviso = vista.locator('.shell-notif', { hasText: 'limite d\'età' }).last();
  await expect(avviso).toBeVisible({ timeout: 15000 });
  await expect(avviso).toContainText('non usa il tuo account');
  await expect(avviso).toContainText('Google');
  // Ripetere non toglie un limite d'età: l'avviso non propone «Riprova».
  await expect(avviso.locator('.shell-notif-action', { hasText: 'Riprova' })).toHaveCount(0);
  await avviso.screenshot({ path: join(SHOTS, 'salva-video-streaming-eta.png') });
  await expect(page.locator('.sn-toast', { hasText: 'limite d\'età' })).toHaveCount(0);

  const dl = await openTab('filo://downloads/downloads.html');
  const riga = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'Canzone della segnalazione' }) });
  await expect(riga.locator('.dl-meta')).toContainText('Interrotto · Il video ha un limite d\'età');
  await dl.screenshot({ path: join(SHOTS, 'salva-video-streaming-riga-eta.png') });

  // Il video torna disponibile (per esempio il sito toglie il limite): «Riprova» lo salva, senza aprire la pagina.
  ilCaso({ titolo: 'Canzone della segnalazione', pausaMs: 20 });
  const prima = (await elenco(shell)).filter((x) => x.via === 'streaming').length;
  await riga.locator('.dl-btn', { hasText: 'Riprova' }).click();
  await expect(riga.locator('.dl-btn', { hasText: 'Apri file' })).toBeVisible({ timeout: 20000 });
  expect(statSync(join(dir, 'Canzone della segnalazione.mp4')).size).toBe(360 * 1024);
  expect((await elenco(shell)).filter((x) => x.via === 'streaming').length).toBe(prima);
});

test('«Annulla» dai Download ferma il salvataggio e non lascia file', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  ilCaso({ titolo: 'Video lunghissimo', pausaMs: 200, passi: 300 });
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  const page = await testServer.openReady(openTab, PAGINA);
  await salvaDalMenu(page);
  const dl = await openTab('filo://downloads/downloads.html');
  const riga = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'Video lunghissimo' }) });
  await expect(riga.locator('.dl-meta')).toHaveText(/In corso · \d+% · /, { timeout: 15000 });
  await riga.locator('.dl-btn', { hasText: 'Annulla' }).click();
  await expect.poll(async () => (await elenco(shell)).find((x) => x.filename === 'Video lunghissimo.mp4')?.state, { timeout: 10000 }).toBe('cancelled');
  await expect.poll(() => readdirSync(dir).filter((n) => n.startsWith('.filo-video-') || n.startsWith('Video lunghissimo')), { timeout: 10000 }).toEqual([]);
  // Nessun avviso d'errore per un annullo voluto.
  await expect(page.locator('.sn-toast', { hasText: 'Non sono riuscito' })).toHaveCount(0);
});

test('se la rete cade a metà, «Riprova» sull\'avviso salva il video nella stessa riga', async ({ app, shell, openTab, testServer, avvisi }) => {
  test.setTimeout(60_000);
  ilCaso({ errore: 'Unable to download API page: <urlopen error [Errno -3] Temporary failure in name resolution>' });
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  const page = await testServer.openReady(openTab, PAGINA);
  await salvaDalMenu(page);
  const vista = await avvisi();
  const avviso = vista.locator('.shell-notif', { hasText: 'La connessione non risponde' }).last();
  await expect(avviso).toBeVisible({ timeout: 15000 });
  ilCaso({ titolo: 'Canzone della segnalazione', pausaMs: 20 });
  await avviso.locator('.shell-notif-action', { hasText: 'Riprova' }).click();
  await expect.poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 20000 }).toContain('Canzone della segnalazione.mp4');
  const righe = (await elenco(shell)).filter((x) => x.via === 'streaming');
  expect(righe.map((x) => x.state)).toEqual(['completed']);
});

const righe = () => (existsSync(registro) ? readFileSync(registro, 'utf8').trim().split('\n').filter(Boolean).map((r) => JSON.parse(r)) : []);
const nuovoCaso = (c) => { ilCaso(c); writeFileSync(registro, ''); };
const conIlLettore = (dentro, fuori = '') => `<!doctype html><html><head><title>Una pagina - YouTube</title></head>
  <body style="margin:0;padding:24px;font:16px sans-serif">${fuori}
  <script>addEventListener('DOMContentLoaded', () => { const ms = new MediaSource(); document.getElementById('v').src = URL.createObjectURL(ms); });</script>
  ${dentro}</body></html>`;

test('la percentuale di un video a pezzi separati sale soltanto, anche fra il video e l\'audio', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  nuovoCaso({ titolo: 'Canzone della segnalazione', pausaMs: 100, passi: 10, pausaFraPezzi: 1200 });
  const page = await testServer.openReady(openTab, PAGINA);
  await salvaDalMenu(page);
  const viste = [];
  for (const fine = Date.now() + 40_000; Date.now() < fine;) {
    const v = (await elenco(shell)).find((x) => x.via === 'streaming');
    if (v && v.state === 'completed') break;
    if (v && v.totalBytes > 0 && v.state === 'progressing') viste.push(Math.round((100 * v.receivedBytes) / v.totalBytes));
    await page.waitForTimeout(60);
  }
  expect(viste.length).toBeGreaterThan(10);
  expect(viste.filter((p, i) => i > 0 && p < viste[i - 1] - 1), `percentuali viste: ${viste.join(' ')}`).toEqual([]);
  // Finito il video l'audio manca ancora: la pausa fra i due pezzi si vede sotto il 100%.
  expect(viste.filter((p) => p >= 80 && p < 90).length, `percentuali viste: ${viste.join(' ')}`).toBeGreaterThan(5);
});

test('chiudere Filo mentre un video in streaming scende non lascia la cartella di lavoro fra i Download', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  nuovoCaso({ titolo: 'Video lunghissimo', pausaMs: 200, passi: 300 });
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  const page = await testServer.openReady(openTab, PAGINA);
  await salvaDalMenu(page);
  await expect.poll(async () => (await elenco(shell)).find((x) => x.via === 'streaming')?.receivedBytes || 0, { timeout: 15000 }).toBeGreaterThan(0);
  expect(readdirSync(dir).filter((n) => n.startsWith('.filo-video-')).length).toBe(1);
  const pid = righe().find((r) => r.pid)?.pid;
  await app.close();
  try {
    expect(readdirSync(dir).filter((n) => n.startsWith('.filo-video-'))).toEqual([]);
    await expect.poll(() => { try { process.kill(pid, 0); return true; } catch (_) { return false; } }, { timeout: 8000 }).toBe(false);
  } finally {
    try { process.kill(pid, 'SIGKILL'); } catch (_) {}
  }
});

for (const [nome, percorso, html, atteso] of [
  ['il video di presentazione di un canale', '/@canale',
    conIlLettore('<div class="html5-video-player"><video id="v" width="480" height="270" style="background:#222"></video><a class="ytp-title-link" href="/watch?v=TRAILER">Il trailer</a></div>'),
    '/watch?v=TRAILER'],
  ['l\'anteprima di una home, stesa dentro la sua scheda', '/',
    conIlLettore('<a href="/watch?v=ANTEPRIMA" style="display:inline-block"><video id="v" width="480" height="270" style="background:#222"></video><span>Titolo</span></a>'),
    '/watch?v=ANTEPRIMA'],
  ['un post di una bacheca, col suo permalink sull\'ora', '/home',
    conIlLettore('<article style="width:520px"><a href="/utente">utente</a><div><video id="v" width="480" height="270" style="background:#222"></video></div><a href="/utente/status/123"><time>2 h</time></a></article><article><a href="/altro/status/9"><time>3 h</time></a></article>'),
    '/utente/status/123'],
]) {
  test(`${nome}: al programma va l'indirizzo del video cliccato, non quello della pagina`, async ({ shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    nuovoCaso({ titolo: 'Il video cliccato', pausaMs: 20, lista: 30 });
    const page = await testServer.openReady(openTab, html);
    await page.evaluate((p) => history.pushState({}, '', p), percorso);
    await salvaDalMenu(page);
    await expect.poll(async () => (await elenco(shell)).find((x) => x.via === 'streaming')?.state, { timeout: 20000 }).toBe('completed');
    const v = (await elenco(shell)).find((x) => x.via === 'streaming');
    expect(v.url).toBe(`${testServer.origin}${atteso}`);
    expect(v.filename).toBe('Il video cliccato.mp4');
    expect(righe().filter((r) => r.voce)).toEqual([]);
  });
}

test('una pagina che è un elenco di video non viene scaricata tutta: si ferma e dice di aprire il video', async ({ shell, openTab, testServer, avvisi }) => {
  test.setTimeout(60_000);
  nuovoCaso({ pausaMs: 20, lista: 30 });
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => history.pushState({}, '', '/results?search_query=canzone'));
  await salvaDalMenu(page);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif', { hasText: 'elenco di video' }).last()).toBeVisible({ timeout: 15000 });
  expect(righe().filter((r) => r.voce).length).toBe(1);
  const v = (await elenco(shell)).find((x) => x.via === 'streaming');
  expect(v.state).not.toBe('completed');
});

// #2301 — un proxy HTTP di prova che inoltra le richieste in chiaro e conta quelle viste.
async function proxyDiProva() {
  const viste = [];
  const server = createHttpServer((req, res) => {
    viste.push(req.url);
    let u;
    try { u = new URL(req.url); } catch (_) { res.writeHead(400); res.end(); return; }
    const fuori = httpRequest({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    fuori.on('error', () => { try { res.writeHead(502); res.end(); } catch (_) {} });
    req.pipe(fuori);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, viste, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

// La scheda passata dal proxy ha una vista nuova: la pagina viva è quella col lettore pronto.
async function paginaViva(app, url) {
  for (let i = 0; i < 150; i++) {
    for (const p of app.windows().filter((w) => !w.isClosed() && w.url() === url).reverse()) {
      try { if (await p.evaluate(() => !!document.getElementById('v')?.src.startsWith('blob:'))) return p; } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`nessuna scheda viva su ${url}`);
}

const proxyDelProgramma = () => righe().filter((r) => r.argv).map((r) => r.proxy);

test('da una scheda aperta da un altro paese il video esce dal suo proxy, e «Riprova» a scheda chiusa anche', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const proxy = await proxyDiProva();
  try {
    await app.evaluate(async (_e, endpoint) => {
      await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: endpoint, bypass: '<-loopback>' } });
    }, `http://utente-{country}:segreto@127.0.0.1:${proxy.port}`);
    nuovoCaso({ errore: 'Unable to download webpage: timed out' });
    const url = testServer.html(PAGINA);
    const prima = await openTab(url);
    await prima.waitForSelector('#v');
    const tabId = await app.evaluate(({ BrowserWindow }, u) => {
      for (const w of BrowserWindow.getAllWindows()) {
        const t = w._filoTabs?.tabs.find((x) => x.url === u);
        if (t) return t.id;
      }
      return null;
    }, url);
    const r = await app.evaluate(({ BrowserWindow }, id) =>
      BrowserWindow.getAllWindows().find((w) => w._filoTabs?.tabs.some((t) => t.id === id))._filoTabs.setTabProxy(id, 'FR'), tabId);
    expect(r).toMatchObject({ ok: true, country: 'fr' });
    const page = await paginaViva(app, url);
    expect(proxy.viste).toContain(url);
    await salvaDalMenu(page);

    const atteso = `http://utente-fr:segreto@127.0.0.1:${proxy.port}`;
    await expect.poll(() => proxyDelProgramma().length, { timeout: 15000 }).toBe(1);
    const p = proxyDelProgramma()[0];
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) expect(p[k]).toBe(atteso);
    expect(p.NO_PROXY).toBeUndefined();
    await expect.poll(async () => (await elenco(shell)).find((x) => x.via === 'streaming')?.state, { timeout: 15000 }).toBe('interrupted');
    expect((await elenco(shell)).find((x) => x.via === 'streaming').paese).toEqual({ country: 'fr', tier: 'datacenter' });

    // La scheda si chiude: «Riprova» dai Download esce comunque dal proxy del paese di prima.
    await app.evaluate(({ BrowserWindow }, id) =>
      BrowserWindow.getAllWindows().find((w) => w._filoTabs?.tabs.some((t) => t.id === id))._filoTabs.closeTab(id), tabId);
    ilCaso({ titolo: 'Dal proxy', pausaMs: 20 });
    const dl = await openTab('filo://downloads/downloads.html');
    const riga = dl.locator('.dl-item', { has: dl.locator('.dl-meta', { hasText: 'La connessione non risponde' }) });
    await riga.locator('.dl-btn', { hasText: 'Riprova' }).click();
    await expect(dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'Dal proxy' }) }).locator('.dl-btn', { hasText: 'Apri file' }))
      .toBeVisible({ timeout: 20000 });
    expect(proxyDelProgramma().length).toBe(2);
    expect(proxyDelProgramma()[1].ALL_PROXY).toBe(atteso);
  } finally {
    await proxy.close();
  }
});

test('un sito con la regola del paese e nessun proxy da usare: il video non scende dalla connessione vera, e l\'avviso dice perché', async ({ app, shell, openTab, testServer, avvisi }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => { await globalThis.SN_FILO_MEMORY.setProxyRule('127.0.0.1', { country: 'us' }); });
  nuovoCaso({ titolo: 'Non deve scendere', pausaMs: 20 });
  const page = await testServer.openReady(openTab, PAGINA);
  await salvaDalMenu(page);
  const vista = await avvisi();
  const avviso = vista.locator('.shell-notif', { hasText: 'altro paese' }).last();
  await expect(avviso).toBeVisible({ timeout: 15000 });
  await avviso.screenshot({ path: join(SHOTS, 'salva-video-streaming-proxy.png') });
  const v = (await elenco(shell)).find((x) => x.via === 'streaming');
  expect(v.state).toBe('interrupted');
  expect(proxyDelProgramma()).toEqual([]);

  // Tolta la regola, lo stesso video si salva come sempre.
  await app.evaluate(async () => { await globalThis.SN_FILO_MEMORY.removeProxyRule('127.0.0.1'); });
  const dl = await openTab('filo://downloads/downloads.html');
  await dl.locator('.dl-item', { has: dl.locator('.dl-meta', { hasText: 'altro paese' }) }).locator('.dl-btn', { hasText: 'Riprova' }).click();
  await expect.poll(async () => (await elenco(shell)).find((x) => x.via === 'streaming')?.state, { timeout: 20000 }).toBe('completed');
  expect(proxyDelProgramma().length).toBe(1);
});
