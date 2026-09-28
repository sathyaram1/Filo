// Verifica #586 giro 14: esplorazione (si cancella o si rinomina prima della registrazione).
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const riga = (shell) => shell.locator('#perm-bar .perm-row');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGINA = `<!doctype html><html><head><title>Esplora</title></head><body>
<textarea id="campo"></textarea>
<script>
  const desktop = { mandatory: { chromeMediaSource: 'desktop' } };
  const tracce = (s) => s.getTracks().map((t) => t.kind + ':' + t.label + ':' + t.readyState);
  function pulito() {
    const f = document.createElement('iframe');
    document.body.appendChild(f);
    const w = window[0];
    return w;
  }
  window.indiceSchermoEAudio = () => {
    const w = pulito();
    const gum = w.MediaDevices.prototype.getUserMedia;
    return gum.call(navigator.mediaDevices, { audio: desktop, video: desktop })
      .then((s) => { window.__s = s; return tracce(s); }, (e) => 'err:' + e.name + ':' + e.message);
  };
  window.indiceDiretto = () => {
    const w = pulito();
    return w.navigator.mediaDevices.getUserMedia({ audio: desktop, video: desktop })
      .then((s) => { window.__s = s; return tracce(s); }, (e) => 'err:' + e.name + ':' + e.message);
  };
  window.indiceSoloAudio = () => {
    const w = pulito();
    const gum = w.MediaDevices.prototype.getUserMedia;
    return gum.call(navigator.mediaDevices, { audio: desktop, video: false })
      .then((s) => tracce(s), (e) => 'err:' + e.name);
  };
  window.indiceSchermoEMic = () => {
    const w = pulito();
    const gum = w.MediaDevices.prototype.getUserMedia;
    return gum.call(navigator.mediaDevices, { audio: true, video: desktop })
      .then((s) => tracce(s), (e) => 'err:' + e.name);
  };
  window.statiIndice = async () => {
    const w = pulito();
    const out = {};
    for (const n of ['camera', 'microphone', 'geolocation', 'notifications']) {
      try { out[n] = (await w.navigator.permissions.query({ name: n })).state; } catch (e) { out[n] = 'err'; }
    }
    out.notPerm = w.Notification.permission;
    const main = {};
    for (const n of ['camera', 'microphone', 'geolocation', 'notifications']) {
      try { main[n] = (await navigator.permissions.query({ name: n })).state; } catch (e) { main[n] = 'err'; }
    }
    main.notPerm = Notification.permission;
    return { indice: out, pagina: main };
  };
  window.sensori = () => { window.addEventListener('deviceorientation', () => {}); try { const a = new Accelerometer(); a.start(); } catch (e) {} return 'ok'; };
  window.persisti = () => navigator.storage.persist().then((r) => 'persist:' + r, (e) => 'err:' + e.name);
</script></body></html>`;

async function lancia(page, fn) {
  await page.evaluate((f) => { window.__e = null; Promise.resolve(window[f]()).then((r) => { window.__e = r; }); }, fn).catch(() => {});
}

test('A: strada vecchia con la copia intonsa presa per indice', async ({ shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await lancia(page, 'indiceSchermoEAudio');
  await sleep(2500);
  const n = await riga(shell).count();
  const testo = n ? await riga(shell).first().innerText() : '';
  console.log('A domande', n, JSON.stringify(testo), 'esito subito', JSON.stringify(await page.evaluate(() => window.__e)));
  if (n) {
    await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled();
    await shell.locator('#perm-bar .perm-si').click();
    await sleep(1500);
    const fonti = await shell.locator('#perm-bar .perm-fonte').count();
    console.log('A fonti', fonti, JSON.stringify(await shell.locator('#perm-bar').innerText()));
    if (fonti) await shell.locator('#perm-bar .perm-fonte').first().click();
    await expect.poll(() => page.evaluate(() => window.__e), { timeout: 10_000 }).not.toBeNull();
    console.log('A esito', JSON.stringify(await page.evaluate(() => window.__e)));
    await sleep(4000);
    console.log('A dopo 4s', JSON.stringify(await page.evaluate(() => (window.__s ? window.__s.getTracks().map((t) => t.kind + ':' + t.label + ':' + t.readyState) : null))));
  }
});

test('B: strada vecchia chiesta dal riquadro senza indirizzo', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await lancia(page, 'indiceDiretto');
  await sleep(2500);
  console.log('B domande', await riga(shell).count(), 'esito', JSON.stringify(await page.evaluate(() => window.__e)));
});

for (const fn of ['indiceSoloAudio', 'indiceSchermoEMic']) {
  test(`C: ${fn} non fa morire la scheda`, async ({ shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, PAGINA);
    let morta = false;
    page.on('crash', () => { morta = true; });
    await page.fill('#campo', 'testo che stavo scrivendo');
    await lancia(page, fn);
    await sleep(3000);
    let campo = null;
    try { campo = await page.evaluate(() => document.getElementById('campo').value); } catch (e) { campo = 'ERR ' + e.message; }
    console.log('C', fn, 'morta', morta, 'campo', JSON.stringify(campo), 'domande', await riga(shell).count(), 'esito', JSON.stringify(await page.evaluate(() => window.__e).catch(() => 'x')));
  });
}

test('D: stati letti nel riquadro preso per indice', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  console.log('D', JSON.stringify(await page.evaluate(() => window.statiIndice())));
});

test('E: sensori e spazio persistente', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => window.sensori());
  await sleep(2500);
  console.log('E sensori', await riga(shell).count(), JSON.stringify(await shell.locator('#perm-bar').innerText().catch(() => '')));
  await lancia(page, 'persisti');
  await sleep(2500);
  console.log('E persist', await riga(shell).count(), JSON.stringify(await shell.locator('#perm-bar').innerText().catch(() => '')), JSON.stringify(await page.evaluate(() => window.__e)));
});
