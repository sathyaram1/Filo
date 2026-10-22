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
import { apriFiloSenzaPlaywright } from './helpers/filoSenzaPlaywright.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARGOMENTI_RETE = ['--host-resolver-rules=MAP www.youtube.com 127.0.0.1, MAP www.youtube-nocookie.com 127.0.0.1, MAP sito-pubblico.test 127.0.0.1',
  // In https Chromium passerebbe dal proxy dell'ambiente (https_proxy), che il server locale non lo raggiunge.
  '--ignore-certificate-errors', '--no-proxy-server'];

const test = base.extend({
  app: async ({}, use) => {
    const userData = cartellaTemporanea('filo-adskip-');
    const app = await electron.launch({
      args: [...argomentiScala, ...ARGOMENTI_RETE, '.'],
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

// L'audio della pubblicità si sente anche da dietro: aspettare il ritorno sulla scheda vorrebbe dire sentirla tutta (#1494).
// Senza Playwright sulle pagine: lui le terrebbe visibili, e in una pagina nascosta l'animazione che segnala il «Salta» non parte.
async function conFiloSenzaPlaywright(opzioni, corpo) {
  const filo = await apriFiloSenzaPlaywright({ args: ARGOMENTI_RETE, ...opzioni });
  const nel = (url, codice) => filo.nelFrame(url, codice);
  const quando = (fn, message, timeout = 10_000) => expect.poll(fn, { timeout, message }).toBe(true);
  const h = {
    filo, nel, quando,
    apri: (url, attiva) => filo.evaluate(({ BrowserWindow }, a) => BrowserWindow.getAllWindows()
      .find((w) => w._filoTabs)._filoTabs.openTab(a.url, { activate: a.attiva }), { url, attiva }),
    arrivato: (url) => quando(async () => (await nel(url, 'typeof window.__mostra')) === 'function', `${url} non è arrivato`),
    nascosta: (url) => quando(async () => (await nel(url, 'document.visibilityState')) === 'hidden', `${url} non è nascosta`),
    saltata: (url) => quando(async () => (await nel(url, 'window.__saltata')) === true, `${url}: il «Salta» non è stato premuto`),
    clic: (url) => nel(url, 'window.__clic'),
  };
  try { await corpo(h); } finally { await filo.chiudi(); }
}

test('con la scheda dietro il «Salta» si preme lo stesso, su YouTube e negli altri lettori', async ({ testServer, suYouTube }) => {
  await conFiloSenzaPlaywright({}, async ({ filo, nel, apri, arrivato, nascosta, saltata, clic }) => {
    // La canzone che Filo mette dalla home nasce dietro, e l'utente resta dov'era.
    const yt = suYouTube(testServer.html(lettore({ dopoMs: -1, titolo: 'Canzone' })));
    const r = await filo.evaluate((_e, u) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: u, label: 'Canzone', background: true }), yt);
    expect(r.output && r.output.background).toBe(true);
    // Un lettore qualunque dentro un riquadro, visto e poi lasciato dietro.
    const ima = testServer.html(lettore({ classe: 'videoAdUiSkipButton', soloVeri: false, dopoMs: -1, titolo: 'IMA' }), { pubblico: true });
    await apri(testServer.html(`<!doctype html><title>Ospite</title><p>articolo</p><iframe src="${ima}" width="720" height="420"></iframe>`), true);
    await arrivato(ima);
    const altra = testServer.html('<title>Altra</title><p>altra scheda</p>');
    await apri(altra, true);
    await arrivato(yt);
    // Le anteprime svegliano per un attimo la scheda dietro che cambia, e lì l'animazione partirebbe: spente, a premere
    // il «Salta» resta solo Filo a pagina nascosta.
    await filo.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      tm.anteprime.chiudi();
      tm.layout();
    });
    for (const u of [yt, ima]) await nascosta(u);

    await filo.evaluate(({ BrowserWindow }, u) => {
      const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.view.webContents.getURL() === u);
      globalThis.__larghezzeAlClic = [];
      t.view.webContents.on('input-event', (_e, i) => { if (i.type === 'mouseDown') globalThis.__larghezzeAlClic.push(t.view.getBounds().width); });
    }, yt);
    for (const u of [yt, ima]) await nel(u, 'window.__mostra()');
    for (const u of [yt, ima]) await saltata(u);
    expect((await clic(yt)).every((c) => c.vero)).toBe(true);
    expect((await clic(ima)).length).toBe(1);
    // Ogni tanto la scheda dietro riprende la sua misura per un attimo: conta il clic arrivato quando era grande zero.
    expect(await filo.evaluate(() => globalThis.__larghezzeAlClic)).toContain(0);
    expect(await filo.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      return tm.tabs.find((t) => t.id === tm.activeId).view.webContents.getURL();
    }), 'l\'utente è rimasto dov\'era').toBe(altra);
  });
});

// La finestra dei test, parcheggiata fuori schermo, tiene nascoste anche le schede davanti: per vedere la differenza fra
// davanti e dietro serve la finestra vera, e solo su Linux lo schermo è virtuale e non la vede nessuno.
const conFinestraVera = (corpo) => conFiloSenzaPlaywright({ env: { FILO_HIDE_WINDOW: '0' } }, (h) => corpo({
  ...h,
  visibile: (url, perche) => h.quando(async () => (await h.nel(url, 'document.visibilityState')) === 'visible', perche),
  finestra: (azione) => h.filo.evaluate(({ BrowserWindow }, a) => { BrowserWindow.getAllWindows().find((w) => w._filoTabs)[a](); }, azione),
  attiva: (url) => h.filo.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.activate(tm.tabs.find((t) => t.view.webContents.getURL() === u).id);
  }, url),
}));

test('a finestra vera: con Filo ridotto a icona salta, e il video incorporato in una scheda dietro salta senza dare il gesto al sito né il fuoco a chi scrive altrove', async ({ testServer, suYouTube }) => {
  test.skip(process.platform !== 'linux', 'la finestra vera comparirebbe sullo schermo di chi prova');
  await conFinestraVera(async ({ nel, quando, apri, arrivato, nascosta, saltata, clic, visibile, finestra }) => {
    const yt = suYouTube(testServer.html(lettore({ dopoMs: -1, titolo: 'Canzone' })));
    await apri(yt, true);
    await arrivato(yt);
    await visibile(yt, 'la canzone davanti non si vede: la finestra non è quella vera');
    await finestra('hide');
    await nascosta(yt);
    await nel(yt, 'window.__mostra()');
    await saltata(yt);
    expect((await clic(yt)).every((c) => c.vero)).toBe(true);
    await finestra('show');

    for (const [host, pubblico] of [['www.youtube.com', false], ['www.youtube-nocookie.com', true]]) {
      const pagina = testServer.html(lettore({ dopoMs: -1 }));
      const dentro = host === 'www.youtube.com' ? suYouTube(pagina) : pagina.replace('127.0.0.1', host);
      const ospitante = testServer.html(ospite(dentro), { pubblico });
      await apri(ospitante, true);
      await arrivato(dentro);
      await visibile(dentro, `${host}: il lettore davanti non si vede`);
      // Si scrive una mail in un'altra scheda mentre il video suona dietro.
      const posta = testServer.html('<!doctype html><title>Posta</title><textarea id="t"></textarea>'
        + '<script>window.__via=0;document.getElementById("t").addEventListener("blur",()=>window.__via++);</script>');
      await apri(posta, true);
      await quando(async () => (await nel(posta, '(() => { const t = document.getElementById("t"); if (t) t.focus(); return document.activeElement && document.activeElement.id; })()')) === 't', 'la posta non si apre');
      await nascosta(dentro);
      await nel(dentro, 'window.__mostra()');
      await saltata(dentro);
      expect((await clic(dentro)).every((c) => c.vero), host).toBe(true);
      expect(await nel(ospitante, 'window.__gesti'), `${host}: il sito ha ricevuto il clic di Filo`).toEqual([]);
      expect(await nel(posta, 'document.activeElement.id + ":" + window.__via'), `${host}: chi scrive ha perso il fuoco`).toBe('t:0');
    }
  });
});

// #1494 — la pagina appena tornata davanti non è ancora disegnata: un clic instradato dal punto dello schermo cadeva sul sito.
test('a finestra vera: la pubblicità del video incorporato che compare mentre si torna sulla scheda si salta, e il sito non riceve il clic', async ({ testServer, suYouTube }) => {
  test.skip(process.platform !== 'linux', 'la finestra vera comparirebbe sullo schermo di chi prova');
  await conFinestraVera(async ({ nel, quando, apri, arrivato, nascosta, saltata, clic, visibile, attiva }) => {
    // Sbagliava in più di metà dei ritorni: quattro giri lo fanno vedere.
    for (let i = 0; i < 4; i++) {
      const dentro = suYouTube(testServer.html(lettore({ dopoMs: -1, titolo: `Video ${i}` })));
      const ospitante = testServer.html(ospite(dentro), { pubblico: i % 2 === 1 });
      await apri(ospitante, true);
      await arrivato(dentro);
      await visibile(dentro, `giro ${i}: il lettore davanti non si vede`);
      await apri(testServer.html(`<title>Altra ${i}</title><p>altra</p>`), true);
      await nascosta(dentro);
      await nel(dentro, 'window.__mostra()');
      await attiva(ospitante);
      await saltata(dentro);
      expect((await clic(dentro)).every((c) => c.vero), `giro ${i}`).toBe(true);
      expect(await nel(ospitante, 'window.__gesti'), `giro ${i}: il sito ha ricevuto il clic di Filo`).toEqual([]);
      await quando(async () => (await nel(dentro, 'document.visibilityState')) === 'visible', `giro ${i}: non è tornata davanti`);
    }
  });
});

// #1494 — dietro, il lettore fuori dalla vista (si leggevano i commenti) non lo vede nessuno: aspettare vuol dire sentirla tutta.
test('a finestra vera: YouTube lasciato dietro mentre si leggevano i commenti salta lo stesso, e si ritrova la pagina dove la si era lasciata', async ({ testServer, suYouTube }) => {
  test.skip(process.platform !== 'linux', 'la finestra vera comparirebbe sullo schermo di chi prova');
  await conFinestraVera(async ({ nel, apri, arrivato, nascosta, saltata, clic, visibile, attiva }) => {
    const yt = suYouTube(testServer.html(lettore({ dopoMs: -1, titolo: 'Canzone' }).replace('</body>', '<div style="height:3000px">commenti</div></body>')));
    await apri(yt, true);
    await arrivato(yt);
    await visibile(yt, 'la canzone davanti non si vede');
    await nel(yt, 'scrollTo(0, 1500); scrollY');
    await apri(testServer.html('<title>Altra</title><p>altra</p>'), true);
    await nascosta(yt);
    await nel(yt, 'window.__mostra()');
    await saltata(yt);
    // Un'anteprima della scheda la sveglia per un attimo: lì, col lettore fuori dalla vista, prova il clic dello script.
    expect((await clic(yt)).some((c) => c.vero)).toBe(true);
    await expect.poll(() => nel(yt, 'scrollY'), { timeout: 5_000 }).toBe(1500);
    await attiva(yt);
    await visibile(yt, 'non è tornata davanti');
    expect(await nel(yt, 'scrollY')).toBe(1500);
  });
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

// #737.1 giro 2 — il clic di Filo sul lettore non vale come gesto per le finestre del sito ospite.
test('il «Salta» premuto da Filo nel lettore incorporato non apre al sito che lo ospita la scheda che chiede di continuo', async ({ app, openTab, testServer, suYouTube }) => {
  const bersaglio = testServer.html('<title>PUBBLICITA OSPITE</title>');
  const dentro = suYouTube(testServer.html(lettore({ dopoMs: -1 })));
  const html = ospite(dentro).replace('</body>', `<script>setInterval(function(){window.open(${JSON.stringify(bersaglio)})},300)</script></body>`);
  const page = await apri(openTab, testServer.html(html, { pubblico: true }));
  const frame = await riquadro(page, dentro);
  await frame.waitForFunction(() => typeof window.__mostra === 'function');
  // Il gesto di Playwright che apre la scheda deve essere scaduto.
  await page.waitForTimeout(5500);
  await frame.evaluate(() => window.__mostra());
  await expect.poll(() => frame.evaluate(() => window.__saltata), { timeout: 6_000 }).toBe(true);
  expect((await frame.evaluate(() => window.__clic)).every((c) => c.vero)).toBe(true);
  await page.waitForTimeout(2500);
  const aperte = await app.evaluate(({ BrowserWindow }, b) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs
    .filter((t) => { try { return t.view.webContents.getURL() === b; } catch (_) { return false; } }).length, bersaglio);
  expect(aperte).toBe(0);
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
