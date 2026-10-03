// Verifica #430, giro 7, rilievo 1: le schede aperte dietro mentre Filo è ridotto a icona restano senza anteprima
// anche dopo che la finestra torna. Nel contenitore senza gestore di finestre ridurre a icona non fa niente: la
// finestra «si riduce» rispondendo isMinimized() e coi suoi eventi, che è quello che il main guarda.
import { test, expect } from '../../fixtures/electron.mjs';

const pagina = (colore, titolo, corpo = '') => `<!doctype html><title>${titolo}</title>
<style>html,body{margin:0;height:100%;background:${colore}}a{display:block;font:30px sans-serif;padding:20px}</style>
<h1 style="margin:0;padding:40px;font:40px sans-serif">${titolo}</h1>${corpo}`;

async function schede(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return { attiva: t.activeId, tutte: t.tabs.map((x) => ({ id: x.id, url: x.url, loading: x.loading })) };
  });
}

async function cartaVerde(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const c = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL() === 'filo://shell/anteprima.html');
    if (!c || !c.isVisible()) return 'nessuna carta';
    const d = await c.webContents.executeJavaScript(`(() => { const i = document.querySelector('#foto img'); if (!i) return null;
      const r = i.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, dpr: devicePixelRatio }; })()`);
    if (!d) return 'carta senza foto';
    const shot = await c.webContents.capturePage();
    const s = shot.getSize();
    const px = Math.round(d.x * d.dpr); const py = Math.round(d.y * d.dpr);
    const b = shot.toBitmap(); const i = (py * s.width + px) * 4;
    const [r, g, bl] = [b[i + 2], b[i + 1], b[i]];
    return g > 100 && r < 90 && bl < 90 ? 'verde' : `altro ${r},${g},${bl}`;
  });
}

async function riduci(app, ridotta) {
  await app.evaluate(({ BrowserWindow }, ridotta) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    if (ridotta) { w.__isMin = w.isMinimized; w.isMinimized = () => true; w.emit('minimize'); }
    else { w.isMinimized = w.__isMin; w.emit('restore'); }
  }, ridotta);
}

test('una scheda aperta dietro che finisce di caricare con Filo ridotto a icona ha l\'anteprima quando Filo torna', async ({ app, shell, testServer }) => {
  const url = testServer.html(pagina('#10a020', 'Dietro'));
  const davantiUrl = testServer.html(pagina('#e01010', 'Davanti', `<a id="vai" href="${url}">link</a>`));
  await shell.evaluate((u) => window.filoShell.tabs.open(u), davantiUrl);
  await expect.poll(async () => (await schede(app)).tutte.some((x) => x.url === davantiUrl && !x.loading), { timeout: 15_000 }).toBe(true);
  const page = app.windows().find((w) => w.url() === davantiUrl);
  await page.waitForLoadState('domcontentloaded');

  // Ctrl+clic su un link e subito via: Filo ridotto a icona mentre la scheda nuova carica.
  await riduci(app, true);
  await page.click('#vai', { modifiers: ['Control'] });
  await expect.poll(async () => (await schede(app)).tutte.some((x) => x.url === url && !x.loading), { timeout: 15_000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 12_000));
  await riduci(app, false);

  const dietro = (await schede(app)).tutte.find((x) => x.url === url).id;
  expect((await schede(app)).attiva).not.toBe(dietro);
  await new Promise((r) => setTimeout(r, 3000));
  await shell.locator(`.tab[data-id="${dietro}"]`).hover();
  await expect.poll(() => cartaVerde(app), { timeout: 10_000, message: 'tornato Filo, la carta della scheda aperta dietro non mostra la pagina' }).toBe('verde');
});
