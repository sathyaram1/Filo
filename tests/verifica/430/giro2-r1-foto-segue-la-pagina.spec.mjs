// Verifica #430 giro 2, rilievo 1: la foto di una scheda dietro si rinnova solo a momenti fissi (caricamento,
// tre secondi dopo, cambio di pagina intero): un contenuto arrivato più tardi o un cambio di pagina senza
// ricaricare non arriva mai alla carta.
import { test, expect } from '../../fixtures/electron.mjs';
import { pagina, schede, idDi, carta, verde } from './giro2-carta.mjs';

async function puntaDopo(app, shell, id) {
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(900);
  await shell.locator(`.tab[data-id="${id}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
}

test('pagina aperta dietro che si riempie cinque secondi dopo il caricamento: la carta mostra il contenuto', async ({ app, shell, openTab, testServer }) => {
  const dietro = testServer.html(`<!doctype html><title>Posta</title><style>html,body{margin:0;height:100%;background:#fff}</style>
<p>Caricamento…</p><script>addEventListener('load',()=>setTimeout(()=>{document.body.style.background='#10b010';document.documentElement.style.background='#10b010';},5000));</script>`);
  const uA = testServer.html(pagina('#1030d0', 'Blu', `<a id="vai" href="${dietro}">vai</a>`));
  const pA = await openTab(uA);
  await pA.click('#vai', { modifiers: ['Control'] });
  const d = await idDi(app, (t) => t.url === dietro);
  await shell.waitForTimeout(10_000);
  await puntaDopo(app, shell, d);
  await expect.poll(async () => verde((await carta(app)).colore), { timeout: 2000 }).toBe(true);
});

test('scheda dietro che passa a un\'altra pagina senza ricaricarsi (siti a pagina unica): foto nuova come il titolo', async ({ app, shell, openTab, testServer }) => {
  const dietro = testServer.html(`<!doctype html><title>Video 1</title><style>html,body{margin:0;height:100%;background:#d01010}</style>
<h1>Video 1</h1><script>addEventListener('load',()=>setTimeout(()=>{history.pushState({}, '', '?v=2');document.title='Video 2';document.body.style.background='#10b010';document.documentElement.style.background='#10b010';document.querySelector('h1').textContent='Video 2';},6000));</script>`);
  const uA = testServer.html(pagina('#1030d0', 'Blu', `<a id="vai" href="${dietro}">vai</a>`));
  const pA = await openTab(uA);
  await pA.click('#vai', { modifiers: ['Control'] });
  const d = await idDi(app, (t) => t.url === dietro);
  await expect.poll(async () => (await schede(app)).tutte.find((x) => x.id === d)?.title, { timeout: 15_000 }).toBe('Video 2');
  await shell.waitForTimeout(5000);
  await puntaDopo(app, shell, d);
  expect((await carta(app)).titolo).toBe('Video 2');
  await expect.poll(async () => verde((await carta(app)).colore), { timeout: 2000 }).toBe(true);
});
