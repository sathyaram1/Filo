// Verifica #1476 giro 1, rilievo 1: Ctrl/Cmd+L premuto su una pagina dove si sta scrivendo non deve buttare via il testo.
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';

function info(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    const a = t.tabs.find((x) => x.id === t.activeId) || null;
    return { activeId: t.activeId, activeUrl: a ? a.url : null, urls: t.tabs.map((x) => x.url) };
  });
}

function premi(app, keyCode, modifiers) {
  return app.evaluate(({ BrowserWindow }, { keyCode, modifiers }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  }, { keyCode, modifiers });
}

test('r1 Ctrl+L con del testo scritto nella pagina: il cursore va nel campo dell indirizzo e il testo resta', async ({ app, openTab, testServer }) => {
  const url = testServer.html('<title>Modulo</title><textarea id="t"></textarea>');
  const page = await openTab(url);
  await page.locator('#t').fill('una lettera lunga scritta a mano');
  const { activeId } = await info(app);

  await premi(app, 'L', ['control']);

  // Il cursore arriva nel campo della home dove si scrive l'indirizzo.
  await expect.poll(() => info(app).then((i) => String(i.activeUrl)), { timeout: 10_000 }).toContain('filo://newtab/');
  const dopo = await info(app);
  let home = null;
  await expect.poll(async () => Boolean(home = await paginaDellaScheda(app, dopo.activeId, (p) => p.url().startsWith('filo://newtab/'))), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => home.evaluate(() => document.activeElement && document.activeElement.id), { timeout: 10_000 }).toBe('input');

  // Il testo scritto non è perso: o la pagina è rimasta aperta nella sua scheda, o Indietro la riporta col testo.
  if (dopo.activeId === activeId) {
    await app.evaluate(({ BrowserWindow }) => { const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs; tm.goBack(tm.activeId); });
    await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(url);
  }
  let pagina = null;
  await expect.poll(async () => Boolean(pagina = await paginaDellaScheda(app, activeId, (p) => p.url() === url)), { timeout: 10_000 }).toBe(true);
  await expect(pagina.locator('#t')).toHaveValue('una lettera lunga scritta a mano', { timeout: 10_000 });
});
