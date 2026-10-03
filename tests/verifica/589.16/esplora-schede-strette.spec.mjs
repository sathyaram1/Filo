// Esplorazione: con molte schede strette, il centro del titolo di una scheda non attiva cade sul titolo o sulla croce?
import { test, expect } from '../../fixtures/electron.mjs';

async function scritte(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const out = { suggerimento: null, carta: null };
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed() || !w.isVisible()) continue;
      const url = w.webContents.getURL();
      const leggi = (js) => w.webContents.executeJavaScript(js).catch(() => null);
      if (url === 'filo://shell/anteprima.html') out.carta = await leggi("document.getElementById('titolo').textContent");
      else if (url.startsWith('data:')) out.suggerimento = await leggi("(document.getElementById('tip') || {}).textContent ?? null");
    }
    return out;
  });
}

test('schede strette: titolo, croce e ritorno', async ({ app, shell, openTab, testServer }) => {
  for (let i = 0; i < 16; i++) await openTab(testServer.html(`<title>Pagina numero ${i} con un titolo lungo</title>`));
  await expect(shell.locator('.tab')).toHaveCount(17, { timeout: 20_000 });
  await expect(shell.locator('.tab .spinner')).toHaveCount(0, { timeout: 20_000 });
  await new Promise((r) => setTimeout(r, 800));
  const geo = await shell.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => {
    const r = t.getBoundingClientRect();
    const kids = [...t.children].filter((c) => getComputedStyle(c).display !== 'none').map((c) => {
      const q = c.getBoundingClientRect(); return [c.className, Math.round(q.left - r.left), Math.round(q.width)];
    });
    return { active: t.classList.contains('active'), w: Math.round(r.width), kids };
  }));
  console.log('WIN', JSON.stringify(await shell.evaluate(() => [innerWidth, innerHeight])));
  console.log('GEO', JSON.stringify(geo.slice(0, 4)), JSON.stringify(geo.at(-1)));
  const risultati = [];
  for (const idx of [3, 8]) {
    const tab = shell.locator('.tab').nth(idx);
    await shell.mouse.move(2, 2);
    await new Promise((r) => setTimeout(r, 700));
    await tab.locator('.title').hover();
    const sotto = await shell.evaluate(() => { const b = document.querySelector('.tab:hover .title'); return !!b; });
    const titolo = await tab.locator('.title').textContent();
    await expect.poll(() => scritte(app), { timeout: 3000 }).toEqual({ carta: titolo, suggerimento: null });
    await tab.locator('.close').hover();
    await expect.poll(async () => (await scritte(app)).suggerimento, { timeout: 3000 }).toBe('Chiudi scheda');
    await new Promise((r) => setTimeout(r, 500));
    const conCroce = await scritte(app);
    await tab.locator('.title').hover();
    await expect.poll(() => scritte(app), { timeout: 3000 }).toEqual({ carta: titolo, suggerimento: null });
    risultati.push({ idx, sotto, conCroce });
  }
  console.log('RIS', JSON.stringify(risultati));
  // Tema scuro: la carta e il suggerimento restano leggibili (foto per controllo visivo).
  await shell.locator('.tab').nth(5).locator('.close').hover();
  await new Promise((r) => setTimeout(r, 600));
  await shell.screenshot({ path: 'tests/.shots/589-16-croce-stretta.png' });
});
