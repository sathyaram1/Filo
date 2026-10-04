// #870 giro 9 — esplorazione: la home piena (tanti avvisi, timer, testi lunghi, emoji, markup), chiara e scura.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(ROOT, 'tests', '.shots');

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
const manda = (page, msg) => page.evaluate((m) => new Promise((ok) => chrome.runtime.sendMessage(m, (r) => ok(r))), msg);

test('home piena', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  const m = await page.evaluate(() => window.SN_MSG.MSG);
  await page.screenshot({ path: join(SHOTS, 'g9-vuota.png') });
  await manda(page, { type: m.FILO_ADD_TIMER, label: 'Pasta 🍝 <b>grassetto</b>', seconds: 252 });
  await manda(page, { type: m.FILO_ADD_TIMER, label: 'Un timer col nome lunghissimo che non finisce mai perché qualcuno ha scritto troppo', seconds: 4000 });
  await manda(page, { type: m.FILO_ADD_TIMER, label: 'Uova', seconds: 2 });
  await app.evaluate(async () => {
    const ora = Date.now();
    const quando = (n) => new Date(ora - n * 36e5).toISOString();
    const file = (id, title, q) => ({ id, meta: { title, created: q, modified: q, version: 1 }, modules: [], content: {} });
    const files = [];
    for (let i = 0; i < 8; i++) files.push(file('f' + i, i === 0 ? 'Un documento con un titolo davvero molto molto lungo che non sta nella carta' : `Doc ${i} <img src=x onerror=alert(1)>`, quando(i * 7)));
    await chrome.storage.local.set({
      'filo.editor.collection': { version: 1, activeId: 'f0', files },
      decks: [{ id: 'd1', nome: '🐉 Draghi', carte: [], created_at: quando(50), updated_at: quando(3) }],
    });
    await globalThis.SN_FILO_MEMORY.addAlarm({ label: 'palestra', time: '07:00', repeat: 'feriali' });
    for (let i = 0; i < 6; i++) {
      await globalThis.SN_FILO_MEMORY.addNotification({ kind: i % 2 ? 'alert' : 'info', text: i === 0 ? 'Avviso lunghissimo '.repeat(40) : `Avviso numero ${i} <script>x</script> 🚀` });
    }
  });
  await page.reload();
  await home(app);
  await page.waitForTimeout(3500);
  mkdirSync(SHOTS, { recursive: true });
  for (const tema of ['light', 'dark']) {
    await manda(page, { type: m.UPDATE_SETTINGS, settings: { theme: tema } });
    await expect(page.locator('html')).toHaveAttribute('data-sn-theme', tema);
    await page.mouse.move(640, 300);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, `g9-piena-${tema}.png`) });
  }
  const info = await page.evaluate(() => {
    const r = (s) => { const n = document.querySelector(s); if (!n) return null; const b = n.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, sh: n.scrollHeight, ch: n.clientHeight, ov: getComputedStyle(n).overflowY }; };
    return { win: [innerWidth, innerHeight], left: r('#left'), accade: r('#accade'), right: r('#right'), tieni: r('#tieni'), altro: r('#altro'), input: r('#inputForm'),
      docH: document.documentElement.scrollHeight, bodyOv: getComputedStyle(document.body).overflow,
      carteSin: [...document.querySelectorAll('#accade .dash-carta')].map((n) => n.dataset.chiave + ' ' + n.querySelector('.dash-carta-tit').textContent) };
  });
  console.log(JSON.stringify(info, null, 1));
  // scroll left column to bottom
  await page.locator('#left').evaluate((n) => { n.scrollTop = 99999; });
  await page.locator('#accade').evaluate((n) => { n.scrollTop = 99999; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(SHOTS, 'g9-piena-scroll.png') });
  // hover on a card
  await page.locator('#accade .dash-carta').nth(2).hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, 'g9-hover.png') });
});
