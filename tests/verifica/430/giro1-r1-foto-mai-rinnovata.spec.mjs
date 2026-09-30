// Verifica #430 giro 1, rilievo 1: la foto di una scheda che sta dietro si prende una volta e non si rinnova
// quando la pagina cambia da sola (contenuto arrivato dopo il caricamento, pagina che passa a un'altra).
import { test, expect } from '../../fixtures/electron.mjs';
import { pagina, schede, idDi, carta, verde } from './giro1-carta.mjs';

test('pagina aperta dietro che si riempie dopo il caricamento: la carta mostra il contenuto arrivato', async ({ app, shell, openTab, testServer }) => {
  const dietro = testServer.html(`<!doctype html><title>Tarda</title><style>html,body{margin:0;height:100%;background:#fff}</style>
<script>addEventListener('load',()=>setTimeout(()=>{document.body.style.background='#10b010';document.documentElement.style.background='#10b010';},1200));</script><body></body>`);
  const uA = testServer.html(pagina('#1030d0', 'Blu', `<a id="vai" href="${dietro}" style="font:30px sans-serif">vai</a>`));
  const pA = await openTab(uA);
  await pA.click('#vai', { modifiers: ['Control'] });
  const d = await idDi(app, (t) => t.url === dietro);
  await expect.poll(async () => (await schede(app)).tutte.find((x) => x.id === d).foto, { timeout: 15_000 }).toBe(true);
  await shell.waitForTimeout(4000);
  await shell.locator(`.tab[data-id="${d}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  await expect.poll(async () => verde((await carta(app)).colore), { timeout: 2000 }).toBe(true);
});

test('scheda aperta dietro che passa da sola a un\'altra pagina: la foto è della pagina nuova, come il titolo', async ({ app, shell, openTab, testServer }) => {
  const finale = testServer.html(pagina('#10b010', 'Articolo finale'));
  const ponte = testServer.html(`<!doctype html><title>Apertura…</title><style>html,body{margin:0;height:100%;background:#fff}</style>
<p>Apertura in corso…</p><script>addEventListener('load',()=>setTimeout(()=>location.replace(${JSON.stringify(finale)}),900));</script>`);
  const uA = testServer.html(pagina('#1030d0', 'Blu', `<a id="vai" href="${ponte}" style="font:30px sans-serif">vai</a>`));
  const pA = await openTab(uA);
  await pA.click('#vai', { modifiers: ['Control'] });
  const d = await idDi(app, (t) => t.url === finale);
  await shell.waitForTimeout(4000);
  await shell.locator(`.tab[data-id="${d}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  expect((await carta(app)).titolo).toBe('Articolo finale');
  await expect.poll(async () => verde((await carta(app)).colore), { timeout: 2000 }).toBe(true);
});
