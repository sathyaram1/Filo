// Verifica #2091 giro 1, rilievo 3: la linguetta trascinata sopra una vicina non ne lascia trasparire il titolo.

import { test, expect } from '../../fixtures/electron.mjs';

const pagina = (titolo) => `<!doctype html><html><head><meta charset="utf-8"><title>${titolo}</title></head><body>x</body></html>`;

test('r3 a metà trascinamento sopra la vicina, la linguetta la copre del tutto', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, pagina('Articolo sulla Tesla volante'));
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await testServer.openReady(openTab, pagina('Modulo'));
  const tab = shell.locator(`.tab[data-id="${id}"]`);
  const r = await tab.boundingBox();
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  await shell.mouse.move(cx, cy);
  await shell.mouse.down();
  for (let i = 1; i <= 10; i++) await shell.mouse.move(cx + i * 9, cy);
  // Quello che si vede della linguetta: la sua opacità e quella del suo fondo, che insieme decidono se la vicina traspare.
  const copre = await tab.evaluate((el) => {
    const cs = getComputedStyle(el);
    const alfa = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(',').map((s) => parseFloat(s)); return p.length > 3 ? p[3] : 1; };
    return { opacita: Number(cs.opacity), fondo: alfa(cs.backgroundColor), trascinata: el.classList.contains('dragging') };
  });
  await shell.mouse.up();
  expect(copre.trascinata).toBe(true);
  expect(copre.opacita * copre.fondo).toBeGreaterThanOrEqual(0.99);
});
