// Verifica #2555 giro 1: esplorazione del menu a icone (tastiera, valori, stati, pagine di Filo, tema scuro).

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
mkdirSync(SHOTS, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEJMDKgAQYGAH8IBAFwbpVFAAAAAElFTkSuQmCC', 'base64');
const SITO = (img) => `<!doctype html><html><head><title>Icone</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <p id="testo">Un paragrafo di prova da selezionare col mouse.</p>
  <p><a id="vai" href="https://esempio.it/pagina">un collegamento</a></p>
  <img id="foto" src="${img}" width="160" height="90" alt="foto">
  <video id="film" width="240" height="135" style="background:#222"></video>
  <p><input id="campo" value="testo nel campo" style="width:200px"></p>
  <div id="vuoto" style="height:200px"></div>
  </body></html>`;

const log = [];
const nota = (k, v) => { log.push({ k, v }); };
test.afterAll(() => { writeFileSync(resolve(SHOTS, 'verifica-2555-log.json'), JSON.stringify(log, null, 1)); });

function stato(menu) {
  return menu.valuta(() => {
    const m = document.querySelector('.sn-menu:not(.sn-menu-sub)');
    if (!m) return null;
    return {
      icone: [...m.querySelectorAll('.sn-menu-row-btn')].map((b) => ({
        verbo: b.dataset.snVerbo || '', nome: b.getAttribute('aria-label') || '', tasto: b.dataset.snTasto || '',
        varianti: b.dataset.snVarianti === '1', rara: !!b.closest('.sn-menu-altro'), pressed: b.getAttribute('aria-pressed'),
        visibile: b.getClientRects().length > 0, w: Math.round(b.getBoundingClientRect().width), text: b.textContent.trim(),
      })),
      testi: [...m.querySelectorAll('*')].filter((x) => x.children.length === 0 && x.textContent.trim() && x.getClientRects().length)
        .map((x) => `${x.className}: ${x.textContent.trim()}`).slice(0, 40),
      nome: m.querySelector('.sn-menu-nome')?.textContent || '',
      attivo: document.activeElement?.getAttribute?.('aria-label') || document.activeElement?.className || '',
    };
  });
}

test('esplora: tastiera, frecce, invio, il «+»', async ({ app, openTab, testServer }) => {
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  const menu = menuDi(page);
  await page.locator('#vai').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  nota('link-aperto', await stato(menu));
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
    nota(`link-destra-${i}`, (await stato(menu)).nome + ' | ' + (await stato(menu)).attivo);
  }
  await page.keyboard.press('ArrowDown');
  nota('link-giu', (await stato(menu)).nome + ' | ' + (await stato(menu)).attivo);
  await page.keyboard.press('ArrowDown');
  nota('link-giu2', (await stato(menu)).nome + ' | ' + (await stato(menu)).attivo);
  await page.screenshot({ path: resolve(SHOTS, 'v2555-link-tastiera.png') });
  await page.keyboard.press('Escape');
  // Frecce fino a «Copia», poi Invio.
  await page.locator('#vai').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  await app.evaluate(({ clipboard }) => clipboard.writeText('vuoto'));
  let passi = 0;
  while (passi < 12 && !(await stato(menu)).nome.startsWith('Copia')) { await page.keyboard.press('ArrowRight'); passi++; }
  nota('copia-dopo-frecce', { passi, nome: (await stato(menu)).nome });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  nota('appunti-dopo-invio', await app.evaluate(({ clipboard }) => clipboard.readText()));
  // Il «+» da tastiera.
  await page.locator('#vai').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  passi = 0;
  while (passi < 15 && !(await menu.valuta(() => document.activeElement?.classList?.contains('sn-menu-row-overflow')))) { await page.keyboard.press('ArrowRight'); passi++; }
  nota('piu-raggiunto', { passi, nome: (await stato(menu)).nome });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  nota('dopo-piu', await stato(menu));
  await page.screenshot({ path: resolve(SHOTS, 'v2555-link-piu.png') });
  await page.keyboard.press('ArrowDown');
  nota('dopo-piu-giu', (await stato(menu)).nome + ' | ' + (await stato(menu)).attivo);
  await page.keyboard.press('Escape');
  // Ctrl+C a menu aperto: non deve essere il tasto singolo «C» di un'altra azione per sorpresa.
  await page.locator('#foto').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  await app.evaluate(({ clipboard }) => clipboard.writeText('vuoto'));
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(400);
  nota('ctrl-c-su-immagine', { aperto: await menu.locator('.sn-menu-griglia').count(), appunti: await app.evaluate(({ clipboard }) => clipboard.readText()) });
  await page.keyboard.press('Escape');
  // Tasto destro su un'icona senza varianti.
  await page.locator('#vai').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  await menu.locator('.sn-menu-griglia [data-sn-verbo="openTab"]').click({ button: 'right' });
  await page.waitForTimeout(400);
  nota('destro-su-icona-senza-varianti', { sub: await menu.locator('.sn-menu-sub').count(), st: await stato(menu) });
  await page.screenshot({ path: resolve(SHOTS, 'v2555-destro-senza-varianti.png') });
});

test('esplora: dimensione come valore, ripeti acceso/spento, pagina vuota, campo', async ({ app, openTab, testServer }) => {
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  const menu = menuDi(page);
  // Zoom della scheda a 125%.
  await app.evaluate(({ BrowserWindow }, u) => {
    for (const win of BrowserWindow.getAllWindows()) {
      for (const t of win._filoTabs?.tabs || []) { try { if (t.view?.webContents?.getURL() === u) t.view.webContents.setZoomFactor(1.25); } catch (_) {} }
    }
  }, page.url());
  await page.waitForTimeout(500);
  await page.locator('#vuoto').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  nota('pagina-vuota', await stato(menu));
  await page.screenshot({ path: resolve(SHOTS, 'v2555-pagina.png') });
  const piu = menu.locator('.sn-menu-row-overflow');
  if (await piu.count()) { await piu.click(); await page.waitForTimeout(300); }
  nota('pagina-vuota-piu', await stato(menu));
  await page.screenshot({ path: resolve(SHOTS, 'v2555-pagina-piu.png') });
  const zoom = menu.locator('[data-sn-verbo="zoom"]');
  if (await zoom.count()) {
    nota('zoom-html', await zoom.evaluate((b) => b.outerHTML.slice(0, 400)));
    await zoom.hover();
    nota('zoom-nome', (await stato(menu)).nome);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(400);
    nota('zoom-dopo-rotella', { html: await zoom.evaluate((b) => b.textContent), sub: await menu.locator('.sn-menu-sub').count() });
    await zoom.click();
    await page.waitForTimeout(300);
    nota('zoom-dopo-clic', await stato(menu));
    await page.screenshot({ path: resolve(SHOTS, 'v2555-zoom-clic.png') });
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // Ripeti su un filmato.
  await page.locator('#film').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  await menu.locator('.sn-menu-row-overflow').click();
  const loop = menu.locator('[data-sn-verbo="loop"]');
  nota('loop-prima', await loop.getAttribute('aria-pressed'));
  await loop.click();
  await page.waitForTimeout(300);
  nota('loop-dopo-clic-menu-aperto', await menu.locator('.sn-menu-griglia').count());
  await page.keyboard.press('Escape');
  nota('loop-video', await page.evaluate(() => document.getElementById('film').loop));
  await page.locator('#film').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  await menu.locator('.sn-menu-row-overflow').click();
  nota('loop-riaperto', await menu.locator('[data-sn-verbo="loop"]').getAttribute('aria-pressed'));
  nota('film-stato', await stato(menu));
  await page.keyboard.press('Escape');
  // Campo con cursore e campo con selezione.
  await page.locator('#campo').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  nota('campo-cursore', await stato(menu));
  await page.screenshot({ path: resolve(SHOTS, 'v2555-campo.png') });
  await page.keyboard.press('Escape');
  await page.locator('#campo').selectText();
  await page.locator('#campo').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  nota('campo-selezione', await stato(menu));
  await page.screenshot({ path: resolve(SHOTS, 'v2555-campo-sel.png') });
  await page.keyboard.press('Escape');
});

test('esplora: tema scuro, menu della linguetta, impostazioni, cronologia', async ({ app, shell, openTab, testServer }) => {
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'update_settings', settings: { theme: 'dark' } })).catch(() => {});
  await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ theme: 'dark' }));
  await page.waitForTimeout(800);
  const menu = menuDi(page);
  await page.locator('#foto').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  await menu.locator('.sn-menu-griglia [data-sn-verbo="copy"]').hover();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(SHOTS, 'v2555-scuro-immagine.png') });
  await page.keyboard.press('Escape');
  // Menu della linguetta.
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active') || document.querySelector('.tab');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
  });
  await page.waitForTimeout(1200);
  for (const w of app.windows()) {
    try {
      const t = await w.evaluate(() => document.body && document.body.innerText);
      if (t && /Duplica|Chiudi/.test(t) && !/Icone/.test(t)) { nota('linguetta', t.slice(0, 600)); await w.screenshot({ path: resolve(SHOTS, 'v2555-linguetta.png') }); }
    } catch (_) {}
  }
  await shell.keyboard.press('Escape').catch(() => {});
  // Preferenze: tasto destro su una voce.
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForTimeout(1500);
  const voce = pref.locator('label, .pref-row, .row').first();
  if (await voce.count()) {
    await voce.click({ button: 'right' });
    await pref.waitForTimeout(800);
    const m = menuDi(pref);
    nota('preferenze', await stato(m));
    await pref.screenshot({ path: resolve(SHOTS, 'v2555-preferenze.png') });
    await pref.keyboard.press('Escape');
  }
  // Cronologia.
  const hist = await openTab('filo://history/history.html');
  await hist.waitForTimeout(1500);
  const riga = hist.locator('.hist-item, .item, li').first();
  if (await riga.count()) {
    await riga.click({ button: 'right' });
    await hist.waitForTimeout(800);
    nota('cronologia', await stato(menuDi(hist)));
    await hist.screenshot({ path: resolve(SHOTS, 'v2555-cronologia.png') });
  }
});
