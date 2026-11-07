// Verifica #1974.1 giro 1: l'utente trascina la barra del video fino alla fine nei primi secondi, tenendo premuto più di
// un secondo e mezzo. È un suo gesto, non un blocco rotto: la scheda non deve tornare al solo «Salta».
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:https';
import { certificato } from '../../helpers/immagineFirmata.mjs';

const YT = 'www.youtube.com';
test.use({ hostInPiu: [YT], argomentiInPiu: ['--ignore-certificate-errors', '--no-proxy-server'] });
test.setTimeout(90_000);

const RISPOSTA = {
  responseContext: {}, playabilityStatus: { status: 'OK' }, streamingData: {},
  adPlacements: [{ adPlacementRenderer: {} }], adSlots: [{ adSlotRenderer: {} }],
};
const REGOLE = 'www.youtube.com##+js(set, ytInitialPlayerResponse.adPlacements, undefined)\nwww.youtube.com##+js(set, ytInitialPlayerResponse.adSlots, undefined)';

const lettore = `<!doctype html><title>Prova - YouTube</title>
<script>var ytInitialPlayerResponse = ${JSON.stringify(RISPOSTA)};</script>
<div id="movie_player"><video id="v" muted playsinline style="width:480px;height:270px"></video></div>
<script>
(function () {
  window.__conPub = !!(ytInitialPlayerResponse.adPlacements && ytInitialPlayerResponse.adPlacements.length);
  var sr = 8000, sec = 60, n = sr * sec, b = new ArrayBuffer(44 + n), d = new DataView(b);
  var s = function (o, t) { for (var i = 0; i < t.length; i++) d.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); d.setUint32(4, 36 + n, true); s(8, 'WAVE'); s(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true);
  d.setUint16(22, 1, true); d.setUint32(24, sr, true); d.setUint32(28, sr, true); d.setUint16(32, 1, true); d.setUint16(34, 8, true);
  s(36, 'data'); d.setUint32(40, n, true); new Uint8Array(b, 44).fill(128);
  var v = document.getElementById('v');
  v.addEventListener('loadedmetadata', function () { v.play().catch(function () {}); }, { once: true });
  v.src = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
})();
</script>`;

const RIPIEGO = 'Oggi il blocco delle pubblicità su YouTube non funziona';

test('r1 trascinare la barra fino alla fine appena partito il video non spegne il blocco', async ({ app, openTab }) => {
  let visite = 0;
  const { der, privateKey } = certificato({ organizzazione: 'Filo test', nomeComune: YT, usi: [] });
  const cert = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
  const server = createServer({ key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert }, (req, res) => {
    if (req.url.startsWith('/watch')) visite++;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(lettore);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await app.evaluate((_e, x) => globalThis.__filoBloccoYouTube.impostaListePerTest(x), REGOLE);
    const page = await openTab(`https://${YT}:${server.address().port}/watch?v=fine`);
    await expect.poll(() => page.evaluate(() => window.__conPub), { timeout: 10_000, message: 'le regole non sono arrivate' }).toBe(false);
    await expect.poll(() => page.evaluate(() => document.getElementById('v').currentTime), { timeout: 10_000 }).toBeGreaterThan(0.1);
    // Il trascinamento: premuto sulla barra, due secondi per arrivare in fondo, rilasciato; il lettore salta lì al rilascio.
    const box = await page.locator('#v').boundingBox();
    await page.mouse.move(box.x + 20, box.y + box.height - 5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height - 5, { steps: 20 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.evaluate(() => { const v = document.getElementById('v'); v.currentTime = v.duration - 0.3; });
    // Il video finisce; un ripiego ricaricherebbe la scheda, e lì la pagina non si legge più: si conta dal server.
    await page.waitForTimeout(4000);
    let avviso = false;
    for (const w of app.windows()) {
      try { if ((await w.evaluate(() => document.body ? document.body.innerText : '')).includes(RIPIEGO)) avviso = true; } catch (_) {}
    }
    expect(avviso, 'avviso di blocco rotto dopo un trascinamento dell\'utente').toBe(false);
    expect(visite, 'la scheda si è ricaricata col solo «Salta»').toBe(1);
    expect((await app.evaluate(() => globalThis.__filoBloccoYouTube.status())).spente).toBe(0);
  } finally {
    await new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); });
  }
});
