// Esplorazione: dopo un clic vero nella casella, lo script del sito misura quanto dura il controllo del testo che scrive.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:0;font:16px sans-serif">
  <textarea id="ta" lang="it" style="position:fixed;inset:0;width:100vw;height:100vh;opacity:0;font:20px monospace"></textarea>
  <p style="padding:40px">Clicca dove vuoi</p>
<script>
  window.misura = (parola, n) => {
    const ta = document.getElementById('ta');
    ta.value = (parola + ' ').repeat(n);
    const t0 = performance.now();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return performance.now() - t0;
  };
  window.giro = (dict, sbagliata, n, volte) => {
    const a = [], b = [];
    for (let i = 0; i < volte; i++) { a.push(misura(dict, n)); b.push(misura(sbagliata, n)); }
    const med = (x) => x.sort((p, q) => p - q)[Math.floor(x.length / 2)];
    return { dizionario: med(a), sbagliata: med(b), anim: document.getAnimations().length };
  };
</script>
</body>`;

test('tempi', async ({ app, openTab, testServer }) => {
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
  // Senza clic: la base.
  const prima = await page.evaluate(() => window.giro('zanzottera', 'quseta', 400, 15));
  await page.mouse.click(300, 300);
  await page.waitForTimeout(500);
  const dopo = await page.evaluate(() => window.giro('zanzottera', 'quseta', 400, 15));
  const dopo2 = await page.evaluate(() => window.giro('zanzottera', 'quseta', 1500, 9));
  console.log('ESITO', JSON.stringify({ prima, dopo, dopo2 }));
});
