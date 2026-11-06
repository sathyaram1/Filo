// Verifica #1985, giro 1, rilievo 3: un clic su un link che scarica un file lascia la pagina dov'è; a scaricamento
// finito i link a schermo devono riprendere a precaricarsi.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function sito() {
  const richieste = [];
  const server = createServer((req, res) => {
    richieste.push({ url: req.url, prefetch: /prefetch/.test(req.headers['sec-purpose'] || '') });
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    if (req.url === '/report') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="report.txt"' });
      res.end('ciao');
      return;
    }
    const sotto = Array.from({ length: 10 }, (_, i) => `<a style="display:block;height:18px" href="/giu/${i}">giu ${i}</a>`).join('');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0"><a id="scarica" href="/report">Scarica il resoconto</a>
      <div style="height:3000px"></div><div id="sotto">${sotto}</div></body>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    giu: () => richieste.filter((r) => r.prefetch && r.url.startsWith('/giu/')).length,
    chiudi: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}

test('r3 dopo il clic su un link che scarica un file, i link a schermo riprendono', async ({ openTab }) => {
  const s = await sito();
  try {
    const page = await openTab(`${s.origin}/pagina`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.waitForTimeout(2000);
    await page.click('#scarica');
    await page.waitForTimeout(3000);
    expect(page.url()).toBe(`${s.origin}/pagina`);
    await page.locator('#sotto').scrollIntoViewIfNeeded();
    await expect.poll(s.giu, { timeout: 20_000, intervals: [500] }).toBeGreaterThan(0);
  } finally { await s.chiudi(); }
});

// Lo stesso senza il clic: i link in fondo partono allo scorrimento. Dice che il rosso sopra viene dal clic.
test('senza il clic sullo scaricamento i link in fondo partono allo scorrimento', async ({ openTab }) => {
  const s = await sito();
  try {
    const page = await openTab(`${s.origin}/pagina`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.waitForTimeout(5000);
    await page.locator('#sotto').scrollIntoViewIfNeeded();
    await expect.poll(s.giu, { timeout: 20_000, intervals: [500] }).toBeGreaterThan(0);
  } finally { await s.chiudi(); }
});
