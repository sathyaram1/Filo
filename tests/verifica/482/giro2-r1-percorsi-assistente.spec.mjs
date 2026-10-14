// #482 giro 2 — r1: un percorso di rete alla Windows o un percorso del Mac/Linux chiesto all'assistente diventa una
// ricerca Google del percorso, invece di essere fermato e detto come il percorso «C:\…».

import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } });
});

async function dallaHome(app, shell) {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(page); }).toBe(true);
  await page.waitForFunction(() => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage);
  return page;
}

for (const [nome, percorso] of [
  ['percorso di Windows (controllo)', 'C:\\Users\\agenti AI\\Documenti\\conto.pdf'],
  ['cartella di rete scritta alla Windows', '\\\\nas\\condivisa\\bilancio.xlsx'],
  ['percorso del Mac o di Linux', '/home/utente/Documenti/conto.pdf'],
]) {
  test(`r1 ${nome}: chiesto all'assistente, è fermato e non diventa una ricerca`, async ({ app, shell }) => {
    const home = await dallaHome(app, shell);
    const r = await home.evaluate((u) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: { type: 'NAVIGA', url: u } }), percorso);
    await home.waitForTimeout(1500);
    const cercato = (await schede(app)).filter((u) => /google\.[a-z]+\/search/.test(decodeURIComponent(u)));
    expect(cercato, `l'assistente ha aperto una ricerca Google del percorso (${JSON.stringify(r)})`).toEqual([]);
    const avviso = await shell.evaluate(() => [...document.querySelectorAll('#shell-notifs > .shell-notif')]
      .some((c) => /bloccat/.test(c.textContent)));
    expect(avviso || (r && r.output && r.output.blocked === 'scheme'), 'Filo non dice che ha fermato il file').toBe(true);
  });
}
