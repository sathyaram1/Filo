import { test, expect } from '../../fixtures/electron.mjs';

const BACHECA = 'filo://board/board.html';

async function semina(app) {
  await app.evaluate(async () => {
    const M = globalThis.SN_SEGNALAZIONI_MIE;
    const lungo = 'parola'.repeat(80);
    await M.registra({ id: 'a1', testo: 'Il tasto Salva non salva\nseconda riga', stato: 'in_partenza', allegati: ['log.txt'], creataIl: '2026-10-04T10:00:00Z' });
    await M.registra({ id: 'a2', testo: 'Il video si blocca', stato: 'inviata', num: '990', titolo: 'Video bloccato', creataIl: '2026-10-03T10:00:00Z' });
    await M.registra({ id: 'a3', testo: 'Non parte', creataIl: '2026-10-02T10:00:00Z' });
    await M.nonPartita('a3');
    await M.registra({ id: 'a4', testo: lungo + '\n' + 'x'.repeat(4000), stato: 'inviata', num: '991', titolo: lungo, feedbackId: 'fb4', creataIl: '2026-10-01T10:00:00Z' });
    await M.chiusa('fb4', { stato: 'risolta', num: '991', titolo: 'Titolo risolto', risposta: 'Adesso funziona davvero bene.' });
    await M.registra({ id: 'a5', testo: '🙃 <img src=x onerror=alert(1)>', stato: 'inviata', num: '992', feedbackId: 'fb5', creataIl: '2026-09-30T10:00:00Z' });
    await M.chiusa('fb5', { stato: 'chiusa', num: '992', titolo: 'Doppione' });
  });
}

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, shell, openTab }) => {
    await shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { theme: t } }), tema);
    await semina(app);
    const b = await openTab(`${BACHECA}#segnalazioni`);
    await expect(b.locator('#bdMie .bd-mia')).toHaveCount(5);
    await b.locator('#bdMie .bd-mia').nth(3).locator('.bd-mia-testa').click();
    await b.waitForTimeout(400);
    await b.screenshot({ path: `tests/.shots/v986-g3-${tema}.png`, fullPage: false });
    const larghezza = await b.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    console.log('LARGHEZZA', tema, larghezza);
    await b.setViewportSize?.({ width: 520, height: 800 }).catch(() => {});
  });
}

test('chat da incognito', async ({ app, shell }) => {
  await app.evaluate(() => {
    globalThis.SN_FEEDBACK.submit = async () => ({ id: 'fbInc', seq: 1, failed: [] });
  });
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    !!BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)), { timeout: 15_000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs);
    return win._filoTabs.openTab('filo://newtab/?inc');
  });
  let page = null;
  for (let i = 0; i < 100 && !page; i++) {
    page = app.windows().find((w) => w.url().startsWith('filo://newtab/?inc'));
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  await page.waitForFunction(() => window.SN_SIDEBAR && window.__filoSidebarTest, null, { timeout: 15_000 });
  await page.evaluate(() => window.SN_SIDEBAR.open());
  await page.evaluate(() => window.__filoSidebarTest.runFiloAction({ type: 'INVIA_FEEDBACK', testo: 'DA-INCOGNITO-CHAT', titolo: 'Inc' }));
  await page.waitForTimeout(1000);
  const { CONFIRM_HOST, clickConfirm } = await import('../../helpers/confirm.mjs');
  if (await page.locator(CONFIRM_HOST).count()) await clickConfirm(page, 'ok');
  await page.waitForTimeout(1500);
  const n = await app.evaluate(async () => (await globalThis.SN_SEGNALAZIONI_MIE.elenco()).map((v) => v.testo));
  console.log('ELENCO DOPO CHAT INCOGNITO', JSON.stringify(n));
  expect(n.join('')).not.toContain('DA-INCOGNITO-CHAT');
});

test('comando /feedback dalla home', async ({ openTab }) => {
  const home = await openTab('filo://newtab/');
  await home.waitForTimeout(1500);
  const box = home.locator('#searchInput, #q, textarea, input[type=text]').first();
  await box.fill('/feedback');
  await box.press('Enter');
  await home.waitForTimeout(1500);
  console.log('URL DOPO /feedback', home.url());
  await home.screenshot({ path: 'tests/.shots/v986-g3-comando.png' });
});
