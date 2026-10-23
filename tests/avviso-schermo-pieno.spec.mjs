// #1526 — una pagina che a un clic si prende lo schermo pieno copre tutto, schede comprese: Filo lo dice con una
// pillola fuori dal documento della pagina, col sito vero e l'Esc. Regole: patterns/un-avviso-su-una-pagina-non-sta-dentro-la-pagina.md
//
// Il clic è un input vero (sendInputEvent): è il gesto con cui una pagina ottiene lo schermo, e passa dal gestore dei
// permessi che legge chi lo chiede. L'Esc va al webContents che ha il fuoco, come la tastiera vera.

import { test, expect } from './fixtures/electron.mjs';
import { captureCompositeElectron } from './agent/driver.mjs';

const CHIEDE = "document.getElementById('vai').addEventListener('click', () => document.documentElement.requestFullscreen().catch(() => {}));";
const PAGINA = `<html><body style="margin:0;background:#16324f;color:#fff;font:16px sans-serif">
<button id="vai" style="position:fixed;left:40px;top:40px;width:240px;height:90px">Guarda a schermo intero</button>
<p style="position:fixed;left:40px;top:160px">Un video qualunque</p>
<script>${CHIEDE}
window.__giu = []; document.addEventListener('mousedown', (e) => window.__giu.push([e.clientX, e.clientY]), true);</script>
</body></html>`;
const RIQUADRO = `<html><body style="margin:0;background:#2a6"><button id="vai" style="position:fixed;left:0;top:0;width:300px;height:200px">Video</button>
<script>${CHIEDE}</script></body></html>`;

function stato(app) {
  return app.evaluate(async ({ BrowserWindow, webContents }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    const sp = tm.schermoPieno;
    const vista = sp.vista && !sp.vista.webContents.isDestroyed() ? sp.vista : null;
    const b = vista ? vista.getBounds() : { x: 0, y: 0, width: 0, height: 0 };
    const figli = win.contentView.children || [];
    const visibile = !!(vista && b.width > 0 && b.height > 0);
    let testo = '';
    if (visibile) {
      try { testo = await vista.webContents.executeJavaScript('(document.getElementById("pillola") || {}).textContent || ""'); } catch (_) {}
    }
    const fuoco = webContents.getFocusedWebContents();
    return {
      contentFullscreen: tm.contentFullscreen,
      pageFullscreen: tm.pageFullscreen,
      visibile,
      bounds: b,
      scheda: tab ? tab.view.getBounds() : null,
      sopraLaScheda: !!(vista && tab && figli.indexOf(vista) > figli.indexOf(tab.view)),
      testo,
      fuocoAllaPillola: !!(vista && fuoco === vista.webContents),
    };
  });
}

// Un clic vero sulla scheda davanti, in coordinate della scheda.
function clicca(app, x, y) {
  return app.evaluate(({ BrowserWindow }, [px, py]) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    try { wc.focus(); } catch (_) {}
    wc.sendInputEvent({ type: 'mouseMove', x: px, y: py });
    wc.sendInputEvent({ type: 'mouseDown', x: px, y: py, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'left', clickCount: 1 });
  }, [x, y]);
}

function muovi(app, x, y) {
  return app.evaluate(({ BrowserWindow }, [px, py]) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    tm.tabs.find((t) => t.id === tm.activeId).view.webContents.sendInputEvent({ type: 'mouseMove', x: px, y: py });
  }, [x, y]);
}

const durata = (app, ms) => app.evaluate((_e, v) => globalThis.SN_STORAGE.updateSettings({ avvisoSchermoPieno: { durataMs: v } }), ms);
const visibile = async (app) => (await stato(app)).visibile;

async function aSchermoPieno(app) {
  await clicca(app, 120, 80);
  await expect.poll(async () => (await stato(app)).pageFullscreen, { timeout: 8000 }).toBe(true);
  await expect.poll(() => visibile(app), { timeout: 8000 }).toBe(true);
}

test('a un clic la pagina va a schermo pieno e Filo, fuori dal suo documento, dice chi è e come uscire', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await aSchermoPieno(app);
  const s = await stato(app);
  expect(s.testo).toBe('127.0.0.1 è a schermo intero · Esc per uscire');
  expect(s.sopraLaScheda, 'la pillola sta sopra la scheda, che non la copre').toBe(true);
  // In alto al centro, dentro la scheda che copre tutto, e grande quanto la pillola: il resto della pagina resta suo.
  expect(s.bounds.y).toBe(s.scheda.y);
  expect(Math.abs((s.bounds.x + s.bounds.width / 2) - (s.scheda.x + s.scheda.width / 2))).toBeLessThanOrEqual(1);
  expect(s.bounds.width).toBeLessThan(s.scheda.width / 2);
  expect(s.bounds.height).toBeLessThan(100);
  expect(s.fuocoAllaPillola, 'la pillola non prende la tastiera').toBe(false);
  const documento = await page.evaluate(() => `${document.documentElement.outerHTML}\n${document.body.innerText}`);
  expect(documento).not.toContain('per uscire');
  expect(documento).not.toContain('è a schermo intero');
  // Passati i 3 secondi di serie se ne va, e lo schermo resta pieno.
  await expect.poll(() => visibile(app), { timeout: 8000 }).toBe(false);
  expect((await stato(app)).contentFullscreen).toBe(true);
});

test('la pillola resta quanto dice la durata in Preferenze', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await durata(app, 1000);
  await aSchermoPieno(app);
  const dal = Date.now();
  await expect.poll(() => visibile(app), { timeout: 8000 }).toBe(false);
  const corta = Date.now() - dal;
  expect(corta, 'con un secondo va via prima dei tre di serie').toBeLessThan(2900);

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(false));
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);
  await durata(app, 7000);
  await aSchermoPieno(app);
  const dal2 = Date.now();
  await page.waitForTimeout(3600);
  expect(await visibile(app), 'con sette secondi c\'è ancora dopo i tre di serie').toBe(true);
  await expect.poll(() => visibile(app), { timeout: 12000 }).toBe(false);
  expect(Date.now() - dal2).toBeGreaterThan(corta + 2000);
});

test('un riquadro di un altro sito che chiede lo schermo: la pillola nomina lui e la pagina', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html(RIQUADRO, { pubblico: true });
  const page = await testServer.openReady(openTab, `<html><body style="margin:0"><iframe src="${dentro}" allowfullscreen style="position:fixed;left:40px;top:40px;width:300px;height:200px;border:0"></iframe></body></html>`);
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    const f = wc.mainFrame.framesInSubtree.find((x) => x.url.includes('sito-pubblico.test'));
    return f ? f.executeJavaScript('!!document.getElementById("vai")').catch(() => false) : false;
  }), { timeout: 8000 }).toBe(true);
  // Il riquadro di un altro sito vive in un processo suo: il clic gli arriva dal router dell'input, come quello vero.
  await page.frameLocator('iframe').locator('#vai').click();
  await expect.poll(() => visibile(app), { timeout: 8000 }).toBe(true);
  expect((await stato(app)).testo).toBe('sito-pubblico.test, dentro 127.0.0.1, è a schermo intero · Esc per uscire');
});

test('una scheda che la pagina apre con lo stesso clic sta a schermo pieno: la pillola nomina lei', async ({ app, openTab, testServer }) => {
  const altrove = testServer.html('<html><body style="margin:0;background:#400"><h1>Accedi al tuo conto</h1></body></html>', { pubblico: true });
  await testServer.openReady(openTab, `<html><body style="margin:0"><button id="vai" style="position:fixed;left:40px;top:40px;width:240px;height:90px">Video</button>
<script>document.getElementById('vai').addEventListener('click', () => { document.documentElement.requestFullscreen().catch(() => {}); window.open(${JSON.stringify(altrove)}, '_blank'); });</script></body></html>`);
  const prima = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activeId);
  await clicca(app, 120, 80);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { aperta: t.url.includes('sito-pubblico.test'), pieno: tm.contentFullscreen && tm.pageFullscreen };
  }), { timeout: 8000 }).toEqual({ aperta: true, pieno: true });
  await expect.poll(async () => (await stato(app)).testo, { timeout: 8000 }).toBe('sito-pubblico.test è a schermo intero · Esc per uscire');
  // Tornando sulla pagina che l'ha chiesto, la pillola nomina di nuovo lei.
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(id), prima);
  await expect.poll(async () => (await stato(app)).testo, { timeout: 8000 }).toBe('127.0.0.1 è a schermo intero · Esc per uscire');
});

test('con la pillola a schermo l\'Esc della tastiera arriva alla scheda e fa uscire', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await aSchermoPieno(app);
  const chi = await app.evaluate(({ BrowserWindow, webContents }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    const f = webContents.getFocusedWebContents();
    const pillola = tm.schermoPieno.vista && tm.schermoPieno.vista.webContents;
    const nome = f === tab.view.webContents ? 'scheda' : f && f === pillola ? 'pillola' : f ? 'altro' : 'nessuno';
    const dove = f || tab.view.webContents;
    dove.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    dove.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    return nome;
  });
  expect(chi).not.toBe('pillola');
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);
  expect(await visibile(app)).toBe(false);
});

test('lo schermo intero acceso da Filo non mostra la pillola; quello chiesto dopo dalla pagina sì', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.toggleContentFullscreen());
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(true);
  for (let i = 0; i < 6; i++) {
    expect(await visibile(app)).toBe(false);
    await new Promise((r) => setTimeout(r, 250));
  }
  await aSchermoPieno(app);
  expect((await stato(app)).testo).toContain('127.0.0.1');
});

test('col puntatore sul bordo alto la pillola ricompare; cambiando scheda va via e tornando c\'è', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  const prima = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activeId);
  await durata(app, 1000);
  await aSchermoPieno(app);
  await expect.poll(() => visibile(app), { timeout: 8000 }).toBe(false);
  await muovi(app, 300, 300);
  await new Promise((r) => setTimeout(r, 500));
  expect(await visibile(app), 'in mezzo alla pagina non torna').toBe(false);
  await muovi(app, 400, 0);
  await expect.poll(() => visibile(app), { timeout: 5000 }).toBe(true);

  await durata(app, 10000);
  await openTab('filo://editor/editor.html');
  await expect.poll(() => visibile(app), { timeout: 5000 }).toBe(false);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(id), prima);
  await expect.poll(() => visibile(app), { timeout: 5000 }).toBe(true);
  expect((await stato(app)).testo).toContain('127.0.0.1');
});

test('il clic accanto alla pillola va alla pagina; quello sulla pillola esce, e il tasto destro ha l\'uscita', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await durata(app, 10000);
  await aSchermoPieno(app);
  const s = await stato(app);
  // Il margine dell'ombra, nell'angolo della vista: il gesto torna alla pagina, nel punto sotto.
  const giuPrima = await page.evaluate(() => window.__giu.length);
  await app.evaluate(({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.schermoPieno.vista.webContents;
    v.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });
    v.sendInputEvent({ type: 'mouseDown', x: 2, y: 2, button: 'left', clickCount: 1 });
    v.sendInputEvent({ type: 'mouseUp', x: 2, y: 2, button: 'left', clickCount: 1 });
  });
  await expect.poll(() => page.evaluate(() => window.__giu.length), { timeout: 5000 }).toBe(giuPrima + 1);
  const [x, y] = await page.evaluate(() => window.__giu[window.__giu.length - 1]);
  expect(Math.abs(x - (s.bounds.x - s.scheda.x + 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(y - (s.bounds.y - s.scheda.y + 2))).toBeLessThanOrEqual(1);
  expect((await stato(app)).contentFullscreen).toBe(true);

  // Tasto destro sulla pillola: il menu di Filo, e «Esci dallo schermo intero» esce.
  const centro = { x: Math.round(s.bounds.width / 2), y: Math.round(s.bounds.height / 2) - 6 };
  await app.evaluate(({ BrowserWindow }, c) => {
    const v = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.schermoPieno.vista.webContents;
    v.sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y });
    v.sendInputEvent({ type: 'mouseDown', x: c.x, y: c.y, button: 'right', clickCount: 1 });
    v.sendInputEvent({ type: 'mouseUp', x: c.x, y: c.y, button: 'right', clickCount: 1 });
  }, centro);
  let menu = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      if (!w.url().startsWith('data:text/html')) continue;
      const t = await w.locator('.menu').innerText().catch(() => '');
      if (t.includes('Esci dallo schermo intero')) { menu = w; return true; }
    }
    return false;
  }, { timeout: 5000 }).toBe(true);
  await menu.getByText('Esci dallo schermo intero').click();
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);

  // Il clic sulla pillola fa lo stesso.
  await aSchermoPieno(app);
  const b = (await stato(app)).bounds;
  await app.evaluate(({ BrowserWindow }, c) => {
    const v = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.schermoPieno.vista.webContents;
    v.sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y });
    v.sendInputEvent({ type: 'mouseDown', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    v.sendInputEvent({ type: 'mouseUp', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  }, { x: Math.round(b.width / 2), y: Math.round(b.height / 2) - 6 });
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);
});

test('dal tasto destro della pillola si arriva alla durata in Preferenze, e lì si cambia', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await durata(app, 10000);
  await aSchermoPieno(app);
  const b = (await stato(app)).bounds;
  await app.evaluate(({ BrowserWindow }, c) => {
    const v = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.schermoPieno.vista.webContents;
    v.sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y });
    v.sendInputEvent({ type: 'mouseDown', x: c.x, y: c.y, button: 'right', clickCount: 1 });
    v.sendInputEvent({ type: 'mouseUp', x: c.x, y: c.y, button: 'right', clickCount: 1 });
  }, { x: Math.round(b.width / 2), y: Math.round(b.height / 2) - 6 });
  let menu = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      if (!w.url().startsWith('data:text/html')) continue;
      const t = await w.locator('.menu').innerText().catch(() => '');
      if (t.includes('Quanto resta questo avviso')) { menu = w; return true; }
    }
    return false;
  }, { timeout: 5000 }).toBe(true);
  await menu.getByText('Quanto resta questo avviso').click();
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);
  let prefs = null;
  await expect.poll(() => {
    prefs = app.windows().find((w) => w.url().startsWith('filo://preferences/preferences.html#sec-schermo-pieno')) || null;
    return !!prefs;
  }, { timeout: 8000 }).toBe(true);
  const campo = prefs.locator('#avvisoSchermoPienoDurata');
  await expect(campo).toBeVisible();
  await expect(campo).toHaveValue('10000');
  await campo.fill('4500');
  await campo.dispatchEvent('change');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).avvisoSchermoPieno), { timeout: 5000 })
    .toEqual({ durataMs: 4500 });
  // Fuori dai limiti il campo torna dentro, a vista, e si salva il valore in uso.
  await campo.fill('50000');
  await campo.dispatchEvent('change');
  await campo.blur();
  await expect(campo).toHaveValue('10000');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).avvisoSchermoPieno), { timeout: 5000 })
    .toEqual({ durataMs: 10000 });
  await prefs.screenshot({ path: 'tests/.shots/1526-preferenze-schermo-intero.png' }).catch(() => {});
});

test('la pillola nel tema chiaro e scuro', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await durata(app, 10000);
  for (const tema of ['light', 'dark']) {
    await app.evaluate((_e, t) => globalThis.SN_STORAGE.updateSettings({ theme: t }), tema);
    await aSchermoPieno(app);
    await new Promise((r) => setTimeout(r, 400));
    await captureCompositeElectron(app, `tests/.shots/1526-schermo-pieno-${tema === 'dark' ? 'scuro' : 'chiaro'}.png`);
    const colori = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs
      .schermoPieno.vista.webContents.executeJavaScript('[document.documentElement.dataset.snTheme, getComputedStyle(document.getElementById("pillola")).color]'));
    expect(colori[0]).toBe(tema);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(false));
    await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);
  }
});
