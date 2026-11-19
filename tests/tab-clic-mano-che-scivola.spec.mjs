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
