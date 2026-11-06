// #1985 giro 3, r2: i link che fanno un'azione diversa dall'uscita non si precaricano, né a pagina ferma né al passaggio.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const AZIONI = [
  ['/account/disattiva', 'Disattiva account'],
  ['/ordini/5/annulla', 'Annulla ordine'],
  ['/abbonamento/disdici', 'Disdici'],
  ['/newsletter/abbestellen', 'Abbestellen'],
  ['/nieuwsbrief/uitschrijven', 'Uitschrijven'],
  ['/utenti/mario/unfollow', 'Smetti di seguire'],
  ['/carrello/aggiungi/12', 'Aggiungi al carrello'],
  ['/messaggi/7/archive', 'Archivia'],
];

test('r2 aprire la pagina e passare sui link che fanno un\'azione non la fa', async ({ openTab }) => {
  const richieste = [];
  const server = createServer((req, res) => {
    richieste.push(decodeURIComponent(req.url));
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const link = AZIONI.map(([h, t], i) => `<a id="a${i}" style="display:block;height:20px" href="${h}">${t}</a>`).join('');
    res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0"><a style="display:block;height:20px" href="/area/profilo">Profilo</a>${link}</body>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const page = await openTab(`http://127.0.0.1:${server.address().port}/area`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    for (let i = 0; i < AZIONI.length; i++) { await page.hover(`#a${i}`); await page.waitForTimeout(300); }
    // Il profilo, a schermo e dello stesso sito, parte: i link d'azione restano fermi lo stesso.
    await expect.poll(() => richieste.includes('/area/profilo'), { timeout: 15_000 }).toBe(true);
    await page.waitForTimeout(3000);
    expect(richieste.filter((u) => AZIONI.some(([h]) => h === u))).toEqual([]);
  } finally { await new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }); }
});
