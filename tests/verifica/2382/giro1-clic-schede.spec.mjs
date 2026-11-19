// Verifica #2382 giro 1: il clic sulle schede e sulla X arriva nei gesti di una mano vera.

import { test, expect } from '../../fixtures/electron.mjs';

async function apri(shell, testServer, n, conPosta = false) {
  for (let i = 0; i < n - 1; i++) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>Pagina ${i}</title><p>${i}</p>`));
  }
  if (conPosta) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(
      '<title>(0) Posta</title><script>let n=0;setInterval(()=>{document.title="("+(++n)+") Posta"},30)</script>',
    ));
  }
  await expect(shell.locator('#tabs .tab')).toHaveCount(n + (conPosta ? 1 : 0), { timeout: 15_000 });
  await expect(shell.locator('#tabs .tab .spinner')).toHaveCount(0, { timeout: 15_000 });
}

async function centro(shell, i, sel) {
  return shell.evaluate(([k, s]) => {
    const el = document.querySelectorAll('#tabs .tab')[k];
    const r = (s ? el.querySelector(s) : el).getBoundingClientRect();
    return { id: el.dataset.id, x: s ? r.left + r.width / 2 : r.left + 24, y: r.top + r.height / 2 };
  }, [i, sel]);
}

const attiva = (shell) => shell.evaluate(() => document.querySelector('#tabs .tab.active')?.dataset.id);
const aperte = (shell) => shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((el) => el.dataset.id));

async function premiTrascinaRilascia(shell, p, dx, dy, passi = 3) {
  await shell.mouse.move(p.x, p.y);
  await shell.mouse.down();
  await shell.waitForTimeout(40);
  await shell.mouse.move(p.x + dx, p.y + dy, { steps: passi });
  await shell.waitForTimeout(40);
  await shell.mouse.up();
}

test('clic con la mano che trema di 6 px apre la scheda, anche mentre un\'altra si aggiorna', async ({ shell, testServer }) => {
  await apri(shell, testServer, 4, true);
  const p = await centro(shell, 1, null);
  await premiTrascinaRilascia(shell, p, 6, 2);
  await expect.poll(() => attiva(shell), { timeout: 3_000 }).toBe(p.id);
});

test('X premuta e mano che scivola di 5 px fuori dal tondo: la scheda si chiude', async ({ shell, testServer }) => {
  await apri(shell, testServer, 4, true);
  const p = await centro(shell, 0, '.close');
  await premiTrascinaRilascia(shell, p, -14, 3);
  await expect.poll(() => aperte(shell), { timeout: 3_000 }).not.toContain(p.id);
});

test('dopo un riordino il clic seguente sulla stessa scheda la apre', async ({ shell, testServer }) => {
  await apri(shell, testServer, 4);
  const p = await centro(shell, 1, null);
  const larga = await shell.evaluate(() => document.querySelector('#tabs .tab').getBoundingClientRect().width);
  await premiTrascinaRilascia(shell, p, larga * 1.2, 0, 8);
  await shell.waitForTimeout(400);
  const q = await shell.evaluate((id) => {
    const r = document.querySelector(`#tabs .tab[data-id="${id}"]`).getBoundingClientRect();
    return { x: r.left + 24, y: r.top + r.height / 2 };
  }, p.id);
  await shell.mouse.click(q.x, q.y, { delay: 80 });
  await expect.poll(() => attiva(shell), { timeout: 3_000 }).toBe(p.id);
});

test('clic in fila veloci su schede diverse: ognuno apre la sua', async ({ shell, testServer }) => {
  await apri(shell, testServer, 5, true);
  for (const i of [0, 3, 1, 4, 2]) {
    const p = await centro(shell, i, null);
    await shell.mouse.click(p.x, p.y, { delay: 30 });
    await expect.poll(() => attiva(shell), { timeout: 2_000 }).toBe(p.id);
  }
});

test('X di una scheda dietro al primo passaggio: chiude', async ({ shell, testServer }) => {
  await apri(shell, testServer, 5, true);
  const p = await centro(shell, 1, null);
  const x = await shell.evaluate((id) => {
    const el = document.querySelector(`#tabs .tab[data-id="${id}"]`);
    const r = el.querySelector('.close').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, p.id);
  await shell.mouse.move(x.x, x.y + 40);
  await shell.mouse.move(x.x, x.y, { steps: 2 });
  await shell.mouse.down();
  await shell.waitForTimeout(80);
  await shell.mouse.up();
  await expect.poll(() => aperte(shell), { timeout: 3_000 }).not.toContain(p.id);
});

test('col menu del tasto destro aperto, il clic sulla scheda accanto la apre', async ({ app, shell, testServer }) => {
  await apri(shell, testServer, 4);
  const b = await centro(shell, 1, null);
  const a = await centro(shell, 2, null);
  await shell.mouse.click(b.x, b.y, { button: 'right' });
  const geometria = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.isVisible() && x.webContents.getURL().startsWith('data:text/html') && x.getParentWindow());
    if (!w) return null;
    return { pop: w.getContentBounds(), main: w.getParentWindow().getContentBounds() };
  });
  await expect.poll(geometria, { timeout: 5_000 }).not.toBeNull();
  const g = await geometria();
  // La scheda a destra, nella fascia trasparente sopra il menu.
  const px = g.main.x + a.x - g.pop.x;
  const py = g.main.y + b.y - 5 - g.pop.y;
  test.skip(px < 0 || py < 0 || px >= g.pop.width || py >= g.pop.height, 'il punto non cade sulla cornice del menu');
  await app.evaluate(({ BrowserWindow }, [x, y]) => {
    const w = BrowserWindow.getAllWindows().find((v) => v.isVisible() && v.webContents.getURL().startsWith('data:text/html') && v.getParentWindow());
    w.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    w.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    w.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  }, [Math.round(px), Math.round(py)]);
  await expect.poll(() => attiva(shell), { timeout: 3_000 }).toBe(a.id);
});

test('r1 la fascia sopra le schede: a finestra massimizzata un clic a filo del bordo alto cade su una scheda', async ({ app, shell, testServer }) => {
  await apri(shell, testServer, 3);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.maximize();
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).isMaximized()), { timeout: 5_000 }).toBe(true);
  await shell.waitForTimeout(300);
  const sopra = await shell.evaluate(() => {
    const t = document.querySelectorAll('#tabs .tab')[1].getBoundingClientRect();
    const el = document.elementFromPoint(t.left + t.width / 2, 2);
    return { top: t.top, cosa: el ? (el.closest('.tab') ? 'scheda' : el.className || el.tagName) : 'niente' };
  });
  expect(sopra, `sopra la scheda, che comincia a ${sopra.top}px, c'è ${sopra.cosa}: a finestra massimizzata è la presa della finestra`).toMatchObject({ cosa: 'scheda' });
});
