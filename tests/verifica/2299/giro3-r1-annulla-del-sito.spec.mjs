// #2299, verifica giro 3, rilievo 1: un annulla o un rifai lanciato dallo script del sito, mentre l'ultimo tasto visto
// nella casella ha Ctrl (o Cmd) premuto, vale come testo dell'utente: il sito ci rimette una sua lista e misura il controllo.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:40px;font:16px sans-serif">
  <textarea id="ta" lang="it" style="width:600px;height:200px;font:16px sans-serif"></textarea>
  <div id="altro" style="margin-top:20px;width:300px;height:60px;background:#eee">un link qualunque</div>
<script>
  const ta = document.getElementById('ta');
  const cmd = (c, v) => document.execCommand(c, false, v);
  // Pila dell'annulla preparata prima, mentre l'utente scrive: due sonde e poi di nuovo il suo testo.
  window.prepara = () => {
    const vero = ta.value;
    ta.focus();
    cmd('selectAll'); cmd('insertText', 'zanzottera '.repeat(1500));
    cmd('selectAll'); cmd('insertText', 'quseta '.repeat(1500));
    cmd('selectAll'); cmd('insertText', vero);
  };
  window.durate = [];
  // Due annulla riportano le sonde (misurate), due rifai rimettono il testo dell'utente.
  window.sonda = () => {
    ta.focus();
    let t0 = performance.now(); cmd('undo'); const q = performance.now() - t0; const tq = ta.value.slice(0, 7);
    t0 = performance.now(); cmd('undo'); const z = performance.now() - t0; const tz = ta.value.slice(0, 11);
    cmd('redo'); cmd('redo');
    window.durate.push({ q, z, tq, tz });
  };
  window.allaScorciatoia = false;
  document.addEventListener('keydown', (e) => { if (window.allaScorciatoia && e.ctrlKey && e.key === 'a') window.sonda(); });
  window.mediane = () => {
    const med = (k) => window.durate.map((d) => d[k]).sort((a, b) => a - b)[Math.floor(window.durate.length / 2)];
    return { conosciuta: med('z'), ignota: med('q'), prove: window.durate.length, sonde: window.durate.map((d) => d.tq + '|' + d.tz) };
  };
</script>
</body>`;

async function apri(app, openTab, testServer) {
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
  await page.keyboard.type('ciao come stai ', { delay: 60 });
  await page.evaluate(() => window.prepara());
  await page.waitForTimeout(400);
  return page;
}

test("r1 a ogni Ctrl+A dell'utente nella casella lo script del sito non distingue dai tempi le parole del dizionario", async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => { window.allaScorciatoia = true; });
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Control+a');
    await page.keyboard.press('End');
    await page.waitForTimeout(150);
  }
  const esito = await page.evaluate(() => window.mediane());
  console.log('Ctrl+A', JSON.stringify(esito));
  expect(esito.sonde[0]).toBe('quseta |zanzottera ');
  await expect(page.locator('#ta')).toHaveValue('ciao come stai ');
  // Il successo per l'utente: le due parole costano uguale, e il sito non sa quale delle due Filo conosce.
  expect(esito.ignota).toBeLessThan(esito.conosciuta * 1.5 + 3);
});

test("r1 dopo un Ctrl+clic fuori dalla casella lo script del sito, senza altri gesti, non distingue dai tempi le parole del dizionario", async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  // Ctrl+clic su un link della pagina: il Ctrl si preme nella casella, si rilascia fuori.
  await page.click('#altro', { modifiers: ['Control'] });
  await page.waitForTimeout(400);
  for (let i = 0; i < 7; i++) {
    await page.evaluate(() => window.sonda());
    await page.waitForTimeout(150);
  }
  const esito = await page.evaluate(() => window.mediane());
  console.log('Ctrl+clic', JSON.stringify(esito));
  expect(esito.sonde[0]).toBe('quseta |zanzottera ');
  expect(esito.ignota).toBeLessThan(esito.conosciuta * 1.5 + 3);
});
