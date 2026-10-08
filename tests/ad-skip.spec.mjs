// #737 — una pubblicità che si può saltare la salta Filo, appena il lettore mostra «Salta».
// YouTube ignora i clic fabbricati da uno script: lì il «Salta» lo preme il main con un clic vero, e solo lì.
// Il lettore di YouTube qui è finto e servito sotto www.youtube.com (host-resolver-rules): la rete vera non serve.
// Chromium apre youtube.com solo in https (è nella sua lista HSTS): il lettore finto passa da un server https locale.

import { test as base, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { request as richiestaHttp } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { certificato } from './helpers/immagineFirmata.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const test = base.extend({
  app: async ({}, use) => {
    const userData = cartellaTemporanea('filo-adskip-');
    const app = await electron.launch({
      args: [...argomentiScala, '--host-resolver-rules=MAP www.youtube.com 127.0.0.1, MAP www.youtube-nocookie.com 127.0.0.1, MAP sito-pubblico.test 127.0.0.1',
        // In https Chromium passerebbe dal proxy dell'ambiente (https_proxy), che il server locale non lo raggiunge.
        '--ignore-certificate-errors', '--no-proxy-server', '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
  // Lo stesso indirizzo del server di prova, servito in https sotto www.youtube.com.
  suYouTube: async ({ testServer }, use) => {
    const { der, privateKey } = certificato({ organizzazione: 'Filo test', nomeComune: 'www.youtube.com', usi: [] });
    const cert = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
    const base = new URL(testServer.origin);
    const srv = createHttpsServer({ key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert }, (req, res) => {
      const inoltro = richiestaHttp({ host: base.hostname, port: base.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode || 502, r.headers);
        r.pipe(res);
      });
      inoltro.on('error', () => { res.writeHead(502); res.end(); });
      req.pipe(inoltro);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    await use((url) => url.replace(testServer.origin, `https://www.youtube.com:${srv.address().port}`));
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  },
});

// Un lettore con la pubblicità in corso: il «Salta» compare dopo `dopoMs`, come dopo i cinque secondi di YouTube.
// Con `soloVeri` un clic fabbricato non salta niente, come su YouTube.
function lettore({ classe = 'ytp-skip-ad-button', soloVeri = true, dopoMs = 1200, campo = false, titolo = 'Lettore' } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${titolo}</title><style>
  body{margin:0;font:14px sans-serif}
  #movie_player{position:relative;width:640px;height:360px;background:#222;margin:20px}
  #slot{position:absolute;right:0;bottom:60px;display:none}
  #slot button{padding:10px 22px;font:16px sans-serif}
  </style></head><body>
  ${campo ? '<input id="cerca" placeholder="cerca">' : ''}
  <div id="movie_player" class="html5-video-player ad-showing">
    <video muted></video>
    <div id="slot"><button class="${classe}" id="salta">Salta</button></div>
  </div>
  <script>
    window.__clic = [];
    window.__saltata = false;
    document.getElementById('salta').addEventListener('click', (e) => {
      window.__clic.push({ vero: e.isTrusted, alle: Date.now() });
      if (${soloVeri ? '!e.isTrusted' : 'false'}) return;
      document.getElementById('movie_player').classList.remove('ad-showing');
      document.getElementById('slot').style.display = 'none';
      window.__saltata = true;
    });
    window.__mostra = () => { document.getElementById('slot').style.display = 'block'; window.__mostrataAlle = Date.now(); };
    ${dopoMs >= 0 ? `setTimeout(window.__mostra, ${dopoMs});` : ''}
  </script></body></html>`;
}

const stato = (page) => page.evaluate(() => ({
  clic: window.__clic, saltata: window.__saltata, mostrataAlle: window.__mostrataAlle || 0,
}));


async function apri(openTab, url) {
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
  return page;
}

async function impostazioni(app, settings) {
  const filo = { tab: { id: 1, url: 'filo://security/security.html' }, url: 'filo://security/security.html' };
  await app.evaluate(async (_, a) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: a.settings }, a.filo), { settings, filo });
}
const interruttore = (app, acceso) => impostazioni(app, { security: { adSkip: { enabled: acceso } } });

test('su YouTube il «Salta» si preme da solo appena compare, con un clic vero', async ({ openTab, testServer, suYouTube }) => {
  const page = await apri(openTab, suYouTube(testServer.html(lettore({ dopoMs: -1 }))));
  // Prima che il lettore lo mostri, niente.
  await page.waitForTimeout(600);
  expect((await stato(page)).clic).toEqual([]);
  await page.evaluate(() => window.__mostra());
  await expect.poll(async () => (await stato(page)).saltata, { timeout: 5_000 }).toBe(true);
  const s = await stato(page);
  expect(s.clic.length).toBe(1);
  expect(s.clic[0].vero).toBe(true);
  expect(s.clic[0].alle - s.mostrataAlle).toBeLessThan(1500);
  await expect(page.locator('#movie_player')).not.toHaveClass(/ad-showing/);
});

test('una serie di pubblicità: il «Salta» che ricompare si preme di nuovo', async ({ openTab, testServer, suYouTube }) => {
  const page = await apri(openTab, suYouTube(testServer.html(lettore())));
  await expect.poll(async () => (await stato(page)).saltata, { timeout: 5_000 }).toBe(true);
  await page.evaluate(() => { window.__saltata = false; window.__mostra(); });
  await expect.poll(async () => (await stato(page)).saltata, { timeout: 5_000 }).toBe(true);
  const s = await stato(page);
  expect(s.clic.filter((c) => c.vero).length).toBe(2);
});

test('con la pagina ingrandita il clic vero cade ancora sul «Salta»', async ({ app, openTab, testServer, suYouTube }) => {
  const page = await apri(openTab, suYouTube(testServer.html(lettore({ dopoMs: -1 }))));
  await app.evaluate(({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => { try { return new URL(w.getURL()).hostname === 'www.youtube.com'; } catch (_) { return false; } });
    wc.setZoomFactor(1.5);
  });
  await expect.poll(() => page.evaluate(() => window.devicePixelRatio), { timeout: 5_000 }).toBeGreaterThan(1.4);
  await page.evaluate(() => window.__mostra());
  await expect.poll(async () => (await stato(page)).saltata, { timeout: 5_000 }).toBe(true);
  expect((await stato(page)).clic.every((c) => c.vero)).toBe(true);
});

test('in una scheda in secondo piano salta lo stesso, col clic vero', async ({ app, openTab, testServer, suYouTube }) => {
  // L'audio della pubblicità si sente anche da un'altra scheda: aspettare il ritorno vorrebbe dire sentirla tutta.
  const page = await apri(openTab, suYouTube(testServer.html(lettore({ dopoMs: -1 }))));
  await apri(openTab, testServer.html('<title>Altra</title><p>altra scheda</p>'));
  const dietro = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.view.webContents.getURL().includes('www.youtube.com'));
    const b = t.view.getBounds();
    return t.id !== w._filoTabs.activeId && b.width === 0;
  });
  await expect.poll(dietro, { timeout: 5_000 }).toBe(true);
  // Ogni tanto la scheda dietro riprende la sua misura per un attimo: conta il clic arrivato quando era grande zero.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.view.webContents.getURL().includes('www.youtube.com'));
    globalThis.__larghezzeAlClic = [];
    t.view.webContents.on('input-event', (_e, i) => {
      if (i.type === 'mouseDown') globalThis.__larghezzeAlClic.push(t.view.getBounds().width);
    });
  });
  await page.evaluate(() => window.__mostra());
  await expect.poll(async () => (await stato(page)).saltata, { timeout: 3_000 }).toBe(true);
  expect((await stato(page)).clic.every((c) => c.vero)).toBe(true);
  expect(await app.evaluate(() => globalThis.__larghezzeAlClic)).toContain(0);
});

test('mentre si scrive in un campo della pagina aspetta, poi salta', async ({ openTab, testServer, suYouTube }) => {
  const page = await apri(openTab, suYouTube(testServer.html(lettore({ dopoMs: -1, campo: true }))));
  await page.locator('#cerca').click();
  await page.keyboard.type('gatti');
  await page.evaluate(() => window.__mostra());
  await page.waitForTimeout(1500);
  let s = await stato(page);
  expect(s.saltata).toBe(false);
  expect(s.clic).toEqual([]);
  await expect(page.locator('#cerca')).toBeFocused();
  await page.evaluate(() => document.getElementById('cerca').blur());
  await expect.poll(async () => (await stato(page)).saltata, { timeout: 5_000 }).toBe(true);
  s = await stato(page);
  expect(s.clic.every((c) => c.vero)).toBe(true);
  expect(await page.locator('#cerca').inputValue()).toBe('gatti');
});

test('col lettore fuori dalla vista aspetta di rivederlo, poi salta col clic vero', async ({ openTab, testServer, suYouTube }) => {
  const html = lettore({ dopoMs: -1 }).replace('</body>', '<div style="height:3000px">commenti</div></body>');
  const page = await apri(openTab, suYouTube(testServer.html(html)));
  await page.evaluate(() => window.scrollTo(0, 2000));
  await page.evaluate(() => window.__mostra());
  await page.waitForTimeout(2000);
  let s = await stato(page);
  expect(s.saltata).toBe(false);
  expect(s.clic.filter((c) => c.vero)).toEqual([]);
  expect(s.clic.length).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  const tornato = Date.now();
  await expect.poll(async () => (await stato(page)).saltata, { timeout: 3_000 }).toBe(true);
  s = await stato(page);
  expect(s.clic.find((c) => c.vero).alle - tornato).toBeLessThan(1000);
});

test('negli altri lettori basta il clic dello script, anche dentro un riquadro', async ({ openTab, testServer }) => {
  const dentro = testServer.html(lettore({ classe: 'videoAdUiSkipButton', soloVeri: false, titolo: 'IMA' }), { pubblico: true });
  const page = await apri(openTab, testServer.html(`<!doctype html><title>Ospite</title><body>
    <p>articolo</p><iframe id="pub" src="${dentro}" width="720" height="420"></iframe></body>`));
  const frame = await expect.poll(() => page.frames().find((f) => f.url() === dentro) || null, { timeout: 5_000 }).not.toBeNull()
    .then(() => page.frames().find((f) => f.url() === dentro));
  await expect.poll(() => frame.evaluate(() => window.__saltata), { timeout: 6_000 }).toBe(true);
  const clic = await frame.evaluate(() => window.__clic);
  expect(clic.length).toBe(1);
  expect(clic[0].vero).toBe(false);
});

// La pagina che ospita il lettore conta i gesti veri che riceve: quelli spettano al riquadro, non a lei.
function ospite(src, { sopra = false } = {}) {
  return `<!doctype html><title>Blog</title><body style="margin:8px"><p>articolo</p>
  <script>window.__gesti=[];['pointerdown','mousedown','click'].forEach((t)=>document.addEventListener(t,(e)=>{if(e.isTrusted)window.__gesti.push(t+':'+e.target.tagName);},true));</script>
  <div style="position:relative;width:724px;height:424px">
    <iframe id="yt" src="${src}" width="720" height="420"></iframe>
    ${sopra ? '<div id="sopra" style="position:absolute;inset:0;background:transparent"></div>' : ''}
  </div></body>`;
}

async function riquadro(page, url) {
  await expect.poll(() => page.frames().find((f) => f.url() === url) || null, { timeout: 5_000 }).not.toBeNull();
  return page.frames().find((f) => f.url() === url);
}

test('un video di YouTube incorporato in un altro sito salta la pubblicità, e il gesto resta al lettore', async ({ app, openTab, testServer, suYouTube }) => {
  // Ogni giro su un sito ospite diverso (una scheda per sito); lo zoom sposta il punto, il clic deve cadere lo stesso.
  for (const [host, zoom, pubblico] of [['www.youtube.com', 1.5, false], ['www.youtube-nocookie.com', 1, true]]) {
    const pagina = testServer.html(lettore({ dopoMs: -1 }));
    const dentro = host === 'www.youtube.com' ? suYouTube(pagina) : pagina.replace('127.0.0.1', host);
    const page = await apri(openTab, testServer.html(ospite(dentro), { pubblico }));
    const frame = await riquadro(page, dentro);
    if (zoom !== 1) {
      await app.evaluate(({ webContents }, h) => {
        webContents.getAllWebContents().find((w) => { try { return new URL(w.getURL()).hostname === h; } catch (_) { return false; } })
          .setZoomFactor(1.5);
      }, new URL(page.url()).hostname);
      await expect.poll(() => page.evaluate(() => window.devicePixelRatio), { timeout: 5_000 }).toBeGreaterThan(1.4);
    }
    await frame.waitForFunction(() => typeof window.__mostra === 'function');
    await frame.evaluate(() => window.__mostra());
    await expect.poll(() => frame.evaluate(() => window.__saltata), { timeout: 5_000, message: host }).toBe(true);
    const clic = await frame.evaluate(() => window.__clic);
    expect(clic.every((c) => c.vero), host).toBe(true);
    expect(await page.evaluate(() => window.__gesti), host).toEqual([]);
  }
});

test('se il sito che ospita il lettore ci mette sopra un suo elemento, quell\'elemento non riceve il clic vero', async ({ openTab, testServer, suYouTube }) => {
  const dentro = suYouTube(testServer.html(lettore({ dopoMs: -1 })));
  const page = await apri(openTab, testServer.html(ospite(dentro, { sopra: true })));
  const frame = await riquadro(page, dentro);
  await frame.waitForFunction(() => typeof window.__mostra === 'function');
  await frame.evaluate(() => window.__mostra());
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.__gesti)).toEqual([]);
  expect((await frame.evaluate(() => window.__clic)).some((c) => c.vero)).toBe(false);
});

// Il sito copre il lettore con un SUO riquadro e gli fa ripetere al padre ogni messaggio che arriva dal lettore:
// si presenta col nome del lettore, ma la sua origine è quella del sito.
const TRAPPOLA = `<!doctype html><body style="margin:0;background:transparent"><script>
  window.__gesti=[];['pointerdown','mousedown','click'].forEach((t)=>document.addEventListener(t,(e)=>{if(e.isTrusted)window.__gesti.push(t);},true));
  addEventListener('message',(e)=>{if(e.source===parent&&e.data&&e.data.rilancia)parent.postMessage(e.data.rilancia,'*');});
  </script></body>`;

test('il sito che ospita il lettore non si prende il clic vero ripetendo i messaggi del lettore da un suo riquadro', async ({ openTab, testServer, suYouTube }) => {
  const dentro = suYouTube(testServer.html(lettore({ dopoMs: -1 })));
  const urlTrappola = testServer.html(TRAPPOLA);
  const page = await apri(openTab, testServer.html(`<!doctype html><title>Blog</title><body style="margin:8px"><p>articolo</p>
  <div style="position:relative;width:724px;height:424px">
    <iframe id="yt" src="${dentro}" width="720" height="420"></iframe>
    <iframe id="trappola" src="${urlTrappola}" style="position:absolute;left:0;top:0;width:724px;height:424px;border:0"></iframe>
  </div>
  <script>window.__rilanciati=0;addEventListener('message',(e)=>{const t=document.getElementById('trappola').contentWindow;
    if(e.source!==t&&e.data&&typeof e.data==='object'){window.__rilanciati++;t.postMessage({rilancia:e.data},'*');}});</script></body>`));
  const frame = await riquadro(page, dentro);
  const trappola = await riquadro(page, urlTrappola);
  await frame.waitForFunction(() => typeof window.__mostra === 'function');
  await frame.evaluate(() => window.__mostra());
  await page.waitForTimeout(4000);
  expect(await page.evaluate(() => window.__rilanciati), 'il lettore si è presentato e il sito l\'ha ripetuto').toBeGreaterThan(0);
  expect(await trappola.evaluate(() => window.__gesti)).toEqual([]);
  expect(await page.evaluate(() => window.__gesti || [])).toEqual([]);
  // Tolto il riquadro del sito, il «Salta» si preme: il lettore era quello giusto, solo coperto.
  await page.evaluate(() => document.getElementById('trappola').remove());
  await expect.poll(() => frame.evaluate(() => window.__saltata), { timeout: 15_000 }).toBe(true);
});

test('il lettore di YouTube dentro un riquadro intermedio salta la pubblicità', async ({ openTab, testServer, suYouTube }) => {
  // Molte piattaforme di articoli passano da un servizio di incorporamento: il lettore è un riquadro dentro un riquadro.
  const dentro = suYouTube(testServer.html(lettore({ dopoMs: -1 })));
  const mezzo = testServer.html(`<!doctype html><body style="margin:6px"><iframe src="${dentro}" width="700" height="400" style="border:0"></iframe></body>`)
    .replace('127.0.0.1', 'sito-pubblico.test');
  const page = await apri(openTab, testServer.html(ospite(mezzo)));
  const frame = await riquadro(page, dentro);
  await frame.waitForFunction(() => typeof window.__mostra === 'function');
  await frame.evaluate(() => window.__mostra());
  await expect.poll(() => frame.evaluate(() => window.__saltata), { timeout: 8_000 }).toBe(true);
  expect((await frame.evaluate(() => window.__clic)).every((c) => c.vero)).toBe(true);
  expect(await page.evaluate(() => window.__gesti)).toEqual([]);
});

test('fuori da YouTube un «Salta» di YouTube non riceve mai un clic vero', async ({ openTab, testServer }) => {
  // Un sito qualunque può disegnarsi un pulsante con quella classe: un clic vero gli regalerebbe un gesto dell'utente.
  const page = await apri(openTab, testServer.html(lettore()));
  await expect.poll(async () => (await stato(page)).clic.length, { timeout: 5_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2500);
  const s = await stato(page);
  expect(s.saltata).toBe(false);
  expect(s.clic.some((c) => c.vero)).toBe(false);
});

test('spento non tocca niente; riacceso preme il «Salta» già a schermo', async ({ app, openTab, testServer, suYouTube }) => {
  await interruttore(app, false);
  const page = await apri(openTab, suYouTube(testServer.html(lettore({ dopoMs: 300 }))));
  await page.waitForTimeout(2000);
  expect((await stato(page)).clic).toEqual([]);
  await interruttore(app, true);
  await expect.poll(async () => (await stato(page)).saltata, { timeout: 5_000 }).toBe(true);
});

test('l\'interruttore sta in Sicurezza, sotto il blocco delle pubblicità, e spegne davvero', async ({ app, openTab, testServer, suYouTube }) => {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('#sec-adskip', { timeout: 8_000 });
  await expect(sec.locator('#sec-adskip')).toBeChecked();
  await expect(sec.locator('#sec-adskip-label')).toHaveText('Salta le pubblicità dei video');
  const y = async (sel) => (await sec.locator(sel).boundingBox()).y;
  expect(await y('#sec-adskip')).toBeGreaterThan(await y('#sec-adblock'));
  await sec.locator('#sec-adskip').uncheck();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.adSkip.enabled)).toBe(false);

  const page = await apri(openTab, suYouTube(testServer.html(lettore({ dopoMs: 300 }))));
  await page.waitForTimeout(2000);
  expect((await stato(page)).clic).toEqual([]);

  const shots = join(APP_ROOT, 'tests', '.shots');
  for (const tema of ['light', 'dark']) {
    await impostazioni(app, { theme: tema });
    await sec.waitForTimeout(600);
    await sec.locator('#sec-adblock').scrollIntoViewIfNeeded();
    await sec.screenshot({ path: join(shots, `ad-skip-sicurezza-${tema}.png`) });
  }
});
