// #870 giro 5 — esplorazione della home a carte: ordine a sinistra dopo il riavvio, «Sposta su» sotto i
// Crediti, avvisi con markup e lunghissimi, rimettere a parole, foto chiara e scura.
import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(ROOT, 'tests', '.shots');
const scala = process.env.FILO_TEST_SCALE ? `-${process.env.FILO_TEST_SCALE}` : '';

async function home(app) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (w) {
      await w.waitForLoadState('domcontentloaded');
      await expect(w.locator('#tieni .dash-carta').first()).toBeVisible({ timeout: 10_000 });
      return w;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}
const titoliSinistra = (page) => page.locator('#accade > .dash-carta').evaluateAll((ns) => ns.map((n) => n.querySelector('.dash-carta-tit').textContent + '|' + (n.querySelector('.dash-carta-stato')?.textContent || '')));

test('ordine a sinistra trascinato resta dopo il riavvio', async () => {
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-carte5-');
  const lancia = () => electron.launch({ args: [...argomentiScala, '.'], cwd: ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  let app = await lancia();
  try {
    let page = await home(app);
    await app.evaluate(async () => {
      await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Pasta', seconds: 900 });
      await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'La lavatrice ha finito.' });
    });
    await page.reload();
    page = await home(app);
    console.log('prima', await titoliSinistra(page));
    const av = page.locator('#accade .dash-carta[data-tipo="avviso"]');
    const ti = page.locator('#accade .dash-carta[data-tipo="timer"]');
    await av.dragTo(ti, { targetPosition: { x: 60, y: 6 } });
    await page.waitForTimeout(500);
    console.log('dopo drag', await titoliSinistra(page));
    // «Sposta su» sulla carta subito sotto i Crediti
    const seconda = page.locator('#accade > .dash-carta').nth(1);
    await seconda.click({ button: 'right', position: { x: 30, y: 12 } });
    const voci = await page.locator('.dash-menu .dash-menu-voce').allTextContents();
    console.log('menu seconda', voci);
    if (voci.includes('Sposta su')) {
      await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Sposta su' }).click();
      await page.waitForTimeout(500);
      console.log('dopo sposta su', await titoliSinistra(page));
    } else await page.keyboard.press('Escape');
    const prima = await titoliSinistra(page);
    await chiudiApp(app);
    app = await lancia();
    page = await home(app);
    await page.waitForTimeout(800);
    const dopo = await titoliSinistra(page);
    console.log('dopo riavvio', dopo);
    expect(dopo.map((s) => s.split('|')[0])).toEqual(prima.map((s) => s.split('|')[0]));
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('avvisi con markup e lunghissimi, tante carte: foto chiara e scura', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.addNotification({ kind: 'alert', text: '<img src=x onerror="window.__xss=1"><b>grassetto</b>' });
    await M.addNotification({ kind: 'info', text: 'Lungo '.repeat(400) + '🧶🧶🧶' });
    for (let i = 0; i < 8; i++) await M.addNotification({ kind: 'info', text: `Avviso numero ${i}` });
    await M.addTimer({ label: '<i>forno</i> '.repeat(10), seconds: 3600 * 5 });
    await M.addAlarm({ label: 'palestra', time: '07:00', repeat: 'feriali' });
  });
  await page.reload();
  await home(app);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator('#accade b').count()).toBe(0);
  mkdirSync(SHOTS, { recursive: true });
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => new Promise((ok) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } }, ok)), tema);
    await expect(page.locator('html')).toHaveAttribute('data-sn-theme', tema);
    await page.mouse.move(640, 300);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, `g5-tante-${tema}${scala}.png`) });
  }
  // scroll della colonna sinistra: si raggiunge l'ultima carta?
  const info = await page.evaluate(() => {
    const a = document.getElementById('accade');
    const l = document.getElementById('left');
    return { aH: a.scrollHeight, aC: a.clientHeight, lH: l.scrollHeight, lC: l.clientHeight, ov: getComputedStyle(a).overflowY, ovl: getComputedStyle(l).overflowY, win: innerHeight };
  });
  console.log('scroll', JSON.stringify(info));
  const ultima = page.locator('#accade > .dash-carta').last();
  await ultima.scrollIntoViewIfNeeded();
  await expect(ultima).toBeInViewport();
  // hover sul titolo lungo
  await page.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'Lungo' }).hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, `g5-tante-hover${scala}.png`) });
});

test('rimettere i Mazzi a parole e aggiungerli in cima', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await page.locator('#tieni .dash-carta[data-tipo="mazzi"]').click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli dalla home' }).click();
  await expect(page.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
  await app.evaluate(async () => {
    await chrome.storage.local.set({ filo_onboarding: { done: true } });
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry });
    globalThis.__giro = 0;
    const risp = [
      { strumenti: [{ id: 'c1', name: 'CARTA_HOME', arguments: '{"operazione":"aggiungi","carta":"mazzi","verso":"cima"}' }] },
      { testo: 'Rimessi.' },
    ];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const r = risp[Math.min(globalThis.__giro++, risp.length - 1)];
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (r.testo) onDelta && onDelta(r.testo);
      return { ...base, text: r.testo || '', toolCalls: r.strumenti || [], finishReason: r.strumenti ? 'tool_calls' : 'stop' };
    };
  });
  await page.reload();
  await home(app);
  await page.locator('#input').fill('rimetti i mazzi in cima');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Rimessi' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => page.locator('#tieni > .dash-carta').evaluateAll((ns) => ns.map((n) => n.dataset.chiave))).toEqual(['mazzi', 'editor', 'suggerimenti', 'rapide']);
  await page.mouse.move(640, 300);
  await page.screenshot({ path: join(SHOTS, `g5-chat${scala}.png`) });
});
