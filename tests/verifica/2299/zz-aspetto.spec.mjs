// Esplorazione: come appaiono segni e valori sopra le x in una casella di un sito.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:40px;font:16px Georgia, serif;background:#fff">
  <textarea id="ta" lang="it" style="width:600px;height:120px;font:18px Georgia, serif;padding:20px"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="margin-top:20px;width:600px;min-height:80px;font:18px Georgia, serif;border:1px solid #999;padding:20px"></div>
</body>`;

for (const tema of ['light', 'dark']) {
  test('aspetto ' + tema, async ({ app, openTab, testServer }) => {
    await app.evaluate(async (t) => {
      await globalThis.SN_STORAGE.updateSettings({
        theme: t,
        featureFlags: { spellcheck: true, spellcheckContext: false },
        correttore: { modelloErrori: false, automatica: false },
      });
    }, tema);
    const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
    await page.click('#ta');
    await page.keyboard.type('oggi quseta e domani la squadra ha vinto 14xx partite di fila ', { delay: 20 });
    await page.waitForTimeout(2500);
    await page.click('#ce');
    await page.keyboard.type('una frase con un erore e un altro sbaglo ', { delay: 20 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `tests/.shots/2299-giro3-${tema}.png` });
  });
}
