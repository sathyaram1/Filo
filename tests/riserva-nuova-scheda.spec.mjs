// #1128 — una scheda nuova sempre pronta: ogni finestra tiene una home già caricata e nascosta, e Ctrl+T (o il «+»,
// o la chiusura dell'ultima scheda) la consegna come scheda nuova e ne prepara subito un'altra.
//
// Ogni prova rifà un criterio del feedback: dopo l'avvio la riserva c'è ed è caricata ma non conta fra le schede;
// Ctrl+T mostra la home già disegnata in un attimo e la riserva si ricrea; una carta o un tema cambiati prima si vedono
// nella scheda nuova; in incognito la riserva sta nella partizione della finestra; quello che la home fa solo davanti
// agli occhi (i popup dell'avvio) aspetta la consegna.

import { execFileSync } from 'node:child_process';
import { test, expect } from './fixtures/electron.mjs';

test.use({ riservaNuovaScheda: true });

// La riserva della finestra normale (o incognito), vista dal main; null finché non c'è.
function riservaDi(app, { incognito = false } = {}) {
  return app.evaluate(({ BrowserWindow, session }, inc) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === inc);
    const tm = w && w._filoTabs;
    const r = tm && tm.riserva;
    const wc = r && r.webContents();
    if (!wc) return null;
    const ses = tm.partition ? session.fromPartition(tm.partition) : session.defaultSession;
    return {
      wcId: wc.id, id: r.id, url: wc.getURL(), caricando: wc.isLoading(),
      visibile: r.vista.getVisible(), sessioneGiusta: wc.session === ses,
    };
  }, incognito);
}

async function aspettaRiserva(app, { incognito = false, diversaDa = null } = {}) {
  let r = null;
  await expect.poll(async () => {
    r = await riservaDi(app, { incognito });
    return !!(r && r.url === 'filo://newtab/' && !r.caricando && r.wcId !== diversaDa);
  }, { timeout: 20_000, message: 'la riserva non è pronta' }).toBe(true);
  return r;
}

// La Page di Playwright della vista `wcId`: il main le scrive un segno, e la si cerca per quello.
async function paginaDi(app, wcId) {
  await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript(`window.__filoVista = ${id}; true`), wcId);
  let trovata = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try { if (await w.evaluate(() => window.__filoVista || 0) === wcId) { trovata = w; return true; } } catch (_) {}
    }
    return false;
  }, { timeout: 10_000, message: `nessuna pagina per la vista ${wcId}` }).toBe(true);
  return trovata;
}

function schede(app, { incognito = false } = {}) {
  return app.evaluate(({ BrowserWindow }, inc) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === inc)._filoTabs;
    const attiva = tm.tabs.find((t) => t.id === tm.activeId);
    return {
      n: tm.tabs.length,
      sessione: tm.sessionState().tabs,
      attiva: attiva && { id: attiva.id, wcId: attiva.view.webContents.id, titolo: attiva.title, caricando: attiva.loading, icona: attiva.favicon },
      icone: tm.tabs.map((t) => t.favicon),
    };
  }, incognito);
}

// In una scheda `document.hidden` non cambia mai: davanti agli occhi lo dice il main.
const inVista = (page) => page.evaluate(() => new Promise((ok) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.TAB_IN_VISTA_GET }, (r) => ok(r && r.inVista))));

// Ctrl+T dalla barra; la pagina segna quando il main l'ha messa davanti e quante carte aveva già in quel momento.
async function ctrlT(shell, page) {
  await page.evaluate(() => {
    window.__comparsa = null;
    chrome.runtime.onMessage.addListener((m) => {
      if (!m || m.type !== window.SN_MSG.MSG.TAB_IN_VISTA || !m.inVista || window.__comparsa) return;
      window.__comparsa = { alle: Date.now(), carte: document.querySelectorAll('#tieni .dash-carta').length, pronta: document.readyState };
    });
  });
  const t0 = Date.now();
  await shell.keyboard.press('Control+t');
  let comparsa = null;
  await expect.poll(async () => { comparsa = await page.evaluate(() => window.__comparsa); return !!comparsa; }, { timeout: 5_000 }).toBe(true);
  return { t0, ms: comparsa.alle - t0, carte: comparsa.carte, pronta: comparsa.pronta };
}

// Quanto passa da `t0` al primo fotogramma della scheda davanti con la home disegnata (non un fondo uniforme).
function primoDisegno(app, t0) {
  return app.evaluate(async ({ BrowserWindow }, inizio) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    const fine = Date.now() + 5000;
    while (Date.now() < fine) {
      const t = tm.tabs.find((x) => x.id === tm.activeId);
      try {
        const img = await t.view.webContents.capturePage();
        if (!img.isEmpty()) {
          const buf = img.toBitmap();
          const primo = buf.readUInt32LE(0);
          let diversi = 0;
          for (let k = 0; k < buf.length; k += 4 * 97) if (buf.readUInt32LE(k) !== primo) diversi++;
          if (diversi > 200) return Date.now() - inizio;
        }
      } catch (_) {}
      await new Promise((ok) => setTimeout(ok, 15));
    }
    return null;
  }, t0);
}

test('dopo l\'avvio una home caricata aspetta nascosta, fuori da schede, barra e sessione', async ({ app, shell }) => {
  const r = await aspettaRiserva(app);
  expect(r.visibile).toBe(false);
  const page = await paginaDi(app, r.wcId);
  expect(await inVista(page)).toBe(false);
  await expect(page.locator('#tieni .dash-carta').first()).toBeAttached();

  const s = await schede(app);
  expect(s.n).toBe(1);
  expect(s.sessione).toHaveLength(1);
  expect(s.attiva.wcId).not.toBe(r.wcId);
  await expect.poll(() => shell.evaluate(() => document.querySelectorAll('#tabs .tab').length)).toBe(1);
  expect((await shell.evaluate(() => window.filoShell.tabs.snapshot())).tabs).toHaveLength(1);
  const salvata = await app.evaluate(async () => {
    const chiave = globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS;
    for (let i = 0; i < 30; i++) {
      const v = await globalThis.SN_STORAGE.getRaw(chiave, null);
      if (v && Array.isArray(v.tabs)) return v.tabs;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    return null;
  });
  expect(salvata).toEqual(['filo://newtab/']);
});

test('Ctrl+T mostra subito la home già disegnata, e la riserva si ricrea', async ({ app, shell }) => {
  const prima = await aspettaRiserva(app);
  const page = await paginaDi(app, prima.wcId);
  const icona = (await schede(app)).attiva.icona;

  const { t0, ms, carte, pronta } = await ctrlT(shell, page);
  const disegnata = await primoDisegno(app, t0);
  expect(pronta).toBe('complete');
  expect(carte, 'le carte c\'erano già quando la scheda è arrivata davanti').toBeGreaterThan(0);
  // Senza la riserva la stessa misura dava 400-850 ms in cloud, e il primo fotogramma era una home ancora a metà.
  expect(ms, 'dal tasto alla scheda davanti').toBeLessThan(500);
  expect(disegnata, 'dal tasto alla home disegnata').not.toBeNull();
  expect(disegnata, 'dal tasto alla home disegnata').toBeLessThan(800);

  const s = await schede(app);
  expect(s.n).toBe(2);
  expect(s.attiva.wcId).toBe(prima.wcId);
  expect(s.attiva.id).toBe(prima.id);
  expect(s.attiva.caricando).toBe(false);
  expect(s.attiva.titolo).toBe('Filo — Nuova scheda');
  await expect.poll(async () => (await schede(app)).attiva.icona, { message: 'l\'icona della home nella barra' }).toBe(icona);
  await expect.poll(() => shell.evaluate(() => document.querySelectorAll('#tabs .tab').length)).toBe(2);
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('input');
  await page.screenshot({ path: 'tests/.shots/riserva-nuova-scheda-consegnata.png' });

  const dopo = await aspettaRiserva(app, { diversaDa: prima.wcId });
  expect(dopo.id).not.toBe(prima.id);
  expect((await schede(app)).n).toBe(2);
});

test('il «+» della barra e la chiusura dell\'ultima scheda usano la home pronta', async ({ app, shell }) => {
  let r = await aspettaRiserva(app);
  const id = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/').then((x) => x && x.id));
  expect(id).toBe(r.id);
  expect((await schede(app)).attiva.wcId).toBe(r.wcId);

  r = await aspettaRiserva(app, { diversaDa: r.wcId });
  const tutte = (await shell.evaluate(() => window.filoShell.tabs.snapshot())).tabs.map((t) => t.id);
  for (const t of tutte) await shell.evaluate((x) => window.filoShell.tabs.close(x), t);
  await expect.poll(async () => (await schede(app)).attiva?.wcId).toBe(r.wcId);
  expect((await schede(app)).n).toBe(1);
});

test('una carta tolta e il tema cambiati prima del Ctrl+T si vedono nella scheda nuova', async ({ app, shell }) => {
  const r = await aspettaRiserva(app);
  const s = await schede(app);
  const home = await paginaDi(app, s.attiva.wcId);
  const riserva = await paginaDi(app, r.wcId);
  await expect(riserva.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(1);

  await home.locator('#tieni .dash-carta[data-tipo="mazzi"]').click({ button: 'right' });
  await home.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli dalla home' }).click();
  await expect(home.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);

  const temaPrima = await riserva.evaluate(() => document.documentElement.dataset.snTheme);
  const tema = temaPrima === 'dark' ? 'light' : 'dark';
  await home.evaluate((t) => new Promise((ok) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } }, ok)), tema);

  await ctrlT(shell, riserva);
  expect((await schede(app)).attiva.wcId).toBe(r.wcId);
  await expect(riserva.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
  await expect(riserva.locator('#altro .dash-altro-app[data-id="mazzi"][data-tolta="1"]')).toBeAttached();
  expect(await riserva.evaluate(() => document.documentElement.dataset.snTheme)).toBe(tema);
});

test('in incognito la riserva sta nella partizione della finestra e non scrive sul disco', async ({ app, shell }) => {
  const normale = await aspettaRiserva(app);
  await shell.evaluate(() => window.filoShell.openIncognito());
  const inc = await aspettaRiserva(app, { incognito: true });
  expect(inc.sessioneGiusta).toBe(true);
  expect(inc.wcId).not.toBe(normale.wcId);

  const pagina = await paginaDi(app, inc.wcId);
  await pagina.evaluate(() => chrome.storage.local.set({ prova_riserva_1128: 'incognito' }));
  const suDisco = await app.evaluate(async () => (await chrome.storage.local.get('prova_riserva_1128')).prova_riserva_1128 ?? null);
  expect(suDisco).toBeNull();
  expect(await pagina.evaluate(async () => (await chrome.storage.local.get('prova_riserva_1128')).prova_riserva_1128)).toBe('incognito');
});

test('i popup dell\'avvio aspettano che la home pronta arrivi davanti', async ({ app, shell }) => {
  const r = await aspettaRiserva(app);
  const page = await paginaDi(app, r.wcId);
  const stato = () => page.evaluate(() => Promise.race([
    window.__filoDashActions.ricompenseAvvio().then(() => 'chieste'),
    new Promise((ok) => setTimeout(() => ok('in attesa'), 1200)),
  ]));
  expect(await stato()).toBe('in attesa');
  await ctrlT(shell, page);
  await expect.poll(stato, { timeout: 10_000 }).toBe('chieste');
});

test('due Ctrl+T di fila aprono due home intere, e una riserva morta rinasce', async ({ app, shell }) => {
  const r = await aspettaRiserva(app);
  await shell.keyboard.press('Control+t');
  await shell.keyboard.press('Control+t');
  await expect.poll(async () => (await schede(app)).n).toBe(3);
  const ids = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.tabs.map((t) => t.view.webContents.id));
  expect(ids).toContain(r.wcId);
  for (const id of ids.slice(1)) {
    const p = await paginaDi(app, id);
    await expect(p.locator('#tieni .dash-carta').first()).toBeAttached({ timeout: 10_000 });
  }

  const viva = await aspettaRiserva(app, { diversaDa: r.wcId });
  await app.evaluate(({ webContents }, id) => process.kill(webContents.fromId(id).getOSProcessId(), 'SIGKILL'), viva.wcId);
  const rinata = await aspettaRiserva(app, { diversaDa: viva.wcId });
  expect(rinata.wcId).not.toBe(viva.wcId);
  expect((await schede(app)).n).toBe(3);
});

// Dove va un tasto vero lo dice il fuoco del main (con tasti veri le lettere finivano nella home nascosta).
function fuoco(app) {
  return app.evaluate(({ BrowserWindow, webContents }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tm = w && w._filoTabs;
    const attiva = tm && tm.tabs.find((t) => t.id === tm.activeId);
    const f = webContents.getFocusedWebContents();
    return { attiva: attiva ? attiva.view.webContents.id : null, fuoco: f ? f.id : null };
  });
}

async function finestraDavanti(app) {
  await expect.poll(async () => (await fuoco(app)).attiva, { message: 'la prima scheda' }).not.toBeNull();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito); w.show(); w.focus(); });
}

// La tastiera, se se ne va, se ne va al caricamento della riserva: si guarda dopo un attimo che è pronta.
async function tastieraDopoLaRiserva(app, opts) {
  await aspettaRiserva(app, opts);
  await new Promise((ok) => setTimeout(ok, 1500));
  return fuoco(app);
}

test('la home pronta non si prende mai la tastiera: all\'avvio, dopo Ctrl+T, sopra una pagina web', async ({ app, shell, openTab, testServer }) => {
  await finestraDavanti(app);
  let f = await tastieraDopoLaRiserva(app);
  expect(f.fuoco, 'dopo l\'avvio i tasti (Ctrl+T compreso) arrivano alla scheda davanti').toBe(f.attiva);

  const prima = await riservaDi(app);
  await shell.keyboard.press('Control+t');
  await expect.poll(async () => (await fuoco(app)).attiva).toBe(prima.wcId);
  f = await tastieraDopoLaRiserva(app, { diversaDa: prima.wcId });
  expect(f.fuoco, 'quello che scrivo dopo Ctrl+T va nella home che vedo').toBe(prima.wcId);

  const page = await testServer.openReady(openTab, '<title>pagina</title><input id="q">');
  await page.click('#q');
  const viva = await riservaDi(app);
  await app.evaluate(({ webContents }, id) => process.kill(webContents.fromId(id).getOSProcessId(), 'SIGKILL'), viva.wcId);
  f = await tastieraDopoLaRiserva(app, { diversaDa: viva.wcId });
  expect(f.fuoco, 'quando la riserva rinasce, la pagina tiene la tastiera').toBe(f.attiva);
  expect(await page.title()).toBe('pagina');
});

test('alla consegna la home ha già la misura della scheda: la casella per scrivere non salta', async ({ app }) => {
  const r = await aspettaRiserva(app);
  const out = await app.evaluate(async ({ BrowserWindow, webContents }, id) => {
    const tm = BrowserWindow.getAllWindows().find((v) => v._filoTabs && !v._filoIncognito)._filoTabs;
    const wc = webContents.fromId(id);
    const misura = 'JSON.stringify({h: innerHeight, w: innerWidth, y: Math.round(document.getElementById("input").getBoundingClientRect().y)})';
    const prima = JSON.parse(await wc.executeJavaScript(misura));
    tm.openTab('filo://newtab/');
    await new Promise((ok) => setTimeout(ok, 500));
    return { prima, dopo: JSON.parse(await wc.executeJavaScript(misura)) };
  }, r.wcId);
  expect(out.dopo).toEqual(out.prima);
});

// Con tasti e clic veri (xdotool su X11): Ctrl+T dal menu e il clic sul «+» lasciano il fuoco alla barra, e la home
// pronta, già carica, non se lo prende da sola come una che si carica. Altrove si salta.
let xdotool = false;
try { execFileSync('xdotool', ['version'], { stdio: 'ignore' }); xdotool = process.platform === 'linux' && !!process.env.DISPLAY; } catch (_) {}
const xdo = (...a) => execFileSync('xdotool', a.map(String));

async function valoreCasella(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((v) => v._filoTabs && !v._filoIncognito)._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { n: tm.tabs.length, v: await t.view.webContents.executeJavaScript('document.getElementById("input")?.value ?? null').catch(() => null) };
  });
}

async function finestraASchermo(app) {
  await finestraDavanti(app);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito); w.setPosition(0, 0); w.show(); w.focus(); });
  await tastieraDopoLaRiserva(app);
}

async function scrivoNellaNuova(app) {
  await expect.poll(async () => (await valoreCasella(app)).n).toBe(2);
  await new Promise((ok) => setTimeout(ok, 500));
  xdo('type', '--delay', 30, 'ciao');
  await expect.poll(async () => (await valoreCasella(app)).v, { timeout: 5_000, message: 'quello che scrivo va nella casella della home nuova' }).toBe('ciao');
}

test('con tasti veri, Ctrl+T e poi scrivo: le lettere vanno nella home nuova', async ({ app }) => {
  test.skip(!xdotool, 'serve xdotool su X11');
  await finestraASchermo(app);
  xdo('key', 'ctrl+t');
  await scrivoNellaNuova(app);
});

test('con un clic vero sul «+» e poi scrivo: le lettere vanno nella home nuova', async ({ app, shell }) => {
  test.skip(!xdotool, 'serve xdotool su X11');
  await finestraASchermo(app);
  const p = await shell.evaluate(() => { const r = document.getElementById('tab-new').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const o = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((v) => v._filoTabs && !v._filoIncognito).getContentBounds());
  xdo('mousemove', Math.round(o.x + p.x), Math.round(o.y + p.y));
  xdo('click', 1);
  await scrivoNellaNuova(app);
});
