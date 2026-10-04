// #870 giro 2: esplorazione (si cancella o si rinomina dopo la critica).
import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { homeTab, modelloFinto } from './_comune.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SHOTS = join(ROOT, 'tests', '.shots');
const manda = (page, msg) => page.evaluate((m) => new Promise((ok) => chrome.runtime.sendMessage(m, (r) => ok(r))), msg);
const titoliSx = (page) => page.locator('#accade > .dash-carta').evaluateAll((ns) => ns.map((n) => n.querySelector('.dash-carta-tit').textContent));
const ordineDx = (page) => page.locator('#tieni > .dash-carta').evaluateAll((ns) => ns.map((n) => n.dataset.chiave));

test('due home aperte: togliere i Mazzi in una si vede nell’altra', async ({ app, shell }) => {
  const a = await homeTab(app);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  const b = await homeTab(app, [a]);
  await a.locator('#tieni .dash-carta[data-tipo="mazzi"]').click({ button: 'right' });
  await a.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli' }).click();
  await expect(b.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0, { timeout: 5000 });
});

test('ordine delle carte di sinistra dopo il riavvio', async () => {
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-v870-');
  const lancia = () => electron.launch({ args: [...argomentiScala, '.'], cwd: ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  let app = await lancia();
  try {
    let page = await homeTab(app);
    await app.evaluate(async () => {
      await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Pasta', seconds: 600 });
      await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Forno', seconds: 1200 });
    });
    await page.reload();
    await homeTab(app);
    await expect.poll(() => titoliSx(page)).toEqual(['Crediti', 'Pasta', 'Forno']);
    const forno = page.locator('#accade .dash-carta', { hasText: 'Forno' });
    await forno.click({ button: 'right', position: { x: 30, y: 12 } });
    await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Sposta su' }).click();
    await expect.poll(() => titoliSx(page)).toEqual(['Crediti', 'Forno', 'Pasta']);
    await chiudiApp(app);
    app = await lancia();
    page = await homeTab(app);
    await expect.poll(() => titoliSx(page)).toEqual(['Crediti', 'Forno', 'Pasta']);
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('un timer trascinato a destra non ci va; una carta di destra a sinistra nemmeno', async ({ app }) => {
  const page = await homeTab(app);
  await app.evaluate(async () => { await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Pasta', seconds: 600 }); });
  await page.reload();
  await homeTab(app);
  const prima = await ordineDx(page);
  await page.locator('#accade .dash-carta', { hasText: 'Pasta' }).dragTo(page.locator('#tieni .dash-carta[data-tipo="editor"]'), { targetPosition: { x: 60, y: 6 } });
  await page.waitForTimeout(500);
  expect(await ordineDx(page)).toEqual(prima);
  await page.locator('#tieni .dash-carta[data-tipo="mazzi"]').dragTo(page.locator('#accade .dash-carta', { hasText: 'Pasta' }), { targetPosition: { x: 60, y: 6 } });
  await page.waitForTimeout(500);
  expect(await ordineDx(page)).toEqual(prima);
});

test('Canc toglie una carta di destra, e il fuoco resta nella colonna', async ({ app }) => {
  const page = await homeTab(app);
  await page.locator('#tieni .dash-carta[data-tipo="mazzi"]').focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
  const dove = await page.evaluate(() => (document.activeElement && (document.activeElement.className + '|' + document.activeElement.tagName)));
  console.log('FUOCO DOPO CANC:', dove);
});

test('chiesto a Filo: togli lo scaricamento / sposta lo scaricamento', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await homeTab(app);
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'Backup finito.' });
    await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Pasta', seconds: 600 });
  });
  await modelloFinto(app, [
    { strumenti: [{ id: 'c1', name: 'CARTA_HOME', arguments: '{"operazione":"togli","carta":"il timer della pasta"}' }] },
    { testo: 'Ok.' },
  ]);
  await page.reload();
  await homeTab(app);
  await page.locator('#input').fill('togli il timer della pasta dalla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ok' })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
  console.log('SINISTRA DOPO TOGLI TIMER:', JSON.stringify(await titoliSx(page)));
  const ultimaAzione = await page.locator('.dash-bubble-filo').last().textContent();
  console.log('BOLLA:', ultimaAzione);
});

test('foto con dati scomodi, chiara e scura, stretta', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await homeTab(app);
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.addNotification({ kind: 'info', text: '<b>grassetto</b><img src=x onerror="document.title=\'XSS\'"> ' + 'https://esempio.it/' + 'a'.repeat(300) });
    await M.addNotification({ kind: 'alert', text: '🎉🎉 Pronto! '.repeat(30) });
    await M.addTimer({ label: 'Un timer dal nome lunghissimo che non finisce mai più davvero', seconds: 7200 });
    await M.addAlarm({ label: 'sveglia', time: '07:00' });
  });
  await page.reload();
  await homeTab(app);
  mkdirSync(SHOTS, { recursive: true });
  const m = await page.evaluate(() => window.SN_MSG.MSG);
  for (const tema of ['light', 'dark']) {
    await manda(page, { type: m.UPDATE_SETTINGS, settings: { theme: tema } });
    await page.mouse.move(640, 300);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, `v870-g2-${tema}.png`) });
  }
  expect(await page.title()).not.toBe('XSS');
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(820, 600); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOTS, 'v870-g2-stretta.png') });
  const fuori = await page.locator('.dash-carta').evaluateAll((ns) => ns.filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.dataset.chiave));
  console.log('FUORI:', JSON.stringify(fuori));
  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  console.log('SCROLL ORIZZ:', JSON.stringify(sw));
});
