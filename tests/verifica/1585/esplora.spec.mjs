// Esplorazione della verifica #1585, giro 2: si cancella se non riproduce un rilievo.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { riquadroDelSegno } from '../../helpers/segniDelCorrettore.mjs';

async function prepara(app) {
  await app.evaluate(async ({ session }) => {
    session.defaultSession.setSpellCheckerLanguages([]);
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false },
    });
  });
  await expect.poll(() => app.evaluate(() => globalThis.__filoDizionarioDiFilo.stato().fase), { timeout: 20_000 }).toBe('pronto');
}

test('paragrafo italiano in un textarea', async ({ app, openTab, testServer }) => {
  await prepara(app);
  const url = testServer.html(`<!doctype html><meta charset="utf-8"><body style="margin:0">
    <textarea id="ta" style="display:block;width:1000px;height:300px;font:18px monospace"></textarea>
  </body>`);
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#ta').click();
  await page.keyboard.type("Ieri sono andatto a Roma perché c'era il sole. Andatto via presto, l'acqua era fredda, un po' di più, d'accordo. È stata una bella giornata, qual è il problema? Quseta volta no. ");
  const segni = page.locator('.sn-spell-overlay .sn-errore');
  await expect(segni.filter({ hasText: 'Quseta' })).toHaveCount(1, { timeout: 5000 });
  await page.waitForTimeout(800);
  console.log('SEGNI textarea', JSON.stringify(await segni.allTextContents()));
  const b = await riquadroDelSegno(segni.filter({ hasText: /^andatto$/ }).first());
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  await expect(menuDi(page).pannelli.first()).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(500);
  console.log('MENU', JSON.stringify(await menuDi(page).locator('.sn-menu-correction:visible').allTextContents()));
  await page.screenshot({ path: 'tests/.shots/verifica-1585-menu.png' });
});

test('contenteditable con apostrofi tipografici incollati', async ({ app, openTab, testServer }) => {
  await prepara(app);
  const url = testServer.html(`<!doctype html><meta charset="utf-8"><body style="margin:0">
    <div id="ce" contenteditable="true" style="width:1000px;min-height:200px;font:18px serif"></div>
  </body>`);
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#ce').click();
  await page.keyboard.insertText('L’anno scorso un po’ di gente è andata all’estero; dell’arte non s’è parlato, perche nessuno sapeva. ');
  await page.keyboard.type('Scrivo ancora andatto ');
  const segni = page.locator('.sn-spell-overlay .sn-errore');
  await expect(segni.filter({ hasText: 'andatto' })).toHaveCount(1, { timeout: 5000 });
  await page.waitForTimeout(800);
  console.log('SEGNI ce', JSON.stringify(await segni.allTextContents()));
});
