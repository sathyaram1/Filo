// #2299, verifica giro 1, rilievo 1: dopo un clic vero dentro la casella (anche invisibile, grande quanto la pagina) lo
// script del sito ci scrive da sé una parola ripetuta e misura quanto lavora la pagina: le parole che Filo conosce
// costano molto meno di quelle che segna, e il dizionario personale si legge dai tempi.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:0;font:16px sans-serif">
  <textarea id="ta" lang="it" style="position:fixed;inset:0;width:100vw;height:100vh;opacity:0;font:20px monospace"></textarea>
  <p style="padding:40px">Clicca dove vuoi per continuare</p>
<script>
  // Quanti giri fa un ciclo di messaggi in una finestra di tempo, subito dopo la scrittura: meno giri, più lavoro altrui.
  const giri = (ms) => new Promise((ok) => {
    const c = new MessageChannel();
    let n = 0;
    const fine = performance.now() + ms;
    c.port1.onmessage = () => { n++; if (performance.now() < fine) c.port2.postMessage(0); else ok(n); };
    c.port2.postMessage(0);
  });
  async function prova(parola, quante) {
    const ta = document.getElementById('ta');
    ta.value = (parola + ' ').repeat(quante);
    const t0 = performance.now();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const sincrono = performance.now() - t0;
    const liberi = await giri(450);
    ta.value = '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await giri(150);
    return { sincrono, liberi };
  }
  window.sonda = async (conosciuta, ignota, quante, volte) => {
    const a = [], b = [];
    for (let i = 0; i < volte; i++) { a.push(await prova(conosciuta, quante)); b.push(await prova(ignota, quante)); }
    const med = (x, k) => x.map((v) => v[k]).sort((p, q) => p - q)[Math.floor(x.length / 2)];
    return {
      conosciuta: { sincrono: med(a, 'sincrono'), liberi: med(a, 'liberi') },
      ignota: { sincrono: med(b, 'sincrono'), liberi: med(b, 'liberi') },
    };
  };
</script>
</body>`;

test('r1 dopo un clic nella pagina, lo script del sito non distingue dai tempi le parole del dizionario personale', async ({ app, openTab, testServer }) => {
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

  // L'utente clicca un punto qualunque della pagina: il clic cade sulla casella invisibile.
  await page.mouse.click(300, 300);
  await page.waitForTimeout(500);
  const esito = await page.evaluate(() => window.sonda('zanzottera', 'quseta', 1500, 7));
  console.log('tempi', JSON.stringify(esito));
  // Il successo per l'utente: le due parole costano uguale alla pagina, e la sonda non sa quale delle due Filo conosce.
  expect(esito.ignota.sincrono).toBeLessThan(esito.conosciuta.sincrono * 1.5 + 3);
  expect(esito.ignota.liberi).toBeGreaterThan(esito.conosciuta.liberi * 0.85);
});
