// Esplorazione del giro 4 di #1290: «Mostra originale» mentre le sezioni chiuse si traducono in sottofondo, e ritraduzione.
import { test, expect } from '../../fixtures/electron.mjs';
import { premiNellaBarra } from '../../helpers/barra.mjs';

async function stub(app, delay) {
  await app.evaluate(async (_e, delay) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__p = [];
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      const APRE = '<<<TESTO_IN_PAGINA>>>\n'; const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE); const f = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && f > i ? prompt.slice(i + APRE.length, f) : '';
      globalThis.__p.push(chunk);
      if (delay && globalThis.__p.length > 1) await new Promise((r) => setTimeout(r, delay));
      return { text: chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'), provider: 't', model: 't', usage: {} };
    };
  }, delay);
}

const righe = (n, pre) => Array.from({ length: n }, (_, k) => `<p class="h">${pre} hidden paragraph number ${k} written in plain English for the test.</p>`).join('');
const PAGINA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An article with many folded sections</h1>
  <p id="p1">The visible paragraph of the article, long enough to be picked up.</p>
  <button id="toggle" onclick="document.getElementById('more').hidden = false">Show more</button>
  <div id="more" hidden><h2 id="mtitle">The headline hidden inside the folded section</h2>${righe(400, 'Folded')}</div>
</body></html>`;

test('esplora: Mostra originale mentre il resto si traduce in sottofondo', async ({ app, openTab, testServer }) => {
  test.setTimeout(180000);
  await stub(app, 4000);
  const page = await testServer.openReady(openTab, PAGINA);
  await premiNellaBarra(app, 'translate');
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  const chiamate = await app.evaluate(() => globalThis.__p.length);
  console.log('chiamate quando il visibile è tradotto', chiamate);
  await premiNellaBarra(app, 'translate');
  await expect(page.locator('#p1')).toHaveText(/^The visible/, { timeout: 10000 });
  await page.waitForTimeout(15000);
  await page.locator('#toggle').click();
  const tradotte = await page.evaluate(() => Array.from(document.querySelectorAll('#more p, #more h2')).filter((e) => /^IT /.test(e.textContent)).length);
  console.log('righe nascoste tradotte dopo Mostra originale', tradotte, 'chiamate totali', await app.evaluate(() => globalThis.__p.length));
  await expect(page.locator('#p1')).toHaveText(/^The visible/);
  expect(tradotte).toBe(0);
});

test('esplora: ritradurre dopo l’originale non raddoppia e copre le sezioni chiuse', async ({ app, openTab, testServer }) => {
  test.setTimeout(180000);
  await stub(app, 0);
  const page = await testServer.openReady(openTab, PAGINA);
  await premiNellaBarra(app, 'translate');
  await expect(page.locator('#mtitle')).toHaveText(/^IT /, { timeout: 60000 });
  await premiNellaBarra(app, 'translate');
  await expect(page.locator('#mtitle')).toHaveText(/^The headline/, { timeout: 10000 });
  await premiNellaBarra(app, 'translate');
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect(page.locator('#mtitle')).toHaveText(/^IT /, { timeout: 60000 });
  await page.locator('#toggle').click();
  const stato = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('#more p'));
    return { tot: all.length, it: all.filter((e) => /^IT /.test(e.textContent)).length, doppie: all.filter((e) => /^IT IT/.test(e.textContent)).length };
  });
  console.log('ritraduzione', JSON.stringify(stato));
  expect(stato.doppie).toBe(0);
  expect(stato.it).toBe(stato.tot);
});
