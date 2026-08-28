// VERIFICA #495 — secondo giro: provare a romperlo.
import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = 'filo://manage/manage.html';
const SHOTS = join(process.cwd(), 'tests', '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

async function ready(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
}
async function tabTexts(page) {
  return page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('.mg-tab')].map((b) => [b.dataset.tab, b.textContent.trim()])));
}
async function listLen(page) { return page.locator('#mgList .mg-item').count(); }

test('rottura — dati storici senza `status` finiscono comunque in una scheda contata', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);

  // Feedback "di una volta": nessun campo status, solo pipeline.
  await page.evaluate(() => window.__mgTest.setData([
    { _id: 'L1', text: 'vecchio 1', name: 'V1', seq: 1, subSeq: 0, createdAt: '2025-01-01T00:00:00Z', images: [] },
    { _id: 'L2', text: 'vecchio 2', name: 'V2', seq: 2, subSeq: 0, createdAt: '2025-01-02T00:00:00Z', images: [],
      pipeline: { action: 'candidate_change', l2Class: 'aligned', verdicts: [{ judge: 'A', class: 'aligned' }] } },
    { _id: 'L3', text: 'vecchio 3', name: 'V3', seq: 3, subSeq: 0, createdAt: '2025-01-03T00:00:00Z', images: [],
      pipeline: { action: 'block_attack', l2Class: 'attack', verdicts: [{ judge: 'A', class: 'attack' }] } },
  ]));

  const t = await tabTexts(page);
  // Nessuno di questi deve sparire dai conti: la somma delle 4 schede copre tutto.
  const nums = ['inbox', 'queue', 'resolved', 'archived']
    .map((k) => Number((t[k].match(/\((\d+)\)/) || [0, 0])[1]));
  expect(nums.reduce((a, b) => a + b, 0), `schede: ${JSON.stringify(t)}`).toBe(3);

  // E il numero coincide con la lista aperta.
  for (const tab of ['inbox', 'queue', 'resolved', 'archived']) {
    await page.evaluate((x) => window.__mgTest.setTab(x), tab);
    const n = Number((( await tabTexts(page))[tab].match(/\((\d+)\)/) || [0, 0])[1]);
    expect(await listLen(page), `scheda ${tab}`).toBe(n);
  }
});

test('rottura — status inventato: il numero non mente su ciò che la scheda mostra', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);
  await page.evaluate(() => window.__mgTest.setData([
    { _id: 'X1', status: '<script>alert(1)</script>', text: 'x', name: 'X', seq: 1, subSeq: 0, createdAt: '2026-01-01T00:00:00Z', images: [] },
    { _id: 'X2', status: 'todo', text: 'y', name: 'Y', seq: 2, subSeq: 0, createdAt: '2026-01-01T00:00:00Z', images: [] },
  ]));
  for (const tab of ['inbox', 'queue', 'resolved', 'archived']) {
    await page.evaluate((x) => window.__mgTest.setTab(x), tab);
    const n = Number((( await tabTexts(page))[tab].match(/\((\d+)\)/) || [0, 0])[1]);
    expect(await listLen(page), `scheda ${tab}`).toBe(n);
  }
  // Nessuna iniezione: il conteggio è solo cifre.
  const html = await page.locator('.mg-tab[data-tab="inbox"]').innerHTML();
  expect(html).not.toContain('<script');
  expect(await page.evaluate(() => document.querySelectorAll('.mg-tabs script').length)).toBe(0);
});

test('rottura — click veloci fra le schede: i numeri restano coerenti', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);
  await page.evaluate(() => window.__mgTest.setData([
    { _id: 'a', status: 'unlabeled', text: 'a', name: 'A', seq: 1, subSeq: 0, createdAt: '2026-01-01T00:00:00Z', images: [] },
    { _id: 'b', status: 'todo', text: 'b', name: 'B', seq: 2, subSeq: 0, createdAt: '2026-01-01T00:00:00Z', images: [] },
    { _id: 'c', status: 'todo', text: 'c', name: 'C', seq: 3, subSeq: 0, createdAt: '2026-01-01T00:00:00Z', images: [] },
    { _id: 'd', status: 'archived', text: 'd', name: 'D', seq: 4, subSeq: 0, createdAt: '2026-01-01T00:00:00Z', images: [] },
  ]));

  const order = ['queue', 'archived', 'stats', 'inbox', 'log', 'resolved', 'inbox', 'queue'];
  for (const tab of order) {
    await page.locator(`.mg-tab[data-tab="${tab}"]`).click();
  }
  // Doppio clic sulla stessa scheda
  await page.locator('.mg-tab[data-tab="inbox"]').dblclick();

  const t = await tabTexts(page);
  expect(t.inbox).toBe('Ricevuti (1)');
  expect(t.queue).toBe('In coda (2)');
  expect(t.resolved).toBe('Risolti (0)');
  expect(t.archived).toBe('Archiviati (1)');
  // Un solo badge per scheda (nessun accumulo di span a forza di ridisegni).
  const badges = await page.evaluate(() => [...document.querySelectorAll('.mg-tab')]
    .map((b) => b.querySelectorAll('.mg-tab-count').length));
  expect(badges).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
});

test('rottura — riordinare la lista non cambia il numero', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);
  await page.evaluate(() => window.__mgTest.setData(
    Array.from({ length: 7 }, (_, i) => ({
      _id: `p${i}`, status: 'todo', text: `t${i}`, name: `N${i}`, seq: i, subSeq: 0,
      priority: i % 4, clientId: `u${i}@x.y`, createdAt: `2026-01-0${(i % 8) + 1}T00:00:00Z`, images: [],
    }))));
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  const before = (await tabTexts(page)).queue;
  for (const m of ['num', 'priority', 'author', 'smart']) {
    await page.evaluate((x) => window.__mgTest.setSortMode(x), m);
    expect((await tabTexts(page)).queue, `ordinamento ${m}`).toBe(before);
    expect(await listLen(page)).toBe(7);
  }
  expect(before).toBe('In coda (7)');
});

test('rottura — finestra stretta: la barra delle schede coi numeri non straborda', async ({ openTab, app }) => {
  const page = await openTab(URL);
  await ready(page);
  await page.evaluate(() => {
    const mk = (p, n, s, extra) => Array.from({ length: n }, (_, i) => ({
      _id: `${p}${i}`, status: s, text: `t${i}`, name: `N${i}`, seq: i, subSeq: 0,
      clientId: 'x@y.z', createdAt: '2026-01-01T00:00:00Z', images: [], ...(extra || {}),
    }));
    window.__mgTest.setReleasedVersion('1.0.0');
    window.__mgTest.setData([
      ...mk('i', 128, 'unlabeled'), ...mk('q', 256, 'todo'),
      ...mk('r', 64, 'done', { resolvedInVersion: '1.0.0' }), ...mk('a', 512, 'archived'),
    ]);
  });

  for (const w of [1024, 900, 800, 720]) {
    await app.evaluate(async ({ BrowserWindow }, width) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(width, 800);
    }, w);
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const bar = document.querySelector('.mg-tabs');
      const last = document.querySelector('.mg-tab[data-tab="log"]');
      const lens = document.querySelector('.mg-search-toggle');
      return {
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        barScroll: bar.scrollWidth - bar.clientWidth,
        lastRight: Math.round(last.getBoundingClientRect().right),
        lensRight: lens ? Math.round(lens.getBoundingClientRect().right) : null,
        innerW: window.innerWidth,
        rows: new Set([...document.querySelectorAll('.mg-tab')].map((b) => Math.round(b.getBoundingClientRect().top))).size,
      };
    });
    // Ogni scheda deve restare raggiungibile e leggibile alla larghezza data.
    expect(m.lastRight, `larghezza ${w}: l'ultima scheda esce dalla finestra`).toBeLessThanOrEqual(m.innerW);
    if (m.lensRight !== null) {
      expect(m.lensRight, `larghezza ${w}: la lente di ricerca esce dalla finestra`).toBeLessThanOrEqual(m.innerW);
    }
    expect(m.docOverflow, `larghezza ${w}: la pagina scrolla in orizzontale`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: join(SHOTS, `v495-larghezza-${w}.png`) });
  }
});
