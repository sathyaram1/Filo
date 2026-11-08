// #2299, verifica giro 2, rilievo 1: l'utente scrive in una casella del sito; a ogni suo tasto lo script del sito mette
// al posto del testo una parola ripetuta, misura quanto lavora Filo su quell'input e rimette il testo dell'utente.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:40px;font:16px sans-serif">
  <textarea id="ta" lang="it" style="width:600px;height:200px;font:16px sans-serif"></textarea>
<script>
  window.durate = [];
  window.sonde = [];
  let t0 = 0, vero = '', sonda = null;
  window.addEventListener('input', (e) => {
    if (!e.isTrusted || !window.sonde.length) return;
    sonda = window.sonde.shift();
    vero = e.target.value;
    e.target.value = (sonda + ' ').repeat(1500);
    t0 = performance.now();
  }, true);
  window.addEventListener('input', (e) => {
    if (!e.isTrusted || !sonda) return;
    window.durate.push({ sonda, ms: performance.now() - t0 });
    e.target.value = vero;
    sonda = null;
  });
</script>
</body>`;

test("r1 a ogni tasto dell'utente lo script del sito non distingue dai tempi le parole del dizionario personale",async ({ app, openTab, testServer }) => {
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

  await page.click('#ta');
  await page.keyboard.type('ciao ', { delay: 80 });
  await page.waitForTimeout(400);
  const volte = 9;
  await page.evaluate((n) => {
    for (let i = 0; i < n; i++) window.sonde.push('zanzottera', 'quseta');
  }, volte);
  for (const c of 'come stai oggi tu') {
    await page.keyboard.type(c);
    await page.waitForTimeout(120);
  }
  const durate = await page.evaluate(() => window.durate);
  const testo = await page.inputValue('#ta');
  const med = (p) => { const x = durate.filter((d) => d.sonda === p).map((d) => d.ms).sort((a, b) => a - b); return x[Math.floor(x.length / 2)]; };
  const esito = { conosciuta: med('zanzottera'), ignota: med('quseta'), prove: durate.length, testo };
  console.log('tempi', JSON.stringify(esito));
  expect(esito.testo).toBe('ciao come stai oggi tu');
  // Il successo per l'utente: le due parole costano uguale, e il sito non sa quale delle due Filo conosce.
  expect(esito.ignota).toBeLessThan(esito.conosciuta * 1.5 + 3);
});
