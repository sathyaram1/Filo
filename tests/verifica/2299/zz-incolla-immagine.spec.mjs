// Esplorazione: un'immagine incollata in una casella modificabile del sito, senza testo negli appunti.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:40px;font:16px sans-serif">
  <div id="ce" contenteditable="true" lang="it" style="width:600px;min-height:120px;font:16px sans-serif;border:1px solid #999"></div>
<script>
  window.durate = [];
  window.sonde = ['zanzottera', 'quseta', 'zanzottera', 'quseta', 'zanzottera', 'quseta', 'zanzottera', 'quseta', 'zanzottera', 'quseta'];
  window.tipi = [];
  let t0 = 0, sonda = null;
  window.addEventListener('input', (e) => {
    window.tipi.push(e.inputType + ':' + JSON.stringify(e.dataTransfer ? e.dataTransfer.getData('text/plain') : e.data));
    if (!e.isTrusted || e.inputType !== 'insertFromPaste' || !window.sonde.length) return;
    sonda = window.sonde.shift();
    e.target.textContent = (sonda + ' ').repeat(1500);
    t0 = performance.now();
  }, true);
  window.addEventListener('input', (e) => {
    if (!sonda) return;
    window.durate.push({ sonda, ms: performance.now() - t0 });
    e.target.textContent = 'ciao ';
    sonda = null;
  });
</script>
</body>`;

test('incolla immagine', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: false },
    });
    await globalThis.chrome.storage.local.set({ sn_personal_dict: ['Zanzottera'] });
  });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  await app.evaluate(({ clipboard, nativeImage }) => {
    clipboard.writeImage(nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=='));
  });
  await page.click('#ce');
  await page.keyboard.type('ciao ', { delay: 60 });
  for (let i = 0; i < 10; i++) { await page.keyboard.press('Control+v'); await page.waitForTimeout(200); }
  const r = await page.evaluate(() => ({ durate: window.durate, tipi: window.tipi.slice(-4) }));
  console.log('IMMAGINE', JSON.stringify(r));
});
