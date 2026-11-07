import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDelloStrato } from '../../helpers/riquadri.mjs';
import { confermaSopraPagina, nelMondoDiFilo } from '../../helpers/confirm.mjs';

const fumetto = (page) => page.locator('[data-sn-fumetto] .tip');
test.setTimeout(120_000);

test('colore scelto: Aiuto sopra un sito', async ({ app, shell, openTab, testServer }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForFunction(() => !!window.SN_SUGGERIMENTO);
  await pref.locator('[id="tok-fumetto.sfondo"]').fill('#203040');
  await pref.waitForTimeout(800);
  const sito = await testServer.openReady(openTab, '<!doctype html><html><body style="padding:40px"><h1>Pagina</h1></body></html>');
  await sito.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 15_000 });
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const strato = await paginaDelloStrato(app, sito);
  await strato.waitForSelector('.sn-sidebar-close', { timeout: 10_000 });
  await strato.locator('.sn-sidebar-close').hover();
  await expect(fumetto(strato)).toHaveText('Chiudi');
  const c = await fumetto(strato).evaluate((e) => getComputedStyle(e).backgroundColor);
  console.log('AIUTO SITO sfondo', c, 'var', await strato.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sn-fumetto-sfondo')));
  await strato.screenshot({ path: 'tests/.shots/2095-v2-aiuto-sito.png' });
});

test('colore scelto: conferma sopra un sito', async ({ app, openTab, testServer }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForFunction(() => !!window.SN_SUGGERIMENTO);
  await pref.locator('[id="tok-fumetto.sfondo"]').fill('#203040');
  await pref.waitForTimeout(800);
  await app.evaluate(() => { globalThis.SN_FEEDBACK.submit = async () => ({ id: 'test-fb' }); });
  const LUNGO = Array.from({ length: 120 }, (_, i) => `Riga ${i + 1}.`).join('\n');
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="padding:40px"><h1>Pagina</h1></body></html>');
  const host = new URL(page.url()).hostname;
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await nelMondoDiFilo(app, host, `window.__filoSidebarTest.runFiloAction(${JSON.stringify({ type: 'INVIA_FEEDBACK', testo: LUNGO, titolo: 'Prova' })}); true;`);
  const sopra = await confermaSopraPagina(app);
  await expect.poll(() => sopra.evaluate(() => window.SN_CONFIRM_UI?._test.state()?.okDisabled)).toBe(true);
  const p = await sopra.evaluate(() => window.SN_CONFIRM_UI._test.point('ok'));
  await sopra.mouse.move(p.x - 3, p.y);
  await sopra.mouse.move(p.x, p.y);
  await expect(fumetto(sopra)).toBeVisible({ timeout: 3000 });
  console.log('CONFERMA SITO sfondo', await fumetto(sopra).evaluate((e) => getComputedStyle(e).backgroundColor));
  await sopra.screenshot({ path: 'tests/.shots/2095-v2-conferma-sito.png' });
});
