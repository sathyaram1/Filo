// Esplorazione giro 5 (#429): si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINE = ['filo://manage/manage.html', 'filo://options/options.html', 'filo://history/history.html',
  'filo://feedback/feedback.html', 'filo://downloads/downloads.html'];

test('chiudere di fila con la X schede dai nomi diversi', async ({ shell }) => {
  for (const u of PAGINE) await shell.evaluate((u) => window.filoShell.tabs.open(u), u);
  await expect.poll(() => shell.locator('#tabs .tab').count(), { timeout: 10_000 }).toBe(PAGINE.length + 1);
  await shell.waitForTimeout(1500);
  const info = () => shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((t) => {
    const c = t.querySelector('.close').getBoundingClientRect(); const r = t.getBoundingClientRect();
    return { nome: t.querySelector('.title').textContent, x: Math.round(r.left), w: Math.round(r.width), cx: Math.round((c.left + c.right) / 2), cy: Math.round((c.top + c.bottom) / 2) };
  }));
  const s0 = await info();
  console.log('prima', JSON.stringify(s0));
  const p = { x: s0[1].cx, y: s0[1].cy };
  await shell.mouse.move(p.x, p.y);
  await shell.waitForTimeout(200);
  await shell.mouse.click(p.x, p.y);
  await shell.waitForTimeout(800);
  const s1 = await info();
  console.log('dopo uno', JSON.stringify(s1));
  const sotto = await shell.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); const t = e && e.closest('.tab'); return [e && e.className, t && t.querySelector('.title').textContent]; }, p);
  console.log('sotto il puntatore', JSON.stringify(sotto));
});
