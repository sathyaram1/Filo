// Verifica #430 giro 2, rilievo 2: la carta già aperta su una scheda non cambia quando arriva una foto nuova
// di quella scheda; bisogna uscire e rientrare.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { pagina, schede, idDi, carta, verde } from './giro2-carta.mjs';

test('carta tenuta aperta su una scheda di dietro che finisce di caricare: la foto compare', async ({ app, shell, openTab, testServer }) => {
  const server = createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina('#10b010', 'Lenta'));
    }, 2500);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const lenta = `http://localhost:${server.address().port}/lenta`;
  try {
    const uA = testServer.html(pagina('#1030d0', 'Blu', `<a id="vai" href="${lenta}">vai</a>`));
    const pA = await openTab(uA);
    await pA.click('#vai', { modifiers: ['Control'] });
    let d = null;
    await expect.poll(async () => { d = (await schede(app)).tutte.find((t) => /localhost/.test(t.url))?.id; return !!d; }, { timeout: 5000 }).toBe(true);
    await shell.mouse.move(600, 500);
    await shell.waitForTimeout(900);
    // Sul bordo sinistro: la scheda si stringe quando «Nuova scheda» diventa «Lenta», e il centro finirebbe sul «+».
    await shell.locator(`.tab[data-id="${d}"]`).hover({ position: { x: 12, y: 16 } });
    await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
    await expect.poll(async () => (await schede(app)).tutte.find((t) => t.id === d)?.foto, { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => verde((await carta(app)).colore), { timeout: 3000 }).toBe(true);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test('carta tenuta aperta mentre arriva la seconda foto della sua scheda: la carta si aggiorna', async ({ app, shell, openTab, testServer }) => {
  const dietro = testServer.html(`<!doctype html><title>Feed</title><style>html,body{margin:0;height:100%;background:#fff}</style>
<p>Caricamento…</p><script>addEventListener('load',()=>setTimeout(()=>{document.body.style.background='#10b010';document.documentElement.style.background='#10b010';},1200));</script>`);
  const uA = testServer.html(pagina('#1030d0', 'Blu', `<a id="vai" href="${dietro}">vai</a>`));
  const pA = await openTab(uA);
  await shell.mouse.move(600, 500);
  await pA.click('#vai', { modifiers: ['Control'] });
  const d = await idDi(app, (t) => t.url === dietro);
  await expect.poll(async () => (await schede(app)).tutte.find((x) => x.id === d).foto, { timeout: 10_000 }).toBe(true);
  await shell.locator(`.tab[data-id="${d}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  await shell.waitForTimeout(6000);
  await expect.poll(async () => verde((await carta(app)).colore), { timeout: 2000 }).toBe(true);
});
