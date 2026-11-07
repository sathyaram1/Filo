// Esplorazione della verifica di #1882 giro 1: moduli su richiesta, doppio caricamento nelle pagine di Filo, Cerca dall'editor.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const inAttesa = (page) => page.evaluate(() => (document.documentElement.dataset.filoSuRichiesta || '').split(',').filter(Boolean));

const NOMI = ['SN_CONST', 'SN_IMMAGINI_CHAT', 'SN_ESTERNO', 'SN_FILO_UI', 'SN_I18N', 'SN_CLIPBOARD', 'SN_MSG', 'SN_TASTI',
  'SN_DISPOSIZIONE_ICONE', 'SN_GESTI', 'SN_CAMPO_TESTO', 'SN_RICERCA_CAMPO', 'SN_ACCESSO_FISSO', 'SN_URL_NAV', 'SN_NOMI_SITO',
  'SN_WALLET', 'SN_MARKDOWN', 'SN_LINK_SOSPETTO', 'SN_THEME_TOKENS', 'SN_CONFIRM_UI', 'SN_CHAT_ERRORS', 'SN_ICONS_UTIL',
  'SN_QR', 'SN_CALC', 'SN_PLACE', 'SN_GUARDIANO_STATICO', 'SN_CAMPI_SEGRETI', 'SN_AVVISI', 'SN_FEEDBACK',
  'SN_FEEDBACK_CLIENT_ID_HASH', 'SN_FEEDBACK_ATTACH', 'SN_TAB_COLOR', 'SN_TTS_CHUNK', 'SN_MODEL_CAPS', 'SN_TTS_VOICES',
  'SN_DICTATION_SEGMENTER', 'SN_ASCOLTO', 'SN_VOCE_CHAT'];

test('sito appena aperto: cosa resta su richiesta dopo il primo tasto destro, e il QR alla prima richiesta', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><body style="padding:40px"><p id="p" style="font-size:22px">Una frase sulla pagina.</p><input id="campo" style="font-size:20px"></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const pronta = await inAttesa(page);
  await page.locator('#p').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  const dopoMenu = await inAttesa(page);
  await page.keyboard.press('Escape');
  await page.locator('#campo').click({ button: 'right' });
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  const dopoCampo = await inAttesa(page);
  await page.keyboard.press('Escape');
  console.log('PRONTA', pronta.join(','), '\nDOPO MENU', dopoMenu.join(','), '\nDOPO CAMPO', dopoCampo.join(','));
  test.info().annotations.push({ type: 'pronta', description: pronta.join(',') }, { type: 'dopoMenu', description: dopoMenu.join(',') }, { type: 'dopoCampo', description: dopoCampo.join(',') });
  expect(pronta.join(',') + ' | ' + dopoMenu.join(',') + ' | ' + dopoCampo.join(',')).toBe('LOG');
});

test('sito appena aperto: il QR dalla barra alla prima richiesta', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><body style="padding:40px"><p id="p">Una pagina.</p></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  expect(await inAttesa(page)).toContain('SN_QR');
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="qrCode"]:not(.riserva)').click();
  await expect(page.locator('.sn-qr-overlay img')).toBeVisible({ timeout: 8_000 });
  expect(await inAttesa(page)).not.toContain('SN_QR');
});

for (const url of ['filo://newtab/', 'filo://editor/editor.html', 'filo://transparency/transparency.html', 'filo://options/options.html', 'filo://history/history.html']) {
  test(`${url}: nessun modulo condiviso registrato due volte, e il tasto destro funziona`, async ({ openTab }) => {
    const page = await openTab(url);
    await page.addInitScript((nomi) => {
      const conte = {};
      for (const nome of nomi) {
        let v;
        conte[nome] = 0;
        Object.defineProperty(window, nome, { configurable: true, get: () => v, set: (x) => { conte[nome]++; v = x; } });
      }
      window.__registrazioni = conte;
    }, NOMI);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 10_000 });
    const conte = await page.evaluate(() => window.__registrazioni);
    const doppi = Object.entries(conte).filter(([, n]) => n > 1);
    const zero = Object.entries(conte).filter(([, n]) => n === 0).map(([k]) => k);
    console.log(url, 'ZERO', zero.join(','));
    expect(doppi).toEqual([]);
    await page.locator('body').click({ button: 'right', position: { x: 300, y: 300 } });
    await expect(menuDi(page).principale).toBeVisible({ timeout: 8_000 });
  });
}
