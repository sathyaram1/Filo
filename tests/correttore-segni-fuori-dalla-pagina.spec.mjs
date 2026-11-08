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

  // Dopo i tasti dell'utente la casella è sua: il testo che il sito ci rimette si controlla, ma resta nell'ombra.
  await page.evaluate(() => {
    const ta = document.getElementById('ta');
    ta.value = 'ancora quseta e zanzottera ';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(errore).toHaveText(['quseta'], { timeout: 5000 });
  expect((await page.evaluate(() => window.visto())).segni).toBe(0);
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
