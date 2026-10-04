// #873 giro 7 — esplorazione: aspetto della riga del sistema in chiaro, scuro, offline, batteria bassa, riquadro, filo.
import { test, expect } from '../../fixtures/electron.mjs';

async function newtab(app) {
  const scadenza = Date.now() + 10_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('la home non si è aperta');
}

const PIENO = {
  batteria: { livello: 12, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa di Anna' },
  bluetooth: { acceso: true, dispositivi: ['Cuffie Sony WH-1000XM5', 'Mouse'] },
};

test('aspetto', async ({ app }) => {
  await app.evaluate(async (_, l) => {
    globalThis.__sistemaFinto = l;
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__sistemaFinto);
  }, PIENO);
  const page = await newtab(app);
  await expect(page.locator('#sistema')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/873g7-chiaro.png' });
  await page.locator('#sistema .dash-sis-voce[data-voce="bluetooth"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/873g7-box.png' });
  await page.keyboard.press('Escape');
  await app.evaluate(() => { globalThis.__sistemaFinto = { ...globalThis.__sistemaFinto, rete: { online: false } }; });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'tests/.shots/873g7-offline.png' });
  await app.evaluate(async () => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } },
    { url: 'filo://preferences/preferences.html' },
  ));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tests/.shots/873g7-scuro.png' });
  await page.locator('#input').click();
  await page.keyboard.type('ciao');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  console.log('stato', await page.evaluate(() => document.body.dataset.state));
  await page.screenshot({ path: 'tests/.shots/873g7-filo.png' });
});
