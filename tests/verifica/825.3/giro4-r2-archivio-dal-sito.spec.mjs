// Il codice dentro un sito non legge né cancella l'archivio delle schede (come già non può cercarci dentro).
import { test, expect } from '../../fixtures/electron.mjs';
import { seedArchive } from './_comune.mjs';

test('da un sito l\'archivio non si legge, non si cerca e non si cancella', async ({ app, openTab, testServer }) => {
  await seedArchive(app, [{ title: 'Gatti persiani', gatto: true }, { title: 'Banca online, estratto conto', gatto: false }]);
  const web = await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const host = new URL(web.url()).host;
  const manda = (m) => app.evaluate(async ({ BrowserWindow }, { h, m: msg }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes(h));
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `chrome.runtime.sendMessage(${JSON.stringify(msg)})` }]);
  }, { h: host, m });

  const letto = await manda({ type: 'get_archived_tabs' });
  expect(JSON.stringify(letto || {}), 'il sito ha letto i titoli dell\'archivio').not.toContain('Banca online');
  const cercato = await manda({ type: 'search_archived_tabs', query: 'banca' });
  expect(JSON.stringify(cercato || {}), 'il sito ha cercato nell\'archivio').not.toContain('Banca online');
  await manda({ type: 'delete_archived_tabs', ids: ['t0'] });
  await manda({ type: 'remove_archived_tab', id: 't1' });
  await manda({ type: 'clear_archived_tabs' });
  const rimaste = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).length);
  expect(rimaste, 'il sito ha cancellato schede dall\'archivio').toBe(2);
});
