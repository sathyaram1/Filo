// Verifica #841, giro 1: esplorazione avversariale dell'interruttore dell'Aiuto.
import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi } from '../../helpers/riquadri.mjs';
import { mkdirSync } from 'node:fs';

const PAGINA = '<!doctype html><title>Pagina</title><body style="margin:0;padding:24px;font:16px sans-serif"><p id="p">Un paragrafo dove fare tasto destro.</p><iframe id="f" style="width:300px;height:120px" srcdoc="<p id=q>dentro</p>"></iframe></body>';

const chiedi = (app, chiave, valore) => app.evaluate((_e, [c, v]) =>
  globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_PREFERENZA', chiave: c, valore: v }), [chiave, valore]);
const impostazioni = (app) => app.evaluate(() => globalThis.SN_STORAGE.getSettings());

async function apri(openTab, testServer) {
  const page = await openTab(testServer.html(PAGINA));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}
async function voci(page) {
  await page.locator('#p').click({ button: 'right' });
  const menu = page.locator('.sn-menu[role=menu]');
  await expect(menu).toBeVisible();
  const v = await menu.locator('.sn-menu-item .sn-menu-label').allTextContents();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  return v;
}
function premiAltH(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const wc = w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'H', modifiers: ['alt'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'H', modifiers: ['alt'] });
  });
}

test('varianti a parole: chiavi e valori diversi spengono e riaccendono', async ({ app }) => {
  for (const [c, v, atteso] of [['assistente di pagina', 'off', false], ['sidebar aiuto', 'on', true], ['aiuto', 'disattiva', false], ['help', 'true', true], ['aiuto nelle pagine', 'no', false], ['aiuto', 'sì', true]]) {
    const r = await chiedi(app, c, v);
    expect(r.executed, `${c}=${v}`).toBe(true);
    await expect.poll(async () => (await impostazioni(app)).featureFlags.help, { message: `${c}=${v}` }).toBe(atteso);
  }
});

test('pannello aperto, poi spento: che succede; Alt+H su pagina interna', async ({ app, openTab, testServer }) => {
  const page = await apri(openTab, testServer);
  await premiAltH(app);
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8000 });
  await chiedi(app, 'aiuto', 'spento');
  await page.waitForTimeout(1500);
  console.log('PANNELLO APERTO DOPO SPEGNI:', await page.locator('.sn-sidebar').count(), await page.locator('.sn-sidebar').isVisible().catch(() => 'x'));
  // spegni/accendi in fretta
  for (let i = 0; i < 6; i++) await chiedi(app, 'aiuto', i % 2 ? 'spento' : 'acceso');
  await expect.poll(async () => (await impostazioni(app)).featureFlags.help).toBe(false);
  await expect.poll(() => voci(page)).not.toContain('Aiuto');
  // menu nel riquadro
  const fr = page.frameLocator('#f');
  await fr.locator('#q').click({ button: 'right' });
  await page.waitForTimeout(800);
  const nelRiquadro = await page.frames().find((f) => f !== page.mainFrame())?.evaluate(() => [...document.querySelectorAll('.sn-menu-item .sn-menu-label')].map((e) => e.textContent)).catch(() => 'err');
  console.log('VOCI RIQUADRO:', JSON.stringify(nelRiquadro));
  await page.keyboard.press('Escape');

  const interna = await openTab('filo://history/history.html');
  await interna.waitForTimeout(1500);
  await premiAltH(app);
  await interna.waitForTimeout(1200);
  console.log('INTERNA sidebar:', await interna.locator('.sn-sidebar').count(), 'toast:', JSON.stringify(await statoDi(app, interna, '.sn-toast').catch(() => null)));
});

test('aspetto in Preferenze, chiaro e scuro', async ({ app, openTab }) => {
  mkdirSync('tests/.shots', { recursive: true });
  const page = await openTab('filo://preferences/preferences.html');
  const sez = page.locator('#sec-funzioni');
  await sez.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/841-pref-chiaro.png' });
  await chiedi(app, 'tema', 'scuro');
  await page.waitForTimeout(1200);
  await sez.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/841-pref-scuro.png' });
  // tasto destro sull'interruttore
  await page.locator('#aiutoAcceso').locator('xpath=..').click({ button: 'right' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/.shots/841-pref-destro.png' });
});
