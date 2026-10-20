// Verifica #1318 giro 1, rilievo 1: quello che l'assistente chiede di aprire e Filo non riconosce non diventa una
// ricerca Google data per pagina aperta: un percorso va fermato e detto, un indirizzo di posta va al programma di posta.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } });
});
const cerche = async (app) => (await schede(app)).filter((u) => /google\.[a-z]+(?:\/|%2F)search/i.test(decodeURIComponent(u)));
const homeDiFilo = async (app, shell) => {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  let home = null;
  await expect.poll(() => { home = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(home); }).toBe(true);
  await home.waitForFunction(() => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage);
  return home;
};
const naviga = (home, url) => home.evaluate((u) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: { type: 'NAVIGA', url: u } }), url);

for (const percorso of [
  '/data/progetti/conto.pdf',
  'Documenti\\conto.pdf',
  '%USERPROFILE%\\Desktop\\conto.pdf',
  '"C:\\Users\\agenti AI\\Documenti\\conto.pdf".',
]) {
  test(`r1 un percorso (${percorso}) chiesto all'assistente è fermato e detto, non cercato su Google`, async ({ app, shell }) => {
    const home = await homeDiFilo(app, shell);
    const r = await naviga(home, percorso);
    await shell.waitForTimeout(800);
    expect(await cerche(app), 'il percorso è finito in una ricerca Google').toEqual([]);
    expect(r && r.executed, 'l\'assistente lo dà per aperto').toBeFalsy();
  });
}

test('r1 un indirizzo di posta senza «mailto:» chiesto all\'assistente va al programma di posta, non su Google', async ({ app, shell }) => {
  await app.evaluate(({ shell: s }) => { globalThis.__esterni = []; s.openExternal = async (u) => { globalThis.__esterni.push(String(u)); }; });
  const home = await homeDiFilo(app, shell);
  await naviga(home, 'mario.rossi@esempio.it');
  await shell.waitForTimeout(800);
  expect(await cerche(app), 'l\'indirizzo di posta è finito in una ricerca Google').toEqual([]);
  expect(await app.evaluate(() => globalThis.__esterni)).toEqual(['mailto:mario.rossi@esempio.it']);
});
