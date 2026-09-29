// Verifica #821, giro 1, rilievo 1: la scheda attiva col rosso pieno del sito deve avere titolo e crocetta leggibili.
import { test, expect } from '../../fixtures/electron.mjs';

const favicon = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="7" fill="rgb(255,0,0)"/>' +
  '<path d="M12 9 L23 16 L12 23 Z" fill="#fff"/></svg>');
const PAGINA = `<!doctype html><html><head><link rel="icon" href="${favicon}"><title>Tubo rosso</title></head>` +
  '<body style="margin:0;height:1200px;background:#fff">cima bianca</body></html>';

const lum = ([r, g, b]) => {
  const l = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const nums = (c) => (/rgba?\(([^)]+)\)/.exec(c || '') || [, ''])[1].split(',').slice(0, 3).map(Number);

test('sito dalla cima bianca e favicon rosso: la scheda attiva rossa ha titolo a 4,5:1 e crocetta a 3:1', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await expect.poll(async () => shell.evaluate(() => {
    const el = document.querySelector('.tab.active[data-tip="Tubo rosso"]');
    return el ? getComputedStyle(el).backgroundColor : null;
  }), { timeout: 10_000 }).toBe('rgb(255, 0, 0)');
  const r = await shell.evaluate(() => {
    const el = document.querySelector('.tab.active[data-tip="Tubo rosso"]');
    return { bg: getComputedStyle(el).backgroundColor, title: getComputedStyle(el.querySelector('.title')).color,
      close: getComputedStyle(el.querySelector('.close')).color };
  });
  const bg = nums(r.bg);
  expect(contrast(nums(r.title), bg), `titolo ${r.title} su ${r.bg}`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(nums(r.close), bg), `crocetta ${r.close} su ${r.bg}`).toBeGreaterThanOrEqual(3);
});
