// Verifica #482 giro 1, rilievo 1: un file o un data: che Chromium rifiuta a una pagina web dopo un clic vero
// dell'utente, ma non da un collegamento cliccato (pulsante che naviga da script, window.open, collegamento data:).
import { test, expect } from '../../fixtures/electron.mjs';

// La pila della shell è il modello degli avvisi: senza avvisi la vista sopra la pagina non nasce nemmeno.
const nelModello = (shell, testo) => shell.evaluate((t) => [...document.querySelectorAll('#shell-notifs > .shell-notif')]
  .filter((c) => c.dataset.closing !== '1' && c.textContent.includes(t)).length, testo);

const PAGINA = `<title>Intranet</title>
  <button id="b1" style="display:block;width:300px;height:40px" onclick="location.href='file:///C:/Dati/script.pdf'">apri</button>
  <button id="b2" style="display:block;width:300px;height:40px" onclick="window.open('file:///C:/Dati/finestra.pdf')">apri a parte</button>
  <a id="d" href="data:text/html,ciao" style="display:block;width:300px;height:40px">dati</a>`;

test('r1 un pulsante della pagina che porta a un file, cliccato dall\'utente, lo dice', async ({ shell, openTab, testServer }) => {
  const page = await openTab(testServer.html(PAGINA));
  await page.waitForTimeout(600);
  await page.locator('#b1').click();
  await expect.poll(() => nelModello(shell, 'bloccat'), { timeout: 8000 }).toBe(1);
  expect(await nelModello(shell, 'script.pdf')).toBe(1);
});

test('r1 un pulsante che apre un file in una finestra a parte, cliccato dall\'utente, lo dice', async ({ shell, openTab, testServer }) => {
  const page = await openTab(testServer.html(PAGINA));
  await page.waitForTimeout(600);
  await page.locator('#b2').click();
  await expect.poll(() => nelModello(shell, 'bloccat'), { timeout: 8000 }).toBe(1);
  expect(await nelModello(shell, 'finestra.pdf')).toBe(1);
});

test('r1 un collegamento data: cliccato dall\'utente lo dice', async ({ shell, openTab, testServer }) => {
  const page = await openTab(testServer.html(PAGINA));
  await page.waitForTimeout(600);
  await page.locator('#d').click();
  await expect.poll(() => nelModello(shell, 'bloccat'), { timeout: 8000 }).toBe(1);
  expect(await nelModello(shell, 'data:')).toBe(1);
});
