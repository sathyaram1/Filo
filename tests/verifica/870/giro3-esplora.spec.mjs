// #870 giro 3: esplorazione (si cancella prima della registrazione).
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SHOTS = join(ROOT, 'tests', '.shots');

async function home(app, escludi = []) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x.url().startsWith('filo://newtab') && !escludi.includes(x); } catch (_) { return false; } });
    if (w) {
      await w.waitForLoadState('domcontentloaded');
      await expect(w.locator('#tieni .dash-carta').first()).toBeVisible({ timeout: 10_000 });
      return w;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

test('xss e testi lunghi', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(async () => {
    const q = new Date().toISOString();
    const file = (id, title) => ({ id, meta: { title, created: q, modified: q, version: 1 }, modules: [], content: {} });
    await chrome.storage.local.set({
      'filo.editor.collection': { version: 1, activeId: 'a', files: [file('a', '<img src=x onerror="window.__x=1">'), file('b', 'Titolo lunghissimo '.repeat(20) + '🎉🎉')] },
      decks: [{ id: 'd1', nome: '<b onmouseover="window.__x=2">grassetto</b>', carte: [], created_at: q, updated_at: q }],
    });
    await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: '<img src=x onerror="window.__x=3"> **grassetto** [link](https://example.com)' });
    await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'Avviso lunghissimo '.repeat(60) });
    await globalThis.SN_FILO_MEMORY.addTimer({ label: '<i>Pasta</i> '.repeat(10), seconds: 600 });
  });
  await page.reload();
  await home(app);
  await page.waitForTimeout(800);
  expect(await page.locator('#accade img, #tieni img[src="x"], #tieni b').count()).toBe(0);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, 'g3-xss.png') });
  await page.locator('#accade .dash-carta[data-tipo="avviso"]').first().click({ position: { x: 30, y: 12 } });
  await page.waitForTimeout(500);
  await page.locator('#accade .dash-carta[data-tipo="avviso"]').first().click({ position: { x: 30, y: 12 } });
  await page.waitForTimeout(500);
  console.log('BOLLE:', await page.locator('.dash-bubble-filo').count());
  console.log('X:', await page.evaluate(() => window.__x));
  console.log('BUBBLE HTML:', (await page.locator('.dash-bubble-filo').first().innerHTML()).slice(0, 400));
  await page.screenshot({ path: join(SHOTS, 'g3-xss-filo.png') });
});

test('due home: la disposizione cambia anche nell’altra', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const a = await home(app);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  const b = await home(app, [a]);
  await b.locator('#tieni .dash-carta[data-tipo="mazzi"]').click({ button: 'right' });
  await b.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli dalla home' }).click();
  await expect(a.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0, { timeout: 5000 });
  await app.evaluate(async () => { await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'Primo avviso' }); });
  await app.evaluate(async () => { await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Forno', seconds: 900 }); });
  await expect(a.locator('#accade .dash-carta[data-tipo="timer"]')).toHaveCount(1, { timeout: 5000 });
  await expect(b.locator('#accade .dash-carta[data-tipo="avviso"]')).toHaveCount(1, { timeout: 5000 });
});

test('molti avvisi e finestra stretta: si arriva a tutto', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(async () => {
    for (let i = 0; i < 25; i++) await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: `Avviso numero ${i}` });
  });
  await page.reload();
  await home(app);
  await page.waitForTimeout(500);
  const n = await page.locator('#accade .dash-carta[data-tipo="avviso"]').count();
  console.log('AVVISI VISTI:', n);
  const ultimo = page.locator('#accade .dash-carta[data-tipo="avviso"]').last();
  await ultimo.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'g3-molti.png') });
  const box = await ultimo.boundingBox();
  const vp = await page.evaluate(() => [innerWidth, innerHeight]);
  console.log('ULTIMO BOX', box, 'VP', vp);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1000, 640); });
  await page.waitForTimeout(600);
  const altro = page.locator('#altro .dash-altro-app[data-id="bacheca"]');
  await altro.scrollIntoViewIfNeeded().catch((e) => console.log('NO SCROLL', e.message));
  const ab = await altro.boundingBox();
  const vp2 = await page.evaluate(() => [innerWidth, innerHeight]);
  console.log('ALTRO BOX', ab, 'VP', vp2);
  const st = await page.evaluate(() => { const r = document.getElementById('right'); const s = getComputedStyle(r); return [s.overflowY, r.scrollHeight, r.clientHeight]; });
  console.log('RIGHT', st);
  await page.screenshot({ path: join(SHOTS, 'g3-stretta-scroll.png') });
});
