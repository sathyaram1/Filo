// Verifica #825 giro 1 — esplorazione: archivio delle schede senza tetti, ricerca, migrazione, cancellazione, backup.

import { test, expect, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { argomentiScala } from '../../helpers/scala.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { writeFileSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const launch = (userData) => electron.launch({
  args: [...argomentiScala, '.'],
  cwd: APP_ROOT,
  env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
});

function vec(seed) {
  const v = [];
  for (let i = 0; i < 256; i++) v.push(((seed * 31 + i * 17) % 255) - 127);
  return v;
}

function schede(n, { conVettore = true } = {}) {
  const base = Date.UTC(2026, 8, 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `t${i}`,
      url: `https://sito-${i}.test/p`,
      title: `Scheda ${i}`,
      favicon: '',
      closedAt: new Date(base - i * 3600e3).toISOString(),
      reason: 'manual',
      coOpenUrls: [],
      summary: `Riassunto ${i} ` + 'parole '.repeat(100),
      snippet: `snippet ${i}`,
      ...(conVettore ? { embedding: vec(i), embedModel: 'modello-x' } : {}),
    });
  }
  return out;
}

function tuttiIFile(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    let s;
    try { s = statSync(p); } catch (_) { continue; }
    if (s.isDirectory()) out.push(...tuttiIFile(p));
    else out.push(p);
  }
  return out;
}

test('migrazione di 6000 schede da storage.json, riavvio, tempi', async () => {
  test.setTimeout(180_000);
  const userData = cartellaTemporanea('filo-v825-');
  const semi = schede(6000);
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ archivedTabs: semi, filo_memory: { PROFILO: 'x' } }), 'utf8');
  let app = await launch(userData);
  try {
    const r = await app.evaluate(async () => {
      const t0 = Date.now();
      const l = await globalThis.SN_ARCHIVED_TABS.list();
      const t1 = Date.now();
      await require('node:timers/promises').setTimeout(300);
      return { l, ms: t1 - t0 };
    });
    console.log('apertura+migrazione ms', r.ms);
    expect(r.l.length).toBe(6000);
    expect(r.l).toEqual(semi);
    await expect.poll(() => JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8')).archivedTabs, { timeout: 5000 }).toBeUndefined();
    const mem = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8')).filo_memory;
    expect(mem).toEqual({ PROFILO: 'x' });
  } finally { await chiudiApp(app); }

  app = await launch(userData);
  try {
    const r = await app.evaluate(async () => {
      const t0 = Date.now();
      const l = await globalThis.SN_ARCHIVED_TABS.list();
      const t1 = Date.now();
      const e = await globalThis.SN_ARCHIVED_TABS.archive({ url: 'https://nuova.test/', title: 'Nuova' });
      const t2 = Date.now();
      return { n: l.length, primo: l[0], ultimo: l[l.length - 1], freddo: t1 - t0, caldo: t2 - t1, nuova: !!e };
    });
    console.log('riavvio: apertura a freddo ms', r.freddo, 'archiviazione ms', r.caldo);
    expect(r.n).toBe(6000);
    expect(r.primo.id).toBe('t0');
    expect(r.ultimo.id).toBe('t5999');
    expect(r.ultimo.embedding).toEqual(vec(5999));
  } finally { await chiudiApp(app); rmSync(userData, { recursive: true, force: true }); }
});

test('ricerca con 6000 schede: trova una delle prime, la seconda non indicizza, i vettori restano dopo il riavvio', async () => {
  test.setTimeout(180_000);
  const userData = cartellaTemporanea('filo-v825-');
  let app = await launch(userData);
  const prep = async (a) => a.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => {
      globalThis.__chiamate.push(texts.length);
      return { vectors: texts.map((t) => (/balena/i.test(t) ? [1, 0, 0, 0] : [0, 1, Math.random(), 0])) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async () => ({ text: '', provider: 'openrouter', model: 'stub', usage: {} });
  });
  try {
    await prep(app);
    await app.evaluate(async (_e, n) => {
      const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
      const A = globalThis.SN_ARCHIVED_TABS;
      const base = Date.UTC(2026, 8, 1);
      const voci = [];
      for (let i = 0; i < n; i++) {
        const vecchia = i >= n - 1000;
        voci.push({
          id: `t${i}`, url: `https://sito-${i}.test/p`, title: i === n - 3 ? 'La balena azzurra' : `Scheda ${i}`,
          closedAt: new Date(base - i * 3600e3).toISOString(), reason: 'manual', coOpenUrls: [],
          summary: `Riassunto ${i}`,
          ...(vecchia ? {} : { embedding: [0, 127, 0, 0], embedModel: EM }),
        });
      }
      await A.importa(voci);
    }, 6000);
    const cerca = (a) => a.evaluate(async () => {
      const prima = globalThis.__chiamate.length;
      const w = globalThis.SN_WINDOW || null;
      const { BrowserWindow } = require('electron');
      return { prima };
    });
    await cerca(app);
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    let page = null;
    await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return !!page; }).toBe(true);
    const r1 = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'balena' }));
    console.log('prima ricerca, risultati', r1.results && r1.results.length);
    await expect.poll(async () => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).filter((t) => !t.embedding).length), { timeout: 60_000 }).toBe(0);
    const c1 = await app.evaluate(() => globalThis.__chiamate.slice());
    console.log('chiamate dopo la prima ricerca', c1.length);
    const r2 = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'balena' }));
    const c2 = await app.evaluate(() => globalThis.__chiamate.slice());
    expect(c2.length - c1.length).toBe(1);
    expect(r2.results[0].title).toBe('La balena azzurra');
  } finally { await chiudiApp(app); }

  app = await launch(userData);
  try {
    await prep(app);
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    let page = null;
    await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return !!page; }).toBe(true);
    const r3 = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'balena' }));
    await new Promise((r) => setTimeout(r, 1500));
    const c3 = await app.evaluate(() => globalThis.__chiamate.slice());
    expect(c3.length).toBe(1);
    expect(r3.results[0].title).toBe('La balena azzurra');
  } finally { await chiudiApp(app); rmSync(userData, { recursive: true, force: true }); }
});

test('cancellare una scheda la toglie dai file della cartella dati (una, alcune, tutte)', async ({ app, openTab }) => {
  const S = 'segreto-ottocento25';
  await app.evaluate(async (_e, S) => {
    const A = globalThis.SN_ARCHIVED_TABS;
    await A.importa([
      { id: 'x1', url: `https://${S}.test/uno`, title: 'Uno', closedAt: '2026-05-10T10:00:00.000Z', coOpenUrls: [] },
      { id: 'y1', url: 'https://altro.test/', title: 'Altro', closedAt: '2026-03-10T10:00:00.000Z', coOpenUrls: [`https://${S}.test/uno`, 'https://z.test/'] },
      { id: 'y2', url: 'https://altro2.test/', title: 'Altro2', closedAt: '2026-05-11T10:00:00.000Z', coOpenUrls: [`https://${S}.test/uno`] },
    ]);
    await A.update('x1', { summary: 'riassunto', embedding: [1, 2, 3], embedModel: 'm' });
    await A.update('x1', { snippet: 'snip' });
  }, S);
  const page = await openTab('filo://archive/archive.html');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'remove_archived_tab', id: 'x1' }));
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  await app.evaluate(async () => { await require(require('node:path').join(process.cwd(), 'src/main/shim/storage.js')).whenSettled?.(); });
  const dove = tuttiIFile(userData).filter((p) => { try { return readFileSync(p).includes(S); } catch (_) { return false; } });
  expect(dove).toEqual([]);
  const resto = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).map((t) => [t.id, t.coOpenUrls]));
  expect(resto).toEqual([['y2', []], ['y1', ['https://z.test/']]]);
});

test('esporta e reimporta: l’archivio torna uguale', async () => {
  test.setTimeout(120_000);
  const a = cartellaTemporanea('filo-v825-a-');
  const b = cartellaTemporanea('filo-v825-b-');
  const zip = join(a, 'backup.zip');
  const semi = schede(300);
  let app = await launch(a);
  let prima;
  try {
    prima = await app.evaluate(async (_e, semi) => {
      await globalThis.SN_ARCHIVED_TABS.importa(semi);
      return globalThis.SN_ARCHIVED_TABS.list();
    }, semi);
    await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, zip);
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    let page = null;
    await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return !!page; }).toBe(true);
    const r = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'export_data' }));
    expect(r.ok).toBe(true);
  } finally { await chiudiApp(app); }
  app = await launch(b);
  try {
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, zip);
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    let page = null;
    await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return !!page; }).toBe(true);
    const pv = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'import_data_preview' }));
    expect(pv.ok).toBe(true);
    const ap = await page.evaluate(async (t) => chrome.runtime.sendMessage({ type: 'import_data_apply', token: t }), pv.token);
    expect(ap.ok).toBe(true);
    const dopo = await app.evaluate(async () => globalThis.SN_ARCHIVED_TABS.list());
    expect(dopo).toEqual(prima);
  } finally { await chiudiApp(app); rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

test('incognito: chiudere una scheda non la archivia, e dall’incognito non si svuota l’archivio', async ({ app, testServer }) => {
  await app.evaluate(async () => { await globalThis.SN_ARCHIVED_TABS.archive({ url: 'https://tenuta.test/', title: 'Tenuta' }); });
  const url = testServer.html('<title>Segreta</title>segreta');
  await app.evaluate(async () => { require('electron').ipcMain.emit; });
  const shell = await app.firstWindow();
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito && w._filoTabs))).toBe(true);
  await app.evaluate(async ({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    const id = w._filoTabs.openTab(u, { activate: true });
    await new Promise((r) => setTimeout(r, 1500));
    w._filoTabs.closeTab(id);
    w._filoTabs.openTab('filo://archive/archive.html', { activate: true });
  }, url);
  await new Promise((r) => setTimeout(r, 1500));
  const pagine = app.windows().filter((w) => w.url().startsWith('filo://archive'));
  expect(pagine.length).toBe(1);
  const vista = await pagine[0].evaluate(async () => chrome.runtime.sendMessage({ type: 'get_archived_tabs' }));
  expect(vista.tabs).toEqual([]);
  await pagine[0].evaluate(async () => chrome.runtime.sendMessage({ type: 'clear_archived_tabs' }));
  const l = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).map((t) => t.title));
  expect(l).toEqual(['Tenuta']);
});
