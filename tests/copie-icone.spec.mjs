// #1273 — le icone delle pagine salvate e delle schede archiviate sono una copia tenuta da Filo: riaperto Filo, la home,
// «Aperti per dopo» e la chat le mostrano senza chiedere niente a chi ospita l'icona; e di una scheda passata da un proxy
// l'icona non si chiede mai fuori dal proxy. I siti sono un server locale che annota ogni richiesta, col nome chiesto.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { createServer as createNetServer, connect as netConnect } from 'node:net';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { barraPage, comandaBarra, pannelloFermo } from './helpers/barra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');
const NOMI = ['negozio.test', 'blog.test', 'dal-proxy.test', 'img.piattaforma.test'];
const PNG_NEGOZIO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4YaMBAAL8AS3/gzpXAAAAAElFTkSuQmCC', 'base64');
const PNG_BLOG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQCDgBAAHkAUEYgvCnAAAAAElFTkSuQmCC', 'base64');

// Ogni sito dichiara la sua icona sul server d'immagini di una piattaforma, un altro host.
function rispondi(req, res, porta) {
  const host = String(req.headers.host || '').split(':')[0];
  const html = (titolo, icona) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${titolo}</title>`
      + `<link rel="icon" href="http://img.piattaforma.test:${porta}/${icona}"></head><body style="margin:0;height:100vh"><h1>${titolo}</h1></body></html>`);
  };
  if (host === 'img.piattaforma.test') {
    const png = req.url.startsWith('/negozio') ? PNG_NEGOZIO : PNG_BLOG;
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(png);
  } else if (host === 'negozio.test') html('Il negozio di dischi', 'negozio.png');
  else if (host === 'blog.test') html('Il blog di cucina', 'blog.png');
  else if (host === 'dal-proxy.test') html('Pagina dal proxy', 'proxy.png');
  else { res.writeHead(404); res.end(); }
}

// Due porte dello stesso sito finto: una per chi arriva diretto, una per chi passa dal proxy.
async function sitiFinti() {
  const richieste = { diretto: [], proxy: [] };
  const servi = (dove) => createServer((req, res) => {
    richieste[dove].push(`${String(req.headers.host || '').split(':')[0]}${req.url}`);
    rispondi(req, res, diretto.address().port);
  });
  const diretto = servi('diretto');
  const viaProxy = servi('proxy');
  await new Promise((r) => diretto.listen(0, '127.0.0.1', r));
  await new Promise((r) => viaProxy.listen(0, '127.0.0.1', r));
  const chiudi = (s) => new Promise((r) => { s.closeAllConnections?.(); s.close(r); });
  return {
    porta: diretto.address().port,
    portaProxy: viaProxy.address().port,
    richieste,
    icone: (dove) => richieste[dove].filter((r) => r.startsWith('img.piattaforma.test/')),
    close: async () => { await chiudi(diretto); await chiudi(viaProxy); },
  };
}

// Un SOCKS5 che porta ogni connessione alla porta «via proxy» del sito finto, col nome che la scheda ha chiesto.
async function proxySocks(portaProxy) {
  const vivi = new Set();
  const server = createNetServer((socket) => {
    vivi.add(socket);
    socket.on('close', () => vivi.delete(socket));
    socket.on('error', () => {});
    socket.once('data', (saluto) => {
      if (saluto[0] !== 0x05) { socket.end(); return; }
      socket.write(Buffer.from([0x05, 0x00]));
      socket.once('data', (req) => {
        if (req[0] !== 0x05 || req[1] !== 0x01) { socket.end(); return; }
        const su = netConnect(portaProxy, '127.0.0.1', () => {
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          socket.pipe(su); su.pipe(socket);
        });
        su.on('error', () => { try { socket.destroy(); } catch (_) {} });
        socket.on('close', () => { try { su.destroy(); } catch (_) {} });
      });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    porta: server.address().port,
    async close() { for (const s of vivi) { try { s.destroy(); } catch (_) {} } await new Promise((r) => server.close(r)); },
  };
}

async function avvia(userData) {
  const app = await electron.launch({
    args: [...argomentiScala, `--host-resolver-rules=${NOMI.map((n) => `MAP ${n} 127.0.0.1`).join(', ')}`, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
  });
  const shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
  return { app, shell };
}

async function apri(app, shell, url) {
  const host = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => Boolean(page = app.windows().find((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } })),
    { timeout: 20_000, message: `nessuna scheda su ${host}` }).toBe(true);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return page;
}

// L'icona l'ha scaricata la scheda con la sua sessione: da qui in poi Filo ne ha i byte.
const iconaArrivata = (app, host) => expect.poll(() => app.evaluate(({ BrowserWindow }, h) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w && w._filoTabs.tabs.find((x) => { try { return new URL(x.url).hostname === h; } catch (_) { return false; } });
  return /^data:image\/png/.test((t && t.favicon) || '');
}, host), { timeout: 15_000, message: `la scheda su ${host} non ha l'icona` }).toBe(true);

const idScheda = (app, host) => app.evaluate(({ BrowserWindow }, h) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return w._filoTabs.tabs.find((x) => { try { return new URL(x.url).hostname === h; } catch (_) { return false; } }).id;
}, host);

async function rigaDiChat(page, id, url) {
  await page.evaluate(({ id, url }) => {
    document.getElementById(id)?.remove();
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
    window.__filoDashActions.renderActions(el, [{ type: 'NAVIGA', url }]);
  }, { id, url });
  return page.locator(`#${id} .dash-action-link-chip`);
}

const caricata = (img) => expect.poll(() => img.evaluate((i) => i.complete && i.naturalWidth), { timeout: 10_000 }).toBe(1);

test('salvata e archiviata: riaperto Filo, home, «Aperti per dopo» e chat mostrano l\'icona senza chiedere niente al suo host', async () => {
  test.setTimeout(180_000);
  const siti = await sitiFinti();
  const userData = cartellaTemporanea('filo-icone-');
  const negozio = `http://negozio.test:${siti.porta}/dischi`;
  const blog = `http://blog.test:${siti.porta}/ricetta`;
  let app = null;
  try {
    // ── Primo avvio: «Salva per dopo» dalla barra laterale, e una scheda chiusa.
    let shell;
    ({ app, shell } = await avvia(userData));
    const pagina = await apri(app, shell, negozio);
    await iconaArrivata(app, 'negozio.test');
    await pagina.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
    const barra = await barraPage(app);
    await comandaBarra(app, 'clic');
    await pannelloFermo(barra);
    await barra.locator('#nav .ico[data-id="saveForLater"]').click();
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).map((p) => p.title)), { timeout: 10_000 })
      .toEqual(['Il negozio di dischi']);
    // Finita la conferma, la scheda salvata si chiude da sola.
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)
      ._filoTabs.tabs.some((t) => /negozio\.test/.test(t.url || ''))), { timeout: 15_000 }).toBe(false);

    await apri(app, shell, blog);
    await iconaArrivata(app, 'blog.test');
    const id = await idScheda(app, 'blog.test');
    await shell.evaluate((i) => window.filoShell.tabs.close(i), id);
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list())
      .filter((t) => /blog\.test/.test(t.url)).length), { timeout: 10_000 }).toBe(1);
    expect([...new Set(siti.icone('diretto'))].sort(), 'le due schede hanno scaricato le loro icone').toEqual(['img.piattaforma.test/blog.png', 'img.piattaforma.test/negozio.png']);
    await app.evaluate(async () => { await globalThis.__filoStorage.whenSettled(); globalThis.__filoStorage.flushSync(); });
    await chiudiApp(app);
    app = null;
    const primaDelRiavvio = siti.richieste.diretto.length;

    // ── Secondo avvio, stesso profilo: la home con i suggerimenti e la chat, poi «Aperti per dopo».
    ({ app, shell } = await avvia(userData));
    const home = await apri(app, shell, 'filo://newtab/');
    const voce = home.locator('#tieni .dash-carta[data-tipo="suggerimenti"] .dash-carta-voce').filter({ hasText: 'Il negozio di dischi' });
    await expect(voce.locator('.dash-carta-voce-ico img')).toHaveAttribute('src', /^data:image\/png;base64,/, { timeout: 15_000 });
    const chip = await rigaDiChat(home, 'riga-blog', `${blog}?altra=1`);
    await expect(chip.locator('img')).toHaveAttribute('src', `data:image/png;base64,${PNG_BLOG.toString('base64')}`, { timeout: 10_000 });
    const nuove = () => siti.richieste.diretto.slice(primaDelRiavvio);
    expect(nuove(), 'chi ospita le icone non sa quali siti Filo sta mostrando, e nessun sito viene contattato').toEqual([]);
    mkdirSync(SHOTS, { recursive: true });
    const foto = async (p, sel, nome) => {
      for (const tema of ['light', 'dark']) {
        await p.evaluate((t) => new Promise((ok) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } }, ok)), tema);
        await expect(p.locator('html')).toHaveAttribute('data-sn-theme', tema);
        await p.locator(sel).first().screenshot({ path: join(SHOTS, `copie-icone-${nome}-${tema}.png`) });
      }
    };
    await foto(home, '#tieni .dash-carta[data-tipo="suggerimenti"]', 'home');

    const salvate = await apri(app, shell, 'filo://home/home.html');
    const carta = salvate.locator('.sn-card', { hasText: 'Il negozio di dischi' });
    const ico = carta.locator('.sn-card-domain img');
    await expect(ico).toHaveAttribute('src', /^filo:\/\/icone\/[0-9a-f]{40}\.png$/);
    await caricata(ico);
    await foto(salvate, '.sn-card', 'salvate');
    // Il riordino delle icone dell'avvio non ha niente da chiedere: lo si fa partire subito invece di aspettarlo.
    await app.evaluate(() => globalThis.__filoIconeVecchie?.completa());
    expect(nuove(), 'né «Aperti per dopo» né il riordino delle icone chiedono niente').toEqual([]);
    // La copia sta nella cartella dati, non in storage.json.
    const voci = await app.evaluate(async () => [...await globalThis.SN_SAVED_PAGES.list(), ...await globalThis.SN_ARCHIVED_TABS.list()].map((v) => v.favicon));
    expect(voci.length).toBeGreaterThan(1);
    for (const f of voci) expect(f).toMatch(/^filo:\/\/icone\/[0-9a-f]{40}\.png$/);
  } finally {
    if (app) await chiudiApp(app);
    await siti.close();
    rmSync(userData, { recursive: true, force: true });
  }
});

test('«Aperti per dopo»: una pagina senza copia dell\'icona (da proxy, o un sito che non ne ha) mostra il globo', async () => {
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-icone-generica-');
  mkdirSync(userData, { recursive: true });
  const png = `data:image/png;base64,${PNG_NEGOZIO.toString('base64')}`;
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({
    savedPages: [
      { id: 'p1', url: 'https://con-icona.example/a', title: 'Con la sua icona', favicon: png, savedAt: '2026-10-01T10:00:00.000Z' },
      { id: 'p2', url: 'https://dal-proxy.example/b', title: 'Salvata da una scheda col proxy', favicon: '', proxy: { country: 'us', tier: null }, savedAt: '2026-10-02T10:00:00.000Z' },
      { id: 'p3', url: 'https://senza-icona.example/c', title: 'Sito senza icona', favicon: '', iconaMancante: true, savedAt: '2026-10-03T10:00:00.000Z' },
    ],
  }), 'utf8');
  let app = null;
  try {
    let shell;
    ({ app, shell } = await avvia(userData));
    const home = await apri(app, shell, 'filo://home/home.html');
    const dominio = (t) => home.locator('.sn-card', { hasText: t }).locator('.sn-card-domain');
    await expect(dominio('Con la sua icona').locator('img')).toHaveCount(1, { timeout: 15_000 });
    await expect(dominio('Con la sua icona').locator('.sn-card-ico')).toHaveCount(0);
    for (const t of ['Salvata da una scheda col proxy', 'Sito senza icona']) {
      await expect(dominio(t).locator('.sn-card-ico svg'), t).toHaveCount(1);
    }
    mkdirSync(SHOTS, { recursive: true });
    await home.locator('.sn-card', { hasText: 'Sito senza icona' }).screenshot({ path: join(SHOTS, 'copie-icone-generica.png') });
  } finally {
    if (app) await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});

test.describe('dal proxy', () => {
  test.use({ hostInPiu: NOMI });

  test('una scheda aperta da un altro paese, chiusa e ritrovata nell\'archivio: la sua icona non si chiede mai fuori dal proxy', async ({ app, shell, openTab }) => {
    test.setTimeout(120_000);
    const siti = await sitiFinti();
    const socks = await proxySocks(siti.portaProxy);
    try {
      await app.evaluate(async (_e, porta) => {
        await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: `socks5://127.0.0.1:${porta}`, bypass: '<-loopback>' } });
      }, socks.porta);
      const url = `http://dal-proxy.test:${siti.porta}/pagina`;
      await openTab(url);
      const id = await idScheda(app, 'dal-proxy.test');
      expect((await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.setTabProxy(i, 'us'), id)).ok).toBe(true);
      // Dopo il proxy la pagina e la sua icona passano da lì: è quella l'icona che l'archivio deve tenere.
      await expect.poll(() => siti.icone('proxy').includes('img.piattaforma.test/proxy.png'), { timeout: 15_000 }).toBe(true);
      await iconaArrivata(app, 'dal-proxy.test');
      const diretteAlProxy = siti.richieste.diretto.length;

      await shell.evaluate((i) => window.filoShell.tabs.close(i), id);
      await expect.poll(() => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list())
        .filter((t) => /dal-proxy\.test/.test(t.url)).map((t) => t.proxy && t.proxy.country)), { timeout: 10_000 }).toEqual(['us']);

      // Nell'archivio della home: la ricerca la ritrova, la chat ne mostra l'icona, e riaperta rinasce col proxy.
      const home = await openTab('filo://newtab/');
      const chip = await rigaDiChat(home, 'riga-proxy', `http://dal-proxy.test:${siti.porta}/altra`);
      await expect(chip.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/, { timeout: 10_000 });
      await home.locator('#cercaInput').fill('Pagina dal proxy');
      const trovata = home.locator('.dash-cerca-pagina', { hasText: 'Pagina dal proxy' });
      await expect(trovata).toBeVisible({ timeout: 10_000 });
      await trovata.click();
      await expect.poll(() => app.evaluate(({ BrowserWindow }, u) => {
        const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.tabs.find((x) => x.url === u && x.proxy);
        return t ? t.proxy.country : null;
      }, url), { timeout: 12_000 }).toBe('us');
      await iconaArrivata(app, 'dal-proxy.test');

      expect(siti.richieste.diretto.slice(diretteAlProxy), 'niente del sito passato dal proxy esce dalla connessione vera').toEqual([]);
      // L'archivio tiene i byte che la scheda ha scaricato dal proxy, non l'indirizzo.
      const archiviate = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).filter((t) => /dal-proxy\.test/.test(t.url)).map((t) => t.favicon));
      for (const f of archiviate) expect(f).toMatch(/^filo:\/\/icone\//);
    } finally {
      await socks.close();
      await siti.close();
    }
  });
});
