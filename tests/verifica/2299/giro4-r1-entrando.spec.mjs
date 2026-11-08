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

// Correzione da sé (accesa di serie): allo spazio dell'utente il sito porta il cursore dietro una parola che ci aveva messo
// prima del clic, o ricompone una parola cancellando lettere da quello che l'utente ha scritto.
const PAGINA_SPAZIO = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:40px;font:16px sans-serif">
  <textarea id="ta" lang="it" style="width:600px;height:200px;font:16px sans-serif"></textarea>
<script>
  const ta = document.getElementById('ta');
  window.modo = '';
  window.letto = [];
  let preparato = false;
  window.addEventListener('pointerdown', (e) => {
    if (!e.isTrusted || preparato || window.modo !== 'clic') return;
    preparato = true;
    ta.value = 'zanzottera bianchi\\n';
  }, true);
  let fatto = false;
  window.addEventListener('keydown', (e) => {
    if (!e.isTrusted || e.key !== ' ' || fatto) return;
    if (window.modo === 'clic' && ta.value.startsWith('zanzottera')) {
      fatto = true;
      ta.setSelectionRange(10, 10);
      setTimeout(() => window.letto.push(ta.value.slice(0, 10)), 50);
    }
    if (window.modo === 'cancella' && ta.value === 'le zanzare di otto terra') {
      fatto = true;
      const v = ta.value;
      const voluto = 'le zanzottera';
      const tieni = new Set();
      let j = 0;
      for (let i = 0; i < v.length && j < voluto.length; i++) if (v[i] === voluto[j]) { tieni.add(i); j++; }
      for (let i = v.length - 1; i >= 0; i--) {
        if (tieni.has(i)) continue;
        ta.setSelectionRange(i, i + 1);
        document.execCommand('delete');
      }
      ta.setSelectionRange(ta.value.length, ta.value.length);
      setTimeout(() => window.letto.push(ta.value), 50);
    }
  }, true);
</script>
</body>`;

async function apriSpazio(app, openTab, testServer) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false },
    });
    await globalThis.chrome.storage.local.set({ sn_personal_dict: ['Zanzottera'] });
  });
  const page = await testServer.openReady(openTab, PAGINA_SPAZIO, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}

test("r1 allo spazio dell'utente Filo non rimette con la maiuscola una parola che il sito aveva messo nella casella prima del clic", async ({ app, openTab, testServer }) => {
  const page = await apriSpazio(app, openTab, testServer);
  await page.evaluate(() => { window.modo = 'clic'; });
  await page.click('#ta');
  await page.waitForTimeout(300);
  await page.keyboard.press('End');
  await page.keyboard.type('ciao ', { delay: 80 });
  await page.waitForTimeout(400);
  const letto = await page.evaluate(() => window.letto);
  console.log('spazio dopo il clic', JSON.stringify(letto));
  expect(letto).toHaveLength(1);
  expect(letto[0]).toBe('zanzottera');
});

test("r1 allo spazio dell'utente Filo non rimette con la maiuscola una parola che il sito ha ricomposto cancellando lettere dell'utente", async ({ app, openTab, testServer }) => {
  const page = await apriSpazio(app, openTab, testServer);
  await page.evaluate(() => { window.modo = 'cancella'; });
  await page.click('#ta');
  await page.keyboard.type('le zanzare di otto terra ', { delay: 80 });
  await page.waitForTimeout(400);
  const letto = await page.evaluate(() => window.letto);
  console.log('spazio dopo le cancellature', JSON.stringify(letto));
  expect(letto).toHaveLength(1);
  expect(letto[0]).toBe('le zanzottera');
  await expect(page.locator('#ta')).not.toHaveValue(/Zanzottera/);
});
