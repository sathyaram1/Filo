// Verifica #431, rilievo 1: con poche schede e mezza barra vuota, la scheda che suona tronca un titolo corto.
import { test, expect } from '../../fixtures/electron.mjs';

const FAV = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#e00"/></svg>');

test('la scheda YouTube che suona si legge intera quando la barra ha spazio libero', async ({ app, shell, openTab, testServer }) => {
  for (const t of ['YouTube', 'Rick Astley - Never Gonna Give You Up (Official Music Video) - YouTube', 'Gmail']) {
    await openTab(testServer.html(`<title>${t}</title><link rel="icon" href="${FAV}"><h1>x</h1>`));
  }
  const id = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const web = w._filoTabs.tabs.filter((x) => /^https?:/.test(x.url || ''));
    for (const t of web) Object.assign(t, { loading: false });
    Object.assign(web[0], { audible: true });
    w._filoTabs._broadcast();
    return web[0].id;
  });
  const tab = shell.locator(`.tab[data-id="${id}"]`);
  await expect(tab.locator('.tab-alert')).toHaveCount(1, { timeout: 10_000 });
  await expect(tab.locator('.title')).toHaveText('YouTube');
  await shell.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const spazio = await shell.evaluate(() => innerWidth - document.querySelector('.tabs').getBoundingClientRect().right);
  expect(spazio).toBeGreaterThan(300);
  const titolo = await tab.locator('.title').evaluate((el) => ({ visto: el.clientWidth, serve: el.scrollWidth }));
  expect(titolo.visto, JSON.stringify(titolo)).toBeGreaterThanOrEqual(titolo.serve);
});
