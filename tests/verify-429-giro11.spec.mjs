// #429 — controllo dopo le correzioni: il riquadro di suggerimento resta
// piccolo quando il testo è corto (non deve diventare sempre largo 420).

import { test, expect } from './fixtures/electron.mjs';

async function bordiTip(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows();
    const main = wins.find((w) => w._filoTabs && !w._filoIncognito);
    const tip = wins.find((w) => w !== main && !w._filoTabs);
    return tip ? tip.getBounds() : null;
  });
}

test('#429/26 — suggerimento corto = riquadro piccolo', async ({ shell, app }) => {
  await shell.waitForTimeout(1500);
  const pos = await shell.evaluate(() => {
    const el = document.querySelector('.tab-new') || document.querySelector('.tab');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tip: el.dataset.tip };
  });
  console.log('elemento con suggerimento:', JSON.stringify(pos));
  await shell.mouse.move(5, 5);
  await shell.mouse.move(pos.x, pos.y);
  await shell.waitForTimeout(1500);
  const b = await bordiTip(app);
  console.log('riquadro corto:', JSON.stringify(b));
  expect(b, 'il riquadro esiste').toBeTruthy();
  expect(b.width, 'un suggerimento corto non occupa il tetto').toBeLessThan(300);
  expect(b.height, 'una riga sola').toBeLessThan(40);
});
