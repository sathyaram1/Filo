// Esplorazione del giro 2 (da cancellare): quali finestre data: esistono aprendo il menu App, e l'Editor c'è?
import { test, expect } from '../../fixtures/electron.mjs';

test('esplora menu App', async ({ app, shell }) => {
  const elenco = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).map((w) => ({
    id: w.id, url: w.webContents.getURL().slice(0, 60), visibile: w.isVisible(), tabs: !!w._filoTabs,
  })));
  console.log('PRIMA', JSON.stringify(await elenco()));
  await shell.evaluate(() => document.getElementById('nav-apps')?.click());
  const t0 = Date.now();
  let righe = [];
  while (Date.now() - t0 < 8000) {
    righe = [];
    for (const w of app.windows()) {
      let u = ''; try { u = w.url(); } catch (_) { continue; }
      if (!u.startsWith('data:text/html')) continue;
      righe.push({ u: u.slice(0, 40), items: await w.locator('.item').allTextContents().catch((e) => String(e).slice(0, 80)) });
    }
    if (righe.some((r) => Array.isArray(r.items) && r.items.some((x) => /Editor/.test(x)))) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log('DOPO', Date.now() - t0, JSON.stringify(righe), JSON.stringify(await elenco()));
  expect(righe.some((r) => Array.isArray(r.items) && r.items.some((x) => /Editor/.test(x)))).toBe(true);
});
