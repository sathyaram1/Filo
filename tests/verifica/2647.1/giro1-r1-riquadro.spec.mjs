// #2647.1 giro 1: dove lavora l'utente lo dice anche un clic dentro il riquadro di un altro sito (il tasto «Accedi
// con…» incorporato). Passato all'altra finestra con quel clic, l'accesso che apre sopra la domanda di qui resta a schermo.

import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo } from '../../helpers/confirm.mjs';

test.setTimeout(90_000);

const finestrelle = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .filter((w) => !w._filoTabs && /^https?:/.test(w.webContents.getURL()) && !/riquadro-accedi/.test(w.webContents.getURL()))
  .map((w) => w.isVisible()));

const areaDomanda = (app) => app.evaluate(({ BrowserWindow }) => {
  for (const w of BrowserWindow.getAllWindows()) {
    const v = w._filoTabs && w._filoTabs.conferme.vista;
    if (!v || !(v.getBounds().width > 0)) continue;
    const f = w.getContentBounds();
    const b = v.getBounds();
    return { x: f.x + b.x, y: f.y + b.y, width: b.width, height: b.height };
  }
  return null;
});

test('r1 il clic sul tasto «Accedi» incorporato da un altro sito porta l’utente nella sua finestra: l’accesso aperto sopra la domanda dell’altra resta', async ({ app, shell, openTab, testServer }) => {
  const accesso = testServer.html('<title>Accedi</title><p>Accedi con il tuo account</p>', { pubblico: true });
  const page = await testServer.openReady(openTab, '<h1>Negozio</h1>');
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return !!(w && w._filoTabs && w._filoTabs.tabs.length);
  }), { timeout: 15_000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }, u) => {
    BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs.openTab(u);
  }, testServer.html('<h1>Altra pagina</h1>', { pubblico: true }));
  const altrove = 'sito-pubblico.test';
  await expect.poll(() => nelMondoDiFilo(app, altrove, 'typeof SN_CONFIRM_UI').catch(() => ''), { timeout: 15_000 }).toBe('object');
  await app.evaluate(({ BrowserWindow }) => {
    const ws = BrowserWindow.getAllWindows().filter((x) => x._filoTabs);
    ws.forEach((w, i) => { w.setOpacity(1); w.show(); w.setBounds({ x: i * 820, y: 0, width: 800, height: 700 }); });
  });
  const incognito = app.windows().find((w) => { try { return new URL(w.url()).hostname === altrove; } catch (_) { return false; } });
  const host = new URL(page.url()).hostname;
  await nelMondoDiFilo(app, host, `(() => { SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Svuoto la cronologia degli appunti?' }); return 1; })()`);
  const vista = await confermaSopraPagina(app);
  const area = await areaDomanda(app);
  expect(area).toBeTruthy();
  // L'utente è sulla domanda.
  await vista.keyboard.press('ArrowDown');
  const x = Math.round(area.x + area.width / 2 - 220);
  const y = Math.round(area.y + area.height / 2 - 50);
  // Il tasto «Accedi» è il riquadro di un altro sito (qui 127.0.0.1 dentro sito-pubblico.test).
  const riquadro = testServer.html(`<title>riquadro-accedi</title><body style="margin:0"><button id="b" style="width:300px;height:200px">Accedi con…</button>
<script>document.getElementById('b').onclick = () => { window.open(${JSON.stringify(`${accesso}?client_id=a&redirect_uri=b`)}, 'g', 'popup,left=${x},top=${y},width=440,height=100'); };</script></body>`);
  await incognito.evaluate((u) => new Promise((r) => {
    const f = document.createElement('iframe');
    f.src = u;
    f.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:200px;border:0';
    f.onload = () => r(1);
    document.body.appendChild(f);
  }), riquadro);
  await new Promise((r) => setTimeout(r, 500));
  // Il primo e unico gesto dell'utente in questa finestra: il clic sul tasto incorporato.
  await incognito.mouse.click(100, 100);
  await expect.poll(() => finestrelle(app), { timeout: 10_000 }).toHaveLength(1);
  await new Promise((r) => setTimeout(r, 1500));
  expect(await finestrelle(app), 'l’accesso aperto dall’utente dove lavora adesso resta a schermo').toEqual([true]);
});
