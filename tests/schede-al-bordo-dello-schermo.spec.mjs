// Con la finestra massimizzata (o a schermo intero) la fila delle schede tocca il bordo alto dello schermo: il clic
// dato lassù sopra una scheda la prende, come in Chrome (#2382.1). A finestra normale la fascia resta la presa della
// finestra. Lo stato del sistema si finge dal main: sullo schermo virtuale senza gestore di finestre non si massimizza.

import { test, expect } from './fixtures/electron.mjs';
import { aspettaMenu, scegli } from './helpers/menuLinguetta.mjs';

const aperte = (shell) => shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((el) => el.dataset.id));
const attiva = (shell) => shell.evaluate(() => document.querySelector('#tabs .tab.active')?.dataset.id || null);

async function treSchede(shell, testServer) {
  for (let i = 0; i < 3; i++) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>Pagina ${i}</title><p>${i}</p>`));
  }
  await expect.poll(() => shell.evaluate(() => [...document.querySelectorAll('#tabs .tab .title')].filter((t) => /Pagina \d/.test(t.textContent)).length), { timeout: 15_000 }).toBe(3);
  const ids = await aperte(shell);
  await shell.evaluate((x) => window.filoShell.tabs.activate(x), ids.at(-1));
  await expect(shell.locator('#tabs .tab.active')).toHaveAttribute('data-id', ids.at(-1));
  return ids;
}

// Il sistema dice «massimizzata» (o no): il main lo annuncia come farebbe al gesto vero.
function fingi(app, stato) {
  return app.evaluate(({ BrowserWindow }, s) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.isMaximized = () => s.massimizzata;
    w.emit(s.massimizzata ? 'maximize' : 'unmaximize');
  }, stato);
}

// Il punto sul primo pixel in alto sopra la scheda, e cosa c'è lì: l'elemento colpito e se la finestra lo prende come
// presa (la regione più vicina dichiarata, risalendo, è quella che conta in questa fila).
function cimaSopra(shell, id) {
  return shell.evaluate((x) => {
    const r = document.querySelector(`#tabs .tab[data-id="${x}"]`).getBoundingClientRect();
    const px = Math.round(r.left + r.width / 2);
    const py = 1;
    const el = document.elementFromPoint(px, py);
    let regione = 'none';
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const v = getComputedStyle(n).getPropertyValue('app-region') || getComputedStyle(n).getPropertyValue('-webkit-app-region');
      if (v === 'drag' || v === 'no-drag') { regione = v; break; }
    }
    const scheda = el && el.closest ? el.closest('#tabs .tab') : null;
    return { x: px, y: py, scheda: scheda ? scheda.dataset.id : null, regione };
  }, id);
}

test('a finestra massimizzata il clic sul bordo alto sopra una scheda la apre', async ({ app, shell, testServer }) => {
  const ids = await treSchede(shell, testServer);
  await fingi(app, { massimizzata: true });
  await expect(shell.locator('html')).toHaveAttribute('data-schede-al-bordo', '');
  const p = await cimaSopra(shell, ids[0]);
  expect(p.scheda, 'sul bordo alto sopra la scheda deve esserci la scheda').toBe(ids[0]);
  expect(p.regione, 'il bordo alto sopra la scheda non deve spostare la finestra').toBe('no-drag');
  await shell.mouse.click(p.x, p.y);
  await expect.poll(() => attiva(shell), { timeout: 3_000 }).toBe(ids[0]);
});

test('a finestra massimizzata il tasto destro sul bordo alto apre il menu di quella scheda', async ({ app, shell, testServer }) => {
  const ids = await treSchede(shell, testServer);
  await fingi(app, { massimizzata: true });
  await expect(shell.locator('html')).toHaveAttribute('data-schede-al-bordo', '');
  const p = await cimaSopra(shell, ids[1]);
  await shell.mouse.click(p.x, p.y, { button: 'right' });
  await aspettaMenu(app, (v) => v.some((x) => x.testo === 'Chiudi'));
  // Il menu è quello della scheda sotto il bordo: «Chiudi» chiude lei.
  const { scegli } = await import('./helpers/menuLinguetta.mjs');
  await scegli(app, 'Chiudi');
  await expect.poll(() => aperte(shell), { timeout: 3_000 }).not.toContain(ids[1]);
});

test('a finestra normale la fascia sopra le schede resta la presa della finestra', async ({ app, shell, testServer }) => {
  const ids = await treSchede(shell, testServer);
  await fingi(app, { massimizzata: true });
  await expect(shell.locator('html')).toHaveAttribute('data-schede-al-bordo', '');
  await fingi(app, { massimizzata: false });
  await expect(shell.locator('html')).not.toHaveAttribute('data-schede-al-bordo', '');
  const p = await cimaSopra(shell, ids[0]);
  expect(p.scheda).toBe(null);
  expect(p.regione).toBe('drag');
});

test('una barra che si ricarica a finestra già massimizzata dà il bordo alto alle schede', async ({ app, shell, testServer }) => {
  await treSchede(shell, testServer);
  await fingi(app, { massimizzata: true });
  await shell.reload();
  await shell.waitForLoadState('domcontentloaded');
  await expect(shell.locator('html')).toHaveAttribute('data-schede-al-bordo', '', { timeout: 10_000 });
  await expect.poll(async () => (await cimaSopra(shell, (await aperte(shell))[0])).scheda, { timeout: 10_000 }).not.toBe(null);
});

test('l\'aspetto della fila non cambia a finestra massimizzata', async ({ app, shell, testServer }) => {
  await treSchede(shell, testServer);
  const fila = shell.locator('.tab-row');
  const prima = await fila.boundingBox();
  const schedaPrima = await shell.locator('#tabs .tab').first().boundingBox();
  await fila.screenshot({ path: 'tests/.shots/2382.1-fila-normale.png' });
  await fingi(app, { massimizzata: true });
  await expect(shell.locator('html')).toHaveAttribute('data-schede-al-bordo', '');
  expect(await fila.boundingBox()).toEqual(prima);
  expect(await shell.locator('#tabs .tab').first().boundingBox()).toEqual(schedaPrima);
  await fila.screenshot({ path: 'tests/.shots/2382.1-fila-massimizzata.png' });
});
