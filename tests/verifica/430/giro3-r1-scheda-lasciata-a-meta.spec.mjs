// Verifica #430 giro 3, rilievo 1: la foto di una scheda lasciata si scatta quando la lasci, anche se la pagina
// non aveva finito di comparire, e non si rifà più: la carta mostra la pagina vuota anche a caricamento finito.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { pagina, schede, idDi, carta, verde } from './giro2-carta.mjs';

async function lasciaPerLaBlu(app, shell, blu) {
  await shell.locator(`.tab[data-id="${blu}"]`).click();
  await expect.poll(async () => (await schede(app)).attiva, { timeout: 5000 }).toBe(blu);
}

async function guardaLaCarta(app, shell, id) {
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(700);
  // Sul bordo sinistro: la scheda si stringe o si sposta quando cambia titolo.
  await shell.locator(`.tab[data-id="${id}"]`).hover({ position: { x: 12, y: 16 } });
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
}

test('una scheda lasciata mentre carica ancora, finita di caricare dietro: la carta mostra la pagina arrivata', async ({ app, shell, testServer }) => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.write('<!doctype html><title>Lenta</title><style>html,body{margin:0;height:100%;background:#fff}</style><p>…</p>' + ' '.repeat(4096));
    setTimeout(() => res.end('<style>html,body{background:#10b010 !important}</style><h1>Arrivata</h1>'), 2500);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const lenta = `http://localhost:${server.address().port}/lenta`;
  try {
    const bluUrl = testServer.html(pagina('#1030d0', 'Blu'));
    await shell.evaluate((u) => window.filoShell.tabs.open(u), bluUrl);
    const blu = await idDi(app, (t) => t.url === bluUrl);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), lenta);
    let l = null;
    await expect.poll(async () => { l = (await schede(app)).tutte.find((t) => /localhost/.test(t.url))?.id; return !!l; }, { timeout: 5000 }).toBe(true);
    await shell.waitForTimeout(1000);
    expect((await schede(app)).tutte.find((t) => t.id === l).loading).toBe(true);
    await lasciaPerLaBlu(app, shell, blu);
    await expect.poll(async () => (await schede(app)).tutte.find((t) => t.id === l).loading, { timeout: 8000 }).toBe(false);
    await shell.waitForTimeout(4000);
    await guardaLaCarta(app, shell, l);
    await expect.poll(async () => verde((await carta(app)).colore), { timeout: 3000 }).toBe(true);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test('una posta che si riempie dopo il caricamento, lasciata subito: la carta mostra il contenuto arrivato', async ({ app, shell, testServer }) => {
  const posta = testServer.html(`<!doctype html><title>Posta</title><style>html,body{margin:0;height:100%;background:#fff}</style>
<p>Caricamento…</p><script>addEventListener('load',()=>setTimeout(()=>{document.body.style.background='#10b010';document.documentElement.style.background='#10b010';},2000));</script>`);
  const bluUrl = testServer.html(pagina('#1030d0', 'Blu'));
  await shell.evaluate((u) => window.filoShell.tabs.open(u), bluUrl);
  const blu = await idDi(app, (t) => t.url === bluUrl);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), posta);
  const p = await idDi(app, (t) => t.url === posta);
  await shell.waitForTimeout(500);
  await lasciaPerLaBlu(app, shell, blu);
  await shell.waitForTimeout(6000);
  await guardaLaCarta(app, shell, p);
  await expect.poll(async () => verde((await carta(app)).colore), { timeout: 3000 }).toBe(true);
});
