// Sonde della verifica #1471, giro 2: le strade dei contatori che lo spec del lavoro non percorre.

import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';
import { comandaBarra, statoBarra } from '../../helpers/barra.mjs';

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));

const gesti = (app) => app.evaluate(async () => {
  const C = globalThis.SN_CONTATORI;
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = C.giornoDi(Date.now());
  const ore = Object.entries(s.ore || {}).filter(([k]) => k.startsWith(`${g}T`)).sort();
  const tot = {};
  for (const [k, dati] of ore) {
    const d = C.documentoGesti({ pseudonimo: 'a'.repeat(20), chiave: k, app: '0.0.0', os: 'linux', dati });
    for (const c of C.MISURE_GESTI) {
      tot[c] = tot[c] || {};
      if (c === 'disposizione_di_serie') { if (Object.keys(d[c]).length) tot[c] = d[c]; continue; }
      for (const [chiave, v] of Object.entries(d[c])) {
        const per = tot[c][chiave] || (tot[c][chiave] = {});
        for (const voce of v.split(';')) {
          const p = voce.split('|');
          const [nome, n] = c === 'barra_aperta' ? [p[0], p[1]] : p.length === 1 ? ['', p[0]] : [p.slice(0, -1).join('|'), p[p.length - 1]];
          per[nome] = (per[nome] || 0) + Number(n);
        }
      }
    }
  }
  return tot;
});
const conto = async (app, misura, chiave, voce = '') => ((await gesti(app))[misura]?.[chiave]?.[voce]) || 0;

test('sonda incognito: la home in incognito non conta le carte', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await shell.evaluate(() => window.filoShell.openIncognito());
  const inc = await trovaPagina(app, (u) => u.includes('incognito=1'), 15_000);
  const carta = inc.locator('#tieni .dash-carta[data-chiave="editor"]');
  await expect(carta).toBeVisible({ timeout: 10_000 });
  await carta.click({ button: 'right' });
  await expect(inc.locator('.dash-menu')).toBeVisible();
  await inc.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 800));
  expect(await conto(app, 'carta_home', 'editor', 'destra|tasto_destro')).toBe(0);
  const home = await homeDi(app);
  await home.bringToFront();
  await home.locator('#tieni .dash-carta[data-chiave="editor"]').click({ button: 'right' });
  await expect.poll(() => conto(app, 'carta_home', 'editor', 'destra|tasto_destro'), { timeout: 8_000 }).toBe(1);
});

test('sonda editor: configurato e tolto dalla finestra del modulo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeVisible();
  await page.locator('.ed-cell-empty').first().click();
  await page.locator('[data-add="word-count"]').click();
  await expect.poll(() => conto(app, 'modulo_editor', 'word-count', 'aggiunto'), { timeout: 8_000 }).toBe(1);
  await page.locator('.ed-module[data-type="word-count"]').first().click();
  await page.locator('#cfgSave').click();
  await expect.poll(() => conto(app, 'modulo_editor', 'word-count', 'configurato'), { timeout: 8_000 }).toBe(1);
  await page.locator('.ed-module[data-type="word-count"]').first().click();
  await page.locator('#cfgDelete').click();
  await expect.poll(() => conto(app, 'modulo_editor', 'word-count', 'tolto'), { timeout: 8_000 }).toBe(1);
});

test('sonda preferenze: tutte le impostazioni annullato, colore schede', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#resetAllSettings').scrollIntoViewIfNeeded();
  await page.locator('#resetAllSettings').click();
  await clickConfirm(page, 'cancel');
  await expect.poll(() => conto(app, 'ripristino', 'tutte_impostazioni', 'annullato'), { timeout: 8_000 }).toBe(1);
  await page.locator('#resetAllTabColor').scrollIntoViewIfNeeded();
  await page.locator('#resetAllTabColor').click();
  await expect.poll(() => conto(app, 'ripristino', 'tutto_colore_schede'), { timeout: 8_000 }).toBe(1);
});

test('sonda barra: spinta sul bordo chiusa a vuoto', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await comandaBarra(app, 'spinta');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await comandaBarra(app, 'chiudi');
  await expect.poll(() => conto(app, 'barra_aperta', 'spinta', 'a_vuoto'), { timeout: 8_000 }).toBe(1);
  const s = await app.evaluate(async () => JSON.stringify((await globalThis.SN_CONTATORI_MAIN.letto()).ore));
  expect(s).toMatch(/spinta/);
});
