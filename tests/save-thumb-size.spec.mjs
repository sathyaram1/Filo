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
import { deflateSync } from 'node:zlib';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

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
  expect(m.width, `${strada}: larghezza della miniatura`).toBe(320);
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

test('Alt+S su un sito dove Filo è spento: salva con la miniatura piccola e chiude subito', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { blocklist: ['127.0.0.1'] } }));
  const url = testServer.html(PAGINA_RICCA('Sito escluso'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.waitForTimeout(500);

  // Nessuno in pagina prende la scorciatoia: la risposta arriva subito, non dopo l'attesa di tre secondi e mezzo.
  const chiusa = page.waitForEvent('close', { timeout: 2500 });
  await dispatchAltS(app);
  await chiusa;
  controllaPiccola(await attendiMiniatura(app, url), 'Alt+S su sito escluso');
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
    await app.firstWindow();
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
