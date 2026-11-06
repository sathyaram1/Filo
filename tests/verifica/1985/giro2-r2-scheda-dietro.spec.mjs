// #1985 giro 2, r2: una scheda che sta dietro non ha link sullo schermo, e non li precarica.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test('r2 i link a schermo di una scheda rimasta dietro non si precaricano, e ripartono quando la si riporta davanti', async ({ app, shell, openTab }) => {
  const richieste = [];
  const server = createServer((req, res) => {
    richieste.push({ url: req.url, prefetch: /prefetch/.test(req.headers['sec-purpose'] || '') });
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    const m = /^\/(dietro|davanti)$/.exec(req.url);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (m) {
      const links = Array.from({ length: 10 }, (_, i) => `<a style="display:block;height:18px" href="/${m[1]}/${i}">link ${i}</a>`).join('');
      res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0">${links}</body>`);
      return;
    }
    res.end(`<!doctype html><h1>${req.url}</h1>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const dietro = () => richieste.filter((r) => r.prefetch && r.url.startsWith('/dietro/')).length;
  try {
    const page = await openTab(`${origin}/dietro`);
    await page.waitForLoadState('load');
    const idDietro = await shell.evaluate(async () => {
      const t = await window.filoShell.tabs.list?.();
      return Array.isArray(t) ? (t.find((x) => x.active) || {}).id : null;
    }).catch(() => null);
    await openTab(`${origin}/davanti`);
    const prima = dietro();
    await page.waitForTimeout(12_000);
    expect(dietro()).toBe(prima);
    if (idDietro != null) {
      await shell.evaluate((id) => window.filoShell.tabs.activate(id), idDietro);
      await expect.poll(dietro, { timeout: 20_000, intervals: [500] }).toBeGreaterThan(prima);
    }
  } finally { await new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }); }
});
