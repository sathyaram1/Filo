// TEMPORANEO — sonda del verificatore (feedback #563, giro 4). Va rimosso.
//
// Prova a rompere l'unico cambiamento VISIBILE all'utente di questo lavoro: la
// tendina dei font dell'editor, che adesso si riposiziona a ogni misura invece
// che solo all'apertura.

import { _electron as electron, expect, test } from '@playwright/test';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const EDITOR = 'filo://editor/editor.html';

let app = null;
let shell = null;
let userData = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userData = cartellaTemporanea('filo-test-');
  app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  try { await app.close(); } catch (_) {}
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  app = null; shell = null; userData = null;
});

async function openTab(url) {
  const target = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const deadline = Date.now() + 10_000;
  let page = null;
  while (Date.now() < deadline) {
    page = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === target; } catch (_) { return false; }
    });
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error(`tab non trovata: ${url}`);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function addFontModule(page) {
  if (await page.locator('.ed-module[data-type="font"]').count()) return;
  await page.locator('.ed-cell-empty').first().click();
  await expect(page.locator('.ed-overlay [data-add="font"]')).toHaveCount(1);
  await page.locator('.ed-overlay [data-add="font"]').click();
  await page.waitForSelector('.ed-module[data-type="font"]');
}

test('A) finestra BASSA con la tendina aperta: resta dentro anche in verticale?', async () => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-grid');
  await page.setViewportSize({ width: 900, height: 800 });
  await addFontModule(page);

  const mod = page.locator('.ed-module[data-type="font"]');
  await mod.locator('.ed-font-button').click();
  await expect(mod.locator('.ed-font-pop')).toBeVisible();

  // La finestra si accorcia mentre la tendina è aperta.
  await page.setViewportSize({ width: 900, height: 320 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const p = document.querySelector('.ed-font-pop').getBoundingClientRect();
    return {
      vh: window.innerHeight, vw: window.innerWidth,
      top: Math.round(p.top), bottom: Math.round(p.bottom),
      left: Math.round(p.left), right: Math.round(p.right),
    };
  });
  console.log('[sonda A]', JSON.stringify(m));
  expect(m.right, 'esce a destra').toBeLessThanOrEqual(m.vw);
  expect(m.left, 'esce a sinistra').toBeGreaterThanOrEqual(0);
  expect(m.top, 'esce dal bordo ALTO: le prime voci non si raggiungono').toBeGreaterThanOrEqual(0);
  expect(m.bottom, 'esce dal bordo BASSO').toBeLessThanOrEqual(m.vh);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('A2) APERTURA normale a varie altezze di finestra: la tendina sta dentro?', async () => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-grid');
  await addFontModule(page);
  const mod = page.locator('.ed-module[data-type="font"]');
  const btn = mod.locator('.ed-font-button');
  const pop = mod.locator('.ed-font-pop');
  const fuori = [];
  for (const h of [1000, 900, 800, 760, 720, 680, 640, 600, 560, 520, 480, 440, 400]) {
    await page.setViewportSize({ width: 1280, height: h });
    await page.waitForTimeout(150);
    await btn.click();
    await expect(pop).toBeVisible();
    const m = await page.evaluate(() => {
      const p = document.querySelector('.ed-font-pop').getBoundingClientRect();
      const b = document.querySelector('.ed-font-button').getBoundingClientRect();
      return {
        vh: window.innerHeight,
        sotto: Math.round(window.innerHeight - b.bottom),
        top: Math.round(p.top), bottom: Math.round(p.bottom), alt: Math.round(p.height),
      };
    });
    const sfora = Math.max(0, m.bottom - m.vh) + Math.max(0, -m.top);
    console.log(`[sonda A2] finestra ${h}px →`, JSON.stringify(m), 'FUORI:', sfora);
    if (sfora > 0) fuori.push(`${h}px: ${sfora}px fuori (tendina ${m.top}–${m.bottom}, finestra 0–${m.vh})`);
    await btn.click();
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(fuori, 'la tendina esce dalla finestra ad altezze normali, aprendola e basta').toEqual([]);
});

test('B) finestra che si RIALLARGA: la tendina torna sotto il suo bottone', async () => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-grid');
  await page.setViewportSize({ width: 520, height: 800 });
  await addFontModule(page);

  const mod = page.locator('.ed-module[data-type="font"]');
  await mod.locator('.ed-font-button').click();
  await expect(mod.locator('.ed-font-pop')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const p = document.querySelector('.ed-font-pop').getBoundingClientRect();
    const b = document.querySelector('.ed-font-button').getBoundingClientRect();
    return { popLeft: Math.round(p.left), btnLeft: Math.round(b.left), vw: window.innerWidth, popRight: Math.round(p.right) };
  });
  console.log('[sonda B]', JSON.stringify(m));
  expect(m.popRight).toBeLessThanOrEqual(m.vw);
  expect(Math.abs(m.popLeft - m.btnLeft), 'riallargando la tendina resta appiccicata al margine invece di tornare sotto il bottone').toBeLessThanOrEqual(2);
});

test('C) ricerca font: 10.000 caratteri, emoji, HTML — niente crash né iniezione', async () => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-grid');
  await page.setViewportSize({ width: 1280, height: 800 });
  await addFontModule(page);

  const mod = page.locator('.ed-module[data-type="font"]');
  await mod.locator('.ed-font-button').click();
  const search = mod.locator('.ed-font-search');
  await expect(search).toBeVisible();

  await search.fill('x'.repeat(10_000));
  await page.waitForTimeout(200);
  let stato = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('.ed-font-pop .sn-select-option')].filter((o) => o.style.display !== 'none');
    const p = document.querySelector('.ed-font-pop').getBoundingClientRect();
    return { visibili: vis.length, right: Math.round(p.right), vw: window.innerWidth, vivo: !!document.querySelector('.ed-font-pop') };
  });
  console.log('[sonda C 10k]', JSON.stringify(stato));
  expect(stato.vivo).toBe(true);
  expect(stato.visibili).toBe(0);
  expect(stato.right, 'con 10.000 caratteri nella ricerca la tendina sborda').toBeLessThanOrEqual(stato.vw);

  await search.fill('<script>alert(1)</script>');
  await page.waitForTimeout(150);
  const iniezione = await page.evaluate(() => document.querySelectorAll('.ed-font-pop script').length);
  expect(iniezione, 'HTML iniettato nella tendina').toBe(0);

  await search.fill('🙂🙂🙂');
  await page.waitForTimeout(150);
  await search.fill('gara');
  await page.waitForTimeout(200);
  stato = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('.ed-font-pop .sn-select-option')].filter((o) => o.style.display !== 'none');
    return { visibili: vis.length, primo: vis[0]?.textContent || '' };
  });
  console.log('[sonda C filtro]', JSON.stringify(stato));
  expect(stato.visibili, 'dopo emoji e testo lunghissimo il filtro non torna a funzionare').toBeGreaterThan(0);
});

test('D) apri/chiudi ripetuto e ridimensiona a tendina CHIUSA: nessun ascoltatore rimasto attaccato', async () => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-grid');
  await page.setViewportSize({ width: 1280, height: 800 });
  await addFontModule(page);

  const mod = page.locator('.ed-module[data-type="font"]');
  const btn = mod.locator('.ed-font-button');
  const pop = mod.locator('.ed-font-pop');
  for (let i = 0; i < 8; i++) {
    await btn.click();
    await btn.click();
  }
  await expect(pop).toBeHidden();
  // Ridimensiona a tendina chiusa: non deve tornare visibile né spostarsi.
  await page.setViewportSize({ width: 600, height: 500 });
  await page.waitForTimeout(300);
  await expect(pop).toBeHidden();
  await btn.click();
  await expect(pop).toBeVisible();
  const m = await page.evaluate(() => {
    const p = document.querySelector('.ed-font-pop').getBoundingClientRect();
    return { left: Math.round(p.left), right: Math.round(p.right), vw: window.innerWidth };
  });
  console.log('[sonda D]', JSON.stringify(m));
  expect(m.right).toBeLessThanOrEqual(m.vw);
  expect(m.left).toBeGreaterThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });
});
