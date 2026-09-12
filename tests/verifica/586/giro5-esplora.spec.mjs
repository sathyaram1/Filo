// Esplorazione giro 5 — NON è una prova che vale: serve a guardare.
import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<p>prova</p>
<script>
  const ok = (s) => ({ ok: true, tracce: s.getTracks().map((t) => t.kind + ':' + t.label) });
  const no = (e) => ({ ok: false, errore: (e && e.name) + ' ' + (e && e.message) });
  // strada vecchia: video desktop + audio NORMALE (microfono)
  window.__misto = () => navigator.mediaDevices.getUserMedia({
    video: { mandatory: { chromeMediaSource: 'desktop' } },
    audio: true,
  }).then(ok, no);
  // strada vecchia pura
  window.__vecchia = () => navigator.mediaDevices.getUserMedia({
    video: { mandatory: { chromeMediaSource: 'desktop' } },
  }).then(ok, no);
  window.__mic = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(ok, no);
  window.__cam = () => navigator.mediaDevices.getUserMedia({ video: true }).then(ok, no);
  window.__queryFont = () => navigator.permissions.query({ name: 'local-fonts' })
    .then((s) => 'stato=' + s.state, (e) => 'no ' + e.name);
  window.__queryCam = () => navigator.permissions.query({ name: 'camera' })
    .then((s) => 'stato=' + s.state, (e) => 'no ' + e.name);
  // dentro un riquadro about:blank, che il preload non tocca
  window.__vecchiaInFrame = () => new Promise((r) => {
    const f = document.createElement('iframe');
    f.onload = () => {
      try {
        f.contentWindow.navigator.mediaDevices.getUserMedia({
          video: { mandatory: { chromeMediaSource: 'desktop' } },
        }).then((s) => r(ok(s)), (e) => r(no(e)));
      } catch (e) { r(no(e)); }
    };
    f.src = 'about:blank';
    document.body.appendChild(f);
  });
</script></body></html>`;

async function chips(shell) { return shell.locator('.perm-chip').allTextContents(); }

test('A — strada vecchia mista: video desktop + audio normale', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  const p = page.evaluate(() => window.__misto());
  await shell.waitForTimeout(2500);
  console.log('[g5 A] domanda:', JSON.stringify(await chips(shell)));
  const c = shell.locator('.perm-chip .perm-chip-allow');
  if (await c.count()) await c.first().click();
  await shell.waitForTimeout(1500);
  // eventuale scelta della fonte
  const fonti = shell.locator('.perm-source .perm-source-item');
  console.log('[g5 A] fonti offerte:', await fonti.count());
  if (await fonti.count()) await fonti.first().click();
  const esito = await Promise.race([p, new Promise((r) => setTimeout(() => r('(attesa)'), 12000))]);
  console.log('[g5 A] esito:', JSON.stringify(esito));
  console.log('[g5 A] cartelli:', JSON.stringify(await shell.locator('.perm-live').allTextContents()));
});

test('B — microfono consentito, poi la strada vecchia mista', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  const m = page.evaluate(() => window.__mic());
  await shell.waitForTimeout(2000);
  console.log('[g5 B] domanda mic:', JSON.stringify(await chips(shell)));
  const c = shell.locator('.perm-chip .perm-chip-allow');
  if (await c.count()) await c.first().click();
  console.log('[g5 B] mic:', JSON.stringify(await Promise.race([m, new Promise((r) => setTimeout(() => r('(attesa)'), 8000))])));
  await shell.waitForTimeout(800);
  // ora la strada vecchia mista: se il permesso ricordato copre la richiesta,
  // non compare nessuna domanda e il sito si prende lo schermo.
  const p = page.evaluate(() => window.__misto());
  await shell.waitForTimeout(3000);
  console.log('[g5 B] domanda dopo:', JSON.stringify(await chips(shell)));
  console.log('[g5 B] fonti:', await shell.locator('.perm-source .perm-source-item').count());
  const esito = await Promise.race([p, new Promise((r) => setTimeout(() => r('(attesa)'), 10000))]);
  console.log('[g5 B] esito strada vecchia:', JSON.stringify(esito));
});

test('C — riquadro about:blank, strada vecchia', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  const p = page.evaluate(() => window.__vecchiaInFrame());
  await shell.waitForTimeout(3000);
  console.log('[g5 C] domanda:', JSON.stringify(await chips(shell)));
  const c = shell.locator('.perm-chip .perm-chip-allow');
  if (await c.count()) await c.first().click();
  await shell.waitForTimeout(1500);
  const fonti = shell.locator('.perm-source .perm-source-item');
  if (await fonti.count()) await fonti.first().click();
  const esito = await Promise.race([p, new Promise((r) => setTimeout(() => r('(attesa)'), 12000))]);
  console.log('[g5 C] esito:', JSON.stringify(esito));
  console.log('[g5 C] viva?', await page.evaluate(() => document.title !== undefined).catch((e) => 'morta ' + e.message));
});

test('D — una query sullo stato fa comparire una domanda?', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  console.log('[g5 D] query camera:', await page.evaluate(() => window.__queryCam()));
  await shell.waitForTimeout(1500);
  console.log('[g5 D] domande dopo query camera:', JSON.stringify(await chips(shell)));
  console.log('[g5 D] query local-fonts:', await page.evaluate(() => window.__queryFont()));
  await shell.waitForTimeout(2500);
  console.log('[g5 D] domande dopo query local-fonts:', JSON.stringify(await chips(shell)));
});
