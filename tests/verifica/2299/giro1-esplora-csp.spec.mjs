// Esplorazione: i segni nell'ombra hanno il loro aspetto anche su un sito con regole di stile severe.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';
import { segniDi } from '../../helpers/segniDelCorrettore.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'none'; script-src 'unsafe-inline'">
<body style="margin:0;padding:20px">
  <textarea id="ta" lang="it" style="display:block;width:600px;height:80px;font:20px monospace"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:600px;min-height:60px;font:20px monospace;border:1px solid #999;margin-top:12px"></div>
</body>`;

test('csp', async ({ app, openTab, testServer }) => {
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
  await page.locator('#ta').click();
  await page.keyboard.type('oggi zanzottera e quseta ');
  const errore = segniDi(page, '.sn-spell-overlay .sn-errore');
  await expect(errore).toHaveText(['quseta'], { timeout: 5000 });
  const stile = await errore.evaluate((e) => { const c = getComputedStyle(e); return [c.textDecorationLine, c.textDecorationStyle, c.textDecorationColor]; });
  await page.locator('#ce').click();
  await page.keyboard.type('oggi zanzottera e quseta ');
  await expect(segniDi(page, '.sn-spell-overlay .sn-errore')).toHaveCount(1, { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/verifica-2299-csp.png', clip: { x: 0, y: 0, width: 660, height: 240 } });
  console.log('ESITO', JSON.stringify(stile));
});
