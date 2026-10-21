// Verifica #1318 giro 2, rilievo 1: un percorso relativo o un nome di file chiesto all'assistente non diventa una pagina
// «aperta» su un indirizzo che non esiste: è un file, fermato e detto come gli altri percorsi.
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

for (const scritto of ['./conto.pdf', '../Documenti/conto.pdf', 'conto.pdf']) {
  test(`r1 «${scritto}» chiesto all'assistente non apre una pagina inesistente data per aperta`, async ({ app, shell }) => {
    const home = await homeDiFilo(app, shell);
    const prima = await schede(app);
    const r = await home.evaluate((u) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: { type: 'NAVIGA', url: u } }), scritto);
    await shell.waitForTimeout(1500);
    expect((await schede(app)).filter((u) => !prima.includes(u)), 'nessuna scheda su un indirizzo inventato').toEqual([]);
    expect(r && r.executed, 'l\'assistente lo dà per aperto').toBeFalsy();
    expect(r.output && r.output.avviso, 'l\'assistente sa che è un file').toMatch(/File del computer/);
  });
}
