// Verifica #431 giro 2, rilievo 1: su una scheda stretta che suona il titolo resta a un pezzo di lettera,
// e allargandola sparisce di nuovo: o c'è posto almeno per «Y…», o il titolo non si mostra.
import { test, expect } from '../../fixtures/electron.mjs';

const FAV = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#e00"/></svg>');

test('scheda che suona, stretta: il titolo non resta mai a un frammento e non sparisce allargandola', async ({ app, shell, openTab, testServer }) => {
  const pagina = (t) => testServer.html(`<title>${t}</title><link rel="icon" href="${FAV}"><h1 id="ok">x</h1>`);
  await openTab(pagina('YouTube'));
  await openTab(pagina('Attiva'));
  await expect(shell.locator('.tab .spinner')).toHaveCount(0, { timeout: 10_000 });
  const id = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const web = w._filoTabs.tabs.filter((x) => /^https?:/.test(x.url || ''));
    web[0].audible = true;
    w._filoTabs._broadcast();
    return web[0].id;
  });
  const scheda = shell.locator(`.tab[data-id="${id}"]`);
  await expect(scheda.locator('.audio-ind')).toHaveCount(1, { timeout: 10_000 });

  const visto = [];
  for (let w = 56; w <= 130; w += 2) {
    await shell.evaluate((w) => {
      let st = document.getElementById('larghezza-431-g2');
      if (!st) { st = document.createElement('style'); st.id = 'larghezza-431-g2'; document.head.appendChild(st); }
      st.textContent = `.tab:not(.active){flex:0 0 ${w}px!important;min-width:${w}px!important;max-width:${w}px!important}`;
    }, w);
    await shell.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const titolo = await scheda.evaluate((el) => {
      const t = el.querySelector('.title');
      return getComputedStyle(t).display === 'none' ? 0 : Math.round(t.getBoundingClientRect().width);
    });
    visto.push([w, titolo]);
  }
  const dove = JSON.stringify(visto);
  // Sotto i 10px non ci sta nemmeno «…»: si vede un tratto della prima lettera.
  for (const [, titolo] of visto) expect(titolo === 0 || titolo >= 10, dove).toBe(true);
  // Una scheda più larga non mostra meno titolo di una più stretta.
  for (let i = 1; i < visto.length; i++) expect(visto[i][1], dove).toBeGreaterThanOrEqual(visto[i - 1][1]);
});
