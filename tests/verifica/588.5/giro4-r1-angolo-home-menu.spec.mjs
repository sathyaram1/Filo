// Verifica #588.5 giro 4, rilievo 1 — quello che Filo mette in fondo alla pagina e arriva nell'angolo in basso a
// destra (la riga per scrivere della Home, il menu del tasto destro) non deve finire sotto gli avvisi della barra.
import { test, expect } from '../../fixtures/electron.mjs';

const AZIONI = [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }];

async function geometria(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { v: tm.avvisi.vista.getBounds(), t: t.view.getBounds(), url: t.view.webContents.getURL() };
  });
}

// La carta della vista in coordinate della pagina.
async function cartaNellaPagina(app, vista) {
  const g = await geometria(app);
  const r = await vista.evaluate(() => {
    const b = document.querySelector('.shell-notif.show').getBoundingClientRect();
    return { x: b.left, y: b.top, r: b.right, b: b.bottom };
  });
  const dx = g.v.x - g.t.x;
  const dy = g.v.y - g.t.y;
  return { x: r.x + dx, y: r.y + dy, r: r.r + dx, b: r.b + dy };
}

const siToccano = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;

for (const [W, testo] of [
  [1280, 'Scaricato: Fattura_Energia_Elettrica_settembre_2026.pdf'],
  [960, 'Scaricato: report.pdf'],
]) {
  test(`Home larga ${W}: con «${testo}» a schermo il tasto di invio resta scoperto`, async ({ app, shell, avvisi }) => {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(w, 760), W);
    const home = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    expect(home, 'la Home non c’è').toBeTruthy();
    await home.locator('#sendBtn').waitFor();
    await shell.evaluate(({ t }) => window.filoNotify(t, { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }] }), { t: testo });
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
    await expect.poll(async () => (await geometria(app)).v.width).toBeGreaterThan(100);
    const invio = await home.evaluate(() => {
      const b = document.getElementById('sendBtn').getBoundingClientRect();
      return { x: b.left, y: b.top, r: b.right, b: b.bottom };
    });
    const carta = await cartaNellaPagina(app, vista);
    expect(siToccano(invio, carta), `invio ${JSON.stringify(invio)} sotto la carta ${JSON.stringify(carta)}`).toBe(false);
  });
}

test('tasto destro nella pagina accanto a un avviso: il menu di Filo non finisce sotto la carta', async ({ app, shell, openTab, testServer, avvisi }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(1280, 760));
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:100vh;font:20px sans-serif">
    <a id="link" href="https://example.com/articolo" style="position:fixed;bottom:40px;right:380px">un collegamento in basso</a></body></html>`);
  await shell.evaluate(() => window.filoNotify('Scaricato: documento-importante.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }] }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  const carta = await cartaNellaPagina(app, vista);
  const l = await page.locator('#link').boundingBox();
  // Clic destro all'estremità destra del collegamento, a sinistra della carta: dentro la pagina, fuori dalla vista.
  const punto = { x: Math.round(l.x + l.width - 4), y: Math.round(l.y + l.height / 2) };
  expect(punto.x).toBeLessThan(carta.x);
  const menu = page.locator('.sn-menu');
  let aperto = false;
  for (let i = 0; i < 6 && !aperto; i++) {
    await page.mouse.click(punto.x, punto.y, { button: 'right' });
    try { await menu.first().waitFor({ state: 'visible', timeout: 1500 }); aperto = true; } catch (_) { await page.waitForTimeout(200); }
  }
  expect(aperto, 'il menu del tasto destro non si apre').toBe(true);
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const b = document.querySelector('.sn-menu').getBoundingClientRect();
    return { x: b.left, y: b.top, r: b.right, b: b.bottom };
  });
  expect(siToccano(m, carta), `menu ${JSON.stringify(m)} sotto la carta ${JSON.stringify(carta)}`).toBe(false);
});
