// Esplorazione del giro 8 di verifica #1447: interruttore a pagina aperta, rifiuti fra schede, soglia da Avanzate.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu, menuDi } from '../../helpers/menuContestuale.mjs';

const PAGINA = (n) => `<!doctype html><meta charset="utf-8"><title>p${n}</title>
<body style="margin:0;padding:20px;font:16px sans-serif">
  <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea>
</body>`;

async function prepara(app, correttore = {}) {
  await app.evaluate(async (_e, correttore) => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: true, ...correttore },
    });
  }, correttore);
}
async function apri(app, openTab, testServer, n = 1) {
  const page = await testServer.openReady(openTab, PAGINA(n), { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}
async function scrivi(page, t) {
  await page.locator('#ta').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);
  await page.keyboard.type(t);
  await page.waitForTimeout(300);
  return page.locator('#ta').inputValue();
}

test('esplora: interruttore spento a pagina aperta', async ({ app, openTab, testServer }) => {
  await prepara(app);
  const page = await apri(app, openTab, testServer);
  console.log('acceso:', await scrivi(page, 'ok perchè '));
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ correttore: { automatica: false } }); });
  await page.waitForTimeout(1500);
  console.log('spento a pagina aperta:', await scrivi(page, 'ok perchè '));
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ correttore: { automatica: true } }); });
  await page.waitForTimeout(1500);
  console.log('riacceso:', await scrivi(page, 'ok perchè '));
});

test('esplora: due annulli in una scheda, l\'altra scheda già aperta', async ({ app, openTab, testServer }) => {
  await prepara(app);
  const b = await apri(app, openTab, testServer, 2);
  console.log('B prima:', await scrivi(b, 'vedo marco '));
  const a = await apri(app, openTab, testServer, 1);
  for (let i = 0; i < 2; i++) {
    const v = await scrivi(a, 'vedo marco ');
    await a.keyboard.press('Control+z');
    console.log(`A giro ${i}:`, v, '->', await a.locator('#ta').inputValue());
  }
  console.log('A dopo:', await scrivi(a, 'vedo marco '));
  console.log('memoria:', JSON.stringify(await app.evaluate(async () => (await globalThis.chrome.storage.local.get('sn_correttore_imparato')).sn_correttore_imparato)));
  await b.bringToFront();
  console.log('B dopo, già aperta:', await scrivi(b, 'vedo marco '));
});

test('esplora: annulla dal tasto destro nella textarea e soglia 1 da Avanzate', async ({ app, openTab, testServer }) => {
  await prepara(app, { annulliPerImparare: 1 });
  const page = await apri(app, openTab, testServer);
  console.log('scritto:', await scrivi(page, 'non so perchè ok '));
  const box = await page.locator('#ta').boundingBox();
  const p = await page.evaluate(() => {
    const ta = document.getElementById('ta');
    return { char: getComputedStyle(ta).fontSize };
  });
  // «perché» comincia al carattere 7, carattere monospace di 22px circa 13.2px.
  await page.mouse.click(box.x + 2 + 7 * 13.2 + 20, box.y + 14, { button: 'right' });
  const voci = await menuDi(page).root.locator('[role="menuitem"], button').allInnerTexts().catch(() => []);
  console.log('voci menu:', JSON.stringify(voci.slice(0, 20)));
  const voce = menuDi(page).voce('Annulla correzione');
  if (await voce.count()) {
    await voce.click();
    await page.waitForTimeout(300);
    console.log('dopo Annulla correzione:', await page.locator('#ta').inputValue());
  } else console.log('nessuna voce Annulla correzione');
  console.log('di nuovo (soglia 1):', await scrivi(page, 'non so perchè ok '));
});

test('esplora: incollato e poi spazio', async ({ app, openTab, testServer }) => {
  await prepara(app);
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.evaluate(() => navigator.clipboard.writeText('non so perchè')).catch(() => {});
  await app.evaluate(({ clipboard }) => clipboard.writeText('non so perchè'));
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(300);
  console.log('incollato:', await page.locator('#ta').inputValue());
  await page.keyboard.type(' ');
  await page.waitForTimeout(300);
  console.log('incollato + spazio:', await page.locator('#ta').inputValue());
});
