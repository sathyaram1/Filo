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
async function finto(app, lettura) {
  await app.evaluate(async (_, l) => {
    globalThis.__sistemaFinto = l;
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__sistemaFinto);
  }, lettura);
}
async function cambia(app, lettura) {
  await app.evaluate(async (_, l) => { globalThis.__sistemaFinto = l; await globalThis.SN_SISTEMA_MAIN._perProve.leggiOra(); }, lettura);
}
const PIENO = {
  batteria: { livello: 42, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa di Anna' },
  bluetooth: { acceso: true, dispositivi: ['Cuffie', 'Mouse'] },
};
const voce = (page, v) => page.locator(`#sistema .dash-sis-voce[data-voce="${v}"]`);

test('aspetto', async ({ app }) => {
  await finto(app, PIENO);
  const page = await newtab(app);
  await expect(voce(page, 'batteria')).toHaveText('42%', { timeout: 8_000 });
  await page.screenshot({ path: 'tests/.shots/g5-chiaro.png' });
  await cambia(app, { batteria: { livello: 9, inCarica: false, collegata: false }, rete: { online: false }, bluetooth: { acceso: false } });
  await expect(voce(page, 'rete')).toHaveText('offline');
  await page.screenshot({ path: 'tests/.shots/g5-bassa-offline.png' });
  await cambia(app, { batteria: { livello: 77, inCarica: true, collegata: true }, rete: { online: true, tipo: 'cavo' }, bluetooth: { acceso: true, dispositivi: null } });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/g5-carica-cavo.png' });
  await voce(page, 'rete').click({ button: 'right' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/g5-box.png' });
  await page.keyboard.press('Escape');
  await app.evaluate(async () => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } },
    { url: 'filo://preferences/preferences.html' },
  ));
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark', { timeout: 5_000 });
  await cambia(app, { batteria: { livello: 9, inCarica: false, collegata: false }, rete: { online: false }, bluetooth: { acceso: false } });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/g5-scuro.png' });
  await voce(page, 'batteria').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/g5-scuro-box.png' });
});

test('finestra stretta e finestra ridotta a icona', async ({ app }) => {
  await finto(app, PIENO);
  await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.veglia(2_000));
  const page = await newtab(app);
  const attivo = () => app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.attivo());
  await expect.poll(attivo, { timeout: 8_000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.setSize(700, 700);
  });
  await page.waitForTimeout(1000);
  const vis = await page.evaluate(() => ({ w: innerWidth, sis: document.querySelector('#sistema').getBoundingClientRect().width, vs: document.visibilityState }));
  console.log('stretta', JSON.stringify(vis));
  await page.screenshot({ path: 'tests/.shots/g5-stretta.png' });
  // aspetta oltre la veglia più un richiamo della home (30 s): il lettore resta acceso?
  const campioni = [];
  for (let i = 0; i < 12; i++) { campioni.push(await attivo()); await page.waitForTimeout(3000); }
  console.log('stretta attivo', JSON.stringify(campioni));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.setSize(1280, 800);
    w.minimize();
  });
  await page.waitForTimeout(1000);
  const min = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).isMinimized());
  console.log('minimizzata', min, await page.evaluate(() => document.visibilityState));
  const c2 = [];
  for (let i = 0; i < 12; i++) { c2.push(await attivo()); await page.waitForTimeout(3000); }
  console.log('min attivo', JSON.stringify(c2));
  await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.veglia(0));
});
