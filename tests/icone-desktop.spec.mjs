// #1621, #1617 — «metti in ordine alfabetico le icone del desktop, da sinistra in alto a destra in basso»: la chat le
// mette in fila sopra un desktop finto di Windows o del Mac (il computer delle prove di src/main/services/iconeDesktop.js),
// e l'annullo dal segno della bolla o a parole le rimette dov'erano. Sopra c'è la strada vera: chat, livelli, filo, cambi.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from './helpers/chatFinta.mjs';

// Le icone di Josh sparse sul desktop; lo schermo finto tiene tre colonne (240 px, passo 75), allineate a 3,2.
const SPARSE = [
  ['C:\\Users\\Josh\\Desktop\\Zoom.lnk', 'Zoom', 153, 402],
  ['C:\\Users\\Josh\\Desktop\\appunti.txt', 'appunti.txt', 153, 2],
  ['::{645FF040-5081-101B-9F08-00AA002F954E}', 'Cestino', 3, 2],
  ['C:\\Users\\Josh\\Desktop\\Bilancio 2024.xlsx', 'Bilancio 2024.xlsx', 78, 302],
  ['C:\\Users\\Josh\\Desktop\\bilancio 10', 'bilancio 10', 3, 702],
  ['C:\\Users\\Josh\\Desktop\\Ébano.png', 'Ébano.png', 3, 902],
  ['C:\\Users\\Josh\\Desktop\\File 10.pdf', 'File 10.pdf', 78, 102],
  ['C:\\Users\\Josh\\Desktop\\File 2.pdf', 'File 2.pdf', 78, 602],
];
const IN_FILA = [
  ['appunti.txt', 'bilancio 10', 'Bilancio 2024.xlsx'],
  ['Cestino', 'Ébano.png', 'File 2.pdf'],
  ['File 10.pdf', 'Zoom'],
];

async function desktopFinto(app, { auto = false } = {}) {
  await app.evaluate((_, a) => {
    const rq = process.mainModule.require;
    const D = rq(rq('node:path').join(process.cwd(), 'src/main/services/iconeDesktop.js'));
    globalThis.__desk = { voci: a.voci.map(([id, nome, x, y]) => ({ id, nome, x, y, cartella: false })), auto: a.auto };
    const foto = () => ({
      ok: true, voci: globalThis.__desk.voci.map((v) => ({ ...v })), area: { sinistra: 0, alto: 0, destra: 240, basso: 1040 },
      passo: { x: 75, y: 100 }, auto: globalThis.__desk.auto, griglia: true, nascoste: false, totale: globalThis.__desk.voci.length,
    });
    D._perProve.usaComputer({
      async leggi() { return foto(); },
      async disponi(posizioni, opz) {
        for (const p of posizioni) {
          const v = globalThis.__desk.voci.find((x) => x.id === p.id);
          if (v) { v.x = p.x; v.y = p.y; }
        }
        globalThis.__desk.auto = !!(opz && opz.auto);
        return { ...foto(), spostate: posizioni.length };
      },
    });
  }, { voci: SPARSE, auto });
}

// La Scrivania del Mac: il Finder la tiene «Ordina per nome», in colonna da destra; la posizione è il centro dell'icona.
const SCRIVANIA = [
  ['file:///Users/josh/Desktop/Zoom.app/', 'Zoom', 1380, 60],
  ['file:///Users/josh/Desktop/appunti.txt', 'appunti.txt', 1380, 160],
  ['file:///Users/josh/Desktop/Bilancio%202024.xlsx', 'Bilancio 2024.xlsx', 1380, 260],
  ['file:///Users/josh/Desktop/Foto/', 'Foto', 1280, 60],
];

async function scrivaniaFinta(app, { negato = false } = {}) {
  await app.evaluate((_, a) => {
    const rq = process.mainModule.require;
    const D = rq(rq('node:path').join(process.cwd(), 'src/main/services/iconeDesktop.js'));
    globalThis.__desk = { voci: a.voci.map(([id, nome, x, y]) => ({ id, nome, x, y, cartella: false })), finder: 'arranged by name' };
    const foto = () => ({
      ok: true, voci: globalThis.__desk.voci.map((v) => ({ ...v })), area: { sinistra: 0, alto: 25, destra: 1440, basso: 830 }, passo: null,
      finder: globalThis.__desk.finder, auto: /^arranged by /.test(globalThis.__desk.finder), griglia: false, nascoste: false, dimensioneIcone: 64,
      totale: globalThis.__desk.voci.length,
    });
    D._perProve.usaComputer({
      piattaforma: 'darwin',
      async leggi() { return a.negato ? { ok: false, errore: 'permesso-automazione' } : foto(); },
      async disponi(posizioni, opz = {}) {
        if (posizioni.length && /^arranged by /.test(globalThis.__desk.finder)) globalThis.__desk.finder = 'not arranged';
        for (const p of posizioni) {
          const v = globalThis.__desk.voci.find((x) => x.id === p.id);
          if (v) { v.x = p.x; v.y = p.y; }
        }
        if (opz.disposizione) globalThis.__desk.finder = opz.disposizione;
        return { ...foto(), spostate: posizioni.length };
      },
    });
  }, { voci: SCRIVANIA, negato });
}

const desktop = (app) => app.evaluate(() => JSON.parse(JSON.stringify(globalThis.__desk)));
// Come lo vede chi guarda il desktop: le righe dall'alto, ognuna da sinistra.
async function righeViste(app) {
  const { voci } = await desktop(app);
  const ys = [...new Set(voci.map((v) => v.y))].sort((a, b) => a - b);
  return ys.map((y) => voci.filter((v) => v.y === y).sort((a, b) => a.x - b.x).map((v) => v.nome));
}
const posizioni = async (app) => (await desktop(app)).voci.map((v) => [v.nome, v.x, v.y]).sort();
const ORIGINALI = SPARSE.map(([, nome, x, y]) => [nome, x, y]).sort();

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    const rq = process.mainModule.require;
    rq(rq('node:path').join(process.cwd(), 'src/main/services/iconeDesktop.js'))._perProve.usaComputer(null);
  }).catch(() => {});
  await ripristina(app).catch(() => {});
});

test('«in ordine alfabetico, da sinistra in alto a destra in basso»: le icone si leggono in fila, e «annulla» le rimette dov\'erano', async ({ app }) => {
  test.setTimeout(60_000);
  await desktopFinto(app, { auto: true });
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'd1', name: 'ORDINA_DESKTOP', arguments: JSON.stringify({ ordine: 'nome', verso: 'righe' }) }] },
    { text: 'Fatto: le icone sono in ordine alfabetico.' },
  ]);
  await chiedi(page, 'ordina le icone del desktop in ordine alfabetico da sinistra in alto verso destra in basso');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto: le icone' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => righeViste(app)).toEqual(IN_FILA);
  expect((await desktop(app)).auto, '«Disponi automaticamente» le rimetterebbe in colonna').toBe(false);

  // Il modello sa cosa è successo, coi numeri e il cambio da annullare, senza i nomi dei file.
  const giri = await chiamateAlModello(app);
  const esito = JSON.stringify(giri[1]);
  expect(esito).toContain('in ordine alfabetico, a righe: 8 icone su 3 righe e 3 colonne');
  expect(esito).toContain('Disponi automaticamente');
  expect(esito).toMatch(/ANNULLA_CAMBIO con id c[0-9a-f]{10}/);
  expect(esito).not.toContain('Bilancio 2024');

  await page.locator('.dash-activity-head').first().click();
  await expect(page.locator('.dash-activity-row', { hasText: 'Icone del desktop · in ordine alfabetico, a righe · 8 spostate' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Sistemate le icone del desktop · in ordine alfabetico, a righe · 8 spostate' })).toBeVisible();
  await page.locator('.dash-activity').first().screenshot({ path: 'tests/.shots/icone-desktop-riga.png' });
  const bolla = page.locator('.dash-bubble-user', { hasText: 'ordina le icone del desktop' });
  await bolla.locator('.dash-cambi-segno').hover();
  const pop = bolla.locator('.dash-cambi-pop');
  await expect(pop).toContainText('icone del desktop in ordine alfabetico, a righe');
  await page.screenshot({ path: 'tests/.shots/icone-desktop-in-ordine.png' });

  await pop.locator('.dash-cambi-annulla').click();
  await expect.poll(() => posizioni(app)).toEqual(ORIGINALI);
  expect((await desktop(app)).auto, '«Disponi automaticamente» torna com\'era').toBe(true);
  await expect(pop.locator('.dash-cambi-annulla')).toHaveText('rifai');

  // Rifai le rimette in fila.
  await bolla.locator('.dash-cambi-segno').hover();
  await pop.locator('.dash-cambi-annulla').click();
  await expect.poll(() => righeViste(app)).toEqual(IN_FILA);

  await page.evaluate(() => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }));
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark', { timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.locator('.dash-activity').first().screenshot({ path: 'tests/.shots/icone-desktop-riga-scuro.png' });
  await page.evaluate(() => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'light' } }));
});

test('«rimettile com\'erano» a parole: ANNULLA_CAMBIO riporta ogni icona al suo posto', async ({ app }) => {
  test.setTimeout(60_000);
  await desktopFinto(app);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'd1', name: 'ORDINA_DESKTOP', arguments: JSON.stringify({ verso: 'righe' }) }] },
    { text: 'Messe in fila.' },
    // L'annullo riuscito chiude il turno da sé: il testo arriva col suo giro.
    { text: 'Rimesse dov\'erano.', toolCalls: [{ id: 'a1', name: 'ANNULLA_CAMBIO', arguments: '{}' }] },
  ]);
  await chiedi(page, 'metti in ordine alfabetico le icone del desktop');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Messe in fila.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => righeViste(app)).toEqual(IN_FILA);
  await chiedi(page, 'no, rimettile com\'erano');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Rimesse dov\'erano.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => posizioni(app)).toEqual(ORIGINALI);
});

test('sul Mac: la Scrivania in fila da sinistra in alto, «Ordina per» del Finder tolto e detto, e «annulla» lo rimette', async ({ app }) => {
  test.setTimeout(60_000);
  await scrivaniaFinta(app);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'd1', name: 'ORDINA_DESKTOP', arguments: JSON.stringify({ ordine: 'nome', verso: 'righe' }) }] },
    { text: 'Fatto: la Scrivania è in ordine alfabetico.' },
  ]);
  await chiedi(page, 'ordina le icone della scrivania in ordine alfabetico da sinistra in alto');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto: la Scrivania' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => righeViste(app)).toEqual([['appunti.txt', 'Bilancio 2024.xlsx', 'Foto', 'Zoom']]);
  expect((await desktop(app)).finder).toBe('not arranged');
  const esito = JSON.stringify((await chiamateAlModello(app))[1]);
  expect(esito).toContain('sono nell\'ordine chiesto');
  expect(esito).toContain('Ordina per');
  expect(esito).not.toContain('Disponi automaticamente');

  const bolla = page.locator('.dash-bubble-user', { hasText: 'ordina le icone della scrivania' });
  await bolla.locator('.dash-cambi-segno').hover();
  const pop = bolla.locator('.dash-cambi-pop');
  await expect(pop).toContainText('icone del desktop in ordine alfabetico, a righe');
  await pop.locator('.dash-cambi-annulla').click();
  await expect.poll(async () => (await desktop(app)).voci.map((v) => [v.nome, v.x, v.y]).sort()).toEqual(SCRIVANIA.map(([, nome, x, y]) => [nome, x, y]).sort());
  expect((await desktop(app)).finder).toBe('arranged by name');
});

test('sul Mac senza il permesso di comandare il Finder: la frase e il tasto che apre Automazione', async ({ app }) => {
  test.setTimeout(60_000);
  await scrivaniaFinta(app, { negato: true });
  await app.evaluate(({ shell }) => {
    globalThis.__aperti = [];
    globalThis.__openExternal = shell.openExternal;
    shell.openExternal = async (u) => { globalThis.__aperti.push(u); };
  });
  try {
    const page = await home(app);
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'ORDINA_DESKTOP', arguments: '{}' }] },
      { text: 'macOS non me lo lascia fare: il tasto è qui sotto.' },
    ]);
    await chiedi(page, 'metti in ordine le icone della scrivania');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'macOS non me lo lascia fare' })).toBeVisible({ timeout: 10_000 });
    expect(JSON.stringify((await chiamateAlModello(app))[1])).toContain('Automazione');
    const tasto = page.locator('.dash-bubble-actions .dash-action-btn', { hasText: 'Apri le impostazioni' }).last();
    await expect(tasto).toBeVisible();
    await page.screenshot({ path: 'tests/.shots/icone-desktop-mac-permesso.png' });
    await tasto.click();
    await expect.poll(() => app.evaluate(() => globalThis.__aperti)).toEqual(['x-apple.systempreferences:com.apple.preference.security?Privacy_Automation']);
  } finally {
    await app.evaluate(({ shell }) => { shell.openExternal = globalThis.__openExternal; });
  }
});
