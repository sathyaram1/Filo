// Esplorazione #592.17: la finestrella dell'altra finestra di Filo, tornata a schermo dopo un gesto di là.
import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo, aspettaConfermaPronta, mouseClickConfirm } from '../../helpers/confirm.mjs';

test.setTimeout(90_000);

async function dueFinestre(app, shell, openTab, testServer) {
  const page = await testServer.openReady(openTab, '<h1>Negozio</h1>');
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return !!(w && w._filoTabs && w._filoTabs.tabs.length);
  }), { timeout: 15_000 }).toBe(true);
  const u = testServer.html('<h1>Altra pagina</h1><div style="height:3000px"></div>', { pubblico: true });
  await app.evaluate(({ BrowserWindow }, u) => {
    BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs.openTab(u);
  }, u);
  const altrove = 'sito-pubblico.test';
  await expect.poll(() => nelMondoDiFilo(app, altrove, 'typeof SN_CONFIRM_UI').catch(() => ''), { timeout: 15_000 }).toBe('object');
  await app.evaluate(({ BrowserWindow }) => {
    const ws = BrowserWindow.getAllWindows().filter((x) => x._filoTabs);
    ws.forEach((w, i) => { w.setOpacity(1); w.show(); w.setBounds({ x: i * 820, y: 0, width: 800, height: 700 }); });
  });
  const pagina = app.windows().find((w) => { try { return new URL(w.url()).hostname === altrove; } catch (_) { return false; } });
  return { page, altrove, incognito: pagina };
}
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
const finestrelle = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .filter((w) => !w._filoTabs && /^https?:/.test(w.webContents.getURL()))
  .map((w) => w.isVisible()));
// Una rotella vera sulla pagina dell'altra finestra.
const rotellaDiLa = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
  const tm = w._filoTabs;
  const t = tm.tabs.find((x) => x.id === tm.activeId);
  t.view.webContents.sendInputEvent({ type: 'mouseWheel', x: 200, y: 200, deltaX: 0, deltaY: -120 });
});

for (const come of ['invio', 'clic']) {
  test(`esplora: dopo una rotella di là la finestrella torna sopra la domanda; un ${come} su OK di qua vale?`, async ({ app, shell, openTab, testServer }) => {
    const finto = testServer.html('<title>Filo</title><p>Filo chiede conferma. Filo vuole impostare: Tema → Scuro.</p>', { pubblico: true });
    const { page, incognito } = await dueFinestre(app, shell, openTab, testServer);
    const host = new URL(page.url()).hostname;
    await nelMondoDiFilo(app, host, `(() => { globalThis.__e = 'attesa'; SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Svuoto la cronologia degli appunti?' }).then((ok) => { globalThis.__e = ok; }); return 1; })()`);
    const vista = await confermaSopraPagina(app);
    const area = await areaDomanda(app);
    await incognito.mouse.click(5, 5);
    await vista.keyboard.press('Shift');
    const x = Math.round(area.x + area.width / 2 - 220);
    const y = Math.round(area.y + area.height / 2 - 50);
    await incognito.evaluate(({ u, x, y }) => { window.open(`${u}?client_id=a&redirect_uri=b`, 'g', `popup,left=${x},top=${y},width=440,height=100`); }, { u: finto, x, y });
    await expect.poll(() => finestrelle(app), { timeout: 10_000 }).toHaveLength(1);
    await expect.poll(() => finestrelle(app)).toEqual([false]);
    await aspettaConfermaPronta(vista);
    await new Promise((r) => setTimeout(r, 800));
    await rotellaDiLa(app);
    await new Promise((r) => setTimeout(r, 800));
    const dopoRotella = await finestrelle(app);
    console.log(come, 'dopo la rotella di là, finestrella visibile:', dopoRotella);
    if (come === 'invio') await vista.keyboard.press('Enter');
    else await mouseClickConfirm(vista, 'ok');
    await new Promise((r) => setTimeout(r, 1200));
    const e = await nelMondoDiFilo(app, host, 'globalThis.__e');
    console.log(come, 'esito della domanda:', e, 'finestrelle:', await finestrelle(app));
    expect(e, 'il sì dato con la finestrella finta sopra il testo non vale').toBe('attesa');
  });
}
