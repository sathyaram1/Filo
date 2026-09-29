// Verifica #821, giro 1: scheda attiva di un sito dalla cima bianca, e cambi di scheda in fretta.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const svg = (inner) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">${inner}</svg>`);
const page = (title, icon) => '<!doctype html><html><head>' +
  (icon ? `<link rel="icon" href="${icon}">` : '') +
  `<title>${title}</title></head><body style="margin:0;height:1200px;background:#fff">${title}</body></html>`;
const SITI = [
  ['Tubo rosso', svg('<rect width="32" height="32" rx="7" fill="rgb(255,0,0)"/><path d="M12 9 L23 16 L12 23 Z" fill="#fff"/>')],
  ['Posta gialla', svg('<rect width="32" height="32" fill="rgb(255,204,0)"/>')],
  ['Libro blu', svg('<rect width="32" height="32" rx="6" fill="rgb(24,119,242)"/>')],
];
const lum = ([r, g, b]) => {
  const l = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const nums = (c) => (/rgba?\(([^)]+)\)/.exec(c || '') || [, ''])[1].split(',').slice(0, 3).map(Number);

test('scheda attiva dalla cima bianca e cambi di scheda in fretta', async ({ shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  mkdirSync('tests/.shots', { recursive: true });
  for (const [t, i] of SITI) await testServer.openReady(openTab, page(t, i));
  await expect.poll(async () => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.filter((t) => t.identityColor).length), { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
  const out = { attive: [] };
  const ids = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.id));
  for (const [t] of SITI) {
    await shell.click(`.tab[data-tip="${t}"]`);
    await shell.waitForTimeout(1500);
    const r = await shell.evaluate((tip) => {
      const el = document.querySelector(`.tab[data-tip="${tip}"]`);
      return { active: el.classList.contains('active'), bg: getComputedStyle(el).backgroundColor, title: getComputedStyle(el.querySelector('.title')).color };
    }, t);
    r.contr = contrast(nums(r.title), nums(r.bg));
    out.attive.push({ t, ...r });
    await shell.screenshot({ path: `tests/.shots/v821-attiva-${t.split(' ')[1]}.png`, clip: { x: 0, y: 0, width: 800, height: 44 } });
  }
  // cambi in fretta
  for (let k = 0; k < 30; k++) shell.evaluate((id) => window.filoShell.tabs.activate(id), ids[k % ids.length]).catch(() => {});
  await shell.waitForTimeout(1500);
  out.fretta = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return [...document.querySelectorAll('.tab')].map((el) => ({ tip: el.dataset.tip, active: el.classList.contains('active'),
      snapActive: String(snap.activeId) === el.dataset.id, tinted: el.classList.contains('tinted'), bg: getComputedStyle(el).backgroundColor }));
  });
  writeFileSync('tests/.shots/v821-log5.json', JSON.stringify(out, null, 1));
  for (const x of out.fretta) {
    expect(x.active).toBe(x.snapActive);
    if (x.active) expect(x.tinted).toBe(false);
  }
});
