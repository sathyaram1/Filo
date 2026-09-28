// Verifica #586 giro 12, rilievo 2: la strada vecchia per lo schermo (chromeMediaSource «desktop») non segue le regole.
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const riga = (shell) => shell.locator('#perm-bar .perm-row');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGINA = `<!doctype html><html><head><title>Vecchia</title></head><body>
<textarea id="campo"></textarea>
<script>
  const desktop = { mandatory: { chromeMediaSource: 'desktop' } };
  const tracce = (s) => s.getTracks().map((t) => t.kind + ':' + t.label);
  window.schermoEAudio = () => navigator.mediaDevices.getUserMedia({ audio: desktop, video: desktop })
    .then((s) => { window.__s = s; return tracce(s); }, (e) => 'err:' + e.name);
  window.soloAudio = () => navigator.mediaDevices.getUserMedia({ audio: desktop, video: false })
    .then((s) => tracce(s), (e) => 'err:' + e.name);
  window.schermoEMic = () => navigator.mediaDevices.getUserMedia({ audio: true, video: desktop })
    .then((s) => tracce(s), (e) => 'err:' + e.name);
  window.insisti = () => setInterval(() => { navigator.mediaDevices.getUserMedia({ video: desktop }).catch(() => {}); }, 300);
</script></body></html>`;

test('«Condividi lo schermo» sulla strada vecchia non consegna l’audio del computer senza dirlo', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => { window.__e = null; window.schermoEAudio().then((r) => { window.__e = r; }); });
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  const domanda = await riga(shell).innerText();
  await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled();
  await shell.locator('#perm-bar .perm-si').click();
  await expect.poll(() => page.evaluate(() => window.__e), { timeout: 10_000 }).not.toBeNull();
  const tracce = await page.evaluate(() => window.__e);
  const audio = Array.isArray(tracce) && tracce.some((t) => t.startsWith('audio:'));
  if (audio) expect(domanda, `arriva ${JSON.stringify(tracce)} ma la domanda era: ${domanda}`).toMatch(/audio|suon|sent/i);
});

test('«Nega» allo schermo chiude il discorso anche con un sito che chiede senza clic', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => window.insisti());
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  for (let i = 0; i < 2; i++) {
    if (!(await riga(shell).count())) break;
    await expect(shell.locator('#perm-bar .perm-no')).toBeEnabled();
    await shell.locator('#perm-bar .perm-no').click();
    await sleep(300);
  }
  await sleep(1500);
  await expect(riga(shell), 'dopo due «Nega» la domanda sullo schermo è ancora lì').toHaveCount(0);
});

for (const [fn, cosa] of [['soloAudio', 'l’audio del computer senza immagine'], ['schermoEMic', 'lo schermo insieme al microfono']]) {
  test(`una pagina che chiede ${cosa} alla maniera vecchia non fa morire la scheda`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, PAGINA);
    let morta = false;
    page.on('crash', () => { morta = true; });
    await page.fill('#campo', 'testo che stavo scrivendo');
    await page.evaluate((f) => { window.__e = null; window[f]().then((r) => { window.__e = r; }); }, fn).catch(() => {});
    await sleep(2500);
    expect(morta, 'la scheda è morta ed è comparsa la pagina di errore').toBe(false);
    expect(await page.evaluate(() => document.getElementById('campo').value)).toBe('testo che stavo scrivendo');
  });
}
