// #2299 — i segni del correttore dicevano al sito quali parole sono nel dizionario personale: lo script scriveva da sé
// una lista di candidati nel suo campo e guardava quali restavano senza segno. Su un sito gli strati stanno in un'ombra
// chiusa, e il testo scritto da script in un campo che l'utente non ha toccato non si controlla nemmeno.

import { test, expect } from './fixtures/electron.mjs';
import { nelMondoDelMenu } from './helpers/menuContestuale.mjs';
import { segniDi, riquadroDelSegno } from './helpers/segniDelCorrettore.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
  <textarea id="sonda" lang="it" style="display:block;width:600px;height:80px;font:20px monospace"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:600px;min-height:60px;font:20px monospace;border:1px solid #999;margin-top:12px"></div>
  <textarea id="ta" lang="it" style="display:block;width:600px;height:80px;font:20px monospace;margin-top:12px"></textarea>
<script>
  // Quello che può vedere lo script del sito: i nodi del documento e le ombre che può aprire.
  window.visto = () => {
    return {
      segni: document.querySelectorAll('.sn-spell-overlay, .sn-spell-valori, .sn-errore, .sn-suggerimento').length,
      ombreAperte: [...document.querySelectorAll('*')].filter((e) => e.shadowRoot).length,
      testoDiFilo: [...document.querySelectorAll('[data-sn-ui]')].map((e) => e.textContent).join(''),
    };
  };
  // La sonda: una parola del dizionario personale e una sbagliata, scritte da script con un input finto.
  window.sonda = () => {
    const ta = document.getElementById('sonda');
    ta.focus();
    ta.value = 'oggi zanzottera e quseta ';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const ce = document.getElementById('ce');
    ce.focus();
    ce.textContent = 'oggi zanzottera e quseta ';
    ce.dispatchEvent(new Event('input', { bubbles: true }));
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
  return page;
}

test('lo script del sito che scrive da sé parole nei suoi campi non vede quali Filo conosce', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => window.sonda());
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.visto())).toEqual({ segni: 0, ombreAperte: 0, testoDiFilo: '' });
  // Nemmeno dentro l'ombra: un testo che l'utente non ha scritto non si controlla.
  expect(await segniDi(page, '.sn-errore, .sn-suggerimento').count()).toBe(0);
});

test('chi scrive vede i suoi segni, e il sito no', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('oggi zanzottera e quseta ');
  const errore = segniDi(page, '.sn-spell-overlay .sn-errore');
  await expect(errore).toHaveText(['quseta'], { timeout: 5000 });
  const b = await riquadroDelSegno(errore);
  const ta = await page.locator('#ta').boundingBox();
  expect(b.x).toBeGreaterThan(ta.x);
  expect(b.y + b.height).toBeLessThan(ta.y + ta.height);
  expect(await page.evaluate(() => window.visto())).toEqual({ segni: 0, ombreAperte: 0, testoDiFilo: '' });
  await page.screenshot({ path: 'tests/.shots/correttore-segni-fuori-dalla-pagina.png', clip: { x: 0, y: 0, width: 660, height: 320 } });

  // Il testo che il sito ci rimette da sé aspetta il prossimo gesto dell'utente; col tasto si controlla, nell'ombra.
  await page.waitForTimeout(1700);
  await page.evaluate(() => {
    const ta = document.getElementById('ta');
    ta.value = 'ancora quseta e zanzottera ';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(600);
  expect(await errore.count()).toBe(0);
  await page.keyboard.press('End');
  await expect(errore).toHaveText(['quseta'], { timeout: 5000 });
  expect((await page.evaluate(() => window.visto())).segni).toBe(0);
});

test('chi arriva col Tab in una casella che il sito ha già riempito ritrova subito i segni', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => { document.getElementById('ta').value = 'la bozza di ieri con quseta '; });
  await page.locator('#ce').click();
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('ta');
  await expect(segniDi(page, '.sn-spell-overlay .sn-errore')).toHaveText(['quseta'], { timeout: 5000 });
});

test('il sito che rifà la pagina senza ricaricarla butta lo strato dei segni, e i segni tornano nella casella nuova', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('oggi quseta ');
  const errore = segniDi(page, '.sn-spell-overlay .sn-errore');
  await expect(errore).toHaveText(['quseta'], { timeout: 5000 });
  await page.evaluate(() => {
    document.body.innerHTML = '<textarea id="nuova" lang="it" style="display:block;width:600px;height:80px;font:20px monospace"></textarea>';
  });
  await expect(errore).toHaveCount(0, { timeout: 3000 });
  await page.locator('#nuova').click();
  await page.keyboard.type('domani quseta ');
  await expect(errore).toHaveText(['quseta'], { timeout: 5000 });
  const b = await riquadroDelSegno(errore);
  const ta = await page.locator('#nuova').boundingBox();
  expect(b.y + b.height).toBeLessThan(ta.y + ta.height);
  expect((await page.evaluate(() => window.visto())).segni).toBe(0);
});

const SONDA_DEI_TEMPI = `<!doctype html><meta charset="utf-8">
<body style="margin:0"><textarea id="t" lang="it" style="position:fixed;inset:0;width:100vw;height:100vh;opacity:0;font:20px monospace"></textarea>
<script>
  // Quanti giri fa un ciclo di messaggi dopo la scrittura: meno giri, più lavoro di Filo nella pagina.
  const giri = (ms) => new Promise((ok) => {
    const c = new MessageChannel();
    let n = 0;
    const fine = performance.now() + ms;
    c.port1.onmessage = () => { n++; if (performance.now() < fine) c.port2.postMessage(0); else ok(n); };
    c.port2.postMessage(0);
  });
  async function prova(parola) {
    const t = document.getElementById('t');
    t.value = (parola + ' ').repeat(1500);
    const t0 = performance.now();
    t.dispatchEvent(new Event('input', { bubbles: true }));
    const sincrono = performance.now() - t0;
    const liberi = await giri(450);
    t.value = '';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    await giri(150);
    return { sincrono, liberi };
  }
  window.sonda = async () => {
    const a = [], b = [];
    for (let i = 0; i < 7; i++) { a.push(await prova('zanzottera')); b.push(await prova('quseta')); }
    const med = (x, k) => x.map((v) => v[k]).sort((p, q) => p - q)[3];
    return { nota: { sincrono: med(a, 'sincrono'), liberi: med(a, 'liberi') }, ignota: { sincrono: med(b, 'sincrono'), liberi: med(b, 'liberi') } };
  };
</script></body>`;

// Dopo un clic vero, anche su una casella invisibile grande quanto la pagina, lo script scriveva da sé una parola
// ripetuta e misurava quanto lavorava la pagina: una parola segnata costava molto più di una del dizionario.
test('dopo un clic nella pagina, lo script del sito non distingue dai tempi le parole del dizionario', async ({ app, openTab, testServer }) => {
  await apri(app, openTab, testServer);
  const page = await testServer.openReady(openTab, SONDA_DEI_TEMPI, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  await page.mouse.click(300, 300);
  await page.waitForTimeout(500);
  const esito = await page.evaluate(() => window.sonda());
  expect(esito.ignota.sincrono).toBeLessThan(esito.nota.sincrono * 1.5 + 3);
  expect(esito.ignota.liberi).toBeGreaterThan(esito.nota.liberi * 0.85);
});

test('chi rientra col clic in una casella già scritta, che aveva il fuoco da script, ritrova i segni', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => {
    const ta = document.getElementById('ta');
    ta.value = 'la bozza di ieri con quseta ';
    ta.focus();
  });
  await page.waitForTimeout(600);
  const errore = segniDi(page, '.sn-spell-overlay .sn-errore');
  expect(await errore.count()).toBe(0);
  await page.locator('#ta').click();
  await expect(errore).toHaveText(['quseta'], { timeout: 5000 });
});
