// Giro 9, rilievo 1 (#592.6): con la domanda a schermo in una finestra di Filo, una finestrella aperta dallo stesso
// sito da un'altra finestra di Filo si posa sopra il testo del popup e resta visibile.
import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo, confirmState } from '../../helpers/confirm.mjs';

test.setTimeout(90_000);

test('r1 una finestrella del sito aperta da un’altra finestra di Filo, posata sopra il popup, si nasconde finché la domanda è a schermo', async ({ app, shell, openTab, testServer }) => {
  const finto = testServer.html('<title>Filo</title><p style="font:16px sans-serif">Filo chiede conferma. Filo vuole impostare: Tema → Scuro.</p>');
  const page = await testServer.openReady(openTab, '<h1>Negozio</h1>');
  const host = new URL(page.url()).hostname;
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });

  // Lo stesso sito aperto anche in un'altra finestra di Filo.
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return !!(w && w._filoTabs && w._filoTabs.tabs.length);
  }), { timeout: 15_000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }, u) => {
    BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs.openTab(u);
  }, testServer.html('<h1>Negozio, altra finestra</h1>', { pubblico: true }));
  await expect.poll(() => nelMondoDiFilo(app, 'sito-pubblico.test', 'typeof SN_CONFIRM_UI').catch(() => ''), { timeout: 15_000 }).toBe('object');

  // La domanda nella prima finestra.
  await nelMondoDiFilo(app, host, `(() => { globalThis.__e = 'attesa'; SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Invio agli sviluppatori: testo vero' }).then((ok) => { globalThis.__e = ok; }); return 1; })()`);
  const sopra = await confermaSopraPagina(app);
  expect((await confirmState(sopra)).text).toContain('testo vero');

  // Dove sta il popup sullo schermo: al centro della scheda della prima finestra.
  const dove = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const c = w.getContentBounds();
    const v = w._filoTabs.conferme.vista.getBounds();
    return { x: Math.round(c.x + v.x + v.width / 2 - 220), y: Math.round(c.y + v.y + v.height / 2 - 60) };
  });

  // Dall'altra finestra il sito apre senza gesto una finestrella «di accesso» proprio lì.
  await app.evaluate(({ BrowserWindow }, { u, x, y }) => {
    const w = BrowserWindow.getAllWindows().find((z) => z._filoIncognito);
    const t = w._filoTabs.tabs.find((z) => z.view.webContents.getURL().includes('sito-pubblico.test'));
    return t.view.webContents.executeJavaScript(`window.open(${JSON.stringify(u + '?client_id=a&redirect_uri=b')}, 'f', 'popup,left=${x},top=${y},width=440,height=100'); 1`);
  }, { u: finto, ...dove });

  const finestrella = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter((w) => !w._filoTabs && /client_id=a/.test(w.webContents.getURL()))
    .map((w) => ({ visibile: w.isVisible(), b: w.getBounds() })));
  await expect.poll(async () => (await finestrella()).length, { timeout: 10_000 }).toBe(1);
  await new Promise((r) => setTimeout(r, 1500));
  const f = (await finestrella())[0];
  // Il testo finto è sopra il punto dove sta il testo del popup vero.
  expect(f.b.x).toBeLessThanOrEqual(dove.x + 5);
  expect(await nelMondoDiFilo(app, host, 'globalThis.__e')).toBe('attesa');
  expect(f.visibile, 'la finestrella del sito sopra il popup vero deve sparire finché la domanda è a schermo').toBe(false);
});
