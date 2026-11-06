// #1974 giro 2: il ripiego quando le regole non reggono, sul lettore finto sotto l'indirizzo di YouTube (regole scritte
// qui, senza rete). r1 due video incorporati nello stesso articolo; r2 il video dopo, dentro YouTube, con le regole
// nuove arrivate; r3 un video aperto a pochi secondi dalla fine non è un blocco rotto.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:https';
import { certificato } from '../../helpers/immagineFirmata.mjs';

const YT = 'www.youtube.com';
const NOCOOKIE = 'www.youtube-nocookie.com';
test.use({
  hostInPiu: [YT, NOCOOKIE],
  argomentiInPiu: ['--ignore-certificate-errors', '--no-proxy-server'],
});
test.setTimeout(90_000);

const RISPOSTA = {
  responseContext: {}, playabilityStatus: { status: 'OK' }, streamingData: {},
  adPlacements: [{ adPlacementRenderer: { config: { kind: 'AD_PLACEMENT_KIND_START' } } }],
  adSlots: [{ adSlotRenderer: {} }], videoDetails: { videoId: 'abc', lengthSeconds: '60' },
};

const REGOLE = [
  'www.youtube.com,youtube-nocookie.com##+js(set, ytInitialPlayerResponse.adPlacements, undefined)',
  'www.youtube.com,youtube-nocookie.com##+js(set, ytInitialPlayerResponse.adSlots, undefined)',
  'www.youtube.com,youtube-nocookie.com##+js(json-prune-fetch-response, adPlacements adSlots, , propsToMatch, /\\/player(\\?|$)/)',
].join('\n');

// Il lettore: con la risposta senza pubblicità, `avviso` fa comparire l'avviso di YouTube sui blocchi; `inizio` apre il
// video a quel secondo, come un indirizzo con «&t=». `__videoDopo` è il passaggio al video dopo come lo fa YouTube: cambia
// l'indirizzo e chiede la risposta del lettore, senza ricaricare la pagina.
const lettore = (modo, inizio) => `<!doctype html><title>Prova - YouTube</title>
<script>var ytInitialPlayerResponse = ${JSON.stringify(RISPOSTA)};</script>
<div id="movie_player"><video id="v" muted playsinline style="width:320px;height:180px"></video></div>
<script>
(function () {
  var conPub = function (j) { return !!(j && ((j.adPlacements && j.adPlacements.length) || (j.adSlots && j.adSlots.length))); };
  window.__esito = { iniziale: conPub(ytInitialPlayerResponse) };
  window.__videoDopo = function (id) {
    history.pushState({}, '', '/watch?v=' + id);
    return fetch('/youtubei/v1/player?prettyPrint=false', { method: 'POST', body: JSON.stringify({ videoId: id }) })
      .then(function (r) { return r.json(); }).then(conPub);
  };
  function wav(sec) {
    var sr = 8000, n = sr * sec, b = new ArrayBuffer(44 + n), d = new DataView(b);
    var s = function (o, t) { for (var i = 0; i < t.length; i++) d.setUint8(o + i, t.charCodeAt(i)); };
    s(0, 'RIFF'); d.setUint32(4, 36 + n, true); s(8, 'WAVE'); s(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true);
    d.setUint16(22, 1, true); d.setUint32(24, sr, true); d.setUint32(28, sr, true); d.setUint16(32, 1, true); d.setUint16(34, 8, true);
    s(36, 'data'); d.setUint32(40, n, true); new Uint8Array(b, 44).fill(128);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  var v = document.getElementById('v');
  if (!window.__esito.iniziale && ${JSON.stringify(modo)} === 'avviso') setTimeout(function () { document.body.appendChild(document.createElement('ytd-enforcement-message-view-model')); }, 800);
  v.addEventListener('loadedmetadata', function () { if (${Number(inizio) || 0}) v.currentTime = ${Number(inizio) || 0}; v.play().catch(function () {}); }, { once: true });
  v.src = wav(60);
})();
</script>`;

async function siti(t) {
  const visite = [];
  const { der, privateKey } = certificato({ organizzazione: 'Filo test', nomeComune: YT, usi: [] });
  const cert = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
  const server = createServer({ key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert }, (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/youtubei/v1/player')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(RISPOSTA));
      return;
    }
    visite.push(u.pathname + u.search);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (u.pathname === '/articolo') {
      return res.end(`<title>Articolo</title><p>articolo con due video</p>
<iframe width="400" height="240" src="https://${NOCOOKIE}:${porta}/embed/uno?modo=avviso"></iframe>
<iframe width="400" height="240" src="https://${NOCOOKIE}:${porta}/embed/due?modo=avviso"></iframe>`);
    }
    res.end(lettore(u.searchParams.get('modo') || 'ok', u.searchParams.get('inizio')));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  t.chiudi = () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); });
  return {
    url: (p) => `https://${YT}:${porta}${p}`,
    articolo: `https://sito-pubblico.test:${porta}/articolo`,
    quante: (inizioPercorso) => visite.filter((x) => x.startsWith(inizioPercorso)).length,
  };
}

const liste = (app, testo) => app.evaluate((_e, x) => globalThis.__filoBloccoYouTube.impostaListePerTest(x), testo);
const stato = (app) => app.evaluate(() => globalThis.__filoBloccoYouTube.status());
const RIPIEGO = 'Oggi il blocco delle pubblicità su YouTube non funziona';
async function avvisoVisto(app) {
  for (const w of app.windows()) {
    try { if ((await w.evaluate(() => (document.body ? document.body.innerText : ''))).includes(RIPIEGO)) return true; } catch (_) {}
  }
  return false;
}
// Il riquadro di un altro sito vive in un suo processo: lo si legge dal main, che i frame li vede tutti.
const nelRiquadro = (app, pezzo) => app.evaluate(async ({ webContents }, p) => {
  for (const wc of webContents.getAllWebContents()) {
    const f = wc.mainFrame.framesInSubtree.find((x) => x.url.includes(p));
    if (f) return f.executeJavaScript('window.__esito || null').catch(() => null);
  }
  return null;
}, pezzo);

test('r1 due video incorporati nello stesso articolo, regole che non reggono: si ricaricano tutti e due col solo «Salta»', async ({ app, openTab }, t) => {
  const s = await siti(t);
  try {
    await liste(app, REGOLE);
    await openTab(s.articolo);
    await expect.poll(() => avvisoVisto(app), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => s.quante('/embed/uno'), { timeout: 10_000 }).toBe(2);
    await expect.poll(() => nelRiquadro(app, '/embed/uno'), { timeout: 10_000 }).toEqual({ iniziale: true });
    // Il secondo video aveva le stesse regole rotte: deve ripartire anche lui, una volta, col solo «Salta».
    await expect.poll(() => s.quante('/embed/due'), { timeout: 10_000, message: 'il secondo riquadro resta col blocco rotto' }).toBe(2);
    await expect.poll(() => nelRiquadro(app, '/embed/due'), { timeout: 10_000 }).toEqual({ iniziale: true });
  } finally { await t.chiudi(); }
});

test('r2 dopo un ripiego, con le regole nuove arrivate, il video dopo aperto dentro YouTube parte senza pubblicità', async ({ app, openTab }, t) => {
  const s = await siti(t);
  try {
    await liste(app, REGOLE);
    const page = await openTab(s.url('/watch?v=primo&modo=avviso'));
    await expect.poll(() => avvisoVisto(app), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => s.quante('/watch?v=primo'), { timeout: 10_000 }).toBe(2);
    await expect.poll(() => page.evaluate(() => window.__esito && window.__esito.iniziale), { timeout: 10_000 }).toBe(true);
    // Escono le regole nuove: la scheda torna al blocco.
    await liste(app, `${REGOLE}\nwww.youtube.com##+js(set, playerResponse.adPlacements, undefined)`);
    expect((await stato(app)).spente).toBe(0);
    // L'utente clicca il video dopo: YouTube non ricarica la pagina, chiede solo la risposta del lettore.
    expect(await page.evaluate(() => window.__videoDopo('dopo')), 'il video dopo arriva ancora con la pubblicità').toBe(false);
  } finally { await t.chiudi(); }
});

test('r3 un video aperto a pochi secondi dalla fine, con il blocco che regge, non manda la scheda al solo «Salta»', async ({ app, openTab }, t) => {
  const s = await siti(t);
  try {
    await liste(app, REGOLE);
    const page = await openTab(s.url('/watch?v=finale&modo=ok&inizio=57'));
    await expect.poll(() => page.evaluate(() => window.__esito && window.__esito.iniziale), { timeout: 10_000 }).toBe(false);
    await expect.poll(() => page.evaluate(() => document.getElementById('v').currentTime), { timeout: 10_000 }).toBeGreaterThan(59);
    await page.waitForTimeout(3000);
    expect(await avvisoVisto(app), 'avviso di blocco rotto su un video che andava').toBe(false);
    expect(s.quante('/watch?v=finale'), 'la scheda si è ricaricata').toBe(1);
    expect((await stato(app)).spente).toBe(0);
  } finally { await t.chiudi(); }
});
