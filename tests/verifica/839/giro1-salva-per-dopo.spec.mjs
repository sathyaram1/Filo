// Verifica #839, giro 1 — porte ri-provate e chiuse: miniatura piccola da menu e Alt+S, conferma di Alt+S, passata sulle vecchie.
// Si parte dai passi dell'utente; le misure si leggono dallo storage vero del processo principale.

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Pagina «vera» e pesante: sfumature, foto finte e testo, più alta dello schermo.
const PAGINA_PESANTE = (titolo) => `<!doctype html><html><head><title>${titolo}</title></head>
<body style="margin:0;font:16px sans-serif">
<canvas id="c" style="display:block"></canvas>
<p style="padding:20px">${'Testo di prova lungo abbastanza da riempire la riga. '.repeat(60)}</p>
<script>
  const c = document.getElementById('c');
  c.width = innerWidth; c.height = innerHeight * 1.5;
  const x = c.getContext('2d');
  for (let i = 0; i < 400; i++) {
    const g = x.createRadialGradient(Math.random()*c.width, Math.random()*c.height, 1, Math.random()*c.width, Math.random()*c.height, 80 + Math.random()*200);
    g.addColorStop(0, 'hsl(' + (Math.random()*360) + ',80%,60%)'); g.addColorStop(1, 'hsla(' + (Math.random()*360) + ',70%,40%,0)');
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
  }
  const d = x.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) { const n = (Math.random() - 0.5) * 40; d.data[i] += n; d.data[i+1] += n; d.data[i+2] += n; }
  x.putImageData(d, 0, 0);
</script></body></html>`;

async function salvate(app) {
  return app.evaluate(async () => (await globalThis.chrome.storage.local.get('savedPages')).savedPages || []);
}

async function misura(app, dataUrl) {
  return app.evaluate(({ nativeImage }, d) => {
    const img = nativeImage.createFromDataURL(d);
    return { ...img.getSize(), byte: Math.floor((d.length - d.indexOf(',') - 1) * 3 / 4), tipo: d.slice(5, d.indexOf(';')) };
  }, dataUrl);
}

async function schedaAperta(app, url) {
  return app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return w._filoTabs.tabs.some((t) => t.url === u);
  }, url);
}

async function premiAltS(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('save-for-later', win);
  });
}

async function attendiMiniatura(app, url, ms = 8000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const v = (await salvate(app)).find((p) => p.url === url);
    if (v && v.thumbnail) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
  return (await salvate(app)).find((p) => p.url === url) || null;
}

async function attendiHome(app, ms = 8000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const h = app.windows().find((w) => { try { return w.url().startsWith('filo://home/home.html'); } catch (_) { return false; } });
    if (h) return h;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function pronta(openTab, testServer, html) {
  return testServer.openReady(openTab, html);
}

test('menu: miniatura piccola e compressa, conferma cliccabile, scheda chiusa', async ({ app, openTab, testServer }) => {
  const page = await pronta(openTab, testServer, PAGINA_PESANTE('Dal menu'));
  const url = page.url();
  await page.click('body', { button: 'right', position: { x: 400, y: 300 } });
  await page.locator('.sn-menu [data-sn-icon-id="saveForLater"]').click();
  await expect(page.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });
  const v = await attendiMiniatura(app, url);
  expect(v, 'la pagina non è stata salvata').toBeTruthy();
  expect(v.thumbnail, 'nessuna miniatura').toBeTruthy();
  const m = await misura(app, v.thumbnail);
  console.log('menu', m);
  expect(['image/jpeg', 'image/webp']).toContain(m.tipo);
  expect(m.width).toBeGreaterThanOrEqual(300);
  expect(m.width).toBeLessThanOrEqual(340);
  expect(m.byte).toBeLessThan(60 * 1024);
  await expect.poll(() => schedaAperta(app, url), { timeout: 8000 }).toBe(false);
});

test('Alt+S: stessa conferma del menu, visibile, che apre la lista con la voce evidenziata; miniatura piccola', async ({ app, openTab, testServer }) => {
  const page = await pronta(openTab, testServer, PAGINA_PESANTE('Da Alt+S'));
  const url = page.url();
  await premiAltS(app);
  const pill = page.locator('.sn-save-confirm');
  await expect(pill).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.sn-save-confirm-cta')).toHaveCount(1);
  // Dentro lo schermo, dove l'utente la vede.
  const box = await pill.boundingBox();
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.w + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.h + 1);
  try { await page.screenshot({ path: 'tests/.shots/verifica-839-alts-conferma.png' }); } catch (_) {}
  const v = await attendiMiniatura(app, url);
  expect(v?.thumbnail, 'nessuna miniatura da Alt+S').toBeTruthy();
  const m = await misura(app, v.thumbnail);
  console.log('alt+s', m);
  expect(['image/jpeg', 'image/webp']).toContain(m.tipo);
  expect(m.width).toBeGreaterThanOrEqual(300);
  expect(m.width).toBeLessThanOrEqual(340);
  expect(m.byte).toBeLessThan(60 * 1024);
  await pill.click();
  const home = await attendiHome(app);
  expect(home, 'la conferma di Alt+S non apre la lista').toBeTruthy();
  expect(home.url()).toContain(`highlight=${v.id}`);
  await home.waitForLoadState('domcontentloaded');
  await expect(home.locator('.sn-card[data-highlighted="1"]')).toHaveAttribute('data-page-id', v.id, { timeout: 8000 });
  await expect.poll(() => schedaAperta(app, url), { timeout: 8000 }).toBe(false);
});

test('Alt+S ripetuto in fretta: una voce sola, una conferma sola, chiusa solo la sua scheda', async ({ app, openTab, testServer }) => {
  // Nome diverso: openTab cerca la scheda per nome dell'host.
  const altra = await testServer.openReady(openTab, PAGINA_PESANTE('Altra scheda'), { pubblico: true });
  const altraUrl = altra.url();
  const page = await pronta(openTab, testServer, PAGINA_PESANTE('Doppio'));
  const url = page.url();
  await premiAltS(app);
  await premiAltS(app);
  await premiAltS(app);
  await expect(page.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(400);
  await expect(page.locator('.sn-save-confirm')).toHaveCount(1);
  const voci = (await salvate(app)).filter((p) => p.url === url);
  expect(voci.length).toBe(1);
  await expect.poll(() => schedaAperta(app, url), { timeout: 8000 }).toBe(false);
  expect(await schedaAperta(app, altraUrl), 'si è chiusa anche un\'altra scheda').toBe(true);
});

test('Alt+S col menu del tasto destro aperto: il menu sparisce e la miniatura resta piccola', async ({ app, openTab, testServer }) => {
  const page = await pronta(openTab, testServer, PAGINA_PESANTE('Menu aperto'));
  const url = page.url();
  await page.click('body', { button: 'right', position: { x: 400, y: 300 } });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await premiAltS(app);
  await expect(page.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.sn-menu:visible')).toHaveCount(0);
  const v = await attendiMiniatura(app, url);
  expect(v?.thumbnail).toBeTruthy();
  const m = await misura(app, v.thumbnail);
  expect(m.byte).toBeLessThan(60 * 1024);
});

// Le miniature grandi di prima: si prepara lo storage di un utente vero e si riapre Filo.
test('le miniature grandi già salvate si rimpiccioliscono una volta, senza perdere voci, date o categorie', async ({ app }) => {
  test.setTimeout(90_000);
  const grande = await app.evaluate(({ nativeImage }) => {
    const w = 1600, h = 1000; const buf = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; const n = Math.random() * 30;
      buf[i] = (x * 255 / w + n) | 0; buf[i + 1] = (y * 255 / h + n) | 0; buf[i + 2] = ((x + y) % 255 + n) | 0; buf[i + 3] = 255;
    }
    return nativeImage.createFromBitmap(buf, { width: w, height: h }).toDataURL();
  });
  const byteGrande = Math.floor((grande.length - grande.indexOf(',') - 1) * 3 / 4);
  console.log('grande', byteGrande);
  expect(byteGrande).toBeGreaterThan(500 * 1024);
  const rotta = 'data:image/png;base64,' + 'A'.repeat(200 * 1024);
  const pagine = [];
  for (let i = 0; i < 12; i++) {
    pagine.push({ id: 'p' + i, url: `https://esempio.test/${i}`, title: 'Pagina ' + i, favicon: '', thumbnail: i === 5 ? rotta : (i === 7 ? '' : grande), savedAt: `2026-0${1 + (i % 8)}-1${i % 9}T10:00:00.000Z`, category: i % 2 ? 'Video da guardare' : null, categoryId: i % 2 ? 'c1' : undefined, categoryConfidence: i % 2 ? 0.8 : null });
  }
  const categorie = [{ id: 'c1', name: 'Video da guardare', createdAt: '2026-01-01T00:00:00.000Z', thumbnailUrl: grande }];
  const dir = cartellaTemporanea('filo-v839-');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'storage.json'), JSON.stringify({ savedPages: pagine, categories: categorie }), 'utf8');
  const prima = readFileSync(join(dir, 'storage.json')).length;
  const lancia = () => electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: dir, FILO_DOWNLOAD_DIR: join(dir, 'downloads'), NODE_ENV: 'test' } });
  let app2 = await lancia();
  try {
    await app2.firstWindow();
    const fine = Date.now() + 40000;
    let pag = null;
    while (Date.now() < fine) {
      pag = await app2.evaluate(async () => (await globalThis.chrome.storage.local.get('savedPages')).savedPages || []);
      if (pag.filter((p) => p.id !== 'p5' && p.thumbnail && p.thumbnail.startsWith('data:image/png')).length === 0) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const cats = await app2.evaluate(async () => (await globalThis.chrome.storage.local.get('categories')).categories || []);
    expect(pag.length).toBe(12);
    for (const orig of pagine) {
      const ora = pag.find((p) => p.id === orig.id);
      expect(ora, `voce ${orig.id} persa`).toBeTruthy();
      expect(ora.savedAt).toBe(orig.savedAt);
      expect(ora.category).toBe(orig.category);
      expect(ora.url).toBe(orig.url);
      expect(ora.title).toBe(orig.title);
    }
    expect(pag.map((p) => p.id)).toEqual(pagine.map((p) => p.id));
    expect(pag.find((p) => p.id === 'p5').thumbnail).toBe(rotta);
    expect(pag.find((p) => p.id === 'p7').thumbnail).toBe('');
    for (const p of pag.filter((p) => !['p5', 'p7'].includes(p.id))) {
      const m = await misura(app2, p.thumbnail);
      expect(['image/jpeg', 'image/webp']).toContain(m.tipo);
      expect(m.width).toBeGreaterThanOrEqual(300);
      expect(m.width).toBeLessThanOrEqual(340);
      expect(m.byte).toBeLessThan(60 * 1024);
    }
    const mc = await misura(app2, cats[0].thumbnailUrl);
    expect(mc.byte).toBeLessThan(60 * 1024);
    expect(cats[0].name).toBe('Video da guardare');
    // Nessuna finestra in più rimasta aperta.
    const finestre = await app2.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).map((w) => ({ visibile: w.isVisible(), tabs: !!w._filoTabs })));
    console.log('finestre', JSON.stringify(finestre));
    await new Promise((r) => setTimeout(r, 1500));
  } finally {
    await chiudiApp(app2);
  }
  const dopo = readFileSync(join(dir, 'storage.json')).length;
  console.log('storage.json prima/dopo', prima, dopo);
  // Seconda apertura: niente da rifare, nulla cambia.
  const primaTesto = readFileSync(join(dir, 'storage.json'), 'utf8');
  app2 = await lancia();
  try {
    await app2.firstWindow();
    await new Promise((r) => setTimeout(r, 7000));
    const pag2 = await app2.evaluate(async () => (await globalThis.chrome.storage.local.get('savedPages')).savedPages || []);
    const vecchie = JSON.parse(primaTesto).savedPages;
    expect(pag2.map((p) => p.thumbnail)).toEqual(vecchie.map((p) => p.thumbnail));
  } finally {
    await chiudiApp(app2);
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});
