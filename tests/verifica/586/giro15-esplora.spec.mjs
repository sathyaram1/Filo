// Esplorazione del giro 15: il getter che cambia valore fra il controllo nella pagina e la lettura di Chromium,
// e le notifiche chieste da un riquadro di un altro sito.
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const riga = (shell) => shell.locator('#perm-bar .perm-row');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGINA = `<!doctype html><html><head><title>Getter</title></head><body>
<textarea id="campo"></textarea>
<script>
  const tracce = (s) => s.getTracks().map((t) => t.kind + ':' + t.label);
  // Il controllo nella pagina legge {} ; Chromium, un attimo dopo, legge la fonte vecchia.
  function vincolo() { let n = 0; return { get mandatory() { return n++ ? { chromeMediaSource: 'desktop' } : {}; } }; }
  window.chiedi = (c) => navigator.mediaDevices.getUserMedia(c)
    .then((s) => { window.__s = s; return tracce(s); }, (e) => 'err:' + e.name);
  window.schermoEAudio = () => window.chiedi({ audio: vincolo(), video: vincolo() });
  window.soloAudio = () => window.chiedi({ audio: vincolo(), video: false });
  window.schermoEMic = () => window.chiedi({ audio: true, video: vincolo() });
</script></body></html>`;

test('getter: schermo e audio dal riquadro principale', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => { window.__e = null; window.schermoEAudio().then((r) => { window.__e = r; }); });
  await sleep(2500);
  const n = await riga(shell).count();
  const testo = n ? await riga(shell).first().innerText() : '(nessuna domanda)';
  console.log('DOMANDA', testo);
  if (n) {
    await shell.locator('#perm-bar .perm-si').click();
    const scheda = shell.locator('#perm-bar .perm-fonte[data-tipo="scheda"]').first();
    await expect(scheda).toBeVisible({ timeout: 10_000 });
    await scheda.click();
  }
  await expect.poll(() => page.evaluate(() => window.__e), { timeout: 10_000 }).not.toBeNull();
  console.log('ARRIVATO', JSON.stringify(await page.evaluate(() => window.__e)));
});

for (const fn of ['soloAudio', 'schermoEMic']) {
  test(`getter: ${fn} e la scheda`, async ({ openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, PAGINA);
    let morta = false;
    page.on('crash', () => { morta = true; });
    await page.fill('#campo', 'testo');
    await page.evaluate((f) => { window[f]().then((r) => { window.__e = r; }); }, fn).catch(() => {});
    await sleep(2500);
    console.log('MORTA', fn, morta, morta ? '' : JSON.stringify(await page.evaluate(() => window.__e)));
  });
}

test('notifiche da un riquadro di un altro sito', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const dentro = testServer.html(`<!doctype html><title>Pubblicita</title><script>
    window.addEventListener('message', async (e) => {
      if (e.data !== 'chiedi') return;
      const prima = Notification.permission;
      const r = await Notification.requestPermission();
      parent.postMessage({ prima, r, dopo: Notification.permission }, '*');
    });
  </script>`).replace('127.0.0.1', 'localhost');
  const page = await testServer.openReady(openTab, `<!doctype html><title>Giornale</title>
    <iframe id="f" src="${dentro}" width="300" height="100"></iframe>
    <script>
      window.__r = null;
      window.addEventListener('message', (e) => { if (e.data && e.data.r) window.__r = e.data; });
      window.chiediMia = () => Notification.requestPermission().then((r) => { window.__mia = r; });
      window.chiediRiquadro = () => document.getElementById('f').contentWindow.postMessage('chiedi', '*');
    </script>`);
  await sleep(1000);
  await page.evaluate(() => window.chiediRiquadro());
  await sleep(2000);
  const n1 = await riga(shell).count();
  console.log('DOMANDA RIQUADRO', n1 ? await riga(shell).first().innerText() : '(nessuna)');
  if (n1) await shell.locator('#perm-bar .perm-chiudi').first().click().catch(() => {});
  await sleep(500);
  // Il giornale ha le notifiche consentite.
  await page.evaluate(() => { window.chiediMia(); });
  await sleep(1500);
  if (await riga(shell).count()) await shell.locator('#perm-bar .perm-si').click();
  await expect.poll(() => page.evaluate(() => window.__mia), { timeout: 5000 }).toBe('granted');
  await page.evaluate(() => { window.__r = null; window.chiediRiquadro(); });
  await sleep(2000);
  const n2 = await riga(shell).count();
  console.log('DOMANDA RIQUADRO DOPO', n2 ? await riga(shell).first().innerText() : '(nessuna)');
  console.log('RIQUADRO', JSON.stringify(await page.evaluate(() => window.__r)));
});
