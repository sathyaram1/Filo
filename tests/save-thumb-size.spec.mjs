// #839 — «Salva per dopo» dà lo stesso risultato dal menu e da Alt+S: miniatura
// piccola (JPEG ~320 px, sotto 60 KB), conferma cliccabile, scheda che si chiude.
// Le miniature grandi già salvate si rimpiccioliscono una volta, senza perdere
// voci, date o categorie; lo Screenshot resta a piena risoluzione.
//
// Senza il fix: dal menu la miniatura era la schermata intera in PNG (centinaia
// di KB), da Alt+S un PNG largo 320 e nessuna conferma; i dati vecchi restavano
// com'erano.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOGLIA = 60 * 1024;

// Pagina che in PNG pesa davvero: sfumatura su tutto lo schermo e colonne di testo.
const PAGINA_RICCA = (titolo) => `<!doctype html><html><head><title>${titolo}</title></head>
  <body style="margin:0;min-height:100vh;background:linear-gradient(135deg,#f6d365,#fda085 40%,#a1c4fd 70%,#c2e9fb)">
  <div style="columns:3;padding:24px;font:15px/1.5 Georgia,serif;color:#3a2a1a">${
  '<p>Filo mette da parte la pagina per dopo: titolo, indirizzo e una miniatura da riconoscere a colpo d’occhio nella griglia.</p>'.repeat(60)
}</div></body></html>`;

async function misuraSalvata(app, url) {
  return app.evaluate(async ({ nativeImage }, u) => {
    const pages = await globalThis.SN_SAVED_PAGES.list();
    const p = pages.find((x) => x.url === u);
    if (!p || !p.thumbnail) return null;
    const t = p.thumbnail;
    const { width, height } = nativeImage.createFromDataURL(t).getSize();
    return { id: p.id, mime: t.slice(5, t.indexOf(';')), width, height, bytes: Math.floor((t.length - t.indexOf(',') - 1) * 3 / 4) };
  }, url);
}

async function attendiMiniatura(app, url) {
  let m = null;
  await expect.poll(async () => { m = await misuraSalvata(app, url); return !!m; }, { timeout: 10000 }).toBe(true);
  return m;
}

function controllaPiccola(m, strada) {
  expect(m.mime, `${strada}: la miniatura dev'essere compressa`).toBe('image/jpeg');
  // Circa 320 px: con lo schermo scalato (125% sulla macchina dell'owner) la bitmap può uscire un poco più larga.
  expect(m.width, `${strada}: larghezza della miniatura`).toBeGreaterThanOrEqual(300);
  expect(m.width, `${strada}: larghezza della miniatura`).toBeLessThanOrEqual(420);
  expect(m.bytes, `${strada}: peso della miniatura (${m.bytes} byte)`).toBeLessThan(SOGLIA);
}

function dispatchAltS(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('save-for-later', win);
  });
}

async function attendiHome(app) {
  let home = null;
  await expect.poll(() => {
    home = app.windows().find((w) => { try { return w.url().startsWith('filo://home/home.html'); } catch (_) { return false; } });
    return !!home;
  }, { timeout: 8000 }).toBe(true);
  return home;
}

test('dal menu la miniatura salvata è piccola, e lo Screenshot resta a piena risoluzione', async ({ app, openTab, testServer }) => {
  const url = testServer.html(PAGINA_RICCA('Dal menu'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });

  await page.click('body', { button: 'right', position: { x: 400, y: 300 } });
  const btn = page.locator('.sn-menu [data-sn-icon-id="saveForLater"]');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });

  controllaPiccola(await attendiMiniatura(app, url), 'menu');

  // La stessa cattura che usa lo Screenshot del menu: piena risoluzione, PNG.
  const home = await openTab('filo://home/home.html');
  await home.waitForLoadState('domcontentloaded');
  const cap = await home.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.CAPTURE_VISIBLE_TAB });
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = r.dataUrl; });
    return { mime: r.dataUrl.slice(5, r.dataUrl.indexOf(';')), w: img.naturalWidth, vista: Math.floor(window.innerWidth * devicePixelRatio) };
  });
  expect(cap.mime).toBe('image/png');
  expect(cap.w).toBeGreaterThanOrEqual(cap.vista - 2);
  expect(cap.w).toBeGreaterThan(320);
});

test('Alt+S fa quello che fa il menu: conferma cliccabile, miniatura piccola, lista con la voce evidenziata', async ({ app, openTab, testServer }) => {
  const url = testServer.html(PAGINA_RICCA('Da Alt+S'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });

  await dispatchAltS(app);

  const pill = page.locator('.sn-save-confirm');
  await expect(pill).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.sn-save-confirm-cta')).toHaveCount(1);
  try { await page.screenshot({ path: 'tests/.shots/save-839-alts-conferma.png' }); } catch (_) {}

  // Un secondo Alt+S mentre la conferma è su non ne apre un'altra.
  await dispatchAltS(app);
  await page.waitForTimeout(400);
  await expect(pill).toHaveCount(1);

  const m = await attendiMiniatura(app, url);
  controllaPiccola(m, 'Alt+S');
  const quante = await app.evaluate(async (_e, u) => (await globalThis.SN_SAVED_PAGES.list()).filter((p) => p.url === u).length, url);
  expect(quante).toBe(1);

  const chiusa = page.waitForEvent('close', { timeout: 8000 });
  await pill.click();
  const home = await attendiHome(app);
  expect(home.url()).toContain(`highlight=${m.id}`);
  await home.waitForLoadState('domcontentloaded');
  const evidenziata = home.locator('.sn-card[data-highlighted="1"]');
  await expect(evidenziata).toHaveCount(1, { timeout: 8000 });
  await expect(evidenziata).toHaveAttribute('data-page-id', m.id);
  await chiusa;
});

test('Alt+S su un sito dove Filo è spento: stessa conferma cliccabile, miniatura piccola, scheda chiusa', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { blocklist: ['127.0.0.1'] } }));
  const url = testServer.html(PAGINA_RICCA('Sito escluso'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.waitForTimeout(500);

  await dispatchAltS(app);
  const pill = page.locator('.sn-save-confirm');
  await expect(pill, 'Alt+S su un sito escluso chiudeva la scheda senza conferma').toBeVisible({ timeout: 5000 });
  const m = await attendiMiniatura(app, url);
  controllaPiccola(m, 'Alt+S su sito escluso');

  const chiusa = page.waitForEvent('close', { timeout: 8000 });
  await pill.click();
  const home = await attendiHome(app);
  expect(home.url()).toContain(`highlight=${m.id}`);
  await chiusa;
});

test('Alt+S su una pagina che non risponde: salva, chiude, e la conferma compare sulla scheda che resta davanti', async ({ app, openTab, testServer }) => {
  const davanti = await testServer.openReady(openTab, PAGINA_RICCA('Resto davanti'), { pubblico: true });
  const url = testServer.html(PAGINA_RICCA('Bloccata'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });

  // Il filo della pagina resta occupato: né la pagina né Filo dentro di lei possono rispondere.
  await page.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 12000) { /* occupata */ } }, 50); });
  await page.waitForTimeout(200);
  await dispatchAltS(app);

  const pill = davanti.locator('.sn-save-confirm');
  await expect(pill, 'la conferma non è comparsa da nessuna parte').toBeVisible({ timeout: 12000 });
  const salvata = await app.evaluate(async (_e, u) => (await globalThis.SN_SAVED_PAGES.list()).find((p) => p.url === u) || null, url);
  expect(salvata, 'la pagina bloccata non è stata salvata').toBeTruthy();
  const aperta = (u) => app.evaluate(({ BrowserWindow }, x) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.some((t) => t.url === x), u);
  expect(await aperta(url), 'la scheda salvata doveva chiudersi').toBe(false);

  await pill.click();
  const home = await attendiHome(app);
  expect(home.url()).toContain(`highlight=${salvata.id}`);
  // La scheda che ha solo mostrato la conferma resta aperta.
  await davanti.waitForTimeout(500);
  expect(await aperta(davanti.url()), 'la conferma ha chiuso la scheda che la mostrava').toBe(true);
});

// La conferma di ripiego vale solo quando una pagina l'ha presa: la scheda nata al posto dell'ultima all'inizio non è pronta.
const schedeAperte = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.url));
const chiudiNuoveSchede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  for (const t of tm.tabs.filter((y) => y.url.startsWith('filo://newtab/'))) tm.closeTab(t.id);
});
async function conferme(app) {
  const dove = [];
  for (const w of app.windows()) {
    try { const n = await w.evaluate(() => document.querySelectorAll('.sn-save-confirm').length); for (let i = 0; i < n; i++) dove.push(w); } catch (_) {}
  }
  return dove;
}
// Pagina che resta in caricamento finché il test non la libera: uno script che non arriva.
async function serverLento(titolo) {
  const attese = [];
  const server = createServer((req, res) => {
    if (req.url.startsWith('/lento.js')) { attese.push(res); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>${titolo}</title></head><body style="background:#c2e9fb"><h1>${titolo}</h1><script src="/lento.js"></script></body></html>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://localhost:${server.address().port}/p`,
    libera: () => { for (const res of attese.splice(0)) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(''); } },
    chiudi: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); },
  };
}

test('Alt+S sull\'unica scheda, bloccata: la conferma compare nella nuova scheda che prende il suo posto e porta alla voce', async ({ app, openTab, testServer }) => {
  const url = testServer.html(PAGINA_RICCA('Unica bloccata'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await chiudiNuoveSchede(app);
  expect(await schedeAperte(app)).toEqual([url]);
  await page.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 10000) { /* occupata */ } }, 50); });
  await page.waitForTimeout(200);
  await dispatchAltS(app);

  await expect.poll(async () => (await conferme(app)).length, { timeout: 12000, message: 'salvata e chiusa senza nessuna conferma' }).toBe(1);
  const [dove] = await conferme(app);
  expect(dove.url()).toMatch(/^filo:\/\/newtab\//);
  const salvata = await app.evaluate(async (_e, u) => (await globalThis.SN_SAVED_PAGES.list()).find((p) => p.url === u) || null, url);
  expect(salvata).toBeTruthy();
  await dove.locator('.sn-save-confirm').click();
  const home = await attendiHome(app);
  expect(home.url()).toContain(`highlight=${salvata.id}`);
});

test('Alt+S sull\'unica scheda, ancora in caricamento: salva, chiude, e la conferma compare', async ({ app, shell }) => {
  const lenta = await serverLento('Unica lenta');
  try {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), lenta.url);
    await expect.poll(() => schedeAperte(app).then((s) => s.includes(lenta.url)), { timeout: 8000 }).toBe(true);
    await chiudiNuoveSchede(app);
    await new Promise((r) => setTimeout(r, 800));
    expect(await schedeAperte(app)).toEqual([lenta.url]);
    await dispatchAltS(app);
    await expect.poll(async () => (await conferme(app)).length, { timeout: 12000, message: 'salvata e chiusa senza nessuna conferma' }).toBe(1);
    expect(await app.evaluate(async (_e, u) => (await globalThis.SN_SAVED_PAGES.list()).some((p) => p.url === u), lenta.url)).toBe(true);
    expect(await schedeAperte(app)).not.toContain(lenta.url);
  } finally {
    await lenta.chiudi();
  }
});

test('la conferma di ripiego riprovata su una scheda che finisce di caricarsi dopo compare una volta sola', async ({ app, shell, openTab, testServer }) => {
  const lenta = await serverLento('Davanti lenta');
  try {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), lenta.url);
    await expect.poll(() => schedeAperte(app).then((s) => s.includes(lenta.url)), { timeout: 8000 }).toBe(true);
    const url = testServer.html(PAGINA_RICCA('Bloccata dietro'));
    const page = await openTab(url);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    await page.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 10000) { /* occupata */ } }, 50); });
    await page.waitForTimeout(200);
    await dispatchAltS(app);
    // La scheda davanti dopo la chiusura è quella lenta: le conferme riprovate le restano in coda finché non si carica.
    await expect.poll(() => schedeAperte(app).then((s) => s.includes(url)), { timeout: 12000 }).toBe(false);
    await new Promise((r) => setTimeout(r, 2500));
    lenta.libera();
    await expect.poll(async () => (await conferme(app)).length, { timeout: 8000 }).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 800));
    const tutte = await conferme(app);
    expect(tutte.length, 'una conferma per salvataggio').toBe(1);
    expect(new URL(tutte[0].url()).hostname).toBe('localhost');
  } finally {
    await lenta.chiudi();
  }
});

// PNG vero scritto a mano (niente Electron prima dell'avvio): rumore colorato, che in PNG pesa MB.
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function pngRumore(w, h) {
  const riga = w * 3 + 1;
  const raw = Buffer.alloc(riga * h);
  let s = 12345;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w * 3; x++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; raw[y * riga + 1 + x] = s >>> 24; }
  }
  const chunk = (tipo, dati) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(dati.length);
    const td = Buffer.concat([Buffer.from(tipo), dati]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}

test('le miniature grandi già salvate si rimpiccioliscono una volta, senza perdere voci, date o categorie', async () => {
  const profilo = cartellaTemporanea('filo-miniature-');
  const grande = pngRumore(1200, 750);
  const piccola = pngRumore(4, 4);
  const pagine = [
    { id: 'g1', url: 'https://a.example/articolo', title: 'Articolo', favicon: '', thumbnail: grande, savedAt: '2026-05-05T13:00:00.000Z', category: 'Da leggere', categoryId: 'c1', categoryConfidence: 0.8 },
    { id: 'p2', url: 'https://b.example/', title: 'Già piccola', favicon: '', thumbnail: piccola, savedAt: '2026-05-04T10:00:00.000Z', category: null, categoryConfidence: null },
    { id: 'n3', url: 'https://c.example/', title: 'Senza miniatura', favicon: '', thumbnail: '', savedAt: '2026-05-03T09:00:00.000Z', category: 'Da leggere', categoryId: 'c1', categoryConfidence: 0.5 },
  ];
  const categorie = [{ id: 'c1', name: 'Da leggere', createdAt: '2026-05-01T08:00:00.000Z', thumbnailUrl: grande }];
  writeFileSync(join(profilo, 'storage.json'), JSON.stringify({ savedPages: pagine, categories: categorie }), 'utf8');

  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: profilo, NODE_ENV: 'test' },
  });
  try {
    await primaFinestra(app);
    const leggi = () => app.evaluate(async ({ nativeImage }) => {
      const misura = (t) => {
        if (!t) return null;
        const { width, height } = nativeImage.createFromDataURL(t).getSize();
        return { mime: t.slice(5, t.indexOf(';')), width, height, bytes: Math.floor((t.length - t.indexOf(',') - 1) * 3 / 4) };
      };
      const pages = await globalThis.SN_STORAGE.getRaw('savedPages', []);
      const cats = await globalThis.SN_STORAGE.getRaw('categories', []);
      return {
        pages: pages.map((p) => ({ ...p, thumbnail: undefined, misura: misura(p.thumbnail), uguale: p.thumbnail })),
        cats: cats.map((c) => ({ ...c, thumbnailUrl: undefined, misura: misura(c.thumbnailUrl) })),
      };
    });

    let stato = null;
    await expect.poll(async () => { stato = await leggi(); return stato.pages[0].misura?.mime; }, { timeout: 20000 }).toBe('image/jpeg');

    expect(stato.pages.map((p) => p.id)).toEqual(['g1', 'p2', 'n3']);
    pagine.forEach((orig, i) => {
      for (const k of ['url', 'title', 'savedAt', 'category', 'categoryId', 'categoryConfidence']) {
        expect(stato.pages[i][k], `${orig.id}.${k}`).toEqual(orig[k]);
      }
    });
    controllaPiccola(stato.pages[0].misura, 'miniatura vecchia');
    expect(stato.pages[1].uguale, 'una miniatura già piccola resta com\'era').toBe(piccola);
    expect(stato.pages[2].uguale).toBe('');
    await expect.poll(async () => (await leggi()).cats[0].misura?.mime, { timeout: 10000 }).toBe('image/jpeg');
    stato = await leggi();
    expect(stato.cats[0]).toMatchObject({ id: 'c1', name: 'Da leggere', createdAt: '2026-05-01T08:00:00.000Z' });
    controllaPiccola(stato.cats[0].misura, 'miniatura della categoria');

    // Una volta sola: una seconda passata non trova più niente da rifare.
    const fatte = await app.evaluate(() => globalThis.SN_SAVED_PAGES.rimpicciolisciMiniature());
    expect(fatte).toBe(0);
    expect((await leggi()).pages[0].uguale).toBe(stato.pages[0].uguale);
  } finally {
    await chiudiApp(app);
    rmSync(profilo, { recursive: true, force: true });
  }
});

// Le conferme che nascono in una pagina durante `ms`, compresa quella già presente.
function contaComparse(pagina, ms) {
  return pagina.evaluate(async (durata) => {
    const viste = new Set();
    const guarda = () => { for (const p of document.querySelectorAll('.sn-save-confirm')) viste.add(p); };
    guarda();
    const mo = new MutationObserver(guarda);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    await new Promise((r) => setTimeout(r, durata));
    mo.disconnect();
    return viste.size;
  }, ms);
}
const occupa = (page) => page.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 10000) { /* occupata */ } }, 50); });

// Una pagina di Filo davanti mostra la conferma di ripiego e lo dice al main come una pagina web: una volta sola, non tre.
test('con una pagina di Filo davanti la conferma di ripiego compare una volta sola', async ({ app, openTab, testServer }) => {
  test.setTimeout(60000);
  const lista = await openTab('filo://home/home.html');
  await lista.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 }).catch(() => {});
  const url = testServer.html(PAGINA_RICCA('Bloccata, lista davanti'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await occupa(page);
  await page.waitForTimeout(200);
  await dispatchAltS(app);
  await expect.poll(() => schedeAperte(app).then((s) => s.includes(url)), { timeout: 12000 }).toBe(false);
  await lista.waitForSelector('.sn-save-confirm', { timeout: 12000 });
  expect(await contaComparse(lista, 11000), 'la conferma ricompariva sulla pagina di Filo finché il main smetteva di riprovare').toBe(1);
});

test('unica scheda bloccata: nella nuova scheda la conferma compare una volta sola', async ({ app, openTab, testServer }) => {
  test.setTimeout(60000);
  const url = testServer.html(PAGINA_RICCA('Unica, conferma una volta'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await chiudiNuoveSchede(app);
  await occupa(page);
  await page.waitForTimeout(200);
  await dispatchAltS(app);
  let nuova = null;
  await expect.poll(() => { nuova = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab/'); } catch (_) { return false; } }); return !!nuova; }, { timeout: 12000 }).toBe(true);
  await nuova.waitForSelector('.sn-save-confirm', { timeout: 12000 });
  expect(await contaComparse(nuova, 11000)).toBe(1);
});

// Dalla pagina d'errore di Filo si mette da parte il sito che non si è caricato, dal menu come da Alt+S.
test('Alt+S su una pagina che non si carica salva l\'indirizzo del sito, non quello della pagina d\'errore', async ({ app, shell }) => {
  const url = 'http://127.0.0.1:9/sito-giu';
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let errore = null;
  await expect.poll(() => { errore = app.windows().find((w) => { try { return w.url().startsWith('filo://error/'); } catch (_) { return false; } }); return !!errore; }, { timeout: 10000 }).toBe(true);
  await errore.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await dispatchAltS(app);
  await expect(errore.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });
  const salvate = await app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).map((p) => ({ url: p.url, favicon: p.favicon })));
  expect(salvate).toEqual([{ url, favicon: '' }]);
});

// Per tre secondi e mezzo una pagina che non risponde non mostra niente: chi preme di nuovo Alt+S non deve avere due conferme.
test('un secondo Alt+S su una pagina che non risponde non fa un secondo salvataggio con la sua conferma', async ({ app, openTab, testServer }) => {
  const davanti = await testServer.openReady(openTab, PAGINA_RICCA('Resto davanti'), { pubblico: true });
  const url = testServer.html(PAGINA_RICCA('Bloccata due volte'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 12000) { /* occupata */ } }, 50); });
  await page.waitForTimeout(200);
  await dispatchAltS(app);
  await page.waitForTimeout(1500);
  await dispatchAltS(app);

  await expect(davanti.locator('.sn-save-confirm').first()).toBeVisible({ timeout: 12000 });
  await davanti.waitForTimeout(2500);
  expect(await davanti.locator('.sn-save-confirm').count(), 'una conferma per una pagina salvata').toBe(1);
  expect(await app.evaluate(async (_e, u) => (await globalThis.SN_SAVED_PAGES.list()).filter((p) => p.url === u).length, url)).toBe(1);
});
