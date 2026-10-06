// Verifica #825 giro 1 — porte chiuse: la migrazione di 6000 schede e i vettori calcolati da una ricerca restano dopo un riavvio.

import { test, expect, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { argomentiScala } from '../../helpers/scala.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
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

test('migrazione di 6000 schede da storage.json, e dopo un riavvio ci sono tutte coi vettori', async () => {
  test.setTimeout(180_000);
  const userData = cartellaTemporanea('filo-v825-');
  const semi = schede(6000);
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ archivedTabs: semi, filo_memory: { PROFILO: 'x' } }), 'utf8');
  let app = await launch(userData);
  try {
    // Si aspetta la fine dell'avvio: una migrazione nei primissimi istanti è un'altra porta (#825 giro 1, rilievo esterno).
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await new Promise((ok) => setTimeout(ok, 3000));
    const r = await app.evaluate(async () => {
      const t0 = Date.now();
      const l = await globalThis.SN_ARCHIVED_TABS.list();
      const t1 = Date.now();
      await globalThis.__filoStorage.whenSettled();
      return { l, ms: t1 - t0 };
    });
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
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    let page = null;
    await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return !!page; }).toBe(true);
    await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'balena' }));
    await expect.poll(async () => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).filter((t) => !t.embedding).length), { timeout: 60_000 }).toBe(0);
    const c1 = await app.evaluate(() => globalThis.__chiamate.slice());
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
