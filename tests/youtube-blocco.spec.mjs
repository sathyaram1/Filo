// #1974 — su YouTube i video partono senza pubblicità: le regole di iniezione tolgono gli spazi pubblicitari dalla
// risposta del lettore prima che parta. YouTube vero dal contenitore non si raggiunge: il lettore qui è finto, servito in
// https sotto www.youtube.com (host-resolver-rules), con la risposta del lettore nella forma vera (pagina, fetch, xhr).

import { test, expect } from './fixtures/electron.mjs';
import { createServer as createHttpsServer } from 'node:https';
import { certificato } from './helpers/immagineFirmata.mjs';

test.use({
  hostInPiu: ['www.youtube.com'],
  // In https Chromium passerebbe dal proxy dell'ambiente, che il server locale non lo raggiunge.
  argomentiInPiu: ['--ignore-certificate-errors', '--no-proxy-server'],
});

// La risposta del lettore con gli spazi pubblicitari, come la scrive YouTube nella pagina e nelle sue chiamate.
const risposta = (id) => ({
  responseContext: {}, playabilityStatus: { status: 'OK' }, videoDetails: { videoId: id },
  adPlacements: [{ adPlacementRenderer: { config: { kind: 'AD_PLACEMENT_KIND_START' } } }],
  adSlots: [{ adSlotRenderer: {} }], playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }], streamingData: {},
});

// Il lettore finto: legge la risposta e mostra la pubblicità (col suo «Salta») solo se ci sono i suoi spazi.
// `interna`: chiede la risposta anche come nella navigazione fra video (fetch e xhr). `controllo`: senza pubblicità
// mostra l'avviso di YouTube sui blocchi. Senza risposta il video prova a partire e resta fermo.
function pagina(id, q) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Video ${id}</title><style>
  body{margin:0;font:14px sans-serif} #movie_player{position:relative;width:640px;height:360px;background:#222;margin:20px}
  #slot{position:absolute;right:0;bottom:60px;display:none} #slot button{padding:10px 22px;font:16px sans-serif}
  </style></head><body>
  <div id="movie_player" class="html5-video-player"><video id="v" muted></video>
    <div id="slot"><button class="ytp-skip-ad-button" id="salta">Salta</button></div></div>
  <script>window.__pubblicitaAccesa = true;</script>
  <script>var ytInitialPlayerResponse = ${JSON.stringify(risposta(id))};</script>
  <script>
    window.__esiti = []; window.__saltata = false;
    const p = document.getElementById('movie_player'), v = document.getElementById('v'), slot = document.getElementById('slot');
    document.getElementById('salta').addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      p.classList.remove('ad-showing'); slot.style.display = 'none'; window.__saltata = true;
    });
    function mostra(r, dove) {
      const pub = !!(r && ((r.adPlacements && r.adPlacements.length) || (r.adSlots && r.adSlots.length)));
      window.__esiti.push(dove + ':' + (r ? (pub ? 'pubblicita' : 'video') : 'niente'));
      if (!r) { v.play().catch(() => {}); return; }
      if (pub) { p.classList.add('ad-showing'); setTimeout(() => { slot.style.display = 'block'; }, 300); return; }
      if (${q.get('controllo') === '1'}) document.body.appendChild(document.createElement('ytd-enforcement-message-view-model'));
    }
    mostra(window.ytInitialPlayerResponse, 'pagina');
    if (${q.get('interna') === '1'}) {
      fetch('/youtubei/v1/player?prettyPrint=false', { method: 'POST', body: JSON.stringify({ context: { client: { clientName: 'WEB' } }, videoId: '${id}' }) })
        .then((r) => r.json()).then((o) => mostra(o, 'fetch'), () => window.__esiti.push('fetch:errore'));
      const x = new XMLHttpRequest();
      x.open('POST', '/youtubei/v1/player');
      x.onload = () => mostra(JSON.parse(x.responseText), 'xhr');
      x.send('{}');
    }
  </script></body></html>`;
}

const fixture = test.extend({
  // Il finto www.youtube.com: /watch e /embed sono il lettore, /youtubei/v1/player la sua risposta. Conta le pagine servite.
  youtube: async ({}, use) => {
    const { der, privateKey } = certificato({ organizzazione: 'Filo test', nomeComune: 'www.youtube.com', usi: [] });
    const cert = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
    const servite = [];
    const srv = createHttpsServer({ key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert }, (req, res) => {
      const u = new URL(req.url, 'https://www.youtube.com');
      if (u.pathname === '/youtubei/v1/player') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(risposta('interna')));
        return;
      }
      const m = /^\/(watch|embed\/([\w-]+))$/.exec(u.pathname);
      if (!m) { res.writeHead(404); res.end(); return; }
      servite.push(u.pathname + u.search);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina(m[2] || u.searchParams.get('v') || 'x', u.searchParams));
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    await use({ url: (p) => `https://www.youtube.com:${srv.address().port}${p}`, servite });
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  },
});

const MANO = [
  'www.youtube.com##+js(set, ytInitialPlayerResponse.adPlacements, undefined)',
  'www.youtube.com##+js(set, ytInitialPlayerResponse.adSlots, undefined)',
  'www.youtube.com##+js(json-prune-fetch-response, adPlacements adSlots, , propsToMatch, /\\/player(\\?|$)/)',
  'www.youtube.com##+js(json-prune-xhr-response, adPlacements adSlots, , propsToMatch, /\\/player$/)',
  'www.youtube.com##+js(rpnt, script, window.__pubblicitaAccesa = true, window.__pubblicitaAccesa = false)',
].join('\n');

const liste = (app, testi) => app.evaluate((_e, t) => globalThis.__filoBloccoYouTube.impostaListePerTest(t), testi);
const stato = (app) => app.evaluate(() => globalThis.__filoBloccoYouTube.status());
const impostazioni = (app, settings) => app.evaluate(async (_e, s) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: s },
  { tab: { id: 1, url: 'filo://security/security.html' }, url: 'filo://security/security.html' }), settings);
// fetch e xhr rispondono nell'ordine che vogliono: conta cosa ha mostrato ognuno.
const esiti = (page) => page.evaluate(() => window.__esiti && window.__esiti.slice().sort());

async function apri(openTab, url) {
  const page = await openTab(url);
  await page.waitForFunction(() => Array.isArray(window.__esiti), null, { timeout: 10_000 });
  return page;
}

fixture('il video parte senza pubblicità: la risposta nella pagina, quella chiesta con fetch e con xhr; spento, torna «Salta»', async ({ app, openTab, youtube }) => {
  await liste(app, [MANO]);
  const page = await apri(openTab, youtube.url('/watch?v=abc&interna=1'));
  await expect.poll(() => esiti(page), { timeout: 10_000 }).toEqual(['pagina:video', 'fetch:video', 'xhr:video']);
  await expect(page.locator('#movie_player')).not.toHaveClass(/ad-showing/);
  expect(await page.evaluate(() => window.__pubblicitaAccesa), 'rpnt riscrive lo script prima che giri').toBe(false);

  await impostazioni(app, { security: { youtubeAds: { enabled: false } } });
  await page.reload();
  await page.waitForFunction(() => Array.isArray(window.__esiti), null, { timeout: 10_000 });
  await expect.poll(() => esiti(page), { timeout: 10_000 }).toEqual(['pagina:pubblicita', 'fetch:pubblicita', 'xhr:pubblicita']);
  await expect.poll(() => page.evaluate(() => window.__saltata), { timeout: 10_000, message: '«Salta» resta acceso da solo' }).toBe(true);
});

fixture('con le regole vere scaricate da uAssets il video parte senza pubblicità', async ({ app, openTab, youtube }) => {
  test.setTimeout(90_000);
  const base = 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/';
  let testi = null;
  try {
    const prendi = async (n) => { const r = await fetch(base + n, { signal: AbortSignal.timeout(20_000) }); if (!r.ok) throw new Error(String(r.status)); return r.text(); };
    const [filtri, rapide] = await Promise.all([prendi('filters.txt'), prendi('quick-fixes.txt')]);
    const inclusi = [...filtri.matchAll(/^!#include\s+([\w.-]+\.txt)$/gm)].map((m) => m[1]);
    testi = [filtri, rapide, ...(await Promise.all(inclusi.map(prendi)))];
  } catch (e) { fixture.skip(true, `liste di uAssets non raggiungibili: ${e.message}`); }
  const s = await liste(app, testi);
  expect(s.regole).toBeGreaterThan(5);
  const page = await apri(openTab, youtube.url('/watch?v=vere&interna=1'));
  await expect.poll(() => esiti(page), { timeout: 15_000 }).toEqual(['pagina:video', 'fetch:video', 'xhr:video']);
  await expect(page.locator('#movie_player')).not.toHaveClass(/ad-showing/);
});

fixture('il video di YouTube incorporato in un altro sito parte senza pubblicità', async ({ app, openTab, testServer, youtube }) => {
  await liste(app, [MANO]);
  const dentro = youtube.url('/embed/inc?interna=1');
  const ospite = await openTab(testServer.html(`<!doctype html><title>Articolo</title><p>articolo</p><iframe src="${dentro}" width="700" height="420"></iframe>`, { pubblico: true }));
  let frame = null;
  await expect.poll(async () => {
    frame = ospite.frames().find((f) => f.url().includes('/embed/inc'));
    return frame ? frame.evaluate(() => window.__esiti && window.__esiti.length).catch(() => 0) : 0;
  }, { timeout: 15_000 }).toBe(3);
  expect(await frame.evaluate(() => window.__esiti)).toEqual(['pagina:video', 'fetch:video', 'xhr:video']);
});

fixture('l\'avviso di YouTube sui blocchi: la scheda torna al solo «Salta», si ricarica una volta e lo dice; con le regole nuove riprova', async ({ app, openTab, youtube, avvisi }) => {
  await liste(app, [MANO]);
  const page = await apri(openTab, youtube.url('/watch?v=avv&controllo=1'));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif-msg', { hasText: 'Oggi il blocco delle pubblicità su YouTube non funziona' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => youtube.servite.length, { timeout: 10_000 }).toBe(2);
  await page.waitForFunction(() => Array.isArray(window.__esiti) && window.__esiti.length > 0, null, { timeout: 10_000 });
  expect(await esiti(page)).toEqual(['pagina:pubblicita']);
  await expect.poll(() => page.evaluate(() => window.__saltata), { timeout: 10_000 }).toBe(true);
  expect((await stato(app)).spente).toBe(1);
  await page.waitForTimeout(1500);
  expect(youtube.servite.length, 'una ricarica sola').toBe(2);

  await liste(app, [`${MANO}\nwww.youtube.com##+js(set, playerResponse.adPlacements, undefined)`]);
  expect((await stato(app)).spente).toBe(0);
  await page.goto(youtube.url('/watch?v=dopo'));
  await page.waitForFunction(() => Array.isArray(window.__esiti) && window.__esiti.length > 0, null, { timeout: 10_000 });
  expect(await esiti(page), 'con le regole nuove la scheda riprova il blocco').toEqual(['pagina:video']);
});

fixture('regole che fermano il video: dopo pochi secondi la scheda torna al solo «Salta» e il video parte con la sua pubblicità', async ({ app, openTab, youtube, avvisi }) => {
  test.setTimeout(60_000);
  await liste(app, ['www.youtube.com##+js(set, ytInitialPlayerResponse, undefined)']);
  const page = await apri(openTab, youtube.url('/watch?v=fermo'));
  expect(await esiti(page)).toEqual(['pagina:niente']);
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  await expect.poll(() => youtube.servite.length, { timeout: 20_000 }).toBe(2);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif-msg', { hasText: 'Oggi il blocco delle pubblicità su YouTube non funziona' })).toBeVisible({ timeout: 10_000 });
  await page.waitForFunction(() => Array.isArray(window.__esiti) && window.__esiti.length > 0, null, { timeout: 10_000 });
  expect(await esiti(page)).toEqual(['pagina:pubblicita']);
  await expect.poll(() => page.evaluate(() => window.__saltata), { timeout: 10_000 }).toBe(true);
});

fixture('l\'interruttore in Sicurezza è acceso di serie, accanto a «Salta», e spegne il blocco', async ({ app, openTab }) => {
  const page = await openTab('filo://security/security.html');
  const casella = page.locator('#sec-ytads');
  await expect(casella).toBeChecked({ timeout: 10_000 });
  await expect(page.locator('#sec-ytads-label')).toHaveText('Blocca le pubblicità di YouTube');
  const ordine = await page.evaluate(() => [...document.querySelectorAll('.sn-toggle-row input')].map((i) => i.id));
  expect(ordine.indexOf('sec-adskip') - ordine.indexOf('sec-ytads')).toBe(1);
  await page.locator('#sec-ytads-row, label:has(#sec-ytads)').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/youtube-blocco-sicurezza.png' });
  await casella.uncheck();
  await expect.poll(() => stato(app).then((s) => s.enabled), { timeout: 5_000 }).toBe(false);
  await casella.check();
  await expect.poll(() => stato(app).then((s) => s.enabled), { timeout: 5_000 }).toBe(true);
});
