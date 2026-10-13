// #482 — Un indirizzo che Filo ferma per sicurezza (file del computer, cartelle di rete, data:, javascript:) lo dice con
// una notifica di solo testo, da ogni porta che lo ferma; e la posta va al programma di posta anche rinavigando una scheda.

import { test, expect } from './fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } });
});
const esterni = (app) => app.evaluate(() => globalThis.__esterni || []);
const intercettaEsterni = (app) => app.evaluate(({ shell }) => {
  globalThis.__esterni = [];
  shell.openExternal = async (u) => { globalThis.__esterni.push(String(u)); };
});
const carta = async (avvisi, testo) => (await avvisi()).locator('.shell-notif.show', { hasText: testo });

test('aperto da Filo in una scheda nuova, un file del computer viene fermato e lo dice, senza «Apri comunque»', async ({ app, shell, avvisi }) => {
  const prima = await schede(app);
  const r = await shell.evaluate(() => window.filoShell.tabs.open('file:///C:/Users/agenti%20AI/Documenti/conto.pdf'));
  expect(r && r.id, 'nessuna scheda per un file del computer').toBeFalsy();
  const c = await carta(avvisi, 'File del computer bloccato per sicurezza: C:/Users/agenti AI/Documenti/conto.pdf');
  await expect(c).toBeVisible({ timeout: 8000 });
  await expect(c.locator('.shell-notif-action')).toHaveCount(0);
  expect(await schede(app)).toEqual(prima);
});

test('rinavigando una scheda, una cartella di rete viene fermata e lo dice; la scheda resta dov\'era', async ({ app, shell, avvisi, testServer, openTab }) => {
  const page = await openTab(testServer.html('<title>Partenza</title><p>x</p>'));
  const partenza = page.url();
  const id = await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return tm.tabs.find((t) => t.view.webContents.getURL() === u).id;
  }, partenza);
  await shell.evaluate(([i]) => window.filoShell.tabs.navigate(i, 'file://nas/condivisa/bilancio.xlsx'), [id]);
  await expect(await carta(avvisi, 'Percorso di rete bloccato per sicurezza: //nas/condivisa/bilancio.xlsx')).toBeVisible({ timeout: 8000 });
  expect(page.url()).toBe(partenza);
});

for (const [indirizzo, testo] of [
  ['data:text/html,<h1>finta banca</h1>', 'Indirizzo «data:» bloccato per sicurezza'],
  ['javascript:alert(1)', 'Indirizzo «javascript:» bloccato per sicurezza'],
]) {
  test(`${indirizzo.split(':')[0]}: fermato sia aprendo una scheda nuova sia rinavigandone una, e lo dice`, async ({ app, shell, avvisi }) => {
    const r = await shell.evaluate((u) => window.filoShell.tabs.open(u), indirizzo);
    expect(r && r.id).toBeFalsy();
    const c = await carta(avvisi, testo);
    await expect(c).toBeVisible({ timeout: 8000 });
    await c.locator('.shell-notif-close').click();
    await expect(c).toHaveCount(0);

    const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs[0].id);
    await shell.evaluate(([i, u]) => window.filoShell.tabs.navigate(i, u), [id, indirizzo]);
    await expect(await carta(avvisi, testo)).toBeVisible({ timeout: 8000 });
    expect((await schede(app)).some((u) => /google\.[a-z]+\/search/.test(u)), 'non diventa una ricerca').toBe(false);
  });
}

test('la posta va al programma di posta sia aprendo una scheda nuova sia rinavigandone una, mai in una ricerca', async ({ app, shell, avvisi }) => {
  await intercettaEsterni(app);
  await shell.evaluate(() => window.filoShell.tabs.open('mailto:a@b.it'));
  await expect.poll(() => esterni(app), { timeout: 6000 }).toEqual(['mailto:a@b.it']);

  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs[0].id);
  await shell.evaluate(([i]) => window.filoShell.tabs.navigate(i, 'mailto:c@d.it?subject=Ciao'), [id]);
  await expect.poll(() => esterni(app), { timeout: 6000 }).toEqual(['mailto:a@b.it', 'mailto:c@d.it?subject=Ciao']);
  await shell.waitForTimeout(500);
  expect((await schede(app)).some((u) => /google\.[a-z]+\/search/.test(u)), 'la posta non diventa una ricerca').toBe(false);
  await expect((await avvisi()).locator('.shell-notif', { hasText: 'bloccat' })).toHaveCount(0);
});

test('un collegamento di Filo (risposta in chat, «Apri in nuova scheda») verso un file lo dice', async ({ app, avvisi }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.apriDaCollegamento('file:///home/utente/foto.jpg'));
  await expect(await carta(avvisi, 'File del computer bloccato per sicurezza: /home/utente/foto.jpg')).toBeVisible({ timeout: 8000 });
});

test('provato più volte, l\'avviso resta uno', async ({ app, shell, avvisi }) => {
  for (let i = 0; i < 4; i++) await shell.evaluate(() => window.filoShell.tabs.open('file:///tmp/ripetuto.txt'));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: '/tmp/ripetuto.txt' })).toBeVisible({ timeout: 8000 });
  await shell.waitForTimeout(400);
  await expect(vista.locator('.shell-notif', { hasText: '/tmp/ripetuto.txt' })).toHaveCount(1);
});

// ESPLORAZIONE: quali porte delle pagine arrivano davvero al cancello.
test('esplora: pagina interna e pagina web', async ({ app, shell, avvisi, testServer, openTab }) => {
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    globalThis.__visti = [];
    const orig = tm._esternoDallaPagina.bind(tm);
    tm._esternoDallaPagina = (...a) => { globalThis.__visti.push(['esterno', a[2]]); return orig(...a); };
  });
  const page = await openTab(testServer.html(`<title>Web</title>
    <a id="f" href="file:///tmp/dal-sito.pdf" style="display:block;width:300px;height:40px">file</a>
    <a id="z" href="zoommtg://zoom.us/join?confno=1" style="display:block;width:300px;height:40px">zoom</a>
    <a id="d" href="data:text/html,ciao" style="display:block;width:300px;height:40px">data</a>
    <a id="fb" href="file:///tmp/dal-sito-blank.pdf" target="_blank" style="display:block;width:300px;height:40px">file blank</a>`));
  for (const sel of ['#f', '#z', '#d', '#fb']) { await page.click(sel); await page.waitForTimeout(700); }
  console.log('VISTI', JSON.stringify(await app.evaluate(() => globalThis.__visti)));
  const testi = await (await avvisi().catch(() => null))?.locator('.shell-notif').allInnerTexts().catch(() => []);
  console.log('AVVISI', JSON.stringify(testi));
});
