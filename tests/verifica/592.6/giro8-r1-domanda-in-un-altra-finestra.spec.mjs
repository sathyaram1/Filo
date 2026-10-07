// Verifica #592.6 — giro 8, rilievo 1. Una domanda di Filo rimasta aperta in un'altra finestra di Filo nasconde
// le finestrelle di accesso aperte nella finestra in cui l'utente lavora: «Accedi con Google» non apre niente.

import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo } from '../../helpers/confirm.mjs';

test.setTimeout(90_000);

test('r1 una domanda aperta in un’altra finestra non nasconde il popup di accesso aperto qui', async ({ app, shell, openTab, testServer }) => {
  const accesso = testServer.html('<title>Accedi</title><p>Accedi con il tuo account</p>');
  const page = await testServer.openReady(openTab, '<h1>Negozio</h1><button id="g">Accedi con Google</button>');
  // L'altra finestra di Filo, con una domanda aperta sopra la sua scheda (qui: Svuota cronologia, chiesta e lasciata lì).
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return !!(w && w._filoTabs && w._filoTabs.tabs.length);
  }), { timeout: 15_000 }).toBe(true);
  const altrove = testServer.html('<h1>Altra pagina</h1>', { pubblico: true });
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    w._filoTabs.openTab(u);
  }, altrove);
  await expect.poll(() => nelMondoDiFilo(app, 'sito-pubblico.test', 'typeof SN_CONFIRM_UI').catch(() => ''), { timeout: 15_000 }).toBe('object');
  await nelMondoDiFilo(app, 'sito-pubblico.test', `(() => { SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Svuoto la cronologia degli appunti?' }); return 1; })()`);
  await confermaSopraPagina(app);
  // L'utente torna alla finestra di prima e preme «Accedi con Google».
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).focus(); });
  await page.evaluate((u) => { window.open(`${u}?client_id=a&redirect_uri=b`, 'g', 'popup,width=440,height=500'); }, accesso);
  const finestre = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter((w) => !w._filoTabs && /^https?:/.test(w.webContents.getURL()))
    .map((w) => w.isVisible()));
  await expect.poll(finestre, { timeout: 10_000 }).toHaveLength(1);
  await new Promise((r) => setTimeout(r, 1500));
  expect(await finestre(), 'il popup di accesso aperto in questa finestra si vede').toEqual([true]);
});
