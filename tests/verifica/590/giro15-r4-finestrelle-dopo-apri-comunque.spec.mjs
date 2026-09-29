// Giro 15, rilievo 4 (#590): il sì di «Apri comunque» su una scheda vale anche per le finestrelle che nascono da lei.
import { test, expect, lista, schede, testiNotifiche } from './helpers/rete15.mjs';

const finestrelle = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .filter((w) => !w._filoTabs && w.isVisible()).map((w) => w.webContents.getURL()));

async function sitoApertoComunque(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.openBlockedPopup(u, true), url);
  await expect.poll(() => app.windows().some((w) => w.url() === url), { timeout: 8000 }).toBe(true);
  return app.windows().find((w) => w.url() === url);
}

test('la finestrella di accesso del sito aperto con «Apri comunque» si apre e mostra il sito, non resta vuota', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const accesso = rete.pagina('blocked.test', '/oauth/authorize', '<h1 id="ok">ACCESSO DEL SITO</h1>') + '?client_id=a&response_type=code';
  const login = rete.rimbalzo('blocked.test', '/login', accesso);
  const sito = rete.pagina('blocked.test', '/', `<h1>SITO</h1>
    <button id="diretta" onclick="window.open('${accesso}', 'a1', 'width=500,height=400')">accedi</button>
    <button id="rimbalzo" onclick="window.open('${login}', 'a2', 'width=500,height=400')">accedi</button>`);
  const tab = await sitoApertoComunque(app, shell, sito);

  await tab.click('#diretta');
  await expect.poll(() => finestrelle(app), { timeout: 6000 }).toEqual([accesso]);

  await tab.click('#rimbalzo');
  await expect.poll(() => finestrelle(app), { timeout: 6000 }).toEqual([accesso, accesso]);
});

test('«Apri» sulla chip dei popup, dentro il sito aperto con «Apri comunque», apre il popup di quel sito', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const pop = rete.pagina('blocked.test', '/pop', '<h1>POPUP DEL SITO</h1>');
  const sito = rete.pagina('blocked.test', '/', `<h1>SITO</h1><button id="b" onclick="window.open('${pop}', 'p', 'width=400,height=300')">pop</button>`);
  const tab = await sitoApertoComunque(app, shell, sito);
  const notifiche = await testiNotifiche(app);
  await tab.click('#b');
  const chip = shell.locator('.popup-chip').first();
  await expect(chip).toBeVisible({ timeout: 6000 });
  await chip.locator('button', { hasText: 'Apri' }).click();
  await expect.poll(async () => (await schede(app)).includes(pop), { timeout: 6000 }).toBe(true);
  expect((await notifiche()).filter((t) => /Sito bloccato/.test(t))).toEqual([]);
});
