// Verifica #431 giro 2, rilievo 2: quando una scheda comincia o smette di suonare, tutte le schede
// e il «+» si spostano di qualche pixel. In Chrome la barra resta ferma.
import { test, expect } from '../../fixtures/electron.mjs';

const FAV = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#e00"/></svg>');

test('audio che parte e si ferma: le schede e il «+» restano dove sono', async ({ app, shell, openTab, testServer }) => {
  const pagina = (t) => testServer.html(`<title>${t}</title><link rel="icon" href="${FAV}"><h1 id="ok">x</h1>`);
  for (const t of ['Gmail', 'Wikipedia', 'YouTube']) await openTab(pagina(t));
  await expect(shell.locator('.tab .title')).toHaveText(['Home', 'Gmail', 'Wikipedia', 'YouTube'], { timeout: 10_000 });
  await expect(shell.locator('.tab .spinner')).toHaveCount(0, { timeout: 10_000 });

  const suona = (a) => app.evaluate(({ BrowserWindow }, a) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const web = w._filoTabs.tabs.filter((x) => /^https?:/.test(x.url || ''));
    web[2].audible = a;
    w._filoTabs._broadcast();
  }, a);
  const posti = () => shell.evaluate(() => [...document.querySelectorAll('.tab, .tab-new')]
    .map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));

  await shell.waitForTimeout(500);
  const prima = await posti();
  await suona(true);
  await expect(shell.locator('.tab .audio-ind')).toHaveCount(1, { timeout: 10_000 });
  expect(await posti(), 'la scheda YouTube comincia a suonare').toEqual(prima);
  await suona(false);
  await expect(shell.locator('.tab .audio-ind')).toHaveCount(0, { timeout: 10_000 });
  expect(await posti(), 'la scheda YouTube smette di suonare').toEqual(prima);
});
