// Verifica #430 giro 1, rilievo 2: ogni ridisegno della barra delle schede fa ripartire l'attesa della prima
// carta, così con una scheda che aggiorna il titolo spesso la carta non compare.
import { test, expect } from '../../fixtures/electron.mjs';
import { pagina, schede, idDi, carta } from './giro1-carta.mjs';

test('con una scheda che aggiorna il titolo più volte al secondo la carta compare lo stesso', async ({ app, shell, openTab, testServer }) => {
  const uT = testServer.html(pagina('#e0e010', 'Caricamento', `<script>let n=0;setInterval(()=>{document.title='Caricamento '+(++n)+'%'},150)</script>`));
  await openTab(uT);
  const uA = testServer.html(pagina('#d01010', 'Rossa'));
  await openTab(uA);
  const a = await idDi(app, (t) => t.url === uA);
  const uB = testServer.html(pagina('#1030d0', 'Blu'));
  await openTab(uB);
  await idDi(app, (t) => t.url === uB);
  await expect.poll(async () => (await schede(app)).tutte.find((x) => x.id === a).foto, { timeout: 10_000 }).toBe(true);
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(900);
  await shell.locator(`.tab[data-id="${a}"]`).hover();
  await expect.poll(async () => { const c = await carta(app); return c.visibile && c.mostrata && c.titolo === 'Rossa'; }, { timeout: 2000 }).toBe(true);
});
