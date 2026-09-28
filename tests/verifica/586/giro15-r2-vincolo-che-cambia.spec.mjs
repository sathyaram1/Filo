// Verifica #586 giro 15, rilievo 2: dal riquadro principale, senza riquadri, un vincolo che cambia valore fra lo sguardo
// di Filo nella pagina e la lettura di Chromium porta la strada vecchia per lo schermo oltre la chiusura: tutto lo
// schermo e l'audio del computer qualunque cosa si scelga, e la scheda che muore.
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const riga = (shell) => shell.locator('#perm-bar .perm-row');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGINA = `<!doctype html><html><head><title>Vincolo</title></head><body>
<textarea id="campo"></textarea>
<script>
  const tracce = (s) => s.getTracks().map((t) => t.kind + ':' + t.label);
  // La prima lettura vede un vincolo vuoto, le successive la fonte vecchia.
  function vincolo() { let n = 0; return { get mandatory() { return n++ ? { chromeMediaSource: 'desktop' } : {}; } }; }
  window.chiedi = (c) => navigator.mediaDevices.getUserMedia(c)
    .then((s) => { window.__s = s; return tracce(s); }, (e) => 'err:' + e.name);
  window.schermoEAudio = () => window.chiedi({ audio: vincolo(), video: vincolo() });
  window.soloAudio = () => window.chiedi({ audio: vincolo(), video: false });
  window.schermoEMic = () => window.chiedi({ audio: true, video: vincolo() });
</script></body></html>`;

test('dal riquadro principale, chi sceglie «questa scheda» non consegna tutto lo schermo e l’audio del computer', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => { window.__e = null; window.schermoEAudio().then((r) => { window.__e = r; }); });
  await sleep(2500);
  if (await riga(shell).count()) {
    await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled();
    await shell.locator('#perm-bar .perm-si').click();
    const scheda = shell.locator('#perm-bar .perm-fonte[data-tipo="scheda"]').first();
    await expect(scheda).toBeVisible({ timeout: 10_000 });
    await scheda.click();
  }
  await expect.poll(() => page.evaluate(() => window.__e), { timeout: 10_000 }).not.toBeNull();
  const tracce = await page.evaluate(() => window.__e);
  const lista = Array.isArray(tracce) ? tracce : [];
  expect(lista.filter((t) => t.startsWith('audio:')), `al sito è arrivato ${JSON.stringify(tracce)}`).toEqual([]);
  expect(lista.filter((t) => /Screen/.test(t)), `scelta una scheda, al sito è arrivato ${JSON.stringify(tracce)}`).toEqual([]);
});

for (const [fn, cosa] of [['soloAudio', 'l’audio del computer senza immagine'], ['schermoEMic', 'lo schermo insieme al microfono']]) {
  test(`dal riquadro principale, chiedere ${cosa} con un vincolo che cambia non fa morire la scheda`, async ({ openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, PAGINA);
    let morta = false;
    page.on('crash', () => { morta = true; });
    await page.fill('#campo', 'testo che stavo scrivendo');
    await page.evaluate((f) => { window[f]().then((r) => { window.__e = r; }); }, fn).catch(() => {});
    await sleep(2500);
    expect(morta, 'la scheda è morta ed è comparsa la pagina di errore').toBe(false);
    expect(await page.evaluate(() => document.getElementById('campo').value)).toBe('testo che stavo scrivendo');
  });
}
