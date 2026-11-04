// #1551 — Nella home la pila degli avvisi della barra (una vista sopra la scheda, in basso a destra) non copre il
// tasto Invio: il campo si stringe a sinistra della pila finché c'è, e torna largo quando se ne va.

import { test, expect } from './fixtures/electron.mjs';

const LUNGO = 'Il catalogo è pronto: 14 pagine, 3 offerte nuove';

async function home(app) {
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 8_000 });
  return page;
}

// Il tasto Invio e la pila, nelle coordinate della finestra (DIP): quanto del tasto resta scoperto a sinistra della pila.
async function misure(app, page) {
  const tasto = await page.locator('#sendBtn').evaluate((b) => {
    const r = b.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const win = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    const v = tm.avvisi && tm.avvisi.vista;
    return {
      scheda: tab.view.getBounds(),
      zoom: tab.view.webContents.getZoomFactor(),
      pila: v && v.getVisible() ? v.getBounds() : null,
    };
  });
  const z = win.zoom || 1;
  const destraTasto = win.scheda.x + (tasto.x + tasto.w) * z;
  const bassoTasto = win.scheda.y + (tasto.y + tasto.h) * z;
  return { tasto, destraTasto, bassoTasto, pila: win.pila };
}

for (const [W, H] of [[1280, 840], [900, 700]]) {
  test(`home ${W}x${H}: un avviso lungo e una pila di tre lasciano scoperto il tasto Invio`, async ({ app, shell, avvisi }) => {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(w, h), [W, H]);
    const page = await home(app);
    const larghezzaPrima = await page.locator('#inputForm').evaluate((f) => f.getBoundingClientRect().width);

    // Un testo lungo già nel campo: stretto, il campo deve ricontare le righe invece di nasconderle sotto lo scorrimento.
    await page.locator('#input').fill('una domanda abbastanza lunga da occupare una riga intera del campo della home quando è stretto');

    await shell.evaluate((t) => window.filoNotify(t, { durationSec: 0 }), LUNGO);
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show')).toHaveCount(1);

    const scoperto = async () => {
      const m = await misure(app, page);
      if (!m.pila) return 'pila non a schermo';
      // Il tasto finisce a sinistra della pila (o sta tutto sopra di lei), e ha ancora la sua misura piena.
      const fuori = m.destraTasto <= m.pila.x + 1 || m.bassoTasto <= m.pila.y + 1;
      return fuori && Math.round(m.tasto.w) === 36 ? 'scoperto' : `coperto: tasto fino a x=${Math.round(m.destraTasto)}, pila da x=${m.pila.x}`;
    };
    await expect.poll(scoperto, { timeout: 5000 }).toBe('scoperto');

    // Il campo ha ricontato le righe: niente testo nascosto sotto lo scorrimento.
    await expect.poll(() => page.locator('#input').evaluate((t) => t.scrollHeight - t.clientHeight), { timeout: 3000 }).toBeLessThanOrEqual(1);

    // Due avvisi in più: la pila si allarga al più largo, e il tasto resta fuori.
    await shell.evaluate(() => {
      window.filoNotify('Scaricato: relazione-trimestrale-definitiva-con-allegati.pdf', { durationSec: 0 });
      window.filoNotify('Un altro avviso', { durationSec: 0 });
    });
    await expect(vista.locator('.shell-notif.show')).toHaveCount(3);
    await expect.poll(scoperto, { timeout: 5000 }).toBe('scoperto');

    // Chiusi gli avvisi, il campo torna largo com'era.
    for (let i = 0; i < 3; i++) await vista.locator('.shell-notif.show .shell-notif-close').first().click();
    await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
    await expect.poll(() => page.locator('#inputForm').evaluate((f) => Math.round(f.getBoundingClientRect().width)), { timeout: 3000 })
      .toBe(Math.round(larghezzaPrima));
  });
}
