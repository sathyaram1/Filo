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

// Quanto spazio resta fra il tasto Invio e la pila: negativo se la pila lo copre, troppo se il campo si è stretto più del dovuto.
async function scarto(app, page) {
  const m = await misure(app, page);
  return m.pila ? Math.round(m.pila.x - m.destraTasto) : null;
}

// Sotto gli 840px il minimo del contenuto del campo vinceva sul margine: a 720, la larghezza minima, il tasto spariva tutto.
for (const W of [800, 720]) {
  test(`home ${W}px: anche nella finestra stretta l'avviso lungo lascia scoperto il tasto Invio`, async ({ app, shell, avvisi }) => {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(w, 640), W);
    const page = await home(app);
    await shell.evaluate((t) => window.filoNotify(t, { durationSec: 0 }), LUNGO);
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
    await expect.poll(() => scarto(app, page), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
    // Il campo vuoto e stretto tiene il segnaposto su una riga: niente scorrimento.
    await expect.poll(() => page.locator('#input').evaluate((t) => t.scrollHeight - t.clientHeight), { timeout: 3000 }).toBeLessThanOrEqual(1);
  });
}

test('home 900px con tre avvisi: il campo vuoto non va a capo col segnaposto e non scorre', async ({ app, shell, avvisi }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(900, 700));
  const page = await home(app);
  const prima = await page.locator('#input').evaluate((t) => t.clientWidth);
  await shell.evaluate(() => {
    window.filoNotify('Il catalogo è pronto: 14 pagine, 3 offerte nuove', { durationSec: 0 });
    window.filoNotify('Secondo avviso piuttosto lungo che va su due righe, per allargare la pila', { durationSec: 0 });
    window.filoNotify('Il portachiavi di sistema non risponde: l’accesso vale fino alla chiusura di Filo', { durationSec: 0, actions: [{ label: 'Capito', onClick() {} }] });
  });
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(3);
  await expect.poll(() => page.locator('#input').evaluate((t) => t.clientWidth), { timeout: 5000 }).toBeLessThan(prima);
  await expect.poll(() => scarto(app, page), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
  await expect.poll(() => page.locator('#input').evaluate((t) => t.scrollHeight - t.clientHeight), { timeout: 3000 }).toBeLessThanOrEqual(1);
});

// La larghezza della pila passa da due conversioni (zoom della scheda nel main, dimensione del testo nel foglio): con una
// sbagliata il campo si stringe troppo o troppo poco. Al 125%, a larghezze dove il campo deve stringersi, solo quanto basta
// (la dimensione del testo non cambia le soglie della griglia, lo zoom della scheda sì: le larghezze sono diverse).
for (const [modo, W] of [['zoom della scheda', 1100], ['dimensione del testo', 960]]) {
  test(`home ${W}px al 125% (${modo}): il tasto Invio sta subito a sinistra della pila`, async ({ app, shell, avvisi }) => {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setContentSize(w, 760), W);
    const page = await home(app);
    if (modo === 'zoom della scheda') {
      await app.evaluate(({ BrowserWindow }) => {
        const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
        tm.tabs.find((t) => t.id === tm.activeId).view.webContents.setZoomFactor(1.25);
      });
    } else {
      // Quello che fa la pagina quando l'utente sceglie il testo più grande nelle Preferenze.
      await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; document.documentElement.style.setProperty('--sn-zoom', '1.25'); });
    }
    await page.waitForTimeout(300);
    const largoPrima = await page.locator('#inputForm').evaluate((f) => f.getBoundingClientRect().width);
    await shell.evaluate((t) => window.filoNotify(t, { durationSec: 0 }), LUNGO);
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
    await expect.poll(() => page.locator('#inputForm').evaluate((f) => f.getBoundingClientRect().width), { timeout: 5000 }).toBeLessThan(largoPrima);
    // Fra il tasto e la pila ci sono il margine della carta e il bordo del campo: più di 40px vuol dire stretto troppo.
    await expect.poll(() => scarto(app, page), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
    expect(await scarto(app, page)).toBeLessThanOrEqual(40);
  });
}
