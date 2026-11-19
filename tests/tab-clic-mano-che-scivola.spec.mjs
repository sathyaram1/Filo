// Il clic sulla scheda e sulla X arriva anche quando la mano non è ferma (#2382): un tremito oltre la soglia del
// trascinamento, la X premuta e lasciata appena fuori dal suo tondo, e il clic dopo un trascinamento che non è
// finito sulla scheda stessa (portata fuori dalla fila, annullato con Esc sopra la vicina).

import { test, expect } from './fixtures/electron.mjs';
import { tastoDestro, aspettaMenu, vociDelMenu } from './helpers/menuLinguetta.mjs';

async function treSchede(shell, testServer) {
  for (let i = 0; i < 3; i++) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>Pagina ${i}</title><p>${i}</p>`));
  }
  await expect.poll(() => shell.evaluate(() => [...document.querySelectorAll('#tabs .tab .title')].filter((t) => /Pagina \d/.test(t.textContent)).length), { timeout: 15_000 }).toBe(3);
  const ids = await aperte(shell);
  const ultima = ids.at(-1);
  await shell.evaluate((x) => window.filoShell.tabs.activate(x), ultima);
  await expect(shell.locator('#tabs .tab.active')).toHaveAttribute('data-id', ultima);
  return ids;
}

const aperte = (shell) => shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((el) => el.dataset.id));
const attiva = (shell) => shell.evaluate(() => document.querySelector('#tabs .tab.active')?.dataset.id || null);

async function punto(shell, id, sel) {
  return shell.evaluate(([x, s]) => {
    const el = document.querySelector(`#tabs .tab[data-id="${x}"]`);
    const r = (s ? el.querySelector(s) : el).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
  }, [id, sel]);
}

async function clicUmano(shell, p) {
  await shell.mouse.move(p.x, p.y);
  await shell.mouse.down();
  await shell.waitForTimeout(90);
  await shell.mouse.up();
}

test('un clic con la mano che trema oltre la soglia apre la scheda', async ({ shell, testServer }) => {
  const ids = await treSchede(shell, testServer);
  const p = await punto(shell, ids[0], null);
  await shell.mouse.move(p.x, p.y);
  await shell.mouse.down();
  await shell.mouse.move(p.x + 4, p.y + 1);
  await shell.mouse.move(p.x + 7, p.y + 2);
  await shell.mouse.up();
  await expect.poll(() => attiva(shell), { timeout: 3_000 }).toBe(ids[0]);
  expect(await aperte(shell)).toEqual(ids);
});

test('la X lasciata appena fuori dal suo tondo chiude la scheda', async ({ shell, testServer }) => {
  const ids = await treSchede(shell, testServer);
  const p = await punto(shell, ids[1], null);
  await shell.mouse.move(p.x, p.y);
  const x = await punto(shell, ids[1], '.close');
  await shell.mouse.move(x.x, x.y);
  await shell.mouse.down();
  await shell.mouse.move(x.x - x.w / 2 - 4, x.y + 3);
  await shell.mouse.up();
  await expect.poll(() => aperte(shell), { timeout: 3_000 }).not.toContain(ids[1]);
  expect(await attiva(shell)).toBe(ids.at(-1));
});

test('la X premuta e portata lontano non chiude e non apre la scheda', async ({ shell, testServer }) => {
  const ids = await treSchede(shell, testServer);
  const p = await punto(shell, ids[1], null);
  await shell.mouse.move(p.x, p.y);
  const x = await punto(shell, ids[1], '.close');
  await shell.mouse.move(x.x, x.y);
  await shell.mouse.down();
  await shell.mouse.move(x.x - 40, x.y);
  await shell.mouse.up();
  await shell.waitForTimeout(400);
  expect(await aperte(shell)).toEqual(ids);
  expect(await attiva(shell)).toBe(ids.at(-1));
});

test('dopo averla portata fuori dalla fila, il clic sulla scheda la apre', async ({ shell, testServer }) => {
  const ids = await treSchede(shell, testServer);
  const p = await punto(shell, ids[0], null);
  await shell.mouse.move(p.x, p.y);
  await shell.mouse.down();
  for (const dy of [10, 40, 120, 260]) await shell.mouse.move(p.x + 5, p.y + dy);
  await shell.mouse.up();
  await shell.waitForTimeout(300);
  expect(await aperte(shell)).toEqual(ids);
  expect(await attiva(shell)).toBe(ids.at(-1));
  await clicUmano(shell, await punto(shell, ids[0], null));
  await expect.poll(() => attiva(shell), { timeout: 3_000 }).toBe(ids[0]);
});

test('dopo un trascinamento annullato con Esc sopra la vicina, il clic sulla scheda la apre', async ({ shell, testServer }) => {
  const ids = await treSchede(shell, testServer);
  const p = await punto(shell, ids[0], null);
  await shell.mouse.move(p.x, p.y);
  await shell.mouse.down();
  for (const dx of [10, p.w / 2, p.w]) await shell.mouse.move(p.x + dx, p.y);
  await shell.keyboard.press('Escape');
  await shell.mouse.up();
  await shell.waitForTimeout(300);
  expect(await aperte(shell)).toEqual(ids);
  expect(await attiva(shell)).toBe(ids.at(-1));
  await clicUmano(shell, await punto(shell, ids[0], null));
  await expect.poll(() => attiva(shell), { timeout: 3_000 }).toBe(ids[0]);
});

// Il clic dato nel bordo trasparente della finestra del menu, nel punto della barra che ci sta sotto.
function clicNelBordoDelMenu(app, px, py) {
  return app.evaluate(({ BrowserWindow }, [x, y]) => {
    const madre = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const m = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible() && w.webContents.getURL().startsWith('data:text/html'));
    const cm = madre.getContentBounds();
    const cb = m.getContentBounds();
    const lx = Math.round(cm.x + x - cb.x);
    const ly = Math.round(cm.y + y - cb.y);
    if (lx < 0 || ly < 0 || lx >= cb.width || ly >= cb.height) return { fuori: true };
    m.webContents.sendInputEvent({ type: 'mouseMove', x: lx, y: ly });
    m.webContents.sendInputEvent({ type: 'mouseDown', x: lx, y: ly, button: 'left', clickCount: 1 });
    m.webContents.sendInputEvent({ type: 'mouseUp', x: lx, y: ly, button: 'left', clickCount: 1 });
    return { fuori: false };
  }, [px, py]);
}

// Un punto del bordo trasparente del menu che cade sopra la pagina (sotto il riquadro), in coordinate della barra, con
// la vista che lo copre: è lì che il clic non deve andare a nessuno (#2382.1).
function bordoSopraLaPagina(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const madre = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const m = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible() && w.webContents.getURL().startsWith('data:text/html'));
    const r = JSON.parse(await m.webContents.executeJavaScript('JSON.stringify(document.querySelector(".menu").getBoundingClientRect())'));
    const cm = madre.getContentBounds();
    const cb = m.getContentBounds();
    const lx = Math.round(r.left + r.width / 2);
    const ly = Math.round(r.bottom + (cb.height - r.bottom) / 2);
    const x = cb.x + lx - cm.x;
    const y = cb.y + ly - cm.y;
    const coperta = madre.contentView.children.some((v) => {
      if (typeof v.getVisible === 'function' && !v.getVisible()) return false;
      const b = v.getBounds();
      return b.width > 0 && b.height > 0 && x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
    });
    return { x, y, coperta, fuoriDalMenu: ly > r.bottom && ly < cb.height };
  });
}

test('col menu aperto sopra la pagina, il clic sul suo bordo lo chiude e non va né alla pagina né alla barra', async ({ app, shell, testServer }) => {
  const ids = await treSchede(shell, testServer);
  await app.evaluate(({ BrowserWindow }) => {
    const madre = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const t = madre._filoTabs.tabs.find((x) => x.id === madre._filoTabs.activeId);
    return t.view.webContents.executeJavaScript(`window.__pressioni = 0;
      for (const ev of ['mousedown', 'mouseup', 'click', 'contextmenu']) document.addEventListener(ev, () => { window.__pressioni++; }, true);
      true`);
  });
  await shell.evaluate(() => {
    window.__pressioni = [];
    for (const ev of ['mousedown', 'mouseup', 'click', 'contextmenu']) {
      document.addEventListener(ev, (e) => { window.__pressioni.push(`${ev}@${e.clientX},${e.clientY}`); }, true);
    }
  });
  await tastoDestro(shell, `#tabs .tab[data-id="${ids[1]}"]`);
  await aspettaMenu(app, (v) => v.some((x) => x.testo === 'Chiudi'));
  const b = await bordoSopraLaPagina(app);
  expect(b.fuoriDalMenu, 'il punto deve stare nel bordo trasparente, fuori dal riquadro').toBe(true);
  expect(b.coperta, 'sotto il punto deve esserci la pagina').toBe(true);
  // Il tasto destro di prima è passato dalla barra: da qui conta solo il clic sul bordo.
  await shell.evaluate(() => { window.__pressioni = []; });
  const esito = await clicNelBordoDelMenu(app, b.x, b.y);
  expect(esito.fuori).toBe(false);
  await expect.poll(() => vociDelMenu(app), { timeout: 3_000 }).toBe(null);
  await shell.waitForTimeout(400);
  expect(await shell.evaluate(() => window.__pressioni), 'il clic non deve arrivare alla barra coperta dalla pagina').toEqual([]);
  const allaPagina = await app.evaluate(({ BrowserWindow }) => {
    const madre = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const t = madre._filoTabs.tabs.find((x) => x.id === madre._filoTabs.activeId);
    return t.view.webContents.executeJavaScript('window.__pressioni');
  });
  expect(allaPagina, 'il clic non deve arrivare alla pagina').toBe(0);
  expect(await aperte(shell)).toEqual(ids);
  expect(await attiva(shell)).toBe(ids.at(-1));
});

test('col menu del tasto destro aperto, la X sotto il suo bordo chiude la scheda', async ({ app, shell, testServer }) => {
  const ids = await treSchede(shell, testServer);
  await tastoDestro(shell, `#tabs .tab[data-id="${ids[1]}"]`);
  await aspettaMenu(app, (v) => v.some((x) => x.testo === 'Chiudi'));
  const x = await punto(shell, ids[1], '.close');
  const esito = await clicNelBordoDelMenu(app, x.x, x.y);
  expect(esito.fuori, 'la X deve stare sotto la finestra del menu').toBe(false);
  await expect.poll(() => aperte(shell), { timeout: 3_000 }).not.toContain(ids[1]);
  await expect.poll(() => vociDelMenu(app), { timeout: 3_000 }).toBe(null);
});

test('col menu del tasto destro aperto, il clic sulla scheda sotto il suo bordo la apre', async ({ app, shell, testServer }) => {
  const ids = await treSchede(shell, testServer);
  await tastoDestro(shell, `#tabs .tab[data-id="${ids[1]}"]`);
  await aspettaMenu(app, (v) => v.some((x) => x.testo === 'Chiudi'));
  const p = await punto(shell, ids[1], null);
  const esito = await clicNelBordoDelMenu(app, p.x - 10, p.y - 4);
  expect(esito.fuori, 'la scheda deve stare sotto la finestra del menu').toBe(false);
  await expect.poll(() => attiva(shell), { timeout: 3_000 }).toBe(ids[1]);
  await expect.poll(() => vociDelMenu(app), { timeout: 3_000 }).toBe(null);
});
