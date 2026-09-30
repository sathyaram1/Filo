// Verifica #590, giro 19, rilievo 1: nel diario dell'assistente sulla pagina la riga di un'apertura
// fermata dalla lista si legge per intero, e il diario non prende una barra di scorrimento orizzontale.

import { test, expect, lista, schede } from '../../helpers/reteFinta.mjs';

test('assistente sulla pagina: NAVIGA fermata verso un sito dal nome comune ma non corto, riga intera e niente barra orizzontale', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['ilfattoquotidiano.it']);
  const pagina = rete.pagina('sito.test', '/', '<h1>PAGINA</h1>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), pagina);
  await expect.poll(async () => (await schede(app)).includes(pagina), { timeout: 8000 }).toBe(true);
  await shell.waitForTimeout(800);
  const esegui = (code) => app.evaluate(async ({ BrowserWindow }, c) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => String(x.url).includes('sito.test'));
    return t.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: c }]);
  }, code);
  await esegui('window.SN_SIDEBAR.open(), 1');
  expect(await esegui(`window.__filoSidebarTest.runFiloAction({ type: 'NAVIGA', url: 'https://www.ilfattoquotidiano.it/' })`)).toBe(false);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await expect(tab.locator('.sn-sidebar button', { hasText: 'Apri comunque' })).toBeVisible();
  const m = await tab.evaluate(() => {
    const l = [...document.querySelectorAll('.sn-sidebar-log')].pop();
    const c = document.querySelector('.sn-sidebar-conv');
    return { testo: l.textContent, riga: [l.scrollWidth, l.clientWidth], diario: [c.scrollWidth, c.clientWidth] };
  });
  expect(m.testo).toContain('è fra i siti bloccati');
  expect(m.riga[0], `riga tagliata: ${m.testo}`).toBeLessThanOrEqual(m.riga[1]);
  expect(m.diario[0], 'il diario scorre di lato').toBeLessThanOrEqual(m.diario[1]);
});
