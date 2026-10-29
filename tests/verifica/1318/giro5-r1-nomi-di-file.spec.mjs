// #1318 giro 5, rilievo 1: un nome di file chiesto all'assistente non diventa un sito inventato dato per aperto.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } });
});
const homeDiFilo = async (app, shell) => {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  let home = null;
  await expect.poll(() => { home = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(home); }).toBe(true);
  await home.waitForFunction(() => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage);
  return home;
};

for (const scritto of ['index.html', 'pagina.htm', 'app.js', 'conto.pdf.']) {
  test(`r1 l'assistente con «${scritto}» non apre un sito inventato e non lo dà per aperto`, async ({ app, shell }) => {
    const home = await homeDiFilo(app, shell);
    const prima = await schede(app);
    const r = await home.evaluate((u) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: { type: 'NAVIGA', url: u } }), scritto);
    expect(r && r.executed, 'un nome di file non è una pagina aperta').toBeFalsy();
    expect(r.output && r.output.avviso, 'l\'assistente sa cosa è successo').toBeTruthy();
    await shell.waitForTimeout(800);
    expect(await schede(app), 'nessuna scheda d\'errore su un indirizzo inventato').toEqual(prima);
  });
}
