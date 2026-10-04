// Verifica #986 giro 1 — esplorazione: corsa invio/elenco con la coda viva, testi insoliti, tema scuro.
import { test, expect } from '../../fixtures/electron.mjs';

const BACHECA = 'filo://board/board.html';

async function paginaConContentScript(app, prefisso) {
  const scadenza = Date.now() + 10_000;
  let win = null;
  while (Date.now() < scadenza && !win) {
    win = app.windows().find((w) => w.url().startsWith(prefisso));
    if (!win) await new Promise((r) => setTimeout(r, 100));
  }
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

async function manda(page, testo, files) {
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  if (testo != null) await page.locator('.sn-fb-text').fill(testo);
  if (files) await page.locator('.sn-fb-file').setInputFiles(files);
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 6_000 });
}

test('con la coda viva e la rete pronta la segnalazione arriva a «inviata»', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(() => {
    let n = 300;
    globalThis.SN_FEEDBACK.submit = async () => ({ id: `doc-${n}`, seq: n++, failed: [] });
  });
  const home = await paginaConContentScript(app, 'filo://newtab');
  await manda(home, 'Corsa uno');
  const bacheca = await openTab(BACHECA);
  const riga = bacheca.locator('#bdMie .bd-mia').first();
  await expect(riga.locator('.bd-mia-stato')).toHaveText('inviata', { timeout: 10_000 });
  const v = await app.evaluate(async () => (await globalThis.SN_SEGNALAZIONI_MIE.elenco())[0]);
  console.log('VOCE', JSON.stringify(v));
});

test('testi insoliti e tema scuro', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const M = globalThis.SN_SEGNALAZIONI_MIE;
    await M.registra({ id: 'lungo', testo: 'parola'.repeat(2000) + '\n' + 'x '.repeat(4000), allegati: ['a.png', 'b.pdf'], stato: 'inviata', num: '12' });
    await M.registra({ id: 'spazi', testo: '   \n   ', allegati: ['schermata.png'] });
    await M.registra({ id: 'html', testo: '<img src=x onerror="window.__xss=1">ciao', stato: 'risolta', num: '9', risposta: 'x' });
    await M.registra({ id: 'nonpartita', testo: 'Non partita', stato: 'non_partita' });
    await M.registra({ id: 'chiusa', testo: 'Doppia', stato: 'chiusa', num: '7' });
  });
  const bacheca = await openTab(`${BACHECA}#segnalazioni`);
  await expect(bacheca.locator('#bdMie .bd-mia')).toHaveCount(5);
  await bacheca.locator('#bdMie .bd-mia[data-id="lungo"] .bd-mia-testa').click();
  expect(await bacheca.evaluate(() => window.__xss)).toBeUndefined();
  const largo = await bacheca.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  console.log('SCROLL ORIZZONTALE', largo);
  await bacheca.screenshot({ path: 'tests/.shots/v986-chiaro.png', fullPage: false });
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await bacheca.waitForTimeout(800);
  await bacheca.screenshot({ path: 'tests/.shots/v986-scuro.png', fullPage: false });
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'system'; });
});
