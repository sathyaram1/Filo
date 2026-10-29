// #1340, giro 4, rilievo 2: un incolla che non parte da un tasto visto dalla pagina (Incolla del menu dell'app, la
// strada di Cmd+V su Mac) dà al sito il tempo di selezionare tutto nel suo ascolto di paste: l'incolla cancella il testo.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, scrivi } from '../../helpers/riquadri.mjs';

const pagina = (script) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif"><p>Un sito</p><script>${script}</script></body></html>`;
const incollaDalMenu = (app, page) => app.evaluate(({ webContents }, u) => {
  webContents.getAllWebContents().find((w) => w.getURL() === u).paste();
}, page.url());

test('r2 Aiuto: Incolla del menu dell\'app col sito che seleziona tutto nel suo ascolto di paste', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina(`
    window.arma = () => document.addEventListener('paste', () => {
      const t = document.querySelector('.sn-sidebar-input textarea');
      t.setSelectionRange(0, t.value.length);
    }, true);`));
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const ta = page.locator('.sn-sidebar-input textarea');
  await expect(ta).toBeVisible({ timeout: 8_000 });
  await ta.click();
  await page.keyboard.insertText('dove si cambia la password ');
  await page.evaluate(() => window.arma());
  await app.evaluate(({ clipboard }) => clipboard.writeText('del conto'));
  await incollaDalMenu(app, page);
  await page.waitForTimeout(500);
  await expect(ta).toHaveValue('dove si cambia la password del conto');
});

test('r2 feedback: Incolla del menu dell\'app col sito che seleziona tutto nel suo ascolto di paste', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina(`
    window.arma = () => document.addEventListener('paste', () => document.execCommand('selectAll'), true);`));
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await scrivi(app, page, '.sn-fb-text', 'Il tasto indietro non va ');
  await page.evaluate(() => window.arma());
  await app.evaluate(({ clipboard }) => clipboard.writeText('su questo sito'));
  await incollaDalMenu(app, page);
  await page.waitForTimeout(500);
  expect((await statoDi(app, page, '.sn-fb-text'))?.valore).toBe('Il tasto indietro non va su questo sito');
});
