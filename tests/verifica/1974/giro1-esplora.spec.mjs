// #1974 giro 1: un lettore finto servito sotto l'indirizzo di YouTube, con la forma della risposta del lettore, e le
// regole vere scaricate dalle liste di uAssets. Le pubblicità non partono; quando le regole non reggono, la scheda torna
// al solo «Salta», si ricarica una volta e lo dice; con le regole nuove riprova.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:https';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';
import { certificato } from '../../helpers/immagineFirmata.mjs';

const YT = 'www.youtube.com';
const NOCOOKIE = 'www.youtube-nocookie.com';
// Chromium apre YouTube solo in https (lista HSTS); le liste vere arrivano dalla rete, col proxy dell'ambiente se c'è.
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
test.use({
  hostInPiu: [YT, NOCOOKIE],
  argomentiInPiu: ['--ignore-certificate-errors',
    ...(proxy ? [`--proxy-server=${proxy}`, `--proxy-bypass-list=${YT};${NOCOOKIE};sito-pubblico.test;127.0.0.1`] : [])],
});
test.setTimeout(150_000);
test.describe.configure({ retries: 0 });

const RISPOSTA = {
  responseContext: { serviceTrackingParams: [] },
  playabilityStatus: { status: 'OK' },
  streamingData: { expiresInSeconds: '21540' },
  playerAds: [{ playerLegacyDesktopWatchAdsRenderer: { playerAdParams: { showContentThumbnail: true } } }],
  adPlacements: [{ adPlacementRenderer: { config: { adPlacementConfig: { kind: 'AD_PLACEMENT_KIND_START' } }, renderer: { linearAdSequenceRenderer: {} }, adSlotLoggingData: { serializedSlotAdServingDataEntry: 'EhRT' } } }],
  adSlots: [{ adSlotRenderer: { adSlotMetadata: { slotId: 'x', slotType: 'SLOT_TYPE_PLAYER_BYTES' } } }],
  videoDetails: { videoId: 'abc123', title: 'Prova', lengthSeconds: '60' },
};

// Il lettore: legge la risposta iniziale e quelle di /youtubei/v1/player (fetch con indirizzo, fetch con Request, XHR).
// Senza pubblicità, il modo dice come YouTube «si accorge» del blocco: avviso, video fermo, salto alla fine.
const lettore = (modo) => `<!doctype html><title>Prova - YouTube</title>
<script>var ytInitialPlayerResponse = ${JSON.stringify(RISPOSTA)};</script>
<div id="movie_player"><video id="v" muted playsinline style="width:320px;height:180px"></video></div>
<script>
(function () {
  var conPub = function (j) { return !!(j && ((j.adPlacements && j.adPlacements.length) || (j.adSlots && j.adSlots.length))); };
  var e = window.__esito = { iniziale: conPub(ytInitialPlayerResponse) || !!(ytInitialPlayerResponse.playerAds), idIniziale: ytInitialPlayerResponse.videoDetails && ytInitialPlayerResponse.videoDetails.videoId };
  var corpo = JSON.stringify({ videoId: 'abc123' });
  var u = '/youtubei/v1/player?prettyPrint=false';
  fetch(u, { method: 'POST', body: corpo }).then(function (r) { return r.json(); })
    .then(function (j) { e.fetch = { pub: conPub(j), id: j.videoDetails && j.videoDetails.videoId }; }, function (x) { e.fetch = { err: String(x) }; });
  fetch(new Request(u, { method: 'POST', body: corpo })).then(function (r) { return r.text(); })
    .then(function (t) { var j = JSON.parse(t); e.fetchReq = { pub: conPub(j), id: j.videoDetails && j.videoDetails.videoId }; }, function (x) { e.fetchReq = { err: String(x) }; });
  var x = new XMLHttpRequest(); x.open('POST', u); x.onload = function () {
    try { var j = JSON.parse(x.responseText); e.xhr = { pub: conPub(j), id: j.videoDetails && j.videoDetails.videoId }; } catch (er) { e.xhr = { err: String(er) }; }
  }; x.send(corpo);
  function wav(sec) {
    var sr = 8000, n = sr * sec, b = new ArrayBuffer(44 + n), d = new DataView(b);
    var s = function (o, t) { for (var i = 0; i < t.length; i++) d.setUint8(o + i, t.charCodeAt(i)); };
    s(0, 'RIFF'); d.setUint32(4, 36 + n, true); s(8, 'WAVE'); s(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true);
    d.setUint16(22, 1, true); d.setUint32(24, sr, true); d.setUint32(28, sr, true); d.setUint16(32, 1, true); d.setUint16(34, 8, true);
    s(36, 'data'); d.setUint32(40, n, true); new Uint8Array(b, 44).fill(128);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  var v = document.getElementById('v');
  var tolta = !e.iniziale;
  var modo = ${JSON.stringify(modo)};
  if (tolta && modo === 'avviso') setTimeout(function () { document.body.appendChild(document.createElement('ytd-enforcement-message-view-model')); }, 800);
  if (tolta && modo === 'fermo') { v.src = '/stallo'; v.play().catch(function () {}); return; }
  v.src = wav(60);
  if (tolta && modo === 'fine') v.addEventListener('playing', function () { setTimeout(function () { v.currentTime = v.duration; }, 300); }, { once: true });
  v.play().catch(function () {});
})();
</script>`;

async function siti(t) {
  const visite = [];
  const { der, privateKey } = certificato({ organizzazione: 'Filo test', nomeComune: YT, usi: [] });
  const cert = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
  const server = createServer({ key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert }, (req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const u = new URL(req.url, 'http://x');
    visite.push(host + u.pathname + u.search);
    if (u.pathname === '/stallo') return; // il video non arriva mai
    if (u.pathname.startsWith('/youtubei/v1/player')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(RISPOSTA));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (u.pathname === '/blog') {
      return res.end(`<title>Blog</title><p>articolo</p>
<iframe id="yt" width="400" height="240" src="https://${YT}:${porta}/embed/abc123?modo=ok"></iframe>
<iframe id="nc" width="400" height="240" src="https://${NOCOOKIE}:${porta}/embed/abc123?modo=ok"></iframe>`);
    }
    res.end(lettore(u.searchParams.get('modo') || 'ok'));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  t.chiudi = () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); });
  return {
    watch: (modo, v = 'abc123') => `https://${YT}:${porta}/watch?v=${v}&modo=${modo}`,
    blog: `https://sito-pubblico.test:${porta}/blog`,
    quante: (modo, v = 'abc123') => visite.filter((x) => x === `${YT}/watch?v=${v}&modo=${modo}`).length,
  };
}

// Le liste vere, scaricate come le scarica Filo ogni giorno.
async function regoleVere(app) {
  const r = await app.evaluate(() => globalThis.__filoBloccoYouTube.aggiorna({ forza: true }));
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const s = await app.evaluate(() => globalThis.__filoBloccoYouTube.status());
  expect(s.regole).toBeGreaterThan(5);
  return s;
}

const esito = (frame) => frame.evaluate(() => window.__esito || null);
const senzaPub = { iniziale: false, idIniziale: 'abc123', fetch: { pub: false, id: 'abc123' }, fetchReq: { pub: false, id: 'abc123' }, xhr: { pub: false, id: 'abc123' } };
const conPub = { iniziale: true, idIniziale: 'abc123', fetch: { pub: true, id: 'abc123' }, fetchReq: { pub: true, id: 'abc123' }, xhr: { pub: true, id: 'abc123' } };

// Il testo di un avviso in una qualunque finestra di Filo.
async function avvisoVisto(app, testo) {
  for (const w of app.windows()) {
    try { if ((await w.evaluate(() => document.body ? document.body.innerText : '')).includes(testo)) return true; } catch (_) {}
  }
  return false;
}
const RIPIEGO = 'Oggi il blocco delle pubblicità su YouTube non funziona';

test('video di YouTube: con le regole vere la risposta del lettore arriva senza pubblicità e il video va', async ({ app, openTab }, t) => {
  const s = await siti(t);
  try {
    await regoleVere(app);
    const page = await openTab(s.watch('ok'));
    await expect.poll(() => esito(page), { timeout: 10_000 }).toEqual(senzaPub);
    await expect.poll(() => page.evaluate(() => document.getElementById('v').currentTime), { timeout: 10_000 }).toBeGreaterThan(1);
    // Un video che va non è un video rotto: niente ripiego, niente ricarica.
    await page.waitForTimeout(10_000);
    expect(s.quante('ok')).toBe(1);
    expect(await avvisoVisto(app, RIPIEGO)).toBe(false);
  } finally { await t.chiudi(); }
});

test('video di YouTube incorporati in un altro sito: senza pubblicità, anche su youtube-nocookie', async ({ app, openTab }, t) => {
  const s = await siti(t);
  try {
    await regoleVere(app);
    const page = await openTab(s.blog);
    const frame = (h) => page.frames().find((f) => { try { return new URL(f.url()).hostname === h; } catch (_) { return false; } });
    await expect.poll(() => Boolean(frame(YT) && frame(NOCOOKIE)), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => esito(frame(YT)), { timeout: 10_000 }).toEqual(senzaPub);
    await expect.poll(() => esito(frame(NOCOOKIE)), { timeout: 10_000 }).toMatchObject({ iniziale: false, idIniziale: 'abc123' });
  } finally { await t.chiudi(); }
});

for (const modo of ['avviso', 'fermo', 'fine']) {
  test(`ripiego (${modo}): la scheda torna al solo «Salta», si ricarica una volta, lo dice; le regole nuove riprovano`, async ({ app, openTab }, t) => {
    const s = await siti(t);
    try {
      await regoleVere(app);
      const page = await openTab(s.watch(modo));
      await expect.poll(() => avvisoVisto(app, RIPIEGO), { timeout: 20_000 }).toBe(true);
      await expect.poll(() => s.quante(modo), { timeout: 10_000 }).toBe(2);
      await expect.poll(() => esito(page), { timeout: 10_000 }).toEqual(conPub);
      // Una volta sola: dopo la ricarica il video resta col solo «Salta».
      await page.waitForTimeout(10_000);
      expect(s.quante(modo)).toBe(2);
      // Le altre schede di YouTube tengono il blocco.
      const altra = await openTab(s.watch('ok', 'altro'));
      await expect.poll(() => altra.evaluate(() => window.__esito && window.__esito.fetch), { timeout: 10_000 }).toEqual({ pub: false, id: 'abc123' });
      // Regole cambiate: la stessa scheda riprova col blocco.
      await app.evaluate(() => globalThis.__filoBloccoYouTube.impostaListePerTest('www.youtube.com##+js(set, ytInitialPlayerResponse.adPlacements, undefined)\nwww.youtube.com##+js(set, ytInitialPlayerResponse.adSlots, undefined)\nwww.youtube.com##+js(set, ytInitialPlayerResponse.playerAds, undefined)'));
      await page.reload();
      await expect.poll(() => page.evaluate(() => window.__esito && window.__esito.iniziale), { timeout: 10_000 }).toBe(false);
    } finally { await t.chiudi(); }
  });
}

test('interruttore: acceso di serie accanto a «Salta»; spento dalla pagina Sicurezza le pubblicità tornano, «Salta» resta', async ({ app, shell, openTab }, t) => {
  const s = await siti(t);
  try {
    await regoleVere(app);
    await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
    let sic = null;
    await expect.poll(() => Boolean(sic = app.windows().find((w) => w.url().startsWith('filo://security'))), { timeout: 15_000 }).toBe(true);
    await sic.waitForLoadState('domcontentloaded');
    await expect(sic.locator('#sec-ytads')).toBeChecked();
    await expect(sic.locator('#sec-adskip')).toBeChecked();
    await expect(sic.locator('#sec-ytads-label')).toHaveText('Blocca le pubblicità di YouTube');
    await sic.screenshot({ path: 'tests/.shots/1974-sicurezza.png' });
    await sic.locator('#sec-ytads').click();
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.youtubeAds.enabled), { timeout: 10_000 }).toBe(false);
    expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.adSkip.enabled)).toBe(true);
    const page = await openTab(s.watch('ok'));
    await expect.poll(() => esito(page), { timeout: 10_000 }).toEqual(conPub);
    // Riacceso, il prossimo video torna pulito.
    await sic.locator('#sec-ytads').click();
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.youtubeAds.enabled), { timeout: 10_000 }).toBe(true);
    await page.reload();
    await expect.poll(() => esito(page), { timeout: 10_000 }).toEqual(senzaPub);
  } finally { await t.chiudi(); }
});

test('interruttore dalla chat: «spegni il blocco delle pubblicità di YouTube»', async ({ app, openTab }, t) => {
  const s = await siti(t);
  try {
    await regoleVere(app);
    await modelloFinto(app, [
      { toolCalls: [{ id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'blocca_pubblicita_youtube', valore: false }) }] },
      { text: 'Fatto.' },
    ]);
    const h = await home(app);
    await chiedi(h, 'spegni il blocco delle pubblicità di YouTube');
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.youtubeAds.enabled), { timeout: 15_000 }).toBe(false);
    const page = await openTab(s.watch('ok'));
    await expect.poll(() => esito(page), { timeout: 10_000 }).toEqual(conPub);
  } finally { await t.chiudi(); }
});
