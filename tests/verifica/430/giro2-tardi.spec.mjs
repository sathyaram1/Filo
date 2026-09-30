// Verifica #430 giro 2 — esplorazione: pagine aperte dietro il cui contenuto arriva tardi, e la carta tenuta
// aperta su una scheda che sta ancora caricando.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { pagina, schede, idDi, carta, verde } from './giro2-carta.mjs';

test('pagina aperta dietro che si riempie cinque secondi dopo il caricamento', async ({ app, shell, openTab, testServer }) => {
  const dietro = testServer.html(`<!doctype html><title>Posta</title><style>html,body{margin:0;height:100%;background:#fff}</style>
<p>Caricamento…</p><script>addEventListener('load',()=>setTimeout(()=>{document.body.style.background='#10b010';document.documentElement.style.background='#10b010';},5000));</script>`);
  const uA = testServer.html(pagina('#1030d0', 'Blu', `<a id="vai" href="${dietro}">vai</a>`));
  const pA = await openTab(uA);
  await pA.click('#vai', { modifiers: ['Control'] });
  const d = await idDi(app, (t) => t.url === dietro);
  await shell.waitForTimeout(10_000);
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(900);
  await shell.locator(`.tab[data-id="${d}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  const c = await carta(app);
  console.log('CINQUE SECONDI', JSON.stringify(c.colore));
  expect(verde(c.colore)).toBe(true);
});

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
    await expect.poll(async () => { d = (await schede(app)).tutte.find((t) => t.url === lenta || /localhost/.test(t.url))?.id; return !!d; }, { timeout: 5000 }).toBe(true);
    await shell.mouse.move(600, 500);
    await shell.waitForTimeout(900);
    await shell.locator(`.tab[data-id="${d}"]`).hover();
    await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
    console.log('SUBITO', JSON.stringify((await carta(app)).colore));
    await shell.waitForTimeout(6000);
    const c = await carta(app);
    console.log('DOPO', JSON.stringify(c.colore), c.titolo, JSON.stringify((await schede(app)).tutte.find((t) => t.id === d)));
    expect(verde(c.colore)).toBe(true);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});
