// #2299, verifica giro 4, rilievo 1: il clic che porta l'utente nella casella fa suo tutto il testo che c'è, compreso
// quello che il sito ci ha messo un istante prima; da lì il sito, cancellando e annullando, misura il controllo quando vuole.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:40px;font:16px sans-serif">
  <textarea id="ta" lang="it" style="width:600px;height:200px;font:16px sans-serif"></textarea>
<script>
  const ta = document.getElementById('ta');
  const cmd = (c, v) => document.execCommand(c, false, v);
  // Copie diverse per chi conta le parole una volta, uguali per chi le cerca nel dizionario: «12_zanzottera».
  const blocco = (p) => Array.from({ length: 1500 }, (_, i) => i + '_' + p).join(' ');
  const Z = blocco('zanzottera');
  const Q = blocco('quseta');
  window.durate = [];
  let preparato = false;
  // Un istante prima che il clic dell'utente porti il fuoco nella casella, il sito ci mette le sue sonde.
  window.addEventListener('pointerdown', (e) => {
    if (!e.isTrusted || preparato) return;
    preparato = true;
    ta.value = Z + '\\n' + Q;
  }, true);
  window.sonda = () => {
    ta.focus();
    if (!ta.value.startsWith('0_zanzottera')) return;
    // Cancellare un blocco lascia l'altro, che resta di chi lo possedeva; l'annulla lo riporta.
    ta.setSelectionRange(Z.length, ta.value.length);
    let t0 = performance.now(); cmd('delete'); const z = performance.now() - t0;
    cmd('undo');
    ta.setSelectionRange(0, Z.length + 1);
    t0 = performance.now(); cmd('delete'); const q = performance.now() - t0;
    cmd('undo');
    window.durate.push({ z, q });
  };
  window.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    setTimeout(() => {
      for (let i = 0; i < 7; i++) window.sonda();
      ta.value = '';
    }, 300);
  });
  window.mediane = () => {
    const med = (k) => window.durate.map((d) => d[k]).sort((a, b) => a - b)[Math.floor(window.durate.length / 2)];
    return { conosciuta: med('z'), ignota: med('q'), prove: window.durate.length };
  };
</script>
</body>`;

test("r1 un solo clic dell'utente nella casella non lascia al sito misurare quali parole stanno nel dizionario", async ({ app, openTab, testServer }) => {
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
  await page.waitForTimeout(1500);
  const esito = await page.evaluate(() => window.mediane());
  console.log('entrando', JSON.stringify(esito));
  expect(esito.prove).toBe(7);
  await expect(page.locator('#ta')).toHaveValue('');
  // Il successo per l'utente: le due parole costano uguale, e il sito non sa quale delle due Filo conosce.
  expect(esito.ignota).toBeLessThan(esito.conosciuta * 1.5 + 3);
});
