// #482 giro 3, rilievo 1: un percorso del computer in una forma che Filo non riconosce diventa una ricerca Google.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } });
});

for (const percorso of [
  '/run/media/mario/CHIAVETTA/tesi.docx',
  '"C:\\Users\\agenti AI\\Desktop\\nota.txt"',
]) {
  test(`r1 un percorso del computer (${percorso}) chiesto all'assistente è fermato e detto, non cercato su Google`, async ({ app, shell }) => {
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    let home = null;
    await expect.poll(() => { home = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(home); }).toBe(true);
    await home.waitForFunction(() => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage);
    const r = await home.evaluate((u) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: { type: 'NAVIGA', url: u } }), percorso);
    await home.waitForTimeout(800);
    expect((await schede(app)).some((u) => /google\.[a-z]+\/search/.test(decodeURIComponent(u))), 'il percorso è diventato una ricerca Google').toBe(false);
    expect(r && r.output && r.output.blocked, 'l\'assistente non sa che il file è stato fermato').toBe('scheme');
  });
}
